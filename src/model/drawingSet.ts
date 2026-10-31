import type { Board, Feeder, Project } from '../types';
import { boardsInSupplyOrder, boardSummary, boardTotals } from '../calc/summary';
import { earthingLayout } from './earthingPlan';
import { boardEarth } from './boardEarth';
import { subtree } from '../calc/pfc';
import { SHEET_MM } from '../docs/sldSheet';
import { boardsWithoutLevel } from './levels';
import type { SheetMarkup } from './sheetMarkup';
import type { SheetItems } from './sheetChanges';
import { earthSheetTitles } from './earthRiser';
import { dbRiserTitles } from './dbRiser';
import { pushLibrary } from '../database/librarySync';

/** The SLD as a set of sheets. Each sheet shows the panels ticked for it
 * (DBs as a box with their circuit count and kW — their final circuits are
 * on the load schedule), or one DB's own circuit diagram. Feeders to a panel
 * on another sheet end in "to X — sheet N". The size is chosen from what's
 * drawn: the smallest of A4…A1 that keeps the text readable. */

export type SheetSize = 'A4' | 'A3' | 'A3 portrait' | 'A2' | 'A1';
export interface DrawingSheet {
  id: string;
  number: string; // e.g. E-SLD-002
  title: string; // e.g. SLD — MDB-1
  kind: 'system' | 'board' | 'riser' | 'earthing' | 'earthRiser' | 'earthFloor' | 'plan'; // board = one DB's circuit diagram; riser = a building's riser diagram; earthing = earthing schematic; earthRiser = a building's earthing riser diagram; earthFloor = DB earthing of one floor (or typical floors); plan = a level's lighting, power or ELV layout (src/docs/planLayout.ts)
  buildingId?: string; // riser, earth riser, floor earthing and plan sheets
  levelId?: string; // plan sheets
  plan?: PlanType; // plan sheets
  part?: number; // earth riser: sheet of the riser (0 = bottom); floor earthing: floor group (0 = lowest); plan: part of a level split over sheets (0 = top left)
  riserStyle?: 'feeders' | 'byLevel'; // riser sheets: feeders = one breaker and cable per board from its panel's busbar; byLevel = boards counted per level, typical floors on one row, over several sheets (blank = busbar trunking / cable chain)
  boards: string[];
  size: 'auto' | SheetSize;
  // Title block of this sheet (blank = the project's, managed in the drawing register)
  status?: string; // e.g. FOR APPROVAL, IFC, AS-BUILT
  rev?: string; // blank = the project's current revision
  date?: string;
  drawnBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  scale?: string; // default NTS
  remarks?: string; // register only
  history?: SheetRev[]; // this sheet's issued revisions, oldest first
  // This sheet only (blank = the set's / project's):
  cableLabels?: 'auto' | 'ref' | 'full';
  tags?: import('../diagram/annotations').ResultLayers; // values printed (a "view": e.g. fault levels sheet)
  notes?: string[]; // notes on this sheet only
  clouds?: SheetCloud[]; // revision clouds around panels
  issuedHash?: string; // what was drawn when last issued (to flag changes since)
  issuedHashV?: number; // fingerprint version of issuedHash (blank = 1, before calculated values were included)
  issuedItems?: SheetItems; // system sheets: each panel and circuit as drawn when last issued (for Cloud the changes)
  arrows?: SheetArrow[]; // callouts with a leader arrow, on this sheet only
  markups?: SheetMarkup[]; // free markups drawn on the sheet (clouds, notes, callouts …), in paper mm
}
/** A callout: text with a leader arrow pointing at a panel or a circuit. */
export interface SheetArrow { target: string; text: string; dir: 'ne' | 'nw' | 'se' | 'sw'; len?: number } // target: board id, or "f:" + feeder id
/** A revision cloud around panels, or around circuits (feeder ids), on one sheet, with its revision triangle. */
export interface SheetCloud { boards: string[]; feeders?: string[]; rev: string }
/** One issued revision of a sheet (printed in its title block revision table). */
export interface SheetRev { rev: string; date: string; description: string; issueId?: string }
/** One issue of drawings (a transmittal): which sheets, at which revision, why. */
export interface DrawingIssue {
  id: string; // T-001
  date: string;
  purpose: string; // e.g. FOR APPROVAL
  description: string;
  to?: string; // recipient, e.g. DEWA
  sheets: { id: string; number: string; title: string; rev: string }[];
}
export interface DrawingSet {
  prefix: string; // E-SLD-
  sheets: DrawingSheet[];
  register?: boolean; // a drawing register as the first page
  /** Result values printed on the sheets (else SHEET_LAYERS). */
  tags?: import('../diagram/annotations').ResultLayers;
  /** Numbers typed by hand: renumbering fills blanks only. */
  manualNumbers?: boolean;
  start?: number; // first number (default 1)
  digits?: number; // zero padding (default 3)
  suffix?: string; // after the number, e.g. "-EL"
  /** DB riser by level: floor keys where a new sheet starts, per building. */
  riserBreaks?: Record<string, string[]>;
  riserPrefix?: string; // riser diagram sheets have their own sequence (default E-RSR-)
  earthPrefix?: string; // earthing schematic sheets (default E-ERT-)
  dbPrefix?: string; // board sheets (Design ▸ Board ▸ Export sheets), one per board (default E-DB-)
  status?: string; // default status of every sheet
  issues?: DrawingIssue[]; // transmittals, oldest first
}

