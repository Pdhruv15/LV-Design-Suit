import { describe, expect, it } from 'vitest';
import {
  cableImpedance,
  designCurrentA,
  evaluateFeeder,
  faultCurrentKA,
  impedanceToBoard,
  selectCable,
  transformerImpedance,
  upstreamVoltageDropPct,
  voltageDropPct,
  zMagnitude
} from './electrical';
import type { Feeder, Project } from '../types';

const SQRT3 = Math.sqrt(3);

function project(feeders: Feeder[], extraBoards: Project['boards'] = []): Project {
  return {
    name: 'Test',
    voltageV: 415,
    frequencyHz: 50,
    ambientC: 45,
    vdLimitPct: 4,
    boards: [{ id: 'MDB', name: 'Main', sourceKva: 1000, sourceImpedancePct: 5 }, ...extraBoards],
    feeders,
    updatedAt: ''
  };
}

function feeder(over: Partial<Feeder>): Feeder {
  return {
    id: 'F1', boardId: 'MDB', name: 'Feeder', loadKw: 50, demandFactor: 1, powerFactor: 0.85,
    lengthM: 50, cableCsaMm2: 50, cores: 4, breakerRatingA: 100, breakerIcuKa: 50, ...over
  };
}

// Load (kW) that draws exactly `amps` on a balanced 415 V circuit.
const kwFor = (amps: number, pf: number) => (SQRT3 * 415 * amps * pf) / 1000;

describe('design current', () => {
  it('matches P / (√3 · U · cosφ)', () => {
    const p = project([]);
    // 100 kW, pf 0.85, 415 V → 163.7 A
    expect(designCurrentA(feeder({ loadKw: 100 }), p)).toBeCloseTo(163.68, 1);
  });

  it('incomer takes the downstream board demand, ignoring its own loadKw', () => {
    const incomer = feeder({ id: 'INC', loadKw: 999, feedsBoardId: 'SMDB' });
    const load = feeder({ id: 'L', boardId: 'SMDB', loadKw: 80, demandFactor: 0.5 });
    const p = project([incomer, load], [{ id: 'SMDB', name: 'Sub', upstreamId: 'MDB' }]);
    expect(designCurrentA(incomer, p)).toBeCloseTo((40 * 1000) / (SQRT3 * 415 * 0.85), 6);
  });
});

describe('transformer and fault level', () => {
  it('1000 kVA, 5% at 415 V → |Z| = 8.61 mΩ, Ik ≈ 27.8 kA', () => {
    const z = transformerImpedance(1000, 5, 415);
    expect(zMagnitude(z)).toBeCloseTo(0.00861125, 8);
    expect(z.x / z.r).toBeCloseTo(5, 9);
    expect(faultCurrentKA(z, 415)).toBeCloseTo(27.82, 2);
  });

  it('adds cable impedance to the transformer as R+jX phasors', () => {
    const incomer = feeder({ id: 'INC', feedsBoardId: 'SMDB', cableCsaMm2: 95, lengthM: 60 });
    const p = project([incomer], [{ id: 'SMDB', name: 'Sub', upstreamId: 'MDB' }]);
    const zt = transformerImpedance(1000, 5, 415);
    const zc = cableImpedance(95, 60);
    const z = impedanceToBoard(p, 'SMDB');
    expect(z.r).toBeCloseTo(zt.r + zc.r, 12);
    expect(z.x).toBeCloseTo(zt.x + zc.x, 12);
    // Phasor sum is never larger than the old scalar sum.
    expect(zMagnitude(z)).toBeLessThan(zMagnitude(zt) + zMagnitude(zc));
  });

  it('checks breaker Icu against the fault at its own busbar, not the cable end', () => {
    // 25 kA breaker on a long feeder: fault at the cable end is well below
    // 25 kA, but the busbar sees ~27.8 kA, so the breaker is underrated.
    const f = feeder({ lengthM: 150, breakerIcuKa: 25 });
    const r = evaluateFeeder(project([f]), f);
    expect(r.breakerFaultKA).toBeCloseTo(27.82, 1);
    expect(r.endFaultKA).toBeLessThan(25);
    expect(r.icuStatus).toBe('bad');
    expect(r.status).toBe('bad');
  });
});

describe('single-phase end fault', () => {
  it('flows through phase + neutral (2 × cable Z)', () => {
    // 2.5 mm², 25 m: cable R = 8.892 × 0.025 = 0.2223 Ω, X = 0.0025 Ω per conductor.
    const f = feeder({ loadKw: 3, cores: 2, cableCsaMm2: 2.5, lengthM: 25, breakerRatingA: 20, breakerIcuKa: 10 });
    const zt = transformerImpedance(1000, 5, 415);
    const z = { r: zt.r + 2 * 0.2223, x: zt.x + 2 * 0.0025 };
    const expected = 415 / SQRT3 / zMagnitude(z) / 1000; // ≈ 0.53 kA
    expect(evaluateFeeder(project([f]), f).endFaultKA).toBeCloseTo(expected, 3);
  });
});

