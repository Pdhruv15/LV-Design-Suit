import { ambientCorrectionFactor, cables, getCable } from './cableTable';
import type { Board, Feeder, Project } from '../types';
import { boardPhaseKw } from './loadSchedule';

const SQRT3 = Math.sqrt(3);

/** Transformer X/R ratio used when the board doesn't specify one. Typical
 * for 500–2000 kVA distribution transformers; it only affects how the
 * transformer's %Z is split between R and X, not its magnitude. */
export const DEFAULT_TRANSFORMER_XR = 5;

/** Complex impedance in ohms. Series impedances are added as R+jX phasors
 * (not as scalar magnitudes), which matters once cable R dominates. */
export interface Impedance {
  r: number;
  x: number;
}

const addZ = (a: Impedance, b: Impedance): Impedance => ({ r: a.r + b.r, x: a.x + b.x });
export const zMagnitude = (z: Impedance): number => Math.hypot(z.r, z.x);

/** AC resistance at operating temperature, approximated with a flat 1.2x
 * factor over the 20°C IEC 60228 value to account for the rise to ~90°C
 * conductor temperature. Skin/proximity effect is ignored (negligible below
 * ~120 mm² and a reasonable simplification above it for this tool). */
export function rOperatingOhmPerKm(csaMm2: number): number {
  return getCable(csaMm2).rOhmPerKm20C * 1.2;
}

/** Total demand (kW) flowing through a board: the sum of its own end-load
 * feeders' demand, plus (recursively) the demand of every downstream board
 * fed through an incomer feeder on this board. */
export function boardDemandKw(project: Project, boardId: string): number {
  return project.feeders
    .filter((f) => f.boardId === boardId)
    .reduce((sum, f) => sum + (f.feedsBoardId ? boardDemandKw(project, f.feedsBoardId) : f.loadKw * f.demandFactor), 0);
}

/** Design current (A) for a feeder: balanced 3-phase for 3/4-core
 * circuits, phase-to-neutral for 2-core (single-phase) circuits. An incomer
 * feeder (feedsBoardId set) carries the downstream board's most loaded
 * phase: I = max(P_phase) ÷ (U0 · cos φ), which equals the balanced 3-phase
 * formula when the board's phases are balanced. */
export function designCurrentA(feeder: Feeder, project: Project): number {
  const u0 = project.voltageV / SQRT3;
  if (feeder.feedsBoardId) {
    const p = boardPhaseKw(project, feeder.feedsBoardId);
    return (Math.max(p.R, p.Y, p.B) * 1000) / (u0 * feeder.powerFactor);
  }
  // Capacitor bank: I = Q ÷ (√3 · U), from its kvar rating.
  if (feeder.kvar) return (feeder.kvar * 1000) / (SQRT3 * project.voltageV);
  const demandKw = feeder.loadKw * feeder.demandFactor;
  return feeder.cores >= 3
    ? (demandKw * 1000) / (SQRT3 * project.voltageV * feeder.powerFactor)
    : (demandKw * 1000) / (u0 * feeder.powerFactor);
}

/** Cable current rating after ambient temperature derating. Grouping and
 * installation-method correction factors are not modelled yet — apply them
 * manually until that's added. */
export function deratedAmpacityA(csaMm2: number, ambientC: number): number {
  return getCable(csaMm2).ampacityA * ambientCorrectionFactor(ambientC);
}

/** Voltage drop as a percentage of nominal: 3-phase circuits use
 * √3·I·Z against the line-to-line voltage; single-phase circuits use the
 * phase + neutral loop (2·I·Z) against the phase-to-neutral voltage. */
function vdPctFor(ib: number, csaMm2: number, lengthM: number, cores: 2 | 3 | 4, cosPhi: number, voltageV: number): number {
  const rOhmPerKm = rOperatingOhmPerKm(csaMm2);
  const xOhmPerKm = getCable(csaMm2).xOhmPerKm;
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  const threePhase = cores >= 3;
  const multiplier = threePhase ? SQRT3 : 2;
  const baseV = threePhase ? voltageV : voltageV / SQRT3;
  const vdVolts = (multiplier * ib * lengthM * (rOhmPerKm * cosPhi + xOhmPerKm * sinPhi)) / 1000;
  return (vdVolts / baseV) * 100;
}

