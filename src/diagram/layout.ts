import type { Board, Feeder, Project } from '../types';

/** Horizontal slot per load, vertical distance between board levels. */
export const LEAF_W = 132;
export const LEVEL_H = 270;
export const ROOT_BUS_Y = 210;
const MARGIN_X = 36;

export interface BoardNode {
  board: Board;
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
}

/** Tree layout of the whole network: each load takes one LEAF_W slot, a
 * sub-board takes as many slots as it has loads (recursively), and every
 * board is centred over its own feeders. Boards not reachable from a main
 * board are laid out as extra roots so nothing silently disappears. */
export function layoutSystem(project: Project): SystemLayout {
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const children = (boardId: string) => project.feeders.filter((f) => f.boardId === boardId);
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
    const busY = ROOT_BUS_Y + depth * LEVEL_H;
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
    height: ROOT_BUS_Y + maxDepth * LEVEL_H + 190
  };
}
