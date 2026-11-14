import { cellAt, cellName, colIndex, colName, evaluateSheet, shiftFormula, type CellResult, type CellValue } from '../calc/sheetFormula';

/** The built-in sheets (Sheets page): what a sheet holds and the edits the page makes to it. Every edit returns a
 * new sheet, so one edit is one undo step. Rows and columns are counted from 1, cells are named as in Excel. */

export type SheetAlign = 'left' | 'center' | 'right';
export type SheetNumberFormat = 'general' | 'dec2' | 'percent';
export interface SheetStyle { bold?: boolean; italic?: boolean; underline?: boolean; align?: SheetAlign; wrap?: boolean; fill?: boolean; accent?: boolean; fmt?: SheetNumberFormat;
  /** The sides with a line, as letters in the order t r b l: lower case thin, upper case thick ('trbl', 'tB', 'TRBL'). */
  border?: string }
export interface Sheet {
  id: string;
  name: string;
  /** What was typed in each cell: a number, a text, or a formula starting with "=". Blank cells are left out. */
  cells: Record<string, string>;
  styles?: Record<string, SheetStyle>;
  /** Column widths in px, by column letter; the rest are DEFAULT_WIDTH. */
  widths?: Record<string, number>;
  rows: number;
  cols: number;
  /** Last values from the Excel file a sheet was opened from, for formulas the app cannot work out: the formula as it
   * was in the file (`f`) and its value there (`v`). Used only while the cell still holds that formula. */
  kept?: Record<string, { f: string; v: CellValue }>;
  /** Merged areas: none overlaps another, each has two cells or more. The value and the style are in the top-left cell. */
  merges?: Area[];
  /** The Excel file the sheet came from (name only). */
  source?: string;
  /** The panel of the project the sheet is linked to. */
  link?: SheetLink;
}
/** A sheet linked to one panel of the project; docs/sheetLink.ts fills it. Field keys are those of docs/scheduleFields. */
export interface SheetLink {
  /** The panel category the sheet is a schedule of: a DB load schedule, or a panel schedule of an MDB, SMDB or MCC with one row per outgoing feeder. */
  category: 'db' | 'md';
  /** The board it shows; none while the sheet is a format not yet on a board. */
  boardId?: string;
  /** Cells holding one value of the board or the project: cell name → field key, with the text kept before and after the value ("FED FROM: "). */
  cells: Record<string, { field: string; before?: string; after?: string }>;
  /** The first circuit row. */
  firstRow: number;
  /** The key (scheduleRowKeys) of each circuit row the sheet holds now, from firstRow down; empty before the first fill, when the sheet still has its one pattern row. */
  rows: string[];
  /** Column letter → field: a row.* key, or 'own' for the user's own column, kept with each circuit. */
  columns: Record<string, string>;
  /** Typed values waiting for Apply to project: row key → column letter → the text typed. */
  pending?: Record<string, Record<string, string>>;
  /** New circuit rows typed in the sheet, waiting for Apply to project: column letter → text. In the block they follow the board's rows. */
  added?: Record<string, string>[];
}
export interface SheetBook { sheets: Sheet[] }
export interface Area { r0: number; c0: number; r1: number; c1: number }

export const DEFAULT_ROWS = 40, DEFAULT_COLS = 12, DEFAULT_WIDTH = 96, MAX_ROWS = 2000, MAX_COLS = 60;
export const WIDTH_STEPS = [64, 96, 140, 200, 280];

/** Every cell's value: formulas worked out, and the file's last value for one the app cannot work out. */
export function sheetValues(s: Sheet): Record<string, CellResult> {
  const cached: Record<string, CellValue> = {};
  for (const [k, e] of Object.entries(s.kept ?? {})) if (s.cells[k] === e.f) cached[k] = e.v;
  return evaluateSheet(s.cells, cached);
}

