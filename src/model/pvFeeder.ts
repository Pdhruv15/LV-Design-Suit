import type { Feeder, Project } from '../types';
import { applyRecommendation, recommend } from '../calc/sizing';
import type { PvResult, PvSystem } from '../calc/solar';

/** Solar PV → "Add / Update on the SLD": one generation feeder (PV-<board>) whose phase
 * system follows the inverter — 2 cores (phase + neutral) for one-phase inverters, 4 cores
 * for three-phase — set before the breaker and cable are sized, on creation and on update. */
export function pvToSld(project: Project, pv: PvSystem, r: Pick<PvResult, 'inverters' | 'kwp'>, boardId: string): { project: Project; feeder: Feeder; existing: boolean } | null {
  if (!boardId || !r.inverters) return null;
  const id = `PV-${boardId}`;
  const existing = project.feeders.find((f) => f.id === id);
  const acKw = r.inverters * pv.inverter.acKw;
  const onePhase = pv.inverter.phases === 1;
  const base: Feeder = existing ?? {
    id, boardId, name: 'Solar PV inverters', loadKw: 0, demandFactor: 1, powerFactor: 1,
    lengthM: 30, cableCsaMm2: 16, cores: 4, breakerRatingA: 100, breakerIcuKa: 25, loadType: 'pv', generation: true
  };
  // One-phase: the chosen R / Y / B, else the feeder's own explicit phase, else unspecified.
  // Three-phase: a leftover R / Y / B label no longer applies.
  const keptPhase = base.phase && base.phase !== 'RYB' ? base.phase : undefined;
  const phase = onePhase ? pv.acPhase ?? keptPhase : undefined;
  const f: Feeder = {
    ...base, loadKw: acKw, demandFactor: 1, powerFactor: 1, generation: true, loadType: 'pv',
    cores: onePhase ? 2 : 4, phase,
    name: `Solar PV ${r.inverters} × ${pv.inverter.acKw} kW (${r.kwp.toFixed(1)} kWp)`
  };
  if (!phase) delete f.phase;
  const p0 = { ...project, feeders: existing ? project.feeders.map((x) => (x.id === id ? f : x)) : [...project.feeders, f] };
  const sized = applyRecommendation(f, recommend(p0, f, 'optimise'));
  return { project: { ...p0, pv: { ...pv, boardId }, feeders: p0.feeders.map((x) => (x.id === id ? sized : x)) }, feeder: sized, existing: !!existing };
}
