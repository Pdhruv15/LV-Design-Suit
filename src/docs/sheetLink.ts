import { cellAt, cellName, colName, shiftFormula } from '../calc/sheetFormula';
import { deleteRows, insertRows, MAX_ROWS, mergeAt, newSheet, sheetNameError, withCells, type Area, type Sheet, type SheetLink, type SheetStyle } from '../model/sheets';
import { isDbBoard } from '../model/spareWays';
import { POINT_TYPES, type Board, type Project } from '../types';
import { scheduleRowKeys, templateData, type Value } from './scheduleFields';

/** Fills a sheet linked to a DB (Sheet.link) from the project: the cells that hold one value, and one row per circuit
 * and spare under the pattern row. The keys are those of the Excel load schedule template (scheduleFields.ts). No ExcelJS here. */

/** What a sheet can link to, for the pick list. `typed`: the user may type this value in the sheet. */
export const LINK_FIELDS: { key: string; label: string; kind: 'cell' | 'row'; typed: boolean }[] = [
  ...([
    ['project.name', 'Project name'], ['board.id', 'Board number'], ['board.name', 'Board name'], ['board.fedFrom', 'Fed from'], ['board.incomer', 'Incomer'],
    ['board.incomerCable', 'Incoming cable'], ['board.location', 'Location'], ['project.reference', 'Authority set'], ['project.revision', 'Revision'], ['date', 'Date'],
    ['total.R', 'Connected load R, W'], ['total.Y', 'Connected load Y, W'], ['total.B', 'Connected load B, W'], ['total.all', 'Connected load, W'],
    ['md.R', 'Maximum demand R, W'], ['md.Y', 'Maximum demand Y, W'], ['md.B', 'Maximum demand B, W'], ['md.all', 'Maximum demand, W'], ['imbalance', 'Phase imbalance, %']
  ] as const).map(([key, label]) => ({ key, label, kind: 'cell' as const, typed: false })),
  // A point column's own heading and watts per unit, as the Excel template has them.
  ...POINT_TYPES.flatMap((t) => [
    { key: `label.${t.value}`, label: `Heading: ${t.label}`, kind: 'cell' as const, typed: false },
    { key: `wattUnit.${t.value}`, label: `Watts per unit: ${t.label}`, kind: 'cell' as const, typed: false }
  ]),
  ...([
    ['row.sl', 'Serial number', false], ['row.ref', 'Circuit reference', false], ['row.phase', 'Phase', false], ['row.room', 'Room / area', true], ['row.watts', 'Circuit load, W', true],
    ['row.mcb', 'MCB rating, A', true], ['row.wire', 'Circuit wire, mm²', true], ['row.ecc', 'Earth wire, mm²', true], ['row.length', 'Length, m', true],
    ['row.R', 'Load on R, W', false], ['row.Y', 'Load on Y, W', false], ['row.B', 'Load on B, W', false], ['row.elcb', 'ELCB, first row of its group', false], ['row.elcbGroup', 'ELCB', false],
    ['row.remarks', 'Remarks', true], ['row.status', 'Check', false],
    ...POINT_TYPES.map((t) => [`row.points.${t.value}`, `Points: ${t.label}`, true] as const),
    ['own', 'Your column · kept with each circuit', true]
  ] as const).map(([key, label, typed]) => ({ key, label, kind: 'row' as const, typed }))
];
const KNOWN = new Set(LINK_FIELDS.map((f) => f.key));

/** What a sheet needs so the app can build the board and the single line diagram from it. */
export function linkNeeds(link: SheetLink): { key: 'board' | 'fedFrom' | 'row'; label: string; ok: boolean }[] {
  const cellOf = (field: string) => Object.values(link.cells).some((c) => c.field === field);
  return [
    { key: 'board', label: 'Board number', ok: cellOf('board.id') },
    { key: 'fedFrom', label: 'Fed from', ok: cellOf('board.fedFrom') },
    { key: 'row', label: 'A description or a load on each row', ok: Object.values(link.columns).some((f) => f === 'row.room' || f === 'row.watts' || f.startsWith('row.points.')) }
  ];
}

const PH = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const ONLY_ROW = /^\s*\{\{\s*(row\.[A-Za-z0-9_.]+)\s*\}\}\s*$/;

/** A sheet that carries the template's {{key}} placeholders, linked: the first row with a {{row.…}} cell is the pattern row,
 * a cell with one other placeholder is a linked cell. Keys the link does not know stay as they are and are listed. */
