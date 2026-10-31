import type { Board, Project } from '../types';
import { roleOf } from '../model/emergency';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { isDbBoard, spareWaysOf } from '../model/spareWays';
import { isInterlocked } from '../model/changeover';
import type { SymbolId } from './symbolLibrary';
import { feedersOn } from '../calc/network';

const PANEL_SYM: Record<string, SymbolId> = {
  MDB: 'p-mdb', 'LV-MDB': 'p-mdb', 'LV-ACB': 'p-mdb', EMDB: 'p-mdb', 'LV-EMDB': 'p-mdb', SMDB: 'p-smdb', ESMDB: 'p-smdb', DB: 'p-db', EDB: 'p-edb', MCC: 'p-mcc', EMCC: 'p-mcc'
};

const waysOf = (project: Project, b: Board) => feedersOn(project, b.id).filter((f) => !isScheduleCircuit(f));
const capacitorsOnly = (ways: Project['feeders']) => ways.length > 0 && ways.every((f) => !f.feedsBoardId && f.loadType === 'capacitor');

/** Panel symbol for a board drawn as one box: by its role, or APFC when every
 * way on it is a capacitor bank. Meter cabinets and UPS boards have none. */
export function panelSymbolOf(project: Project, b: Board): SymbolId | undefined {
  return capacitorsOnly(waysOf(project, b)) ? 'p-apfc' : PANEL_SYM[roleOf(project, b)];
}

/** Boards at the end of the tree, drawn on the SLD as one panel box at the end
 * of their feeder: sub-boards with a panel symbol and no ways of their own on
 * the SLD (final circuits stay on the load schedule; an APFC panel's steps
 * are inside it). A panel feeding other ways keeps its busbar. */
export const boxedBoardIds = (project: Project) =>
  new Set(project.boards.filter((b) => {
    if (!b.upstreamId || isInterlocked(b) || !panelSymbolOf(project, b)) return false;
    const ways = waysOf(project, b);
    return (ways.length === 0 || capacitorsOnly(ways)) && (isDbBoard(b) || spareWaysOf(b).length === 0);
  }).map((b) => b.id));

/** Boards left off the SLD: those drawn as one box and everything below them. */
export function hiddenBoardIds(project: Project): Set<string> {
  const out = boxedBoardIds(project);
  for (let grew = true; grew;) {
    grew = false;
    for (const b of project.boards) if (b.upstreamId && out.has(b.upstreamId) && !out.has(b.id)) { out.add(b.id); grew = true; }
  }
  return out;
}