export const area = (a: { r: number; c: number }, b: { r: number; c: number }): Area => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
export function areaCells(a: Area): string[] {
  const out: string[] = [];
  for (let r = a.r0; r <= a.r1; r++) for (let c = a.c0; c <= a.c1; c++) out.push(cellName(c, r));
  return out;
}

export function newSheet(existing: Sheet[] = [], name?: string): Sheet {
  let n = existing.length + 1;
  const taken = new Set(existing.map((s) => s.name.toLowerCase()));
  while (taken.has(`sheet ${n}`)) n++;
  let id = existing.length + 1;
  while (existing.some((s) => s.id === `S${id}`)) id++;
  return { id: `S${id}`, name: name?.trim() || `Sheet ${n}`, cells: {}, rows: DEFAULT_ROWS, cols: DEFAULT_COLS };
}
/** A sheet name as the tab shows it: trimmed, 31 characters at most (Excel's limit), not one another sheet has. */
export function sheetNameError(name: string, others: Sheet[]): string | undefined {
  const t = name.trim();
  if (!t) return 'Give the sheet a name';
  if (t.length > 31) return 'A sheet name is 31 characters at most';
  if (/[\\/?*[\]:]/.test(t)) return 'A sheet name cannot have \\ / ? * [ ] :';
  if (others.some((s) => s.name.toLowerCase() === t.toLowerCase())) return 'Another sheet has this name';
  return undefined;
}

/** The sheet with cells set (a blank value clears the cell); grows to hold a cell beyond its edge. */
export function withCells(s: Sheet, edits: Record<string, string>): Sheet {
  const cells = { ...s.cells };
  let { rows, cols } = s;
  for (const [k0, v] of Object.entries(edits)) {
    const at = cellAt(k0);
    if (!at || at.row > MAX_ROWS || at.col > MAX_COLS) continue;
    const k = cellName(at.col, at.row);
    const m = mergeAt(s, at.row, at.col);
    if (m && (m.r0 !== at.row || m.c0 !== at.col)) continue; // covered by a merged area: its first cell holds the value
    if (v === '' || v === undefined) delete cells[k];
    else { cells[k] = v; rows = Math.max(rows, at.row); cols = Math.max(cols, at.col); }
  }
  return { ...s, cells, rows, cols };
}

/** The sheet with a style change on every cell of an area; a key set to undefined is removed. */
export function withStyle(s: Sheet, a: Area, change: Partial<SheetStyle>): Sheet {
  const styles = { ...(s.styles ?? {}) };
  for (const k of areaCells(a)) {
    const next: SheetStyle = { ...(styles[k] ?? {}), ...change };
    for (const key of Object.keys(next) as (keyof SheetStyle)[]) if (next[key] === undefined || next[key] === false || next[key] === '') delete next[key];
    if (Object.keys(next).length) styles[k] = next; else delete styles[k];
  }
  return { ...s, styles };
}
/** Whether every cell of an area has a style flag: the tool then turns it off, as in Excel. */
export const allStyled = (s: Sheet, a: Area, key: 'bold' | 'italic' | 'underline' | 'wrap' | 'fill' | 'accent') => areaCells(a).every((k) => !!s.styles?.[k]?.[key]);

// ---- merged areas and borders

