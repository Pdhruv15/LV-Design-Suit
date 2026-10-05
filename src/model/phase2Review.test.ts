import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { buildDashboard } from '../calc/dashboard';
import { projectReadiness } from '../calc/projectReadiness';
import { sizeUps, upsLoad, UPS_DEFAULTS, type UpsSystem } from '../calc/ups';
import { sheetsByCount } from './drawingSet';
import { deleteBoard } from './edit';
import { renamePanels } from './renamePanels';
import { pasteBoard } from './copyBoard';
import { applyMove } from './sldEdit';
import { checkReferences } from './integrity';
import { changedSinceRevision, diffProjects, issueRevision } from './revisions';
import { withEarthPitIds } from './earthingPlan';
import type { Project } from '../types';

const issuedProject = (): Project => {
  const p: Project = { ...withEarthPitIds(sampleProject), drawingSet: sheetsByCount(sampleProject, 10) };
  return issueRevision(p, { description: 'A', date: '2026-10-01' });
};

describe('issued revisions are never rewritten by working-draft edits', () => {
  const frozen = (p: Project) => JSON.stringify(p.revisions);
  const integrity = (p: Project) => JSON.stringify(checkReferences(p.revisions![0].snapshot as Project));
  const ops: [string, (p: Project) => Project][] = [
    ['rename a sub-main panel', (p) => renamePanels(p, [{ from: 'SMDB-GF', to: 'SMDB-L1' }])],
    ['rename a main board', (p) => renamePanels(p, [{ from: 'MDB-1', to: 'MDB-MAIN' }])],
    ['move a branch', (p) => applyMove(p, { kind: 'board', id: 'DB-GF1' }, { type: 'bus', boardId: 'SMDB-FF' }).project],
    ['copy a panel', (p) => pasteBoard(p, 'DB-GF1', 'SMDB-FF', { idFind: 'GF1', idReplace: 'FF9', nameFind: '', nameReplace: '' }).project],
    ['delete a panel', (p) => deleteBoard(p, 'DB-GF1')],
    ['delete a branch', (p) => deleteBoard(p, 'SMDB-GF')]
  ];
  it.each(ops)('%s leaves every snapshot byte-identical and its references exactly as they were', (_name, op) => {
    const p = issuedProject();
    const before = frozen(p), refs = integrity(p);
    const after = op(p);
    expect(after).not.toBe(p);
    expect(frozen(after)).toBe(before);
    expect(after.revisions).toBe(p.revisions);
    expect(integrity(after)).toBe(refs);
    expect(refs).toBe('[]'); // the issued design is consistent, and stays so
  });

  it('the comparison with the issued revision then shows the rename as a change, not a corrupted baseline', () => {
    const p = renamePanels(issuedProject(), [{ from: 'SMDB-GF', to: 'SMDB-L1' }]);
    const d = diffProjects(p.revisions![0].snapshot, p);
    expect(d.changes.some((c) => c.what === 'board' && c.kind === 'removed' && c.id === 'SMDB-GF')).toBe(true);
    expect(d.changes.some((c) => c.what === 'board' && c.kind === 'added' && c.id === 'SMDB-L1')).toBe(true);
    expect(changedSinceRevision(p)).toBe(true);
  });
});

