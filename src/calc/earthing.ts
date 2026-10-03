import { cables, cpcOf, defaultCpcMm2, getCable } from './cableTable';
import { DEFAULT_TRANSFORMER_XR, rOperatingOhmPerKm, runsOf, transformerImpedance, zMagnitude, type Impedance, type Status } from './electrical';
import { elcbGroups, isScheduleCircuit } from './loadSchedule';
import type { BreakerType, Feeder, Project } from '../types';

const SQRT3 = Math.sqrt(3);

/** Minimum voltage factor for LV fault calculations (IEC 60909): the
 * lowest fault current is what decides whether the breaker trips in time. */
export const C_MIN = 0.95;

/** k for a copper protective conductor incorporated in an XLPE multicore
 * cable (IEC 60364-5-54 Table A.54.3), used in the adiabatic check. */
export const K_CPC_XLPE_CU = 143;

// Protective conductor sizes live with the cable data (used by the tray
// schedule too); re-exported here where the earthing study always had them.
export { cpcOf, defaultCpcMm2 };

export function breakerTypeOf(f: Feeder): BreakerType {
  return f.breakerType ?? (f.breakerRatingA <= 63 ? 'C' : 'MCCB');
}

/** Current that guarantees instantaneous (magnetic) tripping, i.e. the
 * upper edge of the magnetic band: 5/10/20 In for MCB types B/C/D
 * (IEC 60898-1), the Im setting for MCCB/ACB (IEC 60947-2). */
export function instantaneousTripA(f: Feeder): number {
  switch (breakerTypeOf(f)) {
    case 'B':
      return 5 * f.breakerRatingA;
    case 'C':
      return 10 * f.breakerRatingA;
    case 'D':
      return 20 * f.breakerRatingA;
    default:
      return (f.breakerImMultiple ?? 10) * f.breakerRatingA;
  }
}

/** IEC 60364-4-41 Table 41.1 / 411.3.2.3 for TN systems at 230 V to earth:
 * final circuits up to 63 A must disconnect in 0.4 s; distribution
 * circuits and larger final circuits in 5 s. */
export function requiredDisconnectionS(f: Feeder): number {
  return !f.feedsBoardId && f.breakerRatingA <= 63 ? 0.4 : 5;
}

/** Phase + protective conductor loop impedance of one cable run. */
function cableLoop(f: Feeder): Impedance {
  const km = f.lengthM / 1000;
  return {
    // Each run carries its own protective conductor, in parallel too.
    r: ((rOperatingOhmPerKm(f.cableCsaMm2) + rOperatingOhmPerKm(cpcOf(f))) * km) / runsOf(f),
    x: (getCable(f.cableCsaMm2).xOhmPerKm * km) / runsOf(f)
  };
}

/** Earth fault loop impedance at a board's busbar (TN-S). At the main
 * board this is the transformer's own impedance (Dyn transformer with
 * Z0 ≈ Z1, so a phase-earth fault at its terminals ≈ the 3-phase fault);
 * each incomer below adds its phase + protective conductor loop.
 * `missing` says why the path is incomplete (no source data, a missing
 * board or incomer, a loop in the board tree): z is then only the part
 * that is known — a lower bound, never a verified Ze. */
export function earthLoopPath(project: Project, boardId: string, seen = new Set<string>()): { z: Impedance; missing?: string } {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board) return { z: { r: 0, x: 0 }, missing: `board ${boardId} not found` };
  if (seen.has(boardId)) return { z: { r: 0, x: 0 }, missing: `the supply path loops back to ${boardId}` };
  seen.add(boardId);
  if (!board.upstreamId) {
    return board.sourceKva && board.sourceImpedancePct
      ? { z: transformerImpedance(board.sourceKva, board.sourceImpedancePct, project.voltageV, board.sourceXr ?? DEFAULT_TRANSFORMER_XR) }
      : { z: { r: 0, x: 0 }, missing: `no source data at ${board.id} (transformer kVA and impedance %)` };
  }
  const up = earthLoopPath(project, board.upstreamId, seen);
  const incomer = project.feeders.find((f) => f.boardId === board.upstreamId && f.feedsBoardId === board.id);
  if (!incomer) return { z: up.z, missing: up.missing ?? `no incomer feeder from ${board.upstreamId} to ${board.id}` };
  const c = cableLoop(incomer);
  return { z: { r: up.z.r + c.r, x: up.z.x + c.x }, ...(up.missing ? { missing: up.missing } : {}) };
}

