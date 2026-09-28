import { cables, cpcOf, defaultCpcMm2, getCable } from './cableTable';
import { DEFAULT_TRANSFORMER_XR, rOperatingOhmPerKm, runsOf, transformerImpedance, zMagnitude, type Impedance, type Status } from './electrical';
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
 * each incomer below adds its phase + protective conductor loop. */
export function earthLoopToBoard(project: Project, boardId: string, seen = new Set<string>()): Impedance {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board || seen.has(boardId)) return { r: 0, x: 0 };
  seen.add(boardId);
  if (!board.upstreamId) {
    return board.sourceKva && board.sourceImpedancePct
      ? transformerImpedance(board.sourceKva, board.sourceImpedancePct, project.voltageV, board.sourceXr ?? DEFAULT_TRANSFORMER_XR)
      : { r: 0, x: 0 };
  }
  const incomer = project.feeders.find((f) => f.boardId === board.upstreamId && f.feedsBoardId === board.id);
  const up = earthLoopToBoard(project, board.upstreamId, seen);
  if (!incomer) return up;
  const c = cableLoop(incomer);
  return { r: up.r + c.r, x: up.x + c.x };
}

export interface EarthingResult {
  feeder: Feeder;
  cpcMm2: number;
  zeOhm: number; // loop impedance at the supply board
  zsOhm: number; // loop impedance at the far end of the circuit
  faultA: number; // minimum earth fault current at the far end
  tripA: number; // current for instantaneous tripping (Ia)
  maxZsOhm: number; // largest Zs that still gives instantaneous tripping
  requiredS: number; // required disconnection time
  disconnection: Status; // ok: trips instantaneously; warn: 5 s circuit relying on the thermal region; bad: too slow
  adiabaticMinMm2: number; // minimum protective conductor size for the fault energy
  adiabatic: 'ok' | 'bad';
  status: Status;
}

export function evaluateEarthing(project: Project, f: Feeder): EarthingResult {
  const u0 = project.voltageV / SQRT3;
  const ze = earthLoopToBoard(project, f.boardId);
  const c = cableLoop(f);
  const zs = { r: ze.r + c.r, x: ze.x + c.x };
  const zsOhm = zMagnitude(zs);
  const faultA = (C_MIN * u0) / zsOhm;
  const tripA = instantaneousTripA(f);
  const requiredS = requiredDisconnectionS(f);

  const instantaneous = faultA >= tripA;
  const disconnection: Status = instantaneous ? 'ok' : requiredS >= 5 ? 'warn' : 'bad';

  // Fault duration for the adiabatic check: 0.1 s when the breaker trips
  // instantaneously (conservative for MCCBs), otherwise the full required
  // disconnection time.
  const t = instantaneous ? 0.1 : requiredS;
  const cpcMm2 = cpcOf(f);
  const adiabaticMinMm2 = (faultA * Math.sqrt(t)) / K_CPC_XLPE_CU;
  const adiabatic = cpcMm2 >= adiabaticMinMm2 ? 'ok' : 'bad';

  const status: Status = disconnection === 'bad' || adiabatic === 'bad' ? 'bad' : disconnection;
  return {
    feeder: f,
    cpcMm2,
    zeOhm: zMagnitude(ze),
    zsOhm,
    faultA,
    tripA,
    maxZsOhm: (C_MIN * u0) / tripA,
    requiredS,
    disconnection,
    adiabaticMinMm2,
    adiabatic,
    status
  };
}

export function evaluateEarthingAll(project: Project): EarthingResult[] {
  return project.feeders.map((f) => evaluateEarthing(project, f));
}
