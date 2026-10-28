import type ExcelJS from 'exceljs';
import type { Project } from '../types';
import { remarkOf, type ScheduleTable } from './outputs';

/** The ELV schedules as an Excel workbook: one sheet per schedule, black and white like the app's other workbooks
 * (Arial 9, thin borders, the title and revision on every sheet), with the engineer's remarks in the last column. */

const FONT = 'Arial';
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

export async function elvWorkbook(project: Project, tables: ScheduleTable[], stamp = ''): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import('exceljs');
  const wb = new Excel.Workbook();
  wb.creator = 'LV Design Studio';
  for (const t of tables) {
    if (!t.rows.length) continue;
    const ws = wb.addWorksheet(t.title.replace(/^ELV /, '').slice(0, 31));
    const cols = t.columns.length + 1;
    ws.columns = [...t.columns.map((c, i) => ({ width: c.num ? 9 : i === 0 ? 30 : i === 1 && t.id === 'boq' ? 46 : 18 })), { width: 36 }];
    const title = ws.addRow([`${project.name} — ${t.title}`]);
    title.getCell(1).font = { name: FONT, size: 12, bold: true };
    ws.mergeCells(title.number, 1, title.number, cols);
    ws.addRow([]);
    const put = (values: (string | number)[], o: { bold?: boolean } = {}) => {
      const r = ws.addRow(values);
      for (let i = 1; i <= cols; i++) {
        const c = r.getCell(i);
        c.style = { font: { name: FONT, size: 9, bold: !!o.bold }, border: { ...BORDER }, alignment: { vertical: 'middle', horizontal: t.columns[i - 1]?.num ? 'right' : 'left', wrapText: true } };
      }
    };
    put([...t.columns.map((c) => c.label), 'Remarks'], { bold: true });
    for (const r of t.rows) put([...r.cells, r.kind === 'sum' ? '' : remarkOf(project, t.id, r.key)], { bold: !!r.kind });
    ws.addRow([]);
    for (const n of t.notes) { const r = ws.addRow([n]); r.getCell(1).font = { name: FONT, size: 8 }; ws.mergeCells(r.number, 1, r.number, cols); }
    ws.headerFooter = { oddHeader: stamp ? `&R&"Arial"&9${stamp}` : '', oddFooter: `&L&"Arial"&8${project.name.replace(/&/g, '&&')}&R&"Arial"&8Page &P of &N` };
    ws.pageSetup = { paperSize: 9, orientation: t.id === 'devices' || t.id === 'loops' ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    ws.views = [{ state: 'frozen', ySplit: 3 }];
  }
  return wb;
}
