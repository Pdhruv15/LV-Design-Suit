import { CABLE_TABLE, ambientCorrectionFactor, getCable } from './cableTable';
import type { Board, Feeder, Project } from '../types';

const SQRT3 = Math.sqrt(3);

/** AC resistance at operating temperature, approximated with a flat 1.2x
 * factor over the 20°C IEC 60228 value to account for the rise to ~90°C
 * conductor temperature. Skin/proximity effect is ignored (negligible below
 * ~120 mm² and a reasonable simplification above it for this tool). */
function rOperatingOhmPerKm(csaMm2: number): number {
  return getCable(csaMm2).rOhmPerKm20C * 1.2;
}

/** Design current (A) for a feeder, assuming a balanced 3-phase load. */
export function designCurrentA(feeder: Feeder, systemVoltageV: number): number {
  const demandKw = feeder.loadKw * feeder.demandFactor;
  return (demandKw * 1000) / (SQRT3 * systemVoltageV * feeder.powerFactor);
}

/** Cable current rating after ambient temperature derating. Grouping and
 * installation-method correction factors are not modelled yet — apply them
 * manually until that's added. */
export function deratedAmpacityA(csaMm2: number, ambientC: number): number {
  return getCable(csaMm2).ampacityA * ambientCorrectionFactor(ambientC);
}

/** Voltage drop in percent for a feeder over its full cable run. */
export function voltageDropPct(feeder: Feeder, systemVoltageV: number): number {
  const ib = designCurrentA(feeder, systemVoltageV);
  const cable = getCable(feeder.cableCsaMm2);
  const rMOhmPerM = (rOperatingOhmPerKm(feeder.cableCsaMm2) * 1000) / 1000; // ohm/km -> mohm/m numerically equal, kept explicit for clarity
  const xMOhmPerM = cable.xOhmPerKm; // ohm/km numerically equals mohm/m
  const cosPhi = feeder.powerFactor;
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  const multiplier = feeder.cores >= 3 ? SQRT3 : 2; // 3-phase vs single-phase circuit
  const vdVolts = (multiplier * ib * feeder.lengthM * (rMOhmPerM * cosPhi + xMOhmPerM * sinPhi)) / 1000;
  return (vdVolts / systemVoltageV) * 100;
}

/** Picks the smallest standard cable size that satisfies both ampacity
 * (after ambient derating) and the project's voltage-drop limit. Returns
 * null if nothing in the table satisfies the voltage-drop limit. */
export function selectCable(
  ib: number,
  lengthM: number,
  systemVoltageV: number,
  cores: 2 | 3 | 4,
  cosPhi: number,
  ambientC: number,
  vdLimitPct: number
): number | null {
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  const multiplier = cores >= 3 ? SQRT3 : 2;
  for (const c of CABLE_TABLE) {
    const iz = c.ampacityA * ambientCorrectionFactor(ambientC);
    if (iz < ib) continue;
    const rMOhmPerM = rOperatingOhmPerKm(c.csaMm2);
    const vdVolts = (multiplier * ib * lengthM * (rMOhmPerM * cosPhi + c.xOhmPerKm * sinPhi)) / 1000;
    const vdPct = (vdVolts / systemVoltageV) * 100;
    if (vdPct <= vdLimitPct) return c.csaMm2;
  }
  return null;
}

/** Transformer source impedance referred to the LV side, in ohms. */
export function transformerImpedanceOhm(sourceKva: number, impedancePct: number, voltageV: number): number {
  return (voltageV * voltageV * (impedancePct / 100)) / (sourceKva * 1000);
}

/** Cable impedance magnitude in ohms for a given length. */
export function cableImpedanceOhm(csaMm2: number, lengthM: number): number {
  const c = getCable(csaMm2);
  const r = rOperatingOhmPerKm(csaMm2) * (lengthM / 1000);
  const x = c.xOhmPerKm * (lengthM / 1000);
  return Math.sqrt(r * r + x * x);
}

/** Prospective 3-phase fault current (kA rms) at the far end of a feeder,
 * given the total impedance from source to that point. This is a magnitude
 * estimate (impedances summed as scalars, not full complex R+jX phasor
 * addition) — adequate for a first-pass discrimination check, not a
 * substitute for a full fault study on a complex network. */
export function faultCurrentKA(totalImpedanceOhm: number, systemVoltageV: number): number {
  if (totalImpedanceOhm <= 0) return Infinity;
  return systemVoltageV / (SQRT3 * totalImpedanceOhm) / 1000;
}

export interface FeederResult {
  feeder: Feeder;
  ib: number;
  ampacity: number;
  loadingPct: number;
  vdPct: number;
  vdStatus: 'ok' | 'warn' | 'bad';
  ampacityStatus: 'ok' | 'bad';
  faultKA: number;
  discriminationOk: boolean;
  status: 'ok' | 'warn' | 'bad';
}

export function evaluateFeeder(project: Project, feeder: Feeder): FeederResult {
  const board = project.boards.find((b) => b.id === feeder.boardId);
  const mainBoard = project.boards.find((b) => !b.upstreamId) ?? project.boards[0];

  const ib = designCurrentA(feeder, project.voltageV);
  const ampacity = deratedAmpacityA(feeder.cableCsaMm2, project.ambientC);
  const loadingPct = (ib / feeder.breakerRatingA) * 100;
  const vdPct = voltageDropPct(feeder, project.voltageV);

  const zSource =
    mainBoard.sourceKva && mainBoard.sourceImpedancePct
      ? transformerImpedanceOhm(mainBoard.sourceKva, mainBoard.sourceImpedancePct, project.voltageV)
      : 0.01;
  const zCable = cableImpedanceOhm(feeder.cableCsaMm2, feeder.lengthM);
  const faultKA = faultCurrentKA(zSource + zCable, project.voltageV);
  const discriminationOk = feeder.breakerIcuKa >= faultKA;

  const vdStatus: FeederResult['vdStatus'] =
    vdPct > project.vdLimitPct ? 'bad' : vdPct > project.vdLimitPct * 0.85 ? 'warn' : 'ok';
  const ampacityStatus: FeederResult['ampacityStatus'] = ampacity >= ib ? 'ok' : 'bad';
  const loadingStatus: 'ok' | 'warn' | 'bad' = loadingPct > 100 ? 'bad' : loadingPct > 85 ? 'warn' : 'ok';

  const statuses = [vdStatus, ampacityStatus, loadingStatus, discriminationOk ? 'ok' : 'warn'] as const;
  const status: FeederResult['status'] = statuses.includes('bad') ? 'bad' : statuses.includes('warn') ? 'warn' : 'ok';

  return { feeder, ib, ampacity, loadingPct, vdPct, vdStatus, ampacityStatus, faultKA, discriminationOk, status };
}

export function evaluateProject(project: Project): FeederResult[] {
  return project.feeders.map((f) => evaluateFeeder(project, f));
}
