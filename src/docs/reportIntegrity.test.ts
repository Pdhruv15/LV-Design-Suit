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
    expect(html).not.toMatch(/>PASS</);
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

import { buildReportHtml } from './report';
import { sizeGeneratorByBoards, sizeTransformers } from '../calc/txGen';

describe('the main calculation report sizes like the study pages', () => {
  it('uses the chosen size list and the generator boards', () => {
    const p = { ...p0, txGen: { ...(p0.txGen ?? {}), sizeList: 'dewa' } } as Project;
    const r = runCalculations(p);
    const html = buildReportHtml(p);
    const tx = sizeTransformers(p)[0];
    expect(html).toContain(`recommended ${tx.recommendedKva} kVA`);
    const gen = sizeGeneratorByBoards(p);
    if (gen.recommendedKva) expect(html).toContain(`recommended ${gen.recommendedKva} kVA`);
  });
});

import { incomerCableText, incomerLabel, loadScheduleCsv, loadScheduleRows, buildLoadScheduleHtml } from './loadScheduleDoc';

describe('DB load schedule totals and incomer', () => {
  const db = { id: 'DB1', name: 'DB1', upstreamId: main.id, pointWatts: { ltg: 100 } } as unknown as Project['boards'][number];
  const inc = { id: 'I1', boardId: main.id, name: 'Incomer', feedsBoardId: 'DB1', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 16, cores: 2, breakerRatingA: 63, breakerIcuKa: 25, parallel: 2, cableType: 'FR BS 8491' };
  const c1 = { id: 'C1', boardId: 'DB1', name: 'Lights', loadKw: 1, demandFactor: 0.5, powerFactor: 0.9, lengthM: 20, cableCsaMm2: 1.5, cores: 2, breakerRatingA: 10, breakerIcuKa: 6, phase: 'R', way: 1, loadType: 'lighting', points: { ltg: 10 } };
  const p = { ...p0, boards: [...p0.boards, db], feeders: [...p0.feeders, inc, c1] } as unknown as Project;

  it('connected total matches the rows; maximum demand is labelled separately', () => {
    const r = loadScheduleRows(p, 'DB1');
    expect(r.connectedW.R).toBe(1000);
    expect(r.phaseW.R).toBeCloseTo(0.5);
    const html = buildLoadScheduleHtml(p, 'DB1');
    expect(html).toMatch(/TOTAL CONNECTED LOAD \(W\)/);
    expect(html).toMatch(/MAXIMUM DEMAND \(W\) — after demand factors/);
    const csv = loadScheduleCsv(p, 'DB1').rows.map((x) => x[6]);
    expect(csv).toContain('TOTAL CONNECTED');
    expect(csv).toContain('MAXIMUM DEMAND');
  });

  it('incomer text follows the feeder: poles, parallel runs, construction', () => {
    const b = p.boards.find((x) => x.id === 'DB1')!;
    const f = p.feeders.find((x) => x.id === 'I1')!;
    expect(incomerLabel(b, f)).toMatch(/SP\+N$/);
    expect(incomerLabel(b, f)).not.toMatch(/TP/);
    const t = incomerCableText(p, f);
    expect(t).toMatch(/^CABLE SIZE: 2x2C 16mm²/);
    expect(t).toMatch(/\(fire rated\), 30 m$/); // as on the cable schedule: base build-up + fire-rated mark
  });
});

import { buildBom } from '../calc/bom';
import { priceBom } from '../model/priceList';
import { buildBoqHtml } from './boqWorkbook';

describe('BOQ PDF discloses how it was priced', () => {
  const bom = priceBom(buildBom(p0));
  it('full and summary PDFs both state typical-rate and unpriced items', () => {
    expect(bom.missing).toBeGreaterThan(0); // no list: only cables and breakers have typical rates
    for (const summaryOnly of [false, true]) {
      const html = buildBoqHtml(p0, bom, undefined, summaryOnly);
      expect(html).toMatch(/Pricing basis/);
      expect(html).toMatch(/unquoted supply or installation charge — the total is incomplete; known charges remain included/);
      expect(html).toMatch(/built-in typical rates/);
    }
    expect(buildBoqHtml(p0, bom)).toMatch(/class="flag">NO RATE/);
  });
});

import { diffProjects, snapshotOf } from '../model/revisions';

describe('revision comparison records design changes', () => {
  const fields = (q: Project) => diffProjects(snapshotOf(p0), snapshotOf(q)).changes.flatMap((c) => c.fields.map((f) => f.field));
  const f0 = p0.feeders[0];
  it.each([
    ['Parallel runs', { feeders: p0.feeders.map((f) => (f === f0 ? { ...f, parallel: 2 } : f)) }],
    ['Tray route', { feeders: p0.feeders.map((f) => (f === f0 ? { ...f, trayRoute: 'A-B' } : f)) }],
    ['Instantaneous (× In)', { feeders: p0.feeders.map((f) => (f === f0 ? { ...f, breakerImMultiple: 5 } : f)) }],
    ['Essential (generator)', { feeders: p0.feeders.map((f) => (f === f0 ? { ...f, essential: true } : f)) }],
    ['Standby generator', { boards: p0.boards.map((b, i) => (i ? b : { ...b, standby: { kva: 500 } })) }],
    ['Transformer & generator plan', { txGen: { sizeList: 'iec' } }],
    ['Cable temperature for voltage drop (°C)', { vdTempC: 90 }],
    ['Busbar risers', { busRisers: [] as never[] }],
    ['Solar PV', { pv: {} as never }]
  ] as [string, Partial<Project>][])('%s', (label, q) => {
    expect(fields({ ...p0, ...q } as Project)).toContain(label);
  });
});

import { buildFormWorkbook } from './formWorkbook';
import { scheduleHtml, workbookHtml } from './sheetPdf';
import { cableSchedule } from './schedules';

describe('PDF of the authority forms and schedules', () => {
  it('MD form and TCL summary print the same cells as the Excel, with merges', () => {
    const wb = buildFormWorkbook(p0, { boardIds: [main.id], forms: ['md'] });
    const html = workbookHtml(p0, wb, 'MD');
    const ws = wb.worksheets[0];
    const someText = [...Array(ws.rowCount)].flatMap((_, r) => [...Array(ws.columnCount)].map((__, c) => ws.getRow(r + 1).getCell(c + 1).value)).find((v) => typeof v === 'string' && v.length > 4) as string;
    expect(html).toContain(someText.replace(/&/g, '&amp;').split('\n')[0]);
    expect(html).toMatch(/colspan="\d+"/);
    const tx = workbookHtml(p0, buildFormWorkbook(p0, { forms: ['tx'] }), 'TCL');
    expect(tx).toMatch(/<table class="form">/);
  });
  it('cable schedule PDF has every row', () => {
    const s = cableSchedule(p0);
    const html = scheduleHtml(p0, s, 'Cable schedule');
    expect((html.match(/<tr/g) ?? []).length).toBe(s.rows.length + 1);
  });
});
