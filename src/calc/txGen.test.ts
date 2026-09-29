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