/** Known part of the loop impedance at a board (see earthLoopPath for whether it is complete). */
export function earthLoopToBoard(project: Project, boardId: string): Impedance {
  return earthLoopPath(project, boardId).z;
}

export interface EarthingResult {
  feeder: Feeder;
  cpcMm2: number;
  zeOhm: number; // loop impedance at the supply board
  zsOhm: number; // loop impedance at the far end of the circuit
  faultA: number; // minimum earth fault current at the far end
  tripA: number; // current for instantaneous tripping (Ia): the breaker's magnetic trip, or 5 × IΔn with an RCD
  rcdMa?: number; // earth leakage protection on the circuit (its own, or the DB's ELCB group)
  maxZsOhm: number; // largest Zs that still gives instantaneous tripping
  requiredS: number; // required disconnection time
  disconnection: Status; // ok: trips instantaneously; warn: 5 s circuit relying on the thermal region; bad: too slow
  /** Minimum area of each protective conductor for the fault energy, from the current through it
   * (cpcCurrentA): the whole fault current for one run; for parallel runs, its equal share (ENG-012). */
  adiabaticMinMm2: number;
  /** ok: one CPC carries the whole fault current (also covers a fault inside one run); warn: passes only
   * if the fault current shares equally between identical runs bonded at both ends (assumed, not
   * verified); bad: too small even with equal sharing. */
  adiabatic: Status;
  runs: number;
  /** Current through each protective conductor in the modelled end-of-circuit fault (equal sharing). */
  cpcCurrentA: number;
  /** One CPC carrying the whole fault current (worst case, e.g. a fault within one run). */
  adiabaticWholeMm2: number;
  /** For parallel runs: what the thermal result assumes. */
  adiabaticNote?: string;
  /** Why the loop to the supply is incomplete. Zs, If and the thermal check are then only the known
   * part (If is an upper bound); nothing is shown as verified. */
  sourceMissing?: string;
  status: Status;
}

