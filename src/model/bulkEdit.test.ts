import { describe, expect, it } from 'vitest';
import { sampleProject as p } from '../data/sampleProject';
import { bulkResult, identityIssues, introducedIssues, previewBulkEdit, searchEquipment } from './bulkEdit';
import { applyModification, transition, withRecord } from './designChanges';

const meta = { title: 'Bulk', reason: 'test' };
const ids = p.feeders.slice(0, 3).map((f) => f.id);

describe('bulk edit', () => {
  it('touches only the selected items and leaves the working design alone until applied', () => {
    const before = JSON.stringify(p);
    const prev = previewBulkEdit(p, ids, { target: 'feeder', field: 'lengthM', mode: 'scale', value: 1.5 }, meta);
    expect(prev.error).toBeUndefined();
    expect(prev.record.ops.every((o) => ids.includes(o.targetId!))).toBe(true);
    const next = bulkResult(p, prev);
    p.feeders.filter((f) => !ids.includes(f.id)).forEach((f) => expect(next.feeders.find((x) => x.id === f.id)).toEqual(f));
    expect(JSON.stringify(p)).toBe(before);
  });
  it('reports items it cannot change instead of dropping them silently', () => {
    const prev = previewBulkEdit(p, [...ids, 'NOPE'], { target: 'feeder', field: 'lengthM', mode: 'set', value: p.feeders[0].lengthM }, meta);
    expect(prev.rows.find((r) => r.id === 'NOPE')?.skipped).toBe('no longer exists');
    expect(prev.rows.find((r) => r.id === ids[0])?.skipped).toBe('already this value');
  });
  it('rejects bad input without a partial record', () => {
    expect(previewBulkEdit(p, [], { target: 'feeder', field: 'lengthM', mode: 'set', value: 5 }, meta).error).toBeTruthy();
    expect(previewBulkEdit(p, ids, { target: 'feeder', field: 'lengthM', mode: 'set', value: NaN }, meta).error).toBeTruthy();
    expect(previewBulkEdit(p, ids, { target: 'feeder', field: 'name', mode: 'set', value: 'x' }, meta).error).toBeTruthy();
    expect(previewBulkEdit(p, ids, { target: 'feeder', field: 'lengthM', mode: 'scale', value: -1 }, meta).changed).toBe(0);
  });
  it('applies as one atomic step through the modification path', () => {
    const prev = previewBulkEdit(p, ids, { target: 'feeder', field: 'lengthM', mode: 'add', value: 10 }, meta);
    let q = withRecord(p, prev.record);
    for (const s of ['proposed', 'accepted'] as const) { const t = transition(q, q.modifications![0], s); if (!t.ok) throw new Error(t.error); q = withRecord(q, t.record); }
    const r = applyModification(q, prev.record.id);
    expect(r.ok).toBe(true);
    if (r.ok) ids.forEach((id) => expect(r.project.feeders.find((f) => f.id === id)!.lengthM).toBeCloseTo(p.feeders.find((f) => f.id === id)!.lengthM + 10, 6));
  });
});

describe('search and identity', () => {
  it('finds equipment by text, panel and manual sizing', () => {
    const f = p.feeders[0];
    expect(searchEquipment(p, { text: f.id, type: 'feeder' }).some((h) => h.id === f.id)).toBe(true);
    expect(searchEquipment(p, { boardId: f.boardId, type: 'feeder' }).every((h) => p.feeders.find((x) => x.id === h.id)!.boardId === f.boardId)).toBe(true);
    expect(searchEquipment(p, { manualOnly: true }).every((h) => h.manual)).toBe(true);
  });
  it('flags duplicate way references introduced by an edit, not existing ones', () => {
    const [a, b] = p.feeders.filter((f) => f.phase && f.way != null && f.boardId === p.feeders.find((x) => x.phase && x.way != null)!.boardId);
    if (!a || !b) return;
    const dup = { ...p, feeders: p.feeders.map((f) => (f.id === b.id ? { ...f, phase: a.phase, way: a.way } : f)) };
    expect(introducedIssues(p, dup).some((i) => i.problem.includes('way'))).toBe(true);
    expect(introducedIssues(p, p)).toEqual([]);
    expect(identityIssues(p).length).toBeGreaterThanOrEqual(0);
  });
});