const touches = (m: Area, a: Area) => m.r0 <= a.r1 && m.r1 >= a.r0 && m.c0 <= a.c1 && m.c1 >= a.c0;
/** The merged area holding a cell. */
export const mergeAt = (s: Sheet, r: number, c: number): Area | undefined => s.merges?.find((m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1);
/** The top-left cell of the merged area holding a cell, or the cell itself. */
export const masterOf = (s: Sheet, r: number, c: number): { r: number; c: number } => { const m = mergeAt(s, r, c); return m ? { r: m.r0, c: m.c0 } : { r, c }; };

/** The area merged into one cell: it takes in every merged area it touches, keeps the first typed value (reading order) in the top-left cell and clears the others. */
export function mergeArea(s: Sheet, a: Area): Sheet {
  if (a.r0 === a.r1 && a.c0 === a.c1) return s;
  let g = { ...a }, grown = true;
  while (grown) {
    grown = false;
    for (const m of s.merges ?? []) if (touches(m, g) && (m.r0 < g.r0 || m.c0 < g.c0 || m.r1 > g.r1 || m.c1 > g.c1)) { g = { r0: Math.min(g.r0, m.r0), c0: Math.min(g.c0, m.c0), r1: Math.max(g.r1, m.r1), c1: Math.max(g.c1, m.c1) }; grown = true; }
  }
  const cells = { ...s.cells }, kept = s.kept ? { ...s.kept } : undefined;
  const names = areaCells(g), first = names[0];
  const from = names.find((k) => (cells[k] ?? '').trim() !== '');
  const text = from ? cells[from] : undefined, keptEntry = from ? kept?.[from] : undefined;
  for (const k of names) { delete cells[k]; if (kept) delete kept[k]; }
  if (text !== undefined) { cells[first] = text; if (kept && keptEntry) kept[first] = keptEntry; }
  const merges = [...(s.merges ?? []).filter((m) => !touches(m, g)), g];
  return { ...s, cells, ...(kept ? { kept } : {}), merges };
}
/** The sheet with every merged area that touches the area taken apart. */
export function unmergeArea(s: Sheet, a: Area): Sheet {
  if (!s.merges?.some((m) => touches(m, a))) return s;
  const { merges: _old, ...rest } = s;
  const left = s.merges.filter((m) => !touches(m, a));
  return left.length ? { ...rest, merges: left } : rest;
}

const SIDES = ['t', 'r', 'b', 'l'] as const;
type Side = (typeof SIDES)[number];
const line = (s: Sheet, r: number, c: number, side: Side): 0 | 1 | 2 => {
  const b = s.styles?.[cellName(c, r)]?.border;
  return !b ? 0 : b.includes(side) ? 1 : b.includes(side.toUpperCase()) ? 2 : 0;
};
/** Whether every cell of an area has all four sides: the Borders tool then removes them. */
export const allBordered = (s: Sheet, a: Area) => areaCells(a).every((k) => SIDES.every((side) => { const b = s.styles?.[k]?.border; return !!b && (b.includes(side) || b.includes(side.toUpperCase())); }));
/** The line to draw on each side of a cell (of the whole area for a merged area's top-left cell): 0 none, 1 thin, 2 thick.
 * A side takes the stronger of the cell's own line and the facing line of the neighbour across that edge. */
export function edgesOf(s: Sheet, r: number, c: number): Record<Side, 0 | 1 | 2> {
  const m = mergeAt(s, r, c) ?? { r0: r, c0: c, r1: r, c1: c };
  const own = (side: Side) => line(s, m.r0, m.c0, side);
  const far = (rr: number, cc: number, side: Side) => { if (rr < 1 || cc < 1) return 0; const t = masterOf(s, rr, cc); return line(s, t.r, t.c, side); };
  const max = (x: 0 | 1 | 2, y: 0 | 1 | 2): 0 | 1 | 2 => (x > y ? x : y);
  return {
    t: max(own('t'), far(m.r0 - 1, m.c0, 'b')), r: max(own('r'), far(m.r0, m.c1 + 1, 'l')),
    b: max(own('b'), far(m.r1 + 1, m.c0, 't')), l: max(own('l'), far(m.r0, m.c0 - 1, 'r'))
  };
}

// ---- rows and columns: the cells move, and every formula's references follow

const ONE = /(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})/;
const REFS = new RegExp(`"(?:[^"]|"")*"|${ONE.source}(?::${ONE.source})?(?![A-Za-z0-9_(.])`, 'g');
/** A formula after rows (or columns) were inserted (count > 0) or deleted (count < 0) at `at`. A reference to a
 * deleted cell becomes #REF!; a range loses the deleted part and is #REF! only when nothing of it is left. */
