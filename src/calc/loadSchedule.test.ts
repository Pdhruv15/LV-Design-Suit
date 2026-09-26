import { describe, expect, it } from 'vitest';
import { boardPhaseKw, circuitCategory, circuitRef, circuitWatts, elcbGroups, imbalancePct, missingWatts, nextFreeSlot, scheduleCircuits } from './loadSchedule';
import { designCurrentA, evaluateFeeder } from './electrical';
import { addCircuit, balancePhases, deleteCircuit, updateCircuit } from '../model/schedule';
import type { Feeder, Project } from '../types';

const U0 = 415 / Math.sqrt(3);

function base(): Project {
  return {
    name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
    boards: [
      { id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 },
      {
        id: 'DB', name: 'Villa DB', upstreamId: 'MDB', ratedCurrentA: 100,
        pointWatts: { ltg: 100, cfan: 80, exfan: 40, shaver: 20, s13: 250, wh: 3000, hd: 1800, cooker: 6000, s15: 1000, wac: 2000, sac: 2500, pump: 750 }
      }
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
  it('load = points × watts per point; auto-sizes MCB, wire at least the lighting minimum', () => {
    const p = withCircuit(base(), { ltg: 8, cfan: 2 }); // 8×100 + 2×80 = 960 W
    const f = p.feeders.find((x) => x.id === 'DB-R1')!;
    expect(circuitWatts(f, p.boards[1])).toBe(960);
    expect(f.loadKw).toBeCloseTo(0.96, 9);
    expect(f.loadType).toBe('lighting');
    expect(circuitCategory(f)).toBe('lighting');
    // Ib = 960 / (239.6 × 0.9) = 4.45 A → In ≥ 5.2 A → 6 A MCB; wire raised to the 2.5 mm² lighting minimum
    expect(f.breakerRatingA).toBe(6);
    expect(f.cableCsaMm2).toBe(2.5);
    expect(evaluateFeeder(p, f).status).toBe('ok');
  });

  it('power circuits get at least the 4 mm² power minimum', () => {
    const p = withCircuit(base(), { s13: 2, ltg: 1 }); // any non-lighting point → power
    const f = p.feeders.find((x) => x.id === 'DB-R1')!;
    expect(circuitCategory(f)).toBe('power');
    expect(f.cableCsaMm2).toBe(4);
  });

  it('project settings change the minimums', () => {
    const p0 = { ...base(), studySettings: { minWirePowerMm2: 6 } };
    const f = withCircuit(p0, { s13: 1 }).feeders.find((x) => x.id === 'DB-R1')!;
    expect(f.cableCsaMm2).toBe(6);
  });

  it('flags point types used with no WATT/UNIT entered', () => {
    const p0 = base();
    p0.boards[1].pointWatts = { ltg: 100 };
    const p = withCircuit(withCircuit(p0, { ltg: 2 }), { s13: 3, wh: 1 });
    expect(missingWatts(p, p.boards[1])).toEqual(['s13', 'wh']);
    expect(p.feeders.find((x) => x.id === 'DB-Y1')!.loadKw).toBe(0);
  });

  it('respects watts-per-point overrides on the board', () => {
    const p0 = base();
    p0.boards[1].pointWatts = { ...p0.boards[1].pointWatts, ltg: 36 };
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
    expect(g[0].category).toBe('power');
    expect(g[0].label).toBe('25 A 30 mA 4P'); // power → 30 mA
  });

  it('an all-lighting group gets a 100 mA ELCB; a board override wins', () => {
    let p = base();
    for (let i = 0; i < 3; i++) p = withCircuit(p, { ltg: 5 });
    expect(elcbGroups(p, p.boards[1])[0]).toMatchObject({ category: 'lighting', sensitivityMa: 100 });
    expect(elcbGroups(p, { ...p.boards[1], elcbSensitivityMa: 30 })[0].sensitivityMa).toBe(30);
  });

  it('balancing puts lighting first and starts power on an ELCB boundary, so no ELCB mixes them', () => {
    let p = base();
    // 4 power + 2 lighting circuits, entered mixed together
    for (const pts of [{ s13: 4 }, { ltg: 6 }, { wh: 1 }, { ltg: 8 }, { sac: 1 }, { s13: 6 }]) p = withCircuit(p, pts);
    expect(elcbGroups(p, p.boards[1])[0].category).toBe('mixed');
    p = balancePhases(p, 'DB');
    const groups = elcbGroups(p, p.boards[1]);
    expect(groups.map((g) => g.category)).toEqual(['lighting', 'power']);
    expect(groups.map((g) => g.sensitivityMa)).toEqual([100, 30]);
    // Lighting uses way 1 only; ways 1-2 are its ELCB section, so power starts at way 3.
    const refs = scheduleCircuits(p, 'DB').map((f) => `${circuitRef(f)}:${circuitCategory(f)[0]}`);
    expect(refs.filter((r) => r.endsWith(':l')).every((r) => /[RYB]1:/.test(r))).toBe(true);
    expect(Math.min(...scheduleCircuits(p, 'DB').filter((f) => circuitCategory(f) === 'power').map((f) => f.way!))).toBe(3);
  });

  it('3 per group gives one ELCB per way; 0 gives none', () => {
    const p = sixCircuits();
    expect(elcbGroups(p, { ...p.boards[1], elcbGroupSize: 3 }).map((g) => g.ways)).toEqual([[1], [2]]);
    expect(elcbGroups(p, { ...p.boards[1], elcbGroupSize: 0 })).toEqual([]);
  });
});
