import { describe, expect, it } from 'vitest';
import { applyHierarchy, planHierarchy } from './hierarchy';
import { applyBranchCopies, assemblyFrom, branchSummary, extractBranch, otherFloors, planBranchCopies } from './branchCopy';
import { floorList } from './levels';
import { runCalculations } from '../calc/runs';
import type { Feeder, Project } from '../types';

const tower = (): Project => {
  const base: Project = { name: 'T', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
    building: { buildings: [{ id: 'A', name: 'Tower', levels: [{ id: 'g', name: 'Ground', kind: 'ground', heightM: 4.5 }, { id: 't', name: 'Typical', kind: 'typical', heightM: 3.2, count: 10 }] }], rooms: [] } };
  // MDB, SMDB-L1 with two DBs, and circuits on the DBs
  const p = applyHierarchy(base, planHierarchy(base, { buildingId: 'A', mdbs: { create: 1 }, floors: [floorList(base.building)[1].key], smdbPerFloor: 1, dbPerSmdb: 2, incomers: true }));
  const c = (id: string, boardId: string, kw: number): Feeder => ({ id, boardId, name: `Lighting ${boardId}`, loadKw: kw, demandFactor: 0.8, powerFactor: 0.9, lengthM: 20, cableCsaMm2: 2.5, cores: 2, phase: 'R', way: 1, breakerRatingA: 16, breakerIcuKa: 6 });
  return { ...p, feeders: [...p.feeders, c('DB-L1-01-R1', 'DB-L1-01', 1.2), c('DB-L1-02-R1', 'DB-L1-02', 0.8), c('X7', 'SMDB-L1', 3)] };
};
const floor = (p: Project, ref: string) => floorList(p.building).find((f) => (f.tag === 'G' ? 'GF' : f.tag.replace(/^L0*/, 'L')) === ref)!;

describe('repeat branch', () => {
  it('copies SMDB-L1 with its DBs and circuits to other floors, level swapped as a whole part', () => {
    const p = tower();
    const br = extractBranch(p, 'SMDB-L1')!;
    expect(br.token).toBe('L1');
    expect(branchSummary(br)).toBe('SMDB-L1 + 2 DB · 3 circuits');
    const plan = planBranchCopies(p, br, ['L2', 'L10'].map((r) => ({ floor: floor(p, r), parentId: 'MDB' })));
    expect(plan.ok).toBe(true);
    const ids = plan.copies.flatMap((c) => c.boards.map((b) => b.id));
    expect(ids).toEqual(['SMDB-L2', 'DB-L2-01', 'DB-L2-02', 'SMDB-L10', 'DB-L10-01', 'DB-L10-02']);
    const fl = plan.copies[1].feeders.map((f) => f.id);
    expect(fl).toEqual(expect.arrayContaining(['DB-L10-01-R1', 'INC-SMDB-L10', 'INC-DB-L10-01']));
    expect(plan.copies[1].boards.every((b) => b.level && floorList(p.building).find((f) => f.ref.level === b.level!.level && (f.ref.index ?? 0) === (b.level!.index ?? 0))?.tag === 'L10')).toBe(true);
    expect(plan.copies[1].feeders.find((f) => f.id === 'DB-L10-01-R1')!.name).toBe('Lighting DB-L10-01');
    // incomer length from the riser: higher floor, longer
    const inc = (i: number) => plan.copies[i].feeders.find((f) => f.feedsBoardId?.startsWith('SMDB'))!;
    expect(inc(1).lengthM).toBeGreaterThan(inc(0).lengthM);
    expect(inc(1).lengthToCheck).toBe(true);
    expect(plan.copies[0].feeders.map((f) => f.id)).toContain('SMDB-L2-X7'); // no level in the id: prefixed with its new board
    const next = applyBranchCopies(p, plan);
    expect(new Set(next.boards.map((b) => b.id)).size).toBe(next.boards.length);
    expect(new Set(next.feeders.map((f) => f.id)).size).toBe(next.feeders.length);
    expect(runCalculations(next).results).toHaveLength(next.feeders.length);
    // loads copied: same demand per copied DB as the source
    expect(next.feeders.filter((f) => f.boardId === 'DB-L2-01' && !f.feedsBoardId).map((f) => f.loadKw)).toEqual([1.2]);
  });

  it('the same branch twice on a floor is numbered, not clashing; bad parents are refused', () => {
    const p = tower();
    const br = extractBranch(p, 'SMDB-L1')!;
    const again = planBranchCopies(p, br, [{ floor: floor(p, 'L1'), parentId: 'MDB' }]);
    expect(again.ok).toBe(true);
    expect(again.copies[0].boards[0].id).toBe('SMDB-L1-2');
    expect(again.checks.some((c) => /numbered/.test(c.text))).toBe(true);
    expect(planBranchCopies(p, br, [{ floor: floor(p, 'L3'), parentId: 'NOPE' }]).ok).toBe(false);
    expect(planBranchCopies(p, br, [{ floor: floor(p, 'L3'), parentId: 'DB-L1-01' }]).ok).toBe(false); // inside the branch
    expect(planBranchCopies(p, br, []).ok).toBe(false);
    expect(otherFloors(p, 'SMDB-L1').map((f) => f.tag)).not.toContain('L01');
  });

  it('assemblies: saved branch inserted into another project, unique ids per instance', () => {
    const p = tower();
    const a = assemblyFrom(p, 'SMDB-L1', 'Typical floor SMDB')!;
    expect(a.branch.boards).toHaveLength(3);
    const other = tower();
    const once = planBranchCopies(other, a.branch, [{ floor: floor(other, 'L4'), parentId: 'MDB' }, { floor: floor(other, 'L4'), parentId: 'MDB' }]);
    expect(once.ok).toBe(true);
    expect(once.copies.map((c) => c.boards[0].id)).toEqual(['SMDB-L4', 'SMDB-L4-2']);
    const all = applyBranchCopies(other, once).boards.map((b) => b.id);
    expect(new Set(all).size).toBe(all.length);
  });
});
