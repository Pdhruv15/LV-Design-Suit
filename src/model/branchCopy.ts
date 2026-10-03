import type { Board, Feeder, Project } from '../types';
import { boardAndDescendants } from './edit';
import { findFloor, floorList, type Floor } from './levels';
import { levelRef, type PlanCheck } from './hierarchy';
import { incomerLengthM } from '../calc/buildingDesign';

/** Repeat a branch on other floors, and panel assemblies (saved branches).
 *
 * A branch is a board with everything below it: sub-boards, feeders, load
 * schedule circuits, and the incomer that feeds it. Copies are renamed by
 * swapping the level reference as a whole part of each id: SMDB-L1 →
 * SMDB-L5, DB-L1-02 → DB-L5-02, DB-L1-R3 → DB-L5-R3 ("L1" never touches
 * "L10"). Names and locations get the same word swap. Every copied board
 * gets the target floor. Ids must stay unique: when a copy would clash (the
 * same branch twice on one floor, or ids with no level in them) the whole
 * copy gets a number, -2, -3 …, and the check says so. A circuit id with no
 * level and not starting with its board (e.g. "X7") is prefixed with its new
 * board: SMDB-L5-X7. */

export interface Branch {
  rootId: string;
  boards: Board[];
  /** Feeders on the branch's boards, plus the incomer feeding the root (last, if any). */
  feeders: Feeder[];
  incomer?: Feeder;
  /** Level reference the ids are written with (e.g. "L1"), if any. */
  token?: string;
}

/** The branch below (and including) a board, as stored data. */
export function extractBranch(project: Project, rootId: string): Branch | undefined {
  const root = project.boards.find((b) => b.id === rootId);
  if (!root) return undefined;
  const tree = boardAndDescendants(project, rootId);
  const boards = project.boards.filter((b) => tree.has(b.id)).map((b) => structuredClone(b));
  const feeders = project.feeders.filter((f) => tree.has(f.boardId)).map((f) => structuredClone(f));
  const inc = project.feeders.find((f) => f.feedsBoardId === rootId && !tree.has(f.boardId));
  const f = findFloor(project.building, root.level);
  const fromLevel = f ? levelRef(f.tag) : undefined;
  const token = fromLevel && rootId.split('-').includes(fromLevel) ? fromLevel : undefined;
  return { rootId, boards, feeders, ...(inc ? { incomer: structuredClone(inc) } : {}), ...(token ? { token } : {}) };
}

const swapId = (id: string, from: string | undefined, to: string) => (from ? id.split('-').map((s) => (s === from ? to : s)).join('-') : id);
const swapWords = (s: string | undefined, from: string | undefined, to: string) => (s === undefined || !from ? s : s.replace(new RegExp(`(^|[^A-Za-z0-9])${from}(?![A-Za-z0-9])`, 'g'), `$1${to}`));

export interface BranchCopy { floor?: Floor; parentId: string; boards: Board[]; feeders: Feeder[]; numbered?: number }
export interface BranchPlan { copies: BranchCopy[]; checks: PlanCheck[]; ok: boolean }

