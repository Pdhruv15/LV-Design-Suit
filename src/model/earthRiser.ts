import type { Board, EarthRiserDef, Feeder, Project } from '../types';
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
  /** Riser (id) whose floor earth bar it connects to, when it is not earthed through another panel. */
  riser?: string;
}
/** A floor earth bar on one floor: the riser (id) it is on and its tag (EB-EL-A-L03). */
export interface FloorBar { riser: string; tag: string }
export interface EarthRiserFloor {
  floor: Floor;
  /** Tag of the first riser's bar on this floor ('' when no riser serves it). */
  feb: string;
  /** One bar per riser serving this floor, in riser order. */
  febs: FloorBar[];
  boards: EarthRiserBoard[];
}
/** A riser of the building: floors lo..hi (indexes into floors) and the floor the LV room cable lands on. */
export interface RiserLane { id: string; name: string; lo: number; hi: number; lvFloor: string }
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
  /** Risers of the building, in order (at least one when the building has floors). */
  risers: RiserLane[];
  /** Panels whose chosen riser does not serve their floor (earthed to the first riser that does). */
  wrongRiser: string[];
  /** Panels on a floor no riser serves (not drawn). */
  noRiser: string[];
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
  const defs = risersOf(project, buildingId);
  const idx = (key: string | undefined, d: number) => { const i = key ? floors.findIndex((f) => f.key === key) : -1; return i >= 0 ? i : d; };
  const lanes0 = defs.map((d) => { const a = idx(d.from, 0), b = idx(d.to, floors.length - 1); return { id: d.id, name: d.name, lo: Math.min(a, b), hi: Math.max(a, b) }; });
  const serving = (i: number) => lanes0.filter((r) => i >= r.lo && i <= r.hi);
  const febsOf = (f: Floor, i: number): FloorBar[] => serving(i).map((r) => ({ riser: r.id, tag: febTag(r.name, f) }));
  const rowFor = (floor: Floor, i: number): EarthRiserFloor => { const febs = febsOf(floor, i); return { floor, feb: febs[0]?.tag ?? '', febs, boards: [] }; };
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
  const lvLevel = mains.map((m) => m.board.level).find((l) => l?.building === buildingId);
  const lvFloor = (lvLevel && keyed.get(levelKey(lvLevel))?.key) ?? floors[0]?.key;
  const lvAt = idx(lvFloor, 0);
  // Each riser's LV room cable lands on the LV room's floor if it serves it, else on its lowest floor.
  const risers: RiserLane[] = floors.length ? lanes0.map((r) => ({ ...r, lvFloor: floors[lvAt >= r.lo && lvAt <= r.hi ? lvAt : r.lo].key })) : [];
  const more = { lvFloor, risers, wrongRiser: [] as string[], noRiser: [] as string[] };
  if (!floors.length || !placed.length) return { ...base, ...more, floors: floors.map(rowFor), mains, notOnLevel, empty: true };

  const rows: EarthRiserFloor[] = floors.map(rowFor);
  const rowOf = new Map(rows.map((r) => [r.floor.key, r]));
  for (const b of placed) {
    const f = floorOf.get(b.id)!;
    const parent = byId.get(b.upstreamId!);
    const feeder = project.feeders.find((x) => x.feedsBoardId === b.id && x.boardId === b.upstreamId);
    const sameFloor = parent && parent.upstreamId && floorOf.get(parent.id)?.key === f.key;
    const row = rowOf.get(f.key)!;
    if (sameFloor) { row.boards.push({ board: b, feeder, cpcMm2: feeder ? cpcOf(feeder) : undefined, toBoard: parent!.id }); continue; }
    if (!row.febs.length) { more.noRiser.push(b.id); continue; }
    const chosen = b.earthRiser && row.febs.find((x) => x.riser === b.earthRiser);
    if (b.earthRiser && !chosen && defs.some((d) => d.id === b.earthRiser)) more.wrongRiser.push(b.id);
    row.boards.push({ board: b, feeder, cpcMm2: feeder ? cpcOf(feeder) : undefined, riser: (chosen || row.febs[0]).riser });
  }
  // A panel earthed through one on no riser is not drawn either.
  for (const r of rows) {
    const here = new Set(r.boards.map((x) => x.board.id));
    let changed = true;
    while (changed) { changed = false; for (const x of r.boards) if (x.toBoard && !here.has(x.toBoard) && here.has(x.board.id)) { here.delete(x.board.id); more.noRiser.push(x.board.id); changed = true; } }
    r.boards = r.boards.filter((x) => here.has(x.board.id));
  }
  // Each panel right after the panel it is earthed through, so the conductors stay short.
  for (const r of rows) {
    const top = r.boards.filter((x) => !x.toBoard);
    const out: EarthRiserBoard[] = [];
    const add = (x: EarthRiserBoard) => { out.push(x); r.boards.filter((c) => c.toBoard === x.board.id).forEach(add); };
    top.forEach(add);
    r.boards = out;
  }
  return { ...base, ...more, floors: rows, mains, notOnLevel, empty: false };
}

