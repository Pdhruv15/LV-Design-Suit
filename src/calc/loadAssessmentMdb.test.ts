import { describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { assess, DEFAULT_TYPES, newAssessment, type LoadAssessment } from './loadAssessment';
import { assessmentFeeders, createMdbFromAssessment } from './loadAssessmentMdb';
import { boardTotals } from './summary';
import { isEssential } from './sizing';

const lib = { types: [] };
const res = (patch: Partial<LoadAssessment> = {}): LoadAssessment => ({
  ...newAssessment(DEFAULT_TYPES[0], { gfaM2: 24000, floors: 20, parkingM2: 8000 }, lib),
  custom: [{ id: 'c1', label: 'Rooftop BMU', qty: 2, kw: 15, diversity: 0.5, onGenerator: true }],
  ...patch
});
const empty = () => ({ ...newProject('Test'), boards: [], feeders: [] });

describe('load assessment → MDB + feeders', () => {
  it('one feeder per category and custom load, connected kW and diversity as load and demand factor', () => {
    const a = res();
    const r = assess(a);
    const items = assessmentFeeders(a);
    // Split categories add up to the category's connected load, each at its diversity.
    for (const c of r.categories.filter((x) => x.key !== 'life')) {
      const key = c.key.startsWith('custom:') ? `c-${c.key.slice(7)}` : c.key;
      const mine = items.filter((x) => x.key === key || x.key === `${key}-e`);
      expect(mine.reduce((s, x) => s + x.kw, 0)).toBeCloseTo(c.connectedKw, 1);
      for (const x of mine) expect(x.demandFactor).toBe(c.diversity);
    }
    expect(items.find((x) => x.key === 'ltg')!.loadType).toBe('lighting');
    expect(items.find((x) => x.key === 'pwr')!.loadType).toBe('sockets');
    expect(items.find((x) => x.key === 'hvac')!.loadType).toBe('hvac');
    expect(items.find((x) => x.key === 'lift')!.loadType).toBe('motor');
    expect(items.find((x) => x.key === 'ev')!.loadType).toBe('ev');
    expect(items.find((x) => x.key === 'fire')!.loadType).toBe('fire-pump');
    // The custom load is one feeder: qty × kW.
    expect(items.find((x) => x.key === 'c-c1')).toMatchObject({ kw: 30, demandFactor: 0.5, essential: true });
  });

  it('generator-backed items are essential; partly backed categories are split', () => {
    const items = assessmentFeeders(res());
    expect(items.find((x) => x.key === 'ltg')!.essential).toBe(true); // lighting: fully on the generator
    expect(items.find((x) => x.key === 'lift')!.essential).toBe(true);
    expect(items.find((x) => x.key === 'ev')!.essential).toBeUndefined(); // not on the generator
    expect(items.find((x) => x.key === 'pwr')!.essential).toBeUndefined();
    expect(items.find((x) => x.key === 'pwr-e')!.essential).toBe(true); // 30 % of small power
    for (const k of ['fire', 'jockey', 'stair1', 'stair2']) expect(items.find((x) => x.key === k)).toMatchObject({ essential: true, demandFactor: 1 });
  });

  it('essential feeders give the assessment’s generator demand', () => {
    const a = res();
    const ess = assessmentFeeders(a).filter((x) => x.essential).reduce((s, x) => s + x.kw * x.demandFactor, 0);
    expect(ess).toBeCloseTo(assess(a).generatorKw, 0);
  });

  it('creates an MDB with the assessment’s transformer and sized feeders', () => {
    const a = res();
    const r = createMdbFromAssessment(empty(), a);
    expect(r.created).toBe(true);
    expect(r.boardId).toBe('MDB-1');
    const mdb = r.project.boards.find((b) => b.id === 'MDB-1')!;
    expect(mdb.kind).toBe('MDB');
    expect(mdb.sourceKva).toBe(assess(a).tx!.kva);
    const feeders = r.project.feeders.filter((f) => f.boardId === 'MDB-1');
    expect(feeders).toHaveLength(r.added);
    expect(feeders.every((f) => f.fromRoom?.startsWith('la:'))).toBe(true);
    expect(feeders.filter(isEssential).length).toBeGreaterThan(0);
    // Connected load on the board is the assessment's (fire & life safety counted at full load).
    expect(boardTotals(r.project, 'MDB-1').connectedKw).toBeCloseTo(assess(a).connectedKw, 0);
    // Sized: not left at the 32 A placeholder breaker.
    expect(feeders.find((f) => f.name === 'Lighting')!.breakerRatingA).toBeGreaterThan(32);
  });

  it('uses a chosen main board, replaces its earlier assessment feeders and keeps your own', () => {
    const p0 = { ...empty(), boards: [{ id: 'LV-1', name: 'LV board', kind: 'MDB' as const, sourceKva: 2000 }],
      feeders: [{ id: 'LV-1-X', boardId: 'LV-1', name: 'My feeder', loadKw: 10, demandFactor: 1, powerFactor: 0.9, lengthM: 20, cableCsaMm2: 6, cores: 4 as const, breakerRatingA: 32, breakerIcuKa: 25 }] };
    const first = createMdbFromAssessment(p0, res(), 'LV-1');
    expect(first.created).toBe(false);
    expect(first.project.boards).toHaveLength(1);
    expect(first.project.boards[0].sourceKva).toBe(2000);
    const again = createMdbFromAssessment(first.project, res({ custom: [] }), 'LV-1');
    expect(again.replaced).toBe(first.added);
    expect(again.added).toBe(first.added - 1);
    expect(again.project.feeders.some((f) => f.id === 'LV-1-X')).toBe(true);
    expect(again.project.feeders.filter((f) => f.boardId === 'LV-1')).toHaveLength(again.added + 1);
  });
});
