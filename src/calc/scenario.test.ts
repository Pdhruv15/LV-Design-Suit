import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject, faultCurrentKA, impedanceToBoard } from './electrical';
import { generatorScenario, motorStartDipPct } from './scenario';
import type { Project } from '../types';

const withGen = (boardId: string, kva: number): Project => ({
  ...sampleProject,
  boards: sampleProject.boards.map((b) => (b.id === boardId ? { ...b, standby: { kva } } : b))
});

describe('generator scenario', () => {
  it('runs only the generator-backed boards, each fed from its generator', () => {
    const s = generatorScenario(withGen('SMDB-GF', 250));
    expect([...s.energized].sort()).toEqual(['DB-GF1', 'SMDB-GF']);
    expect(s.project.boards.map((b) => b.id).sort()).toEqual(['DB-GF1', 'SMDB-GF']);
    const src = s.project.boards.find((b) => b.id === 'SMDB-GF')!;
    expect(src).toMatchObject({ upstreamId: undefined, sourceKva: 250, sourceImpedancePct: 15 });
    expect(s.project.feeders.every((f) => ['SMDB-GF', 'DB-GF1'].includes(f.boardId))).toBe(true);
    expect(s.project.feeders.some((f) => f.id === 'INC-GF')).toBe(false); // the MDB feeder is off
    expect(evaluateProject(s.project).length).toBe(s.project.feeders.length);
  });

  it('fault level on the generator is far below the transformer supply', () => {
    const normal = faultCurrentKA(impedanceToBoard(sampleProject, 'SMDB-GF'), 415);
    const s = generatorScenario(withGen('SMDB-GF', 250));
    const onGen = faultCurrentKA(impedanceToBoard(s.project, 'SMDB-GF'), 415);
    expect(onGen).toBeLessThan(normal / 4);
    expect(onGen).toBeCloseTo(250 / (Math.sqrt(3) * 0.415) / 0.15 / 1000, 1); // ≈ In / X″d
  });

  it('reports generator loading and the largest motor start dip', () => {
    const s = generatorScenario(withGen('MCC-1', 200));
    const g = s.generators[0];
    expect(g.boardId).toBe('MCC-1');
    expect(g.loadingPct).toBeCloseTo((g.demandKva / 200) * 100, 9);
    expect(g.largestMotor!.feeder.id).toBe('MCC-WP'); // 75 kW
    expect(g.largestMotor!.dipPct).toBeCloseTo(motorStartDipPct((6 * 75) / 0.86, 200), 9);
    expect(g.largestMotor!.dipPct).toBeGreaterThan(15); // a 200 kVA set can't start a 75 kW pump DOL cleanly
  });

  it('a generator board below another backed board is fed from the upstream set', () => {
    const p = withGen('SMDB-GF', 250);
    const both = { ...p, boards: p.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, standby: { kva: 30 } } : b)) };
    const s = generatorScenario(both);
    expect(s.generators.map((g) => g.boardId)).toEqual(['SMDB-GF']);
    expect(s.project.boards.find((b) => b.id === 'DB-GF1')!.upstreamId).toBe('SMDB-GF');
  });

  it('nothing runs without a generator', () => {
    const s = generatorScenario(sampleProject);
    expect(s.energized.size).toBe(0);
    expect(s.generators).toEqual([]);
  });
});
