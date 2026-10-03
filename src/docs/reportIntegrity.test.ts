import { describe, expect, it } from 'vitest';
import { sampleProject as p0 } from '../data/sampleProject';
import type { Project } from '../types';
import { runCalculations } from '../calc/runs';
import { buildSection, scopeOf } from './studyReport';
import { riserVd } from '../calc/busbar';
import { buildVdReportHtml, vdCells, VD_HEADERS } from './voltageDropReport';
import { vdRow } from '../calc/voltageDrop';

const section = (p: Project, key: Parameters<typeof buildSection>[0]) => {
  const r = runCalculations(p);
  return buildSection(key, { project: p, results: r.results, earthing: r.earthing, selectivity: r.selectivity }, scopeOf(p, { boards: [], downstream: true }));
};
const main = p0.boards.find((b) => !b.upstreamId)!;

describe('reports never hide a failure', () => {
  it('a generator above the largest standard set is reported as exceeding, not left out', () => {
    const big = { ...p0, boards: [{ id: 'MDB', name: 'MDB', sourceKva: 2500 }], busRisers: [], ties: undefined, pfc: undefined, txGen: { genBoards: { MDB: 100 } },
      feeders: [{ id: 'L1', boardId: 'MDB', name: 'Big', loadKw: 3000, demandFactor: 1, powerFactor: 1, lengthM: 10, cableCsaMm2: 240, parallel: 8, cores: 4, breakerRatingA: 4000, breakerIcuKa: 65 }] } as unknown as Project;
    const s = section(big, 'sizing');
    const gen = s.summary.find((x) => x.label.startsWith('Standby generator'))!;
    expect(gen.status).toBe('bad');
    expect(String(gen.value)).toMatch(/above the largest standard set/);
    expect(s.statuses).toContain('bad');
    expect(s.tables.map((t) => t.title)).toContain('Standby generator — size');
  });

  it('a busbar riser with no size in the data fails and shows no 0 % drop', () => {
    const r = { id: 'R1', name: 'R1', sourceBoardId: main.id, material: 'cu', feedM: 20, floorHeightM: 3.6, offsetFloors: 0, elementM: 3, elbows: 0, floors: [{ id: 'F1', name: 'L1', kw: 100, pf: 0.9 }] };
    const p = { ...p0, busbarData: { cu: [], al: [] }, busRisers: [r] } as unknown as Project;
    const v = riserVd(p, p.busRisers![0]);
    expect(v.status).toBe('bad');
    expect(v.noType).toBe(true);
    const html = buildVdReportHtml(p, [], 'All', [v]);
    expect(html).toMatch(/Not calculated/);
    expect(html).not.toMatch(/Within limit/);
  });

  it('a motor that is fine running but too far down while starting fails everywhere', () => {
    const mot = { id: 'M1', boardId: main.id, name: 'Pump', loadKw: 30, demandFactor: 1, powerFactor: 0.85, lengthM: 120, cableCsaMm2: 25, cores: 3, breakerRatingA: 80, breakerIcuKa: 36, loadType: 'motor', starter: 'DOL' };
    const p = { ...p0, feeders: [...p0.feeders, mot] } as unknown as Project;
    const row = vdRow(p, p.feeders[p.feeders.length - 1]);
    expect(row.totalPct).toBeLessThan(row.limitPct); // running is fine
    expect(row.status).toBe('bad');
    const cells = vdCells(row);
    expect(cells[VD_HEADERS.indexOf('Motor start (%)')]).toMatch(/exceeds/);
    const lf = section(p, 'lf');
    const t = lf.tables.find((x) => (x.title ?? '').startsWith('Motor starting'))!;
    expect(t.rows.some((r) => r[0] && JSON.stringify(r).includes('M1') && JSON.stringify(r).includes('bad'))).toBe(true);
    expect(lf.statuses).toContain('bad');
  });
});

import { staleStudies } from '../calc/runs';
import { buildDashboard } from '../calc/dashboard';
import { buildDashboardHtml } from './dashboardPdf';

describe('results are marked out of date when report inputs change', () => {
  const run = runCalculations(p0);
  const edited = (q: Partial<Project>) => staleStudies(run, { ...p0, ...q });
  it.each([
    ['power factor correction', { pfc: { ...(p0.pfc ?? {}), stepKvar: 50 } }, 'sizing'],
    ['transformer size list', { txGen: { sizeList: 'iec' } }, 'sizing'],
    ['cable temperature for voltage drop', { vdTempC: 90 }, 'vd'],
    ['busbar data', { busbarData: { cu: [], al: [] } }, 'sizing'],
    ['a board rating', { boards: p0.boards.map((b, i) => (i ? b : { ...b, ratedCurrentA: 10 })) }, 'checks'],
    ['a cable type', { feeders: p0.feeders.map((f, i) => (i ? f : { ...f, cableType: 'FR' })) }, 'checks']
  ] as [string, Partial<Project>, string][])('%s', (_l, q, key) => {
    expect(edited(q)).toContain(key);
  });
  it('a remark alone makes nothing out of date', () => {
    expect(edited({ feeders: p0.feeders.map((f, i) => (i ? f : { ...f, remarks: 'x' })) })).toEqual([]);
  });
  it('the dashboard PDF says the results are out of date, whatever the to-do list holds', () => {
    const p = { ...p0, feeders: p0.feeders.map((f, i) => (i ? f : { ...f, loadKw: f.loadKw + 50 })) };
    const html = buildDashboardHtml(p, buildDashboard(p, run, staleStudies(run, p)));
    expect(html).toMatch(/stale-banner">Results out of date/);
    expect(html).not.toMatch(/All pass/);
  });
});
