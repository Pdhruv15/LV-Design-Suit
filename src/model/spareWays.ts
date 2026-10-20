import { nextFreeSlot } from '../calc/loadSchedule';
import type { Board, Feeder, Phase, Project, SpareWay } from '../types';

/** Spares (a breaker fitted, nothing connected) and spaces (an empty way kept
 * for a future breaker) on a board. They are kept on the board, not as
 * feeders, so no study, cable schedule or demand figure sees them; the
 * schedules, SLD, BOQ and enclosure counts read them from here.
 *  - DB / EDB: each takes a slot of the load schedule (R1, Y1 … RYB2), so
 *    new circuits and Balance phases leave it alone.
 *  - MDB / SMDB / MCC (and emergency panels): listed after the outgoing
 *    feeders; phase RYB = TP, R / Y / B = SP. */

/** Boards with a load schedule of final circuits (DB, EDB) rather than outgoing feeders. */
export const isDbBoard = (b: Board) => (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')) === 'DB';

export const spareWaysOf = (b: Board): SpareWay[] => b.spareWays ?? [];

const PHASE_ORDER: Record<Phase, number> = { R: 0, Y: 1, B: 2, RYB: 0 };
/** A DB's spares and spaces in schedule order (way, then R, Y, B). */
export const dbSpares = (b: Board): SpareWay[] =>
  spareWaysOf(b).filter((s) => s.way).sort((a, c) => a.way! - c.way! || PHASE_ORDER[a.phase] - PHASE_ORDER[c.phase]);

export const spareLabel = (s: SpareWay) => (s.kind === 'spare' ? 'SPARE' : 'SPACE');
/** Circuit reference on a DB: phase + way, e.g. B3 or RYB4. */
export const spareRef = (s: SpareWay) => (s.way ? `${s.phase}${s.way}` : '');

/** Default breaker of a new spare (or the breaker a space is kept for). */
function defaults(project: Project, board: Board, phase: Phase): Pick<SpareWay, 'ratingA' | 'icuKa' | 'device'> {
  if (isDbBoard(board)) return { ratingA: phase === 'RYB' ? 32 : 20, icuKa: 10 };
  const out = project.feeders.filter((f) => f.boardId === board.id && !f.phase);
  const icuKa = out.reduce((m, f) => Math.max(m, f.breakerIcuKa), 0) || 36;
  return phase === 'RYB' ? { ratingA: 100, icuKa, device: 'MCCB' } : { ratingA: 32, icuKa, device: 'MCCB' };
}

const withSpares = (project: Project, boardId: string, list: SpareWay[]): Project => ({
  ...project,
  boards: project.boards.map((b) => (b.id === boardId ? { ...b, spareWays: list.length ? list : undefined } : b))
});

export interface SpareResult { project: Project; message: string; id?: string }

/** Adds a spare or a space: on a DB in the next free slot (a 3-phase one on a
 * whole free way); on a feeder panel at the end, TP unless a phase is given. */
export function addSpareWay(project: Project, boardId: string, kind: SpareWay['kind'], phase?: Phase): SpareResult {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board) return { project, message: `${boardId} is no longer in the project` };
  const list = spareWaysOf(board);
  let n = list.length + 1;
  while (list.some((s) => s.id === `sp${n}`)) n++;
  const db = isDbBoard(board);
  const slot = db ? nextFreeSlot(project, boardId, phase) : { phase: phase ?? 'RYB', way: undefined };
  const s: SpareWay = { id: `sp${n}`, kind, phase: slot.phase, ...(slot.way ? { way: slot.way } : {}), ...defaults(project, board, slot.phase) };
  const where = db ? ` as ${spareRef(s)}` : '';
  const what = kind === 'spare' ? `a spare ${s.ratingA} A ${s.phase === 'RYB' ? 'TP' : 'SP'} breaker` : `a ${s.phase === 'RYB' ? 'TP' : 'SP'} space`;
  return { project: withSpares(project, boardId, [...list, s]), message: `Added ${what} to ${boardId}${where}`, id: s.id };
}

export type SparePatch = Partial<Pick<SpareWay, 'ratingA' | 'device' | 'icuKa' | 'remarks' | 'phase'>>;

export function updateSpareWay(project: Project, boardId: string, id: string, patch: SparePatch): Project {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board || !spareWaysOf(board).some((s) => s.id === id)) return project;
  return withSpares(project, boardId, spareWaysOf(board).map((s) => {
    if (s.id !== id) return s;
    const next: SpareWay = { ...s, ...patch };
    for (const k of Object.keys(patch) as (keyof SpareWay)[]) if (patch[k as keyof SparePatch] === undefined) delete next[k];
    return next;
  }));
}

export function deleteSpareWay(project: Project, boardId: string, id: string): SpareResult {
  const board = project.boards.find((b) => b.id === boardId);
  const s = board && spareWaysOf(board).find((x) => x.id === id);
  if (!board || !s) return { project, message: 'That spare / space is no longer on the board' };
  return { project: withSpares(project, boardId, spareWaysOf(board).filter((x) => x.id !== id)), message: `Deleted ${spareLabel(s).toLowerCase()} ${spareRef(s) || ''} from ${boardId}`.replace(/\s+from/, ' from') };
}

/** After the circuits are renumbered (Balance phases): the spares and spaces
 * take the free slots after them, in their old order, 3-phase ones on whole ways. */
export function reslotSpares(project: Project, boardId: string): Project {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board || !isDbBoard(board) || !board.spareWays?.length) return project;
  const old = [...dbSpares(board), ...spareWaysOf(board).filter((s) => !s.way)];
  let p = withSpares(project, boardId, []);
  const placed: SpareWay[] = [];
  for (const s of old) {
    const slot = nextFreeSlot(p, boardId, s.phase === 'RYB' ? 'RYB' : undefined);
    placed.push({ ...s, phase: slot.phase, way: slot.way });
    p = withSpares(p, boardId, placed);
  }
  return p;
}

/** A spare's breaker in feeder form, for the BOQ, Form-4 and enclosure device lists
 * (never added to the project: no load, no cable). */
export function spareBreaker(board: Board, s: SpareWay): Feeder {
  return {
    id: `${board.id}:${s.id}`, boardId: board.id, name: spareLabel(s),
    loadKw: 0, demandFactor: 1, powerFactor: 1, lengthM: 0, cableCsaMm2: 0,
    cores: s.phase === 'RYB' ? 4 : 2,
    breakerRatingA: s.ratingA, breakerIcuKa: s.icuKa ?? 10,
    ...(isDbBoard(board) ? { phase: s.phase, way: s.way } : {}),
    ...(s.device ? { device: s.device } : {})
  };
}
