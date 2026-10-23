import { describe, expect, it } from 'vitest';
import { CHANGEOVER_H, LEAF_W, LEVEL_H, ROOT_BUS_Y, layoutSystem } from './layout';
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
  it('places every board and feeder exactly once; final circuits go to their DB', () => {
    const l = layoutSystem(sampleProject);
    expect(l.boards.map((b) => b.board.id).sort()).toEqual(sampleProject.boards.map((b) => b.id).sort());
    const drawn = [...l.feeders.map((f) => f.feeder.id), ...l.boards.flatMap((b) => b.circuits.map((c) => c.id))];
    expect(drawn.sort()).toEqual(sampleProject.feeders.map((f) => f.id).sort());
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

  it('stops the SLD at the DB: final circuits are not drawn', () => {
    const circuits: Feeder[] = Array.from({ length: 4 }, (_, i) => ({
      ...feeder(`C${i}`, 'SUB'), phase: (['R', 'Y', 'B'] as const)[i % 3], way: Math.floor(i / 3) + 1, cores: 2 as const
    }));
    const p: Project = {
      ...base,
      boards: [{ id: 'MDB', name: 'M' }, { id: 'SUB', name: 'S', upstreamId: 'MDB' }],
      feeders: [feeder('INC', 'MDB', 'SUB'), feeder('PUMP', 'MDB'), ...circuits]
    };
    const l = layoutSystem(p);
    expect(l.feeders.map((f) => f.feeder.id).sort()).toEqual(['INC', 'PUMP']);
    const sub = l.boards.find((b) => b.board.id === 'SUB')!;
    const mdb = l.boards.find((b) => b.board.id === 'MDB')!;
    expect(sub.circuits.map((c) => c.id)).toEqual(['C0', 'C1', 'C2', 'C3']);
    expect(sub.terminal).toBe(true);
    expect(mdb.terminal).toBe(false);
    // The DB takes a single slot, next to the MDB's other load.
    expect(l.feeders.find((f) => f.feeder.id === 'PUMP')!.x - sub.x).toBe(LEAF_W);
  });

  it('keeps a DB\'s own non-schedule feeders on the SLD', () => {
    const p: Project = {
      ...base,
      boards: [{ id: 'MDB', name: 'M' }, { id: 'SUB', name: 'S', upstreamId: 'MDB' }],
      feeders: [
        feeder('INC', 'MDB', 'SUB'),
        feeder('MOTOR', 'SUB'),
        { ...feeder('C0', 'SUB'), phase: 'R', way: 1, cores: 2 }
      ]
    };
    const l = layoutSystem(p);
    expect(l.feeders.map((f) => f.feeder.id).sort()).toEqual(['INC', 'MOTOR']);
    const sub = l.boards.find((b) => b.board.id === 'SUB')!;
    expect(sub.terminal).toBe(false);
    expect(sub.circuits.map((c) => c.id)).toEqual(['C0']);
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

describe('mains / generator changeover layout', () => {
  const p: Project = {
    ...base,
    boards: [{ id: 'MDB', name: 'M' }, { id: 'EMDB', name: 'E', upstreamId: 'MDB', standby: { kva: 200, changeover: 'ACB' } }, { id: 'EDB', name: 'D', upstreamId: 'EMDB' }],
    feeders: [feeder('INC', 'MDB', 'EMDB'), feeder('A', 'EMDB'), feeder('INC2', 'EMDB', 'EDB'), feeder('L', 'EDB'), feeder('C', 'MDB')]
  };
  const l = layoutSystem(p);
  const at = (id: string) => l.boards.find((b) => b.board.id === id)!;

  it('raises the board box above the two incomers and moves the levels below down with it', () => {
    const e = at('EMDB');
    expect(e.busY).toBe(ROOT_BUS_Y + LEVEL_H + CHANGEOVER_H);
    expect(e.headY).toBe(e.busY - CHANGEOVER_H);
    expect(at('EDB').busY).toBe(ROOT_BUS_Y + 2 * LEVEL_H + CHANGEOVER_H);
    expect(at('MDB').headY).toBe(at('MDB').busY);
    expect(l.feeders.find((f) => f.feeder.id === 'L')!.busY).toBe(at('EDB').busY);
  });

  it('drops the generator incomer in beyond the last way, on the busbar, with room before the next board', () => {
    const e = at('EMDB');
    const ways = l.feeders.filter((f) => f.feeder.boardId === 'EMDB').map((f) => f.x);
    expect(e.genX!).toBeGreaterThan(Math.max(...ways));
    expect(e.busX2).toBeGreaterThanOrEqual(e.genX!);
    const next = l.feeders.find((f) => f.feeder.id === 'C')!;
    expect(next.x - e.genX!).toBeGreaterThan(135);
  });
});

describe('room for the panel instruments', () => {
  const two = (instruments?: boolean, ways = 1): Project => ({
    ...base,
    boards: [{ id: 'A', name: 'A', ...(instruments === undefined ? {} : { instruments }) }, { id: 'B', name: 'B' }],
    feeders: [...Array.from({ length: ways }, (_, i) => feeder(`A${i}`, 'A')), feeder('B1', 'B'), feeder('B2', 'B')]
  });

  it('keeps a slot free left of the incomer on a main board with a single way, inside its own busbar', () => {
    const l = layoutSystem(two());
    const a = l.boards.find((b) => b.board.id === 'A')!, b = l.boards.find((x) => x.board.id === 'B')!;
    expect(a.x - 66 - a.busX1).toBeGreaterThanOrEqual(50); // the meters and lamps fit left of the board box
    expect(a.busX2).toBeLessThan(b.busX1); // and stay clear of the next panel
    expect(l.feeders.find((f) => f.feeder.id === 'A0')!.x - a.busX1).toBeGreaterThan(LEAF_W);
  });

  it('adds no slot with instruments off, or with two ways (room already there)', () => {
    const off = layoutSystem(two(false)), wide = layoutSystem(two(undefined, 2)), one = layoutSystem(two());
    const bx = (l: typeof one) => l.boards.find((b) => b.board.id === 'B')!.x;
    expect(bx(off)).toBe(bx(one) - LEAF_W);
    const a = wide.boards.find((b) => b.board.id === 'A')!;
    expect(a.x - 66 - a.busX1).toBeGreaterThanOrEqual(50);
    expect(bx(wide)).toBe(bx(one)); // two ways take the same two slots
  });
});
