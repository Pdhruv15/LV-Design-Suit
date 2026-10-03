import { ambientCorrectionFactor, cables, getCable } from './cableTable';
import { trayGrouping } from './cableTray';
import type { Board, Feeder, Project } from '../types';
import { boardPhasePQ, type PhasePQ } from './loadSchedule';

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
export function rOperatingOhmPerKm(csaMm2: number, tempC?: number): number {
  return getCable(csaMm2).rOhmPerKm20C * resistanceFactor(tempC);
}

/** R(θ) ÷ R(20 °C) for copper (α = 0.00393 /K). No temperature set: the
 * flat 1.2 used everywhere so far (≈ 70 °C). */
export const COPPER_ALPHA = 0.00393;
export const resistanceFactor = (tempC?: number) => (tempC === undefined ? 1.2 : 1 + COPPER_ALPHA * (tempC - 20));

/** Number of cable runs in parallel (at least 1). */
export const runsOf = (f: Pick<Feeder, 'parallel'>) => Math.max(1, Math.round(f.parallel ?? 1));

/** Cable as written on drawings and schedules, e.g. "2 × 4C × 240 mm²". */
export const cableSizeText = (f: Pick<Feeder, 'parallel' | 'cores' | 'cableCsaMm2'>) =>
  `${runsOf(f) > 1 ? `${runsOf(f)} × ` : ''}${f.cores}C × ${f.cableCsaMm2} mm²`;

/** Grouping factor for n multicore cables in parallel, touching, in one
 * layer on a tray (IEC 60364-5-52 Table B.52.17, method E). */
export const PARALLEL_GROUP_FACTOR = [1, 1, 0.88, 0.82, 0.77, 0.75, 0.73, 0.73, 0.72];
export const groupFactor = (runs: number) => PARALLEL_GROUP_FACTOR[Math.min(runs, PARALLEL_GROUP_FACTOR.length - 1)];

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
  if (feeder.feedsBoardId) return incomerBasis(feeder, project).current.a;
  const u0 = project.voltageV / SQRT3;
  // Capacitor bank: I = Q ÷ (√3 · U), from its kvar rating.
  if (feeder.kvar) return (feeder.kvar * 1000) / (SQRT3 * project.voltageV);
  const demandKw = feeder.loadKw * feeder.demandFactor;
  return feeder.cores >= 3
    ? (demandKw * 1000) / (SQRT3 * project.voltageV * feeder.powerFactor)
    : (demandKw * 1000) / (u0 * feeder.powerFactor);
}

/** One phase's current and power factor (sin φ signed: negative when the phase is capacitive). */
export interface PhaseBasis { phase: 'R' | 'Y' | 'B'; a: number; pf: number; sin: number; p: number; q: number }

/** An incomer's electrical basis, from the downstream board's real and reactive power per phase
 * (ENG-005) — not from the incomer's stored PF. Current: the phase with the largest apparent
 * power, I = S_phase ÷ U0. Voltage drop: the phase with the largest first-order conductor drop
 * L × (R·P + X·Q) ÷ (U0 · runs), chosen on its own (it can differ from the current phase).
 * This is a phase-conductor approximation, not a neutral-displacement / unbalanced load flow. */
