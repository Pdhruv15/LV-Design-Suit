import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { issueRevision } from './revisions';
import { addOp, applyModification, newModification, transition, withRecord, type ModificationRecord } from './designChanges';
import { proposalOutstanding } from './proposalStatus';
import { record, redo, reset, undo } from './history';
import { runCalculations } from '../calc/runs';
import { buildDashboard } from '../calc/dashboard';
import { projectReadiness } from '../calc/projectReadiness';
import { diffProjects } from './revisions';
import type { Project } from '../types';

const NOW = new Date('2026-10-06T08:00:00Z');
const f0 = 'DB-GF1-R3';
const base = (): Project => issueRevision(sampleProject, { description: 'Issued', date: '2026-10-01' });
const feeder = (p: Project) => p.feeders.find((f) => f.id === f0)!;
const draft = (p: Project) => addOp(p, newModification(p, { title: 'T', reason: 'R' }, NOW), 'feeder', f0, 'cableCsaMm2', feeder(p).cableCsaMm2 + 10);
const to = (p: Project, r: ModificationRecord, ...s: ('proposed' | 'review' | 'accepted')[]) => { for (const x of s) { const t = transition(p, r, x, { by: 'Asha', note: 'ok', now: NOW }); if (!t.ok) throw new Error(t.error); r = t.record; } return r; };

describe('M5 — undo and redo', () => {
  it('(8) undoing an application restores the design and the record together; redo restores both', () => {
    const p = base(), r = to(p, draft(p), 'proposed', 'accepted'), q = withRecord(p, r);
    const a = applyModification(q, r.id, { now: NOW }); if (!a.ok) throw new Error(a.error);
    let h = record(reset(q), a.project, 10_000); // the app applies as one history step
    h = undo(h);
    expect(feeder(h.present).cableCsaMm2).toBe(feeder(p).cableCsaMm2);
    expect(h.present.modifications![0].applied).toBeUndefined();
    expect(h.present.modifications![0].status).toBe('accepted'); // can be applied again after the undo
    h = redo(h);
    expect(feeder(h.present).cableCsaMm2).toBe(feeder(p).cableCsaMm2 + 10);
    expect(h.present.modifications![0].applied).toBeDefined();
    // applying again after an undo works once, not twice
    const again = applyModification(undo(record(reset(q), a.project, 10_000)).present, r.id);
    expect(again.ok).toBe(true);
  });
  it('(14) bookkeeping is not an engineering change; applying the values is', () => {
    const p = base(), r = to(p, draft(p), 'proposed', 'accepted'), q = withRecord(p, r);
    const snap = p.revisions![0].snapshot as unknown as Project;
    expect(diffProjects(snap, q).changes.filter((c) => c.class === 'engineering')).toEqual([]);
    const a = applyModification(q, r.id); if (!a.ok) throw new Error(a.error);
    expect(diffProjects(snap, a.project).changes.some((c) => c.class === 'engineering')).toBe(true);
  });
});

describe('M5 — outstanding actions and readiness', () => {
  it('lists pending proposals for information but does not call them failed checks', () => {
    const p = base(), q = withRecord(withRecord(p, draft(p)), { ...to(p, { ...draft(p), id: 'MOD-002' }, 'proposed') });
    const o = proposalOutstanding(q);
    expect(o.counts).toMatchObject({ draft: 1, awaitingDecision: 1 });
    expect(o.todo).toEqual([]);
  });
  it('an accepted record whose values changed is a conflict to reconcile', () => {
    const p = base(), r = to(p, draft(p), 'proposed', 'accepted');
    const q = withRecord({ ...p, feeders: p.feeders.map((f) => (f.id === f0 ? { ...f, cableCsaMm2: 120 } : f)) }, r);
    const o = proposalOutstanding(q);
    expect(o.counts.conflicts).toBe(1);
    expect(o.todo[0].text).toContain('reconcile');
  });
  it('an applied record needs the studies run again, and acceptance alone does not make the design ready', () => {
    const p = base(), r = to(p, draft(p), 'proposed', 'accepted');
    const a = applyModification(withRecord(p, r), r.id, { now: NOW }); if (!a.ok) throw new Error(a.error);
    expect(proposalOutstanding(a.project, undefined).counts.needRerun).toBe(1);
    expect(proposalOutstanding(a.project, runCalculations(p, NOW.getTime() + 1)).counts.needRerun).toBe(1); // run on the old design
    const fresh = runCalculations(a.project, NOW.getTime() + 1);
    expect(proposalOutstanding(a.project, fresh).counts.needRerun).toBe(0);
    // readiness: with the applied record not yet re-run, Resolve issues is not complete; accepted alone adds no failure
    const dash = buildDashboard(a.project, runCalculations(p, NOW.getTime() + 1), []);
    expect(dash.todo.some((t) => t.text.includes('MOD-001'))).toBe(true);
    const stage = projectReadiness(a.project, dash, fresh, [], true).find((s) => s.id === 'resolve')!;
    const cleanDash = buildDashboard(a.project, fresh, []);
    expect(cleanDash.todo.some((t) => t.text.includes('MOD-001'))).toBe(false);
    expect(stage).toBeDefined();
  });
  it('an unsound imported record is flagged, not silently trusted', () => {
    const p = base();
    const bad = { ...draft(p), history: [] } as ModificationRecord;
    expect(proposalOutstanding(withRecord(p, bad)).counts.unsound).toBe(1);
  });
  it('(12) legacy and fresh projects have nothing outstanding', () => {
    expect(proposalOutstanding(sampleProject).todo).toEqual([]);
  });
});
