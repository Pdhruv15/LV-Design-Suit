import type ExcelJS from 'exceljs';
import type { Project } from '../types';
import { esc } from './report';
import { revisionStamp } from '../model/revisions';
import type { Schedule } from './schedules';

/** Authority forms as PDF: the same worksheets the Excel export lays out
 * (merged cells, bold headings, column widths) printed as HTML tables, so
 * the PDF and the Excel always match. */

const text = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toLocaleDateString('en-GB');
    if ('result' in v) return text(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return String(v.error);
  }
  return typeof v === 'number' ? String(+v.toFixed(3)) : String(v);
};

const addr = (a: string) => {
  const m = a.match(/^([A-Z]+)(\d+)$/)!;
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { col, row: Number(m[2]) };
};

export function worksheetHtml(ws: ExcelJS.Worksheet): string {
  const spans = new Map<string, { cols: number; rows: number }>();
  const hidden = new Set<string>();
  for (const range of (ws.model as { merges?: string[] }).merges ?? []) {
    const [a, b] = range.split(':').map(addr);
    spans.set(`${a.row}:${a.col}`, { cols: b.col - a.col + 1, rows: b.row - a.row + 1 });
    for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) if (r !== a.row || c !== a.col) hidden.add(`${r}:${c}`);
  }
  const nCols = ws.columnCount, nRows = ws.rowCount;
  const widths = Array.from({ length: nCols }, (_, i) => ws.getColumn(i + 1).width ?? 10);
  const total = widths.reduce((a, w) => a + w, 0);
  const cols = widths.map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%">`).join('');
  const rows: string[] = [];
  for (let r = 1; r <= nRows; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= nCols; c++) {
      if (hidden.has(`${r}:${c}`)) continue;
      const cell = row.getCell(c);
      const sp = spans.get(`${r}:${c}`);
      const bold = cell.font?.bold ? 'font-weight:700;' : '';
      const fill = (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
      const bg = fill && fill !== 'FFFFFFFF' ? `background:#${fill.slice(2)};` : '';
      const fg = cell.font?.color?.argb && cell.font.color.argb !== 'FF000000' ? `color:#${cell.font.color.argb.slice(2)};` : '';
      const al = cell.alignment?.horizontal ? `text-align:${cell.alignment.horizontal === 'centerContinuous' ? 'center' : cell.alignment.horizontal};` : typeof cell.value === 'number' ? 'text-align:right;' : '';
      const vert = cell.alignment?.textRotation ? ' class="v"' : '';
      const border = cell.border && Object.keys(cell.border).length ? '' : 'border-color:transparent;';
      cells.push(`<td${sp ? `${sp.cols > 1 ? ` colspan="${sp.cols}"` : ''}${sp.rows > 1 ? ` rowspan="${sp.rows}"` : ''}` : ''}${vert} style="${bold}${bg}${fg}${al}${border}">${esc(text(cell.value)).replace(/\n/g, '<br>')}</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table class="form"><colgroup>${cols}</colgroup><tbody>${rows.join('')}</tbody></table>`;
}

const FORM_CSS = `@page { size: A4 landscape; margin: 9mm; }
  body { font: 8.5px/1.3 Arial, "Segoe UI", sans-serif; color: #111; margin: 0; }
  h1 { font-size: 12px; margin: 0 0 4px; } .sub { color: #555; margin: 0 0 6px; }
  table.form { border-collapse: collapse; width: 100%; table-layout: fixed; page-break-after: always; }
  table.form:last-of-type { page-break-after: auto; }
  table.form td { border: 1px solid #444; padding: 1.5px 3px; vertical-align: middle; overflow-wrap: anywhere; }
  table.form td.v { writing-mode: vertical-rl; transform: rotate(180deg); }
  table.sched { border-collapse: collapse; width: 100%; } table.sched th, table.sched td { border: 1px solid #444; padding: 2px 3px; }
  table.sched th { background: #e8edf5; font-size: 8px; } table.sched thead { display: table-header-group; } table.sched tr { break-inside: avoid; }
  tr.total td { font-weight: 700; background: #f2f2f2; }`;

/** Every sheet of a forms workbook as one printable page set. */
export function workbookHtml(project: Project, wb: ExcelJS.Workbook, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${FORM_CSS}</style></head><body>
  ${wb.worksheets.map((ws) => worksheetHtml(ws)).join('\n')}
  <p class="sub">${esc(project.name)} · ${esc(revisionStamp(project))}</p>
  </body></html>`;
}

/** A schedule (DB / cable / equipment) as a printable table with repeated headings. */
export function scheduleHtml(project: Project, schedule: Schedule, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${FORM_CSS}</style></head><body>
  <h1>${esc(title)}</h1><p class="sub">${esc(project.name)} · ${esc(revisionStamp(project))}</p>
  <table class="sched"><thead><tr>${schedule.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
  ${schedule.rows.map((r, i) => `<tr${schedule.totalRows?.includes(i) ? ' class="total"' : ''}>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></body></html>`;
}
