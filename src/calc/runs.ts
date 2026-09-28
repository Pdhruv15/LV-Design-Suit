import { evaluateProject, type FeederResult } from './electrical';
import { evaluateEarthingAll, type EarthingResult } from './earthing';
import { evaluateSelectivity, type SelectivityResult } from './protection';
import type { Board, Feeder, Project } from '../types';

/** Network studies run on demand ("Run calculations", F5) rather than on
 * every keystroke. A run keeps the project it was computed from and a
 * fingerprint of each study's inputs, so the app knows exactly which
 * results a later edit made out of date — editing a room name or a remark
 * makes nothing out of date; a load changes voltage drop and the checks
 * but not fault levels; a breaker changes protection but not voltage drop.
 * Live sums (load schedule totals, MD forms, space planning) stay live. */

export type StudyKey = 'vd' | 'fault' | 'checks' | 'earthing' | 'protection' | 'sizing';

export const STUDY_LABEL: Record<StudyKey, string> = {
  vd: 'Voltage drop',
  fault: 'Short circuit',
  checks: 'Cable & breaker checks',
  earthing: 'Earth fault loop',
  protection: 'Discrimination',
  sizing: 'Transformer & generator'
};

export const STUDY_KEYS = Object.keys(STUDY_LABEL) as StudyKey[];

type FeederField = keyof Feeder;
type BoardField = keyof Board;

// Network shape: which board feeds which, and the sources.
const TOPOLOGY_F: FeederField[] = ['id', 'boardId', 'feedsBoardId'];
const TOPOLOGY_B: BoardField[] = ['id', 'upstreamId', 'sourceKva', 'sourceImpedancePct', 'sourceXr'];
const LOAD_F: FeederField[] = ['loadKw', 'demandFactor', 'powerFactor', 'phase', 'cores', 'kvar', 'generation'];
const CABLE_F: FeederField[] = ['lengthM', 'cableCsaMm2', 'parallel', 'cores'];
const BREAKER_F: FeederField[] = ['breakerRatingA', 'breakerType', 'breakerImMultiple', 'breakerIcuKa'];

const INPUTS: Record<StudyKey, { feeders: FeederField[]; boards: BoardField[]; project: (keyof Project)[] }> = {
  vd: { feeders: [...TOPOLOGY_F, ...LOAD_F, ...CABLE_F], boards: TOPOLOGY_B, project: ['voltageV', 'vdLimitPct'] },
  fault: { feeders: [...TOPOLOGY_F, ...CABLE_F, 'breakerIcuKa'], boards: TOPOLOGY_B, project: ['voltageV'] },
  checks: { feeders: [...TOPOLOGY_F, ...LOAD_F, ...CABLE_F, ...BREAKER_F], boards: TOPOLOGY_B, project: ['voltageV', 'vdLimitPct', 'ambientC'] },
  earthing: { feeders: [...TOPOLOGY_F, ...CABLE_F, ...BREAKER_F, 'cpcMm2'], boards: TOPOLOGY_B, project: ['voltageV'] },
  protection: { feeders: [...TOPOLOGY_F, ...CABLE_F, ...BREAKER_F], boards: TOPOLOGY_B, project: ['voltageV'] },
  sizing: { feeders: [...TOPOLOGY_F, ...LOAD_F, 'essential', 'starter', 'loadType'], boards: [...TOPOLOGY_B, 'standby'], project: ['voltageV', 'studySettings'] }
};

const pick = <T extends object>(o: T, keys: (keyof T)[]) => keys.map((k) => o[k] ?? null);

/** A study's inputs as a comparable string. */
export function fingerprint(project: Project, key: StudyKey): string {
  const i = INPUTS[key];
  return JSON.stringify([
    pick(project, i.project),
    project.boards.map((b) => pick(b, i.boards)),
    project.feeders.map((f) => pick(f, i.feeders)),
    key === 'sizing' || key === 'checks' ? project.ties ?? null : null
  ]);
}

export interface CalcRun {
  /** The project exactly as it was calculated. */
  project: Project;
  fingerprints: Record<StudyKey, string>;
  results: FeederResult[];
  earthing: EarthingResult[];
  selectivity: SelectivityResult[];
  at: number;
  ms: number;
}

export function runCalculations(project: Project, now = Date.now()): CalcRun {
  const t0 = performance.now();
  const results = evaluateProject(project);
  const earthing = evaluateEarthingAll(project);
  const selectivity = evaluateSelectivity(project);
  const fingerprints = Object.fromEntries(STUDY_KEYS.map((k) => [k, fingerprint(project, k)])) as Record<StudyKey, string>;
  return { project, fingerprints, results, earthing, selectivity, at: now, ms: performance.now() - t0 };
}

/** Studies whose inputs changed since the run (all of them before any run). */
export function staleStudies(run: CalcRun | undefined, project: Project): StudyKey[] {
  if (!run) return [...STUDY_KEYS];
  if (run.project === project) return [];
  return STUDY_KEYS.filter((k) => fingerprint(project, k) !== run.fingerprints[k]);
}
