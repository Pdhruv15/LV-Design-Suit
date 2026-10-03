import type { Board, Feeder, Project } from '../../types';

/** Network index and memo for ONE calculation run.
 *
 * The studies walk the board tree many times (each incomer re-adds its whole
 * downstream network; each feeder walks up to the source again). Inside a
 * run, withNetwork() builds lookups once and lets those walks reuse results.
 *
 * Safety rules:
 * - Lives only for the duration of withNetwork(): nothing carries over between
 *   runs or edits, so a changed project, setting or catalogue is always
 *   recalculated. Outside a run (screens calling helpers directly) and for any
 *   other project object (e.g. a trial copy while sizing a cable), callers get
 *   undefined and use their original code path.
 * - Results are reused only when the network is a clean tree: no loop in the
 *   board chain and no board fed by two feeders. Otherwise `tree` is false and
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

let current: { project: Project; index: NetworkIndex } | undefined;

/** Runs fn with a network index for this project (nested calls share it). */
export function withNetwork<T>(project: Project, fn: () => T): T {
  if (current?.project === project) return fn();
  const prev = current;
  current = { project, index: build(project) };
  try { return fn(); } finally { current = prev; }
}

/** The index of the run in progress, if it is for this very project object. */
export function networkOf(project: Project): NetworkIndex | undefined {
  return current?.project === project ? current.index : undefined;
}

/** Reuses a result within the run when the network is a clean tree; otherwise just computes it. */
export function memoized<T>(project: Project, key: string, fn: () => T): T {
  const ix = networkOf(project);
  if (!ix?.tree) return fn();
  if (ix.memo.has(key)) return ix.memo.get(key) as T;
  const v = fn();
  ix.memo.set(key, v);
  return v;
}
