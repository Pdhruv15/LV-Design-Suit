import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';
import { evaluateEarthing } from './earthing';
import { buildSection, scopeOf } from '../docs/studyReport';
import { buildReportHtml } from '../docs/report';
import { runCalculations } from './runs';

/** ENG-012: parallel CPCs are checked with the current through each one. */
const feeder = (extra: Partial<Feeder> = {}): Feeder => ({
  id: 'F', boardId: 'MDB', name: 'F', loadKw: 10, demandFactor: 1, powerFactor: 1, lengthM: 15, parallel: 2,
  cableCsaMm2: 4, cpcMm2: 4, cores: 4, breakerRatingA: 32, breakerIcuKa: 25, ...extra
});
const project = (f: Feeder): Project => ({
  ...sampleProject, voltageV: 400, vdTempC: undefined,
  boards: [{ id: 'MDB', name: 'MDB', sourceKva: 1000, sourceImpedancePct: 5 }], feeders: [f], ties: undefined, trays: undefined
} as Project);
const ev = (extra: Partial<Feeder> = {}) => { const f = feeder(extra); return evaluateEarthing(project(f), f); };

describe('ENG-012: parallel CPC thermal check against the current in each CPC', () => {
  it('two identical runs: 2,581.79 A total, 1,290.90 A each → 2.854665 mm² each, passes only with sharing', () => {
    const r = ev();
    expect(r.faultA).toBeCloseTo(2581.7912, 3);
    expect(r.runs).toBe(2);
    expect(r.cpcCurrentA).toBeCloseTo(1290.8956, 3);
    expect(r.adiabaticMinMm2).toBeCloseTo((r.faultA / 2) * Math.sqrt(0.1) / 143, 9);
    expect(r.adiabaticMinMm2).toBeCloseTo(2.854665, 5);
    expect(r.adiabaticWholeMm2).toBeCloseTo(5.709329, 5);
    expect(r.adiabaticMinMm2 * 2).toBeCloseTo(r.adiabaticWholeMm2, 9); // aggregate equivalent: 5.71 of 8 mm²
    expect(r.adiabatic).toBe('warn'); // passes only on the equal-sharing assumption — not 'ok', not 'bad'
    expect(r.adiabaticNote).toMatch(/each 4 mm² CPC carries 1291 A of the 2582 A .* 5\.7 of 8 mm² together.*not verified for a fault within one run/);
    expect(r.status).toBe('warn');
  });

  it('one run is unchanged', () => {
    const r = ev({ parallel: 1 });
    expect(r.runs).toBe(1);
    expect(r.cpcCurrentA).toBeCloseTo(r.faultA, 12);
    expect(r.adiabaticMinMm2).toBeCloseTo(r.faultA * Math.sqrt(0.1) / 143, 12);
    expect(r.adiabaticNote).toBeUndefined();
    expect(r.adiabatic).toBe(r.cpcMm2 >= r.adiabaticMinMm2 ? 'ok' : 'bad');
  });

  it('three runs: the total current sets disconnection, each CPC checks its third', () => {
    const r = ev({ parallel: 3, cableCsaMm2: 50, cpcMm2: 25 });
    expect(r.cpcCurrentA).toBeCloseTo(r.faultA / 3, 9);
    expect(r.disconnection).toBe(r.faultA >= r.tripA ? 'ok' : r.requiredS >= 5 ? 'warn' : 'bad');
    expect(r.adiabaticMinMm2).toBeCloseTo((r.faultA / 3) * Math.sqrt(0.1) / 143, 9);
  });

  it('an undersized CPC still fails (the current is divided once)', () => {
    const r = ev({ cpcMm2: 1.5 }); // a smaller CPC also lowers the fault current a little
    expect(r.adiabaticMinMm2).toBeCloseTo((r.faultA / 2) * Math.sqrt(0.1) / 143, 12); // halved once, not twice
    expect(r.adiabaticMinMm2).toBeGreaterThan(1.5);
    expect(r.adiabatic).toBe('bad');
  });

  it('a CPC that carries the whole fault current alone passes outright (covers a fault within one run)', () => {
    const r = ev({ cpcMm2: 10 });
    expect(r.cpcMm2).toBeGreaterThanOrEqual(r.adiabaticWholeMm2);
    expect(r.adiabatic).toBe('ok');
    expect(r.adiabaticNote).toMatch(/a fault within one run is covered too/);
  });

  it('report and study report show the per-CPC value, the runs and the assumption', () => {
    const f = feeder(), p = project(f);
    const run = runCalculations(p);
    const sec = buildSection('earth', { project: p, results: run.results, earthing: run.earthing, selectivity: run.selectivity }, scopeOf(p, { boards: [], downstream: true }));
    const row = sec.tables[0].rows.find((x) => JSON.stringify(x).includes('"F"') || x[0] === 'F' || JSON.stringify(x).includes('F'))!;
    expect(sec.tables[0].headers).toContain('CPC min, each (mm²)');
    expect(JSON.stringify(row)).toMatch(/2\.9 \(2 runs, 1291 A each, assumed sharing\)/);
    expect(sec.method.join(' ')).toMatch(/Parallel runs: each CPC carries an equal share/);
    expect(buildReportHtml(p)).toMatch(/2\.9 <span class="m">\(2 runs, 1291 A each, assumed equal sharing/);
  });
});
