import { cables } from '../calc/cableTable';
import { builtUpAreaOf } from '../calc/building';
import { breakerTypeOf, cpcOf } from '../calc/earthing';
import { runsOf } from '../calc/electrical';
import { isScheduleCircuit, type PhaseKw } from '../calc/loadSchedule';
import { breakerRatings } from '../calc/sizing';
import { CABLE_TYPES, DEFAULT_CABLE_TYPE, type Board, type Feeder, type MeterType, type Project, type SwitchDevice } from '../types';
import { cellName, parseCount, parsePositive, STYLE, type SheetEdit, type SheetModel } from './sheet';

/** "Details of connected load, maximum demand & kWh metering" — the
 * authority form for a meter cabinet, MDB, SMDB or MCC: its incomer, then
 * every outgoing feeder (to boards or equipment) with cable, connected load
 * per phase, TCL, MDL and proposed kWh meter. Loads come from everything
 * below each feeder, down to the DB load schedules. */

export type MdColKey =
  | 'name' | 'sptp' | 'ACB' | 'MCCB' | 'ISOL' | 'fault' | 'cores' | 'type' | 'size' | 'ecc' | 'length'
  | 'R' | 'Y' | 'B' | 'tcl' | 'mdl' | '1-PH' | '3-PH' | 'CT' | 'remarks';

export type MdRow =
  | { type: 'incomer'; feeder?: Feeder }
  | { type: 'label' }
  | { type: 'feeder'; feeder: Feeder; toBoard?: Board }
  | { type: 'spare' };

export interface MdSheet extends SheetModel {
  board: Board;
  keys: MdColKey[];
  rows: MdRow[];
  totals: string[];
  /** Header and footer fields of the form. */
  form: {
    title: string;
    project: string;
    area: string;
    completion: string;
    owner: string;
    consultant: string;
    plotNo: string;
    boardLine: string; // e.g. "MDB-V4A (FED FROM METER CABINET)"
    location: string;
    connectedTo: string[]; // "MDB CONNECTED TO: …", "DB's CONNECTED TO: …"
    demandFactor: number;
    maxDemandKw: number;
    totalConnectedKw: number;
    builtUpArea: string;
    contractor: string;
    tel: string;
    fax: string;
  };
}

const ZERO: PhaseKw = { R: 0, Y: 0, B: 0 };
const add = (a: PhaseKw, b: PhaseKw): PhaseKw => ({ R: a.R + b.R, Y: a.Y + b.Y, B: a.B + b.B });
const sum = (p: PhaseKw) => p.R + p.Y + p.B;

/** Connected (installed) load of one feeder per phase, kW: nameplate load
 * with no demand factor; single-phase circuits on their own phase. */
function feederConnected(f: Feeder): PhaseKw {
  if (f.generation) return ZERO; // generation is not connected load
  if (f.cores === 2 && f.phase && f.phase !== 'RYB') return { ...ZERO, [f.phase]: f.loadKw };
  return { R: f.loadKw / 3, Y: f.loadKw / 3, B: f.loadKw / 3 };
}

/** Connected load per phase of everything fed from a board, kW. */
export function connectedPhaseKw(project: Project, boardId: string, seen = new Set<string>()): PhaseKw {
  if (seen.has(boardId)) return ZERO;
  seen.add(boardId);
  return project.feeders
    .filter((f) => f.boardId === boardId)
    .reduce((acc, f) => add(acc, f.feedsBoardId ? connectedPhaseKw(project, f.feedsBoardId, seen) : feederConnected(f)), ZERO);
}

export const deviceOf = (f: Feeder): SwitchDevice => f.device ?? (breakerTypeOf(f) === 'ACB' ? 'ACB' : 'MCCB');

/** Meter suggested by the form's own legend: (1) 1-phase up to 60 A,
 * (2) 3-phase up to 125 A, otherwise CT metering. */
export function suggestedMeter(ratingA: number, threePhase: boolean): MeterType {
  if (!threePhase && ratingA <= 60) return '1-PH';
  return ratingA <= 125 ? '3-PH' : 'CT';
}

/** Boards that get this form: any board with outgoing feeders that are not
 * DB load schedule circuits. */
export const hasMdSheet = (project: Project, boardId: string) =>
  project.feeders.some((f) => f.boardId === boardId && !isScheduleCircuit(f));

const kw = (v: number) => v.toFixed(2);

