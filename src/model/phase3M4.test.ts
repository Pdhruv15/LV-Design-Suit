import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { issueRevision } from './revisions';
import { addOp, appliedFollowUp, applyModification, newModification, transition, withRecord, type ModificationRecord } from './designChanges';
import { runCalculations } from '../calc/runs';
import type { Project } from '../types';

const NOW = new Date('2026-10-06T08:00:00Z');
const f0 = 'DB-GF1-R3', f1 = 'DB-GF1-R1';
const base = (): Project => issueRevision(sampleProject, { description: 'Issued', date: '2026-10-01' });
const feeder = (p: Project, id = f0) => p.feeders.find((f) => f.id === id)!;
const accept = (p: Project, r: ModificationRecord) => {
  for (const s of ['proposed', 'accepted'] as const) { const t = transition(p, r, s, { by: 'Asha', note: 'ok', now: NOW }); if (!t.ok) throw new Error(t.error); r = t.record; }
  return r;
};
const two = (p: Project) => addOp(p, addOp(p, newModification(p, { title: 'T', reason: 'R' }, NOW), 'feeder', f0, 'cableCsaMm2', feeder(p).cableCsaMm2 + 10), 'feeder', f1, 'loadKw', feeder(p, f1).loadKw + 1);

describe('M4 — decisions', () => {
  it('a decision records who, when, why and where the evidence is; a rejection needs a reason', () => {
    const p = base(), r = two(p);
    const prop = transition(p, r, 'proposed', { now: NOW }); if (!prop.ok) throw new Error(prop.error);
    expect(transition(p, prop.record, 'accepted', { now: NOW })).toMatchObject({ ok: false, error: expect.stringContaining('who') });
    expect(transition(p, prop.record, 'rejected', { by: 'Asha', now: NOW })).toMatchObject({ ok: false, error: expect.stringContaining('reason') });
    const acc = transition(p, prop.record, 'accepted', { by: 'Asha', note: 'Meets DEWA comment 12', evidenceRef: 'Email 2026-10-05', now: NOW }); if (!acc.ok) throw new Error(acc.error);
    expect(acc.record.decision).toEqual({ outcome: 'accepted', by: 'Asha', at: NOW.toISOString(), note: 'Meets DEWA comment 12', evidenceRef: 'Email 2026-10-05' });
  });
  it('accepting never touches the design; applying is a separate step', () => {
    const p = base(), r = accept(p, two(p)), q = withRecord(p, r);
    expect(JSON.stringify(q.feeders)).toBe(JSON.stringify(p.feeders));
    expect(r.applied).toBeUndefined();
  });
});

describe('M4 — conflicts and atomic application', () => {
  it('(2) unrelated edits — a project contact, a name, pricing — do not block application', () => {
    const p = base(), r = accept(p, two(p));
    const edited = withRecord({ ...p, info: { ...p.info, tel: '04 000 0000' }, name: 'Renamed', boq: { projectType: 'fit-out' } as Project['boq'], feeders: p.feeders.map((f) => (f.id === 'FF-OFF' ? { ...f, remarks: 'x' } : f)) }, r);
    const a = applyModification(edited, r.id, { by: 'Ravi', now: NOW });
    expect(a.ok).toBe(true);
    if (a.ok) { expect(feeder(a.project).cableCsaMm2).toBe(feeder(p).cableCsaMm2 + 10); expect(a.project.info?.tel).toBe('04 000 0000'); }
  });
  it('(3) a target changed independently blocks application with expected, current and proposed values', () => {
    const p = base(), r = accept(p, two(p));
    const changed = withRecord({ ...p, feeders: p.feeders.map((f) => (f.id === f0 ? { ...f, cableCsaMm2: 120 } : f)) }, r);
    const a = applyModification(changed, r.id);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.conflicts![0]).toMatchObject({ kind: 'changed', current: 120, op: { before: feeder(p).cableCsaMm2, after: feeder(p).cableCsaMm2 + 10 } });
    expect(feeder(changed, f1).loadKw).toBe(feeder(p, f1).loadKw); // nothing else moved
  });
  it('(4) a removed target fails the application and alters no other target', () => {
    const p = base(), r = accept(p, two(p));
    const gone = withRecord({ ...p, feeders: p.feeders.filter((f) => f.id !== f0) }, r);
    const a = applyModification(gone, r.id);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.conflicts![0].kind).toBe('missing');
    expect(feeder(gone, f1).loadKw).toBe(feeder(p, f1).loadKw);
    expect(gone.modifications![0].applied).toBeUndefined();
  });
  it('(7) a second application is rejected and produces no new record state', () => {
    const p = base(), r = accept(p, two(p));
    const a = applyModification(withRecord(p, r), r.id); if (!a.ok) throw new Error(a.error);
    const again = applyModification(a.project, r.id);
    expect(again).toMatchObject({ ok: false, error: expect.stringContaining('already') });
    expect(a.project.modifications![0].applied!.opIds).toHaveLength(2);
  });
  it('(8) applying changes the design and the record together; restoring the earlier project restores both', () => {
    const p = base(), r = accept(p, two(p)), q = withRecord(p, r);
    const a = applyModification(q, r.id); if (!a.ok) throw new Error(a.error);
    // The application is one new project value: undo is a return to q, redo to a.project.
    expect(feeder(a.project).cableCsaMm2).not.toBe(feeder(q).cableCsaMm2);
    expect(a.project.modifications![0].applied).toBeDefined();
    expect(q.modifications![0].applied).toBeUndefined();
    expect(feeder(q).cableCsaMm2).toBe(feeder(p).cableCsaMm2);
  });
});

describe('M4 — after applying', () => {
  it('shows whether the studies have been re-run on the applied design, and whether the design moved on', () => {
    const p = base(), r = accept(p, two(p));
    const a = applyModification(withRecord(p, r), r.id, { now: new Date(NOW.getTime()) }); if (!a.ok) throw new Error(a.error);
    const rec = a.project.modifications![0];
    expect(appliedFollowUp(a.project, rec, undefined)).toEqual({ designChangedSince: false, studies: 'not run' });
    const stale = runCalculations(p, NOW.getTime() + 1000);
    expect(appliedFollowUp(a.project, rec, stale)?.studies).toBe('out of date');
    const fresh = runCalculations(a.project, NOW.getTime() + 1000);
    expect(appliedFollowUp(a.project, rec, fresh)?.studies).toBe('current');
    const moved = { ...a.project, feeders: a.project.feeders.map((x) => (x.id === f0 ? { ...x, lengthM: x.lengthM + 3 } : x)) };
    expect(appliedFollowUp(moved, rec, fresh)).toMatchObject({ designChangedSince: true, studies: 'out of date' });
    expect(appliedFollowUp(withRecord(p, r), r, fresh)).toBeUndefined();
  });
});
