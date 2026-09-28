import type { Board, Feeder, Project } from '../types';
import { boardAndDescendants } from './edit';

/** Copy a board with everything below it (sub-boards, feeders, load
 * schedule circuits) and paste it onto another busbar, renamed — e.g. the
 * ground floor SMDB and its DBs copied for the first floor. */

export interface Rename {
  /** Text replaced in ids (boards, feeders, circuits), e.g. "GF" → "FF". */
  idFind: string;
  idReplace: string;
  /** Text replaced in names and locations, e.g. "Ground floor" → "First floor". */
  nameFind: string;
  nameReplace: string;
}

/** A likely rename from a board id: the part after its type, e.g.
 * SMDB-GF → "GF". */
export function suggestRename(project: Project, boardId: string): Rename {
  const b = project.boards.find((x) => x.id === boardId);
  const tail = boardId.includes('-') ? boardId.slice(boardId.indexOf('-') + 1) : '';
  const name = b?.name ?? '';
  const words = name.split(/\s+/);
  return { idFind: tail, idReplace: '', nameFind: words.length > 1 ? words.slice(0, -1).join(' ') : '', nameReplace: '' };
}

const replaceAll = (s: string, find: string, rep: string) => (find ? s.split(find).join(rep) : s);

/** Case-insensitive replace for names, keeping the case of each match's
 * first letter: "Ground floor" / "ground floor" → "First floor" / "first floor". */
export function replaceWords(s: string, find: string, rep: string): string {
  if (!find) return s;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return s.replace(re, (m) => (rep && m[0] === m[0].toLowerCase() ? rep[0].toLowerCase() + rep.slice(1) : rep && m[0] === m[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep));
}

export interface PastePlan {
  /** Old board / feeder id → new id. */
  boards: Map<string, string>;
  feeders: Map<string, string>;
  rootId: string;
}

/** New ids for everything copied: the rename applied, or "-2", "-3"… when
 * it doesn't change an id or the id is taken. Circuit ids follow their
 * board (DB-GF1-R3 → DB-FF1-R3). */
export function planPaste(project: Project, sourceId: string, target: string, r: Rename): PastePlan {
  const tree = boardAndDescendants(project, sourceId);
  const taken = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id)]);
  const fresh = (base: string) => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  };
  const renamed = (id: string) => (r.idFind && r.idReplace !== r.idFind ? replaceAll(id, r.idFind, r.idReplace) : id);

  const boards = new Map<string, string>();
  for (const b of project.boards.filter((x) => tree.has(x.id))) boards.set(b.id, fresh(renamed(b.id)));

  const feeders = new Map<string, string>();
  const byBoardPrefix = (f: Feeder) => {
    const nb = boards.get(f.boardId);
    return nb && f.id.startsWith(`${f.boardId}-`) ? `${nb}${f.id.slice(f.boardId.length)}` : undefined;
  };
  for (const f of project.feeders.filter((x) => tree.has(x.boardId))) feeders.set(f.id, fresh(byBoardPrefix(f) ?? renamed(f.id)));
  const incomer = project.feeders.find((f) => f.feedsBoardId === sourceId && !tree.has(f.boardId));
  const rootId = boards.get(sourceId)!;
  if (incomer) feeders.set(incomer.id, fresh(renamed(incomer.id) !== incomer.id ? renamed(incomer.id) : `INC-${rootId}`));
  void target;
  return { boards, feeders, rootId };
}

export function pasteBoard(project: Project, sourceId: string, targetBusId: string, r: Rename): { project: Project; rootId: string; message: string } {
  const plan = planPaste(project, sourceId, targetBusId, r);
  const nameOf = (s?: string) => (s === undefined ? s : replaceWords(s, r.nameFind, r.nameReplace));
  const newBoards: Board[] = project.boards
    .filter((b) => plan.boards.has(b.id))
    .map((b) => {
      const copy: Board = { ...structuredClone(b), id: plan.boards.get(b.id)!, name: nameOf(b.name) ?? b.name, location: nameOf(b.location) };
      if (b.id === sourceId) {
        copy.upstreamId = targetBusId;
        delete copy.supply; // fed from the busbar it's pasted on
        delete copy.sourceKva;
        delete copy.sourceImpedancePct;
        delete copy.sourceXr;
      } else copy.upstreamId = plan.boards.get(b.upstreamId!) ?? b.upstreamId;
      if (copy.location === undefined) delete copy.location;
      return copy;
    });
  const newFeeders: Feeder[] = project.feeders
    .filter((f) => plan.feeders.has(f.id))
    .map((f) => {
      const isIncomer = f.feedsBoardId === sourceId && !plan.boards.has(f.boardId);
      const copy: Feeder = {
        ...structuredClone(f),
        id: plan.feeders.get(f.id)!,
        boardId: isIncomer ? targetBusId : plan.boards.get(f.boardId)!,
        name: nameOf(f.name) ?? f.name
      };
      if (f.feedsBoardId) copy.feedsBoardId = plan.boards.get(f.feedsBoardId) ?? f.feedsBoardId;
      return copy;
    });
  const circuits = newFeeders.filter((f) => f.phase && f.way).length;
  return {
    project: { ...project, boards: [...project.boards, ...newBoards], feeders: [...project.feeders, ...newFeeders] },
    rootId: plan.rootId,
    message: `Pasted ${newBoards.map((b) => b.id).join(', ')} on ${targetBusId}: ${newBoards.length} board${newBoards.length > 1 ? 's' : ''}, ${newFeeders.length - circuits} feeder${newFeeders.length - circuits === 1 ? '' : 's'}, ${circuits} circuit${circuits === 1 ? '' : 's'}`
  };
}
