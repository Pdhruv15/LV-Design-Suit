import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { updateCircuit, addCircuit } from './schedule';
import { changedSinceRevision, currentRevision, diffProjects, issueRevision, nextRevisionId, restoreRevision, revisionStamp, snapshotOf } from './revisions';

describe('revisions', () => {
  it('issues A, B, C… with date, description and a frozen copy', () => {
    const a = issueRevision(sampleProject, { description: 'First submission', by: 'PG', date: '2026-09-27' });
    expect(currentRevision(a)).toMatchObject({ id: 'A', date: '2026-09-27', description: 'First submission', by: 'PG' });
    expect(currentRevision(a)!.snapshot).not.toHaveProperty('revisions');
    const b = issueRevision(a, { description: 'DEWA comments' });
    expect(b.revisions!.map((r) => r.id)).toEqual(['A', 'B']);
    expect(revisionStamp(b)).toMatch(/^REV B · \d{4}-\d{2}-\d{2}$/);
    expect(revisionStamp(sampleProject)).toBe('REV —');
  });

  it('continues past Z with AA', () => {
    const p = { ...sampleProject, revisions: Array.from({ length: 26 }, () => currentRevision(issueRevision(sampleProject, { description: '' }))!) };
    expect(nextRevisionId(p)).toBe('AA');
  });

  it('the frozen copy does not change when the design does', () => {
    const a = issueRevision(sampleProject, { description: 'A' });
    const edited = updateCircuit(a, 'DB-GF1-R3', { points: { cooker: 2 } });
    expect(currentRevision(edited)!.snapshot.feeders.find((f) => f.id === 'DB-GF1-R3')!.points).toEqual({ cooker: 1 });
    expect(changedSinceRevision(a)).toBe(false);
    expect(changedSinceRevision(edited)).toBe(true);
  });

  it('lists added, removed and changed circuits with from → to per field', () => {
    let p = updateCircuit(sampleProject, 'DB-GF1-R1', { points: { ltg: 14 }, remarks: 'Chandelier' });
    p = addCircuit(p, 'DB-GF1', 'R', 9).project;
    p = { ...p, feeders: p.feeders.filter((f) => f.id !== 'DB-GF1-B1') };
    const d = diffProjects(snapshotOf(sampleProject), p);
    const byId = new Map(d.changes.map((c) => [c.id, c]));
    expect(byId.get('DB-GF1-R9')).toMatchObject({ kind: 'added', what: 'circuit', label: 'DB-GF1 R9' });
    expect(byId.get('DB-GF1-B1')).toMatchObject({ kind: 'removed', what: 'circuit', label: 'DB-GF1 B1 (External lighting)' });
    const r1 = byId.get('DB-GF1-R1')!;
    expect(r1.kind).toBe('changed');
    expect(r1.fields).toContainEqual({ field: 'Points', from: 'ltg 12', to: 'ltg 14' });
    expect(r1.fields).toContainEqual({ field: 'Load (kW)', from: '1.2', to: '1.4' });
    expect(r1.fields).toContainEqual({ field: 'Remarks', from: '—', to: 'Chandelier' });
    const db = d.boardKw.find((b) => b.boardId === 'DB-GF1')!;
    expect(db.to - db.from).toBeCloseTo(0.2 - 1.0, 9); // +2 lights, −External lighting (10 × 100 W)
  });

  it('reports board and project setting changes, and nothing for identical projects', () => {
    expect(diffProjects(snapshotOf(sampleProject), sampleProject).changes).toEqual([]);
    const p = {
      ...sampleProject,
      vdLimitPct: 5,
      boards: sampleProject.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, pointWatts: { ...b.pointWatts, ltg: 120 } } : b))
    };
    const d = diffProjects(snapshotOf(sampleProject), p);
    expect(d.changes.find((c) => c.what === 'project')!.fields).toEqual([{ field: 'VD limit (%)', from: '4', to: '5' }]);
    expect(d.changes.find((c) => c.id === 'DB-GF1')!.fields[0].field).toBe('WATT / UNIT');
  });

  it('restores a revision but keeps the history', () => {
    const a = issueRevision(sampleProject, { description: 'A' });
    const edited = updateCircuit(a, 'DB-GF1-R3', { points: { cooker: 2 } });
    const b = issueRevision(edited, { description: 'B' });
    const back = restoreRevision(b, 'A');
    expect(back.feeders.find((f) => f.id === 'DB-GF1-R3')!.points).toEqual({ cooker: 1 });
    expect(back.revisions!.map((r) => r.id)).toEqual(['A', 'B']);
  });
});