export function adjustFormula(formula: string, axis: 'row' | 'col', at: number, count: number): string {
  if (!formula.startsWith('=')) return formula;
  const gone = (v: number) => count < 0 && v >= at && v < at - count;
  const moved = (v: number) => (v >= at ? Math.max(at, v + count) : v);
  const name = (ac: string, col: number, ar: string, row: number) => `${ac}${colName(col)}${ar}${row}`;
  return formula.replace(REFS, (m: string, ...g: (string | number | undefined)[]) => {
    const [ac, col, ar, row, bc, col2, br, row2] = g as (string | undefined)[];
    const offset = g[8] as number;
    if (col === undefined) return m;
    if (offset > 0 && /[A-Za-z0-9_.]/.test(formula[offset - 1])) return m;
    const a = { c: colIndex(col.toUpperCase()), r: Number(row) };
    const pick = (p: { c: number; r: number }) => (axis === 'row' ? p.r : p.c);
    const put = (p: { c: number; r: number }, v: number) => (axis === 'row' ? { c: p.c, r: v } : { c: v, r: p.r });
    if (col2 === undefined) {
      if (gone(pick(a))) return '#REF!';
      const q = put(a, moved(pick(a)));
      return name(ac ?? '', q.c, ar ?? '', q.r);
    }
    const b = { c: colIndex(col2.toUpperCase()), r: Number(row2) };
    let lo = Math.min(pick(a), pick(b)), hi = Math.max(pick(a), pick(b));
    if (count < 0) {
      const end = at - count - 1; // last deleted
      if (lo >= at && hi <= end) return '#REF!';
      lo = lo > end ? lo + count : Math.min(lo, at);
      hi = hi > end ? hi + count : hi >= at ? at - 1 : hi;
    } else { lo = moved(lo); hi = moved(hi); }
    const first = put(a, pick(a) <= pick(b) ? lo : hi), second = put(b, pick(a) <= pick(b) ? hi : lo);
    return `${name(ac ?? '', first.c, ar ?? '', first.r)}:${name(bc ?? '', second.c, br ?? '', second.r)}`;
  });
}

/** A sheet's link after rows or columns were inserted or deleted: its cells and columns move, and so does the block of circuit rows. */
function reshapeLink(l: SheetLink, axis: 'row' | 'col', at: number, count: number, moveKey: (k: string) => string | undefined): SheetLink {
  const cells: SheetLink['cells'] = {};
  for (const [k, v] of Object.entries(l.cells)) { const to = moveKey(k); if (to) cells[to] = v; }
  let { firstRow, rows, columns, pending, added } = l;
  if (axis === 'col') {
    const move = <T,>(o: Record<string, T>) => { const out: Record<string, T> = {}; for (const [letters, v] of Object.entries(o)) { const to = moveKey(`${letters}1`); if (to) out[to.replace(/\d+$/, '')] = v; } return out; };
    columns = move(l.columns);
    if (pending) pending = Object.fromEntries(Object.entries(pending).map(([key, o]) => [key, move(o)]).filter(([, o]) => Object.keys(o).length));
    if (added) added = added.map(move);
  } else {
    const last = firstRow + Math.max(1, rows.length) - 1;
    if (count > 0) {
      if (at <= firstRow) firstRow += count;
      else if (at <= last && rows.length) rows = [...rows.slice(0, at - firstRow), ...Array<string>(count).fill(''), ...rows.slice(at - firstRow)];
    } else {
      const end = at - count - 1; // last deleted
      if (at <= firstRow && end >= last) { rows = []; firstRow = at; added = undefined; }
      else {
        const cut = rows.filter((_, i) => firstRow + i >= at && firstRow + i <= end).flatMap((k) => (k.startsWith('new:') ? [Number(k.slice(4))] : []));
        rows = rows.filter((_, i) => firstRow + i < at || firstRow + i > end);
        if (cut.length && added) { added = added.filter((_, i) => !cut.includes(i)); let n = 0; rows = rows.map((k) => (k.startsWith('new:') ? `new:${n++}` : k)); }
        if (firstRow > end) firstRow += count; else if (firstRow >= at) firstRow = at;
      }
    }
  }
  const { pending: _p, added: _a, ...rest } = l;
  return { ...rest, cells, columns, rows, firstRow, ...(pending && Object.keys(pending).length ? { pending } : {}), ...(added?.length ? { added } : {}) };
}

