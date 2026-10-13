import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { boardPhaseKw } from '../calc/loadSchedule';
import { phaseBalance } from '../calc/phaseBalance';
import type { Feeder, Project } from '../types';
import { balanceBoardPhases, feederPhaseKw, nextPhase, phaseTag, setCircuitPhase } from './phases';

const f = (id: string) => sampleProject.feeders.find((x) => x.id === id)!;

describe('phase tags and per-circuit phase load', () => {
  it('tags single-phase circuits by phase, 3-phase and incomers as RYB, and an unset 2-core feeder as blank', () => {
    expect(phaseTag(f('DB-GF1-Y1'))).toBe('Y');
    const incomer = sampleProject.feeders.find((x) => x.feedsBoardId)!;
    expect(phaseTag(incomer)).toBe('RYB');
    expect(phaseTag({ ...f('DB-GF1-Y1'), phase: undefined })).toBe('');
    expect(nextPhase('R')).toBe('Y');
    expect(nextPhase('B')).toBe('R');
    expect(nextPhase('')).toBe('R');
  });
  it('puts a single-phase load on its phase and spreads a 3-phase load evenly', () => {
    const k = feederPhaseKw(sampleProject, f('DB-GF1-R3'));
    expect(k).toEqual({ R: 6, Y: 0, B: 0 });
    const three: Feeder = { ...f('DB-GF1-R3'), cores: 4, phase: 'RYB', loadKw: 9 };
    expect(feederPhaseKw(sampleProject, three).Y).toBeCloseTo(3, 6);
  });
  it('an incomer carries the phase loads of the board it feeds, and the circuits add up to the board', () => {
    const incomer = sampleProject.feeders.find((x) => x.feedsBoardId === 'DB-GF1')!;
    const k = feederPhaseKw(sampleProject, incomer), sub = boardPhaseKw(sampleProject, 'DB-GF1');
    for (const p of ['R', 'Y', 'B'] as const) expect(k[p]).toBeCloseTo(sub[p], 6);
    const own = sampleProject.feeders.filter((x) => x.boardId === 'DB-GF1').reduce((s, x) => s + feederPhaseKw(sampleProject, x).R, 0);
    expect(own).toBeCloseTo(sub.R, 6);
  });
});

describe('moving a circuit to another phase', () => {
  it('moves a load-schedule circuit to the first free way on that phase and renames it', () => {
    const r = setCircuitPhase(sampleProject, 'DB-GF1-Y1', 'B');
    const moved = r.project.feeders.find((x) => x.id === r.id)!;
    expect(r.id).toMatch(/^DB-GF1-B\d+$/);
    expect(moved.phase).toBe('B');
    expect(moved.name).toBe('Majlis lighting');
    expect(r.project.feeders.some((x) => x.id === 'DB-GF1-Y1')).toBe(false);
    expect(r.project.feeders).toHaveLength(sampleProject.feeders.length);
  });
  it('sets the phase of a single-phase feeder that is not on a schedule, keeping its id', () => {
    const p: Project = { ...sampleProject, feeders: [...sampleProject.feeders, { ...f('DB-GF1-R3'), id: 'X1', way: undefined, phase: undefined }] };
    const r = setCircuitPhase(p, 'X1', 'Y');
    expect(r.id).toBe('X1');
    expect(r.project.feeders.find((x) => x.id === 'X1')!.phase).toBe('Y');
  });
  it('leaves 3-phase circuits and incomers alone', () => {
    const incomer = sampleProject.feeders.find((x) => x.feedsBoardId)!;
    expect(setCircuitPhase(sampleProject, incomer.id, 'R').project).toBe(sampleProject);
  });
});

describe('balancing a board', () => {
  it('does not make a board less balanced, and assigns every single-phase feeder a phase', () => {
    // Pile every DB-GF1 circuit on R, plus two unlabelled single-phase feeders.
    const piled: Project = {
      ...sampleProject,
      feeders: [
        ...sampleProject.feeders.map((x) => (x.boardId === 'DB-GF1' && x.cores === 2 ? { ...x, phase: 'R' as const } : x)),
        { ...f('DB-GF1-R3'), id: 'X1', way: undefined, phase: undefined, loadKw: 4 },
        { ...f('DB-GF1-R3'), id: 'X2', way: undefined, phase: undefined, loadKw: 2 }
      ]
    };
    const before = phaseBalance(piled, 'DB-GF1').unbalancePct;
    const p = balanceBoardPhases(piled, 'DB-GF1');
    const after = phaseBalance(p, 'DB-GF1');
    expect(after.unbalancePct).toBeLessThan(before);
    // 4 kW and 2 kW on top of a balanced DB cannot all even out; the greedy split is within ~1 kW of the best.
    expect(after.unbalancePct).toBeLessThan(before / 5);
    expect(Math.max(...Object.values(after.kw)) - Math.min(...Object.values(after.kw))).toBeLessThan(3.5);
    expect(after.unassigned).toHaveLength(0);
    expect(p.feeders.filter((x) => x.boardId === 'DB-GF1')).toHaveLength(piled.feeders.filter((x) => x.boardId === 'DB-GF1').length);
  });
  it('returns the project unchanged for a board with only 3-phase circuits', () => {
    const allThree = sampleProject.feeders.filter((x) => x.boardId === 'SMDB-GF').every((x) => x.cores !== 2);
    expect(allThree).toBe(true);
    expect(balanceBoardPhases(sampleProject, 'SMDB-GF')).toBe(sampleProject);
  });
});