/** Voltage drop in percent over this feeder's own cable run only. */
export function voltageDropPct(feeder: Feeder, project: Project): number {
  return vdPctFor(designCurrentA(feeder, project), feeder.cableCsaMm2, feeder.lengthM, feeder.cores, feeder.powerFactor, project.voltageV);
}

function findIncomer(project: Project, board: Board): Feeder | undefined {
  return project.feeders.find((f) => f.boardId === board.upstreamId && f.feedsBoardId === board.id);
}

/** Voltage drop (%) from the source to a board's busbar: the sum of the
 * drops on every incomer feeder in the chain above it. Zero for the main
 * board. DEWA/IEC limits apply to the total source-to-load drop, so this
 * is added to each feeder's own drop before comparing with the limit. */
export function upstreamVoltageDropPct(project: Project, boardId: string, seen = new Set<string>()): number {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board?.upstreamId || seen.has(boardId)) return 0;
  seen.add(boardId);
  const incomer = findIncomer(project, board);
  const own = incomer ? voltageDropPct(incomer, project) : 0;
  return own + upstreamVoltageDropPct(project, board.upstreamId, seen);
}

/** Picks the smallest standard cable size whose derated ampacity covers both
 * the design current and the breaker rating (so the breaker protects the
 * cable), and whose voltage drop fits the budget left for this feeder.
 * Returns null if nothing in the table satisfies both. */
export function selectCable(
  ib: number,
  lengthM: number,
  systemVoltageV: number,
  cores: 2 | 3 | 4,
  cosPhi: number,
  ambientC: number,
  vdBudgetPct: number,
  breakerRatingA = 0
): number | null {
  const requiredIz = Math.max(ib, breakerRatingA);
  for (const c of cables()) {
    const iz = c.ampacityA * ambientCorrectionFactor(ambientC);
    if (iz < requiredIz) continue;
    if (vdPctFor(ib, c.csaMm2, lengthM, cores, cosPhi, systemVoltageV) <= vdBudgetPct) return c.csaMm2;
  }
  return null;
}

/** Transformer source impedance referred to the LV side, split into R and X
 * using the given X/R ratio. |Z| = U² · uk% / S. */
export function transformerImpedance(sourceKva: number, impedancePct: number, voltageV: number, xr = DEFAULT_TRANSFORMER_XR): Impedance {
  const z = (voltageV * voltageV * (impedancePct / 100)) / (sourceKva * 1000);
  const r = z / Math.sqrt(1 + xr * xr);
  return { r, x: r * xr };
}

/** Cable phase impedance for a given length, at operating temperature. */
export function cableImpedance(csaMm2: number, lengthM: number): Impedance {
  return {
    r: rOperatingOhmPerKm(csaMm2) * (lengthM / 1000),
    x: getCable(csaMm2).xOhmPerKm * (lengthM / 1000)
  };
}

/** Impedance from the source (transformer) up to and including a board's
 * busbar, walking up the board hierarchy: main board -> transformer only;
 * any downstream board -> its parent's impedance plus its incomer cable. */
export function impedanceToBoard(project: Project, boardId: string, seen = new Set<string>()): Impedance {
  const board = project.boards.find((b) => b.id === boardId);
  const fallback = { r: 0, x: 0.01 };
  if (!board || seen.has(boardId)) return fallback;
  seen.add(boardId);

  if (!board.upstreamId) {
    return board.sourceKva && board.sourceImpedancePct
      ? transformerImpedance(board.sourceKva, board.sourceImpedancePct, project.voltageV, board.sourceXr)
      : fallback;
  }

  const incomer = findIncomer(project, board);
  const incomerZ = incomer ? cableImpedance(incomer.cableCsaMm2, incomer.lengthM) : { r: 0, x: 0 };
  return addZ(impedanceToBoard(project, board.upstreamId, seen), incomerZ);
}

