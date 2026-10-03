import type { Board, Feeder, Project } from '../types';
import { isScheduleCircuit } from '../calc/loadSchedule';

/** Horizontal slot per load, vertical distance between board levels. */
export const LEAF_W = 132;
export const LEVEL_H = 270;
export const ROOT_BUS_Y = 210;
const MARGIN_X = 36;

export interface BoardNode {
  board: Board;
  /** The DB's final (load schedule) circuits. The SLD stops at the DB: they
   * are summarised on the board, not drawn; the board view and load
   * schedule list them. */
  circuits: Feeder[];
  /** No outgoing feeders drawn: the SLD ends at this board (no busbar). */
  terminal: boolean;
  depth: number;
  x: number; // centre of the board box / incomer drop
  busY: number;
  busX1: number;
  busX2: number;
}

export interface FeederNode {
  feeder: Feeder;
  x: number;
  busY: number; // bus of the board it's connected to
  childBoardId?: string; // set for incomers to a sub-board
}

export interface SystemLayout {
  boards: BoardNode[];
  feeders: FeederNode[];
  roots: BoardNode[];
  utilityX: number;
  width: number;
  height: number;
  levelH: number; // vertical distance between board levels
  rootY: number; // busbar height of the main boards
}

/** Tree layout of the whole network: each load takes one LEAF_W slot, a
 * sub-board takes as many slots as it has loads (recursively, at least one),
 * and every board is centred over its own feeders. Final circuits of a DB
 * (lighting / power ways on its load schedule) are not drawn. Boards not reachable from a main
 * board are laid out as extra roots so nothing silently disappears. */
/** DEWA submission style: more room above each panel for its frame and summary box. */
export const DEWA_EXTRA_Y = 110;

export function layoutSystem(project: Project, extraY = 0): SystemLayout {
  const rootY = ROOT_BUS_Y + extraY;
  const levelH = LEVEL_H + extraY;
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  // Feeders of each board, split once (the layout asks for them many times).
  const sched = new Map<string, Feeder[]>(), kids = new Map<string, Feeder[]>();
  for (const f of project.feeders) { const m = isScheduleCircuit(f) ? sched : kids; (m.get(f.boardId) ?? m.set(f.boardId, []).get(f.boardId)!).push(f); }
  const scheduled = (boardId: string) => sched.get(boardId) ?? [];
  const children = (boardId: string) => kids.get(boardId) ?? [];
  const subBoard = (f: Feeder) => (f.feedsBoardId ? byId.get(f.feedsBoardId) : undefined);

  const unitsCache = new Map<string, number>();
  const units = (boardId: string, path: Set<string>): number => {
    if (unitsCache.has(boardId)) return unitsCache.get(boardId)!;
    if (path.has(boardId)) return 1; // cycle guard
    path.add(boardId);
    const n = children(boardId).reduce((sum, f) => {
      const child = subBoard(f);
      return sum + (child ? units(child.id, path) : 1);
    }, 0);
    path.delete(boardId);
    const u = Math.max(1, n);
    unitsCache.set(boardId, u);
    return u;
  };

  const boards: BoardNode[] = [];
  const feeders: FeederNode[] = [];
  const placed = new Set<string>();

  const place = (board: Board, left: number, depth: number): BoardNode => {
    placed.add(board.id);
    const busY = rootY + depth * levelH;
    let cursor = left;
    const xs: number[] = [];
    for (const f of children(board.id)) {
      const child = subBoard(f);
      if (child && !placed.has(child.id)) {
        const w = units(child.id, new Set());
        const node = place(child, cursor, depth + 1);
        feeders.push({ feeder: f, x: node.x, busY, childBoardId: child.id });
        xs.push(node.x);
        cursor += w * LEAF_W;
      } else {
        const x = cursor + LEAF_W / 2;
        feeders.push({ feeder: f, x, busY });
        xs.push(x);
        cursor += LEAF_W;
      }
    }
    const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : left + LEAF_W / 2;
    const half = LEAF_W * 0.38;
    const node: BoardNode = {
      board,
      circuits: scheduled(board.id),
      terminal: xs.length === 0,
      depth,
      x,
      busY,
      busX1: Math.min(x - half, xs.length ? Math.min(...xs) - half : x - half),
      busX2: Math.max(x + half, xs.length ? Math.max(...xs) + half : x + half)
    };
    boards.push(node);
    return node;
  };

  const roots: BoardNode[] = [];
  let left = MARGIN_X;
  const rootBoards = [...project.boards.filter((b) => !b.upstreamId), ...project.boards.filter((b) => b.upstreamId && !byId.has(b.upstreamId))];
  for (const b of rootBoards) {
    if (placed.has(b.id)) continue;
    roots.push(place(b, left, 0));
    left += units(b.id, new Set()) * LEAF_W;
  }
  // Anything still unplaced (e.g. a board whose incomer feeder is missing).
  for (const b of project.boards) {
    if (placed.has(b.id)) continue;
    roots.push(place(b, left, 0));
    left += units(b.id, new Set()) * LEAF_W;
  }

  const maxDepth = boards.reduce((m, b) => Math.max(m, b.depth), 0);
  const utilityX = roots.length ? (roots[0].x + roots[roots.length - 1].x) / 2 : MARGIN_X + LEAF_W / 2;
  return {
    boards,
    feeders,
    roots,
    utilityX,
    width: Math.max(left + MARGIN_X, 480),
    height: rootY + maxDepth * levelH + 250, // room for load labels and result tags
    levelH,
    rootY
  };
}
