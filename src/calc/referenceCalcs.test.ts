import { describe, expect, it } from 'vitest';
import { evaluateFeeder, faultCurrentKA, resistanceFactor, transformerImpedance, upstreamVoltageDropPct, voltageDropPct, designCurrentA } from './electrical';
import { evaluateEarthing } from './earthing';
import { boardTotals } from './summary';
import { pfCorrection, transformer } from './quick';
import { transformerChecks } from './txGen';
import type { Feeder, Project } from '../types';

/** Hand-calculated reference values. Every expected number below was worked
 * out by hand (arithmetic written in the comment) from the formulas and the
 * built-in reference cable data — none is produced by calling the code under
 * test. These pin the method; they do not validate the method against
 * IEC 60909 / IEC 60364 (see docs/engineering/calculation-methods.md).
 *
 * Common data: U = 415 V, U0 = 415/√3 = 239.60 V, R at operating temperature
 * = 1.2 × R20 (no vdTempC), reference cable table R20 / X. */

const project = (feeders: Feeder[], boards: Project['boards'] = []): Project => ({
  name: 'Reference', voltageV: 415, frequencyHz: 50, ambientC: 30, vdLimitPct: 4,
  boards: [{ id: 'MDB', name: 'Main', sourceKva: 1000, sourceImpedancePct: 5 }, ...boards],
  feeders, updatedAt: ''
});
const feeder = (over: Partial<Feeder>): Feeder => ({
  id: 'F1', boardId: 'MDB', name: 'Feeder', loadKw: 50, demandFactor: 1, powerFactor: 0.85,
  lengthM: 50, cableCsaMm2: 50, cores: 4, breakerRatingA: 100, breakerIcuKa: 50, ...over
});

describe('voltage drop — hand calculations', () => {
  it('three-phase: 50 kW, cos φ 0.85, 4C 50 mm², 50 m', () => {
    // Ib = 50 000 / (√3 × 415 × 0.85) = 81.836 A
    // R = 0.387 × 1.2 = 0.4644 Ω/km, X = 0.08 Ω/km, sin φ = 0.5268
    // ΔU = √3 × 81.836 × 0.05 × (0.4644 × 0.85 + 0.08 × 0.5268) = 3.096 V → 3.096 / 415 = 0.7461 %
    const f = feeder({});
    const p = project([f]);
    expect(designCurrentA(f, p)).toBeCloseTo(81.836, 2);
    expect(voltageDropPct(f, p)).toBeCloseTo(0.7461, 3);
  });

  it('single-phase: 3 kW, cos φ 0.9, 2C 4 mm², 30 m (phase + neutral loop)', () => {
    // Ib = 3000 / (239.60 × 0.9) = 13.912 A
    // R = 4.61 × 1.2 = 5.532 Ω/km, X = 0.09, sin φ = 0.4359
    // ΔU = 2 × 13.912 × 0.03 × (5.532 × 0.9 + 0.09 × 0.4359) = 4.189 V → 4.189 / 239.60 = 1.7482 %
    const f = feeder({ loadKw: 3, powerFactor: 0.9, cableCsaMm2: 4, lengthM: 30, cores: 2, breakerRatingA: 20 });
    const p = project([f]);
    expect(designCurrentA(f, p)).toBeCloseTo(13.912, 2);
    expect(voltageDropPct(f, p)).toBeCloseTo(1.7482, 3);
  });

  it('parallel runs: 400 kW, cos φ 0.9, 2 × 4C 240 mm², 100 m (R and X halved)', () => {
    // Ib = 400 000 / (√3 × 415 × 0.9) = 618.31 A
    // R = 0.0754 × 1.2 / 2 = 0.04524 Ω/km, X = 0.07 / 2 = 0.035 Ω/km, sin φ = 0.4359
    // ΔU = √3 × 618.31 × 0.1 × (0.04524 × 0.9 + 0.035 × 0.4359) = 5.994 V → 1.4444 %
    const f = feeder({ loadKw: 400, powerFactor: 0.9, cableCsaMm2: 240, lengthM: 100, parallel: 2, breakerRatingA: 630 });
    expect(voltageDropPct(f, project([f]))).toBeCloseTo(1.4444, 3);
  });

  it('cumulative: source → MDB → SMDB (4C 95 mm², 80 m) → final circuit (4C 16 mm², 40 m)', () => {
    // SMDB load 60 kW, cos φ 0.85, balanced: per phase P = 20 kW, Q = 20 × tan(acos 0.85) = 12.394 kvar
    // Incomer, per phase conductor: Ip = 20 000 / 239.60 = 83.47 A, Iq = 51.73 A
    //   ΔU = 0.08 × (0.193 × 1.2 × 83.47 + 0.075 × 51.73) = 1.857 V → 1.857 / 239.60 = 0.7750 %
    // Final circuit: Ib = 60 000 / (√3 × 415 × 0.85) = 98.20 A, R = 1.15 × 1.2 = 1.38, X = 0.085
    //   ΔU = √3 × 98.20 × 0.04 × (1.38 × 0.85 + 0.085 × 0.5268) = 8.285 V → 1.9965 %
    // Total at the end of the final circuit: 0.7750 + 1.9965 = 2.7715 %
    const incomer = feeder({ id: 'I1', feedsBoardId: 'SMDB', cableCsaMm2: 95, lengthM: 80, loadKw: 0, breakerRatingA: 125 });
    const fin = feeder({ id: 'F2', boardId: 'SMDB', loadKw: 60, cableCsaMm2: 16, lengthM: 40, breakerRatingA: 100 });
    const p = project([incomer, fin], [{ id: 'SMDB', name: 'Sub', upstreamId: 'MDB' }]);
    expect(designCurrentA(incomer, p)).toBeCloseTo(98.20, 1);
    expect(upstreamVoltageDropPct(p, 'SMDB')).toBeCloseTo(0.7750, 3);
    const r = evaluateFeeder(p, fin);
    expect(r.vdPct).toBeCloseTo(1.9965, 3);
    expect(r.vdTotalPct).toBeCloseTo(2.7715, 3);
  });

  it('copper resistance–temperature factor, α = 0.00393 /K', () => {
    // 90 °C: 1 + 0.00393 × 70 = 1.2751; 70 °C: 1 + 0.00393 × 50 = 1.1965; 20 °C: 1
    expect(resistanceFactor(90)).toBeCloseTo(1.2751, 4);
    expect(resistanceFactor(70)).toBeCloseTo(1.1965, 4);
    expect(resistanceFactor(20)).toBe(1);
    expect(resistanceFactor()).toBe(1.2); // the flat default ≈ 70 °C
  });
});