describe('deleting the panel a UPS is sized from', () => {
  const ups = (patch: Partial<UpsSystem> = {}): UpsSystem => ({ ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', boardId: 'SMDB-GF', chem: 'li-ion', blockV: 51.2, loads: [], ...patch });
  const base = (): Project => ({ ...sampleProject, upsSystems: [ups()] });

  it('reproduces the review case: the load was the panel’s demand; after deleting it the study is unresolved, not zero-load and valid', () => {
    const p = base();
    expect(upsLoad(p, p.upsSystems![0]).kw).toBeGreaterThan(100);
    const r = deleteBoard(p, 'SMDB-GF');
    const u = r.upsSystems![0];
    expect(u.boardId).toBe('SMDB-GF'); // the source is not silently changed
    expect(upsLoad(r, u)).toEqual({ kva: 0, kw: 0 }); // and never falls back to the empty manual list
    const sized = sizeUps(r, u);
    expect(sized.sourceIssue).toMatch(/SMDB-GF no longer exists/);
    expect(sized.batteryIssue).toBe(sized.sourceIssue);
    expect(sized.upsKva).toBeUndefined();
    expect(sized.blockAh).toBeUndefined();
    expect(checkReferences(r)).toContainEqual({ where: 'UPS UPS-1', ref: 'SMDB-GF', problem: 'UPS panel does not exist', view: 'ups' });
  });

  it('the To do list and readiness show it as failing until resolved', () => {
    const r = deleteBoard(base(), 'SMDB-GF');
    const todo = buildDashboard(r).todo.filter((t) => t.go?.view === 'ups');
    expect(todo.some((t) => t.status === 'bad' && t.text.includes('linked UPS board is missing'))).toBe(true);
    expect(projectReadiness(r, buildDashboard(r)).find((s) => s.id === 'resolve')!.done).toBe(false);
  });

  it('deliberately unlinking and entering loads, or reassigning to another panel, makes it valid again', () => {
    const r = deleteBoard(base(), 'SMDB-GF');
    const manual = { ...r.upsSystems![0], boardId: undefined, loads: [{ id: 'l', name: 'Servers', qty: 1, w: 12000 }] };
    const m = sizeUps(r, manual);
    expect(m.sourceIssue).toBeUndefined();
    expect(m.loadKw).toBeCloseTo(12, 6);
    expect(m.upsKva).toBeDefined();
    const reassigned = sizeUps(r, { ...r.upsSystems![0], boardId: 'SMDB-FF' });
    expect(reassigned.sourceIssue).toBeUndefined();
    expect(reassigned.loadKw).toBeGreaterThan(0);
  });

  it('a UPS with no panel link at all, and an empty load list, is unaffected', () => {
    expect(sizeUps(sampleProject, ups({ boardId: undefined })).sourceIssue).toBeUndefined();
  });
});

describe('small real edits are detected, not hidden by how numbers print', () => {
  const upsA: UpsSystem = { ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', chem: 'vrla', blockV: 12, endCellV: 1.7501, loads: [] };
  const issuedWith = (p: Partial<Project>) => issueRevision({ ...withEarthPitIds(sampleProject), ...p }, { description: 'A' });
  const change = (p: Project) => diffProjects(p.revisions![0].snapshot, p).changes;

  it('UPS end-of-discharge voltage 1.7501 → 1.7502', () => {
    const a = issuedWith({ upsSystems: [upsA] });
    const b = { ...a, upsSystems: [{ ...upsA, endCellV: 1.7502 }] };
    expect(changedSinceRevision(b)).toBe(true);
    expect(change(b)[0].fields).toContainEqual({ field: 'End voltage per cell (V)', from: '1.7501', to: '1.7502' });
  });

  it('circuit and panel inputs differing in the fourth decimal', () => {
    const a = issuedWith({});
    const f0 = a.feeders[0], b0 = a.boards[0];
    const edited = { ...a, feeders: a.feeders.map((f) => (f === f0 ? { ...f, lengthM: f.lengthM + 0.0004 } : f)), boards: a.boards.map((b) => (b === b0 ? { ...b, sourceImpedancePct: (b.sourceImpedancePct ?? 5) + 0.0003 } : b)) };
    const d = change(edited);
    const len = d.find((c) => c.id === f0.id)!.fields.find((x) => x.field === 'Length (m)')!;
    expect(len.from).not.toBe(len.to);
    expect(Number(len.to) - Number(len.from)).toBeCloseTo(0.0004, 6);
    expect(d.find((c) => c.id === b0.id)!.fields.find((x) => x.field === 'Transformer Z (%)')).toBeDefined();
    expect(changedSinceRevision(edited)).toBe(true);
  });

  it('numerically equal values, key order and harmless empty representations are not changes', () => {
    const a = issuedWith({ upsSystems: [upsA] });
    const same = {
      ...a,
      upsSystems: [{ ...upsA, endCellV: Number('1.7501'), rateCapacityPct: undefined, blockAhOptions: [] as number[], loads: [] }],
      feeders: a.feeders.map((f, i) => (i === 0 ? { ...f, remarks: '', points: { ...f.points, extra: 0 } as never } : f))
    };
    expect(change(same)).toEqual([]);
    expect(changedSinceRevision(same)).toBe(false);
    // nested object key order does not matter
    const reordered = { ...a, upsSystems: [{ ...upsA, surge: { source: 's', totalKw: 1, ratedKw: 2 } as never }] };
    const reordered2 = { ...reordered, upsSystems: [{ ...upsA, surge: { ratedKw: 2, totalKw: 1, source: 's' } as never }] };
    expect(diffProjects(reordered.upsSystems ? { ...reordered, revisions: undefined } as never : reordered, { ...reordered2 } as never).changes).toEqual([]);
  });

  it('an old 3-decimal difference is still shown compactly, and a real zero is a value', () => {
    const a = issuedWith({});
    const f0 = a.feeders[0];
    const d = change({ ...a, feeders: a.feeders.map((f) => (f === f0 ? { ...f, loadKw: 7.5 } : f)) });
    expect(d[0].fields.find((x) => x.field === 'Load (kW)')!.to).toBe('7.5');
    const z = change({ ...a, feeders: a.feeders.map((f) => (f === f0 ? { ...f, demandFactor: 0 } : f)) });
    expect(z[0].fields.find((x) => x.field === 'Demand factor')).toBeDefined();
  });
});
