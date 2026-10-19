import type { Board, Feeder, Project } from '../types';
import { boardsInSupplyOrder } from '../calc/summary';
import { cpcOf } from '../calc/cableTable';
import { floorList, levelKey, type Floor } from './levels';
import { earthingLayout, type EarthLayout } from './earthingPlan';

/** Earth riser of one building: a floor earth bar (FEB, two test links) on
 * every floor of the electrical riser, one earth cable looping bar to bar up
 * the riser, and a cable from the LV room earth bar (the MEB of the main
 * board(s) feeding the building) to the bar of the LV room's floor. Each
 * panel's earth bar connects to its floor's FEB with a conductor the size of
 * its incoming CPC; a panel fed from another panel on the same floor (not the
 * main board) connects to that panel's earth bar instead (floor earthing
 * sheets). The MEB reaches the LV earth pits of the earthing schematic. */

export const DEFAULT_RISER_TAPE = '1C 95 mm² G/Y PVC earth cable';
export const DEFAULT_LV_ROOM_CABLE = '1C 150 mm² G/Y PVC earth cable';
export const DEFAULT_RISER_NAME = 'EL-A';
/** Levels drawn on one earth riser sheet (style 'sheets'). */
export const LEVELS_PER_SHEET = 20;
/** Fewest floors in a run that style 'typical' draws as one "typical" row. */
export const TYPICAL_MIN = 3;

export interface EarthRiserBoard {
  board: Board;
  /** The incoming feeder (from its upstream panel). */
  feeder?: Feeder;
  /** Conductor from this panel's earth bar: the incoming CPC (mm² Cu). */
  cpcMm2?: number;
  /** Panel whose earth bar this one connects to; absent = the floor earth bar. */
  toBoard?: string;
}
export interface EarthRiserFloor { floor: Floor; feb: string; boards: EarthRiserBoard[] }
export interface EarthRiserMain { board: Board; meb: string; pits: string[] }
export interface EarthRiserLayout {
  buildingId: string;
  buildingName: string;
  tape: string;
  lvRoomCable: string;
  riserName: string;
  style: 'sheets' | 'typical';
  /** Floor (key) whose bar the LV room cable lands on: the main board's level, else the lowest floor. */
  lvFloor?: string;
  /** Bottom to top; every floor of the building gets a FEB. */
  floors: EarthRiserFloor[];
  mains: EarthRiserMain[];
  /** Panels of the building tree without a level in this building (not drawn). */
  notOnLevel: string[];
  empty: boolean;
}

const mainOf = (byId: Map<string, Board>, b: Board): Board => {
  const seen = new Set<string>();
  let x = b;
  while (x.upstreamId && byId.has(x.upstreamId) && !seen.has(x.id)) { seen.add(x.id); x = byId.get(x.upstreamId)!; }
  return x;
};