export const SHEET_STATUSES = ['FOR CONCEPT REVIEW', 'FOR SCHEMATIC REVIEW', 'FOR APPROVAL', 'FOR AUTHORITY SUBMISSION', 'FOR TENDER', 'FOR CONSTRUCTION', 'AS-BUILT', 'PRELIMINARY'];

/** The papers offered on a sheet, with what each is called. */
export const PAPERS: { size: SheetSize; label: string }[] = [{ size: 'A4', label: 'A4 landscape' }, { size: 'A3', label: 'A3 landscape' }, { size: 'A3 portrait', label: 'A3 portrait' }, { size: 'A2', label: 'A2 landscape' }, { size: 'A1', label: 'A1 landscape' }];
export const setOf = (p: Project): DrawingSet => p.drawingSet ?? { prefix: 'E-SLD-', sheets: [], register: true };
export const RISER_PREFIX = 'E-RSR-';
export const EARTH_PREFIX = 'E-ERT-';
export const DB_PREFIX = 'E-DB-';
export type PlanType = 'lighting' | 'power' | 'elv';
/** Plan sheets count in their own sequence per layout: E-LTG-001, E-PWR-001, E-ELV-001 … */
export const PLAN_PREFIX: Record<PlanType, string> = { lighting: 'E-LTG-', power: 'E-PWR-', elv: 'E-ELV-' };
export const sheetNumber = (set: DrawingSet, i: number, prefix = set.prefix) => `${prefix}${String((set.start ?? 1) + i).padStart(set.digits ?? 3, '0')}${set.suffix ?? ''}`;
/** Numbers in order (prefix, start, digits, suffix); riser sheets count in
 * their own sequence (E-RSR-001 …). With manual numbers only blanks are filled. */
export const renumber = (set: DrawingSet, force = false): DrawingSet => {
  let sld = 0, rsr = 0, ert = 0;
  const plans: Record<PlanType, number> = { lighting: 0, power: 0, elv: 0 };
  return {
    ...set,
    sheets: set.sheets.map((s) => {
      const n = s.kind === 'plan' ? sheetNumber(set, plans[s.plan ?? 'lighting']++, PLAN_PREFIX[s.plan ?? 'lighting']) : s.kind === 'riser' ? sheetNumber(set, rsr++, set.riserPrefix ?? RISER_PREFIX) : s.kind === 'earthing' || s.kind === 'earthRiser' || s.kind === 'earthFloor' ? sheetNumber(set, ert++, set.earthPrefix ?? EARTH_PREFIX) : sheetNumber(set, sld++);
      return { ...s, number: set.manualNumbers && !force && s.number ? s.number : n };
    })
  };
};
/** A sheet that has something to draw. */
export const drawable = (s: DrawingSheet) => (s.kind === 'earthing' ? true : s.kind === 'plan' ? !!(s.plan && s.buildingId && s.levelId) : s.kind === 'riser' || s.kind === 'earthRiser' || s.kind === 'earthFloor' ? !!s.buildingId : s.boards.length > 0);
/** A new sheet starts PRELIMINARY unless the set has a status of its own (sheets without one follow the set). */
export const startStatus = (set: DrawingSet) => (set.status ? undefined : 'PRELIMINARY');
/** The earthing schematic sheet (one per project). */
export function addEarthingSheet(set: DrawingSet): { set: DrawingSet; id: string } {
  const id = `sh-${Date.now().toString(36)}`;
  return { id, set: renumber({ ...set, sheets: [...set.sheets, { id, number: '', title: 'Earthing schematic diagram', kind: 'earthing', boards: [], size: 'auto', status: startStatus(set) }] }) };
}
/** What publishing a sheet would issue (the ribbon's Publish): its first revision, or the next once it changed since
 * its last issue. */
export function publishState(project: Project, set: DrawingSet, s: DrawingSheet, projectRev?: string): { label: string; title: string; changed: boolean } {
  const cur = sheetRev(s, projectRev), issued = !!(s.history?.length || s.rev);
  const changed = !!s.issuedHash && s.issuedHash !== sheetHash(project, set, s);
  const next = issued ? nextRev(cur) : cur || 'A';
  return {
    changed,
    label: !s.history?.length || changed ? `Rev ${next}…` : '',
    title: !s.history?.length ? `Not issued yet — issuing gives this sheet Rev ${next}`
      : changed ? `Changed since Rev ${cur} was issued — the next issue is Rev ${next}` : `No changes since Rev ${cur} was issued — exports and the issue register`
  };
}

/** The earthing schematic, or a building's earth riser / floor earthing sheet `part`, for the earthing screen's Sheets
 * button: from the set, else added (every sheet of that kind for the building). No id when there is nothing to draw. */
