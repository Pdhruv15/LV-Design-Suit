import type { Board, Feeder, Project } from '../../types';

/** Network index and memo, shared by the calculations, screens and reports.
 *
 * The studies walk the board tree many times (each incomer re-adds its whole
 * downstream network; each feeder walks up to the source again), and screens
 * and reports repeat those walks. The index builds the lookups once for a
 * project object and lets the walks reuse results.
 *
 * Safety rules:
 * - A project is only ever replaced, never edited in place (src/model/history.ts),
 *   so an index stays true for its project object. An edited copy, or a trial
 *   copy while sizing a cable, is another object and gets its own.
 * - The database's cables, breakers and catalogue also set the results: changing
 *   them forgets every index (forgetNetworks).
 * - Only the last few project objects keep an index, so the undo history does not
 *   hold one per version; a run holds on to its own with withNetwork().
 * - Results of walks are reused only when the network is a clean tree: no loop in
 *   the board chain and no board fed by two feeders. Otherwise `tree` is false and
 *   the original walks run unchanged (their cycle guards decide, as before).
 * - Lookups keep the project's own order (first match wins, as Array.find). */
export interface NetworkIndex {
  boardById: Map<string, Board>;
  feedersByBoard: Map<string, Feeder[]>;
  /** The feeder from board.upstreamId to board.id (first in project order), by board id. */
  incomerOf: Map<string, Feeder>;
  tree: boolean;
  memo: Map<string, unknown>;
}

function build(project: Project): NetworkIndex {
  const boardById = new Map<string, Board>();
  for (const b of project.boards) if (!boardById.has(b.id)) boardById.set(b.id, b);
  const feedersByBoard = new Map<string, Feeder[]>();
  const fedCount = new Map<string, number>();
  const firstFeed = new Map<string, Feeder>(); // "up>down" → first feeder in order
  for (const f of project.feeders) {
    (feedersByBoard.get(f.boardId) ?? feedersByBoard.set(f.boardId, []).get(f.boardId)!).push(f);
    if (f.feedsBoardId) {
      fedCount.set(f.feedsBoardId, (fedCount.get(f.feedsBoardId) ?? 0) + 1);
      const k = `${f.boardId}>${f.feedsBoardId}`;
      if (!firstFeed.has(k)) firstFeed.set(k, f);
    }
  }
  const incomerOf = new Map<string, Feeder>();
  for (const b of boardById.values()) if (b.upstreamId) { const f = firstFeed.get(`${b.upstreamId}>${b.id}`); if (f) incomerOf.set(b.id, f); }
  let tree = boardById.size === project.boards.length && [...fedCount.values()].every((n) => n === 1);
  // No loop up the board chain …
  for (const b of boardById.values()) {
    if (!tree) break;
    const seen = new Set<string>();
    let c: Board | undefined = b;
    while (c?.upstreamId) { if (seen.has(c.id)) { tree = false; break; } seen.add(c.id); c = boardById.get(c.upstreamId); }
  }
  // … and none down the feeder graph (a board feeding, eventually, itself).
  if (tree) {
    const state = new Map<string, 1 | 2>();
    const visit = (id: string): boolean => {
      if (state.get(id) === 2) return true;
      if (state.get(id) === 1) return false;
      state.set(id, 1);
      for (const f of feedersByBoard.get(id) ?? []) if (f.feedsBoardId && !visit(f.feedsBoardId)) return false;
      state.set(id, 2);
      return true;
    };
    for (const id of feedersByBoard.keys()) if (!visit(id)) { tree = false; break; }
  }
  return { boardById, feedersByBoard, incomerOf, tree, memo: new Map() };
}

/** How many project objects keep an index: the live one, the last run's and what a screen compares them with. */
const KEPT = 4;
let kept: { project: Project; index: NetworkIndex }[] = [];
let current: { project: Project; index: NetworkIndex } | undefined;
let originalWalks = false;

function indexOf(project: Project): NetworkIndex {
  if (kept[0]?.project === project) return kept[0].index;
  const at = kept.findIndex((k) => k.project === project);
  const entry = at > 0 ? kept.splice(at, 1)[0] : { project, index: build(project) };
  kept.unshift(entry);
  if (kept.length > KEPT) kept.pop();
  return entry.index;
}

/** Runs fn holding on to this project's index, however many other projects it reads (nested calls share it). */
export function withNetwork<T>(project: Project, fn: () => T): T {
  if (current?.project === project) return fn();
  const prev = current;
  current = { project, index: indexOf(project) };
  try { return fn(); } finally { current = prev; }
}

/** The index of this very project object. */
export function networkOf(project: Project): NetworkIndex | undefined {
  if (current?.project === project) return current.index;
  return originalWalks ? undefined : indexOf(project);
}

/** Forgets every index: the data behind the results changed (cables, breakers, catalogue). */
export function forgetNetworks(): void {
  kept = [];
}

/** Runs fn on the original walks, with no index and no reuse: what the tests compare the index with. */
export function withoutNetwork<T>(fn: () => T): T {
  const prev = current, was = originalWalks;
  current = undefined;
  originalWalks = true;
  try { return fn(); } finally { current = prev; originalWalks = was; }
}

/** Reuses a value worked out from the whole project, on any network: nothing in it depends on the path of a walk. */
export function perProject<T>(project: Project, key: string, fn: () => T): T {
  const ix = networkOf(project);
  if (!ix) return fn();
  if (ix.memo.has(key)) return ix.memo.get(key) as T;
  const v = fn();
  ix.memo.set(key, v);
  return v;
}

/** Reuses the result of a walk when the network is a clean tree; otherwise just computes it. */
export function memoized<T>(project: Project, key: string, fn: () => T): T {
  return networkOf(project)?.tree ? perProject(project, key, fn) : fn();
}

/** The board with this id. */
export function boardOf(project: Project, id: string): Board | undefined {
  const ix = networkOf(project);
  return ix ? ix.boardById.get(id) : project.boards.find((b) => b.id === id);
}

const NO_FEEDERS: readonly Feeder[] = [];
/** The feeders on this board, in project order: the index's own list, not to be changed. */
export function feedersOn(project: Project, boardId: string): readonly Feeder[] {
  const ix = networkOf(project);
  return ix ? ix.feedersByBoard.get(boardId) ?? NO_FEEDERS : project.feeders.filter((f) => f.boardId === boardId);
}
