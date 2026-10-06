import { cables } from '../calc/cableTable';
import { breakerTypeOf, cpcOf } from '../calc/earthing';
import { pointColumns, pointWattsFor, SINGLE_PHASES } from '../calc/loadSchedule';
import { breakerRatings } from '../calc/sizing';
import { addCircuit, refreshBoard, updateCircuit, type CircuitPatch } from '../model/schedule';
import type { Board, Feeder, Phase, PointType, Project } from '../types';
import { incomerCableText, incomerDeviceText, loadScheduleRows } from './loadScheduleDoc';
import { cellName, colName, parseCount, parsePositive, STYLE, statusColor, type SheetEdit, type SheetModel } from './sheet';

export { colName, type SheetEdit };

/** The DEWA "Load distribution schedule" of one DB as a spreadsheet: rows,
 * columns, merged cells and which cells the user may type in. Pure data,
 * so the grid component only draws it and hands typed values back to
 * applySheetEdits. The app's engine does every calculation. */

export type SheetColKey =
  | 'incomer' | 'elcb' | 'sl' | 'ref' | 'mcb' | 'wire' | 'ecc' | 'room'
  | `pt:${PointType}`
  | 'wpu' | 'R' | 'Y' | 'B' | 'remarks' | 'length' | 'check';

export interface SheetCol {
  key: SheetColKey;
  title: string;
  width: number;
  /** User input column (on circuit rows). */
  input: boolean;
  /** Choices, for dropdown columns. */
  source?: string[];
  /** Not on the authority form: kept after it, for the checks only. */
  appOnly?: boolean;
}

export type SheetRow =
  | { type: 'watts' }
  | { type: 'circuit'; feeder: Feeder }
  | { type: 'slot'; phase: Phase; way: number };

export interface DbSheet extends SheetModel {
  board: Board;
  sheetCols: SheetCol[];
  rows: SheetRow[];
  totals: string[];
  /** e.g. "40A TP ISOLATOR". */
  incomerText: string;
  /** Incoming cable line under the form. */
  cableText: string;
  /** Row index → status class for circuit rows ('ok' | 'warn' | 'bad'). */
  status: Record<number, string>;
}

const fmtKw = (w: number) => (w / 1000).toFixed(2);

