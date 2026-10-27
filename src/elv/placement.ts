import { buildingInfoOf } from '../calc/building';
import { applyRecommendation, recommend } from '../calc/sizing';
import type { LoadItem, PackageSource } from '../exchange/contracts';
import { exchangeOf } from '../exchange/inbox';
import { feederPhaseKw } from '../model/phases';
import type { Board, BoardKind, Feeder, Phase, Project } from '../types';

/** ELV loads accepted in the review inbox (project.exchange.packages) placed as circuits on LV boards. A floor supply
 * goes to the DB of its floor, a building supply to the building's main board, an essential load to the essential
 * (generator) side where the building has one. Each circuit keeps a link to its load (`Feeder.elvLoad`), so the next
 * package updates the same circuit: new loads are added, a changed kW is only proposed (a modification record for
 * the engineer), and circuits of removed loads are listed, never deleted. */

export interface PlannedCircuit {
  link: string; // Feeder.elvLoad
  load: LoadItem;
  boardId?: string; // undefined: no board found (give one with boards)
  why: string;
  noFloorBoard?: boolean; // a floor supply sent to the main board: its floor has no board
  noEssentialBoard?: boolean; // an essential load on a normal board: the building has no essential side
}
export interface KwChange { feederId: string; link: string; fromKw: number; toKw: number }
export interface ElvPlacementPlan {
  add: PlannedCircuit[];
  unplaced: PlannedCircuit[];
  kwChanges: KwChange[];
  same: string[]; // feeder IDs already up to date
  removed: { feederId: string; link: string; name: string }[]; // loads no longer in the accepted package
  placeholders: { feederId: string; name: string }[]; // "ELV / BMS / security" placeholder circuits to delete
  notices: string[]; // where the rules had to fall back: floors with no board, essential loads with no essential board
}

const MAIN_KINDS: BoardKind[] = ['MDB', 'LV-MDB', 'SMDB'];
const ESSENTIAL_KINDS: BoardKind[] = ['EMDB', 'LV-EMDB', 'EDB', 'EMCC'];
const PLACEHOLDER = /^ELV \/ BMS \/ security/;
const SINGLE_PHASE_MAX_KW = 3;

/** The link a circuit keeps to its load: program, file and load ID. */
export const elvLink = (source: PackageSource, id: string) => `${source.app}:${source.file ?? ''}#${id}`;

/** On the essential side: an essential board kind, or fed (at any depth) from a board with a standby generator. */
export function onEssentialSide(project: Project, board: Board): boolean {
  const seen = new Set<string>();
  for (let b: Board | undefined = board; b && !seen.has(b.id); b = project.boards.find((x) => x.id === b!.upstreamId)) {
    seen.add(b.id);
    if (b.standby || (b.kind && ESSENTIAL_KINDS.includes(b.kind))) return true;
  }
  return false;
}

/** The accepted ELV loads, each with its link. */
export function acceptedElvLoads(project: Project): { link: string; load: LoadItem }[] {
  return exchangeOf(project).packages.filter((a) => a.kind === 'loads').flatMap((a) => (a.loads ?? []).map((load) => ({ link: elvLink(a.source, load.id), load })));
}

/** Where a load is: the building and level of the rooms it serves (one level → a floor supply, unless the package
 * says it serves the whole building). */
function locate(project: Project, load: LoadItem): { buildingId?: string; levelId?: string; floor?: number } {
  const info = buildingInfoOf(project);
  const rooms = (load.rooms ?? []).map((id) => info.rooms.find((r) => r.id === id)).filter((r) => !!r);
  const buildings = [...new Set(rooms.map((r) => r.buildingId))];
  const buildingId = buildings.length === 1 ? buildings[0] : !rooms.length && info.buildings.length === 1 ? info.buildings[0].id : undefined;
  const levels = [...new Set(rooms.map((r) => r.levelId))];
  const floor = /-F(\d+)$/.exec(load.id); // which floor of a typical level (SP3 IDs)
  return { buildingId, ...(buildingId && levels.length === 1 && load.serves !== 'building' ? { levelId: levels[0], ...(floor ? { floor: Number(floor[1]) } : {}) } : {}) };
}