export function buildMdSheet(project: Project, boardId: string): MdSheet {
  const board = project.boards.find((b) => b.id === boardId)!;
  const upstream = board.upstreamId ? project.boards.find((b) => b.id === board.upstreamId) : undefined;
  const incomer = project.feeders.find((f) => f.feedsBoardId === boardId && f.boardId === board.upstreamId);
  const outgoing = project.feeders.filter((f) => f.boardId === boardId && !isScheduleCircuit(f));
  const df = project.info?.mdDemandFactor ?? 0.8;
  const sizes = cables().map((c) => String(c.csaMm2));
  const ratings = breakerRatings().map(String);

  const keys: MdColKey[] = ['name', 'sptp', 'ACB', 'MCCB', 'ISOL', 'fault', 'cores', 'type', 'size', 'ecc', 'length', 'R', 'Y', 'B', 'tcl', 'mdl', '1-PH', '3-PH', 'CT', 'remarks'];
  const at = (k: MdColKey) => keys.indexOf(k);
  const titles: Record<MdColKey, string> = {
    name: 'CIRCUIT/FEEDER SMDB/ DB NO.', sptp: 'SP/ TP', ACB: 'ACB', MCCB: 'MCCB', ISOL: 'ISOL', fault: 'FAULT DUTY kA',
    cores: 'NO. OF CORES: 1C/2C/4C', type: 'TYPE: XLPE/PVC/SWA', size: 'SIZE', ecc: 'ECC SIZE 1C mm2', length: 'LENGTH OF CABLE (Mtrs)',
    R: 'R-PH kW', Y: 'Y-PH kW', B: 'B-PH kW', tcl: 'TOTAL CONNECTED /INSTALLED LOAD (TCL) Kw', mdl: 'MAXIMUM DEMAND/ OPERATIONAL LOAD (MDL) Kw',
    '1-PH': '1-PH (1)', '3-PH': '3-PH (2)', CT: 'LV/HV-CT (3)', remarks: 'REMARKS'
  };
  const widths: Partial<Record<MdColKey, number>> = { name: 190, type: 104, remarks: 150, tcl: 84, mdl: 84, cores: 64, length: 64 };

  const rows: MdRow[] = [{ type: 'incomer', feeder: incomer }, { type: 'label' }];
  for (const f of outgoing) rows.push({ type: 'feeder', feeder: f, toBoard: f.feedsBoardId ? project.boards.find((b) => b.id === f.feedsBoardId) : undefined });
  rows.push({ type: 'spare' });

  const blank = () => keys.map((): string | number => '');
  const cableCells = (line: (string | number)[], f: Feeder) => {
    line[at('sptp')] = f.cores >= 3 ? 'TP' : 'SP';
    line[at(deviceOf(f))] = f.breakerRatingA;
    line[at('fault')] = f.breakerIcuKa;
    line[at('cores')] = `${f.cores}C`;
    line[at('type')] = f.cableType ?? DEFAULT_CABLE_TYPE;
    line[at('size')] = runsOf(f) > 1 ? `${runsOf(f)}x${f.cableCsaMm2}` : f.cableCsaMm2;
    line[at('ecc')] = cpcOf(f);
    line[at('length')] = f.lengthM;
  };

  let total = ZERO;
  const meters: Record<MeterType, number> = { '1-PH': 0, '3-PH': 0, CT: 0 };
  const merges: Record<string, [number, number]> = {};
  const data = rows.map((row, y) => {
    const line = blank();
    if (row.type === 'label') {
      line[0] = 'OUT GOING';
      merges[cellName(0, y)] = [keys.length, 1];
      return line;
    }
    if (row.type === 'spare') return line;
    if (row.type === 'incomer') {
      line[at('name')] = 'INCOMER';
      if (row.feeder) {
        cableCells(line, row.feeder);
        const m = row.feeder.kwhMeter;
        if (m) { line[at(m)] = 1; meters[m]++; }
        return line;
      }
      const s = board.supply ?? {};
      const rating = s.ratingA ?? board.ratedCurrentA;
      line[at('sptp')] = 'TP';
      if (rating) line[at(s.device ?? 'MCCB')] = rating;
      if (s.faultKa) line[at('fault')] = s.faultKa;
      line[at('cores')] = s.cable ?? `BY ${s.fedFrom ?? 'DEWA'}`;
      merges[cellName(at('cores'), y)] = [3, 1];
      line[at('ecc')] = s.ecc ?? '';
      const m = s.meter ?? (rating ? suggestedMeter(rating, true) : undefined);
      if (m) { line[at(m)] = 1; meters[m]++; }
      return line;
    }
    const f = row.feeder;
    const p = row.toBoard ? connectedPhaseKw(project, row.toBoard.id) : feederConnected(f);
    total = add(total, p);
    line[at('name')] = row.toBoard ? `${row.toBoard.id} (${row.toBoard.name.toUpperCase()})` : (f.name || f.id).toUpperCase();
    cableCells(line, f);
    line[at('R')] = kw(p.R);
    line[at('Y')] = kw(p.Y);
    line[at('B')] = kw(p.B);
    line[at('tcl')] = kw(sum(p));
    line[at('mdl')] = kw(sum(p) * df);
    if (f.kwhMeter) { line[at(f.kwhMeter)] = 1; meters[f.kwhMeter]++; }
    line[at('remarks')] = f.remarks ?? '';
    return line;
  });

  const totals = keys.map(() => '');
  totals[at('length')] = 'TOTAL PER PHASE';
  totals[at('R')] = kw(total.R);
  totals[at('Y')] = kw(total.Y);
  totals[at('B')] = kw(total.B);
  totals[at('tcl')] = kw(sum(total));
  totals[at('mdl')] = kw(sum(total) * df);
  (['1-PH', '3-PH', 'CT'] as MeterType[]).forEach((m) => (totals[at(m)] = meters[m] ? String(meters[m]) : ''));

  const editable = (y: number, x: number): boolean => {
    const row = rows[y];
    const k = keys[x];
    if (!row || !k || row.type === 'label' || row.type === 'spare') return false;
    if (['sptp', 'R', 'Y', 'B', 'tcl', 'mdl'].includes(k)) return false;
    if (row.type === 'incomer') {
      if (row.feeder) return k !== 'name';
      return ['ACB', 'MCCB', 'ISOL', 'fault', 'cores', 'ecc', '1-PH', '3-PH', 'CT'].includes(k);
    }
    return k !== 'name' || !row.toBoard; // a panel's name is the board's
  };

  const styles: Record<string, string> = {};
  rows.forEach((row, y) => keys.forEach((k, x) => {
    const name = cellName(x, y);
    if (row.type === 'label') styles[name] = STYLE.label;
    else if (row.type === 'spare') styles[name] = STYLE.muted;
    else styles[name] = editable(y, x) ? STYLE.input : STYLE.calc;
    if (row.type === 'incomer' && k === 'name') styles[name] += ';font-weight:700';
  }));

  const kids = outgoing.filter((f) => f.feedsBoardId).map((f) => f.feedsBoardId!);
  const supplyName = upstream ? upstream.id : board.supply?.fedFrom ? `${board.supply.fedFrom} METER CABINET` : 'DEWA METER CABINET';
  const info = project.info ?? {};
  const groups = [
    { title: '', colspan: 2 },
    { title: 'RATING (AMPS)', colspan: 3 },
    { title: '', colspan: 1 },
    { title: 'CABLE SIZE, TYPE & No.OF CORES', colspan: 3 },
    { title: '', colspan: 2 },
    { title: 'CONNECTED LOAD kW', colspan: 3 },
    { title: '', colspan: 2 },
    { title: 'PROPOSED TYPE & No OF kWh METER', colspan: 3 },
    { title: '', colspan: 1 }
  ];

  const sheet: MdSheet = {
    board,
    keys,
    rows,
    data,
    merges,
    groups,
    totals,
    styles,
    editable,
    freezeColumns: 1,
    cols: keys.map((k) => ({
      title: titles[k],
      width: widths[k] ?? 58,
      input: true,
      align: k === 'name' || k === 'remarks' ? 'left' : 'center',
      wrap: k === 'name' || k === 'remarks',
      source: k === 'size' ? undefined : k === 'ecc' ? sizes : k === 'cores' ? ['2C', '3C', '4C'] : k === 'type' ? CABLE_TYPES : ['ACB', 'MCCB', 'ISOL'].includes(k) ? ratings : undefined
    })),
    shape: JSON.stringify([keys, rows.map((r) => (r.type === 'feeder' ? r.feeder.id : r.type)), merges]),
    form: {
      title: 'DETAILS OF CONNECTED LOAD, MAXIMUM DEMAND & kWh METERING',
      project: project.name,
      area: info.area ?? '',
      completion: info.plannedCompletion ?? '',
      owner: info.owner ?? '',
      consultant: info.consultant ?? '',
      plotNo: info.plotNo ?? '',
      boardLine: `${board.id} (FED FROM ${upstream ? upstream.id : board.supply?.fedFrom ?? 'DEWA'})`,
      location: board.location ?? '',
      connectedTo: [`${board.kind ?? (upstream ? 'SMDB' : 'MDB')} CONNECTED TO: ${supplyName}`, ...(kids.length ? [`DB's CONNECTED TO: ${board.id}`] : [])],
      demandFactor: df,
      maxDemandKw: sum(total) * df,
      totalConnectedKw: sum(total),
      builtUpArea: builtUpAreaOf(project) ? String(builtUpAreaOf(project)) : '',
      contractor: info.contractor ?? '',
      tel: info.tel ?? '',
      fax: info.fax ?? ''
    }
  };
  return sheet;
}

