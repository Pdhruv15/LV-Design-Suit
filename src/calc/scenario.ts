import { loadTypeOf } from './summary';
import { boardDemandKva, standbyBoards } from './sizing';
import type { Board, Feeder, Project } from '../types';

/** Operating scenarios for the SLD: the normal supply, or the standby
 * generators after their ATSs have changed over (mains lost). */
export type SupplyMode = 'normal' | 'generator';

/** Generator subtransient reactance X″d (%), for fault levels on
 * generator supply; typical for LV diesel sets. */
export const GENERATOR_XD_SUBTRANSIENT_PCT = 15;
/** Transient reactance X′d (%), for the motor starting voltage dip. */
export const GENERATOR_XD_TRANSIENT_PCT = 25;
const GENERATOR_XR = 10;
/** Voltage dip limit when the largest motor starts on the generator. */
export const MOTOR_START_DIP_LIMIT_PCT = 15;

export interface GeneratorRun {
  boardId: string; // the board the generator feeds through its ATS
  kva: number;
  demandKva: number;
  loadingPct: number;
  /** Largest motor on this generator, started direct on line. */
  largestMotor?: { feeder: Feeder; startingKva: number; dipPct: number };
}

export interface GeneratorScenario {
  /** The network as it runs on the generators: only the backed boards,
   * each fed from its generator. */
  project: Project;
  energized: Set<string>;
  generators: GeneratorRun[];
}

/** DOL starting kVA of a motor: ~6 × its running kVA. */
const startingKva = (f: Feeder) => (6 * f.loadKw) / Math.max(f.powerFactor, 0.1);

/** Voltage dip when a motor starts on a generator, from its transient
 * reactance: ΔU ≈ S_start / (S_start + S_gen / X′d). */
export const motorStartDipPct = (startKva: number, genKva: number) =>
  (startKva / (startKva + genKva / (GENERATOR_XD_TRANSIENT_PCT / 100))) * 100;

export function generatorScenario(project: Project): GeneratorScenario {
  const backed = standbyBoards(project);
  // A generator board is a scenario source unless it is itself fed from
  // another backed board (then the upstream generator feeds it).
  const sources = project.boards.filter((b) => b.standby && !(b.upstreamId && backed.has(b.upstreamId)));
  const boards: Board[] = project.boards
    .filter((b) => backed.has(b.id))
    .map((b) => (sources.some((s) => s.id === b.id)
      ? { ...b, upstreamId: undefined, sourceKva: b.standby!.kva, sourceImpedancePct: GENERATOR_XD_SUBTRANSIENT_PCT, sourceXr: GENERATOR_XR }
      : b));
  const feeders = project.feeders.filter((f) => backed.has(f.boardId) && (!f.feedsBoardId || backed.has(f.feedsBoardId)));
  const scenario: Project = { ...project, boards, feeders };

  const below = (root: string) => {
    const out = new Set([root]);
    for (let added = true; added; ) {
      added = false;
      for (const b of boards) if (b.upstreamId && out.has(b.upstreamId) && !out.has(b.id)) { out.add(b.id); added = true; }
    }
    return out;
  };
  const generators = sources.map((s): GeneratorRun => {
    const kva = s.standby!.kva;
    const demandKva = boardDemandKva(scenario, s.id);
    const zone = below(s.id);
    const motor = feeders
      .filter((f) => zone.has(f.boardId) && !f.feedsBoardId && ['motor', 'fire-pump'].includes(loadTypeOf(f)))
      .sort((a, b) => startingKva(b) - startingKva(a))[0];
    return {
      boardId: s.id,
      kva,
      demandKva,
      loadingPct: (demandKva / kva) * 100,
      largestMotor: motor ? { feeder: motor, startingKva: startingKva(motor), dipPct: motorStartDipPct(startingKva(motor), kva) } : undefined
    };
  });
  return { project: scenario, energized: backed, generators };
}
