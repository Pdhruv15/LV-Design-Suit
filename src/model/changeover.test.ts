import { describe, expect, it } from 'vitest';
import { atsLines, atsOf, breakerLines, changeoverBreakers, generatorFlcA, incomersOf } from './changeover';
import { sampleProject } from '../data/sampleProject';
import type { Board, Project } from '../types';

const withStandby = (standby: Board['standby'], extra: Partial<Board> = {}): Project => ({
  ...sampleProject,
  boards: sampleProject.boards.map((b, i) => (i === 0 ? { ...b, ratedCurrentA: 800, standby, ...extra } : b))
});

describe('emergency changeover', () => {
  it('sizes the generator breaker from its full-load current and picks ACB from 630 A, draw-out', () => {
    expect(generatorFlcA(500, 400)).toBeCloseTo(721.7, 1);
    const p = withStandby({ kva: 500, changeover: 'ACB' }, { protection: { irSetting: 0.85 } });
    const k = changeoverBreakers(p, p.boards[0])!;
    expect(k.mains).toMatchObject({ ratingA: 800, device: 'ACB', drawOut: true, irSetting: 0.85 });
    expect(k.generator.ratingA).toBeGreaterThanOrEqual(722);
    expect(k.generator.device).toBe('ACB');
    expect(breakerLines(k.mains)[2]).toBe('ACB (DOT)');
    expect(breakerLines(k.mains)[1]).toMatch(/^4P, \d+KA, SET@0.85$/);
  });

  it('uses fixed MCCBs below 630 A and two incomers for instruments', () => {
    const p = withStandby({ kva: 100, changeover: 'ACB' }, { ratedCurrentA: 250 });
    const b = p.boards[0];
    const k = changeoverBreakers(p, b)!;
    expect(k.mains).toMatchObject({ ratingA: 250, device: 'MCCB', drawOut: false });
    expect(k.generator.device).toBe('MCCB');
    expect(incomersOf(b)).toBe(2);
    expect(atsOf(p, b)).toBeUndefined();
  });

  it('describes the ATS: board rating, 4P switched neutral, open transition, AC-33B by default', () => {
    const p = withStandby({ kva: 200 }, { ratedCurrentA: 250 });
    const a = atsOf(p, p.boards[0])!;
    expect(atsLines(a)).toEqual(['ATS 250 A 4P', 'SWITCHED NEUTRAL', 'OPEN TRANSITION', 'AC-33B']);
    const q = withStandby({ kva: 200, atsRatingA: 400, transition: 'closed', category: 'AC-31B' });
    expect(atsLines(atsOf(q, q.boards[0])!)).toEqual(['ATS 400 A 4P', 'SWITCHED NEUTRAL', 'CLOSED TRANSITION', 'AC-31B']);
    expect(incomersOf(q.boards[0])).toBe(1);
  });
});