/** Copies of a branch onto floors (or once, with no floor), each fed from a parent board. */
export function planBranchCopies(project: Project, branch: Branch, targets: { floor?: Floor; parentId: string }[]): BranchPlan {
  const checks: PlanCheck[] = [];
  const taken = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id)]);
  const boardIds = new Set(project.boards.map((b) => b.id));
  const building = (id?: string) => project.building?.buildings.find((b) => b.id === id);
  const copies: BranchCopy[] = [];
  if (!targets.length) checks.push({ level: 'bad', text: 'Choose at least one floor' });
  for (const t of targets) {
    if (!boardIds.has(t.parentId)) { checks.push({ level: 'bad', text: `${t.parentId} is not a board in the project` }); continue; }
    if (boardAndDescendants(project, branch.rootId).has(t.parentId) && project.boards.some((b) => b.id === branch.rootId)) { checks.push({ level: 'bad', text: `${t.parentId} is inside the branch being copied` }); continue; }
    const to = t.floor ? levelRef(t.floor.tag) : branch.token ?? '';
    const ids = (n?: number) => {
      const suffix = n ? `-${n}` : '';
      const b = new Map(branch.boards.map((x) => [x.id, swapId(x.id, branch.token, to) + suffix]));
      const f = new Map<string, string>();
      for (const x of branch.feeders) {
        const nb = b.get(x.boardId)!;
        const swapped = swapId(x.id, branch.token, to);
        // Ids that follow their board, or carry the level, are renamed with it; any other id is prefixed with its new board.
        f.set(x.id, x.id.startsWith(`${x.boardId}-`) ? nb + x.id.slice(x.boardId.length) : swapped !== x.id ? swapped + suffix : `${nb}-${x.id}`);
      }
      if (branch.incomer) f.set(branch.incomer.id, `INC-${b.get(branch.rootId)}`);
      return { b, f };
    };
    let n: number | undefined;
    let map = ids();
    const clash = (m: typeof map) => [...m.b.values(), ...m.f.values()].some((id) => taken.has(id)) || new Set([...m.b.values(), ...m.f.values()]).size !== m.b.size + m.f.size;
    for (let k = 2; clash(map) && k < 100; k++) { n = k; map = ids(k); }
    if (clash(map)) { checks.push({ level: 'bad', text: `No free name for the copy on ${to || t.parentId}` }); continue; }
    for (const id of [...map.b.values(), ...map.f.values()]) taken.add(id);
    const rename = (s: string | undefined) => swapWords(s, branch.token, to);
    const boards: Board[] = branch.boards.map((b) => {
      const c: Board = { ...structuredClone(b), id: map.b.get(b.id)!, name: rename(b.name) ?? b.name };
      const loc = rename(b.location); if (loc === undefined) delete c.location; else c.location = loc;
      if (b.id === branch.rootId) { c.upstreamId = t.parentId; delete c.supply; delete c.sourceKva; delete c.sourceImpedancePct; delete c.sourceXr; }
      else c.upstreamId = map.b.get(b.upstreamId!) ?? b.upstreamId;
      if (t.floor) c.level = t.floor.ref;
      delete c.generated;
      return c;
    });
    const feeders: Feeder[] = branch.feeders.map((f) => {
      const c: Feeder = { ...structuredClone(f), id: map.f.get(f.id)!, boardId: map.b.get(f.boardId)!, name: rename(f.name) ?? f.name };
      if (f.feedsBoardId) c.feedsBoardId = map.b.get(f.feedsBoardId) ?? f.feedsBoardId;
      return c;
    });
    if (branch.incomer) {
      const b = building(t.floor?.buildingId);
      feeders.push({ ...structuredClone(branch.incomer), id: map.f.get(branch.incomer.id)!, boardId: t.parentId, feedsBoardId: map.b.get(branch.rootId)!, name: `To ${map.b.get(branch.rootId)}`,
        ...(b && t.floor ? { lengthM: incomerLengthM(b, t.floor.elevationM), lengthToCheck: true } : {}) });
    }
    copies.push({ floor: t.floor, parentId: t.parentId, boards, feeders, ...(n ? { numbered: n } : {}) });
  }
  const numbered = copies.filter((c) => c.numbered);
  if (numbered.length) checks.push({ level: 'warn', text: `${numbered.length} cop${numbered.length > 1 ? 'ies' : 'y'} numbered to keep names unique (${numbered.slice(0, 4).map((c) => c.boards[0].id).join(', ')})` });
  if (!branch.token && targets.some((t) => t.floor)) checks.push({ level: 'warn', text: 'The branch ids have no level reference to swap — copies are numbered instead' });
  if (branch.incomer && targets.some((t) => t.floor)) checks.push({ level: 'warn', text: 'Incomer lengths recalculated from the riser for each floor — check them' });
  if (copies.length) checks.push({ level: 'ok', text: `${copies.length} cop${copies.length > 1 ? 'ies' : 'y'}, every id unique` });
  return { copies, checks, ok: !checks.some((c) => c.level === 'bad') && copies.length > 0 };
}

/** The project with the copies added (one change — one undo). */
export function applyBranchCopies(project: Project, plan: BranchPlan): Project {
  if (!plan.ok) throw new Error('The plan has errors — fix them before creating');
  return { ...project, boards: [...project.boards, ...plan.copies.flatMap((c) => c.boards)], feeders: [...project.feeders, ...plan.copies.flatMap((c) => c.feeders)] };
}

/** Floors of the source's building other than its own, bottom to top. */
export function otherFloors(project: Project, rootId: string): Floor[] {
  const root = project.boards.find((b) => b.id === rootId);
  const own = findFloor(project.building, root?.level);
  return floorList(project.building).filter((f) => (!own || f.buildingId === own.buildingId) && f.key !== own?.key);
}

// ---- Assemblies: saved branches in the user library (synced with Library.json) ----

export interface Assembly { id: string; name: string; note?: string; savedAt: string; branch: Branch }
const KEY = 'lvds.assemblies';
export function loadAssemblies(): Assembly[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveAssemblies(list: Assembly[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { return false; }
  void import('../database/librarySync').then((m) => m.pushLibrary());
  return true;
}
export function assemblyFrom(project: Project, rootId: string, name: string, note?: string): Assembly | undefined {
  const branch = extractBranch(project, rootId);
  return branch && { id: `as-${Date.now().toString(36)}`, name: name.trim() || rootId, ...(note ? { note } : {}), savedAt: new Date().toISOString().slice(0, 10), branch };
}
/** Short text tree of a branch, for previews: "SMDB-L1 (2 DB, 24 circuits)". */
export function branchSummary(b: Branch): string {
  const kinds = b.boards.filter((x) => x.id !== b.rootId).reduce<Record<string, number>>((m, x) => ({ ...m, [x.kind ?? 'DB']: (m[x.kind ?? 'DB'] ?? 0) + 1 }), {});
  const circuits = b.feeders.filter((f) => !f.feedsBoardId).length;
  return `${b.rootId}${Object.keys(kinds).length ? ` + ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''} · ${circuits} circuit${circuits === 1 ? '' : 's'}`;
}
