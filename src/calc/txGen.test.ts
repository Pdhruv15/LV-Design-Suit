import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyTransformer, sizeGeneratorByBoards, sizeTransformers, TXGEN_DEFAULTS, typicalImpedancePct } from './txGen';
import { buildSection, scopeOf } from '../docs/studyReport';
import type { Project } from '../types';

const plan = TXGEN_DEFAULTS;
const twoMdbs: Project = {
  ...sampleProject,
  boards: [...sampleProject.boards, { id: 'MDB-2', name: 'Second MDB', kind: 'MDB', sourceKva: 500, sourceImpedancePct: 4, ratedCurrentA: 800 }],
  feeders: [...sampleProject.feeders, { id: 'MDB-2-L1', boardId: 'MDB-2', name: 'Chiller', loadKw: 700, demandFactor: 1, powerFactor: 0.85, lengthM: 30, cableCsaMm2: 240, cores: 4, breakerRatingA: 1250, breakerIcuKa: 36, loadType: 'hvac' }]
};

describe('transformer per main board', () => {
  it('one row per MDB with size, current, breaker, fault level; only the ticked ones', () => {
    const rows = sizeTransformers(twoMdbs, plan);
    expect(rows.map((r) => r.board.id)).toEqual(['MDB-1', 'MDB-2']);
    const r1 = rows[0];
    expect(r1.recommendedKva).toBe(1000); // DEWA list
    expect(r1.checks!.acbA).toBe(1600);
    expect(r1.checks!.faultKa).toBeGreaterThan(20);
    expect(r1.breakdown.map((b) => b.id)).toContain('SMDB-GF');
    const r2 = rows[1];
    expect(r2.recommendedKva).toBe(1500);
    expect(r2.adequate).toBe(false); // 500 kVA installed
    expect(sizeTransformers(twoMdbs, { ...plan, txBoards: ['MDB-2'] }).map((r) => r.board.id)).toEqual(['MDB-2']);
    // IEC list gives the next IEC size instead.
    expect(sizeTransformers(twoMdbs, { ...plan, sizeList: 'iec' })[0].recommendedKva).toBe(800);
    expect([typicalImpedancePct(500), typicalImpedancePct(1000), typicalImpedancePct(1500)]).toEqual([4, 5, 6]);
  });

  it('PF correction lowers the demand; too big for one transformer is split', () => {
    const withPfc = sizeTransformers(sampleProject, plan)[0];
    const without = sizeTransformers(sampleProject, { ...plan, includePfc: false })[0];
    expect(withPfc.pfcKvar).toBeGreaterThan(0);
    expect(withPfc.demandKva).toBeLessThan(without.demandKva);
    const huge: Project = { ...twoMdbs, feeders: twoMdbs.feeders.map((f) => (f.id === 'MDB-2-L1' ? { ...f, loadKw: 2500 } : f)) };
    const r = sizeTransformers(huge, plan).find((x) => x.board.id === 'MDB-2')!;
    expect(r.split).toBe(3);
    expect(r.recommendedKva).toBe(1500);
  });

  it('bus coupler outage: the other transformer carries both', () => {
    const tied: Project = { ...twoMdbs, ties: [{ id: 'BC-1', a: 'MDB-1', b: 'MDB-2', ratingA: 1600 }] };
    const r = sizeTransformers(tied, plan)[0];
    expect(r.outage!.with).toBe('MDB-2');
    expect(r.outage!.kva).toBeGreaterThan(r.demandKva);
    expect(r.outage!.ok).toBe(false); // 1000 kVA can't carry both
  });

  it('apply to SLD sets kVA, typical impedance and a busbar up to the ACB', () => {
    const r = sizeTransformers(twoMdbs, plan)[1];
    const b = applyTransformer(twoMdbs, r).boards.find((x) => x.id === 'MDB-2')!;
    expect([b.sourceKva, b.sourceImpedancePct, b.ratedCurrentA]).toEqual([1500, 6, 2500]);
  });
});