export function linkFromPlaceholders(sheet: Sheet): { sheet: Sheet; unknown: string[] } | undefined {
  const at = Object.keys(sheet.cells).map((k) => ({ k, ...cellAt(k)! })).sort((a, b) => a.row - b.row || a.col - b.col);
  const first = at.find((c) => ONLY_ROW.test(sheet.cells[c.k]))?.row;
  if (first === undefined) return undefined;
  const cells = { ...sheet.cells }, columns: SheetLink['columns'] = {}, linked: SheetLink['cells'] = {}, unknown: string[] = [];
  const note = (key: string) => { if (!unknown.includes(key)) unknown.push(key); };
  for (const c of at) {
    const text = sheet.cells[c.k], only = c.row === first ? ONLY_ROW.exec(text) : null;
    if (only) {
      if (KNOWN.has(only[1])) { columns[colName(c.col)] = only[1]; delete cells[c.k]; } else note(only[1]);
      continue;
    }
    const found = [...text.matchAll(PH)];
    if (found.length === 1 && !found[0][1].startsWith('row.') && KNOWN.has(found[0][1])) {
      const m = found[0], before = text.slice(0, m.index), after = text.slice(m.index! + m[0].length);
      linked[c.k] = { field: m[1], ...(before && { before }), ...(after && { after }) };
      if (before + after) cells[c.k] = before + after; else delete cells[c.k];
    } else for (const m of found) if (!KNOWN.has(m[1])) note(m[1]);
  }
  return { sheet: { ...sheet, cells, link: { category: 'db', cells: linked, firstRow: first, rows: [], columns } }, unknown };
}

/** A text from the project as the sheet holds it: one that would read as a number or a formula gets Excel's apostrophe (as in docs/sheetXlsx.ts). */
const asTyped = (s: string) => (s !== '' && (s.startsWith('=') || s.startsWith("'") || (s.trim() !== '' && Number.isFinite(Number(s.trim())))) ? `'${s}` : s);

/** A value of the project as the cell shows it. */
const projectText = (v: Value | undefined) => (v === undefined || v === '' ? '' : typeof v === 'number' ? String(v) : asTyped(v));

/** A formula with the ranges that end on `row` (and start on or above it) stretched down by `extra` rows. */
const stretchRanges = (f: string, row: number, extra: number) => (!f.startsWith('=') ? f : f.replace(/"(?:[^"]|"")*"|(\$?[A-Za-z]{1,3}\$?)([1-9][0-9]{0,6}):(\$?[A-Za-z]{1,3}\$?)([1-9][0-9]{0,6})(?![A-Za-z0-9_(.])/g,
  (m, c1?: string, r1?: string, c2?: string, r2?: string) => (c1 !== undefined && Number(r2) === row && Number(r1) <= row ? `${c1}${r1}:${c2}${row + extra}` : m)));

/** The sheet filled from the project: header cells, then one row per circuit and spare of the board. The block of rows is
 * resized by inserting or deleting rows inside it, so the cells below move and formulas follow. The sheet itself when it has no
 * link, no board, or the board is not in the project. */