export function earthRiserLayout(project: Project, buildingId: string, L: EarthLayout = earthingLayout(project)): EarthRiserLayout {
  const building = project.building?.buildings.find((b) => b.id === buildingId);
  const floors = floorList(project.building).filter((f) => f.buildingId === buildingId);
  const ep = project.earthingPlan;
  const tape = ep?.riserTape?.trim() || DEFAULT_RISER_TAPE;
  const riserName = ep?.riserName?.trim() || DEFAULT_RISER_NAME;
  const base = { buildingId, buildingName: building?.name ?? buildingId, tape, lvRoomCable: ep?.lvRoomCable?.trim() || DEFAULT_LV_ROOM_CABLE, riserName, style: ep?.riserStyle ?? 'sheets' as const };
  const feb = (f: Floor) => febTag(riserName, f);
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const order = boardsInSupplyOrder(project);
  const floorOf = new Map<string, Floor>();
  const keyed = new Map(floors.map((f) => [f.key, f]));
  for (const b of order) {
    const f = b.level?.building === buildingId ? keyed.get(levelKey(b.level)) : undefined;
    if (f) floorOf.set(b.id, f);
  }
  const placed = order.filter((b) => floorOf.has(b.id) && b.upstreamId);
  const mainIds = [...new Set(placed.map((b) => mainOf(byId, b).id))];
  const mains: EarthRiserMain[] = mainIds.map((id) => {
    const item = L.items.find((i) => i.key === `lv:${id}`);
    return { board: byId.get(id)!, meb: `MEB-${id}`, pits: item ? L.pits.filter((p) => p.itemKey === item.key).map((p) => p.id) : [] };
  });
  // Sub-boards that belong here but are not on one of its floors: a level that no longer exists,
  // or no level while fed from a panel on a floor (a main board is drawn as its MEB).
  const notOnLevel = order.filter((b) => b.upstreamId && !floorOf.has(b.id)
    && (b.level?.building === buildingId || (!b.level && floorOf.has(b.upstreamId)))).map((b) => b.id);
  if (!floors.length || !placed.length) return { ...base, lvFloor: floors[0]?.key, floors: floors.map((floor) => ({ floor, feb: feb(floor), boards: [] })), mains, notOnLevel, empty: true };

  const rows: EarthRiserFloor[] = floors.map((floor) => ({ floor, feb: feb(floor), boards: [] }));
  const rowOf = new Map(rows.map((r) => [r.floor.key, r]));
  for (const b of placed) {
    const f = floorOf.get(b.id)!;
    const parent = byId.get(b.upstreamId!);
    const feeder = project.feeders.find((x) => x.feedsBoardId === b.id && x.boardId === b.upstreamId);
    const sameFloor = parent && parent.upstreamId && floorOf.get(parent.id)?.key === f.key;
    rowOf.get(f.key)!.boards.push({ board: b, feeder, cpcMm2: feeder ? cpcOf(feeder) : undefined, ...(sameFloor ? { toBoard: parent!.id } : {}) });
  }
  // Each panel right after the panel it is earthed through, so the conductors stay short.
  for (const r of rows) {
    const top = r.boards.filter((x) => !x.toBoard);
    const out: EarthRiserBoard[] = [];
    const add = (x: EarthRiserBoard) => { out.push(x); r.boards.filter((c) => c.toBoard === x.board.id).forEach(add); };
    top.forEach(add);
    r.boards = out;
  }
  const lvLevel = mains.map((m) => m.board.level).find((l) => l?.building === buildingId);
  const lvFloor = (lvLevel && keyed.get(levelKey(lvLevel))?.key) ?? floors[0]?.key;
  return { ...base, lvFloor, floors: rows, mains, notOnLevel, empty: false };
}

/** Level as printed on the riser: GROUND FLOOR, LEVEL-03, PODIUM LEVEL-02, BASEMENT-01, ROOF. */
export function levelLabel(f: Floor): string {
  const t = f.tag, n = (s: string) => String(Number(s)).padStart(2, '0');
  if (t === 'G') return 'GROUND FLOOR';
  if (t === 'R') return 'ROOF';
  if (/^L\d+$/.test(t)) return `LEVEL-${n(t.slice(1))}`;
  if (/^P\d+$/.test(t)) return `PODIUM LEVEL-${n(t.slice(1))}`;
  if (/^B\d+$/.test(t)) return `BASEMENT-${n(t.slice(1))}`;
  if (/^M\d+$/.test(t)) return `MEZZANINE-${n(t.slice(1))}`;
  return f.name.toUpperCase();
}
const shortTag = (f: Floor) => (f.tag === 'G' ? 'GF' : f.tag === 'R' ? 'RF' : f.tag);
/** Floor earth bar tag: EB-EL-A-GF, EB-EL-A-L03. */
export const febTag = (riser: string, f: Floor) => `EB-${riser}-${shortTag(f)}`;

