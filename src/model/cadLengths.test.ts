import { describe, expect, it } from 'vitest';
import { applyCadLengths, lengthBreakdown, metresPerUnit, pullCadLengths } from './cadLengths';
import type { Project } from '../types';

function project(extra: Partial<Project> = {}): Project {
  const cable = { demandFactor: 1, powerFactor: 0.9, cableCsaMm2: 35, cores: 4 as const, breakerRatingA: 100, breakerIcuKa: 36, loadKw: 10 };
  return {
    name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
    boards: [{ id: 'MDB-1', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 }, { id: 'SMDB-GF', name: 'S', upstreamId: 'MDB-1' }],
    feeders: [
      { ...cable, id: 'F1', boardId: 'MDB-1', name: 'To SMDB-GF', lengthM: 42, feedsBoardId: 'SMDB-GF' },
      { ...cable, id: 'F2', boardId: 'MDB-1', name: 'Chiller', lengthM: 61, cadVerticalM: 12 },
      { ...cable, id: 'F3', boardId: 'MDB-1', name: 'Pump', lengthM: 20, lengthToCheck: true }
    ],
    ...extra
  };
}

describe('cable lengths from the CAD floor plan', () => {
  it('converts drawing units from INSUNITS, else from the project setting', () => {
    expect(metresPerUnit(4, undefined)).toEqual({ factor: 0.001, source: 'drawing in mm' });
    expect(metresPerUnit(6, { units: 'mm' }).factor).toBe(1);
    expect(metresPerUnit(1, undefined).factor).toBeCloseTo(0.0254);
    expect(metresPerUnit(0, { units: 'cm' })).toEqual({ factor: 0.01, source: 'drawing units not set; taken as cm' });
    expect(metresPerUnit(undefined, undefined).factor).toBe(0.001);
  });

  it('adds vertical, terminations and waste, rounds up to a metre, and uses a feeder’s own vertical', () => {
    const pull = pullCadLengths(project(), [
      { feederId: 'F1', length: 48200, pieces: 3 }, // 48.2 + 6 + 3 = 57.2 × 1.05 = 60.06 → 61
      { feederId: 'F2', length: 40000, pieces: 1 }, // 40 + 12 + 3 = 55 × 1.05 = 57.75 → 58
      { feederId: 'GONE', length: 1000, pieces: 1 }
    ], 4);
    expect(pull.units).toBe('drawing in mm');
    expect(pull.unknownFeeders).toEqual(['GONE']);
    expect(pull.proposals.map((p) => [p.label, p.currentM, p.proposedM])).toEqual([['MDB-1 → SMDB-GF', 42, 61], ['MDB-1 Chiller', 61, 58]]);
    expect(lengthBreakdown(pull.proposals[0])).toBe('48.2 m route + 6 m vertical + 3 m terminations, +5 % = 61 m');
  });

  it('uses the project allowances and counts unchanged lengths as matching, unless the length is flagged to check', () => {
    const p = project({ cadLength: { verticalM: 0, terminationM: 0, wastePct: 0 } });
    const pull = pullCadLengths(p, [{ feederId: 'F1', length: 42, pieces: 1 }, { feederId: 'F3', length: 20, pieces: 1 }], 6);
    expect(pull.matching).toBe(1); // F1: 42 m exactly
    expect(pull.proposals.map((x) => [x.feederId, x.proposedM])).toEqual([['F3', 20]]); // same length, but flagged to check
  });

  it('applies accepted lengths and clears the length-to-check flag only on them', () => {
    const p = project();
    const pull = pullCadLengths(p, [{ feederId: 'F1', length: 48200, pieces: 1 }, { feederId: 'F3', length: 10000, pieces: 1 }], 4);
    const next = applyCadLengths(p, pull.proposals.filter((x) => x.feederId === 'F3'));
    expect(next.feeders.map((f) => [f.id, f.lengthM, f.lengthToCheck])).toEqual([['F1', 42, undefined], ['F2', 61, undefined], ['F3', 20, undefined]]); // (10 + 6 + 3) × 1.05 = 19.95 → 20
    expect(next.feeders[0]).toBe(p.feeders[0]); // untouched feeders are the same objects
  });
});
