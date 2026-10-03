import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';
import { chooseGenerator, generatorForBoard, sizeGenerator } from './sizing';
import { sizeGeneratorByBoards } from './txGen';
import { applyDrop } from '../model/sldEdit';
import { buildSection, scopeOf } from '../docs/studyReport';

/** ENG-003: the generator must carry the running kVA and the running kW at the loading limit. */
const load = (kw: number, pf = 1, extra: Partial<Feeder> = {}): Feeder => ({
  id: 'L1', boardId: 'MDB', name: 'General load', loadKw: kw, demandFactor: 1, powerFactor: pf,
  lengthM: 10, cableCsaMm2: 300, parallel: 8, cores: 4, breakerRatingA: 4000, breakerIcuKa: 100, essential: true, ...extra
});
const fixture = (kw: number, loadingPct: number, opts: { pf?: number; standbyKva?: number; feeders?: Feeder[] } = {}): Project => ({
  ...sampleProject, voltageV: 400,
  studySettings: { ...sampleProject.studySettings, generatorMaxLoadingPct: loadingPct, futureGrowthPct: 0 },
  txGen: { genBoards: { MDB: 100 } },
  boards: [{ id: 'MDB', name: 'MDB', sourceKva: 3150, ratedCurrentA: 6300, ...(opts.standbyKva ? { standby: { kva: opts.standbyKva } } : {}) }],
  feeders: opts.feeders ?? [load(kw, opts.pf)], ties: undefined, pfc: undefined, busRisers: undefined, trays: undefined
} as Project);

describe('ENG-003: generator carries both kVA and kW', () => {
  const rows: [number, number, number | undefined, number | undefined][] = [
    [100, 100, 125, 100],
    [100, 80, 200, 160],
    [2100, 100, undefined, undefined]
  ];
  for (const [kw, L, kva, ratedKw] of rows) {
    it(`${kw} kW / ${kw} kVA at ${L} %: ${kva ? `${kva} kVA / ${ratedKw} kW` : 'no suitable standard set'}`, () => {
      const p = fixture(kw, L);
      const byBoards = sizeGeneratorByBoards(p);
      const essential = sizeGenerator(p);
      for (const g of [byBoards, essential]) {
        expect(g.recommendedKva).toBe(kva);
        if (kva) expect(g.recommendedKw).toBe(ratedKw);
      }
      expect(generatorForBoard(p, 'MDB')).toBe(kva);
      if (!kva) {
        expect(byBoards.noFit).toBe(true);
        expect(byBoards.runningDesignKva).toBeCloseTo(2625, 6);
        expect(byBoards.governing).toBe('kW');
      }
      if (L === 80) expect((kw / ratedKw!) * 100).toBeCloseTo(62.5, 6); // engine loading
    });
  }

  it('80 %: needs at least 156.25 kVA, so 150 kVA is not enough', () => {
    const c = chooseGenerator(100, 100, 0.8);
    expect(c.runningKva).toBeCloseTo(156.25, 6);
    expect(c.kva).toBe(200);
  });

  it('counts the essential circuit once on a standby board (board path)', () => {
    const p = fixture(100, 100, { standbyKva: 125 });
    const g = sizeGeneratorByBoards({ ...p, txGen: {} } as Project);
    expect(g.demandKw).toBeCloseTo(100, 6);
    expect(g.recommendedKva).toBe(125);
  });

  it('100 kW at 100 %: an installed 100 kVA set fails; 125 kVA / 100 kW meets it', () => {
    const bad = fixture(100, 100, { standbyKva: 100 });
    expect(sizeGeneratorByBoards(bad).installedOk).toBe(false);
    const s = buildSection('sizing', { project: bad, results: [], earthing: [], selectivity: [] }, scopeOf(bad, { boards: [], downstream: true }));
    expect(s.summary.find((x) => x.label.startsWith('Standby generator'))!.status).toBe('bad');
    expect(sizeGeneratorByBoards(fixture(100, 100, { standbyKva: 125 })).installedOk).toBe(true);
  });

  it('low load PF is not enlarged: 100 kW at PF 0.8 → 200 kVA, PF 0.6 → 250 kVA (80 % loading)', () => {
    expect(sizeGeneratorByBoards(fixture(100, 80, { pf: 0.8 })).recommendedKva).toBe(200);
    expect(sizeGeneratorByBoards(fixture(100, 80, { pf: 0.6 })).recommendedKva).toBe(250);
    expect(sizeGeneratorByBoards(fixture(100, 80, { pf: 0.6 })).governing).toBe('kVA');
  });

  it('motor start still governs where it is larger, and is not divided by the loading again', () => {
    const m = load(90, 0.85, { id: 'M1', loadType: 'motor', starter: 'DOL' });
    const g = sizeGeneratorByBoards(fixture(0, 80, { feeders: [m] }));
    expect(g.governing).toBe('motor start');
    expect(g.recommendedKva).toBe(chooseGenerator(g.demandKw, g.demandKva, 0.8, g.startDesignKva).kva);
    expect(g.recommendedKva!).toBeGreaterThanOrEqual(g.startDesignKva);
    expect(g.recommendedKva!).toBeLessThan(g.startDesignKva / 0.8 + 1); // start rating used as is
  });

  it('the soft-start alternative never goes below the running kW floor', () => {
    // A big DOL motor plus a large unity-PF load: the soft start lowers the start rating, but the 300 kW must still be carried.
    const m = load(75, 0.85, { id: 'M1', loadType: 'motor', starter: 'DOL' });
    const g = sizeGeneratorByBoards(fixture(0, 80, { feeders: [m, load(300, 1, { id: 'L2' })] }));
    const floor = chooseGenerator(g.demandKw, g.demandKva, 0.8);
    if (g.softStartKva !== undefined) {
      expect(g.softStartKva).toBeGreaterThanOrEqual(floor.kva!);
      expect(g.softStartKva * 0.8 * 0.8).toBeGreaterThanOrEqual(g.demandKw - 1e-9);
    }
    expect(g.recommendedKva! * 0.8 * 0.8).toBeGreaterThanOrEqual(g.demandKw - 1e-9);
  });

  it('no-fit: report shows a failure with the governing requirement; SLD drop adds no undersized set', () => {
    const p = fixture(2100, 100);
    const s = buildSection('sizing', { project: p, results: [], earthing: [], selectivity: [] }, scopeOf(p, { boards: [], downstream: true }));
    const gen = s.summary.find((x) => x.label.startsWith('Standby generator'))!;
    expect(gen.status).toBe('bad');
    expect(String(gen.value)).toMatch(/2625 kVA needed \(kW\) — above the largest standard set/);
    const r = applyDrop(p, { kind: 'generator' } as never, { type: 'bus', boardId: 'MDB' });
    expect(r.project.boards[0].standby).toBeUndefined();
    expect(r.message).toMatch(/No standard generator fits MDB: it needs 2625 kVA \(kW/);
  });

  it('an empty board still gets the smallest set when a generator is dropped on it', () => {
    const p = fixture(0, 80, { feeders: [] });
    expect(generatorForBoard(p, 'MDB')).toBe(20);
    expect(applyDrop(p, { kind: 'generator' } as never, { type: 'bus', boardId: 'MDB' }).project.boards[0].standby?.kva).toBe(20);
  });
});
