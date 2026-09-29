import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sampleProject } from '../data/sampleProject';
import { acbText, breakerSetting, buildTxSummary, ctFor, rowCtText } from './txSummary';
import { connectedPhaseKw } from './mdSheet';
import { buildFormWorkbook, workbookBytes } from './formWorkbook';
import type { Project } from '../types';

describe('TCL summary at transformer level', () => {
  it('one row per transformer with setting, fault duty, loads, D.F and MDL', () => {
    const s = buildTxSummary(sampleProject);
    expect(s.groups.map((g) => g.name)).toEqual(['SUBSTATION-01']);
    const r = s.groups[0].rows[0];
    expect(r.board.id).toBe('MDB-1');
    expect(r.device).toBe('ACB');
    // 1000 kVA → 1391 A on a 1600 A ACB → 0.87 → 0.90
    expect(r.setting).toBe(0.9);
    expect(acbText(r)).toBe('1600 @ 0.90');
    expect(r.faultKa).toBe(36); // 27.8 kA → next standard
    const p = connectedPhaseKw(sampleProject, 'MDB-1');
    expect(r.tclKw).toBeCloseTo(p.R + p.Y + p.B);
    expect(r.mdlKw).toBeCloseTo(r.tclKw * r.df);
    expect(r.meters.CT).toBeGreaterThanOrEqual(1);
    expect(rowCtText(r)).toContain('1500/5A CT');
    expect(s.diversity).toBeCloseTo(r.df);
  });

  it('typed values win; substations group; standby units leave the TCL (duty)', () => {
    const p: Project = {
      ...sampleProject,
      boards: [
        ...sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, substation: 'Substation-01', mdDemandFactor: 0.72, supply: { ratingA: 2500, irSetting: 0.85, faultKa: 65, ecc: '2X150' } } : b)),
        { id: 'MDB-2', name: 'MDB 2', kind: 'MDB' as const, sourceKva: 1500, sourceImpedancePct: 6, ratedCurrentA: 2500, substation: 'Substation-02' }
      ],
      feeders: sampleProject.feeders.map((f) => (f.id === 'MCC-WP' ? { ...f, standbyUnit: true } : f))
    };
    const s = buildTxSummary(p);
    expect(s.groups.map((g) => g.name)).toEqual(['SUBSTATION-01', 'SUBSTATION-02']);
    const r = s.groups[0].rows[0];
    expect([acbText(r), r.faultKa, r.ecc, r.df]).toEqual(['2500 @ 0.85', 65, '2X150', 0.72]);
    expect(rowCtText(r)).toContain('2400/5A CT'); // 2500 × 0.85 = 2125 A
    const wp = p.feeders.find((f) => f.id === 'MCC-WP')!;
    expect(s.tclKw - s.tclDutyKw).toBeCloseTo(wp.loadKw);
    expect(breakerSetting(p, p.boards.find((b) => b.id === 'MDB-2')!, 2500)).toBe(0.85); // 1500 kVA → 2087 A
    expect([ctFor(2125), ctFor(400), ctFor(290)]).toEqual(['2400/5A', '400/5A', '300/5A']);
  });

  it('the submission pack starts with the TCL summary sheet', async () => {
    const wb = buildFormWorkbook(sampleProject);
    expect(wb.worksheets[0].name).toBe('TCL SUMMARY');
    const back = new ExcelJS.Workbook();
    await back.xlsx.load((await workbookBytes(wb)).buffer as ArrayBuffer);
    const ws = back.getWorksheet('TCL SUMMARY')!;
    const texts: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => texts.push(String(c.value ?? ''))));
    expect(texts).toContain('SUBSTATION-01');
    expect(texts).toContain('MDB-1');
    expect(texts.some((t) => t.startsWith('SUMMARY OF THE TCL'))).toBe(true);
  });
});
