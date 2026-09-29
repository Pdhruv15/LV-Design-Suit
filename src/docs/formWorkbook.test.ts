import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sampleProject } from '../data/sampleProject';
import { buildFormWorkbook, workbookBytes } from './formWorkbook';
import { buildMdSheet } from './mdSheet';
import { buildDbSheet } from './dbSheet';

async function roundTrip(wb: ExcelJS.Workbook) {
  const back = new ExcelJS.Workbook();
  await back.xlsx.load((await workbookBytes(wb)).buffer as ArrayBuffer);
  return back;
}

const text = (ws: ExcelJS.Worksheet) => {
  const out: string[] = [];
  ws.eachRow((row) => row.eachCell((c) => { if (c.value !== null && c.value !== undefined) out.push(String(c.value)); }));
  return out;
};

describe('submission workbook (Excel)', () => {
  it('has the MD forms first in supply order, then the DB schedules', async () => {
    const wb = await roundTrip(buildFormWorkbook(sampleProject));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['TCL SUMMARY', 'MDB-1 LOAD SUMMARY', 'SMDB-GF MD', 'SMDB-FF MD', 'MCC-1 MD', 'DB-GF1 SCHEDULE']);
  });

  it('MD form: title, rows, totals, demand factor line and A4 landscape', async () => {
    const wb = await roundTrip(buildFormWorkbook(sampleProject, { boardIds: ['SMDB-GF'], forms: ['md'] }));
    const ws = wb.worksheets[0];
    const t = text(ws);
    const s = buildMdSheet(sampleProject, 'SMDB-GF');
    expect(t).toContain('DETAILS OF CONNECTED LOAD, MAXIMUM DEMAND & kWh METERING');
    expect(t).toContain('DB-GF1 (VILLA GROUND FLOOR DB)');
    expect(t).toContain('OUT GOING');
    expect(t).toContain(s.totals[s.keys.indexOf('tcl')]);
    expect(t.some((v) => v.startsWith('DEMAND FACTOR :  0.80'))).toBe(true);
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect(ws.getCell('A7').isMerged).toBe(true); // OUT GOING spans the row
  });

  it('DB form: villa point columns, merged vertical incomer, TOTAL (kW), cable line; no app-only columns', async () => {
    const wb = await roundTrip(buildFormWorkbook(sampleProject, { boardIds: ['DB-GF1'], forms: ['db'] }));
    const ws = wb.worksheets[0];
    const t = text(ws);
    const s = buildDbSheet(sampleProject, 'DB-GF1');
    expect(t).toContain('LOAD DISTRIBUTION SCHEDULE');
    for (const h of ['LTG', 'EX.FAN', '13A T.S/O', 'FCU', 'SPUR O/L', 'ISOL', 'OTH', 'WATTS/ UNIT', 'TOTAL (kW)']) expect(t).toContain(h);
    expect(t).not.toContain('LENGTH (m)');
    expect(t).not.toContain('CHECK');
    expect(t).toContain(s.cableText);
    expect(ws.getCell('A6').value).toBe('100A TP ISOLATOR');
    expect(ws.getCell('A6').alignment?.textRotation).toBe(90);
    expect(ws.getCell('A7').isMerged).toBe(true);
    expect(t).toContain('Living lighting');
    expect(ws.pageSetup.orientation).toBe('portrait');
    expect(ws.headerFooter.oddHeader).toContain('REV —');
  });
});
