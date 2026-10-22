import type { Board, Project } from '../types';
import { roleOf } from '../model/emergency';
import { isScheduleCircuit } from '../calc/loadSchedule';
import type { SymbolId } from './symbolLibrary';

const PANEL_SYM: Record<string, SymbolId> = {
  MDB: 'p-mdb', 'LV-MDB': 'p-mdb', EMDB: 'p-mdb', SMDB: 'p-smdb', ESMDB: 'p-smdb', DB: 'p-db', EDB: 'p-edb', MCC: 'p-mcc', EMCC: 'p-mcc'
};

/** Panel symbol for a board drawn as one box: by its role, or APFC when every
 * way on it is a capacitor bank. Meter cabinets and UPS boards have none. */
export function panelSymbolOf(project: Project, b: Board): SymbolId | undefined {
  const ways = project.feeders.filter((f) => f.boardId === b.id && !isScheduleCircuit(f));
  if (ways.length && ways.every((f) => !f.feedsBoardId && f.loadType === 'capacitor')) return 'p-apfc';
  return PANEL_SYM[roleOf(project, b)];
}

/** Boards drawn on the SLD as one panel box at the end of their feeder
 * (`Board.sldBox`): sub-boards with a panel symbol only. */
export const boxedBoardIds = (project: Project) =>
  new Set(project.boards.filter((b) => b.sldBox && b.upstreamId && panelSymbolOf(project, b)).map((b) => b.id));

/** Boards left off the SLD: those drawn as one box and everything below them. */
export function hiddenBoardIds(project: Project): Set<string> {
  const out = boxedBoardIds(project);
  for (let grew = true; grew;) {
    grew = false;
    for (const b of project.boards) if (b.upstreamId && out.has(b.upstreamId) && !out.has(b.id)) { out.add(b.id); grew = true; }
  }
  return out;
}