/** What a floor's earthing looks like: the same for floors with the same panels (kind, CPC, connection). */
function floorSignature(r: EarthRiserFloor): string {
  const pos = new Map(r.boards.map((b, i) => [b.board.id, i]));
  return JSON.stringify([r.floor.ref.level, r.boards.map((b) => [b.board.kind ?? 'DB', b.cpcMm2 ?? 0, b.toBoard ? pos.get(b.toBoard) ?? -1 : -1])]);
}

/** Runs of consecutive floors with the same earthing (bottom to top). */
function runs(L: EarthRiserLayout): EarthRiserFloor[][] {
  const out: EarthRiserFloor[][] = [];
  let sig = '';
  for (const f of L.floors) {
    const s = floorSignature(f);
    if (out.length && s === sig && f.floor.key !== L.lvFloor && out[out.length - 1][0].floor.key !== L.lvFloor) out[out.length - 1].push(f);
    else { out.push([f]); sig = s; }
  }
  return out;
}

/** One drawn row of the riser: a floor, or (style 'typical') a run of floors drawn once. */
export interface RiserRow { floors: EarthRiserFloor[]; typical: boolean; label: string; bar: string }
/** Position of a floor in the building, bottom to top: the riser cable alternates sides from floor to floor. */
export const floorIndex = (L: EarthRiserLayout, key: string) => L.floors.findIndex((f) => f.floor.key === key);

const rowOf = (L: EarthRiserLayout, fs: EarthRiserFloor[]): RiserRow => {
  if (fs.length === 1) return { floors: fs, typical: false, label: levelLabel(fs[0].floor), bar: fs[0].feb };
  const a = fs[0].floor, b = fs[fs.length - 1].floor;
  return { floors: fs, typical: true, label: `TYPICAL ${levelLabel(a)} TO ${levelLabel(b)}`, bar: `${fs[0].feb} TO ${shortTag(b)}` };
};

/** The rows of the riser, bottom to top. Style 'typical': runs of TYPICAL_MIN or more
 * floors with the same earthing collapse to one row, keeping the first and last floor of the run. */
export function riserRows(L: EarthRiserLayout): RiserRow[] {
  if (L.style !== 'typical') return L.floors.map((f) => rowOf(L, [f]));
  return runs(L).flatMap((r) => (r.length >= TYPICAL_MIN + 2 ? [rowOf(L, [r[0]]), rowOf(L, r.slice(1, -1)), rowOf(L, [r[r.length - 1]])] : r.map((f) => rowOf(L, [f]))));
}

/** The riser split over sheets, bottom to top: LEVELS_PER_SHEET rows each (one sheet in style 'typical'). */
export function riserPages(L: EarthRiserLayout): RiserRow[][] {
  const rows = riserRows(L);
  if (L.style === 'typical' || rows.length <= LEVELS_PER_SHEET) return [rows];
  const out: RiserRow[][] = [];
  for (let i = 0; i < rows.length; i += LEVELS_PER_SHEET) out.push(rows.slice(i, i + LEVELS_PER_SHEET));
  return out;
}

/** Floor earthing sheets: one per floor with panels; style 'typical': one per run of floors with the same earthing. */
export function floorGroups(L: EarthRiserLayout): RiserRow[] {
  const withPanels = L.floors.filter((f) => f.boards.length);
  if (L.style !== 'typical') return withPanels.map((f) => rowOf(L, [f]));
  return runs({ ...L, lvFloor: undefined, floors: withPanels }).map((r) => rowOf(L, r));
}

/** Titles of a building's earth riser sheets and floor earthing sheets. */
export function earthSheetTitles(project: Project, buildingId: string): { riser: string[]; floors: string[] } {
  const L = earthRiserLayout(project, buildingId);
  const pages = riserPages(L);
  return {
    riser: pages.map((_, i) => `Earthing riser diagram — ${L.buildingName}${pages.length > 1 ? ` (${i + 1} of ${pages.length})` : ''}`),
    floors: floorGroups(L).map((g) => `Floor earthing — ${L.buildingName} — ${g.label}`)
  };
}
