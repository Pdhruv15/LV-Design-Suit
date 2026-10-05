import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { UPS_DEFAULTS } from '../calc/ups';
import { issueRevision, changedSinceRevision } from './revisions';
import { setBaseline } from './designBaseline';
import {
  addOp, allowedNext, applyModification, conflictsOf, currentValue, describeOp, impactOfProposal, ModificationError, newModification, PROPOSABLE, reconcile, recordFromDraft, removeOp, transition,
  withProposal, withRecord, type ModificationRecord
} from './designChanges';
import type { Project } from '../types';

const NOW = new Date('2026-10-06T08:00:00Z');
const f0 = 'DB-GF1-R3';
const base = (): Project => ({
  ...issueRevision({ ...sampleProject, upsSystems: [{ ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', boardId: 'DB-GF1', chem: 'li-ion', blockV: 51.2, loads: [] }] }, { description: 'Issued', date: '2026-10-01' }),
});
const feeder = (p: Project, id = f0) => p.feeders.find((f) => f.id === id)!;

/** A draft record with a cable and a breaker change, proposed and accepted. */
function accepted(p: Project): { p: Project; id: string } {
  let r = newModification(p, { title: 'Upsize cooker circuit', reason: 'Consultant comment 12', origin: 'DEWA comment 12', author: 'Ravi' }, NOW);
  r = addOp(p, r, 'feeder', f0, 'cableCsaMm2', feeder(p).cableCsaMm2 + 10);
  r = addOp(p, r, 'feeder', f0, 'breakerRatingA', feeder(p).breakerRatingA + 16);
  for (const s of ['proposed', 'review', 'accepted'] as const) {
    const t = transition(p, r, s, { by: 'Asha', note: s === 'accepted' ? 'Agreed' : undefined, now: NOW });
    if (!t.ok) throw new Error(t.error);
    r = t.record;
  }
  return { p: withRecord(p, r), id: r.id };
}

describe('creating a modification', () => {
  it('numbers records, notes the baseline, and captures the current value as "before"', () => {
    const p = base();
    const r = newModification(p, { title: ' Cable ', reason: ' why ', author: 'Ravi' }, NOW);
    expect(r).toMatchObject({ id: 'MOD-001', title: 'Cable', reason: 'why', status: 'draft', baselineRevisionId: 'A', author: 'Ravi' });
    const r2 = addOp(p, r, 'feeder', f0, 'cableCsaMm2', 50);
    expect(r2.ops[0]).toMatchObject({ target: 'feeder', targetId: f0, field: 'cableCsaMm2', label: 'Cable (mm²)', before: feeder(p).cableCsaMm2, after: 50 });
    expect(newModification(withRecord(p, r2), { title: 't', reason: 'r' }, NOW).id).toBe('MOD-002');
    expect(describeOp(r2.ops[0])).toEqual({ item: `${f0} — Cable (mm²)`, from: String(feeder(p).cableCsaMm2), to: '50' });
  });

  it('refuses what cannot be proposed: unknown fields, missing items, wrong types, and editing after it is proposed', () => {
    const p = base();
    const r = newModification(p, { title: 't', reason: 'r' }, NOW);
    expect(() => addOp(p, r, 'feeder', f0, 'id', 'X')).toThrow(ModificationError);
    expect(() => addOp(p, r, 'feeder', f0, 'boardId', 'MDB-1')).toThrow(/cannot be proposed/);
    expect(() => addOp(p, r, 'feeder', 'GHOST', 'loadKw', 3)).toThrow(/does not exist/);
    expect(() => addOp(p, r, 'feeder', f0, 'loadKw', Number.NaN)).toThrow(/needs a number/);
    expect(() => addOp(p, r, 'feeder', f0, 'essential', 'yes')).toThrow(/yes or no/);
    expect(() => addOp(p, r, 'feeder', f0, 'cableType', '  ')).toThrow(/needs a value/);
    const filled = addOp(p, r, 'feeder', f0, 'loadKw', 3);
    const proposed = transition(p, filled, 'proposed', { now: NOW });
    expect(proposed.ok && (() => { try { addOp(p, proposed.record, 'feeder', f0, 'loadKw', 4); return false; } catch { return true; } })()).toBe(true);
    expect(() => removeOp(proposed.ok ? proposed.record : filled, 'x')).toThrow();
  });

  it('a second change to the same item and field replaces the first', () => {
    const p = base();
    let r = newModification(p, { title: 't', reason: 'r' }, NOW);
    r = addOp(p, r, 'feeder', f0, 'loadKw', 3); r = addOp(p, r, 'feeder', f0, 'loadKw', 4);
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0].after).toBe(4);
    expect(removeOp(r, r.ops[0].id).ops).toEqual([]);
  });

  it('covers circuits, panels, UPS systems and project settings', () => {
    const p = base();
    let r = newModification(p, { title: 't', reason: 'r' }, NOW);
    r = addOp(p, r, 'board', 'MDB-1', 'ratedCurrentA', 2500);
    r = addOp(p, r, 'ups', 'u1', 'autonomyMin', 60);
    r = addOp(p, r, 'project', undefined, 'ambientC', 50);
    expect(r.ops.map((o) => o.label)).toEqual(['Rating (A)', 'Backup time (min)', 'Ambient (°C)']);
    const hyp = withProposal(p, r);
    expect(hyp.boards.find((b) => b.id === 'MDB-1')!.ratedCurrentA).toBe(2500);
    expect(hyp.upsSystems![0].autonomyMin).toBe(60);
    expect(hyp.ambientC).toBe(50);
    expect(p.ambientC).not.toBe(50); // the working design is untouched by a preview
    expect(PROPOSABLE.feeder.every((f) => f.label && f.key)).toBe(true);
  });
});

describe('lifecycle', () => {
  it('allows only the defined steps, requires content to propose, and records a decision', () => {
    const p = base();
    let r = newModification(p, { title: 'T', reason: 'R' }, NOW);
    expect(allowedNext(r)).toEqual(['proposed', 'superseded']);
    expect(transition(p, r, 'proposed').ok).toBe(false); // no changes yet
    expect(transition(p, r, 'accepted')).toMatchObject({ ok: false });
    r = addOp(p, r, 'feeder', f0, 'loadKw', 3);
    expect(transition(p, { ...r, reason: '' }, 'proposed')).toMatchObject({ ok: false, error: expect.stringContaining('reason') });
    const t1 = transition(p, r, 'proposed', { by: 'Ravi', now: NOW }); if (!t1.ok) throw new Error(t1.error);
    const t2 = transition(p, t1.record, 'review', { by: 'Asha', now: NOW }); if (!t2.ok) throw new Error(t2.error);
    const t3 = transition(p, t2.record, 'accepted', { by: 'Asha', note: 'OK to proceed', now: NOW }); if (!t3.ok) throw new Error(t3.error);
    expect(t3.record.status).toBe('accepted');
    expect(t3.record.decision).toEqual({ outcome: 'accepted', by: 'Asha', at: NOW.toISOString(), note: 'OK to proceed' });
    expect(t3.record.history.map((h) => h.status)).toEqual(['draft', 'proposed', 'review', 'accepted']);
    expect(transition(p, t3.record, 'rejected').ok).toBe(false); // a decision is final
    const rej = transition(p, t1.record, 'rejected', { by: 'Asha', note: 'Not needed', now: NOW }); if (!rej.ok) throw new Error(rej.error);
    expect(rej.record.decision).toMatchObject({ outcome: 'rejected', note: 'Not needed' });
    expect(allowedNext(rej.record)).toEqual([]);
  });

  it('supersede needs to say what replaces it, and is terminal', () => {
    const p = base();
    const r = addOp(p, newModification(p, { title: 'T', reason: 'R' }, NOW), 'feeder', f0, 'loadKw', 3);
    expect(transition(p, r, 'superseded').ok).toBe(false);
    const s = transition(p, r, 'superseded', { supersededBy: 'MOD-002', now: NOW }); if (!s.ok) throw new Error(s.error);
    expect(s.record).toMatchObject({ status: 'superseded', supersededBy: 'MOD-002' });
    expect(allowedNext(s.record)).toEqual([]);
  });
});

describe('applying', () => {
  it('applies an accepted modification atomically: only the proposed values change, the record shows it was applied', () => {
    const { p, id } = accepted(base());
    const before = feeder(p);
    const r = applyModification(p, id, { by: 'Ravi', now: NOW });
    if (!r.ok) throw new Error(r.error);
    const after = feeder(r.project);
    expect(after.cableCsaMm2).toBe(before.cableCsaMm2 + 10);
    expect(after.breakerRatingA).toBe(before.breakerRatingA + 16);
    expect({ ...after, cableCsaMm2: before.cableCsaMm2, breakerRatingA: before.breakerRatingA }).toEqual(before);
    expect(r.project.feeders.filter((f) => f.id !== f0).every((f, i) => f === p.feeders.filter((x) => x.id !== f0)[i])).toBe(true); // untouched items keep their identity
    expect(r.project.boards).toBe(p.boards);
    expect(r.project.modifications![0].applied).toMatchObject({ at: NOW.toISOString(), by: 'Ravi', source: 'applied', opIds: r.applied });
    expect(p.modifications![0].applied).toBeUndefined(); // the input is not modified
    expect(applyModification(r.project, id).ok).toBe(false); // once only
    expect(changedSinceRevision(r.project)).toBe(true); // it is a design change against the issued revision
  });

  it('a modification that is rejected, draft, proposed, under review or superseded never changes the design', () => {
    const p0 = base();
    let r = addOp(p0, newModification(p0, { title: 'T', reason: 'R' }, NOW), 'feeder', f0, 'loadKw', 9);
    let p = withRecord(p0, r);
    const step = (to: Parameters<typeof transition>[2], opts = {}) => { const t = transition(p, r, to, { now: NOW, ...opts }); if (!t.ok) throw new Error(t.error); r = t.record; p = withRecord(p, r); };
    for (const check of ['draft', 'proposed', 'review'] as const) {
      if (check === 'proposed') step('proposed'); if (check === 'review') step('review');
      const res = applyModification(p, r.id);
      expect(res.ok).toBe(false);
      expect(feeder(p).loadKw).toBe(feeder(p0).loadKw);
    }
    step('rejected', { note: 'No' });
    expect(applyModification(p, r.id)).toMatchObject({ ok: false, error: expect.stringContaining('rejected') });
    expect(applyModification(p, 'MOD-999').ok).toBe(false);
    expect(p.feeders).toBe(p0.feeders);
  });

  it('works for panels, UPS systems and project settings too', () => {
    const p0 = base();
    let r = newModification(p0, { title: 'Multi', reason: 'R' }, NOW);
    r = addOp(p0, r, 'board', 'MDB-1', 'ratedCurrentA', 3200); r = addOp(p0, r, 'ups', 'u1', 'autonomyMin', 90); r = addOp(p0, r, 'project', undefined, 'ambientC', 52);
    let p = withRecord(p0, r);
    for (const s of ['proposed', 'accepted'] as const) { const t = transition(p, r, s, { now: NOW }); if (!t.ok) throw new Error(t.error); r = t.record; p = withRecord(p, r); }
    const res = applyModification(p, r.id, { now: NOW }); if (!res.ok) throw new Error(res.error);
    expect(res.project.boards.find((b) => b.id === 'MDB-1')!.ratedCurrentA).toBe(3200);
    expect(res.project.upsSystems![0].autonomyMin).toBe(90);
    expect(res.project.ambientC).toBe(52);
  });
});

describe('edits made since the proposal', () => {
  const edited = (p: Project, patch: Record<string, unknown>) => ({ ...p, feeders: p.feeders.map((f) => (f.id === f0 ? { ...f, ...patch } : f)) });

  it('are never overwritten silently: apply stops and names them, leaving the design exactly as it was', () => {
    const { p, id } = accepted(base());
    const changed = edited(p, { cableCsaMm2: 120 });
    const r = applyModification(changed, id);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('changed since this was proposed') });
    if (r.ok) throw new Error('should stop');
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts![0]).toMatchObject({ kind: 'changed', current: 120, op: { field: 'cableCsaMm2' } });
    expect(changed.feeders.find((f) => f.id === f0)!.cableCsaMm2).toBe(120);
    expect(changed.modifications![0].applied).toBeUndefined();
  });

  it('can be overwritten on purpose, or skipped, and the record says which', () => {
    const { p, id } = accepted(base());
    const changed = edited(p, { cableCsaMm2: 120 });
    const over = applyModification(changed, id, { onConflict: 'overwrite', now: NOW }); if (!over.ok) throw new Error(over.error);
    expect(feeder(over.project).cableCsaMm2).toBe(feeder(p).cableCsaMm2 + 10);
    expect(feeder(over.project).breakerRatingA).toBe(feeder(p).breakerRatingA + 16);
    expect(over.project.modifications![0].applied!.overwritten).toHaveLength(1);
    const skip = applyModification(changed, id, { onConflict: 'skip', now: NOW }); if (!skip.ok) throw new Error(skip.error);
    expect(feeder(skip.project).cableCsaMm2).toBe(120); // the later edit stays
    expect(feeder(skip.project).breakerRatingA).toBe(feeder(p).breakerRatingA + 16);
    expect(skip.project.modifications![0].applied!.skipped).toHaveLength(1);
  });

  it('a deleted item can never be overwritten: its changes are skipped, and with nothing left nothing is applied', () => {
    const { p, id } = accepted(base());
    const gone = { ...p, feeders: p.feeders.filter((f) => f.id !== f0) };
    expect(conflictsOf(gone, gone.modifications![0]).every((c) => c.kind === 'missing')).toBe(true);
    const r = applyModification(gone, id, { onConflict: 'overwrite' });
    expect(r).toMatchObject({ ok: false, error: 'Nothing can be applied.' });
    expect(currentValue(gone, { target: 'feeder', targetId: f0, field: 'loadKw' }).exists).toBe(false);
  });

  it('accepting an old proposal that no longer matches needs reconciling first, and that is recorded', () => {
    const p0 = base();
    let r = addOp(p0, newModification(p0, { title: 'T', reason: 'R' }, NOW), 'feeder', f0, 'cableCsaMm2', 70);
    const proposed = transition(p0, r, 'proposed', { now: NOW }); if (!proposed.ok) throw new Error(proposed.error);
    r = proposed.record;
    const p = edited(withRecord(p0, r), { cableCsaMm2: 95 }); // someone changed it meanwhile
    const refused = transition(p, r, 'accepted', { by: 'Asha' });
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('reconcile') });
    if (refused.ok) throw new Error('should refuse');
    expect(refused.conflicts).toHaveLength(1);
    const rec = reconcile(p, r, 'Asha', NOW);
    expect(rec.ops[0].before).toBe(95);
    expect(rec.history[rec.history.length - 1].note).toMatch(/Reconciled: 1 value re-based/);
    expect(transition(p, rec, 'accepted', { by: 'Asha', now: NOW }).ok).toBe(true);
    expect(reconcile(p, rec)).toBe(rec); // nothing left to reconcile
  });
});

