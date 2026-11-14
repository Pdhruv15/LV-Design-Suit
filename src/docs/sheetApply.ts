import { circuitWatts } from '../calc/loadSchedule';
import { addCircuit, updateCircuit } from '../model/schedule';
import { addOutgoingFeeder } from '../model/mdFeeders';
import type { SheetLink, Sheet } from '../model/sheets';
import type { Board, PointType, Project } from '../types';
import { applySheetEdits, buildDbSheet, isEditable, isItemizedCell, type DbSheet, type SheetColKey, type SheetEdit } from './dbSheet';
import { loadScheduleRows } from './loadScheduleDoc';
import { applyMdEdits, buildMdSheet, deviceOf, type MdColKey, type MdRow, type MdSheet } from './mdSheet';
import { rowReasons } from './scheduleCheck';
import { linkFields } from './sheetLink';

/** Apply to project: what was typed in a linked sheet goes to the project through the same edits the Load schedule tab makes
 * (applySheetEdits, addCircuit, updateCircuit) or the panel form makes (applyMdEdits, addOutgoingFeeder), so the same checks,
 * sizing and refusals apply. No ExcelJS here. */

const COLUMN: Record<string, SheetColKey> = { 'row.mcb': 'mcb', 'row.wire': 'wire', 'row.ecc': 'ecc', 'row.room': 'room', 'row.remarks': 'remarks', 'row.length': 'length' };
const columnOf = (field: string): SheetColKey | undefined => (field.startsWith('row.points.') ? `pt:${field.slice(11)}` as SheetColKey : COLUMN[field]);
const labelOf = (link: SheetLink, field: string) => linkFields(link.category).find((f) => f.key === field)?.label ?? field;
const MD_COLUMN: Record<string, MdColKey> = { 'row.name': 'name', 'row.fault': 'fault', 'row.cores': 'cores', 'row.cableType': 'type', 'row.size': 'size', 'row.ecc': 'ecc', 'row.length': 'length', 'row.tcl': 'tcl', 'row.remarks': 'remarks' };
const DEVICES = ['ACB', 'MCCB', 'ISOL'] as const;
const mdKey = (r: MdRow) => (r.type === 'feeder' ? keyOf(r.feeder) : r.type === 'way' ? `spare:${r.way.id}` : undefined);
const keyOf = (f: { uid?: string; id: string }) => f.uid ?? f.id;
const rowKey = (r: DbSheet['rows'][number]) => (r.type === 'circuit' ? keyOf(r.feeder) : r.type === 'spare' ? `spare:${r.spare.id}` : undefined);
const LIGHT = /\b(light|lights|lighting|ltg|lamp|lamps)\b/i;

interface Ref { cell?: string; row?: number; text: string }
type Cell = (letters: string) => string;
/** What differs between the kinds of linked sheet: the table, the tests of one row's typed texts, the edits and the new row. */
interface Kit<E, T> {
  build(p: Project, boardId: string): T;
  /** One row's typed texts, each tested alone against the table: the edits that pass, the letters that passed, and what follows the edits (a typed load). */
  prepare(p: Project, tbl: T, key: string, typed: Record<string, string>, cellOf: Cell, reject: (r: Ref) => void): { good: E[]; ok: Set<string>; after?: (p: Project) => Project };
  commit(p: Project, tbl: T, edits: E[]): Project;
  /** Whether a new row holds enough to make a circuit or feeder; the message when not. */
  wants(o: Record<string, string>): boolean;
  need: string;
  /** A new empty circuit or feeder on the board: the project and its id, or why not. */
  add(p: Project, boardId: string): { project: Project; id: string } | string;
}
interface Run { project: Project; sheet: Sheet; changed: number; added: number; rejected: string[]; refs: Ref[]; newKeys: Record<number, string> }