export function buildDbSheet(project: Project, boardId: string): DbSheet {
  const { board, incomer, groups: elcbs, rows: circuitRows, phaseW } = loadScheduleRows(project, boardId);
  const points = pointColumns(project, board);
  const watts = pointWattsFor(board);
  const ratings = [...new Set([...breakerRatings().filter((a) => a <= 125), ...circuitRows.map((r) => r.f.breakerRatingA)])].sort((a, b) => a - b);
  const sizes = cables().map((c) => String(c.csaMm2));

  const cols: SheetCol[] = [
    { key: 'incomer', title: 'RATING OF INCOMER', width: 46, input: false },
    { key: 'elcb', title: 'RATING OF ELCB', width: 74, input: false },
    { key: 'sl', title: 'SL NO.', width: 38, input: false },
    { key: 'ref', title: 'CIR NO.', width: 46, input: false },
    { key: 'mcb', title: 'MCB RAT. IN AMPS', width: 56, input: true, source: ratings.map(String) },
    { key: 'wire', title: 'CCT WIRE SIZE (mm²)', width: 56, input: true, source: sizes },
    { key: 'ecc', title: 'ECC WIRE SIZE (mm²)', width: 56, input: true, source: sizes },
    { key: 'room', title: 'ROOM / AREA', width: 170, input: true },
    ...points.map((p): SheetCol => ({ key: `pt:${p.value}`, title: p.label, width: 48, input: true })),
    { key: 'wpu', title: 'WATTS / UNIT', width: 70, input: false },
    { key: 'R', title: 'R', width: 56, input: false },
    { key: 'Y', title: 'Y', width: 56, input: false },
    { key: 'B', title: 'B', width: 56, input: false },
    { key: 'remarks', title: 'REMARKS', width: 140, input: true },
    { key: 'length', title: 'LENGTH (m)', width: 58, input: true, appOnly: true },
    { key: 'check', title: 'CHECK', width: 64, input: false, appOnly: true }
  ];
  const at = (k: SheetColKey) => cols.findIndex((c) => c.key === k);

  // Slots: every way up to one spare way past the last used one, rounded up
  // to whole ELCB sections, like the printed form's blocks of rows.
  const byId = new Map(circuitRows.map((r) => [r.f.id, r]));
  const lastWay = circuitRows.reduce((m, r) => Math.max(m, r.f.way!), 0);
  const waysPerElcb = Math.max(1, (board.elcbGroupSize || 6) / 3);
  const ways = Math.max(waysPerElcb, Math.ceil((lastWay + 1) / waysPerElcb) * waysPerElcb);
  const rows: SheetRow[] = [{ type: 'watts' }];
  for (let way = 1; way <= ways; way++) {
    const onWay = circuitRows.filter((r) => r.f.way === way);
    const ryb = onWay.find((r) => r.f.phase === 'RYB');
    if (ryb) {
      rows.push({ type: 'circuit', feeder: ryb.f });
      continue;
    }
    for (const p of SINGLE_PHASES) {
      const r = onWay.find((x) => x.f.phase === p);
      rows.push(r ? { type: 'circuit', feeder: r.f } : { type: 'slot', phase: p, way });
    }
  }

  const status: Record<number, string> = {};
  const data = rows.map((row, y) => {
    const line: (string | number)[] = cols.map(() => '');
    if (row.type === 'watts') {
      line[at('room')] = 'WATT / UNIT →';
      for (const p of points) line[at(`pt:${p.value}`)] = watts[p.value] || '';
      return line;
    }
    if (row.type === 'slot') {
      line[at('ref')] = `${row.phase}${row.way}`;
      return line;
    }
    const f = row.feeder;
    const r = byId.get(f.id)!;
    status[y] = r.status;
    const used = points.filter((p) => (f.points?.[p.value] ?? 0) > 0);
    line[at('sl')] = r.sl;
    line[at('ref')] = r.ref;
    line[at('mcb')] = f.breakerRatingA;
    line[at('wire')] = f.cableCsaMm2;
    line[at('ecc')] = cpcOf(f);
    line[at('room')] = f.room ?? f.name ?? '';
    for (const p of points) line[at(`pt:${p.value}`)] = f.points?.[p.value] || '';
    line[at('wpu')] = used.map((p) => watts[p.value] || 0).join(' / ');
    line[at('R')] = r.ph.R;
    line[at('Y')] = r.ph.Y;
    line[at('B')] = r.ph.B;
    line[at('remarks')] = f.remarks ?? '';
    line[at('length')] = f.lengthM;
    line[at('check')] = r.belowMin ? `< ${r.minWire} mm²` : r.status === 'ok' ? 'OK' : r.status === 'warn' ? 'Check' : 'Fail';
    return line;
  });

  // DEWA form: the incomer device as drawn on the SLD; poles from the supply (SP for a 2-core supply).
  const incomerText = incomer
    ? `${board.ratedCurrentA ?? incomer.breakerRatingA}A ${incomer.cores >= 3 ? 'TP' : 'SP'} ${incomerDeviceText(board, incomer)}`
    : board.ratedCurrentA ? `${board.ratedCurrentA}A ${incomerDeviceText(board, undefined)}`.trim() : '';
  const first = 1;
  const count = rows.length - first;
  data[first][at('incomer')] = incomerText;
  const merges: Record<string, [number, number]> = { [`${colName(at('incomer'))}${first + 1}`]: [1, count] };

  // One ELCB cell per section (all rows of its ways), labelled when it has circuits.
  if (board.elcbGroupSize) {
    for (let g = 0; g * waysPerElcb < ways; g++) {
      const wayOf = (row: SheetRow) => (row.type === 'circuit' ? row.feeder.way! : row.type === 'slot' ? row.way : 0);
      const ys = rows.map((row, y) => ({ w: wayOf(row), y })).filter(({ w }) => w > g * waysPerElcb && w <= (g + 1) * waysPerElcb).map(({ y }) => y);
      if (!ys.length) continue;
      const e = elcbs.find((x) => x.index === g + 1);
      data[ys[0]][at('elcb')] = e ? `ELCB-${e.index} ${e.label}` : '';
      if (ys.length > 1) merges[`${colName(at('elcb'))}${ys[0] + 1}`] = [1, ys.length];
    }
  } else {
    merges[`${colName(at('elcb'))}${first + 1}`] = [1, count];
  }

  const totals = cols.map(() => '');
  totals[at('wpu')] = 'MAX. DEMAND (kW)';
  totals[at('R')] = fmtKw(phaseW.R * 1000);
  totals[at('Y')] = fmtKw(phaseW.Y * 1000);
  totals[at('B')] = fmtKw(phaseW.B * 1000);
  totals[at('remarks')] = fmtKw((phaseW.R + phaseW.Y + phaseW.B) * 1000);

  const cableText = incomerCableText(project, incomer);

  const groups = [
    { title: '', colspan: at('room') + 1 },
    { title: 'CONNECTED LOAD / POINTS', colspan: points.length },
    { title: '', colspan: 1 },
    { title: 'LOAD / CIRCUIT (WATTS)', colspan: 3 },
    { title: '', colspan: 1 },
    { title: 'CHECKS (not on form)', colspan: 2 }
  ];

  const shape = JSON.stringify([
    cols.map((c) => c.key),
    rows.map((r) => (r.type === 'circuit' ? `c:${r.feeder.id}` : r.type === 'slot' ? `s:${r.phase}${r.way}` : 'w')),
    merges
  ]);
  const sheet: DbSheet = {
    board, sheetCols: cols, rows, data, merges, groups, totals, incomerText, cableText, status, shape, styles: {},
    freezeColumns: at('room') + 1,
    cols: cols.map((c) => ({
      title: c.title, width: c.width, input: c.input || c.key === 'incomer' || c.key === 'elcb', source: c.source,
      align: c.key === 'room' || c.key === 'remarks' ? 'left' : 'center', wrap: c.key === 'room' || c.key === 'remarks'
    })),
    editable: (y, x) => isEditable(sheet, y, x)
  };
  sheet.styles = cellStyles(sheet);
  return sheet;
}