export function earthSheetFor(set: DrawingSet, project: Project, kind: 'earthing' | 'earthRiser' | 'earthFloor', buildingId?: string, part = 0): { set: DrawingSet; id?: string } {
  const find = (x: DrawingSet) => x.sheets.find((s) => s.kind === kind && (kind === 'earthing' || (s.buildingId === buildingId && (s.part ?? 0) === part)))?.id;
  if (find(set)) return { set, id: find(set) };
  if (kind !== 'earthing' && !buildingId) return { set };
  const next = kind === 'earthing' ? addEarthingSheet(set).set : addEarthRiserSheet(set, project, buildingId!, kind).set;
  return { set: next, id: find(next) };
}
/** A riser diagram sheet for a building. */
export function addRiserSheet(set: DrawingSet, buildingId: string, buildingName: string, riserStyle?: 'feeders'): { set: DrawingSet; id: string } {
  const id = `sh-${Date.now().toString(36)}`;
  return { id, set: renumber({ ...set, sheets: [...set.sheets, { id, number: '', title: `${riserStyle ? 'Riser schematic' : 'Riser diagram'} — ${buildingName}`, kind: 'riser', buildingId, ...(riserStyle ? { riserStyle } : {}), boards: [], size: 'auto', status: startStatus(set) }] }) };
}
/** A building's DB riser by level (every sheet of it). Sheets already in the set are kept; missing ones are added after them. Returns the first sheet. */
export function addDbRiserSheets(set: DrawingSet, project: Project, buildingId: string): { set: DrawingSet; id: string } {
  const titles = dbRiserTitles({ ...project, drawingSet: set }, buildingId);
  const isOurs = (x: DrawingSheet) => x.kind === 'riser' && x.riserStyle === 'byLevel' && x.buildingId === buildingId;
  const sheets = set.sheets.map((x) => (isOurs(x) && titles[x.part ?? 0] ? { ...x, title: titles[x.part ?? 0] } : x));
  const base = `sh-${Date.now().toString(36)}`;
  let first = sheets.find((x) => isOurs(x) && (x.part ?? 0) === 0)?.id;
  titles.forEach((title, part) => {
    if (sheets.some((x) => isOurs(x) && (x.part ?? 0) === part)) return;
    let id = `${base}-d${part}`;
    for (let n = 2; sheets.some((x) => x.id === id); n++) id = `${base}-d${part}-${n}`;
    const after = sheets.reduce((at, x, i) => (isOurs(x) && (x.part ?? 0) < part ? i : at), -1);
    sheets.splice(after >= 0 ? after + 1 : sheets.length, 0, { id, number: '', title, kind: 'riser', buildingId, riserStyle: 'byLevel', part, boards: [], size: 'auto', status: startStatus(set) });
    first ??= id;
  });
  return { id: first ?? '', set: renumber({ ...set, sheets }) };
}
/** Start a new DB riser sheet at the row holding this floor, or take that break out. */
export function toggleRiserBreak(set: DrawingSet, buildingId: string, floorKeys: string[]): DrawingSet {
  const had = set.riserBreaks?.[buildingId] ?? [];
  const on = floorKeys.some((k) => had.includes(k));
  const next = on ? had.filter((k) => !floorKeys.includes(k)) : [...had, floorKeys[0]];
  return { ...set, riserBreaks: { ...set.riserBreaks, [buildingId]: next } };
}
/** A building's earthing riser diagram (every sheet of it), or its floor earthing sheets (one per floor
 * or typical floor group), numbered with the earthing sheets. Sheets already in the set are kept; missing
 * ones are added after them. Returns the first sheet of the kind. */
export function addEarthRiserSheet(set: DrawingSet, project: Project, buildingId: string, kind: 'earthRiser' | 'earthFloor' = 'earthRiser'): { set: DrawingSet; id: string } {
  const t = earthSheetTitles(project, buildingId), titles = kind === 'earthRiser' ? t.riser : t.floors;
  const have = set.sheets.filter((x) => x.kind === kind && x.buildingId === buildingId);
  const sheets = [...set.sheets];
  const base = `sh-${Date.now().toString(36)}`;
  let first = have.find((x) => (x.part ?? 0) === 0)?.id;
  titles.forEach((title, part) => {
    if (have.some((x) => (x.part ?? 0) === part)) return;
    let id = `${base}-${kind === 'earthRiser' ? 'r' : 'f'}${part}`;
    for (let n = 2; sheets.some((x) => x.id === id); n++) id = `${base}-${kind === 'earthRiser' ? 'r' : 'f'}${part}-${n}`;
    // After the last sheet of this building and kind, in part order.
    const after = sheets.reduce((at, x, i) => (x.kind === kind && x.buildingId === buildingId && (x.part ?? 0) < part ? i : at), -1);
    const at = after >= 0 ? after + 1 : sheets.length;
    sheets.splice(at, 0, { id, number: '', title, kind, buildingId, part, boards: [], size: 'auto', status: startStatus(set) });
    first ??= id;
  });
  return { id: first ?? '', set: renumber({ ...set, sheets }) };
}

/** Earth riser and floor earthing sheets that no longer match the building: a sheet missing or one too many. */
export function earthSheetGaps(p: Project, set: DrawingSet): { buildingId: string; kind: 'earthRiser' | 'earthFloor'; need: number; have: number }[] {
  const out: ReturnType<typeof earthSheetGaps> = [];
  for (const kind of ['earthRiser', 'earthFloor'] as const) {
    const ids = [...new Set(set.sheets.filter((s) => s.kind === kind && s.buildingId).map((s) => s.buildingId!))];
    for (const buildingId of ids) {
      if (!p.building?.buildings.some((b) => b.id === buildingId)) continue;
      const t = earthSheetTitles(p, buildingId), need = (kind === 'earthRiser' ? t.riser : t.floors).length;
      const parts = new Set(set.sheets.filter((s) => s.kind === kind && s.buildingId === buildingId).map((s) => s.part ?? 0));
      const have = [...parts].filter((x) => x < need).length;
      if (have !== need || parts.size !== have) out.push({ buildingId, kind, need, have: parts.size });
    }
  }
  return out;
}