describe('short circuit — hand calculations (maximum Ik″: c max = 1.05, cable R at 20 °C, infinite MV source, no KT)', () => {
  // Transformer 1000 kVA, uk 5 %, 415 V, X/R 5:
  // |Z| = 415² × 0.05 / 1 000 000 = 0.0086113 Ω; R = |Z| / √26 = 0.0016888 Ω; X = 5R = 0.0084440 Ω
  it('transformer impedance referred to LV', () => {
    const z = transformerImpedance(1000, 5, 415, 5);
    expect(z.r).toBeCloseTo(0.0016888, 7);
    expect(z.x).toBeCloseTo(0.0084440, 7);
  });

  it('three-phase fault at the LV busbar', () => {
    // Ik″ = 1.05 × 415 / (√3 × 0.0086113) = 29 215 A = 29.22 kA
    expect(faultCurrentKA(transformerImpedance(1000, 5, 415, 5), 415)).toBeCloseTo(29.215, 2);
    const r = evaluateFeeder(project([feeder({})]), feeder({}));
    expect(r.breakerFaultKA).toBeCloseTo(29.215, 2);
  });

  it('three-phase fault at the end of 50 m of 4C 50 mm²', () => {
    // Cable at 20 °C: R = 0.387 × 0.05 = 0.01935 Ω, X = 0.08 × 0.05 = 0.004 Ω
    // |Z| = √((0.0016888 + 0.01935)² + (0.008444 + 0.004)²) = 0.024444 Ω → 1.05 × 415 / (√3 × 0.024444) = 10.292 kA
    const f = feeder({});
    expect(evaluateFeeder(project([f]), f).endFaultKA).toBeCloseTo(10.292, 2);
  });

  it('line-to-neutral fault at the end of 30 m of 2C 4 mm² (phase + neutral)', () => {
    // Cable each way at 20 °C: R = 4.61 × 0.03 = 0.1383 Ω, X = 0.0027 Ω; loop = 2 ×
    // |Z| = √((0.0016888 + 0.2766)² + (0.008444 + 0.0054)²) = 0.27863 Ω → 1.05 × 239.60 / 0.27863 = 0.9029 kA
    const f = feeder({ loadKw: 3, powerFactor: 0.9, cableCsaMm2: 4, lengthM: 30, cores: 2, breakerRatingA: 20 });
    expect(evaluateFeeder(project([f]), f).endFaultKA).toBeCloseTo(0.9029, 3);
  });

  it('breaker breaking capacity check: Icu below the busbar fault fails', () => {
    const f = feeder({ breakerIcuKa: 25 }); // 25 kA < 29.22 kA
    expect(evaluateFeeder(project([f]), f).icuStatus).toBe('bad');
  });
});