export function fillLinked(project: Project, sheet: Sheet, at?: Date): Sheet {
  const link = sheet.link, boardId = link?.boardId;
  if (!link || !boardId || !project.boards.some((b) => b.id === boardId)) return sheet;
  const data = templateData(project, boardId, at), keys = scheduleRowKeys(project, boardId), news = link.added ?? [];
  const allKeys = [...keys, ...news.map((_, i) => `new:${i}`)];
  const first = link.firstRow, have = Math.max(1, link.rows.length);
  const want = Math.min(Math.max(1, allKeys.length), have + MAX_ROWS - sheet.rows);
  // Typed values waiting for Apply: dropped when the row has left the board or the project now holds the same text.
  const pending: NonNullable<SheetLink['pending']> = {};
  for (const [key, typed] of Object.entries(link.pending ?? {})) {
    const row = data.rows[keys.indexOf(key)];
    for (const [letters, text] of Object.entries(typed)) {
      const field = link.columns[letters];
      if (row && field && field !== 'own' && text !== projectText(row[field])) pending[key] = { ...pending[key], [letters]: text };
    }
  }
  const own = Object.keys(link.columns).filter((c) => link.columns[c] === 'own');
  // Own text, by the key of the row it was typed beside, read before the block changes.
  const kept = new Map<string, Record<string, string>>();
  link.rows.forEach((key, i) => { if (key !== '') kept.set(key, Object.fromEntries(own.map((c) => [c, sheet.cells[`${c}${first + i}`] ?? '']))); });

  // Resize. A range over the block stretches when rows are inserted before its last row, and when rows below the first are deleted;
  // a block of one row has no row to insert before, so its ranges are stretched here.
  let s = sheet, added: number[] = [];
  const d = want - have;
  if (d > 0) {
    const grown = insertRows(s, have > 1 ? first + have - 1 : first + 1, d);
    if (have === 1) {
      const cells = { ...grown.cells };
      for (const [k, v] of Object.entries(cells)) { const p = cellAt(k)!; if (p.row < first || p.row >= first + want) cells[k] = stretchRanges(v, first, d); }
      s = { ...grown, cells };
    } else s = grown;
    added = Array.from({ length: d }, (_, i) => (have > 1 ? have - 1 : 1) + i);
  } else if (d < 0) s = deleteRows(s, first + want, -d);

  const cells = { ...s.cells }, styles = { ...(s.styles ?? {}) };
  const rowStyles = Object.entries(styles).filter(([k]) => cellAt(k)!.row === first).map(([k, v]) => [cellAt(k)!.col, v] as [number, SheetStyle]);
  for (const i of added) for (const [col, st] of rowStyles) styles[cellName(col, first + i)] = st;
  // A merged area one row high in the first row is repeated on every row.
  const last = first + want - 1;
  const own1 = (m: Area) => m.r0 === m.r1 && m.r0 >= first && m.r0 <= last;
  const merges = (s.merges ?? []).filter((m) => !(own1(m) && m.r0 > first));
  for (const m of merges.filter((m) => own1(m) && m.r0 === first)) for (let r = first + 1; r <= last; r++) merges.push({ ...m, r0: r, r1: r });
  const sheetNow: Sheet = { ...s, merges: merges.length ? merges : undefined };
  const put = (k: string, v: string) => {
    const p = cellAt(k)!, m = mergeAt(sheetNow, p.row, p.col);
    if (m && (m.r0 !== p.row || m.c0 !== p.col)) return;
    if (v === '') delete cells[k]; else cells[k] = v;
  };
  const filled = new Set([...Object.keys(link.columns)]);
  for (let c = 1; c <= s.cols; c++) {
    const letters = colName(c), top = s.cells[`${letters}${first}`];
    if (!filled.has(letters) && top?.startsWith('=')) for (let i = 1; i < want; i++) put(`${letters}${first + i}`, shiftFormula(top, i, 0));
  }
  for (let i = 0; i < want; i++) {
    const row = data.rows[i], mine = kept.get(allKeys[i]), typed = i < keys.length ? pending[keys[i]] : news[i - keys.length];
    for (const [letters, field] of Object.entries(link.columns)) {
      const k = `${letters}${first + i}`;
      if (field === 'own') put(k, mine?.[letters] ?? '');
      else put(k, typed?.[letters] ?? (row ? projectText(row[field]) : ''));
    }
  }
  for (const [k, c] of Object.entries(s.link?.cells ?? link.cells)) { // a linked cell below the block moved with the rows; the resize kept the link in step
    const v = data.fields[c.field], text = `${c.before ?? ''}${v === undefined ? '' : String(v)}${c.after ?? ''}`;
    cells[k] = typeof v === 'string' && !c.before && !c.after ? asTyped(text) : text;
    if (cells[k] === '') delete cells[k];
  }
  const { pending: _p, added: _q, ...base } = s.link ?? link;
  const out: Sheet = { ...s, cells, ...(Object.keys(styles).length || s.styles ? { styles } : {}), link: { ...base, rows: allKeys.slice(0, want), ...(Object.keys(pending).length ? { pending } : {}), ...(news.length ? { added: news } : {}) } };
  const { merges: _m, ...bare } = out;
  return { ...bare, ...(merges.length ? { merges } : {}), rows: Math.max(s.rows, last) };
}

/** The sheet linked to a board; the next fill reads its rows from the project. On another board the block keeps its
 * size, so that fill resizes it and leaves no row of the old board, and the own texts go (they belonged to its
 * circuits). The sheet itself when it has no link. */