describe('generator from boards', () => {
  it('whole boards or a share of one; fire pumps added; boards below a picked one not counted twice', () => {
    const base = sizeGeneratorByBoards(sampleProject, plan);
    expect(base.picks).toEqual([]);
    expect(base.circuits.map((f) => f.loadType)).toContain('fire-pump');
    const withMcc = sizeGeneratorByBoards(sampleProject, { ...plan, genBoards: { 'MCC-1': 100 } });
    expect(withMcc.demandKw).toBeGreaterThan(base.demandKw);
    const half = sizeGeneratorByBoards(sampleProject, { ...plan, genBoards: { 'SMDB-GF': 50 } });
    const full = sizeGeneratorByBoards(sampleProject, { ...plan, genBoards: { 'SMDB-GF': 100 } });
    expect(half.picks[0].kw).toBeCloseTo(full.picks[0].kw / 2);
    const nested = sizeGeneratorByBoards(sampleProject, { ...plan, genBoards: { 'SMDB-GF': 100, 'DB-GF1': 100 } });
    expect(nested.picks.find((x) => x.board.id === 'DB-GF1')!.within).toBe('SMDB-GF');
    expect(nested.demandKw).toBeCloseTo(full.demandKw);
    // EMDBs count without ticking.
    const emdb: Project = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'SMDB-FF' ? { ...b, kind: 'EMDB' as const } : b)) };
    expect(sizeGeneratorByBoards(emdb, plan).picks.find((x) => x.board.id === 'SMDB-FF')!.auto).toBe('emdb');
  });

  it('the largest motor start can set the size; a soft starter would allow a smaller set', () => {
    const g = sizeGeneratorByBoards(sampleProject, plan);
    expect(g.motor).toBeDefined();
    expect(g.recommendedKva!).toBeGreaterThanOrEqual(g.startDesignKva);
    expect(g.motor!.dipPct!).toBeLessThanOrEqual(15);
    expect(g.softStartKva!).toBeLessThan(g.recommendedKva!);
    expect(g.atsA!).toBeGreaterThanOrEqual(g.flcA!);
  });

  it('sizing sheet for the chosen boards', () => {
    const p: Project = { ...twoMdbs, txGen: { genBoards: { 'MCC-1': 100 } } };
    const s = buildSection('sizing', { project: p, results: [], earthing: [], selectivity: [] }, scopeOf(p, { boards: ['MDB-2'], downstream: true }));
    expect(s.tables[0].rows.map((r) => r[0])).toEqual(['MDB-2']);
    expect(s.tables.some((t) => t.title?.startsWith('Standby generator'))).toBe(true);
    expect(s.statuses).toContain('bad');
  });
});

describe('ENG-004: a proposed split never counts as installed transformers', () => {
  const fixture = (sourceKva?: number, loadKw = 2500): Project => ({
    ...sampleProject,
    voltageV: 400,
    studySettings: { ...sampleProject.studySettings, futureGrowthPct: 0, transformerMaxLoadingPct: 100 },
    txGen: { sizeList: 'dewa', includePfc: false },
    boards: [{ id: 'MDB', name: 'MDB', sourceKva, ratedCurrentA: 6300 }],
    feeders: [{ id: 'L1', boardId: 'MDB', name: 'Load', loadKw, demandFactor: 1, powerFactor: 1, lengthM: 10, cableCsaMm2: 300, parallel: 8, cores: 4, breakerRatingA: 4000, breakerIcuKa: 100 }],
    ties: undefined, pfc: undefined, busRisers: undefined
  } as Project);

  it('one installed 1500 kVA for a 2500 kVA design: the 2 × 1500 kVA proposal stays, installed is not adequate', () => {
    const r = sizeTransformers(fixture(1500))[0];
    expect(r.demandKva).toBeCloseTo(2500, 6);
    expect(r.designKva).toBeCloseTo(2500, 6);
    expect(r.split).toBe(2);
    expect(r.recommendedKva).toBe(1500);
    expect(r.installedKva).toBe(1500);
    expect(r.loadingPct).toBeCloseTo(166.67, 1);
    expect(r.adequate).toBe(false);
  });

  it('the Study Report shows the proposal and fails the installed transformer', () => {
    const p = fixture(1500);
    const s = buildSection('sizing', { project: p, results: [], earthing: [], selectivity: [] }, scopeOf(p, { boards: [], downstream: true }));
    const row = s.tables.find((t) => t.title === 'Transformers')!.rows[0];
    expect(row[4]).toBe('2 × 1500 kVA');
    expect(String(row[5])).toMatch(/^1500 kVA · 167 %$/);
    expect(row[row.length - 1]).toMatchObject({ s: 'bad' });
    expect(s.statuses.filter((x) => x === 'bad').length).toBe(1);
    expect(s.summary.find((x) => x.label === 'MDB transformer')!.status).toBe('bad');
  });

  it('equal capacity is adequate; no source rating leaves adequacy undefined', () => {
    const eq = sizeTransformers(fixture(1500, 1500))[0];
    expect(eq.designKva).toBeCloseTo(1500, 6);
    expect(eq.adequate).toBe(true);
    expect(sizeTransformers(fixture(undefined))[0].adequate).toBeUndefined();
  });

  it('a larger split proposal never multiplies installed capacity', () => {
    for (const kw of [2500, 3500, 4400]) {
      const r = sizeTransformers(fixture(1500, kw))[0];
      expect(r.split).toBeGreaterThan(1);
      expect(r.adequate).toBe(false);
    }
  });
});