describe('previewing a proposal', () => {
  it('lists panels, studies and documents from the model, and changes nothing', () => {
    const p = base();
    let r = newModification(p, { title: 'T', reason: 'R' }, NOW);
    r = addOp(p, r, 'feeder', f0, 'lengthM', feeder(p).lengthM + 30);
    const frozen = JSON.stringify(p);
    const i = impactOfProposal(p, r);
    expect(i.panels.find((x) => x.id === 'DB-GF1')!.why).toBe('changed');
    expect(i.studies.map((s) => s.id)).toEqual(expect.arrayContaining(['vd', 'fault']));
    expect(i.documents.map((d) => d.label)).toContain('Cable schedule');
    expect(JSON.stringify(p)).toBe(frozen);
  });
});

describe('recording what was already changed in the draft', () => {
  it('turns the draft’s field edits into a record with the baseline’s values as "before", already applied', () => {
    const p0 = setBaseline(base(), 'A');
    const p = { ...p0, feeders: p0.feeders.map((f) => (f.id === f0 ? { ...f, cableCsaMm2: f.cableCsaMm2 + 25, remarks: 'note' } : f)), ambientC: 48 };
    const res = recordFromDraft(p, { title: 'Draft edits', reason: 'Site conditions', author: 'Ravi' }, NOW)!;
    expect(res.record.ops.map((o) => [o.targetId ?? 'project', o.field])).toEqual([[f0, 'cableCsaMm2'], ['project', 'ambientC']]);
    expect(res.record.ops[0]).toMatchObject({ before: feeder(p0).cableCsaMm2, after: feeder(p0).cableCsaMm2 + 25 });
    expect(res.record.applied).toMatchObject({ source: 'draft', opIds: res.record.ops.map((o) => o.id) });
    expect(res.unsupported).toBe(1); // the remark is not a proposable field
    expect(recordFromDraft(p0, { title: 't', reason: 'r' }, NOW)).toBeUndefined(); // nothing changed
    expect(recordFromDraft(sampleProject, { title: 't', reason: 'r' })).toBeUndefined(); // no baseline
  });

  it('counts added and removed equipment as unsupported rather than guessing', () => {
    const p0 = setBaseline(base(), 'A');
    const p = { ...p0, feeders: [...p0.feeders.filter((f) => f.id !== 'DB-GF1-B1'), { ...p0.feeders[0], id: 'NEW-1' }], ambientC: 47 };
    expect(recordFromDraft(p, { title: 't', reason: 'r' }, NOW)!.unsupported).toBe(2);
  });
});

describe('persistence', () => {
  it('records survive saving and reopening, and are administration, not design', () => {
    const { p } = accepted(base());
    const back = JSON.parse(JSON.stringify(p)) as Project;
    expect(back.modifications).toEqual(p.modifications);
    expect(changedSinceRevision(p)).toBe(false); // adding a record is not a design change
    const rec: ModificationRecord = back.modifications![0];
    expect(rec.status).toBe('accepted');
  });
});
