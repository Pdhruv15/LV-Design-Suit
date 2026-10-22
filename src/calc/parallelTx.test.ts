import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyDrop } from '../model/sldEdit';
import { boardTotals } from './summary';
import { faultCurrentKA, impedanceToBoard, parallelGroup, transformerImpedance } from './electrical';
import { earthLoopToBoard } from './earthing';
import { parallelOperation } from './parallelTx';
import { generatorScenario, transformerOutage } from './scenario';
import { sizeTransformers } from './txGen';
import { exportDss } from '../engines/opendss/exportDss';
import { buildBom } from './bom';
import { runCalculations } from './runs';
import { buildSection, scopeOf } from '../docs/studyReport';
import { unresolvedChecks } from '../docs/issuePackage';
import type { Project } from '../types';

/** The sample plus a second transformer-fed MDB (1000 kVA) with a chiller, tied to MDB-1. */
function tied(closed: boolean): Project {
  let p = applyDrop(sampleProject, { kind: 'transformer' }, { type: 'canvas' }).project;
  p = applyDrop(p, { kind: 'load', preset: 'chiller' }, { type: 'bus', boardId: 'MDB-2' }).project;
  p = applyDrop(p, { kind: 'tie' }, { type: 'bus', boardId: 'MDB-1' }).project;
  return { ...p, ties: p.ties!.map((t) => ({ ...t, closed })) };
}
const tx = (p: Project, id: string) => p.boards.find((b) => b.id === id)!;
const setTx = (p: Project, id: string, kva: number, z: number, vectorGroup?: string): Project =>
  ({ ...p, boards: p.boards.map((b) => (b.id === id ? { ...b, sourceKva: kva, sourceImpedancePct: z, ...(vectorGroup ? { vectorGroup } : {}) } : b)) });