/** Input cells white, calculated cells grey, the WATT / UNIT row tinted,
 * and the check column coloured by result. */
function cellStyles(sheet: DbSheet): Record<string, string> {
  const out: Record<string, string> = {};
  sheet.rows.forEach((row, y) => {
    sheet.sheetCols.forEach((c, x) => {
      const name = cellName(x, y);
      if (row.type === 'watts') out[name] = STYLE.highlight;
      else if (c.key === 'ref' && row.type === 'slot') out[name] = STYLE.muted;
      else if (!isEditable(sheet, y, x)) out[name] = STYLE.calc;
      else out[name] = STYLE.input;
      if (c.key === 'check' && row.type === 'circuit') out[name] = `${STYLE.calc};font-weight:600;color:${statusColor(sheet.status[y])}`;
      if (c.key === 'incomer' || c.key === 'elcb') out[name] = `${STYLE.calc};${STYLE.vertical}`;
    });
  });
  return out;
}

/** Whether the user may type in a cell. */
export function isEditable(sheet: DbSheet, y: number, x: number): boolean {
  const row = sheet.rows[y];
  const col = sheet.sheetCols[x];
  if (!row || !col) return false;
  if (row.type === 'watts') return col.key.startsWith('pt:');
  if (!col.input) return false;
  // An empty way takes a room, points or remarks (that creates the circuit),
  // not sizes: those come from the load.
  if (row.type === 'slot') return col.key === 'room' || col.key === 'remarks' || col.key.startsWith('pt:');
  return true;
}

