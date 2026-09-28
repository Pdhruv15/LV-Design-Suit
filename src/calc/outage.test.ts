import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyDrop, canDrop, removeTie, tiePartner } from '../model/sldEdit';
import { boardDemandKva } from './sizing';
import { evaluateProject, faultCurrentKA, impedanceToBoard } from './electrical';
import { transformerOutage } from './scenario';
import type { Project } from '../types';

/** The sample plus a second transformer-fed MDB with a 150 kW chiller. */
function twoTransformers(): Project {
  let p = applyDrop(sampleProject, { kind: 'transformer' }, { type: 'canvas' }).project; // MDB-2, 1000 kVA
  p = applyDrop(p, { kind: 'load', preset: 'chiller' }, { type: 'bus', boardId: 'MDB-2' }).project;
  return p;
}

describe('bus tie and transformer outage', () => {
  it('a tie joins two transformer-fed main boards, once', () => {
    const p = twoTransformers();
    expect(tiePartner(p, 'MDB-1')!.id).toBe('MDB-2');
    const r = applyDrop(p, { kind: 'tie' }, { type: 'bus', boardId: 'MDB-1' });
    expect(r.project.ties).toEqual([{ id: 'BC-1', a: 'MDB-1', b: 'MDB-2', ratingA: 1600 }]);
    expect(canDrop(r.project, { kind: 'tie' }, { type: 'bus', boardId: 'MDB-1' })).toBe(false); // already tied
    expect(canDrop(sampleProject, { kind: 'tie' }, { type: 'bus', boardId: 'MDB-1' })).toBe(false); // nothing to tie to
    expect(canDrop(r.project, { kind: 'tie' }, { type: 'bus', boardId: 'SMDB-GF' })).toBe(false); // not a main board
    expect(removeTie(r.project, 'BC-1').ties).toEqual([]);
  });

  it('with MDB-1’s transformer out, the tie closes and MDB-2’s transformer carries both', () => {
    const p = applyDrop(twoTransformers(), { kind: 'tie' }, { type: 'bus', boardId: 'MDB-1' }).project;
    const s = transformerOutage(p, 'MDB-1');
    expect(s.energized.size).toBe(p.boards.length);
    expect(s.project.boards.find((b) => b.id === 'MDB-1')).toMatchObject({ upstreamId: 'MDB-2' });
    expect(s.project.boards.find((b) => b.id === 'MDB-1')!.sourceKva).toBeUndefined();
    const t = s.outage.transformers;
    expect(t.map((x) => x.boardId)).toEqual(['MDB-2']);
    const both = boardDemandKva(p, 'MDB-1') + boardDemandKva(p, 'MDB-2');
    expect(t[0].demandKva).toBeCloseTo(both, 0);
    expect(t[0].loadingPct).toBeCloseTo((t[0].demandKva / 1000) * 100, 9);
    expect(s.outage.tie).toMatchObject({ id: 'BC-1', fromId: 'MDB-2', ratingA: 1600 });
    expect(s.outage.tie!.currentA).toBeGreaterThan(500);
    // Everything still evaluates; MDB-1's fault level now comes through MDB-2.
    expect(evaluateProject(s.project)).toHaveLength(s.project.feeders.length);
    expect(faultCurrentKA(impedanceToBoard(s.project, 'MDB-1'), 415)).toBeCloseTo(faultCurrentKA(impedanceToBoard(p, 'MDB-2'), 415), 0);
  });

  it('either transformer can fail', () => {
    const p = applyDrop(twoTransformers(), { kind: 'tie' }, { type: 'bus', boardId: 'MDB-1' }).project;
    const s = transformerOutage(p, 'MDB-2');
    expect(s.outage.transformers.map((x) => x.boardId)).toEqual(['MDB-1']);
    expect(s.outage.tie!.fromId).toBe('MDB-1');
  });

  it('without a tie, the failed board and everything below it is off', () => {
    const p = twoTransformers();
    const s = transformerOutage(p, 'MDB-1');
    expect(s.outage.tie).toBeUndefined();
    expect([...s.energized].sort()).toEqual(['MDB-2']);
    expect(s.project.feeders.every((f) => f.boardId === 'MDB-2')).toBe(true);
  });
});