describe('transformers in parallel through a closed bus coupler', () => {
  it('a normally-open coupler leaves each board on its own transformer', () => {
    const p = tied(false);
    expect(parallelGroup(p, 'MDB-1').map((b) => b.id)).toEqual(['MDB-1']);
    expect(parallelOperation(p)).toEqual([]);
    const b = tx(p, 'MDB-1');
    expect(faultCurrentKA(impedanceToBoard(p, 'MDB-1'), 415)).toBeCloseTo(faultCurrentKA(transformerImpedance(b.sourceKva!, b.sourceImpedancePct!, 415, b.sourceXr), 415), 9);
  });

  it('closed, the busbar fault is from both transformers: two equal ones double it', () => {
    const open = setTx(setTx(tied(false), 'MDB-1', 1000, 6), 'MDB-2', 1000, 6);
    const closed = setTx(setTx(tied(true), 'MDB-1', 1000, 6), 'MDB-2', 1000, 6);
    expect(parallelGroup(closed, 'MDB-2').map((b) => b.id)).toEqual(['MDB-2', 'MDB-1']);
    const one = faultCurrentKA(impedanceToBoard(open, 'MDB-1'), 415);
    expect(one).toBeCloseTo((1.05 * 415) / (Math.sqrt(3) * ((415 * 415 * 0.06) / 1e6)) / 1000, 6); // ≈ 24.3 kA
    expect(faultCurrentKA(impedanceToBoard(closed, 'MDB-1'), 415)).toBeCloseTo(2 * one, 6);
    expect(faultCurrentKA(impedanceToBoard(closed, 'MDB-2'), 415)).toBeCloseTo(2 * one, 6);
    // Downstream boards see the higher fault too.
    expect(faultCurrentKA(impedanceToBoard(closed, 'SMDB-GF'), 415)).toBeGreaterThan(faultCurrentKA(impedanceToBoard(open, 'SMDB-GF'), 415));
    // The earth fault loop keeps one transformer (coupler open: the minimum fault).
    expect(earthLoopToBoard(closed, 'MDB-1')).toEqual(earthLoopToBoard(open, 'MDB-1'));
    // The transformer sizing check shows the joined fault level.
    const row = sizeTransformers(closed).find((r) => r.board.id === 'MDB-1')!;
    expect(row.checks!.faultKa).toBeGreaterThan(1.9 * sizeTransformers(open).find((r) => r.board.id === 'MDB-1')!.checks!.faultKa);
  });

  it('shares the joined load by kVA ÷ uk %, and the coupler carries the difference', () => {
    const p = setTx(setTx(tied(true), 'MDB-1', 1500, 6), 'MDB-2', 1000, 6);
    const [g] = parallelOperation(p);
    expect(g.boards).toEqual(['MDB-1', 'MDB-2']);
    const a = boardTotals(p, 'MDB-1'), b = boardTotals(p, 'MDB-2');
    const total = Math.hypot(a.demandKw + b.demandKw, Math.max(0, a.demandKvar) + Math.max(0, b.demandKvar));
    expect(g.demandKva).toBeCloseTo(total, 6);
    const [t1, t2] = g.transformers;
    expect(t1.shareKva).toBeCloseTo(total * 0.6, 6); // 1500/6 : 1000/6 = 60 : 40
    expect(t2.shareKva).toBeCloseTo(total * 0.4, 6);
    expect(t1.loadingPct).toBeCloseTo(t2.loadingPct, 6); // equal uk: equal loading
    const flow = Math.hypot(0.6 * (a.demandKw + b.demandKw) - a.demandKw, 0.6 * (Math.max(0, a.demandKvar) + Math.max(0, b.demandKvar)) - Math.max(0, a.demandKvar));
    expect(g.couplers[0].currentA).toBeCloseTo((flow * 1000) / (Math.sqrt(3) * 415), 6);
    expect(g.conditions).toEqual([]);
  });

  it('flags the conditions for parallel operation', () => {
    const p = setTx(setTx(tied(true), 'MDB-1', 2000, 6), 'MDB-2', 500, 4.5, 'Dyn1');
    const [g] = parallelOperation(p);
    expect(g.conditions.map((c) => c.status)).toEqual(['bad', 'warn', 'warn']); // vector group, uk %, ratings
    expect(g.status).toBe('bad');
    // The lower-impedance transformer takes more than its kVA share.
    const [big, small] = g.transformers;
    expect(small.loadingPct / big.loadingPct).toBeCloseTo(6 / 4.5, 6);
  });

  it('an overloaded coupler fails', () => {
    const p = tied(true);
    const small = { ...p, ties: p.ties!.map((t) => ({ ...t, ratingA: 10 })) };
    expect(parallelOperation(small)[0].couplers[0].status).toBe('bad');
  });

  it('with one transformer out, the other carries both (as with a normally-open coupler)', () => {
    const s = transformerOutage(tied(true), 'MDB-1');
    expect(s.project.boards.find((b) => b.id === 'MDB-1')!.upstreamId).toBe('MDB-2');
    expect(parallelGroup(s.project, 'MDB-2').map((b) => b.id)).toEqual(['MDB-2']);
    expect(parallelOperation(s.project)).toEqual([]);
  });

  it('on generators the couplers are back to normally open', () => {
    const p = tied(true);
    const s = generatorScenario({ ...p, boards: p.boards.map((b) => (b.id === 'MDB-1' || b.id === 'MDB-2' ? { ...b, standby: { kva: 500 } } : b)) });
    expect(s.project.ties!.every((t) => !t.closed)).toBe(true);
    expect(parallelGroup(s.project, 'MDB-1').map((b) => b.id)).toEqual(['MDB-1']);
  });

  it('OpenDSS joins the busbars with a switch, and the BOQ says normally closed', () => {
    expect(exportDss(tied(true)).script).toMatch(/New Line\.TIE_BC-1 phases=3 .* switch=yes/);
    expect(exportDss(tied(false)).script).not.toMatch(/TIE_/);
    const item = (p: Project) => buildBom(p).find((x) => /Bus coupler/.test(x.description))!.description;
    expect(item(tied(true))).toMatch(/normally closed, transformers in parallel/);
    expect(item(tied(false))).toMatch(/normally open, interlocked with the incomers/);
  });

  it('the study report shows the parallel operation and lists its failures as unresolved', () => {
    const section = (p: Project, key: 'sizing' | 'sc') => {
      const r = runCalculations(p);
      return buildSection(key, { project: p, results: r.results, earthing: r.earthing, selectivity: r.selectivity }, scopeOf(p, { boards: [], downstream: true }));
    };
    const open = section(tied(false), 'sizing');
    expect(open.tables.some((t) => /in parallel/.test(t.title ?? ''))).toBe(false);
    const bad = setTx(tied(true), 'MDB-2', 1000, 5, 'Dyn1'); // as MDB-1 but the vector group
    const s = section(bad, 'sizing');
    expect(s.tables.find((t) => t.title === 'Transformers in parallel — MDB-1 + MDB-2')!.rows.map((r) => r[0])).toEqual(['MDB-1', 'MDB-2', 'Coupler BC-1', 'Joined busbar', 'Condition']);
    expect(s.method.some((l) => /IEC 60076-8/.test(l))).toBe(true);
    expect(unresolvedChecks([s]).some((u) => u.status === 'bad' && /Vector groups differ/.test(u.check))).toBe(true);
    expect(section(bad, 'sc').method.some((l) => /closed bus coupler/.test(l))).toBe(true);
  });
});