/** The DB load schedule: a row per circuit and spare, typed texts to the DB table's columns, a typed load as one load item. */
function dbKit(link: SheetLink, board: Board): Kit<SheetEdit, DbSheet> {
  const setWatts = (p: Project, key: string, w: number): Project => {
    const f = p.feeders.find((x) => keyOf(x) === key);
    if (!f || Math.round(circuitWatts(f, board)) === Math.round(w)) return p;
    const name = (f.room || f.name || '').trim() || 'Load';
    return updateCircuit(p, f.id, { points: {}, loadItems: [{ name, pointType: (LIGHT.test(name) ? 'ltg' : 'spare1') as PointType, quantity: 1, unitWatts: w }] });
  };
  return {
    build: buildDbSheet,
    prepare(p, tbl, key, typed, cellOf, reject) {
      const good: SheetEdit[] = [], ok = new Set<string>();
      let watts: number | undefined;
      const y = tbl.rows.findIndex((r) => rowKey(r) === key);
      for (const [letters, text] of Object.entries(typed)) {
        const field = link.columns[letters], cell = cellOf(letters);
        if (!field || field === 'own' || y < 0) continue;
        if (field === 'row.watts') {
          const n = Number(text.trim().replace(',', '.'));
          if (text.trim() !== '' && Number.isFinite(n) && n > 0) { watts = n; ok.add(letters); } else reject({ cell, text: `"${text}" is not a load in watts` });
          continue;
        }
        const ck = columnOf(field), x = tbl.sheetCols.findIndex((c) => c.key === ck);
        if (x < 0) { reject({ cell, text: `${labelOf(link, field)} is not a column of this DB` }); continue; }
        const row = tbl.rows[y];
        if (row.type === 'spare' && row.spare.kind === 'space' && ck === 'mcb') { reject({ cell, text: 'a space has no breaker' }); continue; }
        if (!isItemizedCell(tbl, y, x) && !isEditable(tbl, y, x)) { reject({ cell, text: `${labelOf(link, field)} cannot be changed on this row` }); continue; }
        const e: SheetEdit = { y, x, value: text }, r = applySheetEdits(p, tbl, [e]);
        if (r.rejected.length) reject({ cell, text: r.rejected[0].replace(/^[A-Z]+\d+: /, '') }); else { good.push(e); ok.add(letters); }
      }
      return { good, ok, ...(watts !== undefined && { after: (q: Project) => setWatts(q, key, watts!) }) };
    },
    commit: (p, tbl, edits) => applySheetEdits(p, tbl, edits).project,
    wants: (o) => Object.entries(o).some(([l, t]) => { const f = link.columns[l]; return t.trim() !== '' && (f === 'row.room' || f === 'row.watts' || (f?.startsWith('row.points.') && Number(t) > 0)); }),
    need: 'a description or a load',
    add(p, boardId) {
      try { return addCircuit(p, boardId); } catch { return `no free way on ${boardId}`; }
    }
  };
}

/** The panel form: a row per outgoing feeder and spare way, typed texts to the form's columns. A typed rating goes to the device
 * column the row uses (or the device typed beside it), a typed device moves the rating to that column. */