export function evaluateEarthing(project: Project, f: Feeder): EarthingResult {
  const u0 = project.voltageV / SQRT3;
  const { z: ze, missing: sourceMissing } = earthLoopPath(project, f.boardId);
  const c = cableLoop(f);
  const zs = { r: ze.r + c.r, x: ze.x + c.x };
  const zsOhm = zMagnitude(zs);
  // Incomplete path: the known loop only gives an upper bound on If (more impedance only lowers it), so it
  // can prove a failure but never a pass. No loop impedance at all: no figure, not Infinity.
  const faultA = zsOhm > 0 ? (C_MIN * u0) / zsOhm : NaN;
  // An RCD (feeder's own, or the ELCB of a DB's final-circuit group) trips
  // within 40 ms at 5 × IΔn (IEC 61008 / 61009), far below a breaker's
  // magnetic threshold.
  const rcdMa = rcdOf(project, f);
  const tripA = rcdMa ? Math.min(instantaneousTripA(f), (5 * rcdMa) / 1000) : instantaneousTripA(f);
  const requiredS = requiredDisconnectionS(f);

  const instantaneous = faultA >= tripA;
  const disconnection: Status = sourceMissing
    ? (Number.isFinite(faultA) && !instantaneous && requiredS < 5 ? 'bad' : 'warn')
    : instantaneous ? 'ok' : requiredS >= 5 ? 'warn' : 'bad';

  // Fault duration for the adiabatic check: 0.1 s when the breaker trips
  // instantaneously (conservative for MCCBs), otherwise the full required
  // disconnection time.
  const t = instantaneous ? 0.1 : requiredS;
  // Adiabatic check, S ≥ I × √t ÷ k, with I the current through the conductor checked. The loop above
  // models identical parallel runs, each with its own CPC, in parallel to a fault at the far end — so
  // each CPC carries 1 ÷ runs of the total there. Whether that holds for every fault (a fault inside one
  // run, unequal runs, a shared CPC) isn't known from the data, so a pass that relies on sharing is only
  // 'warn'. The total fault current still sets the disconnection check above.
  const cpcMm2 = cpcOf(f);
  const runs = runsOf(f);
  const cpcCurrentA = faultA / runs;
  const adiabaticWholeMm2 = (faultA * Math.sqrt(t)) / K_CPC_XLPE_CU;
  const adiabaticMinMm2 = (cpcCurrentA * Math.sqrt(t)) / K_CPC_XLPE_CU;
  // Unknown fault current and duration: the thermal check can't be decided either way.
  const adiabatic: Status = sourceMissing ? 'warn' : cpcMm2 >= adiabaticWholeMm2 ? 'ok' : cpcMm2 >= adiabaticMinMm2 ? 'warn' : 'bad';
  const adiabaticNote = runs > 1
    ? `${runs} parallel runs: each ${cpcMm2} mm² CPC carries ${cpcCurrentA.toFixed(0)} A of the ${faultA.toFixed(0)} A end-of-circuit fault (needs ${adiabaticMinMm2.toFixed(1)} mm² each, ${(adiabaticMinMm2 * runs).toFixed(1)} of ${cpcMm2 * runs} mm² together). Assumes identical runs and lengths bonded at both ends; ${adiabatic === 'ok' ? 'one CPC alone also carries the whole fault current, so a fault within one run is covered too' : `not verified for a fault within one run, unequal runs or a shared CPC (one CPC alone would need ${adiabaticWholeMm2.toFixed(1)} mm²)`}.`
    : undefined;

  const status: Status = disconnection === 'bad' || adiabatic === 'bad' ? 'bad' : disconnection === 'warn' || adiabatic === 'warn' ? 'warn' : 'ok';
  return {
    feeder: f,
    cpcMm2,
    zeOhm: zMagnitude(ze),
    zsOhm,
    faultA,
    tripA,
    ...(rcdMa ? { rcdMa } : {}),
    maxZsOhm: (C_MIN * u0) / tripA,
    requiredS,
    disconnection,
    adiabaticMinMm2,
    adiabatic,
    runs,
    cpcCurrentA,
    adiabaticWholeMm2,
    ...(adiabaticNote ? { adiabaticNote } : {}),
    ...(sourceMissing ? { sourceMissing } : {}),
    status
  };
}

/** The disconnection result in words — the same on the page and in the reports. */
export function disconnectionLabel(r: EarthingResult): string {
  if (r.sourceMissing) return r.disconnection === 'bad' ? 'Too slow (even without the missing source impedance)' : 'Not verified — supply loop incomplete';
  return r.disconnection === 'ok' ? '< 0.1 s' : r.disconnection === 'warn' ? 'Thermal — check curve' : 'Too slow';
}
/** Ze, Zs and If as text: an incomplete loop shows Ze unknown, Zs as a minimum and If as a maximum. */
export function loopFigures(r: EarthingResult, d = 4): { ze: string; zs: string; fault: string } {
  if (!r.sourceMissing) return { ze: r.zeOhm.toFixed(d), zs: r.zsOhm.toFixed(d), fault: r.faultA.toFixed(0) };
  return { ze: 'unknown', zs: `≥ ${r.zsOhm.toFixed(d)}`, fault: Number.isFinite(r.faultA) ? `≤ ${r.faultA.toFixed(0)}` : '—' };
}

const elcbCache = new WeakMap<Project, Map<string, number>>();
/** Earth leakage protection of a circuit (mA): its own RCD, else the ELCB
 * group of its DB when it is a load schedule circuit. */
export function rcdOf(project: Project, f: Feeder): number | undefined {
  if (f.rcdMa) return f.rcdMa;
  if (!isScheduleCircuit(f)) return undefined;
  let m = elcbCache.get(project);
  if (!m) {
    m = new Map();
    for (const b of project.boards) for (const g of elcbGroups(project, b)) for (const c of g.circuits) m.set(c.id, g.sensitivityMa);
    elcbCache.set(project, m);
  }
  return m.get(f.id);
}

export function evaluateEarthingAll(project: Project): EarthingResult[] {
  return project.feeders.map((f) => evaluateEarthing(project, f));
}
