import { boardDemandKva, standbyBoards } from './sizing';
import { designCurrentA } from './electrical';
import { isMotor, motorStartDipPct, startingKva } from './motor';

export { GENERATOR_XD_TRANSIENT_PCT, MOTOR_START_DIP_LIMIT_PCT, motorStartDipPct } from './motor';
import type { Board, Feeder, Project } from '../types';

/** Operating scenarios for the SLD: the normal supply, or the standby
 * generators after their ATSs have changed over (mains lost). */
export type SupplyMode = 'normal' | 'generator' | `outage:${string}`;

/** Generator subtransient reactance X″d (%), for fault levels on
 * generator supply; typical for LV diesel sets. */
export const GENERATOR_XD_SUBTRANSIENT_PCT = 15;
const GENERATOR_XR = 10;

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
      .filter((f) => zone.has(f.boardId) && isMotor(f))
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

// ---- Transformer outage with a bus tie ----

export interface TransformerRun {
  boardId: string;
  kva: number;
  demandKva: number;
  loadingPct: number;
}

export interface OutageScenario {
  project: Project;
  energized: Set<string>;
  generators: GeneratorRun[];
  outage: {
    failedId: string;
    /** The tie that closed, with the current through it; undefined when
     * the failed board has no tie (then its network is off). */
    tie?: { id: string; fromId: string; currentA: number; ratingA: number; loadingPct: number };
    transformers: TransformerRun[];
  };
}

/** The network with one main board's transformer out: if a bus tie links
 * it to another transformer-fed main board, the tie closes and that
 * transformer carries both; otherwise the failed board's network is off. */
export function transformerOutage(project: Project, failedId: string): OutageScenario {
  const failed = project.boards.find((b) => b.id === failedId && !b.upstreamId);
  const tie = (project.ties ?? []).find((t) => {
    if (t.a !== failedId && t.b !== failedId) return false;
    const other = project.boards.find((b) => b.id === (t.a === failedId ? t.b : t.a));
    return !!other && !other.upstreamId && !!other.sourceKva;
  });
  const below = (root: string) => {
    const out = new Set([root]);
    for (let added = true; added; ) {
      added = false;
      for (const b of project.boards) if (b.upstreamId && out.has(b.upstreamId) && !out.has(b.id)) { out.add(b.id); added = true; }
    }
    return out;
  };
  let scenario: Project;
  let energized: Set<string>;
  let tieRun: OutageScenario['outage']['tie'];
  if (failed && tie) {
    const fromId = tie.a === failedId ? tie.b : tie.a;
    const coupler: Feeder = {
      id: tie.id, boardId: fromId, name: 'Bus coupler', feedsBoardId: failedId,
      loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 1, cableCsaMm2: 300, parallel: 4, cores: 4,
      breakerRatingA: tie.ratingA, breakerIcuKa: 65, breakerType: tie.ratingA > 1600 ? 'ACB' : 'MCCB'
    };
    scenario = {
      ...project,
      boards: project.boards.map((b) => {
        if (b.id !== failedId) return b;
        const { sourceKva: _kva, sourceImpedancePct: _z, sourceXr: _xr, ...rest } = b;
        return { ...rest, upstreamId: fromId };
      }),
      feeders: [...project.feeders, coupler]
    };
    energized = new Set(project.boards.map((b) => b.id));
    const currentA = designCurrentA(coupler, scenario);
    tieRun = { id: tie.id, fromId, currentA, ratingA: tie.ratingA, loadingPct: (currentA / tie.ratingA) * 100 };
  } else {
    // No tie: the failed board and everything below it is off.
    const off = below(failedId);
    scenario = { ...project, boards: project.boards.filter((b) => !off.has(b.id)), feeders: project.feeders.filter((f) => !off.has(f.boardId) && !(f.feedsBoardId && off.has(f.feedsBoardId))) };
    energized = new Set(scenario.boards.map((b) => b.id));
  }
  const transformers = scenario.boards
    .filter((b) => !b.upstreamId && b.sourceKva)
    .map((b) => {
      const demandKva = boardDemandKva(scenario, b.id);
      return { boardId: b.id, kva: b.sourceKva!, demandKva, loadingPct: (demandKva / b.sourceKva!) * 100 };
    });
  return { project: scenario, energized, generators: [], outage: { failedId, tie: tieRun, transformers } };
}
