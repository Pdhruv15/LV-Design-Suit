import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { updateCircuit } from './schedule';
import { diffProjects, issueRevision, restoreRevision } from './revisions';
import { withEarthPitIds } from './earthingPlan';
import { baselineOf, clearBaseline, draftSummary, setBaseline } from './designBaseline';
import { migrateProject } from './projectMigrate';
import type { Project } from '../types';

const two = (): Project => {
  const a = issueRevision(withEarthPitIds(sampleProject), { description: 'Issued for approval', date: '2026-10-01' });
  const edited = updateCircuit(a, 'DB-GF1-R3', { points: { cooker: 2 } });
  return issueRevision(edited, { description: 'Comments addressed', date: '2026-10-20' });
};

describe('design baseline', () => {
  it('is the latest issued revision until one is chosen, and nothing before the first issue', () => {
    expect(baselineOf(sampleProject)).toBeUndefined();
    expect(draftSummary(sampleProject)).toBeUndefined();
    const p = two();
    expect(baselineOf(p)).toMatchObject({ chosen: false, revision: { id: 'B' } });
  });

  it('choosing a baseline changes only the pointer: the draft, BOQ and adjustments are untouched', () => {
    const p = { ...two(), boq: { discountPct: 5, manual: [] }, tags: ['villa'] };
    const q = setBaseline(p, 'A', 'PG', new Date('2026-10-05T09:00:00Z'));
    expect(q.baseline).toEqual({ revisionId: 'A', selectedAt: '2026-10-05T09:00:00.000Z', selectedBy: 'PG' });
    expect(baselineOf(q)).toMatchObject({ chosen: true, revision: { id: 'A' } });
    const { baseline: _b, ...rest } = q; const { baseline: _c, ...before } = p;
    expect(rest).toEqual(before);
    expect(q.boards).toBe(p.boards); expect(q.feeders).toBe(p.feeders); expect(q.boq).toBe(p.boq);
    expect(setBaseline(p, 'Z')).toBe(p); // no such revision: nothing changes
    expect(clearBaseline(q).baseline).toBeUndefined();
    expect(baselineOf(clearBaseline(q))!.chosen).toBe(false);
  });

  it('draft edits leave the baseline snapshot unchanged', () => {
    const p = setBaseline(two(), 'A');
    const frozen = JSON.stringify(p.revisions![0].snapshot);
    let q = updateCircuit(p, 'DB-GF1-R1', { points: { ltg: 30 } });
    q = { ...q, boards: q.boards.map((b) => ({ ...b, ratedCurrentA: 9999 })) };
    expect(JSON.stringify(q.revisions![0].snapshot)).toBe(frozen);
    expect(baselineOf(q)!.revision.snapshot).toBe(q.revisions![0].snapshot);
  });

  it('summarises the draft against the chosen baseline, separating design from pricing', () => {
    const p = two();
    expect(draftSummary(p)).toMatchObject({ designChanged: false, counts: { engineering: 0, drawing: 0, commercial: 0 } });
    const priced = { ...p, boq: { discountPct: 8 } };
    expect(draftSummary(priced)).toMatchObject({ designChanged: false, counts: { commercial: 1 } });
    const vsA = draftSummary(setBaseline(p, 'A'))!;
    expect(vsA).toMatchObject({ chosen: true, designChanged: true });
    expect(vsA.counts.engineering).toBeGreaterThan(0);
    expect(vsA.diff.changes.some((c) => c.id === 'DB-GF1-R3')).toBe(true);
  });

  it('survives saving and reopening, and old projects without one still load', () => {
    const p = setBaseline(two(), 'A', 'PG');
    const reopened = migrateProject(JSON.parse(JSON.stringify(p)), 'x.json');
    expect(reopened.baseline).toEqual(p.baseline);
    expect(baselineOf(reopened)!.revision.id).toBe('A');
    const old = migrateProject(JSON.parse(JSON.stringify(two())), 'old.json');
    expect(old.baseline).toBeUndefined();
    expect(baselineOf(old)!.revision.id).toBe('B');
  });

  it('choosing a baseline is not itself a change to compare', () => {
    const p = two();
    expect(diffProjects(p.revisions![0].snapshot, { ...p, baseline: { revisionId: 'A', selectedAt: '2026-10-05T00:00:00.000Z' }, updatedAt: p.updatedAt }).changes.every((c) => c.what !== 'details')).toBe(true);
  });

  it('a baseline pointing at a revision that is gone falls back to the latest', () => {
    const p = { ...two(), baseline: { revisionId: 'Q', selectedAt: '2026-10-05T00:00:00.000Z' } };
    expect(baselineOf(p)).toMatchObject({ chosen: false, revision: { id: 'B' } });
  });
});

describe('restoring a revision', () => {
  it('restores the design but keeps the project’s own status, tags, notes, scope, baseline, identity and history', () => {
    const base = issueRevision(withEarthPitIds({ ...sampleProject, id: 'p1', status: 'design', tags: ['old'], notes: 'old note', info: { owner: 'Old owner', mdDemandFactor: 0.8 } }), { description: 'A' });
    const later: Project = {
      ...updateCircuit(base, 'DB-GF1-R3', { points: { cooker: 3 } }),
      status: 'approved', tags: ['new'], notes: 'new note', info: { owner: 'New owner', mdDemandFactor: 0.6 }, name: 'Renamed job', baseline: { revisionId: 'A', selectedAt: '2026-10-05T00:00:00.000Z' }
    };
    const back = restoreRevision(later, 'A');
    expect(back.feeders.find((f) => f.id === 'DB-GF1-R3')!.points).toEqual({ cooker: 1 }); // design restored
    expect(back.info).toMatchObject({ mdDemandFactor: 0.8, owner: 'New owner' }); // engineering input restored, owner kept
    expect(back).toMatchObject({ id: 'p1', status: 'approved', tags: ['new'], notes: 'new note', name: 'Renamed job', baseline: { revisionId: 'A' } });
    expect(back.revisions).toBe(later.revisions);
  });
});
