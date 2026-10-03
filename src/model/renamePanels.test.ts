import { describe, expect, it } from 'vitest';
import { applyHierarchy } from './hierarchy';
import { planBatchHierarchy } from './hierarchyBuilder';
import { floorList } from './levels';
import { renameByLevel, renamePanels, renameProblems } from './renamePanels';
import { runCalculations } from '../calc/runs';
import type { Project } from '../types';

const tower = (): Project => ({ name: 'T', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: { buildings: [{ id: 'A', name: 'Tower', levels: [{ id: 'g', name: 'Ground', kind: 'ground', heightM: 4.5 }, { id: 't', name: 'Typical', kind: 'typical', heightM: 3.2, count: 10 }] }], rooms: [] } });
const quick = (p: Project, mdb: number, smdb: number, db: number) =>
  applyHierarchy(p, planBatchHierarchy(p, { mode: 'quantity', mdbs: { create: mdb }, smdb: { count: smdb, basis: 'total' }, db: { count: db, basis: 'total' }, incomers: true }));

describe('quick create and rename by level', () => {
  it('5 MDB / 10 SMDB / 100 DB: incremental names padded to the batch, spread evenly', () => {
    const p = quick(tower(), 5, 10, 100);
    const ids = p.boards.map((b) => b.id);
    expect(ids.filter((i) => i.startsWith('MDB')).slice(0, 2)).toEqual(['MDB-01', 'MDB-02']);
    expect(ids).toContain('SMDB-10');
    expect(ids).toContain('DB-001');
    expect(ids).toContain('DB-100');
    expect(p.boards.filter((b) => b.upstreamId === 'MDB-01')).toHaveLength(2);
    expect(p.boards.filter((b) => b.upstreamId === 'SMDB-01')).toHaveLength(10);
    expect(p.feeders.filter((f) => f.feedsBoardId)).toHaveLength(110);
  });

  it('levels set later → rename by level, only panels with a level; every reference follows', () => {
    let p = quick(tower(), 1, 2, 3);
    const fl = floorList(p.building);
    const L3 = fl.find((f) => f.tag === 'L03')!;
    // DB-01 and DB-02 to L3, SMDB-01 to L1; a circuit on DB-01; a sheet and a tie mention them
    p = { ...p, boards: p.boards.map((b) => (['DB-01', 'DB-02'].includes(b.id) ? { ...b, level: L3.ref } : b.id === 'SMDB-01' ? { ...b, level: fl.find((f) => f.tag === 'L01')!.ref } : b)),
      feeders: [...p.feeders, { id: 'DB-01-R1', boardId: 'DB-01', name: 'Lighting', loadKw: 1, demandFactor: 1, powerFactor: 0.9, lengthM: 10, cableCsaMm2: 2.5, cores: 2, phase: 'R', way: 1, breakerRatingA: 16, breakerIcuKa: 6 }],
      drawingSet: { prefix: 'E-', sheets: [{ id: 's', number: 'E-1', title: 'x', kind: 'system', boards: ['SMDB-01', 'DB-01'], size: 'auto', arrows: [{ target: 'f:DB-01-R1', text: 'x', dir: 'ne' }] }] } };
    const pairs = renameByLevel(p);
    expect(pairs).toEqual(expect.arrayContaining([{ from: 'DB-01', to: 'DB-L3-01', level: 'L3' }, { from: 'DB-02', to: 'DB-L3-02', level: 'L3' }, { from: 'SMDB-01', to: 'SMDB-L1', level: 'L1' }]));
    expect(pairs.some((x) => x.from === 'DB-03')).toBe(false); // no level: keeps its incremental name
    const next = renamePanels(p, pairs);
    expect(next.boards.map((b) => b.id)).toEqual(expect.arrayContaining(['SMDB-L1', 'DB-L3-01', 'DB-L3-02', 'DB-03', 'SMDB-02']));
    expect(next.boards.find((b) => b.id === 'DB-L3-01')!.upstreamId).toBe('SMDB-L1');
    expect(next.feeders.find((f) => f.id === 'DB-L3-01-R1')!.boardId).toBe('DB-L3-01');
    expect(next.feeders.find((f) => f.feedsBoardId === 'DB-L3-01')!.id).toBe('INC-DB-L3-01');
    expect(next.feeders.find((f) => f.feedsBoardId === 'DB-L3-01')!.boardId).toBe('SMDB-L1');
    expect(next.drawingSet!.sheets[0].boards).toEqual(['SMDB-L1', 'DB-L3-01']);
    expect(next.drawingSet!.sheets[0].arrows![0].target).toBe('f:DB-L3-01-R1');
    // nothing still points at an old id
    const json = JSON.stringify(next);
    for (const old of ['"DB-01"', '"SMDB-01"', '"INC-DB-01"']) expect(json).not.toContain(old);
    expect(runCalculations(next).results).toHaveLength(next.feeders.length);
  });

  it('a second batch continues the numbering', () => {
    const p = quick(quick(tower(), 5, 10, 100), 1, 2, 10);
    const ids = p.boards.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['MDB-06', 'SMDB-11', 'SMDB-12', 'DB-101', 'DB-110']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('clashes and empty names are refused', () => {
    const p = quick(tower(), 1, 2, 2);
    expect(renameProblems(p, [{ from: 'DB-01', to: 'DB-02' }])[0]).toMatch(/already exists/);
    expect(renameProblems(p, [{ from: 'DB-01', to: 'X' }, { from: 'DB-02', to: 'X' }])[0]).toMatch(/twice/);
    expect(() => renamePanels(p, [{ from: 'DB-01', to: '' }])).toThrow();
    expect(renameProblems(p, [{ from: 'DB-01', to: 'DB-02' }, { from: 'DB-02', to: 'DB-01' }])).toEqual([]); // a swap is fine
  });
});
