import type { FeederResult, Status } from '../calc/electrical';
import { boardSummary } from '../calc/summary';
import type { StudyResults } from '../engines/types';
import type { Project } from '../types';

/** Which result values are printed on the diagram. */
export interface ResultLayers {
  current: boolean;
  voltage: boolean;
  vd: boolean;
  fault: boolean;
  pf: boolean;
  loading: boolean;
}

export const DEFAULT_LAYERS: ResultLayers = { current: true, voltage: true, vd: true, fault: false, pf: false, loading: false };

export const LAYER_LABELS: [keyof ResultLayers, string][] = [
  ['current', 'Current (A)'],
  ['voltage', 'Bus voltage'],
  ['vd', 'Voltage drop'],
  ['fault', 'Fault current'],
  ['pf', 'Power factor'],
  ['loading', 'Loading %']
];

export interface FeederAnnotation {
  currentA?: number;
  vdTotalPct?: number;
  vdStatus?: Status;
  faultKA?: number; // at the far end of the cable
  pf?: number;
  loadingPct?: number;
  loadingStatus?: Status;
}

export interface BoardAnnotation {
  voltageV?: number;
  voltagePct?: number;
  voltageStatus?: Status;
  faultKA?: number;
  pf?: number;
}

export interface Annotations {
  feeders: Record<string, FeederAnnotation>;
  boards: Record<string, BoardAnnotation>;
}

const vdStatus = (pct: number, limit: number): Status => (pct > limit ? 'bad' : pct > limit * 0.85 ? 'warn' : 'ok');
const loadStatus = (pct: number): Status => (pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok');

/** Diagram labels from the built-in results, with any values a full
 * engine study returned (current, voltage drop, fault levels, busbar
 * voltages) taking their place. Power factor always comes from the load
 * data, since the engines don't report it per feeder. */
export function buildAnnotations(project: Project, results: FeederResult[], engine?: StudyResults): Annotations {
  const limit = project.vdLimitPct;
  const boards: Record<string, BoardAnnotation> = {};
  for (const b of project.boards) {
    const s = boardSummary(project, b);
    const e = engine?.boards?.[b.id];
    const voltagePct = e?.voltagePct ?? s.voltagePct;
    boards[b.id] = {
      voltagePct,
      voltageV: (project.voltageV * voltagePct) / 100,
      voltageStatus: vdStatus(100 - voltagePct, limit),
      faultKA: e?.faultKA ?? s.faultKA,
      pf: s.demandKva > 0 ? s.powerFactor : undefined
    };
  }

  const feeders: Record<string, FeederAnnotation> = {};
  for (const r of results) {
    const f = r.feeder;
    const e = engine?.feeders[f.id];
    const currentA = e?.ib ?? r.ib;
    const vdTotalPct = e?.vdTotalPct ?? r.vdTotalPct;
    const loadingPct = (currentA / f.breakerRatingA) * 100;
    feeders[f.id] = {
      currentA,
      vdTotalPct,
      vdStatus: vdStatus(vdTotalPct, limit),
      faultKA: e?.endFaultKA ?? r.endFaultKA,
      pf: f.feedsBoardId ? boards[f.feedsBoardId]?.pf : f.powerFactor,
      loadingPct,
      loadingStatus: loadStatus(loadingPct)
    };
  }
  return { feeders, boards };
}