/** Applies typed or pasted values to the project. Values that don't fit a
 * cell (letters in a points cell, a size not in the cable table…) are
 * skipped and reported; the grid then shows the project's value again. */
export function applySheetEdits(project: Project, sheet: DbSheet, edits: SheetEdit[]): { project: Project; rejected: string[] } {
  const boardId = sheet.board.id;
  const rejected: string[] = [];
  const perRow = new Map<number, CircuitPatch & { points?: Feeder['points'] }>();
  let wattsPatch: Partial<Record<PointType, number>> | undefined;
  const cell = (e: SheetEdit) => `${colName(e.x)}${e.y + 1}`;

  for (const e of edits) {
    if (!isEditable(sheet, e.y, e.x)) continue;
    const row = sheet.rows[e.y];
    const key = sheet.sheetCols[e.x].key;
    const v = String(e.value ?? '');
    if (row.type === 'watts') {
      const n = parseCount(v);
      if (n === null) { rejected.push(`${cell(e)}: "${v}" is not a number of watts`); continue; }
      wattsPatch = { ...wattsPatch, [key.slice(3) as PointType]: n };
      continue;
    }
    const base = row.type === 'circuit' ? row.feeder : undefined;
    const patch = perRow.get(e.y) ?? {};
    if (key.startsWith('pt:')) {
      const n = parseCount(v);
      if (n === null) { rejected.push(`${cell(e)}: "${v}" — points must be a whole number`); continue; }
      patch.points = { ...(patch.points ?? base?.points), [key.slice(3)]: n };
    } else if (key === 'room') patch.room = v.trim();
    else if (key === 'remarks') patch.remarks = v.trim() || undefined;
    else if (key === 'mcb' || key === 'wire' || key === 'length' || key === 'ecc') {
      if (key === 'ecc' && v.trim() === '') { patch.cpcMm2 = undefined; perRow.set(e.y, patch); continue; }
      const n = parsePositive(v);
      const ok = n !== null && (key === 'length' || key === 'mcb' || cables().some((c) => c.csaMm2 === n));
      if (!ok) { rejected.push(`${cell(e)}: "${v}" is not a valid ${key === 'mcb' ? 'MCB rating' : key === 'length' ? 'length' : 'cable size'}`); continue; }
      if (key === 'mcb') patch.breakerRatingA = n;
      if (key === 'wire') patch.cableCsaMm2 = n;
      if (key === 'ecc') patch.cpcMm2 = n;
      if (key === 'length') patch.lengthM = n;
    }
    perRow.set(e.y, patch);
  }

  let p = project;
  if (wattsPatch) {
    const b = p.boards.find((x) => x.id === boardId)!;
    const pointItems = { ...b.pointItems };
    for (const t of Object.keys(wattsPatch)) delete pointItems[t as PointType]; // a typed value unlinks the library item
    p = { ...p, boards: p.boards.map((x) => (x.id === boardId ? { ...x, pointWatts: { ...x.pointWatts, ...wattsPatch }, pointItems } : x)) };
    p = refreshBoard(p, boardId);
  }
  for (const [y, patch] of perRow) {
    const row = sheet.rows[y];
    let id: string;
    if (row.type === 'slot') {
      const hasContent = !!patch.room || !!patch.remarks || Object.values(patch.points ?? {}).some((n) => (n ?? 0) > 0);
      if (!hasContent) continue;
      const added = addCircuit(p, boardId, row.phase, row.way);
      p = added.project;
      id = added.id;
    } else if (row.type === 'circuit') id = row.feeder.id;
    else continue;
    p = updateCircuit(p, id, patch);
  }
  return { project: p, rejected };
}
