import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { buildMdSheet } from '../docs/mdSheet';
import { addOutgoingFeeder, deleteOutgoingFeeder, feederDeleteBlock } from './mdFeeders';

const p = sampleProject;
const root = p.boards.find((b) => !b.upstreamId)!;
const toBoard = p.feeders.find((f) => f.boardId === root.id && f.feedsBoardId)!;

describe('outgoing feeders from the connected load / MD form', () => {
  it('adds a sized general-load feeder at the end of the panel', () => {
    const r = addOutgoingFeeder(p, root.id);
    const f = r.project.feeders.find((x) => x.id === r.id)!;
    expect(f.boardId).toBe(root.id);
    expect(f.feedsBoardId).toBeUndefined();
    expect(f.phase).toBeUndefined(); // not a DB schedule circuit
    expect(f.breakerRatingA).toBeGreaterThan(0);
    expect(r.project.feeders).toHaveLength(p.feeders.length + 1);
    const rows = buildMdSheet(r.project, root.id).rows;
    const last = rows[rows.length - 2];
    expect(last.type === 'feeder' && last.feeder.id).toBe(r.id);
  });

  it('numbers repeated adds uniquely', () => {
    const a = addOutgoingFeeder(p, root.id);
    const b = addOutgoingFeeder(a.project, root.id);
    expect(b.id).not.toBe(a.id);
  });

  it('leaves the project alone for an unknown board', () => {
    expect(addOutgoingFeeder(p, 'NOPE').project).toBe(p);
  });

  it('deletes an equipment feeder', () => {
    const { project: q, id } = addOutgoingFeeder(p, root.id);
    const r = deleteOutgoingFeeder(q, id!);
    expect(r.project.feeders.some((f) => f.id === id)).toBe(false);
    expect(r.message).toMatch(/Deleted/);
  });

  it('refuses to delete a feeder that supplies a panel', () => {
    expect(feederDeleteBlock(p, toBoard.id)).toMatch(new RegExp(`supplies ${toBoard.feedsBoardId}`));
    const r = deleteOutgoingFeeder(p, toBoard.id);
    expect(r.project).toBe(p);
    expect(r.message).toMatch(/no supply/);
  });

  it('allows deleting a feeder whose panel is already gone', () => {
    const q = { ...p, feeders: [...p.feeders, { ...toBoard, id: 'X-OLD', feedsBoardId: 'GONE' }] };
    expect(feederDeleteBlock(q, 'X-OLD')).toBeUndefined();
    expect(deleteOutgoingFeeder(q, 'X-OLD').project.feeders.some((f) => f.id === 'X-OLD')).toBe(false);
  });
});
