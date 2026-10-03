import { describe, expect, it } from 'vitest';
import { applyHierarchy, evenAssignment, levelRef, panelName, planHierarchy, type HierarchySpec } from './hierarchy';
import { floorList } from './levels';
import { runCalculations } from '../calc/runs';
import type { Project } from '../types';

const tower = (levels = [{ id: 'g', name: 'Ground', kind: 'ground' as const, heightM: 4.5 }, { id: 't', name: 'Typical', kind: 'typical' as const, heightM: 3.2, count: 10 }]): Project => ({
  name: 'G+10 Tower', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: { buildings: [{ id: 'A', name: 'Tower', levels }], rooms: [] }
});
const spec = (over: Partial<HierarchySpec> = {}): HierarchySpec => ({ buildingId: 'A', mdbs: { create: 5 }, smdbPerFloor: 10, dbPerSmdb: 1, incomers: true, ...over });

describe('build panel hierarchy', () => {
  it('level references and names: type – level – number only when more than one', () => {
    expect(['G', 'L01', 'L10', 'B2', 'R', 'P1'].map(levelRef)).toEqual(['GF', 'L1', 'L10', 'B2', 'RF', 'P1']);
    expect(panelName('SMDB', 'GF', 1, 1)).toBe('SMDB-GF');
    expect(panelName('SMDB', 'L1', 1, 1)).toBe('SMDB-L1');
    expect(panelName('SMDB', 'L2', 2, 2)).toBe('SMDB-L2-02');
  });

  it('the G+10 example: 5 MDB + 110 SMDB + 110 DB = 225 panels, 220 incomers', () => {
    const p = tower();
    const plan = planHierarchy(p, spec());
    expect(plan.ok).toBe(true);
    expect(plan.boards).toHaveLength(225);
    expect(plan.boards.filter((b) => b.kind === 'MDB').map((b) => b.id)).toEqual(['MDB-01', 'MDB-02', 'MDB-03', 'MDB-04', 'MDB-05']);
    expect(plan.boards.filter((b) => b.kind === 'SMDB')).toHaveLength(110);
    expect(plan.boards.filter((b) => b.kind === 'DB')).toHaveLength(110);
    expect(plan.feeders).toHaveLength(220);
    expect(plan.feeders.every((f) => f.sizingPending)).toBe(true);
    const ids = plan.boards.map((b) => b.id);
    expect(new Set(ids).size).toBe(225);
    expect(ids).toContain('SMDB-GF-01');
    expect(ids).toContain('SMDB-L10-10');
    expect(ids).toContain('DB-L3-07');
    // DB-Lx-nn sits under SMDB-Lx-nn (one DB per SMDB)
    expect(plan.boards.find((b) => b.id === 'DB-L3-07')!.upstreamId).toBe('SMDB-L3-07');
    // floors split 3, 2, 2, 2, 2 bottom up: GF–L2 on MDB-01 … L9–L10 on MDB-05
    expect(plan.assignment.map((a) => `${levelRef(a.floor.tag)}:${a.mdbId}`)).toEqual(['GF:MDB-01', 'L1:MDB-01', 'L2:MDB-01', 'L3:MDB-02', 'L4:MDB-02', 'L5:MDB-03', 'L6:MDB-03', 'L7:MDB-04', 'L8:MDB-04', 'L9:MDB-05', 'L10:MDB-05']);
    expect(plan.checks.some((c) => /supply .* still to assign/.test(c.text))).toBe(true);
  });

  it('one SMDB per floor has no number; two DBs per SMDB are numbered across the floor', () => {
    const plan = planHierarchy(tower(), spec({ mdbs: { create: 1 }, smdbPerFloor: 1, dbPerSmdb: 2 }));
    const ids = plan.boards.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['MDB', 'SMDB-GF', 'SMDB-L1', 'DB-L1-01', 'DB-L1-02']));
    expect(ids).not.toContain('SMDB-L1-01');
  });

  it('feeds from existing boards, rejects name clashes and missing floors', () => {
    const p: Project = { ...tower(), boards: [{ id: 'MDB-1', name: 'MDB-1', sourceKva: 1500, sourceImpedancePct: 6 }, { id: 'SMDB-L4', name: 'x', upstreamId: 'MDB-1' }] };
    const clash = planHierarchy(p, spec({ mdbs: { existing: ['MDB-1'] }, smdbPerFloor: 1, dbPerSmdb: 0 }));
    expect(clash.ok).toBe(false);
    expect(clash.checks.some((c) => c.text.startsWith('Already in the project: SMDB-L4'))).toBe(true);
    expect(() => applyHierarchy(p, clash)).toThrow();
    expect(planHierarchy(p, spec({ mdbs: { existing: ['NOPE'] } })).ok).toBe(false);
    expect(planHierarchy({ ...tower(), building: undefined }, spec()).ok).toBe(false);
    expect(planHierarchy(tower(), spec({ smdbPerFloor: 0 })).ok).toBe(false);
  });

  it('editable assignment overrides the even split; uneven floors still covered', () => {
    const p = tower();
    const floors = floorList(p.building);
    expect(Object.values(evenAssignment(floors, 5))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const plan = planHierarchy(p, spec({ assign: { [floors[0].key]: 4 } }));
    expect(plan.assignment[0].mdbId).toBe('MDB-05');
    expect(plan.boards.find((b) => b.id === 'SMDB-GF-01')!.upstreamId).toBe('MDB-05');
  });

  it('applied: one change, connected network that calculates; incomer length from the riser', () => {
    const p = tower();
    const plan = planHierarchy(p, spec({ mdbs: { create: 1 }, smdbPerFloor: 1, dbPerSmdb: 1 }));
    const next = applyHierarchy(p, plan);
    expect(next.boards).toHaveLength(23);
    const top = next.feeders.find((f) => f.feedsBoardId === 'SMDB-L10')!;
    const gf = next.feeders.find((f) => f.feedsBoardId === 'SMDB-GF')!;
    expect(top.lengthM).toBeGreaterThan(gf.lengthM); // higher floor, longer riser cable
    const run = runCalculations(next);
    expect(run.results).toHaveLength(next.feeders.length);
  });
});
