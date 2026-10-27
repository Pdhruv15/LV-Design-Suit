import ExcelJS from 'exceljs';
import { cpcOf } from '../calc/earthing';
import { pointColumns, scheduleCircuits, wattUnitText } from '../calc/loadSchedule';
import { boardLocation } from '../model/levels';
import { revisionStamp } from '../model/revisions';
import { SCHEDULE_GROUPS, scheduleGroups } from '../model/scheduleGroups';
import { spareLabel, spareRef } from '../model/spareWays';
import { POINT_TYPES, type Project } from '../types';
import { incomerCableText, incomerLabel, loadScheduleRows, remarksText } from './loadScheduleDoc';

/** Your own Excel load schedule format: an .xlsx laid out as you like, with
 * placeholders the app fills in, e.g. {{board.id}} or {{row.mcb}}. The row
 * holding {{row.…}} placeholders is repeated for every circuit and spare of
 * the DB (its styles, row height and merges copied). The sheet that has that
 * row is copied once per DB; other sheets are kept as they are. A cell that
 * is only one placeholder gets a number where the value is one. Formulas
 * below the repeated row are moved down with it, and a range over that row
 * (e.g. SUM(N8:N8)) is stretched over all the rows. Unknown placeholders are
 * left in place and reported. */

type Value = string | number;
type Fields = Record<string, Value>;

/** The placeholders, for the template guide and the checks. */
export const TEMPLATE_FIELDS: { key: string; about: string }[] = [
  { key: 'project.name', about: 'Project name' },
  { key: 'project.voltage', about: 'System voltage, V' },
  { key: 'project.frequency', about: 'Frequency, Hz' },
  { key: 'project.revision', about: 'Revision stamp' },
  { key: 'project.reference', about: 'Design reference applied (e.g. DEWA (Dubai) v1)' },
  { key: 'date', about: 'Export date (dd/mm/yyyy)' },
  { key: 'board.id', about: 'DB number' },
  { key: 'board.name', about: 'DB name' },
  { key: 'board.location', about: 'Location of the DB' },
  { key: 'board.fedFrom', about: 'Board it is fed from' },
  { key: 'board.incomer', about: 'Incomer, e.g. 63 A ISOLATOR TP+N' },
  { key: 'board.incomerCable', about: 'Incoming cable line' },
  { key: 'total.R / total.Y / total.B / total.all', about: 'Connected load, W' },
  { key: 'md.R / md.Y / md.B / md.all', about: 'Maximum demand after demand factors, W' },
  { key: 'imbalance', about: 'Phase imbalance, %' },
  { key: 'wattUnit.<point>', about: 'WATT / UNIT of a point column, e.g. wattUnit.ltg' },
  { key: 'label.<point>', about: 'Heading of a point column, e.g. label.ltg → LTG' },
  { key: 'row.sl', about: 'Serial number' },
  { key: 'row.ref', about: 'Circuit reference, e.g. R1' },
  { key: 'row.mcb', about: 'MCB rating, A' },
  { key: 'row.wire', about: 'Circuit wire, mm²' },
  { key: 'row.ecc', about: 'Earth wire, mm²' },
  { key: 'row.room', about: 'Room / area (SPARE / SPACE for spares)' },
  { key: 'row.points.<point>', about: 'Number of points, e.g. row.points.ltg' },
  { key: 'row.R / row.Y / row.B', about: 'Load per phase, W' },
  { key: 'row.watts', about: 'Circuit load, W' },
  { key: 'row.elcb', about: 'ELCB label, on the first row of its group only' },
  { key: 'row.elcbGroup', about: 'ELCB label, on every row of the group' },
  { key: 'row.remarks', about: 'Remarks and mixed load items' },
  { key: 'row.status', about: '"check" or "fails check" where the circuit needs attention' }
];