export function incomerBasis(feeder: Feeder, project: Project, csaMm2 = feeder.cableCsaMm2, runs = runsOf(feeder)): { phases: PhasePQ; current: PhaseBasis; vd: PhaseBasis & { pct: number }; totalP: number; totalQ: number } {
  const u0 = project.voltageV / SQRT3;
  const phases = boardPhasePQ(project, feeder.feedsBoardId!);
  const basis = (ph: 'R' | 'Y' | 'B'): PhaseBasis => {
    const { p, q } = phases[ph];
    const s = Math.hypot(p, q);
    return { phase: ph, a: (s * 1000) / u0, pf: s > 0 ? p / s : 1, sin: s > 0 ? q / s : 0, p, q };
  };
  const all = (['R', 'Y', 'B'] as const).map(basis);
  const current = all.reduce((m, x) => (x.a > m.a ? x : m), all[0]);
  const r = rOperatingOhmPerKm(csaMm2, project.vdTempC), x = getCable(csaMm2).xOhmPerKm;
  let vd: PhaseBasis & { pct: number };
  if (feeder.cores >= 3) {
    // Each phase conductor: ΔV = L × (R·Ip + X·Iq) ÷ runs, against U0 (equals √3·I·Z ÷ U when balanced).
    const pct = (b: PhaseBasis) => ((feeder.lengthM / 1000) * (r * (b.p * 1000) / u0 + x * (b.q * 1000) / u0) / runs / u0) * 100;
    vd = all.map((b) => ({ ...b, pct: pct(b) })).reduce((m, b) => (b.pct > m.pct ? b : m));
  } else {
    // Single-phase supply: the phase + neutral loop (2·I·Z) against U0, on the current phase.
    vd = { ...current, pct: ((2 * current.a * (feeder.lengthM / 1000) * (r * current.pf + x * current.sin)) / runs / u0) * 100 };
  }
  const totalP = all.reduce((a, b) => a + b.p, 0), totalQ = all.reduce((a, b) => a + b.q, 0);
  return { phases, current, vd, totalP, totalQ };
}

/** The voltage-drop evaluator for cable selection: an incomer's downstream P / Q basis; undefined for
 * other feeders (their Ib and cos φ are used, as before). */
export const vdEvaluator = (feeder: Feeder, project: Project): ((csaMm2: number, runs: number) => number) | undefined =>
  feeder.feedsBoardId ? (csa, runs) => feederVdPctAt(feeder, project, csa, runs) : undefined;

/** Voltage drop (%) of a feeder at a given cable size and runs, on the same basis as voltageDropPct —
 * used for the actual cable and for every candidate size (Fix / Optimise, suggestions). */
export function feederVdPctAt(feeder: Feeder, project: Project, csaMm2: number, runs: number): number {
  if (feeder.feedsBoardId) return incomerBasis(feeder, project, csaMm2, runs).vd.pct;
  return vdPctFor(designCurrentA(feeder, project), csaMm2, feeder.lengthM, feeder.cores, feeder.powerFactor, project.voltageV, runs, project.vdTempC);
}

/** Cable current rating after ambient temperature and grouping derating.
 * Grouping: the cable tray factor when the cable is on a tray route (its
 * parallel runs are counted among the cables there), otherwise the factor
 * for its own parallel runs. */
export function deratedAmpacityA(csaMm2: number, ambientC: number, runs = 1, trayFactor?: number): number {
  return getCable(csaMm2).ampacityA * ambientCorrectionFactor(ambientC) * runs * (trayFactor ?? groupFactor(runs));
}

/** Grouping factor of a feeder from the cable trays it runs on (the worst
 * route), if it is on any. */
export const trayFactorOf = (project: Project, feeder: Feeder) => trayGrouping(project).get(feeder.id);

/** Voltage drop as a percentage of nominal: 3-phase circuits use
 * √3·I·Z against the line-to-line voltage; single-phase circuits use the
 * phase + neutral loop (2·I·Z) against the phase-to-neutral voltage. */
function vdPctFor(ib: number, csaMm2: number, lengthM: number, cores: 2 | 3 | 4, cosPhi: number, voltageV: number, runs = 1, tempC?: number): number {
  const rOhmPerKm = rOperatingOhmPerKm(csaMm2, tempC) / runs;
  const xOhmPerKm = getCable(csaMm2).xOhmPerKm / runs;
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  const threePhase = cores >= 3;
  const multiplier = threePhase ? SQRT3 : 2;
  const baseV = threePhase ? voltageV : voltageV / SQRT3;
  const vdVolts = (multiplier * ib * lengthM * (rOhmPerKm * cosPhi + xOhmPerKm * sinPhi)) / 1000;
  return (vdVolts / baseV) * 100;
}