describe('earth fault loop (TN-S) — hand calculations, c min = 0.95', () => {
  // Ze at the main board = transformer impedance (Dyn, Z0 ≈ Z1): R 0.0016888, X 0.0084440 Ω.
  it('2C 4 mm² (CPC 4 mm²), 30 m, type C 20 A: instantaneous trip, adiabatic pass', () => {
    // Loop R = (5.532 + 5.532) × 0.03 = 0.33192 Ω, X = 0.09 × 0.03 = 0.0027 Ω
    // Zs = √((0.0016888 + 0.33192)² + (0.008444 + 0.0027)²) = 0.33379 Ω
    // If = 0.95 × 239.60 / 0.33379 = 681.9 A ≥ Ia = 10 × 20 = 200 A → instantaneous (t = 0.1 s)
    // Max Zs = 0.95 × 239.60 / 200 = 1.1381 Ω; adiabatic S = 681.9 × √0.1 / 143 = 1.508 mm² ≤ 4 mm²
    const f = feeder({ loadKw: 3, powerFactor: 0.9, cableCsaMm2: 4, lengthM: 30, cores: 2, breakerRatingA: 20, breakerType: 'C' });
    const r = evaluateEarthing(project([f]), f);
    expect(r.zsOhm).toBeCloseTo(0.33379, 4);
    expect(r.faultA).toBeCloseTo(681.9, 0);
    expect(r.tripA).toBe(200);
    expect(r.maxZsOhm).toBeCloseTo(1.1381, 3);
    expect(r.adiabaticMinMm2).toBeCloseTo(1.508, 2);
    expect(r.disconnection).toBe('ok');
    expect(r.adiabatic).toBe('ok');
  });

  it('2C 2.5 mm², 150 m, type C 32 A: fault current below the magnetic trip → not instantaneous', () => {
    // Loop R = 2 × 7.41 × 1.2 × 0.15 = 2.6676 Ω, X = 0.015 Ω → Zs = 2.6694 Ω
    // If = 0.95 × 239.60 / 2.6694 = 85.27 A < Ia = 320 A
    const f = feeder({ loadKw: 3, powerFactor: 0.9, cableCsaMm2: 2.5, lengthM: 150, cores: 2, breakerRatingA: 32, breakerType: 'C' });
    const r = evaluateEarthing(project([f]), f);
    expect(r.zsOhm).toBeCloseTo(2.6694, 3);
    expect(r.faultA).toBeCloseTo(85.27, 1);
    expect(r.disconnection).not.toBe('ok');
  });
});

describe('demand, power factor correction and transformer — hand calculations', () => {
  it('maximum demand of a board: connected kW, demand kW (× demand factor) and kvar', () => {
    // 20 kW × 0.8 at cos φ 0.8 → 16 kW, 16 × tan(acos 0.8) = 16 × 0.75 = 12 kvar; 10 kW × 1 at cos φ 1 → 10 kW, 0 kvar
    const p = project([feeder({ id: 'A', loadKw: 20, demandFactor: 0.8, powerFactor: 0.8 }), feeder({ id: 'B', loadKw: 10, powerFactor: 1 })]);
    const t = boardTotals(p, 'MDB');
    expect(t.connectedKw).toBe(30);
    expect(t.demandKw).toBeCloseTo(26, 10);
    expect(t.demandKvar).toBeCloseTo(12, 6);
  });

  it('capacitor kvar to raise 100 kW from cos φ 0.8 to 0.95: Q = P (tan φ1 − tan φ2)', () => {
    // tan φ1 = 0.75, tan φ2 = 0.32868 → Q = 100 × 0.42132 = 42.13 kvar; S 125 → 105.26 kVA
    const r = pfCorrection(100, 0.8, 0.95);
    expect(r.kvar).toBeCloseTo(42.13, 2);
    expect(r.kvaBefore).toBe(125);
    expect(r.kvaAfter).toBeCloseTo(105.26, 2);
  });

  it('transformer 1000 kVA, 415 V, 5 %: full-load current, fault level, regulation at 800 kVA, cos φ 0.85', () => {
    // In = 1 000 000 / (√3 × 415) = 1391.2 A; Ik″ = 1.05 × In / 0.05 = 29.22 kA
    // ur = 5 / √26 = 0.9806 %, ux = 4.9029 %; regulation = 0.8 × (0.9806 × 0.85 + 4.9029 × 0.5268) = 2.733 %
    expect(transformer(1000, 415, 5).flc).toBeCloseTo(1391.2, 1);
    expect(transformer(1000, 415, 5).faultKA).toBeCloseTo(29.22, 2);
    const p = project([]);
    const c = transformerChecks(p, p.boards[0], 1000, 800, 0.85, 5);
    expect(c.flcA).toBeCloseTo(1391.2, 1);
    expect(c.faultKa).toBeCloseTo(29.22, 2);
    expect(c.regulationPct).toBeCloseTo(2.733, 3);
  });
});
