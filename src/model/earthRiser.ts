import type { Board, Feeder, Project } from '../types';
import { boardsInSupplyOrder } from '../calc/summary';
import { cpcOf } from '../calc/cableTable';
import { floorList, levelKey, type Floor } from './levels';
import { earthingLayout, type EarthLayout } from './earthingPlan';

/** Earth riser of one building (earthing system "dedicated earth riser"):
 * one copper tape up the electrical riser shaft from the main earth bar (MEB)
 * of the main board(s) feeding the building to the top floor, a tee-off and a
 * floor earth bar (FEB) on every floor. Each panel's earth bar connects to its
 * floor's FEB with a conductor the size of its incoming CPC; a panel fed from
 * another panel on the same floor (not the main board) connects to that
 * panel's earth bar instead. The MEB reaches the LV earth pits of the
 * earthing schematic. */

export const DEFAULT_RISER_TAPE = '25×3 mm Cu tape';

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
  const tape = project.earthingPlan?.riserTape?.trim() || DEFAULT_RISER_TAPE;
  const base = { buildingId, buildingName: building?.name ?? buildingId, tape };
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
  if (!floors.length || !placed.length) return { ...base, floors: floors.map((floor) => ({ floor, feb: `FEB-${floor.tag}`, boards: [] })), mains, notOnLevel, empty: true };

  const rows: EarthRiserFloor[] = floors.map((floor) => ({ floor, feb: `FEB-${floor.tag}`, boards: [] }));
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
  return { ...base, floors: rows, mains, notOnLevel, empty: false };
}
