import { describe, expect, it } from 'vitest';
import type { Feeder } from '../types';
import { sampleProject } from '../data/sampleProject';
import { onSld, splitSld } from './sldScope';

const base = sampleProject.feeders.find((f) => f.boardId === 'DB-GF1' && !onSld(f))!;
const way = (o: Partial<Feeder>): Feeder => ({ ...base, ...o });

describe('where the SLD stops', () => {
  it('a small single-phase lighting or power circuit is a final circuit, left to the DB schedule', () => {
    expect(base).toBeDefined();
    expect(onSld(way({ loadType: 'lighting', breakerRatingA: 10 }))).toBe(false);
    expect(onSld(way({ loadType: 'sockets', breakerRatingA: 20 }))).toBe(false);
  });
  it('feeders to boards and major equipment stay on the SLD', () => {
    expect(onSld(way({ feedsBoardId: 'DB-X' }))).toBe(true);
    expect(onSld(way({ breakerRatingA: 32 }))).toBe(true);
    for (const t of ['motor', 'fire-pump', 'ev', 'capacitor', 'pv'] as const) expect(onSld(way({ loadType: t }))).toBe(true);
  });
  it('splits a board into drawn ways and final circuits, keeping their order', () => {
    const a = way({ id: 'a', breakerRatingA: 10 }), b = way({ id: 'b', feedsBoardId: 'DB-X' }), c = way({ id: 'c', breakerRatingA: 16 });
    const s = splitSld([a, b, c], (f) => f);
    expect(s.drawn.map((f) => f.id)).toEqual(['b']);
    expect(s.final.map((f) => f.id)).toEqual(['a', 'c']);
  });
});
