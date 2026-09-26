import { describe, expect, it } from 'vitest';
import { defaultCpcMm2, earthLoopToBoard, evaluateEarthing, instantaneousTripA, requiredDisconnectionS } from './earthing';
import { transformerImpedance, zMagnitude } from './electrical';
import type { Feeder, Project } from '../types';

const U0 = 415 / Math.sqrt(3);

function feeder(over: Partial<Feeder>): Feeder {
  return {
    id: 'F', boardId: 'MDB', name: 'F', loadKw: 5, demandFactor: 1, powerFactor: 0.9, lengthM: 50,
    cableCsaMm2: 4, cores: 4, breakerRatingA: 32, breakerIcuKa: 36, ...over
  };
}

const project = (feeders: Feeder[]): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [
    { id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 },
    { id: 'SUB', name: 'S', upstreamId: 'MDB' }
  ],
  feeders
});

describe('protective conductor size (IEC 60364-5-54 Table 54.2)', () => {
  it('follows S / 16 / S÷2', () => {
    expect(defaultCpcMm2(10)).toBe(10);
    expect(defaultCpcMm2(16)).toBe(16);
    expect(defaultCpcMm2(25)).toBe(16);
    expect(defaultCpcMm2(35)).toBe(16);
    expect(defaultCpcMm2(95)).toBe(50); // 47.5 → next standard 50
    expect(defaultCpcMm2(240)).toBe(120);
  });
});

describe('trip thresholds and required times', () => {
  it('uses the top of the magnetic band for MCBs and the Im setting for MCCBs', () => {
    expect(instantaneousTripA(feeder({ breakerType: 'B', breakerRatingA: 20 }))).toBe(100);
    expect(instantaneousTripA(feeder({ breakerRatingA: 32 }))).toBe(320); // defaults to type C
    expect(instantaneousTripA(feeder({ breakerRatingA: 250 }))).toBe(2500); // defaults to MCCB, 10 In
    expect(instantaneousTripA(feeder({ breakerRatingA: 250, breakerImMultiple: 6 }))).toBe(1500);
  });

  it('0.4 s for final circuits ≤ 63 A, 5 s otherwise', () => {
    expect(requiredDisconnectionS(feeder({ breakerRatingA: 32 }))).toBe(0.4);
    expect(requiredDisconnectionS(feeder({ breakerRatingA: 100 }))).toBe(5);
    expect(requiredDisconnectionS(feeder({ breakerRatingA: 32, feedsBoardId: 'SUB' }))).toBe(5);
  });
});

describe('earth fault loop', () => {
  it('Zs = transformer + (R1 + R2) of the circuit; If = 0.95 U0 / Zs', () => {
    // 4 mm² with 4 mm² CPC, 50 m: R1+R2 = 2 × 4.61 × 1.2 × 0.05 = 0.5532 Ω, X = 0.0045 Ω
    const f = feeder({});
    const r = evaluateEarthing(project([f]), f);
    const zt = transformerImpedance(1000, 5, 415);
    const zs = Math.hypot(zt.r + 0.5532, zt.x + 0.0045);
    expect(r.cpcMm2).toBe(4);
    expect(r.zsOhm).toBeCloseTo(zs, 6);
    expect(r.faultA).toBeCloseTo((0.95 * U0) / zs, 3); // ≈ 390 A
    expect(r.tripA).toBe(320);
    expect(r.disconnection).toBe('ok'); // 390 A ≥ 320 A → instantaneous
    expect(r.maxZsOhm).toBeCloseTo((0.95 * U0) / 320, 9);
  });

  it('fails a long 0.4 s circuit that no longer reaches the magnetic trip', () => {
    const f = feeder({ lengthM: 120 });
    const r = evaluateEarthing(project([f]), f);
    expect(r.faultA).toBeLessThan(r.tripA);
    expect(r.disconnection).toBe('bad');
    expect(r.status).toBe('bad');
  });

  it('only warns for a 5 s circuit relying on the thermal region', () => {
    const f = feeder({ breakerRatingA: 100, cableCsaMm2: 35, lengthM: 400 });
    const r = evaluateEarthing(project([f]), f);
    expect(r.faultA).toBeLessThan(r.tripA);
    expect(r.disconnection).toBe('warn');
  });

  it('adds each incomer loop (phase + CPC) for sub-boards', () => {
    const inc = feeder({ id: 'INC', feedsBoardId: 'SUB', cableCsaMm2: 95, lengthM: 100, breakerRatingA: 250 });
    const p = project([inc]);
    const main = earthLoopToBoard(p, 'MDB');
    const sub = earthLoopToBoard(p, 'SUB');
    // 95 mm² phase (0.193) + 50 mm² CPC (0.387), × 1.2, × 0.1 km
    expect(sub.r - main.r).toBeCloseTo((0.193 + 0.387) * 1.2 * 0.1, 9);
    expect(zMagnitude(sub)).toBeGreaterThan(zMagnitude(main));
  });

  it('adiabatic check: S ≥ If·√t / 143', () => {
    const f = feeder({ cableCsaMm2: 1.5, lengthM: 2, breakerRatingA: 16 });
    const r = evaluateEarthing(project([f]), f);
    expect(r.adiabaticMinMm2).toBeCloseTo((r.faultA * Math.sqrt(0.1)) / 143, 9);
    expect(r.adiabatic).toBe(r.cpcMm2 >= r.adiabaticMinMm2 ? 'ok' : 'bad');
  });
});