function mdKit(link: SheetLink): Kit<SheetEdit, MdSheet> {
  const present = (r: MdRow) => (r.type === 'feeder' ? { device: deviceOf(r.feeder), rating: r.feeder.breakerRatingA } : r.type === 'way' ? { device: r.way.device ?? (r.way.ratingA > 1600 ? 'ACB' : 'MCCB'), rating: r.way.ratingA } : { device: 'MCCB' as const, rating: undefined });
  return {
    build: buildMdSheet,
    prepare(p, tbl, key, typed, cellOf, reject) {
      const good: SheetEdit[] = [], ok = new Set<string>();
      const y = tbl.rows.findIndex((r) => mdKey(r) === key);
      if (y < 0) return { good, ok };
      const test = (x: number, value: string, letters: (string | undefined)[], cell: string, field: string) => {
        if (x < 0 || !tbl.editable(y, x)) { reject({ cell, text: `${labelOf(link, field)} cannot be changed on this row` }); return; }
        const e: SheetEdit = { y, x, value }, r = applyMdEdits(p, tbl, [e]);
        if (r.rejected.length) reject({ cell, text: r.rejected[0].replace(/^[A-Z]+\d+: /, '') }); else { good.push(e); for (const l of letters) if (l) ok.add(l); }
      };
      let rating: [string, string] | undefined, device: [string, string] | undefined;
      for (const [letters, text] of Object.entries(typed)) {
        const field = link.columns[letters];
        if (!field || field === 'own') continue;
        if (field === 'row.rating') rating = [letters, text];
        else if (field === 'row.device') device = [letters, text];
        else if (MD_COLUMN[field]) test(tbl.keys.indexOf(MD_COLUMN[field]), text, [letters], cellOf(letters), field);
      }
      if (device && !DEVICES.some((d) => d === device![1].trim().toUpperCase())) { reject({ cell: cellOf(device[0]), text: `"${device[1]}" is not ACB, MCCB or ISOL` }); device = undefined; }
      if (device || rating) {
        const now = present(tbl.rows[y]), dev = device ? device[1].trim().toUpperCase() as MdColKey : now.device;
        const [letters, field] = rating ? [rating[0], 'row.rating'] : [device![0], 'row.device'];
        test(tbl.keys.indexOf(dev), rating ? rating[1] : String(now.rating ?? ''), [rating?.[0], device?.[0]], cellOf(letters), field);
      }
      return { good, ok };
    },
    commit: (p, tbl, edits) => applyMdEdits(p, tbl, edits).project,
    wants: (o) => Object.entries(o).some(([l, t]) => { const f = link.columns[l]; return t.trim() !== '' && (f === 'row.name' || (f === 'row.tcl' && Number(t.trim().replace(/\s*kw$/i, '').replace(',', '.')) > 0)); }),
    need: 'a feeder name or a load',
    add(p, boardId) {
      const r = addOutgoingFeeder(p, boardId);
      return r.id ? { project: r.project, id: r.id } : r.message;
    }
  };
}

function run(project: Project, sheet: Sheet): Run {
  const none: Run = { project, sheet, changed: 0, added: 0, rejected: [], refs: [], newKeys: {} };
  const link = sheet.link, boardId = link?.boardId, board = project.boards.find((b) => b.id === boardId);
  if (!link || !boardId || !board) return none;
  const pend = link.pending ?? {}, news = link.added ?? [];
  const hasText = (o: Record<string, string>) => Object.values(o).some((t) => t.trim() !== '');
  if (!Object.keys(pend).length && !news.some(hasText)) return none;
  const refs: Ref[] = [], rejected: string[] = [];
  const reject = (ref: Ref) => { refs.push(ref); rejected.push(ref.cell ? `${ref.cell}: ${ref.text}` : ref.text); };
  const kit = (link.category === 'md' ? mdKit(link) : dbKit(link, board)) as Kit<unknown, unknown>;

  // Board rows.
  let p = project;
  const tbl0 = kit.build(project, boardId), done: Record<string, Set<string>> = {}, edits: unknown[] = [], afters: ((q: Project) => Project)[] = [];
  for (const [key, typed] of Object.entries(pend)) {
    const at = link.rows.indexOf(key);
    if (at < 0) continue;
    const r = kit.prepare(project, tbl0, key, typed, (l) => `${l}${link.firstRow + at}`, reject);
    done[key] = r.ok;
    edits.push(...r.good);
    if (r.after) afters.push(r.after);
  }
  p = kit.commit(p, tbl0, edits);
  for (const after of afters) p = after(p);

  // New rows, each made on a trial first: a row with a value that fails is not made.
  const made: Record<number, string> = {};
  news.forEach((o, a) => {
    if (!hasText(o)) return;
    const at = link.rows.indexOf(`new:${a}`), sheetRow = link.firstRow + (at >= 0 ? at : link.rows.filter((k) => !k.startsWith('new:')).length + a);
    if (!kit.wants(o)) { reject({ row: a, text: `Row ${sheetRow}: give ${kit.need}` }); return; }
    const trial = kit.add(p, boardId);
    if (typeof trial === 'string') { reject({ row: a, text: `Row ${sheetRow}: ${trial}` }); return; }
    const key = keyOf(trial.project.feeders.find((f) => f.id === trial.id)!), tbl = kit.build(trial.project, boardId);
    const before = rejected.length, r = kit.prepare(trial.project, tbl, key, o, (l) => `${l}${sheetRow}`, reject);
    if (rejected.length > before) return;
    p = kit.commit(trial.project, tbl, r.good);
    if (r.after) p = r.after(p);
    made[a] = key;
  });
  const addedN = Object.keys(made).length;
  const changedKeys = Object.keys(done).filter((k) => done[k].size);
  if (!changedKeys.length && !addedN) return { ...none, rejected, refs };

  // The sheet: applied values leave, rejected ones stay; a made row's key is the circuit's, the others are numbered again.
  const pending: NonNullable<SheetLink['pending']> = {};
  for (const [key, typed] of Object.entries(pend)) {
    const left = Object.fromEntries(Object.entries(typed).filter(([l]) => !done[key]?.has(l)));
    if (Object.keys(left).length) pending[key] = left;
  }
  const order = news.map((_, a) => a).filter((a) => !(a in made)), renum = new Map(order.map((a, n) => [a, n]));
  const rows = link.rows.map((k) => { if (!k.startsWith('new:')) return k; const a = Number(k.slice(4)); return a in made ? made[a] : `new:${renum.get(a)}`; });
  const remaining = order.map((a) => news[a]);
  const { pending: _p, added: _a, ...base } = link;
  const out: Sheet = { ...sheet, link: { ...base, rows, ...(Object.keys(pending).length ? { pending } : {}), ...(remaining.length ? { added: remaining } : {}) } };
  return { project: p, sheet: out, changed: changedKeys.length, added: addedN, rejected, refs, newKeys: made };
}

