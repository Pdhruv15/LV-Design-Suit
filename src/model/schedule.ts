import { circuitCategory, circuitRef, circuitWatts, dominantLoadType, minWireMm2, nextFreeSlot, scheduleCircuits, SINGLE_PHASES } from '../calc/loadSchedule';
import { applyRecommendation, recommend } from '../calc/sizing';
import type { Feeder, Phase, Project } from '../types';

/** Feeder id for a schedule circuit: board + circuit reference, e.g. DB-GF1-R3. */
const circuitId = (boardId: string, phase: Phase, way: number) => `${boardId}-${phase}${way}`;

const replaceFeeder = (p: Project, id: string, f: Feeder): Project => ({ ...p, feeders: p.feeders.map((x) => (x.id === id ? f : x)) });

/** Re-derive a circuit's load from its points and, unless the user fixed
 * the sizes by hand, size its MCB, breaking capacity and wire — never below
 * the minimum wire for its type (lighting / power, project settings). A
 * larger wire always still passes ampacity and voltage drop. */
function refresh(project: Project, f: Feeder): Feeder {
  const board = project.boards.find((b) => b.id === f.boardId);
  const next: Feeder = { ...f, loadKw: circuitWatts(f, board) / 1000, loadType: dominantLoadType(f, board) };
  if (next.manualSize) return next;
  const tmp = replaceFeeder(project, f.id, next);
  const sized = applyRecommendation(next, recommend(tmp, next, 'optimise'));
  const min = minWireMm2(project, sized);
  return sized.cableCsaMm2 < min ? { ...sized, cableCsaMm2: min, cpcMm2: undefined } : sized;
}

/** Adds a circuit in the next free slot, or in the given slot (phase and
 * way) when the user types into an empty row of the schedule. */
export function addCircuit(project: Project, boardId: string, phase?: Phase, way?: number): { project: Project; id: string } {
  const slot = phase && way ? { phase, way } : nextFreeSlot(project, boardId, phase);
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

/** Spreads the circuits over R/Y/B and renumbers the ways:
 *  - lighting circuits take the first ways, power circuits follow, and each
 *    section starts on an ELCB boundary (3 or 6 circuits), so no ELCB mixes
 *    lighting (100 mA) and power (30 mA) — spare slots are left if needed;
 *  - within a section, largest circuit first onto the lightest phase (phase
 *    totals carry over between sections, so the whole DB balances);
 *  - 3-phase circuits are power and take whole ways at the start of the
 *    power section.
 * Circuit ids are renamed to match their new references. */
export function balancePhases(project: Project, boardId: string): Project {
  const board = project.boards.find((b) => b.id === boardId);
  const waysPerGroup = Math.max(1, (board?.elcbGroupSize ?? 6) / 3);
  const circuits = scheduleCircuits(project, boardId);
  const kw = (f: Feeder) => f.loadKw * f.demandFactor;
  const load = { R: 0, Y: 0, B: 0 };
  const renamed = new Map<string, Feeder>();
  let startWay = 1;

  for (const cat of ['lighting', 'power'] as const) {
    const inCat = circuits.filter((f) => circuitCategory(f) === cat);
    if (!inCat.length) continue;
    const three = inCat.filter((f) => f.phase === 'RYB');
    const single = inCat.filter((f) => f.phase !== 'RYB').sort((a, b) => kw(b) - kw(a));
    three.forEach((f, i) => {
      renamed.set(f.id, { ...f, phase: 'RYB', way: startWay + i });
      SINGLE_PHASES.forEach((p) => (load[p] += kw(f) / 3));
    });
    const byPhase: Record<'R' | 'Y' | 'B', Feeder[]> = { R: [], Y: [], B: [] };
    for (const f of single) {
      // Lightest phase; ties go to the phase with fewer circuits so ways fill evenly.
      const p = [...SINGLE_PHASES].sort((a, b) => load[a] - load[b] || byPhase[a].length - byPhase[b].length)[0];
      load[p] += kw(f);
      byPhase[p].push(f);
    }
    const first = startWay + three.length;
    for (const p of SINGLE_PHASES) byPhase[p].forEach((f, i) => renamed.set(f.id, { ...f, phase: p, way: first + i }));
    const used = three.length + Math.max(...SINGLE_PHASES.map((p) => byPhase[p].length));
    startWay += Math.ceil(used / waysPerGroup) * waysPerGroup; // next section starts on an ELCB boundary
  }

  const feeders = project.feeders.map((f) => {
    const r = renamed.get(f.id);
    return r ? { ...r, id: circuitId(boardId, r.phase!, r.way!) } : f;
  });
  return { ...project, feeders };
}

export { circuitRef };
