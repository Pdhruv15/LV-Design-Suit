import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Board, Feeder, Project } from '../types';
import { designCurrentA, evaluateFeeder, feederVdPctAt, incomerBasis, runsOf, voltageDropPct } from './electrical';
import { boardSummary } from './summary';
import { vdFormula, vdRow } from './voltageDrop';
import { vdCells, VD_HEADERS } from '../docs/voltageDropReport';
import { buildSection, scopeOf } from '../docs/studyReport';
import { applyRecommendation, recommend } from './sizing';

/** ENG-005: an incomer's current and voltage drop come from the downstream P and Q per phase. */
const inc = (extra: Partial<Feeder> = {}): Feeder => ({
  id: 'INC', boardId: 'MDB', name: 'Incomer', feedsBoardId: 'SMDB', loadKw: 0, demandFactor: 1, powerFactor: 1,
  lengthM: 60, cableCsaMm2: 95, cores: 4, breakerRatingA: 250, breakerIcuKa: 50, ...extra
});
const load = (id: string, kw: number, df: number, pf: number, extra: Partial<Feeder> = {}): Feeder => ({
  id, boardId: 'SMDB', name: id, loadKw: kw, demandFactor: df, powerFactor: pf, lengthM: 10, cableCsaMm2: 50, cores: 4, breakerRatingA: 125, breakerIcuKa: 25, ...extra
});
const project = (loads: Feeder[], extraBoards: Board[] = [], incomer = inc(), more: Feeder[] = []): Project => ({
  ...sampleProject, voltageV: 415, vdTempC: undefined, ambientC: 30, vdLimitPct: 4,
  boards: [{ id: 'MDB', name: 'MDB', sourceKva: 2000 }, { id: 'SMDB', name: 'SMDB', upstreamId: 'MDB', ratedCurrentA: 400 }, ...extraBoards],
  feeders: [incomer, ...loads, ...more], ties: undefined, trays: undefined, busRisers: undefined, pv: undefined
} as Project);
const balanced = () => [load('L1', 100, 0.8, 0.8), load('L2', 40, 1, 1)];
const one = (id: string, phase: 'R' | 'Y' | 'B', kw: number, pf: number) => load(id, kw, 1, pf, { cores: 2, phase });

