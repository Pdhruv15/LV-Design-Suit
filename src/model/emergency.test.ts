import { describe, expect, it } from 'vitest';
import { applyHierarchy } from './hierarchy';
import { planBatchHierarchy } from './hierarchyBuilder';
import { planEmergency, prefixOf, roleOf, namesOf } from './emergency';
import { renameByLevel } from './renamePanels';
import { floorList } from './levels';
import { runCalculations } from '../calc/runs';
import type { Project } from '../types';

const base = (): Project => {
  const p: Project = { name: 'T', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
    building: { buildings: [{ id: 'A', name: 'Tower', levels: [{ id: 'g', name: 'Ground', kind: 'ground', heightM: 4.5 }, { id: 't', name: 'Typical', kind: 'typical', heightM: 3.2, count: 5 }] }], rooms: [] } };
  const n = applyHierarchy(p, planBatchHierarchy(p, { mode: 'quantity', mdbs: { create: 2 }, smdb: { count: 2, basis: 'total' }, db: { count: 4, basis: 'total' }, incomers: true }));
  return { ...n, boards: n.boards.map((b) => (b.id === 'MDB-01' ? { ...b, sourceKva: 1500, sourceImpedancePct: 6 } : b)) };
};
const add = (p: Project, plan: ReturnType<typeof planEmergency>): Project => ({ ...p, boards: [...p.boards, ...plan.boards], feeders: [...p.feeders, ...plan.feeders] });

describe('emergency panel (ATS) and naming table', () => {
  it('one EMDB on an ATS from a normal MDB, with emergency sub-panels', () => {
    const p = base();
    const plan = planEmergency(p, { count: 1, mainsFrom: 'MDB-01', generatorKva: 500, esmdb: 1, edb: 3, incomers: true });
    expect(plan.ok).toBe(true);
    expect(plan.boards.map((b) => b.id)).toEqual(['EMDB', 'ESMDB-01', 'EDB-01', 'EDB-02', 'EDB-03']);
    const emdb = plan.boards[0];
    expect(emdb).toMatchObject({ kind: 'EMDB', upstreamId: 'MDB-01', standby: { kva: 500, changeover: 'ATS' } });
    expect(plan.feeders.find((f) => f.feedsBoardId === 'EMDB')).toMatchObject({ boardId: 'MDB-01', name: 'To EMDB (ATS mains)', sizingPending: true });
    const next = add(p, plan);
    expect(['EMDB', 'ESMDB-01', 'EDB-02', 'DB-01'].map((id) => roleOf(next, next.boards.find((b) => b.id === id)!))).toEqual(['EMDB', 'ESMDB', 'EDB', 'DB']);
    expect(runCalculations(next).results).toHaveLength(next.feeders.length);
  });

  it('naming table: prefixes for normal and emergency panels', () => {
    const p: Project = { ...base(), panelPrefixes: { EMDB: 'EMCC', EDB: 'EPDB', DB: 'LP' } };
    expect(namesOf(p)).toEqual({ MDB: 'MDB', SMDB: 'SMDB', DB: 'LP' });
    expect(planEmergency(p, { count: 1, mainsFrom: 'MDB-01', esmdb: 0, edb: 2, incomers: false }).boards.map((b) => b.id)).toEqual(['EMCC', 'EPDB-01', 'EPDB-02']);
    const q = applyHierarchy(p, planBatchHierarchy(p, { mode: 'quantity', mdbs: { existing: ['MDB-01'] }, smdb: { count: 0, basis: 'total' }, db: { count: 2, basis: 'total' }, incomers: false, names: namesOf(p) }));
    expect(q.boards.map((b) => b.id)).toEqual(expect.arrayContaining(['LP-01', 'LP-02']));
    expect(prefixOf({ ...p, panelPrefixes: { DB: '  ' } }, 'DB')).toBe('DB');
  });

  it('rename by level uses the role prefix (EDB below an EMDB)', () => {
    let p = base();
    p = add(p, planEmergency(p, { count: 1, mainsFrom: 'MDB-01', esmdb: 0, edb: 1, incomers: true }));
    const L2 = floorList(p.building).find((f) => f.tag === 'L02')!;
    p = { ...p, boards: p.boards.map((b) => (b.id === 'EDB-01' || b.id === 'DB-01' ? { ...b, level: L2.ref } : b)) };
    expect(renameByLevel(p).map((r) => [r.from, r.to])).toEqual(expect.arrayContaining([['EDB-01', 'EDB-L2'], ['DB-01', 'DB-L2']]));
  });

  it('checks: mains panel required, counts whole, a second EMDB is flagged', () => {
    expect(planEmergency(base(), { count: 1, mainsFrom: 'NOPE', esmdb: 0, edb: 0, incomers: true }).ok).toBe(false);
    expect(planEmergency(base(), { count: 1.5, mainsFrom: 'MDB-01', esmdb: 0, edb: 0, incomers: true }).ok).toBe(false);
    const two = planEmergency(base(), { count: 2, mainsFrom: 'MDB-01', esmdb: 0, edb: 0, incomers: true });
    expect(two.boards.map((b) => b.id)).toEqual(['EMDB-01', 'EMDB-02']);
    expect(two.checks.some((c) => /normally one/.test(c.text))).toBe(true);
  });
});