function chooseBoard(project: Project, load: LoadItem): Omit<PlannedCircuit, 'link' | 'load'> {
  const { buildingId, levelId, floor } = locate(project, load);
  const info = buildingInfoOf(project);
  if (!buildingId) return { why: info.buildings.length > 1 ? 'its rooms are in more than one building, or it names no rooms' : 'no building in Building information' };
  const single = info.buildings.length === 1;
  const inBuilding = project.boards.filter((b) => (b.level ? b.level.building === buildingId : single));
  const essential = load.supply === 'essential';
  const ess = (b: Board) => onEssentialSide(project, b);
  const hasEssential = inBuilding.some(ess);
  const rooms = new Set(load.rooms ?? []);
  const serves = (b: Board) => info.rooms.filter((r) => rooms.has(r.id) && r.boardId === b.id).length;
  const isDb = (b: Board) => b.kind === 'DB' || b.kind === 'EDB' || !b.kind;
  // Floor supply: the board on its floor that serves most of its rooms (DBs before main boards).
  const onLevel = !levelId ? [] : inBuilding.filter((b) => b.level?.level === levelId && (floor === undefined || !b.level.index || b.level.index === floor));
  if (levelId) {
    const pool = essential && hasEssential ? onLevel.filter(ess) : onLevel;
    if (pool.length) {
      const b = [...pool].sort((x, y) => serves(y) - serves(x) || Number(!isDb(x)) - Number(!isDb(y)))[0];
      return { boardId: b.id, why: `${serves(b) ? `serves ${serves(b)} of its rooms` : 'a board on its floor'}${essential && ess(b) ? ', essential side' : ''}`, ...(essential && !hasEssential ? { noEssentialBoard: true } : {}) };
    }
  }
  // Building supply, or no suitable board on the floor: the building's main board (essential side for essential loads).
  const pool = essential && hasEssential ? inBuilding.filter(ess) : inBuilding;
  const main = pool.find((b) => b.kind && MAIN_KINDS.includes(b.kind)) ?? pool.find((b) => b.kind && ESSENTIAL_KINDS.includes(b.kind)) ?? pool.find((b) => !b.upstreamId) ?? pool[0];
  if (!main) return { why: 'no board in its building' };
  return {
    boardId: main.id, why: `${levelId ? 'no board on its floor; ' : ''}the building's main board${essential && ess(main) ? ', essential side' : ''}`,
    ...(levelId && !onLevel.length ? { noFloorBoard: true } : {}), ...(essential && !hasEssential ? { noEssentialBoard: true } : {})
  };
}

/** What placing the accepted ELV loads would do. `boards` names a board for a load (by load ID), instead of the rule. */
export function planElvPlacement(project: Project, boards: Record<string, string> = {}): ElvPlacementPlan {
  for (const [id, b] of Object.entries(boards)) if (!project.boards.some((x) => x.id === b)) throw new Error(`No board "${b}" (given for load ${id}).`);
  const loads = acceptedElvLoads(project);
  const linked = new Map(project.feeders.filter((f) => f.elvLoad).map((f) => [f.elvLoad!, f]));
  const plan: ElvPlacementPlan = { add: [], unplaced: [], kwChanges: [], same: [], removed: [], placeholders: [], notices: [] };
  for (const { link, load } of loads) {
    const f = linked.get(link);
    if (f) {
      if (Math.abs(f.loadKw - load.kW) < 0.0005) plan.same.push(f.id);
      else plan.kwChanges.push({ feederId: f.id, link, fromKw: f.loadKw, toKw: load.kW });
      continue;
    }
    const given = boards[load.id];
    const chosen = given ? { boardId: given, why: 'board given by the engineer' } : chooseBoard(project, load);
    (chosen.boardId ? plan.add : plan.unplaced).push({ link, load, ...chosen });
  }
  const current = new Set(loads.map((l) => l.link));
  for (const [link, f] of linked) if (!current.has(link)) plan.removed.push({ feederId: f.id, link, name: f.name });
  if (loads.length) plan.placeholders = project.feeders.filter((f) => !f.elvLoad && PLACEHOLDER.test(f.name)).map((f) => ({ feederId: f.id, name: f.name }));
  plan.notices = placementNotices(plan.add);
  return plan;
}