function reshape(s: Sheet, axis: 'row' | 'col', at: number, count: number): Sheet {
  const pick = (p: { col: number; row: number }) => (axis === 'row' ? p.row : p.col);
  const moveKey = (k: string): string | undefined => {
    const p = cellAt(k)!;
    const v = pick(p);
    if (count < 0 && v >= at && v < at - count) return undefined;
    const to = v >= at ? v + count : v;
    return axis === 'row' ? cellName(p.col, to) : cellName(to, p.row);
  };
  const cells: Record<string, string> = {}, styles: Record<string, SheetStyle> = {};
  for (const [k, v] of Object.entries(s.cells)) { const to = moveKey(k); if (to) cells[to] = adjustFormula(v, axis, at, count); }
  for (const [k, v] of Object.entries(s.styles ?? {})) { const to = moveKey(k); if (to) styles[to] = v; }
  let kept = s.kept;
  if (kept) {
    kept = {};
    for (const [k, e] of Object.entries(s.kept!)) { const to = moveKey(k); if (to) kept[to] = { f: adjustFormula(e.f, axis, at, count), v: e.v }; }
  }
  let widths = s.widths;
  if (axis === 'col' && widths) {
    widths = {};
    for (const [letters, w] of Object.entries(s.widths!)) {
      const c = colIndex(letters);
      if (count < 0 && c >= at && c < at - count) continue;
      widths[colName(c >= at ? c + count : c)] = w;
    }
  }
  const rows = axis === 'row' ? Math.min(MAX_ROWS, Math.max(1, s.rows + count)) : s.rows;
  const cols = axis === 'col' ? Math.min(MAX_COLS, Math.max(1, s.cols + count)) : s.cols;
  const merges: Area[] = [];
  for (const m of s.merges ?? []) {
    let [lo, hi] = axis === 'row' ? [m.r0, m.r1] : [m.c0, m.c1];
    if (count > 0) { if (lo >= at) { lo += count; hi += count; } else if (hi >= at) hi += count; }
    else {
      const end = at - count - 1; // last deleted
      if (lo > end) { lo += count; hi += count; } else if (hi >= at) { lo = Math.min(lo, at); hi = hi > end ? hi + count : at - 1; }
    }
    const next = axis === 'row' ? { ...m, r0: lo, r1: hi } : { ...m, c0: lo, c1: hi };
    if (next.r1 >= next.r0 && next.c1 >= next.c0 && (next.r1 > next.r0 || next.c1 > next.c0)) merges.push(next);
  }
  const { merges: _drop, ...bare } = s;
  const link = s.link && reshapeLink(s.link, axis, at, count, moveKey);
  return { ...bare, ...(link ? { link } : {}), ...(merges.length ? { merges } : {}), cells, ...(Object.keys(styles).length || s.styles ? { styles } : {}), ...(widths ? { widths } : {}), ...(kept ? { kept } : {}), rows, cols };
}
export const insertRows = (s: Sheet, at: number, count = 1): Sheet => (s.rows + count > MAX_ROWS ? s : reshape(s, 'row', at, count));
export const deleteRows = (s: Sheet, at: number, count = 1): Sheet => reshape(s, 'row', at, -Math.min(count, s.rows - at + 1));
export const insertCols = (s: Sheet, at: number, count = 1): Sheet => (s.cols + count > MAX_COLS ? s : reshape(s, 'col', at, count));
export const deleteCols = (s: Sheet, at: number, count = 1): Sheet => reshape(s, 'col', at, -Math.min(count, s.cols - at + 1));

