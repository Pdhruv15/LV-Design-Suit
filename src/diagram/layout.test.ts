import { describe, expect, it } from 'vitest';
import { LEAF_W, LEVEL_H, ROOT_BUS_Y, layoutSystem } from './layout';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';

function feeder(id: string, boardId: string, feedsBoardId?: string): Feeder {
  return {
    id, boardId, name: id, loadKw: 10, demandFactor: 1, powerFactor: 0.9, lengthM: 10,
    cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 36, feedsBoardId
  };
}

const base = { name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '' };

describe('system layout', () => {
  it('places every board and feeder exactly once', () => {
    const l = layoutSystem(sampleProject);
    expect(l.boards.map((b) => b.board.id).sort()).toEqual(sampleProject.boards.map((b) => b.id).sort());
    expect(l.feeders.map((f) => f.feeder.id).sort()).toEqual(sampleProject.feeders.map((f) => f.id).sort());
  });

  it('puts sub-boards one level down, centred over their loads, under their incomer', () => {
    const p: Project = {
      ...base,
      boards: [{ id: 'MDB', name: 'M' }, { id: 'SUB', name: 'S', upstreamId: 'MDB' }],
      feeders: [feeder('INC', 'MDB', 'SUB'), feeder('A', 'SUB'), feeder('B', 'SUB'), feeder('C', 'MDB')]
    };
    const l = layoutSystem(p);
    const sub = l.boards.find((b) => b.board.id === 'SUB')!;
    const [a, b] = ['A', 'B'].map((id) => l.feeders.find((f) => f.feeder.id === id)!);
    const inc = l.feeders.find((f) => f.feeder.id === 'INC')!;
    expect(sub.busY).toBe(ROOT_BUS_Y + LEVEL_H);
    expect(sub.x).toBe((a.x + b.x) / 2);
    expect(inc.x).toBe(sub.x);
    expect(inc.childBoardId).toBe('SUB');
    expect(b.x - a.x).toBe(LEAF_W);
  });

  it('never puts two loads in the same slot', () => {
    const l = layoutSystem(sampleProject);
    const loads = l.feeders.filter((f) => !f.childBoardId).map((f) => `${f.x}:${f.busY}`);
    expect(new Set(loads).size).toBe(loads.length);
  });

  it('survives a cycle in the board hierarchy', () => {
    const p: Project = {
      ...base,
      boards: [{ id: 'A', name: 'A', upstreamId: 'B' }, { id: 'B', name: 'B', upstreamId: 'A' }],
      feeders: [feeder('AB', 'A', 'B'), feeder('BA', 'B', 'A')]
    };
    const l = layoutSystem(p);
    expect(l.boards).toHaveLength(2);
  });
});