describe('ENG-005: incomer current and voltage drop from downstream P and Q', () => {
  it('balanced mixed PF: 120 kW + j60 kvar → PF 0.894427, 186.649800 A, 1.124993 %', () => {
    const p = project(balanced());
    const f = p.feeders[0];
    const b = incomerBasis(f, p);
    expect(b.totalP).toBeCloseTo(120, 9);
    expect(b.totalQ).toBeCloseTo(60, 9);
    expect(b.current.pf).toBeCloseTo(0.894427, 6);
    expect(designCurrentA(f, p)).toBeCloseTo(186.6498, 4);
    expect(boardSummary(p, p.boards[1]).currentA).toBeCloseTo(designCurrentA(f, p), 6); // balanced: equal
    expect(voltageDropPct(f, p)).toBeCloseTo(1.124993, 6);
  });

  it('the stored incomer PF changes nothing', () => {
    const a = project(balanced()), z = project(balanced(), [], inc({ powerFactor: 0.5 }));
    expect(designCurrentA(z.feeders[0], z)).toBeCloseTo(designCurrentA(a.feeders[0], a), 9);
    expect(voltageDropPct(z.feeders[0], z)).toBeCloseTo(voltageDropPct(a.feeders[0], a), 9);
  });

  it('unbalanced: R 10 kW PF 1, Y 9 kW PF 0.6 → Y’s 15 kVA governs, 62.604246 A', () => {
    const p = project([one('R1', 'R', 10, 1), one('Y1', 'Y', 9, 0.6)]);
    const b = incomerBasis(p.feeders[0], p);
    expect(b.current.phase).toBe('Y');
    expect(designCurrentA(p.feeders[0], p)).toBeCloseTo(62.604246, 5);
  });

  it('capacitors keep the sign of Q: +30 kvar and −30 kvar net give the same current, different drops', () => {
    const cap = (kvar: number) => load('CAP', 0, 1, 1, { kvar, loadType: 'capacitor' });
    const p30 = project([...balanced(), cap(30)]), p90 = project([...balanced(), cap(90)]);
    expect(incomerBasis(p30.feeders[0], p30).totalQ).toBeCloseTo(30, 9);
    expect(incomerBasis(p90.feeders[0], p90).totalQ).toBeCloseTo(-30, 9);
    expect(designCurrentA(p30.feeders[0], p30)).toBeCloseTo(172.082613, 5);
    expect(designCurrentA(p90.feeders[0], p90)).toBeCloseTo(172.082613, 5);
    expect(voltageDropPct(p30.feeders[0], p30)).toBeCloseTo(1.046608, 6);
    expect(voltageDropPct(p90.feeders[0], p90)).toBeCloseTo(0.889836, 6);
  });

  it('current and drop can be governed by different phases: R 10 kW PF 1, Y 6 kW PF 0.5', () => {
    const p = project([one('R1', 'R', 10, 1), one('Y1', 'Y', 6, 0.5)]);
    const b = incomerBasis(p.feeders[0], p);
    expect(b.current.phase).toBe('Y');
    expect(b.vd.phase).toBe('R');
    const r = vdRow(p, p.feeders[0]);
    expect(r.ib).toBeCloseTo(b.current.a, 9); // Ib: the Y current
    expect(r.vdBasis).toMatchObject({ phase: 'R', currentPhase: 'Y' });
    expect(r.vdPct).toBeCloseTo(b.vd.pct, 9); // the drop: the R phase
    expect(r.vdV).toBeCloseTo((r.mvPerAm * r.vdBasis!.a * 60) / 1000, 9); // the shown derivation reproduces it
    expect(vdFormula(p, r)).toMatch(/drop on phase R .*the current .* is on phase Y/);
    const cells = vdCells(r);
    expect(cells[VD_HEADERS.indexOf('Remarks')]).toMatch(/Vd on phase R: .* \(Ib on Y\)/);
  });

  it('nested boards: loads two levels down reach the top incomer', () => {
    const db: Board = { id: 'DB', name: 'DB', upstreamId: 'SMDB' };
    const sub = load('SUB', 0, 1, 1, { feedsBoardId: 'DB', lengthM: 20 });
    const deep = { ...load('D1', 30, 1, 0.8), boardId: 'DB' };
    const p = project([load('L2', 40, 1, 1), sub], [db], inc(), [deep]);
    const b = incomerBasis(p.feeders[0], p);
    expect(b.totalP).toBeCloseTo(70, 9);
    expect(b.totalQ).toBeCloseTo(30 * 0.75, 9);
  });

  it('parity: feeder results, VD row, VD export and the load-flow report agree', () => {
    const p = project(balanced());
    const f = p.feeders[0];
    const e = evaluateFeeder(p, f), r = vdRow(p, f);
    expect(e.ib).toBeCloseTo(r.ib, 9);
    expect(e.vdPct).toBeCloseTo(r.vdPct, 9);
    const cells = vdCells(r);
    expect(cells[VD_HEADERS.indexOf('PF')]).toBe('0.89');
    expect(cells[VD_HEADERS.indexOf('Ib (A)')]).toBe('186.6');
    expect(cells[VD_HEADERS.indexOf('Vd (%)')]).toBe('1.12');
    const lf = buildSection('lf', { project: p, results: p.feeders.map((x) => evaluateFeeder(p, x)), earthing: [], selectivity: [] }, scopeOf(p, { boards: [], downstream: true }));
    const row = lf.tables.find((t) => t.title === 'Feeders')!.rows.find((x) => JSON.stringify(x).includes('INC'))!;
    expect(String(row[5])).toBe('186.6');
    expect(String(row[6])).toBe('0.89');
    expect(String(row[7])).toBe('1.12');
  });

  it('Fix and Optimise: the applied cable meets the incomer budget on the same P / Q basis', () => {
    const p = project(balanced(), [], inc({ cableCsaMm2: 16, lengthM: 120, breakerRatingA: 100 }));
    for (const mode of ['fix', 'optimise'] as const) {
      const r = recommend(p, p.feeders[0], mode);
      const a = applyRecommendation(p.feeders[0], r);
      const q = { ...p, feeders: p.feeders.map((x) => (x.id === 'INC' ? a : x)) };
      const vd = voltageDropPct(a, q);
      expect(vd).toBeCloseTo(feederVdPctAt(a, q, a.cableCsaMm2, runsOf(a)), 12);
      expect(designCurrentA(a, q)).toBeCloseTo(186.6498, 3);
      expect(vd).toBeLessThanOrEqual(1 + 1e-9); // the incomer budget (INCOMER_VD_BUDGET_PCT = 1 %)
      expect(a.cableCsaMm2).toBeGreaterThan(16);
    }
  });

  it('end loads, capacitor branches and homogeneous PF are unchanged', () => {
    const p = project(balanced());
    const l1 = p.feeders.find((f) => f.id === 'L1')!;
    expect(designCurrentA(l1, p)).toBeCloseTo((80 * 1000) / (Math.sqrt(3) * 415 * 0.8), 9);
    const cap = load('CAP', 0, 1, 1, { kvar: 50, loadType: 'capacitor' });
    expect(designCurrentA(cap, p)).toBeCloseTo((50 * 1000) / (Math.sqrt(3) * 415), 9);
    // All loads at PF 0.85: the derived basis equals the old "stored PF 0.85" formula.
    const h = project([load('H1', 100, 1, 0.85)], [], inc({ powerFactor: 0.85 }));
    const old = (100 * 1000) / (Math.sqrt(3) * 415 * 0.85);
    expect(designCurrentA(h.feeders[0], h)).toBeCloseTo(old, 9);
  });
});
