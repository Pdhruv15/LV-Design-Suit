import { describe, expect, it } from 'vitest';
import { phaseBalance } from './phaseBalance';
import { buildSection, scopeOf, type CalcData } from '../docs/studyReport';
import { runCalculations } from './runs';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Phase, Project } from '../types';

const c = (id: string, phase: Phase | undefined, kw = 2.3, pf = 1, cores: 2 | 4 = 2, boardId = 'DB'): Feeder => ({
  id, boardId, name: id, loadKw: kw, demandFactor: 1, powerFactor: pf, lengthM: 10, cableCsaMm2: 2.5, cores, breakerRatingA: 16, breakerIcuKa: 10, ...(phase ? { phase } : {})
});
const P = (feeders: Feeder[]): Project => ({ name: 'T', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [{ id: 'DB', name: 'DB', sourceKva: 500, sourceImpedancePct: 5 }], feeders });
const I = 2300 / (400 / Math.sqrt(3)); // 9.959 A

describe('phase balance (demand, nominal voltage)', () => {
  it('balanced single-phase loads: equal currents, no neutral current, 0 % unbalance', () => {
    const r = phaseBalance(P([c('a', 'R'), c('b', 'Y'), c('d', 'B')]), 'DB');
    for (const ph of ['R', 'Y', 'B'] as const) expect(r.currentA[ph]).toBeCloseTo(I, 6);
    expect(r.neutralA).toBeCloseTo(0, 9);
    expect(r.unbalancePct).toBeCloseTo(0, 9);
    expect(r.status).toBe('ok');
  });

  it('one phase loaded: neutral = that phase current; unbalance (I − avg) ÷ avg = 200 %', () => {
    const r = phaseBalance(P([c('a', 'R')]), 'DB');
    expect(r.currentA.R).toBeCloseTo(I, 6);
    expect(r.neutralA).toBeCloseTo(I, 6);
    expect(r.unbalancePct).toBeCloseTo(200, 6);
    expect(r.status).toBe('warn');
  });

  it('two equal phases at PF 1: neutral equals one phase current (120° apart)', () => {
    expect(phaseBalance(P([c('a', 'R'), c('b', 'Y')]), 'DB').neutralA).toBeCloseTo(I, 6);
  });

  it('power factor sets the current and the neutral angle', () => {
    const r = phaseBalance(P([c('a', 'R', 2.3, 0.8), c('b', 'Y', 2.3, 1), c('d', 'B', 2.3, 1)]), 'DB');
    expect(r.currentA.R).toBeCloseTo(I / 0.8, 6);
    // independent phasor sum: R at −acos(0.8), Y at −120°, B at +120°
    const ph = (m: number, a: number) => [m * Math.cos(a), m * Math.sin(a)];
    const v = [ph(I / 0.8, -Math.acos(0.8)), ph(I, (-2 * Math.PI) / 3), ph(I, (2 * Math.PI) / 3)].reduce((s, x) => [s[0] + x[0], s[1] + x[1]], [0, 0]);
    expect(r.neutralA).toBeCloseTo(Math.hypot(v[0], v[1]), 6);
  });

  it('3-phase loads spread evenly; single-phase circuits without a phase are flagged, never an ok', () => {
    const three = phaseBalance(P([c('m', undefined, 9, 0.85, 4)]), 'DB');
    expect(three.unbalancePct).toBeCloseTo(0, 9);
    expect(three.unassigned).toHaveLength(0);
    const missing = phaseBalance(P([c('a', undefined), c('b', 'RYB')]), 'DB');
    expect(missing.unbalancePct).toBeCloseTo(0, 9); // spread evenly — that's why it is flagged
    expect(missing.unassigned.map((f) => f.id)).toEqual(['a', 'b']);
    expect(missing.status).toBe('warn');
  });

  it('study report section on the sample project', () => {
    const run = runCalculations(sampleProject);
    const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
    const s = buildSection('phase', data, scopeOf(run.project, { boards: [], downstream: true }));
    expect(s.tables[0].rows).toHaveLength(sampleProject.boards.length);
    expect(s.method.join(' ')).toMatch(/not an unbalanced load flow/);
  });
});