const listed = (ids: string[]) => (ids.length > 6 ? `${ids.slice(0, 6).join(', ')} and ${ids.length - 6} more` : ids.join(', '));

/** Where the rules had to fall back, said once for all the loads it applies to. */
function placementNotices(add: PlannedCircuit[]): string[] {
  const noFloor = add.filter((c) => c.noFloorBoard), noEss = add.filter((c) => c.noEssentialBoard);
  const n = noFloor.length, m = noEss.length;
  return [
    ...(n ? [`${n} floor suppl${n === 1 ? 'y goes' : 'ies go'} to the building's main board because ${n === 1 ? 'its floor has' : 'their floors have'} no board (${listed(noFloor.map((c) => c.load.id))}). Set the DB that serves the rooms, or choose the board.`] : []),
    ...(m ? [`${m} essential load${m === 1 ? ' goes' : 's go'} on a normal board: the building has no essential (generator) board (${listed(noEss.map((c) => c.load.id))}). ${m === 1 ? 'Its circuit is' : 'Their circuits are'} marked essential; add an essential board, or choose the board.`] : [])
  ];
}

/** The phase with the least load on a board, for a single-phase circuit. */
function lightestPhase(project: Project, boardId: string): Phase {
  const kw: Record<'R' | 'Y' | 'B', number> = { R: 0, Y: 0, B: 0 };
  for (const f of project.feeders.filter((x) => x.boardId === boardId)) {
    const p = feederPhaseKw(project, f);
    kw.R += p.R; kw.Y += p.Y; kw.B += p.B;
  }
  return (['R', 'Y', 'B'] as const).reduce((a, b) => (kw[b] < kw[a] ? b : a));
}

/** Adds the planned circuits (sized with the app's own recommendation); kW changes are not applied here. */
export function addElvCircuits(project: Project, plan: ElvPlacementPlan): { project: Project; added: string[] } {
  let p = project;
  const added: string[] = [];
  for (const c of plan.add) {
    const base = `${c.boardId}-${c.load.id}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
    let id = base;
    for (let n = 2; p.feeders.some((f) => f.id === id) || p.boards.some((b) => b.id === id); n++) id = `${base}-${n}`;
    const single = c.load.kW <= SINGLE_PHASE_MAX_KW;
    const f: Feeder = {
      id, boardId: c.boardId!, name: c.load.equipment.slice(0, 120), loadKw: c.load.kW, demandFactor: 1, powerFactor: c.load.pf ?? 0.9,
      lengthM: 40, cableCsaMm2: single ? 2.5 : 4, cores: single ? 2 : 4, breakerRatingA: single ? 16 : 20, breakerIcuKa: 10, loadType: 'it',
      ...(single ? { phase: lightestPhase(p, c.boardId!) } : {}), ...(c.load.supply === 'essential' ? { essential: true } : {}),
      remarks: `ELV ${c.load.system}: ${c.load.demandBasis}`.slice(0, 200), elvLoad: c.link
    };
    const tmp = { ...p, feeders: [...p.feeders, f] };
    p = { ...tmp, feeders: tmp.feeders.map((x) => (x.id === f.id ? applyRecommendation(f, recommend(tmp, f, 'optimise')) : x)) };
    added.push(id);
  }
  return { project: p, added };
}

/** Buildings that have ELV circuits placed: the 3 kW ELV placeholder is no longer suggested for them. */
export function buildingsWithElvCircuits(project: Project): Set<string> {
  const single = buildingInfoOf(project).buildings.length === 1 ? buildingInfoOf(project).buildings[0].id : undefined;
  const out = new Set<string>();
  for (const f of project.feeders) {
    if (!f.elvLoad) continue;
    const b = project.boards.find((x) => x.id === f.boardId);
    const building = b?.level?.building ?? single;
    if (building) out.add(building);
  }
  return out;
}