export function linkToBoard(sheet: Sheet, boardId: string): Sheet {
  if (!sheet.link) return sheet;
  if (sheet.link.boardId === boardId) return { ...sheet, link: { ...sheet.link, boardId } };
  const { pending: _p, added: _a, ...rest } = sheet.link;
  return { ...sheet, link: { ...rest, boardId, rows: sheet.link.rows.map(() => '') } };
}

// ---- choosing what is linked (the Link columns panel)

/** The boards a DB sheet can show: DBs, and any board with schedule rows. */
export const linkBoards = (project: Project): Board[] => project.boards.filter((b) => isDbBoard(b) || scheduleRowKeys(project, b.id).length > 0);

const inBlock = (link: SheetLink, row: number) => row >= link.firstRow && row <= link.firstRow + Math.max(1, link.rows.length) - 1;

/** What a cell is linked to: a linked cell, or a cell of a linked column inside the block of circuit rows. */
export function linkAt(sheet: Sheet, r: number, c: number): { field: string; label: string; own: boolean } | undefined {
  const link = sheet.link;
  if (!link) return undefined;
  const field = link.cells[cellName(c, r)]?.field ?? (inBlock(link, r) ? link.columns[colName(c)] : undefined);
  return field === undefined ? undefined : { field, label: LINK_FIELDS.find((f) => f.key === field)?.label ?? field, own: field === 'own' };
}

/** An empty link on a sheet without one: no cells, no columns, no board. */
export const startLink = (sheet: Sheet, firstRow: number): Sheet => (sheet.link ? sheet : { ...sheet, link: { category: 'db', cells: {}, firstRow, rows: [], columns: {} } });
export function removeLink(sheet: Sheet): Sheet {
  const { link: _l, ...rest } = sheet;
  return rest;
}

/** The text of a cell up to and including its last colon and the spaces after it ("FED FROM: SMDB-1" → "FED FROM: "). */
const textBefore = (text: string): string | undefined => /^[\s\S]*:\s*/.exec(text)?.[0];

/** Links a cell to a cell field, or unlinks it. A new link keeps the text before the value ("FED FROM: ") and drops the old value;
 * a linked cell keeps its before and after and changes field. A cell inside the block of circuit rows is refused. */
export function setLinkCell(sheet: Sheet, cell: string, field: string | undefined): Sheet {
  const link = sheet.link, at = cellAt(cell);
  if (!link || !at || inBlock(link, at.row)) return sheet;
  const k = cellName(at.col, at.row), now = link.cells[k];
  if (field === undefined) {
    if (!now) return sheet;
    const { [k]: _gone, ...rest } = link.cells;
    return { ...sheet, link: { ...link, cells: rest } };
  }
  if (LINK_FIELDS.find((f) => f.key === field)?.kind !== 'cell') return sheet;
  if (now) return { ...sheet, link: { ...link, cells: { ...link.cells, [k]: { ...now, field } } } };
  const before = textBefore(sheet.cells[k] ?? ''), cells = { ...sheet.cells };
  if (before) cells[k] = before; else delete cells[k];
  return { ...sheet, cells, link: { ...link, cells: { ...link.cells, [k]: { field, ...(before && { before }) } } } };
}

/** Links a column to a row field or 'own', or unlinks it. A field goes to one column (the last one chosen); 'own' to any number. */
export function setLinkColumn(sheet: Sheet, letters: string, field: string | undefined): Sheet {
  const link = sheet.link, col = letters.toUpperCase();
  if (!link) return sheet;
  const columns = Object.fromEntries(Object.entries(link.columns).filter(([l, f]) => l !== col && (field === undefined || field === 'own' || f !== field)));
  if (field !== undefined) {
    if (LINK_FIELDS.find((f) => f.key === field)?.kind !== 'row') return sheet;
    columns[col] = field;
  }
  return { ...sheet, link: { ...link, columns } };
}

/** The first circuit row moved: the block goes back to its one pattern row (its extra rows are deleted), and a linked cell on the new row is unlinked. */
export function setFirstRow(sheet: Sheet, row: number): Sheet {
  const link = sheet.link;
  if (!link || !Number.isInteger(row) || row < 1 || row > MAX_ROWS) return sheet;
  const s = link.rows.length > 1 ? deleteRows(sheet, link.firstRow + 1, link.rows.length - 1) : sheet, l = s.link!;
  const cells = Object.fromEntries(Object.entries(l.cells).filter(([k]) => cellAt(k)!.row !== row));
  return { ...s, link: { ...l, firstRow: row, rows: [], cells } };
}

