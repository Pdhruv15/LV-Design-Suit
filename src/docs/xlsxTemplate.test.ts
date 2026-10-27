import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { fillLoadScheduleTemplate, shiftFormula, templateBoards, templateData } from './xlsxTemplate';
import { loadScheduleRows } from './loadScheduleDoc';

const AT = new Date('2026-10-27T10:00:00Z');
const db = templateBoards(sampleProject)[0];

/** A small company template: header, column heads, one repeated row with a
 * merged room cell, a totals row with a SUM over the repeated row, notes. */
async function template(opts: { cover?: boolean; noRow?: boolean } = {}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  if (opts.cover) wb.addWorksheet('Cover').getCell('A1').value = 'Project: {{project.name}} — {{date}}';
  const ws = wb.addWorksheet('Schedule');
  ws.getCell('A1').value = 'LOAD SCHEDULE — {{board.id}} ({{board.name}})';
  ws.mergeCells('A1:H1');
  ws.getCell('A2').value = 'Fed from: {{board.fedFrom}}   Incomer: {{board.incomer}}';
  ws.getCell('A3').value = '{{label.ltg}}';
  ws.getCell('B3').value = '{{wattUnit.ltg}}';
  if (!opts.noRow) {
    ['{{row.sl}}', '{{row.ref}}', '{{row.mcb}}', '{{row.wire}}', '{{row.room}}', null, '{{row.points.ltg}}', '{{row.watts}}', '{{board.incomer}}', '{{row.elcb}}'].forEach((v, i) => { ws.getCell(5, i + 1).value = v; });
    ws.getCell('E5').font = { bold: true };
    ws.mergeCells('E5:F5');
    ws.getRow(5).height = 22;
  }
  ws.getCell('G6').value = 'TOTAL';
  ws.getCell('H6').value = { formula: 'SUM(H5:H5)' } as ExcelJS.CellFormulaValue;
  ws.getCell('A7').value = 'Connected {{total.all}} W, MD {{md.all}} W, {{unknown.thing}}';
  ws.mergeCells('A7:D7');
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const reload = async (wb: ExcelJS.Workbook) => {
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await wb.xlsx.writeBuffer());
  return out;
};

describe('templateData', () => {
  it('has one row per schedule entry and the DB totals', () => {
    const d = templateData(sampleProject, db, AT);
    const s = loadScheduleRows(sampleProject, db);
    expect(d.rows).toHaveLength(s.entries.length);
    expect(d.rows.map((r) => r['row.sl'])).toEqual(s.entries.map((e) => e.sl));
    expect(d.fields['board.id']).toBe(db);
    expect(d.fields['total.all']).toBe(Math.round(s.connectedW.R + s.connectedW.Y + s.connectedW.B));
    expect(d.fields.date).toBe('27/10/2026');
  });
  it('prints the ELCB label once per group, and on every row as elcbGroup', () => {
    const d = templateData(sampleProject, db, AT);
    const labels = d.rows.map((r) => r['row.elcb']).filter(Boolean);
    expect(new Set(labels).size).toBe(labels.length);
    expect(d.rows.filter((r) => r['row.elcbGroup']).length).toBeGreaterThanOrEqual(labels.length);
  });
});

describe('fillLoadScheduleTemplate', () => {
  it('repeats the row per circuit with its style, height and merge, and fills the fields', async () => {
    const { workbook, boards, warnings } = await fillLoadScheduleTemplate(sampleProject, await template(), { boardIds: [db], at: AT });
    expect(boards).toEqual([db]);
    const wb = await reload(workbook);
    expect(wb.worksheets.map((w) => w.name)).toEqual([db]);
    const ws = wb.worksheets[0];
    const d = templateData(sampleProject, db, AT);
    const n = d.rows.length;
    expect(ws.getCell('A1').value).toBe(`LOAD SCHEDULE — ${db} (${d.fields['board.name']})`);
    expect(ws.getCell('A3').value).toBe('LTG');
    for (let i = 0; i < n; i++) {
      expect(ws.getCell(5 + i, 1).value).toBe(d.rows[i]['row.sl']);
      expect(ws.getCell(5 + i, 2).value).toBe(d.rows[i]['row.ref']);
      expect(ws.getCell(5 + i, 5).font?.bold).toBe(true);
      expect(ws.getRow(5 + i).height).toBe(22);
      expect(ws.getCell(5 + i, 6).isMerged).toBe(true);
    }
    expect(typeof ws.getCell(5, 3).value).toBe('number'); // a lone placeholder becomes a number
    expect(ws.getCell('H1').isMerged).toBe(true); // merges above the row stay
    // The incomer spans every row; each ELCB label spans its group.
    expect(ws.getCell(5, 9).value).toBe(d.fields['board.incomer']);
    expect(ws.getCell(4 + n, 9).master.address).toBe('I5');
    const groups = d.rows.map((r) => r['row.elcbGroup']);
    for (let i = 1; i < n; i++) {
      const master = ws.getCell(5 + i, 10).master.address;
      expect(master === `J${5 + i}`).toBe(!groups[i] || groups[i] !== groups[i - 1]);
    }
    // The totals row moved down; its SUM covers every circuit row.
    expect(ws.getCell(5 + n, 7).value).toBe('TOTAL');
    expect((ws.getCell(5 + n, 8).value as ExcelJS.CellFormulaValue).formula).toBe(`SUM(H5:H${4 + n})`);
    expect(ws.getCell(6 + n, 1).value).toBe(`Connected ${d.fields['total.all']} W, MD ${d.fields['md.all']} W, {{unknown.thing}}`);
    expect(ws.getCell(6 + n, 4).isMerged).toBe(true);
    expect(warnings).toEqual(['Unknown placeholders left as they are: {{unknown.thing}}.']);
  });

  it('makes one sheet per DB and fills the project fields on other sheets', async () => {
    const all = templateBoards(sampleProject);
    const { workbook } = await fillLoadScheduleTemplate(sampleProject, await template({ cover: true }), { at: AT });
    const wb = await reload(workbook);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Cover', ...all]);
    expect(wb.getWorksheet('Cover')!.getCell('A1').value).toBe(`Project: ${sampleProject.name} — 27/10/2026`);
  });

  it('says so when the template has no repeated row, and refuses a file that is not .xlsx', async () => {
    const { warnings } = await fillLoadScheduleTemplate(sampleProject, await template({ noRow: true }), { boardIds: [db], at: AT });
    expect(warnings[0]).toMatch(/No row with/);
    await expect(fillLoadScheduleTemplate(sampleProject, new TextEncoder().encode('not a zip'))).rejects.toThrow(/not a readable \.xlsx/);
    await expect(fillLoadScheduleTemplate(sampleProject, await template(), { boardIds: ['NOPE'] })).rejects.toThrow(/No DB/);
  });
});

describe('shiftFormula', () => {
  it('moves references below the row and stretches ranges on it', () => {
    expect(shiftFormula('SUM(H5:H5)', 5, 3)).toBe('SUM(H5:H8)');
    expect(shiftFormula('H9*2+$B$4+C6', 5, 3)).toBe('H12*2+$B$4+C9');
    expect(shiftFormula('SUM(A2:A5)+Sheet1!B10', 5, 2)).toBe('SUM(A2:A7)+Sheet1!B12');
    expect(shiftFormula('LOG10(H9)', 5, 1)).toBe('LOG10(H10)');
    expect(shiftFormula('A9', 5, 0)).toBe('A9');
  });
});