/** Voltage drop in percent over this feeder's own cable run only. */
export function voltageDropPct(feeder: Feeder, project: Project): number {
  return feederVdPctAt(feeder, project, feeder.cableCsaMm2, runsOf(feeder));
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
  breakerRatingA = 0,
  /** Conductor temperature for the voltage drop (the project's vdTempC); blank = R20 × 1.2. */
  tempC?: number,
  /** The feeder's own voltage-drop evaluator (an incomer's downstream P / Q basis). */
  vdAt?: (csaMm2: number, runs: number) => number
): number | null {
  return selectCableRuns(ib, lengthM, systemVoltageV, cores, cosPhi, ambientC, vdBudgetPct, breakerRatingA, 1, undefined, tempC, vdAt)?.csaMm2 ?? null;
}

/** Like selectCable, but when no single cable fits, tries 2, 3… runs in
 * parallel (each run the same size), smallest size first for the fewest
 * runs. Sizes below 50 mm² are never paralleled. */
export function selectCableRuns(
  ib: number,
  lengthM: number,
  systemVoltageV: number,
  cores: 2 | 3 | 4,
  cosPhi: number,
  ambientC: number,
  vdBudgetPct: number,
  breakerRatingA = 0,
  maxRuns = 4,
  trayFactor?: number,
  /** Conductor temperature for the voltage drop (the project's vdTempC), as the displayed drop uses; blank = R20 × 1.2. */
  tempC?: number,
  /** The feeder's own voltage-drop evaluator (an incomer's downstream P / Q basis); default: Ib and cos φ at tempC. */
  vdAt?: (csaMm2: number, runs: number) => number
): { csaMm2: number; runs: number } | null {
  const requiredIz = Math.max(ib, breakerRatingA);
  for (let runs = 1; runs <= maxRuns; runs++) {
    for (const c of cables()) {
      if (runs > 1 && c.csaMm2 < 50) continue;
      const iz = c.ampacityA * ambientCorrectionFactor(ambientC) * runs * (trayFactor ?? groupFactor(runs));
      if (iz < requiredIz) continue;
      if ((vdAt ? vdAt(c.csaMm2, runs) : vdPctFor(ib, c.csaMm2, lengthM, cores, cosPhi, systemVoltageV, runs, tempC)) <= vdBudgetPct) return { csaMm2: c.csaMm2, runs };
    }
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
export function cableImpedance(csaMm2: number, lengthM: number, runs = 1): Impedance {
  return {
    r: (rOperatingOhmPerKm(csaMm2) * (lengthM / 1000)) / runs,
    x: (getCable(csaMm2).xOhmPerKm * (lengthM / 1000)) / runs
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
  const incomerZ = incomer ? cableImpedance(incomer.cableCsaMm2, incomer.lengthM, runsOf(incomer)) : { r: 0, x: 0 };
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
  /** Grouping factor from the cable tray the cable runs on (worst route). */
  tray?: { factor: number; route: string };
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
  const tray = trayFactorOf(project, feeder);
  const ampacity = deratedAmpacityA(feeder.cableCsaMm2, project.ambientC, runsOf(feeder), tray?.factor);
  const loadingPct = (ib / feeder.breakerRatingA) * 100;

  const vdPct = voltageDropPct(feeder, project);
  const vdUpstreamPct = upstreamVoltageDropPct(project, feeder.boardId);
  const vdTotalPct = vdUpstreamPct + vdPct;

  const zBoard = impedanceToBoard(project, feeder.boardId);
  const breakerFaultKA = faultCurrentKA(zBoard, project.voltageV);
  // Single-phase circuits: the fault at the far end is line-to-neutral, so
  // it flows through the phase and neutral conductors (2 × cable Z).
  const zCable = cableImpedance(feeder.cableCsaMm2, feeder.lengthM, runsOf(feeder));
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
    feeder, ib, ampacity, tray, loadingPct, vdPct, vdUpstreamPct, vdTotalPct, vdStatus,
    ampacityStatus, protectionStatus, breakerFaultKA, endFaultKA, icuStatus, status
  };
}

export function evaluateProject(project: Project): FeederResult[] {
  return project.feeders.map((f) => evaluateFeeder(project, f));
}