/** Prospective symmetrical 3-phase fault current (kA rms) for a given
 * source-to-fault impedance. Voltage factor c = 1 and an infinite upstream
 * (MV) network are assumed — a first-pass estimate, not a full IEC 60909
 * study. */
export function faultCurrentKA(z: Impedance, systemVoltageV: number): number {
  const zm = zMagnitude(z);
  if (zm <= 0) return Infinity;
  return systemVoltageV / (SQRT3 * zm) / 1000;
}

export type Status = 'ok' | 'warn' | 'bad';

export interface FeederResult {
  feeder: Feeder;
  ib: number; // design current
  ampacity: number; // Iz, derated cable rating
  loadingPct: number; // Ib as % of breaker In
  vdPct: number; // this feeder's own cable run
  vdUpstreamPct: number; // source to this feeder's supply board
  vdTotalPct: number; // source to end of this feeder — compared with the limit
  vdStatus: Status;
  ampacityStatus: 'ok' | 'bad'; // Iz ≥ Ib
  /** Overload protection per IEC 60364-4-43: Ib ≤ In ≤ Iz. */
  protectionStatus: 'ok' | 'bad';
  /** Prospective fault at the breaker's own terminals (the supply board's
   * busbar) — the fault the breaker must be able to interrupt. */
  breakerFaultKA: number;
  /** Prospective fault at the far end of the cable (lower value; relevant
   * for minimum-fault / disconnection-time checks). 3-phase fault for
   * 3/4-core circuits, line-to-neutral for 2-core circuits. */
  endFaultKA: number;
  /** Breaker breaking capacity Icu ≥ fault at its terminals. */
  icuStatus: 'ok' | 'bad';
  status: Status;
}

export function evaluateFeeder(project: Project, feeder: Feeder): FeederResult {
  const ib = designCurrentA(feeder, project);
  const ampacity = deratedAmpacityA(feeder.cableCsaMm2, project.ambientC);
  const loadingPct = (ib / feeder.breakerRatingA) * 100;

  const vdPct = voltageDropPct(feeder, project);
  const vdUpstreamPct = upstreamVoltageDropPct(project, feeder.boardId);
  const vdTotalPct = vdUpstreamPct + vdPct;

  const zBoard = impedanceToBoard(project, feeder.boardId);
  const breakerFaultKA = faultCurrentKA(zBoard, project.voltageV);
  // Single-phase circuits: the fault at the far end is line-to-neutral, so
  // it flows through the phase and neutral conductors (2 × cable Z).
  const zCable = cableImpedance(feeder.cableCsaMm2, feeder.lengthM);
  const loop = feeder.cores >= 3 ? 1 : 2;
  const endFaultKA = faultCurrentKA(addZ(zBoard, { r: zCable.r * loop, x: zCable.x * loop }), project.voltageV);

  const vdStatus: Status = vdTotalPct > project.vdLimitPct ? 'bad' : vdTotalPct > project.vdLimitPct * 0.85 ? 'warn' : 'ok';
  const ampacityStatus = ampacity >= ib ? 'ok' : 'bad';
  const protectionStatus = ib <= feeder.breakerRatingA && feeder.breakerRatingA <= ampacity ? 'ok' : 'bad';
  const icuStatus = feeder.breakerIcuKa >= breakerFaultKA ? 'ok' : 'bad';
  const loadingStatus: Status = loadingPct > 100 ? 'bad' : loadingPct > 85 ? 'warn' : 'ok';

  const statuses: Status[] = [vdStatus, ampacityStatus, protectionStatus, icuStatus, loadingStatus];
  const status: Status = statuses.includes('bad') ? 'bad' : statuses.includes('warn') ? 'warn' : 'ok';

  return {
    feeder, ib, ampacity, loadingPct, vdPct, vdUpstreamPct, vdTotalPct, vdStatus,
    ampacityStatus, protectionStatus, breakerFaultKA, endFaultKA, icuStatus, status
  };
}

export function evaluateProject(project: Project): FeederResult[] {
  return project.feeders.map((f) => evaluateFeeder(project, f));
}
