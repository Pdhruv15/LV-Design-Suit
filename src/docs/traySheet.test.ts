import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { DEFAULT_CABLE_ODS, emptyTrayPlan, lookupOd, sizeAll } from '../calc/cableTray';
import { applyOdEdits, buildOdSheet } from './traySheet';
import { buildTrayWorkbook } from './trayWorkbook';
import type { TrayPlan } from '../types';

describe('cable data sheet and tray workbook', () => {
  const sheet = buildOdSheet(DEFAULT_CABLE_ODS);
  const row = (csa: number) => sheet.sizes.indexOf(csa);

  it('one row per size, OD and kg/m for 1C–4C', () => {
    expect(sheet.cols).toHaveLength(9);
    expect(sheet.data[row(240)].slice(0, 1)).toEqual([240]);
    expect(sheet.data[row(240)][7]).toBe(62.9); // 4C OD
  });

  it('typed and pasted values replace the rough ones', () => {
    const { ods, rejected } = applyOdEdits(DEFAULT_CABLE_ODS, sheet, [{ y: row(240), x: 7, value: '64.5' }, { y: row(240), x: 8, value: 'x' }]);
    expect(rejected).toEqual(['x is not a number']);
    expect(lookupOd(ods, 4, 240).odMm).toBe(64.5);
    expect(applyOdEdits(DEFAULT_CABLE_ODS, sheet, [{ y: row(240), x: 7, value: '62.9' }]).ods).toBe(DEFAULT_CABLE_ODS);
  });

  it('a new size in a blank row, then its diameter', () => {
    const blank = sheet.sizes.indexOf(undefined);
    const { ods } = applyOdEdits(DEFAULT_CABLE_ODS, sheet, [{ y: blank, x: 0, value: '500' }, { y: blank, x: 7, value: '86' }]);
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
});