const PH = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const ROW_PH = /\{\{\s*row\./;

const num = (v: number) => Math.round(v);

/** Values of one DB: the sheet's fields and one set per schedule row. */
export function templateData(project: Project, boardId: string, at = new Date()): { fields: Fields; rows: Fields[] } {
  const { board, incomer, entries, phaseW, connectedW, imbalance } = loadScheduleRows(project, boardId);
  const columns = pointColumns(project, board);
  const kw = (v: number) => num(v * 1000);
  const fields: Fields = {
    'project.name': project.name, 'project.voltage': project.voltageV, 'project.frequency': project.frequencyHz,
    'project.revision': revisionStamp(project),
    'project.reference': project.designReference ? `${project.designReference.name} v${project.designReference.version}` : '',
    date: at.toLocaleDateString('en-GB'),
    'board.id': board.id, 'board.name': board.name, 'board.location': boardLocation(project, board), 'board.fedFrom': board.upstreamId ?? '',
    'board.incomer': incomerLabel(board, incomer), 'board.incomerCable': incomerCableText(project, incomer),
    'total.R': num(connectedW.R), 'total.Y': num(connectedW.Y), 'total.B': num(connectedW.B), 'total.all': num(connectedW.R + connectedW.Y + connectedW.B),
    'md.R': kw(phaseW.R), 'md.Y': kw(phaseW.Y), 'md.B': kw(phaseW.B), 'md.all': kw(phaseW.R + phaseW.Y + phaseW.B),
    imbalance: Math.round(imbalance * 10) / 10
  };
  for (const t of POINT_TYPES) {
    fields[`wattUnit.${t.value}`] = columns.some((c) => c.value === t.value) ? wattUnitText(project, board, t.value) : '';
    fields[`label.${t.value}`] = columns.find((c) => c.value === t.value)?.label ?? t.label;
  }
  const firstOfGroup = new Set<number>();
  const seen = new Set<number>();
  entries.forEach((e, i) => { if (e.group && !seen.has(e.group.index)) { seen.add(e.group.index); firstOfGroup.add(i); } });
  const rows = entries.map((e, i): Fields => {
    const elcb = e.group ? `ELCB-${e.group.index} ${e.group.label}` : '';
    const common = { 'row.sl': e.sl, 'row.elcb': firstOfGroup.has(i) ? elcb : '', 'row.elcbGroup': elcb };
    const points = Object.fromEntries(POINT_TYPES.map((t) => [`row.points.${t.value}`, e.type === 'circuit' ? e.row.f.points?.[t.value] || '' : '']));
    if (e.type === 'spare') {
      const sp = e.spare;
      return { ...common, ...points, 'row.ref': spareRef(sp), 'row.mcb': sp.kind === 'spare' ? sp.ratingA ?? '' : '', 'row.wire': '', 'row.ecc': '', 'row.room': spareLabel(sp), 'row.R': '', 'row.Y': '', 'row.B': '', 'row.watts': '', 'row.remarks': sp.remarks ?? '', 'row.status': '' };
    }
    const r = e.row;
    return {
      ...common, ...points, 'row.ref': r.ref, 'row.mcb': r.f.breakerRatingA, 'row.wire': r.f.cableCsaMm2, 'row.ecc': cpcOf(r.f), 'row.room': r.f.room || r.f.name,
      'row.R': r.ph.R, 'row.Y': r.ph.Y, 'row.B': r.ph.B, 'row.watts': num(r.watts), 'row.remarks': remarksText(r.f),
      'row.status': r.status === 'bad' ? 'fails check' : r.status === 'warn' ? 'check' : ''
    };
  });
  return { fields, rows };
}

/** Text of a cell as the template has it (plain or rich text). */
function cellText(cell: ExcelJS.Cell): string | undefined {
  const v = cell.value;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return undefined;
}

/** Replaces the placeholders in a cell; unknown keys are kept and collected. */
function fillCell(cell: ExcelJS.Cell, fields: Fields, unknown: Set<string>) {
  const text = cellText(cell);
  if (text === undefined || !text.includes('{{')) return;
  const only = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/.exec(text);
  if (only && only[1] in fields) {
    const v = fields[only[1]];
    cell.value = v === '' ? null : v;
    return;
  }
  cell.value = text.replace(PH, (m, key: string) => {
    if (key in fields) return String(fields[key]);
    unknown.add(key);
    return m;
  });
}

/** The repeated row: the first with a {{row.…}} placeholder. */
function findRowTemplate(ws: ExcelJS.Worksheet): number | undefined {
  let found: number | undefined;
  ws.eachRow((row, r) => {
    if (found) return;
    row.eachCell((cell) => { if (!found && ROW_PH.test(cellText(cell) ?? '')) found = r; });
  });
  return found;
}

interface Range { top: number; left: number; bottom: number; right: number }
const parseRange = (s: string): Range => {
  const [a, b = a] = s.split(':');
  const cell = (x: string) => { const m = /^([A-Z]+)(\d+)$/.exec(x)!; return { col: colNumber(m[1]), row: Number(m[2]) }; };
  const p = cell(a), q = cell(b);
  return { top: Math.min(p.row, q.row), bottom: Math.max(p.row, q.row), left: Math.min(p.col, q.col), right: Math.max(p.col, q.col) };
};
const colNumber = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

/** Moves formula references when `extra` rows are inserted after row `at`:
 * rows below move down; a range that starts and ends on row `at` stretches. */
export function shiftFormula(f: string, at: number, extra: number): string {
  if (!extra) return f;
  const ref = (col: string, abs: string, row: string) => {
    const n = Number(row);
    return `${col}${abs}${n > at ? n + extra : n}`;
  };
  return f
    .replace(/(\$?[A-Z]{1,3})(\$?)(\d+):(\$?[A-Z]{1,3})(\$?)(\d+)/g, (_m, c1: string, a1: string, r1: string, c2: string, a2: string, r2: string) => {
      const end = Number(r2) === at && Number(r1) <= at ? `${c2}${a2}${at + extra}` : ref(c2, a2, r2);
      return `${ref(c1, a1, r1)}:${end}`;
    })
    .replace(/(?<![A-Z$:\d])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d:(])/g, (_m, c: string, a: string, r: string) => ref(c, a, r));
}

/** Fills one copy of the template sheet for one DB. */
function fillSheet(ws: ExcelJS.Worksheet, data: { fields: Fields; rows: Fields[] }, unknown: Set<string>) {
  const at = findRowTemplate(ws);
  if (at !== undefined) {
    const n = data.rows.length;
    const merges = ((ws.model as { merges?: string[] }).merges ?? []).map(parseRange);
    const inRow = merges.filter((m) => m.top === at && m.bottom === at);
    const below = merges.filter((m) => m.top > at);
    const spanning = merges.filter((m) => m.top <= at && m.bottom >= at && m.bottom > m.top);
    for (const m of [...inRow, ...below, ...spanning]) ws.unMergeCells(m.top, m.left, m.bottom, m.right);
    // Columns of the row to merge down: board-level placeholders over every
    // row, {{row.elcb}} over each ELCB group (as on the printed DEWA form).
    const tplRow = ws.getRow(at);
    const vertical: { col: number; by: 'all' | 'elcb' }[] = [];
    tplRow.eachCell((cell, col) => {
      const text = cellText(cell) ?? '';
      if (inRow.some((m) => col >= m.left && col <= m.right)) return;
      if (/^\s*\{\{\s*row\.elcb\s*\}\}\s*$/.test(text)) vertical.push({ col, by: 'elcb' });
      else if (text.includes('{{') && !ROW_PH.test(text)) vertical.push({ col, by: 'all' });
    });
    const extra = Math.max(n - 1, 0);
    if (extra) ws.duplicateRow(at, extra, true);
    if (!n) ws.spliceRows(at, 1, []); // a DB without circuits: no row
    const shift = n ? extra : -1;
    for (let i = 0; i < n; i++) {
      const row = ws.getRow(at + i);
      row.eachCell({ includeEmpty: true }, (cell) => fillCell(cell, { ...data.fields, ...data.rows[i] }, unknown));
    }
    for (const m of inRow) for (let i = 0; i < n; i++) ws.mergeCells(at + i, m.left, at + i, m.right);
    for (const v of vertical) {
      for (let i = 0; i < n;) {
        let j = i + 1;
        const group = data.rows[i]['row.elcbGroup'];
        if (v.by === 'all') j = n;
        else while (j < n && group && data.rows[j]['row.elcbGroup'] === group) j++;
        if (j - i > 1) {
          for (let k = i + 1; k < j; k++) ws.getCell(at + k, v.col).value = null;
          ws.mergeCells(at + i, v.col, at + j - 1, v.col);
        }
        i = j;
      }
    }
    for (const m of below) ws.mergeCells(m.top + shift, m.left, m.bottom + shift, m.right);
    for (const m of spanning) ws.mergeCells(m.top, m.left, Math.max(m.bottom + shift, m.top), m.right); // a side cell spanning the rows grows with them
    if (shift) {
      ws.eachRow((row) => row.eachCell((cell) => {
        const v = cell.value;
        if (v && typeof v === 'object' && 'formula' in v && typeof v.formula === 'string') cell.value = { formula: n ? shiftFormula(v.formula, at, extra) : v.formula } as ExcelJS.CellFormulaValue;
      }));
    }
  }
  ws.eachRow((row) => row.eachCell((cell) => fillCell(cell, data.fields, unknown)));
}

/** A sheet name Excel accepts, not yet used. */
function sheetName(wb: ExcelJS.Workbook, name: string): string {
  const base = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'DB';
  let out = base;
  for (let i = 2; wb.worksheets.some((w) => w.name.toLowerCase() === out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)}-${i}`;
  return out;
}

/** The DBs a template is filled for: those with schedule circuits, in submission order. */
export function templateBoards(project: Project, boardIds?: string[]): string[] {
  const groups = scheduleGroups(project);
  return SCHEDULE_GROUPS.flatMap(({ key }) => groups[key])
    .filter((b) => (!boardIds || boardIds.includes(b.id)) && scheduleCircuits(project, b.id).length > 0)
    .map((b) => b.id);
}

export interface TemplateResult { workbook: ExcelJS.Workbook; boards: string[]; warnings: string[] }

/** Fills an .xlsx template with the load schedule of each DB. */
export async function fillLoadScheduleTemplate(project: Project, template: ArrayBuffer | Uint8Array, opts: { boardIds?: string[]; at?: Date } = {}): Promise<TemplateResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(template as ArrayBuffer);
  } catch {
    throw new Error('The template is not a readable .xlsx file.');
  }
  const tpl = wb.worksheets.find((w) => findRowTemplate(w) !== undefined) ?? wb.worksheets[0];
  if (!tpl) throw new Error('The template has no sheets.');
  const boards = templateBoards(project, opts.boardIds);
  if (!boards.length) throw new Error('No DB with schedule circuits to fill the template with.');
  const warnings: string[] = [];
  if (findRowTemplate(tpl) === undefined) warnings.push('No row with {{row.…}} placeholders: circuits are not listed.');
  const unknown = new Set<string>();
  const model = tpl.model;
  const made = new Set<number>();
  for (const id of boards) {
    const ws = wb.addWorksheet(sheetName(wb, id));
    made.add(ws.id);
    const copy = structuredClone(model) as ExcelJS.WorksheetModel & { merges?: string[] };
    // A sheet model takes its merges as mergeCells, though it gives them as merges.
    ws.model = { ...copy, mergeCells: copy.merges, name: ws.name, id: ws.id } as ExcelJS.WorksheetModel;
    fillSheet(ws, templateData(project, id, opts.at), unknown);
  }
  wb.removeWorksheet(tpl.id);
  // Other sheets (cover, notes …) get the project fields only.
  const fields = templateData(project, boards[0], opts.at).fields;
  const projectOnly = Object.fromEntries(Object.entries(fields).filter(([k]) => k.startsWith('project.') || k === 'date'));
  for (const ws of wb.worksheets) if (!made.has(ws.id)) ws.eachRow((row) => row.eachCell((cell) => fillCell(cell, projectOnly, unknown)));
  if (unknown.size) warnings.push(`Unknown placeholders left as they are: ${[...unknown].map((k) => `{{${k}}}`).join(', ')}.`);
  return { workbook: wb, boards, warnings };
}

/** The top of the template sheet as text, down to the repeated row (at most 8 rows and 8 columns), for a preview. */
export async function templatePreview(template: ArrayBuffer | Uint8Array): Promise<{ rows: string[][]; repeatRow?: number }> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(template as ArrayBuffer); } catch { throw new Error('The template is not a readable .xlsx file.'); }
  const ws = wb.worksheets.find((w) => findRowTemplate(w) !== undefined) ?? wb.worksheets[0];
  if (!ws) throw new Error('The template has no sheets.');
  const at = findRowTemplate(ws);
  const last = Math.min(at ?? ws.rowCount, 8);
  const first = Math.max(1, last - 7);
  const cols = Math.min(Math.max(ws.columnCount, 1), 8);
  const rows: string[][] = [];
  for (let r = first; r <= last; r++) rows.push(Array.from({ length: cols }, (_, c) => cellText(ws.getCell(r, c + 1)) ?? (ws.getCell(r, c + 1).value == null ? '' : String(ws.getCell(r, c + 1).value))));
  return { rows, ...(at !== undefined && { repeatRow: at - first }) };
}
