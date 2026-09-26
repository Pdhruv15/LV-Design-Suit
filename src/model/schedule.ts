import { circuitRef, circuitWatts, dominantLoadType, nextFreeSlot, scheduleCircuits, SINGLE_PHASES } from '../calc/loadSchedule';
import { applyRecommendation, recommend } from '../calc/sizing';
import type { Feeder, Phase, Project } from '../types';

/** Feeder id for a schedule circuit: board + circuit reference, e.g. DB-GF1-R3. */
const circuitId = (boardId: string, phase: Phase, way: number) => `${boardId}-${phase}${way}`;

const replaceFeeder = (p: Project, id: string, f: Feeder): Project => ({ ...p, feeders: p.feeders.map((x) => (x.id === id ? f : x)) });

/** Re-derive a circuit's load from its points and, unless the user fixed
 * the sizes by hand, size its MCB, breaking capacity and wire. */
function refresh(project: Project, f: Feeder): Feeder {
  const board = project.boards.find((b) => b.id === f.boardId);
  const next: Feeder = { ...f, loadKw: circuitWatts(f, board) / 1000, loadType: dominantLoadType(f, board) };
  if (next.manualSize) return next;
  const tmp = replaceFeeder(project, f.id, next);
  return applyRecommendation(next, recommend(tmp, next, 'optimise'));
}

export function addCircuit(project: Project, boardId: string, phase?: Phase): { project: Project; id: string } {
  const slot = nextFreeSlot(project, boardId, phase);
  const id = circuitId(boardId, slot.phase, slot.way);
  const f: Feeder = {
    id, boardId, name: '', room: '', points: {},
    phase: slot.phase, way: slot.way,
    loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 20,
    cableCsaMm2: 2.5, cores: slot.phase === 'RYB' ? 4 : 2,
    breakerRatingA: 16, breakerIcuKa: 10, breakerType: 'C'
  };
  const withF = { ...project, feeders: [...project.feeders, f] };
  return { project: replaceFeeder(withF, id, refresh(withF, f)), id };
}

export type CircuitPatch = Partial<Pick<Feeder, 'room' | 'points' | 'remarks' | 'lengthM' | 'powerFactor' | 'demandFactor' | 'breakerRatingA' | 'breakerType' | 'cableCsaMm2' | 'cpcMm2' | 'breakerIcuKa' | 'manualSize'>>;

/** Applies an edit from the schedule. Changing MCB, wire or ECC by hand
 * marks the circuit as manually sized, so later load edits keep them. */
export function updateCircuit(project: Project, id: string, patch: CircuitPatch): Project {
  const f = project.feeders.find((x) => x.id === id);
  if (!f) return project;
  const manual = ['breakerRatingA', 'cableCsaMm2', 'cpcMm2', 'breakerType'].some((k) => k in patch);
  const next: Feeder = {
    ...f,
    ...patch,
    name: patch.room !== undefined ? patch.room : f.name,
    manualSize: patch.manualSize ?? (manual ? true : f.manualSize)
  };
  return replaceFeeder(project, id, refresh(project, next));
}

export function deleteCircuit(project: Project, id: string): Project {
  return { ...project, feeders: project.feeders.filter((f) => f.id !== id) };
}

/** Re-sizes every auto-sized circuit on a board (e.g. after WATT/UNIT
 * values change, which alters every circuit's load). */
export function refreshBoard(project: Project, boardId: string): Project {
  let p = project;
  for (const f of scheduleCircuits(project, boardId)) p = replaceFeeder(p, f.id, refresh(p, p.feeders.find((x) => x.id === f.id)!));
  return p;
}

/** Spreads the single-phase circuits over R/Y/B to minimise the most loaded
 * phase (largest circuit first onto the lightest phase), then renumbers
 * ways so references stay compact: 3-phase circuits take the first ways,
 * single-phase circuits fill R/Y/B of the following ways. Circuit ids are
 * renamed to match their new references. */
export function balancePhases(project: Project, boardId: string): Project {
  const circuits = scheduleCircuits(project, boardId);
  const three = circuits.filter((f) => f.phase === 'RYB');
  const single = circuits.filter((f) => f.phase !== 'RYB').sort((a, b) => b.loadKw * b.demandFactor - a.loadKw * a.demandFactor);

  const load = { R: 0, Y: 0, B: 0 };
  const byPhase: Record<'R' | 'Y' | 'B', Feeder[]> = { R: [], Y: [], B: [] };
  for (const f of single) {
    // Lightest phase; ties go to the phase with fewer circuits so ways fill evenly.
    const p = [...SINGLE_PHASES].sort((a, b) => load[a] - load[b] || byPhase[a].length - byPhase[b].length)[0];
    load[p] += f.loadKw * f.demandFactor;
    byPhase[p].push(f);
  }

  const renamed = new Map<string, Feeder>();
  three.forEach((f, i) => renamed.set(f.id, { ...f, phase: 'RYB', way: i + 1 }));
  for (const p of SINGLE_PHASES) byPhase[p].forEach((f, i) => renamed.set(f.id, { ...f, phase: p, way: three.length + i + 1 }));

  const feeders = project.feeders.map((f) => {
    const r = renamed.get(f.id);
    return r ? { ...r, id: circuitId(boardId, r.phase!, r.way!) } : f;
  });
  return { ...project, feeders };
}

export { circuitRef };
