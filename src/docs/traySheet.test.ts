import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { DEFAULT_CABLE_ODS, emptyTrayPlan, lookupOd, sizeAll, sizeRoute, trayFeeders, trayPlanOf } from '../calc/cableTray';
import { applyOdEdits, applyRoutingEdits, buildOdSheet, buildRoutingSheet } from './traySheet';
import { lineNumbers, traySectionSvg } from './traySection';
import { buildTrayReportHtml } from './trayReport';
import { buildTrayWorkbook } from './trayWorkbook';
import type { Project, TrayPlan } from '../types';

describe('cable data sheet and tray workbook', () => {
  const sheet = buildOdSheet(DEFAULT_CABLE_ODS);
  const row = (csa: number) => sheet.sizes.indexOf(csa);

  it('one row per size, OD and kg/m for 1C–4C', () => {
    expect(sheet.cols).toHaveLength(12); // size + 1C OD, kg + 2C–4C OD, kg, bend radius
    expect(sheet.data[row(240)].slice(0, 1)).toEqual([240]);
    expect(sheet.data[row(240)][9]).toBe(63); // 4C OD (DUCAB)
    expect(sheet.data[row(240)][11]).toBe(510); // 4C bending radius
  });

  it('typed and pasted values replace the rough ones', () => {
    const { ods, rejected } = applyOdEdits(DEFAULT_CABLE_ODS, sheet, [{ y: row(240), x: 9, value: '64.5' }, { y: row(240), x: 10, value: 'x' }]);
    expect(rejected).toEqual(['x is not a number']);
    expect(lookupOd(ods, 4, 240).odMm).toBe(64.5);
    expect(applyOdEdits(DEFAULT_CABLE_ODS, sheet, [{ y: row(240), x: 9, value: '63' }]).ods).toBe(DEFAULT_CABLE_ODS);
  });

  it('a new size in a blank row, then its diameter', () => {
    const blank = sheet.sizes.indexOf(undefined);
    const { ods } = applyOdEdits(DEFAULT_CABLE_ODS, sheet, [{ y: blank, x: 0, value: '500' }, { y: blank, x: 9, value: '86' }]);
    expect(lookupOd(ods, 4, 500)).toMatchObject({ odMm: 86, found: true });
    expect(buildOdSheet(ods).sizes).toContain(500);
    expect(lookupOd(ods, 3, 500).found).toBe(false); // 3C not given yet
  });

  it('the workbook has the schedule and the summary', () => {
    const plan: TrayPlan = { ...emptyTrayPlan(), routes: [{ id: 'r', name: 'A', from: 'Substation', to: 'Riser', lengthM: 30, cables: [{ id: 'c', from: 'MDB-1', to: 'SMDB', cores: 4, csaMm2: 95, qty: 2 }] }] };
    const wb = buildTrayWorkbook(sampleProject, plan, sizeAll(sampleProject, plan));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Tray schedule', 'Summary']);
    const text = JSON.stringify(wb.getWorksheet('Tray schedule')!.getSheetValues());
    expect(text).toContain('ROUTE A');
    expect(text).toContain('SELECTED TRAY');
  });

  it('routing table: pasted / filled-down paths put cables on routes and create new ones', () => {
    const feeders = trayFeeders(sampleProject);
    const sheet = buildRoutingSheet(sampleProject, feeders);
    expect(sheet.data[0][6]).toBe('not on a tray');
    const r = applyRoutingEdits(sampleProject, sheet, [{ y: 0, x: 5, value: 'a-b' }, { y: 1, x: 5, value: 'A' }, { y: 2, x: 4, value: 'x' }]);
    expect(r.created).toEqual(['A', 'B']);
    expect(r.project.feeders.find((f) => f.id === feeders[0].id)!.trayRoute).toBe('A-B');
    const after = buildRoutingSheet(r.project, feeders.map((f) => r.project.feeders.find((x) => x.id === f.id)!));
    expect(after.data[0][6]).toBe('2 routes');
    const plan = trayPlanOf(r.project);
    expect(sizeRoute(r.project, plan, plan.routes[0]).lines.map((l) => l.feederId)).toEqual([feeders[0].id, feeders[1].id]);
    // Clearing the path takes it off.
    const cleared = applyRoutingEdits(r.project, after, [{ y: 0, x: 5, value: '' }]);
    expect(cleared.project.feeders.find((f) => f.id === feeders[0].id)!.trayRoute).toBeUndefined();
  });

  it('cross-section: every cable drawn to scale, numbered as in the schedule; too small shows red', () => {
    const plan: TrayPlan = { ...emptyTrayPlan(), routes: [{ id: 'r', name: 'A', cables: [{ id: 'c1', cores: 4, csaMm2: 240, qty: 2 }, { id: 'c2', cores: 4, csaMm2: 16, qty: 1 }] }] };
    const p: Project = { ...sampleProject, trays: plan };
    const res = sizeRoute(p, plan, plan.routes[0]);
    expect([...lineNumbers(res.lines).values()]).toEqual(['1', '2']);
    const svg = traySectionSvg(res, plan);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/<circle/g)).toHaveLength(3);
    expect(svg).toContain(`${res.widthMm} mm`);
    expect(svg).not.toContain('#c21f32');
    const small = sizeRoute(p, plan, { ...plan.routes[0], widthMm: 100, tiers: 1 });
    expect(traySectionSvg(small, plan)).toContain('cables do not fit');
    const two = sizeRoute(p, plan, { ...plan.routes[0], widthMm: 150, tiers: 2 });
    expect(traySectionSvg(two, plan)).toContain('tier 2 of 2');
  });

  it('the PDF has every route with its drawing, the summary and the BOQ', () => {
    const plan: TrayPlan = { ...emptyTrayPlan(), routes: [{ id: 'r', name: 'A', lengthM: 20, fittings: { bends: 2 }, cables: [{ id: 'c', cores: 4, csaMm2: 95, qty: 2 }] }] };
    const html = buildTrayReportHtml(sampleProject, plan, sizeAll(sampleProject, plan));
    expect(html).toContain('Route A');
    expect(html).toContain('<svg');
    expect(html).toContain('Tray BOQ');
  });
});
