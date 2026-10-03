import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { planBatchHierarchy, type BatchHierarchySpec } from './hierarchyBuilder';
import { applyHierarchy, planHierarchy } from './hierarchy';
import { floorList } from './levels';
import { record, reset, undo } from './history';

const project = (): Project => ({ name: 'Test', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [] });
const tower = (): Project => ({ ...project(), building: { buildings: [{ id: 'A', name: 'Tower', levels: [
  { id: 'g', name: 'Ground', kind: 'ground', heightM: 4.5 },
  { id: 't', name: 'Typical', kind: 'typical', heightM: 3.2, count: 10 }
] }], rooms: [] } });
const spec = (over: Partial<BatchHierarchySpec> = {}): BatchHierarchySpec => ({ mode: 'quantity', mdbs: { create: 5 }, smdb: { count: 10, basis: 'total' }, db: { count: 10, basis: 'total' }, incomers: true, ...over });
const floorSpec = (over: Partial<BatchHierarchySpec> = {}) => spec({ mode: 'floors', buildingId: 'A', smdb: { count: 10, basis: 'floor' }, db: { count: 10, basis: 'floor' }, ...over });

describe('guided hierarchy draft', () => {
  it('creates exact project totals without building setup', () => {
    const p = project(), before = JSON.stringify(p);
    const plan = planBatchHierarchy(p, spec());
    expect(plan.ok).toBe(true);
    expect(plan.boards).toHaveLength(25);
    expect(plan.feeders).toHaveLength(20);
    expect(plan.mdbIds.map((id) => plan.boards.filter((b) => b.upstreamId === id).length)).toEqual([2, 2, 2, 2, 2]);
    expect(plan.boards.filter((b) => b.kind === 'SMDB').map((s) => plan.boards.filter((b) => b.upstreamId === s.id).length)).toEqual(Array(10).fill(1));
    expect(plan.boards.every((b) => !b.level)).toBe(true);
    expect(plan.feeders.every((f) => f.sizingPending && f.lengthToCheck)).toBe(true);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('distinguishes ten DBs per floor from ten DBs per SMDB for G+10', () => {
    const p = tower();
    const byFloor = planBatchHierarchy(p, floorSpec());
    const byParent = planBatchHierarchy(p, floorSpec({ db: { count: 10, basis: 'parent' } }));
    expect(byFloor.ok && byParent.ok).toBe(true);
    expect(byFloor.boards).toHaveLength(225);
    expect(byFloor.feeders).toHaveLength(220);
    expect(byParent.boards).toHaveLength(1215);
    expect(byParent.feeders).toHaveLength(1210);
    for (const f of floorList(p.building)) {
      expect(byFloor.boards.filter((b) => b.kind === 'DB' && b.level?.level === f.ref.level && (b.level.index ?? 0) === (f.ref.index ?? 0))).toHaveLength(10);
    }
  });

  it('retains the legacy floor layout and riser lengths when quantities match', () => {
    const p = tower();
    const old = planHierarchy(p, { buildingId: 'A', mdbs: { create: 5 }, smdbPerFloor: 10, dbPerSmdb: 1, incomers: true });
    const next = planBatchHierarchy(p, floorSpec({ db: { count: 1, basis: 'parent' } }));
    const byId = <T extends { id: string }>(items: T[]) => JSON.parse(JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id))));
    expect(byId(next.boards)).toEqual(byId(old.boards));
    expect(byId(next.feeders)).toEqual(byId(old.feeders));
    expect(next.assignment).toEqual(old.assignment);
  });

  it('distributes uneven totals once, including groups with no SMDB', () => {
    const p = project();
    for (const smdbs of [2, 7]) {
      const plan = planBatchHierarchy(p, spec({ mdbs: { create: 3 }, smdb: { count: smdbs, basis: 'total' } }));
      expect(plan.ok).toBe(true);
      expect(plan.boards.filter((b) => b.kind === 'DB')).toHaveLength(10);
      const counts = plan.boards.filter((b) => b.kind === 'SMDB').map((s) => plan.boards.filter((b) => b.upstreamId === s.id).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    const byMdb = planBatchHierarchy(p, spec({ mdbs: { create: 3 }, smdb: { count: 2, basis: 'parent' } }));
    expect(byMdb.boards.filter((b) => b.kind === 'SMDB')).toHaveLength(6);
  });

  it('allows direct MDB to DB and zero downstream counts without hidden defaults', () => {
    const plan = planBatchHierarchy(project(), spec({ smdb: { count: 0, basis: 'total' } }));
    expect(plan.ok).toBe(true);
    expect(plan.boards).toHaveLength(15);
    expect(plan.boards.filter((b) => b.kind === 'DB').every((b) => plan.mdbIds.includes(b.upstreamId!))).toBe(true);
    expect(planBatchHierarchy(project(), spec({ db: { count: 0, basis: 'total' } })).boards).toHaveLength(15);
    expect(planBatchHierarchy(project(), spec({ smdb: { count: 0, basis: 'total' }, db: { count: 1, basis: 'parent' } })).ok).toBe(false);
  });

  it('validates integer counts, mode-specific bases and batch limits before allocation', () => {
    for (const count of [NaN, Infinity, -1, 1.5, 5001]) {
      const plan = planBatchHierarchy(project(), spec({ smdb: { count, basis: 'total' } }));
      expect(plan.ok).toBe(false); expect(plan.boards).toHaveLength(0);
    }
    expect(planBatchHierarchy(project(), spec({ smdb: { count: 1, basis: 'floor' } })).ok).toBe(false);
    expect(planBatchHierarchy(tower(), floorSpec({ smdb: { count: 1, basis: 'parent' } })).ok).toBe(false);
    expect(planBatchHierarchy(project(), spec({ smdb: { count: 5000, basis: 'total' }, db: { count: 50, basis: 'parent' } })).boards).toHaveLength(0);
    expect(planBatchHierarchy(project(), spec({ mdbs: { create: 0 } })).ok).toBe(false);
  });

  it('rejects missing floors and invalid or duplicate existing main sources', () => {
    const p = { ...tower(), boards: [{ id: 'MAIN', name: 'MAIN' }, { id: 'CHILD', name: 'CHILD', upstreamId: 'MAIN' }] };
    expect(planBatchHierarchy(project(), floorSpec()).ok).toBe(false);
    expect(planBatchHierarchy(p, floorSpec({ floors: ['A/missing/0'] })).ok).toBe(false);
    for (const existing of [[], ['MAIN', 'MAIN'], ['NOPE'], ['CHILD']]) expect(planBatchHierarchy(p, spec({ mdbs: { existing } })).ok).toBe(false);
    const valid = planBatchHierarchy(p, spec({ mdbs: { existing: ['MAIN'] } }));
    expect(valid.ok).toBe(true); expect(valid.boards).toHaveLength(20);
  });

  it('avoids both existing panel and feeder identifiers, without overwriting', () => {
    const p = applyHierarchy(project(), planBatchHierarchy(project(), spec()));
    p.feeders.push({ ...p.feeders[0], id: 'SMDB-11' });
    const next = planBatchHierarchy(p, spec());
    expect(next.ok).toBe(true);
    const identifiers = new Set([...p.boards, ...p.feeders].map((x) => x.id));
    expect(next.boards.every((b) => !identifiers.has(b.id))).toBe(true);
    expect(next.feeders.every((f) => !identifiers.has(f.id))).toBe(true);
    expect(new Set([...next.boards, ...next.feeders].map((x) => x.id)).size).toBe(45);
  });

  it('renames panel tags while preserving all child and incomer references', () => {
    const plan = planBatchHierarchy(project(), spec({ mdbs: { create: 1 }, smdb: { count: 1, basis: 'total' }, db: { count: 1, basis: 'total' } }), {
      MDB: { tag: 'MAIN-A' }, 'SMDB-01': { tag: 'MECH-A', location: ' Plant room ' }, 'DB-01': { tag: 'LIGHT-A', parentKey: 'SMDB-01' }
    });
    expect(plan.ok).toBe(true);
    expect(plan.mdbIds).toEqual(['MAIN-A']);
    expect(plan.boards.find((b) => b.id === 'LIGHT-A')?.upstreamId).toBe('MECH-A');
    expect(plan.boards.find((b) => b.id === 'MECH-A')?.location).toBe('Plant room');
    expect(plan.feeders.map((f) => [f.boardId, f.feedsBoardId])).toEqual([['MAIN-A', 'MECH-A'], ['MECH-A', 'LIGHT-A']]);
    expect(plan.draft.find((d) => d.board.id === 'LIGHT-A')?.key).toBe('DB-01');
  });

  it('reparents individual drafts and marks their lengths for checking', () => {
    const plan = planBatchHierarchy(tower(), floorSpec(), { 'SMDB-GF-01': { parentKey: 'MDB-05' } });
    expect(plan.ok).toBe(true);
    expect(plan.boards.find((b) => b.id === 'SMDB-GF-01')?.upstreamId).toBe('MDB-05');
    expect(plan.boards.find((b) => b.id === 'DB-GF-01')?.upstreamId).toBe('SMDB-GF-01');
    expect(plan.feeders.find((f) => f.feedsBoardId === 'SMDB-GF-01')?.lengthToCheck).toBe(true);
  });

  it('edits linked floors, recalculates provisional riser length, and validates unknown floors', () => {
    const p = tower(), floors = floorList(p.building);
    const base = planBatchHierarchy(p, floorSpec());
    const edit = planBatchHierarchy(p, floorSpec(), { 'SMDB-GF-01': { floorKey: floors[floors.length - 1].key } });
    expect(edit.ok).toBe(true);
    expect(edit.boards.find((b) => b.id === 'SMDB-GF-01')?.level).toEqual(floors[floors.length - 1].ref);
    expect(edit.feeders.find((f) => f.feedsBoardId === 'SMDB-GF-01')!.lengthM).toBeGreaterThan(base.feeders.find((f) => f.feedsBoardId === 'SMDB-GF-01')!.lengthM);
    expect(edit.feeders.find((f) => f.feedsBoardId === 'DB-GF-01')!.lengthToCheck).toBe(true);
    expect(planBatchHierarchy(p, floorSpec(), { 'SMDB-GF-01': { floorKey: 'unknown' } }).ok).toBe(false);
    expect(planBatchHierarchy(p, floorSpec(), { 'SMDB-GF-01': { floorKey: '' } }).boards.find((b) => b.id === 'SMDB-GF-01')?.level).toBeUndefined();
  });

  it('blocks empty/repeated/existing tags, missing parents and cycles before applying', () => {
    const p = { ...project(), boards: [{ id: 'EXISTING', name: 'Existing' }] };
    for (const tag of ['', 'SMDB-02', 'EXISTING']) {
      const plan = planBatchHierarchy(p, spec(), { 'SMDB-01': { tag } });
      expect(plan.ok).toBe(false); expect(() => applyHierarchy(p, plan)).toThrow();
    }
    for (const parentKey of ['', 'NOPE', 'SMDB-01', 'DB-01']) expect(planBatchHierarchy(p, spec(), { 'SMDB-01': { parentKey } }).ok).toBe(false);
  });

  it('applies a reviewed batch as one independent undo step', () => {
    const p = project(), changed = { ...p, name: 'Before batch' };
    const h = record(reset(p), changed, 1000);
    const plan = planBatchHierarchy(changed, spec({ incomers: false }));
    const next = applyHierarchy(changed, plan);
    const batch = record(h, next, 1001, 0);
    expect(plan.feeders).toHaveLength(0);
    expect(batch.past).toHaveLength(2);
    expect(undo(batch).present).toBe(changed);
    expect(next.boards).toHaveLength(25);
    expect(changed.boards).toHaveLength(0);
  });
});