const isDb = (b: Board) => (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')) === 'DB';

/** Automatic sets. perMdb: an overview (when there are several MDBs) and one
 * sheet per MDB with everything it feeds. perSmdb: an overview of the MDBs
 * and SMDBs, then a sheet per SMDB / MCC with its DBs. dbSheets: also a
 * circuit diagram sheet for every DB. */
export function autoSheets(p: Project, mode: 'perMdb' | 'perSmdb', dbSheets = false, prefix = 'E-SLD-'): DrawingSet {
  const order = boardsInSupplyOrder(p);
  const mains = order.filter((b) => !b.upstreamId);
  const sheets: Omit<DrawingSheet, 'number'>[] = [];
  const id = () => `sh-${Math.random().toString(36).slice(2, 8)}`;
  if (mode === 'perMdb') {
    if (mains.length > 1) sheets.push({ id: id(), title: 'SLD — overall (main boards and sub-mains)', kind: 'system', boards: order.filter((b) => !isDb(b)).map((b) => b.id), size: 'auto' });
    for (const m of mains) sheets.push({ id: id(), title: `SLD — ${m.id}`, kind: 'system', boards: order.filter((b) => subtree(p, m.id).has(b.id)).map((b) => b.id), size: 'auto' });
  } else {
    const subs = order.filter((b) => b.upstreamId && mains.some((m) => m.id === b.upstreamId) && !isDb(b));
    sheets.push({ id: id(), title: 'SLD — main boards and sub-mains', kind: 'system', boards: [...mains, ...subs].map((b) => b.id), size: 'auto' });
    for (const s of subs) {
      const below = order.filter((b) => subtree(p, s.id).has(b.id));
      if (below.length > 1) sheets.push({ id: id(), title: `SLD — ${s.id}`, kind: 'system', boards: below.map((b) => b.id), size: 'auto' });
    }
  }
  if (dbSheets) for (const b of order.filter((x) => isDb(x) && p.feeders.some((f) => f.boardId === x.id))) sheets.push({ id: id(), title: `${b.id} — circuit diagram`, kind: 'board', boards: [b.id], size: 'auto' });
  // The earthing schematic goes with the SLDs whenever there is a main board to earth.
  if (mains.length) sheets.push({ id: id(), title: 'Earthing schematic diagram', kind: 'earthing', boards: [], size: 'auto' });
  return renumber({ prefix, register: true, sheets: sheets.map((s) => ({ ...s, number: '' })) });
}

/** Sheets of at most n panels each (authority submissions: e.g. 10 per
 * sheet), in supply order, keeping each panel's branch together where it
 * fits: a sub-main's branch starts a new sheet rather than being split. */
export function sheetsByCount(p: Project, n: number, prefix = 'E-SLD-'): DrawingSet {
  const max = Math.max(1, Math.round(n));
  const order = boardsInSupplyOrder(p);
  const sheets: string[][] = [[]];
  const size = (id: string) => order.filter((b) => subtree(p, id).has(b.id)).length;
  for (const b of order) {
    const cur = sheets[sheets.length - 1];
    // A panel whose whole branch fits on a fresh sheet but not on this one starts a new sheet.
    const branch = size(b.id);
    const parentHere = !!b.upstreamId && cur.includes(b.upstreamId);
    const startNew = cur.length >= max || (cur.length > 0 && branch > 1 && branch <= max && cur.length + branch > max && !(parentHere && cur.length + 1 <= max && branch > max));
    if (startNew) sheets.push([b.id]);
    else cur.push(b.id);
  }
  const list = sheets.filter((x) => x.length);
  return renumber({
    prefix, register: true,
    sheets: list.map((boards, i) => ({ id: `sh-${Math.random().toString(36).slice(2, 8)}`, number: '', title: `SLD — ${boards[0]}${boards.length > 1 ? ` to ${boards[boards.length - 1]}` : ''}${list.length > 1 ? ` (${i + 1} of ${list.length})` : ''}`, kind: 'system' as const, boards, size: 'auto' as const }))
  });
}

/** Where each board is drawn in full (its first system sheet, or its DB sheet). */
export function sheetOfBoard(set: DrawingSet): Map<string, DrawingSheet> {
  const m = new Map<string, DrawingSheet>();
  for (const s of set.sheets) if (s.kind === 'system') for (const b of s.boards) if (!m.has(b)) m.set(b, s);
  return m;
}

/** Cross-sheet references of a system sheet, both ways: outgoing ways to
 * panels drawn elsewhere ("To X — sheet N") and panels on this sheet fed
 * from a panel drawn elsewhere ("From X — sheet N"). `sheet` is undefined
 * when the other panel is on no sheet (a broken reference). Numbers are read
 * from the set each time, so renumbering updates every reference. */
export interface SheetRef { boardId: string; feederId?: string; sheet?: DrawingSheet }
export function sheetRefs(p: Project, set: DrawingSet, sheet: DrawingSheet): { outgoing: SheetRef[]; incoming: SheetRef[] } {
  if (sheet.kind !== 'system') return { outgoing: [], incoming: [] };
  const ids = new Set(sheet.boards);
  const where = sheetOfBoard(set);
  const outgoing = p.feeders.filter((f) => ids.has(f.boardId) && f.feedsBoardId && !ids.has(f.feedsBoardId))
    .map((f) => ({ boardId: f.feedsBoardId!, feederId: f.id, sheet: where.get(f.feedsBoardId!) }));
  const incoming = p.boards.filter((b) => ids.has(b.id) && b.upstreamId && !ids.has(b.upstreamId))
    .map((b) => ({ boardId: b.upstreamId!, feederId: p.feeders.find((f) => f.boardId === b.upstreamId && f.feedsBoardId === b.id)?.id, sheet: where.get(b.upstreamId!) }));
  return { outgoing, incoming };
}

/** "From X — sheet N" for each panel on this sheet fed from another sheet (keyed by the fed panel). */
export function fromSheetLabels(p: Project, set: DrawingSet, sheet: DrawingSheet): Record<string, string> {
  const out: Record<string, string> = {};
  const ids = new Set(sheet.boards);
  const where = sheetOfBoard(set);
  for (const b of p.boards) if (ids.has(b.id) && b.upstreamId && !ids.has(b.upstreamId)) { const o = where.get(b.upstreamId); if (o) out[b.id] = o.number; }
  return out;
}

/** The project as drawn on one system sheet: its panels only; a feeder to a
 * panel drawn elsewhere becomes an outgoing way "to X — sheet N". */
export function sheetProject(p: Project, set: DrawingSet, sheet: DrawingSheet): Project {
  const ids = new Set(sheet.boards);
  const where = sheetOfBoard(set);
  const feeders: Feeder[] = p.feeders.filter((f) => ids.has(f.boardId)).map((f) => {
    if (!f.feedsBoardId || ids.has(f.feedsBoardId)) return f;
    const other = where.get(f.feedsBoardId);
    const t = boardTotals(p, f.feedsBoardId);
    const { feedsBoardId: _x, ...rest } = f;
    return { ...rest, name: `To ${f.feedsBoardId}${other ? ` — sheet ${other.number}` : ''}`, loadType: 'general', loadKw: t.connectedKw, demandFactor: t.connectedKw > 0 ? t.demandKw / t.connectedKw : 1, powerFactor: t.demandKw ? t.demandKw / Math.max(t.demandKw, Math.hypot(t.demandKw, t.demandKvar)) : 0.9 };
  });
  return {
    ...p,
    boards: p.boards.filter((b) => ids.has(b.id)),
    feeders,
    ties: (p.ties ?? []).filter((t) => ids.has(t.a) && ids.has(t.b))
  };
}

/** Smallest sheet on which the drawing stays readable (text ≥ ≈ 2 mm):
 * drawing area = sheet − frame (30 × 20 mm) − title block band (48 mm). */
export const MIN_MM_PER_PX = 0.2;
/** Drawing scale (mm per px) on a paper size; reserveW = width taken by the
 * legend column (mm). */
export function scaleOn(size: SheetSize, widthPx: number, heightPx: number, reserveW = 0): number {
  const { w, h } = SHEET_MM[size];
  return Math.min((w - 36 - reserveW) / widthPx, (h - 20 - 48) / heightPx);
}
/** Room kept for the legend column (legend, cable schedule, abbreviations). */
export const LEGEND_RESERVE_MM = 80;
/** A DB riser's side column: wide enough for its legend, abbreviations and board summary. */
export const RISER_SIDE_MM = 62;
/** Auto paper: standard A3 landscape, or A3 portrait for a drawing taller than wide, scaled down as far as it stays
 * readable; only then larger paper. Never smaller than A3 (A4 stays a choice on the sheet). */
export function autoSize(widthPx: number, heightPx: number, reserveW = 0): { size: SheetSize; scale: number; fits: boolean } {
  for (const size of [heightPx > widthPx ? 'A3 portrait' : 'A3', 'A2', 'A1'] as SheetSize[]) {
    const scale = scaleOn(size, widthPx, heightPx, reserveW);
    if (scale >= MIN_MM_PER_PX) return { size, scale, fits: true };
  }
  return { size: 'A1', scale: scaleOn('A1', widthPx, heightPx, reserveW), fits: false };
}

/** One sheet's line in the drawing register (src/docs/drawingRegister.ts). */
export interface RegisterRow { number: string; title: string; size: string; rev?: string; date?: string; status?: string }


/** Next revision: A→B, Z→AA, 0→1, P1→P2, C2→C3; blank → A. */
export function nextRev(r?: string): string {
  const v = (r ?? '').trim();
  if (!v || v === '—') return 'A';
  const m = v.match(/^(.*?)(\d+)$/);
  if (m) return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`;
  if (/^[A-Z]+$/i.test(v)) {
    const up = v === v.toUpperCase();
    const chars = v.toUpperCase().split('');
    let i = chars.length - 1;
    while (i >= 0 && chars[i] === 'Z') { chars[i] = 'A'; i--; }
    if (i < 0) chars.unshift('A'); else chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    const out = chars.join('');
    return up ? out : out.toLowerCase();
  }
  return `${v}1`;
}

/** Revision a sheet carries now: its own, else its last issue, else the project's. */
export const sheetRev = (s: DrawingSheet, projectRev?: string) => s.rev || s.history?.[s.history.length - 1]?.rev || projectRev || '';

export interface IssueInput { date: string; purpose: string; description: string; to?: string; bump: boolean }
/** Issues the chosen sheets: each moves to its next revision (when bump),
 * takes the date and purpose as its status, records the revision in its
 * history, and the set records a transmittal. */
export function issueSheets(set: DrawingSet, ids: string[], o: IssueInput, projectRev?: string, hashOf?: (s: DrawingSheet) => string, itemsOf?: (s: DrawingSheet) => SheetItems | undefined): { set: DrawingSet; issue: DrawingIssue } {
  const n = (set.issues ?? []).length + 1;
  const id = `T-${String(n).padStart(3, '0')}`;
  const chosen = new Set(ids);
  const sheets = set.sheets.map((s) => {
    if (!chosen.has(s.id)) return s;
    const cur = sheetRev(s, projectRev);
    const rev = o.bump && (s.history?.length || s.rev) ? nextRev(cur) : (cur || 'A');
    const items = itemsOf?.(s);
    return { ...s, rev, date: o.date, status: o.purpose || s.status, ...(hashOf ? { issuedHash: hashOf({ ...s, issuedHash: undefined, issuedHashV: undefined }), issuedHashV: SHEET_HASH_V } : {}), ...(items ? { issuedItems: items } : {}), history: [...(s.history ?? []), { rev, date: o.date, description: o.description || o.purpose, issueId: id }] };
  });
  const issue: DrawingIssue = {
    id, date: o.date, purpose: o.purpose, description: o.description, to: o.to || undefined,
    sheets: sheets.filter((s) => chosen.has(s.id)).map((s) => ({ id: s.id, number: s.number, title: s.title, rev: s.rev ?? '' }))
  };
  return { set: { ...set, sheets, issues: [...(set.issues ?? []), issue] }, issue };
}

/** Moves a sheet to a new position; automatic numbers follow the order. */
export function moveSheet(set: DrawingSet, from: number, to: number): DrawingSet {
  if (from === to || from < 0 || to < 0 || from >= set.sheets.length || to >= set.sheets.length) return set;
  const sheets = [...set.sheets];
  const [s] = sheets.splice(from, 1);
  sheets.splice(to, 0, s);
  return renumber({ ...set, sheets });
}

export type SheetType = 'sld' | 'db' | 'riser' | 'earthing' | 'plan';
export const sheetType = (s: DrawingSheet): SheetType => (s.kind === 'board' ? 'db' : s.kind === 'plan' ? 'plan' : s.kind === 'riser' ? 'riser' : s.kind === 'earthing' || s.kind === 'earthRiser' || s.kind === 'earthFloor' ? 'earthing' : 'sld');
export interface SheetFilter { q?: string; status?: string; rev?: string; type?: SheetType | '' }
export type SheetSort = { key: 'order' | 'number' | 'title' | 'status' | 'rev' | 'date'; desc?: boolean };

/** Sheets matching the filter (search in number, title, panels, remarks), sorted. */
export function filterSheets(set: DrawingSet, f: SheetFilter, sort: SheetSort = { key: 'order' }, projectRev?: string): DrawingSheet[] {
  const q = (f.q ?? '').trim().toLowerCase();
  const list = set.sheets.filter((s) => {
    if (f.type && sheetType(s) !== f.type) return false;
    if (f.status && (s.status || set.status || '') !== f.status) return false;
    if (f.rev && sheetRev(s, projectRev) !== f.rev) return false;
    if (q && ![s.number, s.title, s.remarks ?? '', ...s.boards].some((x) => x.toLowerCase().includes(q))) return false;
    return true;
  });
  if (sort.key === 'order') return sort.desc ? list.reverse() : list;
  const val = (s: DrawingSheet) => sort.key === 'status' ? (s.status || set.status || '') : sort.key === 'rev' ? sheetRev(s, projectRev) : String(s[sort.key as 'number' | 'title' | 'date'] ?? '');
  const out = [...list].sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true }));
  return sort.desc ? out.reverse() : out;
}

/** Colour of a status badge (thumbnails, register). */
export function statusColor(status?: string): string {
  const s = (status ?? '').toUpperCase();
  if (s.includes('CONSTRUCTION')) return '#15803d';
  if (s.includes('AS-BUILT') || s.includes('AS BUILT')) return '#0f766e';
  if (s.includes('APPROV') || s.includes('AUTHORITY')) return '#b45309';
  if (s.includes('TENDER')) return '#1d4ed8';
  if (s.includes('PRELIM')) return '#64748b';
  return s ? '#6d28d9' : '#94a3b8';
}



/** Fingerprint version: 2 adds the calculated values a sheet prints (TCL and demand on risers; the
 * earthing layout with pit tests; a DB's fault level, current and earthing path). A sheet keeps the
 * version it was issued with, so older issues are not flagged as changed by the new fields. */
export const SHEET_HASH_V = 2;

/** Calculated values a sheet shows that its inputs alone don't capture (fingerprint version 2). */
function shownValues(p: Project, s: DrawingSheet): unknown {
  const r = (v: number, d: number) => +v.toFixed(d);
  if (s.kind === 'riser') return p.boards.map((b) => { const t = boardTotals(p, b.id); return [b.id, r(t.connectedKw, 2), r(t.demandKw, 1)]; });
  if (s.kind === 'earthing') return [earthingLayout(p), p.boards.filter((b) => !b.upstreamId).map((b) => [b.id, b.substation, b.standby, b.kind])];
  if (s.kind === 'board') {
    const b = p.boards.find((x) => x.id === s.boards[0]);
    if (!b) return undefined;
    const sm = boardSummary(p, b), e = boardEarth(p, b);
    return [b.upstreamId && p.feeders.find((f) => f.feedsBoardId === b.id && f.boardId === b.upstreamId), r(sm.faultKA, 1), r(sm.currentA, 1), r(sm.voltagePct, 2), e.text, e.conductor?.text];
  }
  return undefined;
}

/** Fingerprint of what a sheet draws (its panels, their circuits and the
 * values on them) — compared with the one stored when it was issued. An
 * issued sheet is fingerprinted at the version it was issued with. */
export function sheetHash(p: Project, set: DrawingSet, s: DrawingSheet): string {
  const v = s.issuedHash ? s.issuedHashV ?? 1 : SHEET_HASH_V;
  const d = s.kind === 'board' ? { boards: p.boards.filter((b) => b.id === s.boards[0]), feeders: p.feeders.filter((f) => f.boardId === s.boards[0]) }
    : s.kind === 'earthing' ? { boards: p.boards.filter((b) => !b.upstreamId).map((b) => [b.id, b.sourceKva, b.rmu, b.vectorGroup]), feeders: [p.earthingPlan] }
    : s.kind === 'earthRiser' || s.kind === 'earthFloor' ? { boards: p.boards.map((b) => [b.id, b.upstreamId, b.level, b.kind, b.ratedCurrentA, ...(b.earthRiser ? [b.earthRiser] : [])]), feeders: [p.feeders.filter((f) => f.feedsBoardId).map((f) => [f.feedsBoardId, f.cores, f.cableCsaMm2, f.lengthM, f.cpcMm2]), p.earthingPlan, p.earthPitIds, p.building] }
    : s.kind === 'riser' ? { boards: p.boards.map((b) => [b.id, b.upstreamId, b.level, b.ratedCurrentA, b.sourceKva, b.standby, ...(s.riserStyle ? [b.kind, b.incomerDevice, b.busbarMaterial] : [])]), feeders: [p.feeders.filter((f) => f.feedsBoardId).map((f) => [f.feedsBoardId, f.cores, f.cableCsaMm2, f.lengthM, f.parallel, f.cableType, ...(s.riserStyle ? [f.breakerRatingA, f.breakerIcuKa, f.breakerType] : [])]), p.busRisers, p.building, s.riserStyle, ...(s.riserStyle === 'byLevel' ? [set.riserBreaks?.[s.buildingId ?? '']] : [])] }
    : sheetProject(p, set, s);
  const extra = v >= 2 ? shownValues(p, s) : undefined;
  const txt = JSON.stringify([d.boards, d.feeders, s.title, s.size, s.tags, s.notes, s.clouds, s.arrows, s.markups, ...(s.part !== undefined ? [s.part] : []), ...(extra !== undefined ? [extra] : [])]); // part / extra only where set: older sheets keep their hash
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export interface SheetCheck { level: 'bad' | 'warn'; text: string; sheetId?: string; boardId?: string }

/** Before publishing: panels on no sheet, empty sheets, missing title
 * block details, sheets changed since their last issue, failing circuits.
 * (Crowded sheets are found when the sheets are drawn.) */
export function sheetChecks(p: Project, set: DrawingSet, failing: { feederId: string; boardId: string; status: string }[] = []): SheetCheck[] {
  const out: SheetCheck[] = [];
  if (!set.sheets.length) return [{ level: 'bad', text: 'No sheets yet — add one with + or Split by panels.' }];
  const drawn = new Set(set.sheets.filter((s) => s.kind === 'system').flatMap((s) => s.boards));
  for (const b of p.boards) if (!drawn.has(b.id)) {
    const db = (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')) === 'DB';
    out.push({ level: db ? 'warn' : 'bad', text: db ? `${b.id} is on no sheet (shown only as an outgoing way “To ${b.id}”)` : `${b.id} is on no sheet`, boardId: b.id });
  }
  for (const s of set.sheets) if (!drawable(s)) out.push({ level: 'bad', text: `${s.number}: no panels on the sheet`, sheetId: s.id });
  const d = p.drawing ?? {}, info = p.info ?? {}, pp = p.params ?? {};
  const missing = [
    !(d.company || info.consultant) && 'company / consultant',
    !info.owner && 'owner / client',
    !(pp.drawnBy || d.drawnBy || set.sheets.every((s) => s.drawnBy)) && 'drawn by',
    !(pp.checkedBy || d.checkedBy || set.sheets.every((s) => s.checkedBy)) && 'checked by'
  ].filter(Boolean);
  if (missing.length) out.push({ level: 'warn', text: `Title block: ${missing.join(', ')} not filled in` });
  for (const s of set.sheets) if (s.issuedHash && s.issuedHash !== sheetHash(p, set, s)) out.push({ level: 'warn', text: `${s.number} changed since it was issued (Rev ${s.rev ?? '—'}) — issue a new revision`, sheetId: s.id });
  // Cross-sheet references that point nowhere. (A panel on an overview and its own sheet is normal;
  // references go to the first sheet that draws it.)
  for (const sh of set.sheets) {
    const { outgoing, incoming } = sheetRefs(p, set, sh);
    for (const r of outgoing) if (!r.sheet) out.push({ level: 'warn', text: `${sh.number}: “To ${r.boardId}” has no sheet to point to — ${r.boardId} is on no sheet`, sheetId: sh.id, boardId: r.boardId });
    for (const r of incoming) if (!r.sheet) out.push({ level: 'warn', text: `${sh.number}: “From ${r.boardId}” has no sheet to point to — ${r.boardId} is on no sheet`, sheetId: sh.id, boardId: r.boardId });
  }
  for (const buildingId of new Set(set.sheets.filter((s) => s.kind === 'riser' && s.riserStyle === 'byLevel' && s.buildingId).map((s) => s.buildingId!))) {
    const b = p.building?.buildings.find((x) => x.id === buildingId);
    if (!b) continue;
    const need = dbRiserTitles({ ...p, drawingSet: set }, buildingId).length;
    const parts = new Set(set.sheets.filter((s) => s.kind === 'riser' && s.riserStyle === 'byLevel' && s.buildingId === buildingId).map((s) => s.part ?? 0));
    if (parts.size !== need || [...parts].some((x) => x >= need)) out.push({ level: 'warn', text: `${b.name}: the DB riser now needs ${need} sheet(s), the set has ${parts.size} — add it again from Drawings to add the missing ones; remove extra sheets` });
  }
  for (const g of earthSheetGaps(p, set)) {
    const name = p.building?.buildings.find((b) => b.id === g.buildingId)?.name ?? g.buildingId, what = g.kind === 'earthRiser' ? 'earthing riser diagram' : 'floor earthing';
    out.push({ level: 'warn', text: `${name}: the ${what} now needs ${g.need} sheet(s), the set has ${g.have} — add it again from Drawings to add the missing ones; remove extra sheets` });
  }
  const noLevel = boardsWithoutLevel(p);
  if (noLevel.length) out.push({ level: 'warn', text: `${noLevel.length} panel(s) have no level (Building information): ${noLevel.slice(0, 6).map((b) => b.id).join(', ')}${noLevel.length > 6 ? ' …' : ''}`, boardId: noLevel[0].id });
  const onSheets = failing.filter((f) => drawn.has(f.boardId));
  const bad = onSheets.filter((f) => f.status === 'fail').length, warn = onSheets.filter((f) => f.status === 'warn').length;
  if (bad) out.push({ level: 'bad', text: `${bad} circuit(s) fail a check (cable, breaker or voltage drop) — they print in red` });
  if (warn) out.push({ level: 'warn', text: `${warn} circuit(s) need checking` });
  return out;
}

/** Sheet templates: paper size, cable text, values printed, notes, status,
 * scale — applied to new or existing sheets. Kept on this computer and in
 * the database Library.json. */
export interface SheetTemplate { id: string; name: string; size: DrawingSheet['size']; cableLabels?: DrawingSheet['cableLabels']; tags?: DrawingSheet['tags']; notes?: string[]; status?: string; scale?: string }
const TPL = 'lvds.sheetTemplates';
export function loadSheetTemplates(): SheetTemplate[] { try { return JSON.parse(localStorage.getItem(TPL) ?? '[]'); } catch { return []; } }
export function saveSheetTemplates(list: SheetTemplate[]): void {
  try { localStorage.setItem(TPL, JSON.stringify(list)); } catch { /* storage blocked */ }
  void pushLibrary();
}
export const templateFromSheet = (s: DrawingSheet, name: string): SheetTemplate => ({ id: `st-${Date.now().toString(36)}`, name, size: s.size, cableLabels: s.cableLabels, tags: s.tags, notes: s.notes, status: s.status, scale: s.scale });
export const applyTemplate = (s: DrawingSheet, t: SheetTemplate): DrawingSheet => ({ ...s, size: t.size, cableLabels: t.cableLabels, tags: t.tags, notes: t.notes, status: t.status ?? s.status, scale: t.scale ?? s.scale });

/** A new system sheet with these panels (e.g. a selected panel and its branch). */
export function addSheet(set: DrawingSet, boards: string[], title: string): { set: DrawingSet; id: string } {
  const id = `sh-${Date.now().toString(36)}`;
  return { id, set: renumber({ ...set, sheets: [...set.sheets, { id, number: '', title, kind: 'system', boards, size: 'auto', status: startStatus(set) }] }) };
}

/** Moves a panel to another sheet (Design: drag it into that sheet's
 * outline): off every other SLD sheet, onto this one in supply order. */
export function movePanelToSheet(set: DrawingSet, boardId: string, sheetId: string, supplyOrder: string[]): DrawingSet {
  return {
    ...set,
    sheets: set.sheets.map((s) => {
      if (s.kind !== 'system') return s;
      if (s.id === sheetId) return s.boards.includes(boardId) ? s : { ...s, boards: supplyOrder.filter((id) => id === boardId || s.boards.includes(id)) };
      return s.boards.includes(boardId) ? { ...s, boards: s.boards.filter((b) => b !== boardId) } : s;
    })
  };
}