// ---- links guessed from the headings

const norm = (t: string) => t.toUpperCase().replace(/[\s./]+/g, ' ').trim();
const POINT_BY_LABEL = new Map(POINT_TYPES.map((t) => [norm(t.label).replace(/'/g, ''), `row.points.${t.value}`] as const));
/** The row field a heading stands for; null for a heading that is known but not linked; undefined for none. */
function headingField(text: string): string | null | undefined {
  const n = norm(text);
  if (!n) return undefined;
  const has = (...w: string[]) => w.some((x) => n.includes(x));
  if (has('ELCB', 'RCCB', 'RCD')) return 'row.elcbGroup';
  if (has('INCOMER')) return null;
  if (has('ECC', 'EARTH', 'CPC')) return 'row.ecc';
  if (has('MCB', 'BREAKER') || (has('RATING') && has('AMP'))) return 'row.mcb';
  if (has('CABLE', 'WIRE')) return 'row.wire';
  if (has('DESCRIPTION', 'ROOM', 'AREA')) return 'row.room';
  if (has('WATT') && has('UNIT')) return null;
  if (n === 'R' || n === 'Y' || n === 'B') return `row.${n}`;
  if (has('LOAD', 'WATT') && !has('CONNECTED LOAD POINTS')) return 'row.watts';
  if (has('LENGTH')) return 'row.length';
  if (has('REMARK')) return 'row.remarks';
  if (n === 'PH' || n === 'PHASE') return 'row.phase';
  if (['SL NO', 'SR NO', 'S NO', 'SL'].includes(n) || has('SERIAL')) return 'row.sl';
  if (/^(CKT|CCT|CIR|CIRCUIT)/.test(n) && !has('WIRE')) return 'row.ref';
  return POINT_BY_LABEL.get(n.replace(/'/g, ''));
}
const CELL_LABELS: [string, string][] = [['LOCATION OF DB', 'board.location'], ['LOCATION', 'board.location'], ['DB NAME', 'board.id'], ['DB NO', 'board.id'], ['FED FROM', 'board.fedFrom'], ['PROJECT', 'project.name'],
  ['INCOMER', 'board.incomer'], ['MAIN', 'board.incomer'], ['PANEL', 'board.id'], ['BOARD', 'board.id'], ['DB', 'board.id']];

/** Links guessed from the headings, for the user to check: the heading row (the one with most known headings, three at least),
 * the first circuit row under it, a column for each known heading, and the cells above it that are labelled (PANEL, FED FROM …).
 * A merged area is read from its first cell and counts for all its rows. Undefined when no heading row is found. */
export function suggestLink(sheet: Sheet): Sheet | undefined {
  const items = Object.keys(sheet.cells).flatMap((k) => {
    const p = cellAt(k)!, m = mergeAt(sheet, p.row, p.col), text = sheet.cells[k];
    return (m && (m.r0 !== p.row || m.c0 !== p.col)) || !text.trim() || text.startsWith('=') ? [] : [{ k, row: p.row, col: p.col, text, end: m?.r1 ?? p.row, right: m?.c1 ?? p.col }];
  }).sort((a, b) => a.row - b.row || a.col - b.col);
  let head = 0, best = 2;
  for (let r = 1; r <= 40; r++) {
    const n = items.filter((i) => i.row === r && typeof headingField(i.text) === 'string').length;
    if (n > best) { best = n; head = r; }
  }
  if (!head) return undefined;
  const reach = Math.max(head, ...items.filter((i) => i.row === head && headingField(i.text) !== undefined).map((i) => i.end));
  const columns: SheetLink['columns'] = {}, used = new Set<string>();
  const cols = [...new Set(items.filter((i) => i.row >= head && i.row <= reach).map((i) => i.col))].sort((a, b) => a - b);
  for (const c of cols) {
    // The lowest heading of a column counts first: a group heading over several columns gives way to the headings under it.
    const f = items.filter((i) => i.col === c && i.row >= head && i.row <= reach).sort((a, b) => b.row - a.row).map((i) => headingField(i.text)).find((x) => x !== undefined);
    if (typeof f === 'string' && !used.has(f)) { columns[colName(c)] = f; used.add(f); }
  }
  let out = startLink({ ...sheet, link: undefined }, reach + 1);
  out = { ...out, link: { ...out.link!, columns } };
  const field = new Set<string>();
  for (const i of items.filter((x) => x.row < head)) {
    const n = norm(i.text), hit = CELL_LABELS.find(([l]) => n === l || (n.startsWith(l) && /^\s*:/.test(n.slice(l.length))));
    if (!hit || field.has(hit[1])) continue;
    field.add(hit[1]);
    if (i.text.includes(':')) out = setLinkCell(out, i.k, hit[1]);
    else {
      const to = cellName(i.right + 1, i.row); // a label alone: the value goes in the next cell to its right
      const { [to]: _old, ...rest } = out.cells;
      out = setLinkCell({ ...out, cells: rest }, to, hit[1]);
    }
  }
  return out;
}

/** A copy of a sheet under a new id and a tab name of its own (the name made Excel-safe and unique among `all`), linked to a board when one is given. */
function copyAs(from: Sheet, all: Sheet[], name: string, boardId?: string): Sheet {
  const base = name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Sheet';
  let tab = base;
  for (let i = 2; sheetNameError(tab, all); i++) tab = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  const { source: _s, ...copy } = from, ns = newSheet(all, tab);
  return { ...(boardId ? linkToBoard(copy, boardId) : copy), id: ns.id, name: ns.name };
}

/** New sheets, one for each board no sheet is linked to yet: a copy of `from` on that board, named after it. Only the new ones. */
export function sheetsForBoards(sheets: Sheet[], from: Sheet, boardIds: string[]): Sheet[] {
  const made: Sheet[] = [], taken = new Set(sheets.map((s) => s.link?.boardId));
  for (const id of boardIds) {
    if (taken.has(id)) continue;
    taken.add(id);
    made.push(copyAs(from, [...sheets, ...made], id, id));
  }
  return made;
}

/** The sheet as a saved format keeps it: the block cut back to its pattern row, the cells of linked and own columns and the values
 * of linked cells blank (their text before and after stays), no board and nothing typed. Undefined for a sheet with no link. */
export function templateOf(sheet: Sheet): Sheet | undefined {
  const link = sheet.link;
  if (!link) return undefined;
  const s = link.rows.length > 1 ? deleteRows(sheet, link.firstRow + 1, link.rows.length - 1) : sheet, l = s.link!;
  const cells = { ...s.cells }, kept = s.kept ? { ...s.kept } : undefined;
  const clear = (k: string, text?: string) => { if (text) cells[k] = text; else delete cells[k]; if (!text && kept) delete kept[k]; };
  for (const letters of Object.keys(l.columns)) clear(`${letters}${l.firstRow}`);
  for (const [k, c] of Object.entries(l.cells)) clear(k, `${c.before ?? ''}${c.after ?? ''}`);
  const { source: _s, kept: _k, ...rest } = s;
  const { boardId: _b, pending: _p, added: _a, ...base } = l;
  return { ...rest, cells, ...(kept && Object.keys(kept).length ? { kept } : {}), link: { ...base, rows: [] } };
}

/** A new sheet in a saved format's layout: its own id and tab name (the given name, else the board's, else "Sheet"), on a board when one is given. */
export const sheetFromFormat = (template: Sheet, sheets: Sheet[], boardId?: string, name?: string): Sheet => copyAs(template, sheets, name || boardId || 'Sheet', boardId);

// ---- typing in a linked sheet

type Place = { refused: string } | { plain: true } | { key: string; letters: string } | { added: number; letters: string };
/** Where a typed cell goes: an ordinary cell, a board row (kept as pending), an added row, or nowhere (with the reason). */
function placeOf(sheet: Sheet, k: string): Place {
  const link = sheet.link, p = cellAt(k)!, at = link && linkAt(sheet, p.row, p.col);
  if (!link || !at || at.own) return { plain: true };
  if (link.cells[k]) return { refused: `${k} is filled from the project (${at.label}).` };
  if (!LINK_FIELDS.find((f) => f.key === at.field)?.typed) return { refused: `${k} is worked out by the app (${at.label}).` };
  if (at.field === 'row.watts' && Object.values(link.columns).some((f) => f.startsWith('row.points.'))) return { refused: `${k}: the load comes from the points columns.` };
  const i = p.row - link.firstRow, boardN = link.rows.filter((x) => !x.startsWith('new:')).length, letters = colName(p.col);
  if (i >= boardN) return { added: i - boardN, letters };
  const key = link.rows[i];
  if (!key) return { plain: true };
  if (key.startsWith('spare:') && at.field !== 'row.mcb' && at.field !== 'row.remarks') return { refused: `${k}: a spare way takes only its MCB rating and remarks.` };
  return { key, letters };
}
/** The reason a cell may not be typed in, or undefined when it may (the editor opens on it). */
export function typeRefusal(sheet: Sheet, cell: string): string | undefined {
  const at = cellAt(cell), place = at && placeOf(sheet, cellName(at.col, at.row));
  return place && 'refused' in place ? place.refused : undefined;
}

/** Text typed on the page: an ordinary cell is set; a typed cell of a linked column is kept beside the link until Apply to project
 * (a board row under its key, a new row in `added`); a cell the app fills or works out is refused. The sheet returned is the shown
 * sheet with the typed cells set, so it equals its own fill. `refused`: the message for the first cell refused; the rest still go through. */
export function typeLinked(project: Project, sheet: Sheet, edits: Record<string, string>): { sheet: Sheet; refused?: string } {
  const link = sheet.link, boardId = link?.boardId;
  const plain: Record<string, string> = {};
  const pending: NonNullable<SheetLink['pending']> = Object.fromEntries(Object.entries(link?.pending ?? {}).map(([k, v]) => [k, { ...v }]));
  const news = (link?.added ?? []).map((o) => ({ ...o }));
  const data = boardId && project.boards.some((b) => b.id === boardId) ? templateData(project, boardId) : undefined, keys = boardId && data ? scheduleRowKeys(project, boardId) : [];
  let refused: string | undefined, kept = false;
  for (const [k0, text] of Object.entries(edits)) {
    const at = cellAt(k0);
    if (!at) continue;
    const k = cellName(at.col, at.row);
    if ((sheet.cells[k] ?? '') === text) continue;
    const place = placeOf(sheet, k);
    if ('refused' in place) { refused ??= place.refused; continue; }
    plain[k] = text;
    if ('plain' in place) continue;
    if ('key' in place) {
      const row = data?.rows[keys.indexOf(place.key)];
      if (!row) continue;
      kept = true;
      if (text === projectText(row[link!.columns[place.letters]])) { delete pending[place.key]?.[place.letters]; if (pending[place.key] && !Object.keys(pending[place.key]).length) delete pending[place.key]; }
      else pending[place.key] = { ...pending[place.key], [place.letters]: text };
    } else {
      kept = true;
      while (news.length <= place.added) news.push({});
      if (text === '') delete news[place.added][place.letters]; else news[place.added][place.letters] = text;
    }
  }
  if (!Object.keys(plain).length) return { sheet, ...(refused && { refused }) };
  const next = withCells(sheet, plain);
  if (!kept || !link) return { sheet: next, ...(refused && { refused }) };
  const { pending: _p, added: _a, ...base } = link;
  const rows = [...link.rows.filter((k) => !k.startsWith('new:')), ...news.map((_, i) => `new:${i}`)]; // typing in the blank row of a board with no circuits makes the first new row
  return { sheet: { ...next, link: { ...base, rows: rows.length > link.rows.length ? rows : link.rows, ...(Object.keys(pending).length ? { pending } : {}), ...(news.length ? { added: news } : {}) } }, ...(refused && { refused }) };
}

/** A new empty circuit row at the end of the block. The sheet itself without a link or a board. */
export function addCircuitRow(sheet: Sheet): Sheet {
  const link = sheet.link;
  return link?.boardId ? { ...sheet, link: { ...link, added: [...(link.added ?? []), {}] } } : sheet;
}
/** The sheet without what was typed and not applied. */
export function discardPending(sheet: Sheet): Sheet {
  if (!sheet.link) return sheet;
  const { pending: _p, added: _a, ...rest } = sheet.link;
  return { ...sheet, link: rest };
}
/** How many typed values wait for Apply to project: each pending value, and each new row that holds a text. */
export function pendingCount(sheet: Sheet): number {
  const l = sheet.link;
  return !l ? 0 : Object.values(l.pending ?? {}).reduce((n, o) => n + Object.keys(o).length, 0) + (l.added ?? []).filter((o) => Object.values(o).some((t) => t !== '')).length;
}
