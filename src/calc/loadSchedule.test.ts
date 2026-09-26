import { describe, expect, it } from 'vitest';
import { boardPhaseKw, circuitRef, circuitWatts, elcbGroups, imbalancePct, nextFreeSlot, scheduleCircuits } from './loadSchedule';
import { designCurrentA, evaluateFeeder } from './electrical';
import { addCircuit, balancePhases, deleteCircuit, updateCircuit } from '../model/schedule';
import type { Feeder, Project } from '../types';

const U0 = 415 / Math.sqrt(3);

function base(): Project {
  return {
    name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
    boards: [
      { id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 },
      { id: 'DB', name: 'Villa DB', upstreamId: 'MDB', ratedCurrentA: 100 }
    ],
    feeders: [
      { id: 'INC', boardId: 'MDB', name: 'Incomer', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 35, cores: 4, breakerRatingA: 100, breakerIcuKa: 36, feedsBoardId: 'DB' }
    ]
  };
}

/** Adds a circuit with the given points and returns the new project. */
function withCircuit(p: Project, points: Feeder['points'], phase?: Feeder['phase']): Project {
  const r = addCircuit(p, 'DB', phase);
  return updateCircuit(r.project, r.id, { points });
}

describe('circuit references and slots', () => {
  it('fills R1, Y1, B1, R2 … and 3-phase circuits take a whole way', () => {
    let p = base();
    const refs: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = addCircuit(p, 'DB');
      p = r.project;
      refs.push(circuitRef(p.feeders.find((f) => f.id === r.id)!)!);
    }
    expect(refs).toEqual(['R1', 'Y1', 'B1', 'R2']);
    expect(nextFreeSlot(p, 'DB', 'RYB')).toEqual({ phase: 'RYB', way: 3 }); // way 2 has R2 taken
    const r = addCircuit(p, 'DB', 'RYB');
    expect(r.id).toBe('DB-RYB3');
    expect(nextFreeSlot(r.project, 'DB')).toEqual({ phase: 'Y', way: 2 });
  });
});

describe('circuit load and sizing', () => {
  it('load = points × watts per point; auto-sizes MCB and wire', () => {
    const p = withCircuit(base(), { ltg: 8, cfan: 2 }); // 8×100 + 2×80 = 960 W
    const f = p.feeders.find((x) => x.id === 'DB-R1')!;
    expect(circuitWatts(f, p.boards[1])).toBe(960);
    expect(f.loadKw).toBeCloseTo(0.96, 9);
    expect(f.loadType).toBe('lighting');
    // Ib = 960 / (239.6 × 0.9) = 4.45 A → In ≥ 5.2 A → 6 A MCB
    expect(f.breakerRatingA).toBe(6);
    expect(evaluateFeeder(p, f).status).toBe('ok');
  });

  it('respects watts-per-point overrides on the board', () => {
    const p0 = base();
    p0.boards[1].pointWatts = { ltg: 36 };
    const p = withCircuit(p0, { ltg: 10 });
    expect(p.feeders.find((x) => x.id === 'DB-R1')!.loadKw).toBeCloseTo(0.36, 9);
  });

  it('keeps hand-set sizes when the load changes', () => {
    let p = withCircuit(base(), { s13: 4 });
    p = updateCircuit(p, 'DB-R1', { breakerRatingA: 20, cableCsaMm2: 4 });
    p = updateCircuit(p, 'DB-R1', { points: { s13: 6 } });
    const f = p.feeders.find((x) => x.id === 'DB-R1')!;
    expect([f.manualSize, f.breakerRatingA, f.cableCsaMm2, f.loadKw]).toEqual([true, 20, 4, 1.5]);
  });

  it('deletes a circuit', () => {
    const p = deleteCircuit(withCircuit(base(), { ltg: 1 }), 'DB-R1');
    expect(scheduleCircuits(p, 'DB')).toHaveLength(0);
  });
});

describe('phase loads and the incomer', () => {
  it('sums each phase and sizes the incomer for the most loaded phase', () => {
    let p = withCircuit(base(), { wh: 1 }); // R1: 3 kW
    p = withCircuit(p, { s13: 4 }); // Y1: 1 kW
    p = withCircuit(p, { pump: 3 }, 'RYB'); // RYB2: 2.25 kW → 0.75 per phase
    const ph = boardPhaseKw(p, 'DB');
    expect(ph.R).toBeCloseTo(3.75, 9);
    expect(ph.Y).toBeCloseTo(1.75, 9);
    expect(ph.B).toBeCloseTo(0.75, 9);
    expect(imbalancePct(ph)).toBeCloseTo(((3.75 - 0.75) / (6.25 / 3)) * 100, 9);
    const inc = p.feeders.find((f) => f.id === 'INC')!;
    expect(designCurrentA(inc, p)).toBeCloseTo(3750 / (U0 * 0.9), 9);
  });

  it('balancing moves circuits so the heaviest phase drops, and renames references', () => {
    let p = base();
    for (const pts of [{ wh: 1 }, { wh: 1 }, { wh: 1 }]) p = withCircuit(p, pts, 'R'); // all on R
    expect(boardPhaseKw(p, 'DB').R).toBeCloseTo(9, 9);
    p = balancePhases(p, 'DB');
    const ph = boardPhaseKw(p, 'DB');
    expect([ph.R, ph.Y, ph.B].map((x) => +x.toFixed(6))).toEqual([3, 3, 3]);
    expect(scheduleCircuits(p, 'DB').map((f) => f.id)).toEqual(['DB-R1', 'DB-Y1', 'DB-B1']);
  });
});

describe('ELCB groups', () => {
  function sixCircuits(): Project {
    let p = base();
    for (let i = 0; i < 6; i++) p = withCircuit(p, { s13: 4 }); // R1 Y1 B1 R2 Y2 B2, 1 kW each
    return p;
  }

  it('default: one ELCB per 6 circuits (two ways)', () => {
    const g = elcbGroups(sixCircuits(), base().boards[1]);
    expect(g).toHaveLength(1);
    expect(g[0].ways).toEqual([1, 2]);
    expect(g[0].circuits.map(circuitRef)).toEqual(['R1', 'Y1', 'B1', 'R2', 'Y2', 'B2']);
    expect(g[0].maxPhaseA).toBeCloseTo(2000 / (U0 * 0.9), 9); // 2 kW per phase
    expect(g[0].ratingA).toBe(25);
    expect(g[0].label).toBe('25 A 30 mA 4P');
  });

  it('3 per group gives one ELCB per way; 0 gives none', () => {
    const p = sixCircuits();
    expect(elcbGroups(p, { ...p.boards[1], elcbGroupSize: 3 }).map((g) => g.ways)).toEqual([[1], [2]]);
    expect(elcbGroups(p, { ...p.boards[1], elcbGroupSize: 0 })).toEqual([]);
  });
});
