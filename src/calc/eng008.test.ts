import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';
import { PV_DEFAULTS, sizePv, type PvSystem } from './solar';
import { pvToSld } from '../model/pvFeeder';
import { buildPvReportHtml } from '../docs/upsSolarReport';

/** ENG-008: the Solar AC breaker is never clamped to the largest rating. */
const big = (targetKwp: number): PvSystem => ({
  ...PV_DEFAULTS, mode: 'kwp', targetKwp, dcAcRatio: 1.2,
  inverter: { ...PV_DEFAULTS.inverter, acKw: 250, mppts: 16, maxInputA: 50, phases: 3 }
});
const project = { ...sampleProject, voltageV: 400, boards: [{ id: 'MDB', name: 'MDB', sourceKva: 5000 }], feeders: [], ties: undefined, trays: undefined, pv: undefined } as Project;

describe('ENG-008: no suitable AC breaker is reported, never clamped', () => {
  it('2,000 kWp: 7 × 250 kW, 2,525.907428 A needs 3,157.38 A → 3,200 A from the shared list', () => {
    const r = sizePv(big(2000), 400);
    expect([r.panels, r.inverters]).toEqual([3638, 7]);
    expect(r.kwp).toBeCloseTo(2000.9, 6);
    expect(r.mpptCurrentA).toBeCloseTo(35, 9);
    expect(r.acCurrentA).toBeCloseTo(2525.907428, 5);
    expect(r.acBreakerRequiredA).toBeCloseTo(3157.384285, 5);
    expect(r.acBreakerA).toBe(3200);
    expect(r.acBreakerNoFit).toBe(false);
  });

  it('5,000 kWp: 6,134.35 A needs 7,667.93 A — no suitable breaker, failure, not 2,500 A', () => {
    const r = sizePv(big(5000), 400);
    expect([r.panels, r.inverters]).toEqual([9093, 17]);
    expect(r.acCurrentA).toBeCloseTo(6134.34661, 5);
    expect(r.acBreakerRequiredA).toBeCloseTo(7667.933263, 5);
    expect(r.acBreakerA).toBeUndefined();
    expect(r.acBreakerNoFit).toBe(true);
    expect(r.status).toBe('bad');
    expect(r.notes.join(' ')).toMatch(/No suitable AC breaker in the available list: 7668 A needed .* largest available 4000 A/);
    const html = buildPvReportHtml(project, big(5000), r);
    expect(html).toMatch(/No suitable breaker in the available list — 7,?668 A needed \(1\.25 × I\), largest available 4000 A/);
    expect(html).not.toMatch(/2500 A breaker|undefined A/);
  });

  it('every selected rating covers the requirement; equal to the largest fits, just above does not', () => {
    // One 50 kW inverter; the voltage is chosen so that 1.25 × I is exactly 4000 A, then just above.
    const one: PvSystem = { ...PV_DEFAULTS, targetKwp: 50 };
    const vExact = (50 * 1000) / (Math.sqrt(3) * 3200);
    const exact = sizePv(one, vExact);
    expect(exact.acBreakerRequiredA).toBeCloseTo(4000, 6);
    expect(exact.acBreakerA).toBe(4000);
    const above = sizePv(one, vExact * 0.999);
    expect(above.acBreakerRequiredA).toBeGreaterThan(4000);
    expect(above.acBreakerA).toBeUndefined();
    expect(above.acBreakerNoFit).toBe(true);
    for (const r of [exact, sizePv(big(2000), 400)]) expect(r.acBreakerA!).toBeGreaterThanOrEqual(r.acBreakerRequiredA - 1e-9);
  });

  it('normal cases keep their result: 50 kW three-phase → 100 A; 5 kW one-phase → 32 A', () => {
    const three = sizePv(PV_DEFAULTS, 400);
    expect(three.acCurrentA).toBeCloseTo((50 * 1000) / (Math.sqrt(3) * 400), 9);
    expect(three.acBreakerA).toBe(100);
    const onePhase = sizePv({ ...PV_DEFAULTS, targetKwp: 5.5, inverter: { ...PV_DEFAULTS.inverter, acKw: 5, phases: 1 } }, 400);
    expect(onePhase.acCurrentA).toBeCloseTo(21.650635, 5);
    expect(onePhase.acBreakerA).toBe(32);
  });

  it('a zero array has no breaker and no breaker failure', () => {
    const r = sizePv({ ...PV_DEFAULTS, targetKwp: 0 }, 400);
    expect(r.acCurrentA).toBe(0);
    expect(r.acBreakerA).toBeUndefined();
    expect(r.acBreakerNoFit).toBe(false);
    expect(r.notes.join(' ')).not.toMatch(/breaker/);
  });

  it('Add / Update: sized when the general sizing fits, nothing applied when it does not', () => {
    // 500 kWp (2 × 250 kW, 721.7 A): one connection fits.
    const ok = pvToSld(project, big(500), sizePv(big(500), 400), 'MDB')!;
    expect(ok.unresolved).toBeUndefined();
    expect(ok.feeder.breakerRatingA).toBeGreaterThanOrEqual(sizePv(big(500), 400).acCurrentA / 0.85); // general rule I ÷ 0.85
    // 2,000 kWp: the Solar page finds a 3,200 A breaker, but the SLD sizing finds no cable for one
    // connection (even 8 × 300 mm²) — it is not added, and the reason is returned.
    const noCable = pvToSld(project, big(2000), sizePv(big(2000), 400), 'MDB')!;
    expect(noCable.unresolved).toMatch(/No cable fits/);
    expect(noCable.project).toBe(project);
    const bad = pvToSld(project, big(5000), sizePv(big(5000), 400), 'MDB')!;
    expect(bad.unresolved).toBeTruthy();
    expect(bad.project).toBe(project); // the SLD is unchanged — no placeholder 100 A feeder
    // Updating an existing PV feeder to a size that can't be protected keeps the old feeder and says so.
    const upd = pvToSld(ok.project, big(5000), sizePv(big(5000), 400), 'MDB')!;
    expect(upd.existing).toBe(true);
    expect(upd.unresolved).toBeTruthy();
    expect(upd.project).toBe(ok.project);
  });
});

import { pvConnection } from '../model/pvFeeder';

describe('Solar page: SLD connection check (follow-up to ENG-008)', () => {
  it('shows the SLD breaker and cable when one connection fits, and why not when it does not', () => {
    const ok = pvConnection(project, big(500), sizePv(big(500), 400), 'MDB')!;
    expect(ok.ok).toBe(true);
    expect(ok.text).toMatch(/A breaker, .*C × \d+ mm²/);
    // 2,000 kWp: the Solar breaker is 3,200 A, but no single cable fits — now visible on the page / report.
    const r = sizePv(big(2000), 400);
    expect(r.acBreakerA).toBe(3200);
    const bad = pvConnection(project, big(2000), r, 'MDB')!;
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/Can't be built as one connection on MDB: No cable fits/);
    expect(buildPvReportHtml({ ...project, pv: { ...big(2000), boardId: 'MDB' } }, { ...big(2000), boardId: 'MDB' }, r)).toMatch(/SLD connection.*Can&#39;t be built as one connection|SLD connection.*Can't be built as one connection/s);
    expect(project.feeders).toHaveLength(0); // the check never changes the project
  });
});