/** Turns what was typed in a linked sheet into edits of the project. The same objects back when there is nothing to apply. */
export function applyLinked(project: Project, sheet: Sheet): { project: Project; sheet: Sheet; changed: number; added: number; rejected: string[] } {
  const { refs: _r, newKeys: _n, ...r } = run(project, sheet);
  return r;
}

/** One mark for each typed cell that is not applied yet, from a dry run of Apply: refused (with the reason), check (the circuit
 * would need a check after Apply, for a typed MCB, cable or earth; DB only) or pending. */
export function pendingMarks(project: Project, sheet: Sheet): Record<string, { kind: 'pending' | 'check' | 'refused'; text: string }> {
  const link = sheet.link, boardId = link?.boardId, marks: Record<string, { kind: 'pending' | 'check' | 'refused'; text: string }> = {};
  if (!link || !boardId) return marks;
  const r = run(project, sheet);
  const rows = link.category === 'md' ? [] : loadScheduleRows(r.project, boardId).rows; // a panel schedule has no check kind in this step
  const checkOf = (key: string) => { const row = rows.find((x) => keyOf(x.f) === key); const why = row && (row.status !== 'ok' || row.belowMin) ? rowReasons(r.project, row) : []; return why.length ? `After Apply this circuit needs a check: ${why.join('; ')}` : undefined; };
  const mark = (cell: string, field: string, key: string | undefined, a?: number) => {
    const ref = r.refs.find((x) => x.cell === cell || (a !== undefined && x.row === a));
    const text = ref ? undefined : key && link.category !== 'md' && ['row.mcb', 'row.wire', 'row.ecc'].includes(field) ? checkOf(key) : undefined;
    marks[cell] = ref ? { kind: 'refused', text: ref.text } : text ? { kind: 'check', text } : { kind: 'pending', text: 'Typed, not applied yet' };
  };
  for (const [key, typed] of Object.entries(link.pending ?? {})) {
    const at = link.rows.indexOf(key);
    if (at >= 0) for (const letters of Object.keys(typed)) mark(`${letters}${link.firstRow + at}`, link.columns[letters], key);
  }
  (link.added ?? []).forEach((o, a) => {
    const at = link.rows.indexOf(`new:${a}`);
    if (at >= 0) for (const [letters, text] of Object.entries(o)) if (text.trim() !== '' && link.columns[letters]) mark(`${letters}${link.firstRow + at}`, link.columns[letters], r.newKeys[a], a);
  });
  return marks;
}
