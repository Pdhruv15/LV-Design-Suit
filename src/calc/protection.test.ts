import { describe, expect, it } from 'vitest';
import { evaluateSelectivity, genericTripTimeS, instantaneousNoTripA } from './protection';
import type { Feeder, Project } from '../types';

function feeder(over: Partial<Feeder>): Feeder {
  return {
    id: 'F', boardId: 'SUB', name: 'F', loadKw: 10, demandFactor: 1, powerFactor: 0.9, lengthM: 20,
    cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 25, ...over
  };
}

const project = (feeders: Feeder[], incomerLength = 60): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [
    { id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 },
    { id: 'SUB', name: 'S', upstreamId: 'MDB' }
  ],
  feeders: [
    feeder({ id: 'INC', boardId: 'MDB', feedsBoardId: 'SUB', breakerRatingA: 250, cableCsaMm2: 95, lengthM: incomerLength, breakerIcuKa: 36 }),
    ...feeders
  ]
});

describe('trip thresholds', () => {
  it('magnetic no-trip edge: 3/5/10 In for MCB B/C/D, 0.8 Im for MCCB', () => {
    expect(instantaneousNoTripA(feeder({ breakerType: 'B', breakerRatingA: 20 }))).toBe(60);
    expect(instantaneousNoTripA(feeder({ breakerRatingA: 32 }))).toBe(160);
    expect(instantaneousNoTripA(feeder({ breakerType: 'D', breakerRatingA: 32 }))).toBe(320);
    expect(instantaneousNoTripA(feeder({ breakerRatingA: 250 }))).toBe(2000);
  });

  it('generic curve: no trip ≤ 1.05 In, inverse-time above, 20 ms once magnetic', () => {
    const f = feeder({ breakerRatingA: 100, breakerType: 'MCCB' }); // Im = 1000 A
    expect(genericTripTimeS(f, 100)).toBe(Infinity);
    expect(genericTripTimeS(f, 300)).toBeCloseTo(500 / 8, 9);
    expect(genericTripTimeS(f, 200)).toBeGreaterThan(genericTripTimeS(f, 300));
    expect(genericTripTimeS(f, 1000)).toBe(0.02);
  });
});

describe('selectivity', () => {
  it('total when the upstream magnetic threshold exceeds the downstream fault level', () => {
    // Long incomer → low fault at SUB; 250 A MCCB no-trip edge = 2 kA
    const r = evaluateSelectivity(project([feeder({ id: 'D1', breakerRatingA: 63 })], 600))[0];
    expect(r.ratio).toBeCloseTo(250 / 63, 9);
    expect(r.ratioOk).toBe(true);
    expect(r.faultKA).toBeLessThan(2);
    expect(r.shortCircuit).toBe('total');
    expect(r.status).toBe('ok');
  });

  it('partial when the downstream fault exceeds the upstream threshold', () => {
    const r = evaluateSelectivity(project([feeder({ id: 'D1', breakerRatingA: 63 })], 20))[0];
    expect(r.faultKA).toBeGreaterThan(2);
    expect(r.shortCircuit).toBe('partial');
    expect(r.limitKA).toBe(2);
    expect(r.status).toBe('warn');
  });

  it('fails when the downstream breaker is as large as the upstream one', () => {
    const r = evaluateSelectivity(project([feeder({ id: 'D1', breakerRatingA: 250 })]))[0];
    expect(r.ratioOk).toBe(false);
    expect(r.status).toBe('bad');
  });
});
