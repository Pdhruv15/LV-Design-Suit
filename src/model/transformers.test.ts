import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyTransformers, mainBoards, mainOf, moveUnder, planTransformers, setTransformer, supplyChain, txTag } from './transformers';

describe('transformers', () => {
  it('creates one MDB per DEWA transformer, numbered after the existing ones, with ties between pairs', () => {
    const plan = planTransformers(sampleProject, [{ kva: 1500 }, { kva: 1500 }, { kva: 1000 }], true);
    expect(plan.problems).toEqual([]);
    expect(plan.boards.map((b) => [b.kind, b.sourceKva])).toEqual([['MDB', 1500], ['MDB', 1500], ['MDB', 1000]]);
    expect(plan.boards[0].ratedCurrentA).toBeGreaterThanOrEqual(2087); // 1500 kVA at 415 V ≈ 2,086.8 A
    expect(plan.ties).toHaveLength(1);
    const next = applyTransformers(sampleProject, plan);
    expect(mainBoards(next).length).toBe(mainBoards(sampleProject).length + 3);
    expect(new Set(next.boards.map((b) => b.id)).size).toBe(next.boards.length);
  });

  it('moves a sub-board with everything below it to another transformer; supply chain follows', () => {
    const next = applyTransformers(sampleProject, planTransformers(sampleProject, [{ kva: 1000 }], false));
    const newMain = next.boards[next.boards.length - 1];
    const sub = next.boards.find((b) => b.upstreamId && !next.boards.find((x) => x.id === b.upstreamId)!.upstreamId)!;
    const db = next.boards.find((b) => b.upstreamId === sub.id);
    const moved = moveUnder(next, [sub.id], newMain.id);
    expect(mainOf(moved, sub.id)!.id).toBe(newMain.id);
    if (db) {
      expect(mainOf(moved, db.id)!.id).toBe(newMain.id);
      const chain = supplyChain(moved, db.id);
      expect(chain[0]).toBe(`${txTag(moved, newMain.id)} (1000 kVA)`);
      expect(chain.slice(1)).toEqual([newMain.id, sub.id, db.id]);
    }
    expect(moved.feeders.find((f) => f.feedsBoardId === sub.id)?.boardId ?? newMain.id).toBe(newMain.id);
    // A board can't be moved under itself or its own children
    expect(moveUnder(moved, [newMain.id], sub.id)).toBe(moved);
  });

  it('setting or clearing a transformer on a main board', () => {
    const id = mainBoards(sampleProject)[0].id;
    const a = setTransformer(sampleProject, id, 1500);
    expect(a.boards.find((b) => b.id === id)!.sourceKva).toBe(1500);
    const b = setTransformer(a, id, undefined);
    expect(b.boards.find((x) => x.id === id)!.sourceKva).toBeUndefined();
    expect(txTag(b, id)).toBeUndefined();
  });
});