/** A building's risers replaced by `defs` (earthing settings); panels on a riser that is gone go back to the default. */
export function setRisers(project: Project, buildingId: string, defs: EarthRiserDef[]): Project {
  const others = (project.earthingPlan?.risers ?? []).filter((r) => r.buildingId !== buildingId);
  const risers = [...others, ...defs.map((d) => ({ ...d, buildingId }))];
  const ids = new Set(risers.map((r) => r.id));
  return {
    ...project,
    earthingPlan: { ...project.earthingPlan, risers: risers.length ? risers : undefined },
    boards: project.boards.map((b) => (b.earthRiser && !ids.has(b.earthRiser) ? { ...b, earthRiser: undefined } : b))
  };
}
/** An id for a new riser, unique in the project. */
export function newRiserId(project: Project, also: string[] = []): string {
  const used = new Set([...(project.earthingPlan?.risers ?? []).map((r) => r.id), ...also]);
  let n = 1;
  while (used.has(`er-${n}`)) n++;
  return `er-${n}`;
}
/** Next riser name after the given ones: EL-A → EL-B → EL-C … */
export function nextRiserName(names: string[]): string {
  for (let c = 65; c < 91; c++) { const n = `EL-${String.fromCharCode(c)}`; if (!names.includes(n)) return n; }
  return `EL-${names.length + 1}`;
}

/** The earth risers of a building as set in the earthing settings; one full-height riser (riserName) when none. */
export function risersOf(project: Project, buildingId: string): EarthRiserDef[] {
  const own = (project.earthingPlan?.risers ?? []).filter((r) => r.buildingId === buildingId);
  return own.length ? own : [{ id: '', buildingId, name: project.earthingPlan?.riserName?.trim() || DEFAULT_RISER_NAME }];
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
  return JSON.stringify([r.floor.ref.level, r.febs.map((x) => x.riser), r.boards.map((b) => [b.board.kind ?? 'DB', b.cpcMm2 ?? 0, b.toBoard ? pos.get(b.toBoard) ?? -1 : -1, b.riser ?? ''])]);
}

/** Runs of consecutive floors with the same earthing (bottom to top). */
function runs(L: EarthRiserLayout): EarthRiserFloor[][] {
  const out: EarthRiserFloor[][] = [];
  let sig = '';
  for (const f of L.floors) {
    const s = floorSignature(f);
    const alone = (k: string) => k === L.lvFloor || L.risers.some((r) => r.lvFloor === k); // LV room cables land here
    if (out.length && s === sig && !alone(f.floor.key) && !alone(out[out.length - 1][0].floor.key)) out[out.length - 1].push(f);
    else { out.push([f]); sig = s; }
  }
  return out;
}

/** One drawn row of the riser: a floor, or (style 'typical') a run of floors drawn once.
 * bars: one per riser on these floors (tag EB-EL-A-L03, or EB-EL-A-L02 TO L99 for a typical run); bar: the first. */
export interface RiserRow { floors: EarthRiserFloor[]; typical: boolean; label: string; bar: string; bars: FloorBar[] }
/** Position of a floor in the building, bottom to top: the riser cable alternates sides from floor to floor. */
export const floorIndex = (L: EarthRiserLayout, key: string) => L.floors.findIndex((f) => f.floor.key === key);

const rowOf = (_L: EarthRiserLayout, fs: EarthRiserFloor[]): RiserRow => {
  if (fs.length === 1) return { floors: fs, typical: false, label: levelLabel(fs[0].floor), bar: fs[0].feb, bars: fs[0].febs };
  const a = fs[0].floor, b = fs[fs.length - 1].floor;
  const bars = fs[0].febs.map((x) => ({ riser: x.riser, tag: `${x.tag} TO ${shortTag(b)}` }));
  return { floors: fs, typical: true, label: `TYPICAL ${levelLabel(a)} TO ${levelLabel(b)}`, bar: bars[0]?.tag ?? '', bars };
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
  return runs({ ...L, lvFloor: undefined, risers: [], floors: withPanels }).map((r) => rowOf(L, r));
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
