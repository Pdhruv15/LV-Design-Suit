import { boardPhaseKw, isScheduleCircuit, nextFreeSlot, SINGLE_PHASES, type PhaseKw } from '../calc/loadSchedule';
import type { Feeder, Phase, Project } from '../types';
import { balancePhases } from './schedule';

/** R / Y / B on a board's own circuits, for the board-wise SLD:
 * which phase each circuit loads, moving a circuit to another phase, and
 * balancing a whole board (DB load schedule ways and other single-phase
 * feeders alike). Allocation as boardPhaseKw: a labelled single-phase circuit
 * on its phase, 3-phase circuits and unlabelled single-phase ones spread
 * evenly, an incomer carries the phase loads of the board it feeds. */

/** A single-phase (2-core) outgoing circuit, whose phase can be chosen. */
export const isSinglePhase = (f: Feeder) => f.cores === 2 && !f.feedsBoardId;

/** The phase tag shown on the drawing: R / Y / B, RYB for 3-phase, '' for a single-phase circuit with no phase. */
export function phaseTag(f: Feeder): Phase | '' {
  if (!isSinglePhase(f)) return 'RYB';
  return f.phase && f.phase !== 'RYB' ? f.phase : '';
}

/** Demand kW the circuit puts on each phase. */
export function feederPhaseKw(project: Project, f: Feeder): PhaseKw {
  if (f.feedsBoardId) return boardPhaseKw(project, f.feedsBoardId, new Set([f.boardId]));
  const kw = f.loadKw * f.demandFactor;
  const tag = phaseTag(f);
  if (tag && tag !== 'RYB') return { R: 0, Y: 0, B: 0, [tag]: kw };
  return { R: kw / 3, Y: kw / 3, B: kw / 3 };
}

/** The phase after this one, for a click on the tag: R → Y → B → R (unset → R). */
export const nextPhase = (p: Phase | ''): 'R' | 'Y' | 'B' => (p === 'R' ? 'Y' : p === 'Y' ? 'B' : 'R');

/** Moves a single-phase circuit to another phase. A load-schedule circuit
 * takes the first free way on that phase and is renamed to its new reference
 * (e.g. DB-GF1-R3 → DB-GF1-Y4); returns the circuit's id afterwards. */
export function setCircuitPhase(project: Project, id: string, phase: 'R' | 'Y' | 'B'): { project: Project; id: string } {
  const f = project.feeders.find((x) => x.id === id);
  if (!f || !isSinglePhase(f) || f.phase === phase) return { project, id };
  if (!isScheduleCircuit(f)) return { project: { ...project, feeders: project.feeders.map((x) => (x.id === id ? { ...x, phase } : x)) }, id };
  const others = { ...project, feeders: project.feeders.filter((x) => x.id !== id) };
  const slot = nextFreeSlot(others, f.boardId, phase);
  const newId = `${f.boardId}-${slot.phase}${slot.way}`;
  if (newId !== id && project.feeders.some((x) => x.id === newId)) return { project, id };
  return { project: { ...project, feeders: project.feeders.map((x) => (x.id === id ? { ...x, id: newId, phase: slot.phase, way: slot.way } : x)) }, id: newId };
}

/** Spreads a board's single-phase circuits over R / Y / B: load-schedule ways
 * first (balancePhases: lighting and power sections, renumbered), then each
 * other single-phase feeder, largest first, onto the phase that is lightest
 * with everything else on the board counted (sub-boards and 3-phase loads). */
export function balanceBoardPhases(project: Project, boardId: string): Project {
  let p = project.feeders.filter((f) => f.boardId === boardId && isScheduleCircuit(f)).length >= 2 ? balancePhases(project, boardId) : project;
  const own = p.feeders.filter((f) => f.boardId === boardId);
  const free = own.filter((f) => isSinglePhase(f) && !isScheduleCircuit(f)).sort((a, b) => b.loadKw * b.demandFactor - a.loadKw * a.demandFactor);
  if (!free.length) return p;
  const load: PhaseKw = { R: 0, Y: 0, B: 0 };
  for (const f of own) if (!free.includes(f)) { const k = feederPhaseKw(p, f); for (const ph of SINGLE_PHASES) load[ph] += k[ph]; }
  const set = new Map<string, 'R' | 'Y' | 'B'>();
  for (const f of free) {
    const ph = [...SINGLE_PHASES].sort((a, b) => load[a] - load[b])[0];
    load[ph] += f.loadKw * f.demandFactor;
    set.set(f.id, ph);
  }
  p = { ...p, feeders: p.feeders.map((f) => (set.has(f.id) ? { ...f, phase: set.get(f.id)! } : f)) };
  return p;
}