/** The next width for the columns of an area: one step wider, and back to the narrowest after the widest. */
export function withNextWidth(s: Sheet, a: Area): Sheet {
  const widths = { ...(s.widths ?? {}) };
  const now = widths[colName(a.c0)] ?? DEFAULT_WIDTH;
  const next = WIDTH_STEPS.find((w) => w > now) ?? WIDTH_STEPS[0];
  for (let c = a.c0; c <= a.c1; c++) widths[colName(c)] = next;
  return { ...s, widths };
}

// ---- copy, paste, fill

/** The area as rows of what was typed (formulas as formulas). */
export const rawRows = (s: Sheet, a: Area): string[][] => Array.from({ length: a.r1 - a.r0 + 1 }, (_, r) => Array.from({ length: a.c1 - a.c0 + 1 }, (_, c) => s.cells[cellName(a.c0 + c, a.r0 + r)] ?? ''));
/** The area as rows of what is shown (formulas as their values), for the clipboard and Paste values. */
export function shownRows(s: Sheet, a: Area, values: Record<string, CellResult> = sheetValues(s)): string[][] {
  return Array.from({ length: a.r1 - a.r0 + 1 }, (_, r) => Array.from({ length: a.c1 - a.c0 + 1 }, (_, c) => plain(values[cellName(a.c0 + c, a.r0 + r)])));
}
const plain = (r: CellResult | undefined): string => (!r ? '' : r.error ? r.error : r.value === null ? '' : typeof r.value === 'boolean' ? (r.value ? 'TRUE' : 'FALSE') : String(r.value));

/** Edits that paste a block with its top-left cell at (row, col). `from`: where the block was copied in this
 * sheet — its formulas then follow the move, as in Excel; without it the block is pasted as typed. One copied
 * cell pasted over a larger selection fills the selection. */
export function pasteEdits(block: string[][], at: Area, from?: { r: number; c: number }): Record<string, string> {
  const out: Record<string, string> = {};
  const h = block.length, w = Math.max(0, ...block.map((r) => r.length));
  if (!h || !w) return out;
  const single = h === 1 && w === 1;
  const rows = single ? at.r1 - at.r0 + 1 : h, cols = single ? at.c1 - at.c0 + 1 : w;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = block[single ? 0 : r]?.[single ? 0 : c] ?? '';
    const row = at.r0 + r, col = at.c0 + c;
    if (row > MAX_ROWS || col > MAX_COLS) continue;
    out[cellName(col, row)] = from ? shiftFormula(v, row - (from.r + (single ? 0 : r)), col - (from.c + (single ? 0 : c))) : v;
  }
  return out;
}

/** Edits that fill an area down from its first row (formulas follow). */
export function fillDownEdits(s: Sheet, a: Area): Record<string, string> {
  const out: Record<string, string> = {};
  for (let r = a.r0 + 1; r <= a.r1; r++) for (let c = a.c0; c <= a.c1; c++) out[cellName(c, r)] = shiftFormula(s.cells[cellName(c, a.r0)] ?? '', r - a.r0, 0);
  return out;
}

/** The Sum tool: a formula adding the run of numbers above the cell, or else to its left; none when there is no run. */
export function sumFormula(s: Sheet, r: number, c: number, values: Record<string, CellResult> = sheetValues(s)): string | undefined {
  const isNum = (row: number, col: number) => typeof values[cellName(col, row)]?.value === 'number';
  let top = r;
  while (top > 1 && isNum(top - 1, c)) top--;
  if (top < r) return `=SUM(${cellName(c, top)}:${cellName(c, r - 1)})`;
  let left = c;
  while (left > 1 && isNum(r, left - 1)) left--;
  return left < c ? `=SUM(${cellName(left, r)}:${cellName(c - 1, r)})` : undefined;
}

/** A cell as the grid shows it. */
export function shown(r: CellResult | undefined, fmt: SheetNumberFormat = 'general'): string {
  if (!r) return '';
  if (r.error) return r.error;
  const v = r.value;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  if (fmt === 'dec2') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (fmt === 'percent') return `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  return String(Number(v.toPrecision(10)));
}