describe('voltage drop', () => {
  it('3-phase: √3 · I · L · (R cosφ + X sinφ)', () => {
    // 100 A at unity pf over 100 m of 50 mm²: R = 0.387 × 1.2 = 0.4644 Ω/km
    // → 8.044 V → 1.938 % of 415 V.
    const f = feeder({ loadKw: kwFor(100, 1), powerFactor: 1, lengthM: 100, cableCsaMm2: 50 });
    expect(voltageDropPct(f, project([f]))).toBeCloseTo(1.938, 3);
  });

  it('single-phase (2-core): current on U0, 2·I·Z loop drop against U0', () => {
    // 3 kW at unity pf on 239.6 V → 12.52 A; over 25 m of 2.5 mm²
    // (R = 7.41 × 1.2 = 8.892 Ω/km): 2 × 12.52 × 0.025 × 8.892 = 5.567 V
    // → 2.323 % of 239.6 V.
    const f = feeder({ loadKw: 3, powerFactor: 1, cores: 2, cableCsaMm2: 2.5, lengthM: 25 });
    const p = project([f]);
    expect(designCurrentA(f, p)).toBeCloseTo(3000 / (415 / SQRT3), 9);
    expect(voltageDropPct(f, p)).toBeCloseTo(2.323, 3);
  });

  it('adds the incomer drop to feeders on a sub-board', () => {
    const incomer = feeder({ id: 'INC', feedsBoardId: 'SMDB', cableCsaMm2: 70, lengthM: 80 });
    const final = feeder({ id: 'FIN', boardId: 'SMDB', loadKw: 60, cableCsaMm2: 25, lengthM: 40, breakerRatingA: 100 });
    const onMain = feeder({ id: 'MAIN', loadKw: 20, cableCsaMm2: 16, breakerRatingA: 63 });
    const p = project([incomer, final, onMain], [{ id: 'SMDB', name: 'Sub', upstreamId: 'MDB' }]);

    expect(upstreamVoltageDropPct(p, 'MDB')).toBe(0);
    expect(upstreamVoltageDropPct(p, 'SMDB')).toBeCloseTo(voltageDropPct(incomer, p), 12);

    const r = evaluateFeeder(p, final);
    expect(r.vdUpstreamPct).toBeGreaterThan(0);
    expect(r.vdTotalPct).toBeCloseTo(voltageDropPct(incomer, p) + voltageDropPct(final, p), 12);
    expect(evaluateFeeder(p, onMain).vdUpstreamPct).toBe(0);
  });

  it('fails a feeder whose own drop is fine but total drop exceeds the limit', () => {
    const incomer = feeder({ id: 'INC', feedsBoardId: 'SMDB', cableCsaMm2: 35, lengthM: 200, breakerRatingA: 125 });
    const final = feeder({ id: 'FIN', boardId: 'SMDB', loadKw: 55, cableCsaMm2: 35, lengthM: 90, breakerRatingA: 125 });
    const p = project([incomer, final], [{ id: 'SMDB', name: 'Sub', upstreamId: 'MDB' }]);
    const r = evaluateFeeder(p, final);
    expect(r.vdPct).toBeLessThan(p.vdLimitPct);
    expect(r.vdTotalPct).toBeGreaterThan(p.vdLimitPct);
    expect(r.vdStatus).toBe('bad');
  });
});

describe('overload protection Ib ≤ In ≤ Iz', () => {
  it('fails when the breaker is larger than the cable rating, even at light load', () => {
    // 50 mm² at 45 °C: Iz = 200 × 0.87 = 174 A < 250 A breaker.
    const f = feeder({ loadKw: 20, cableCsaMm2: 50, breakerRatingA: 250 });
    const r = evaluateFeeder(project([f]), f);
    expect(r.ampacity).toBeCloseTo(174, 6);
    expect(r.ampacityStatus).toBe('ok'); // Iz ≥ Ib on its own passes...
    expect(r.protectionStatus).toBe('bad'); // ...but the cable isn't protected
    expect(r.status).toBe('bad');
  });

  it('passes a correctly coordinated circuit', () => {
    const f = feeder({ loadKw: 50, cableCsaMm2: 50, breakerRatingA: 125, lengthM: 30 });
    const r = evaluateFeeder(project([f]), f);
    expect(r.protectionStatus).toBe('ok');
    expect(r.status).toBe('ok');
  });
});

describe('cable selection', () => {
  it('sizes for the breaker rating, not just the design current', () => {
    expect(selectCable(50, 10, 415, 4, 0.85, 45, 4)).toBe(6); // Iz 60 × 0.87 = 52.2 A ≥ 50 A
    expect(selectCable(50, 10, 415, 4, 0.85, 45, 4, 160)).toBe(50); // needs Iz ≥ 160 A → 174 A
  });

  it('picks a larger cable when less voltage-drop budget is left', () => {
    const full = selectCable(100, 120, 415, 4, 0.85, 45, 4)!;
    const tight = selectCable(100, 120, 415, 4, 0.85, 45, 1.5)!;
    expect(tight).toBeGreaterThan(full);
  });

  it('returns null when nothing fits', () => {
    expect(selectCable(500, 2000, 415, 4, 0.85, 45, 4)).toBeNull();
  });
});