/** Applies typed or pasted values: ratings, fault duty, cable, meter and
 * remarks go to the feeder (or the board's supply for an authority-fed
 * incomer). Loads are never typed here — they come from below. */
export function applyMdEdits(project: Project, sheet: MdSheet, edits: SheetEdit[]): { project: Project; rejected: string[] } {
  const rejected: string[] = [];
  const feederPatch = new Map<string, Partial<Feeder>>();
  let supply = sheet.board.supply ? { ...sheet.board.supply } : undefined;
  let supplyTouched = false;
  const cell = (e: SheetEdit) => cellName(e.x, e.y);
  const sizes = new Set(cables().map((c) => c.csaMm2));

  for (const e of edits) {
    if (!sheet.editable(e.y, e.x)) continue;
    const row = sheet.rows[e.y];
    const k = sheet.keys[e.x];
    const v = String(e.value ?? '').trim();
    const f = row.type === 'feeder' ? row.feeder : row.type === 'incomer' ? row.feeder : undefined;
    const bad = (what: string) => rejected.push(`${cell(e)}: "${v}" is not ${what}`);

    if (!f) {
      // Authority supply of this board (incomer row with no upstream feeder).
      supply = { ...supply };
      supplyTouched = true;
      if (k === 'ACB' || k === 'MCCB' || k === 'ISOL') {
        if (v === '') continue;
        const n = parsePositive(v);
        if (n === null) { bad('a rating in amps'); continue; }
        supply.device = k;
        supply.ratingA = n;
      } else if (k === 'fault') {
        const n = v === '' ? undefined : parsePositive(v);
        if (n === null) { bad('a fault duty in kA'); continue; }
        supply.faultKa = n;
      } else if (k === 'cores') supply.cable = v || undefined;
      else if (k === 'ecc') supply.ecc = v || undefined;
      else if (k === '1-PH' || k === '3-PH' || k === 'CT') {
        const n = parseCount(v);
        if (n === null) { bad('a number of meters'); continue; }
        if (n > 0) supply.meter = k;
        else if (supply.meter === k) supply.meter = undefined;
      }
      continue;
    }

    const patch = feederPatch.get(f.id) ?? {};
    if (k === 'ACB' || k === 'MCCB' || k === 'ISOL') {
      if (v === '') continue; // clearing one device column doesn't remove the breaker
      const n = parsePositive(v);
      if (n === null) { bad('a rating in amps'); continue; }
      patch.device = k;
      patch.breakerRatingA = n;
    } else if (k === 'fault') {
      const n = parsePositive(v);
      if (n === null) { bad('a fault duty in kA'); continue; }
      patch.breakerIcuKa = n;
    } else if (k === 'cores') {
      const n = Number(v.replace(/c$/i, ''));
      if (![2, 3, 4].includes(n)) { bad('2C, 3C or 4C'); continue; }
      patch.cores = n as 2 | 3 | 4;
    } else if (k === 'type') patch.cableType = v || undefined;
    else if (k === 'size' || k === 'ecc') {
      if (k === 'ecc' && v === '') { patch.cpcMm2 = undefined; feederPatch.set(f.id, patch); continue; }
      // "2x240" = two 240 mm² cables in parallel
      const runs = k === 'size' ? v.match(/^(\d+)\s*[x×]\s*(.+)$/) : null;
      if (runs) patch.parallel = Number(runs[1]) > 1 ? Number(runs[1]) : undefined;
      const n = parsePositive(runs ? runs[2] : v);
      if (n === null || !sizes.has(n)) { bad('a cable size from the cable table'); continue; }
      if (k === 'size') patch.cableCsaMm2 = n;
      else patch.cpcMm2 = n;
    } else if (k === 'length') {
      const n = parsePositive(v);
      if (n === null) { bad('a length in metres'); continue; }
      patch.lengthM = n;
    } else if (k === '1-PH' || k === '3-PH' || k === 'CT') {
      const n = parseCount(v);
      if (n === null) { bad('a number of meters'); continue; }
      if (n > 0) patch.kwhMeter = k;
      else if ((patch.kwhMeter ?? f.kwhMeter) === k) patch.kwhMeter = undefined;
    } else if (k === 'remarks') patch.remarks = v || undefined;
    else if (k === 'name') patch.name = v || f.id;
    feederPatch.set(f.id, patch);
  }

  let p = project;
  if (feederPatch.size) {
    p = {
      ...p,
      feeders: p.feeders.map((f) => {
        const patch = feederPatch.get(f.id);
        if (!patch) return f;
        const next: Feeder = { ...f, ...patch };
        for (const key of Object.keys(patch) as (keyof Feeder)[]) if (patch[key] === undefined) delete next[key];
        return next;
      })
    };
  }
  if (supplyTouched) p = { ...p, boards: p.boards.map((b) => (b.id === sheet.board.id ? { ...b, supply } : b)) };
  return { project: p, rejected };
}
