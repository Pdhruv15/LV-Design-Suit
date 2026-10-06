import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { UPS_DEFAULTS } from '../calc/ups';
import { issueRevision } from './revisions';
import { copyProject } from './projectMigrate';
import { addOp, allowedNext, applyModification, designFingerprint, followUp, newModification, transition, withRecord, type ModificationRecord } from './designChanges';
import { baselineStatus, opProblem, stableHash, validateRecord } from './proposalRules';
import { checkReferences } from './integrity';
import type { Project } from '../types';

const NOW = new Date('2026-10-06T08:00:00Z');
const f0 = 'DB-GF1-R3', f1 = 'DB-GF1-R1';
const base = (): Project => issueRevision({ ...sampleProject, upsSystems: [{ ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', boardId: 'DB-GF1', chem: 'li-ion', blockV: 51.2, loads: [] }] }, { description: 'Issued', date: '2026-10-01' });
const feeder = (p: Project, id = f0) => p.feeders.find((f) => f.id === id)!;
const walk = (p: Project, r: ModificationRecord, steps: ('proposed' | 'review' | 'accepted')[]) => {
  for (const s of steps) { const t = transition(p, r, s, { by: 'Asha', now: NOW }); if (!t.ok) throw new Error(t.error); r = t.record; }
  return r;
};
const drafted = (p: Project) => addOp(p, addOp(p, newModification(p, { title: 'T', reason: 'R', author: 'Ravi' }, NOW), 'feeder', f0, 'cableCsaMm2', feeder(p).cableCsaMm2 + 10), 'feeder', f1, 'loadKw', feeder(p, f1).loadKw + 1);

describe('M1 — typed, validated records', () => {
  it('a sound record has no problems; the baseline fingerprint is recorded', () => {
    const p = base(), r = drafted(p);
    expect(validateRecord(r)).toEqual([]);
    expect(r.baselineFingerprint).toBe(stableHash(p.revisions![0].snapshot));
    expect(baselineStatus(p, r)).toBe('ok');
  });
  it('rejects fields outside the allowlist and unsafe names, including in imported records', () => {
    const p = base(), r = drafted(p);
    const evil = { ...r, ops: [...r.ops, { id: 'x1', target: 'feeder', targetId: f0, field: 'boardId', label: 'x', before: 'a', after: 'b' }, { id: 'x2', target: 'feeder', targetId: '__proto__', field: 'loadKw', label: 'x', after: 1 }] } as ModificationRecord;
    const problems = validateRecord(evil);
    expect(problems.some((x) => x.includes('boardId'))).toBe(true);
    expect(problems.some((x) => x.includes('forbidden'))).toBe(true);
    expect(opProblem({ ...r.ops[0], after: NaN })).toContain('number');
    expect(opProblem({ id: 'p', target: 'project', field: 'voltageV', label: 'V', after: 400, targetId: 'x' })).toBeTruthy();
  });
  it('an unsound imported record cannot be advanced or applied, and nothing changes', () => {
    const p = base();
    const bad = { ...drafted(p), history: [] } as ModificationRecord;
    expect(transition(p, bad, 'proposed')).toMatchObject({ ok: false, error: expect.stringContaining('not sound') });
    expect(validateRecord({ ...drafted(p), id: 'abc' })).not.toEqual([]);
    expect(validateRecord({ ...drafted(p), applied: { at: 'x', source: 'applied', opIds: ['ghost'] } })).not.toEqual([]);
  });
  it('legacy projects without any record load and behave as before', () => {
    const p = { ...sampleProject } as Project;
    expect(p.modifications).toBeUndefined();
    expect(withRecord(p, newModification(p, { title: 'T', reason: 'R' }, NOW)).modifications).toHaveLength(1);
  });
});

describe('M1 — regression scenarios', () => {
  it('(5) two operations, one invalid: neither is applied', () => {
    const p = base(), r = walk(p, drafted(p), ['proposed', 'accepted']);
    const tampered = { ...r, ops: r.ops.map((o, i) => (i ? { ...o, after: Number.NaN } : o)) };
    const q = withRecord(p, tampered);
    const res = applyModification(q, r.id);
    expect(res.ok).toBe(false);
    expect(feeder(q).cableCsaMm2).toBe(feeder(p).cableCsaMm2);
    expect(JSON.stringify(q.feeders)).toBe(JSON.stringify(p.feeders));
  });
  it('(6) accept, then alter an operation: the earlier acceptance cannot authorise the altered content', () => {
    const p = base(), acc = walk(p, drafted(p), ['proposed', 'accepted']);
    expect(() => addOp(p, acc, 'feeder', f0, 'cableCsaMm2', 300)).toThrow(); // frozen
    const back = transition(p, acc, 'draft', { by: 'Asha', now: NOW }); if (!back.ok) throw new Error(back.error);
    expect(back.record.status).toBe('draft');
    expect(back.record.decision).toBeUndefined();
    expect(back.record.history[back.record.history.length - 1]?.note).toContain('no longer stands');
    const altered = addOp(p, back.record, 'feeder', f0, 'cableCsaMm2', 300);
    const q = withRecord(p, altered);
    expect(applyModification(q, altered.id).ok).toBe(false); // a draft is not accepted
    expect(feeder(q).cableCsaMm2).toBe(feeder(p).cableCsaMm2);
    const again = walk(q, altered, ['proposed', 'accepted']); // needs a fresh decision
    expect(again.decision!.at).toBeDefined();
    expect(again.history.map((h) => h.status)).toContain('draft');
  });
  it('(7) an applied record cannot be applied twice or returned to a draft', () => {
    const p = base(), r = walk(p, drafted(p), ['proposed', 'accepted']);
    const q = withRecord(p, r);
    const a = applyModification(q, r.id); if (!a.ok) throw new Error(a.error);
    expect(a.project.modifications![0].applied!.resultFingerprint).toBe(designFingerprint(a.project));
    expect(applyModification(a.project, r.id)).toMatchObject({ ok: false, error: expect.stringContaining('already') });
    expect(allowedNext(a.project.modifications![0])).not.toContain('draft');
  });
  it('a baseline that is missing or whose content differs blocks acceptance and application', () => {
    const p = base(), r = walk(p, drafted(p), ['proposed']);
    const noRev = { ...p, revisions: [] };
    expect(baselineStatus(noRev, r)).toBe('unavailable');
    expect(transition(noRev, r, 'accepted')).toMatchObject({ ok: false, error: expect.stringContaining('Baseline unavailable') });
    const altered = { ...p, revisions: p.revisions!.map((x) => ({ ...x, snapshot: { ...x.snapshot, voltageV: 1 } })) };
    expect(baselineStatus(altered, r)).toBe('changed');
    expect(transition(altered, r, 'accepted').ok).toBe(false);
  });
  it('(14) issued snapshots stay unchanged through every lifecycle action', () => {
    const p = base(), snap = JSON.stringify(p.revisions);
    let r = drafted(p);
    r = walk(p, r, ['proposed', 'review', 'accepted']);
    const q = withRecord(p, r), a = applyModification(q, r.id); if (!a.ok) throw new Error(a.error);
    const fu = followUp(a.project, a.project.modifications![0]);
    const sup = transition(a.project, a.project.modifications![0], 'superseded', { supersededBy: fu.record.id, now: NOW });
    expect(sup.ok).toBe(true);
    expect(JSON.stringify(a.project.revisions)).toBe(snap);
    expect(checkReferences(a.project).length).toBe(checkReferences(p).length);
  });
});

describe('M1 — follow-ups, numbering and copy policy', () => {
  it('a follow-up is a new linked draft; the applied original keeps its values and decision', () => {
    const p = base(), r = walk(p, drafted(p), ['proposed', 'accepted']);
    const a = applyModification(withRecord(p, r), r.id); if (!a.ok) throw new Error(a.error);
    const orig = JSON.stringify(a.project.modifications![0]);
    const fu = followUp(a.project, a.project.modifications![0], 'Ravi', NOW);
    expect(fu.record).toMatchObject({ status: 'draft', follows: r.id, id: 'MOD-002' });
    expect(fu.record.ops.every((o) => o.before !== undefined)).toBe(true);
    expect(JSON.stringify(a.project.modifications![0])).toBe(orig);
  });
  it('a follow-up leaves out changes whose target is gone and says how many', () => {
    const p = base(), r = drafted(p);
    const gone = { ...p, feeders: p.feeders.filter((f) => f.id !== f1) };
    const fu = followUp(gone, r);
    expect(fu.dropped).toBe(1);
    expect(fu.record.ops).toHaveLength(1);
  });
  it('(13) Duplicate resets decisions and application; Save as keeps the evidence', () => {
    const p = base(), r = walk(p, drafted(p), ['proposed', 'accepted']);
    const a = applyModification(withRecord(p, r), r.id); if (!a.ok) throw new Error(a.error);
    const dup = copyProject(a.project, 'duplicate', 'Next job');
    const m = dup.modifications![0];
    expect(m).toMatchObject({ status: 'draft', decision: undefined, applied: undefined, baselineRevisionId: undefined });
    expect(m.ops).toHaveLength(2);
    expect(validateRecord(m)).toEqual([]);
    const as = copyProject(a.project, 'save-as', 'Branch');
    expect(as.modifications![0]).toMatchObject({ status: 'accepted' });
    expect(as.modifications![0].applied).toBeDefined();
  });
  it('(12) records survive a JSON save and reopen unchanged, including draft operations and decisions', () => {
    const p = base(), r = walk(p, drafted(p), ['proposed', 'accepted']);
    const q = withRecord(withRecord(p, r), { ...drafted(p), id: 'MOD-009' });
    const back = JSON.parse(JSON.stringify(q)) as Project;
    expect(back.modifications).toEqual(q.modifications);
    back.modifications!.forEach((m) => expect(validateRecord(m)).toEqual([]));
  });
});
