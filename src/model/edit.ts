import type { Project } from '../types';
import { removeDanglingReferences } from './integrity';

/** A board and every board fed from it, directly or further down. */
export function boardAndDescendants(project: Project, boardId: string): Set<string> {
  const out = new Set<string>([boardId]);
  let added = true;
  while (added) {
    added = false;
    for (const b of project.boards) {
      if (b.upstreamId && out.has(b.upstreamId) && !out.has(b.id)) {
        out.add(b.id);
        added = true;
      }
    }
  }
  return out;
}

/** Removes a board, all boards below it, every feeder on those boards, and
 * the incomer feeder that supplied it, and takes the panel out of sheets,
 * callouts, UPS links, couplers, reports and selections. The last main board
 * can't be removed (a project always has one). */
export function deleteBoard(project: Project, boardId: string): Project {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board) return project;
  if (!board.upstreamId && project.boards.filter((b) => !b.upstreamId).length <= 1) {
    throw new Error('A project needs at least one main board.');
  }
  const gone = boardAndDescendants(project, boardId);
  return removeDanglingReferences({
    ...project,
    boards: project.boards.filter((b) => !gone.has(b.id)),
    feeders: project.feeders.filter((f) => !gone.has(f.boardId) && !(f.feedsBoardId && gone.has(f.feedsBoardId)))
  });
}
