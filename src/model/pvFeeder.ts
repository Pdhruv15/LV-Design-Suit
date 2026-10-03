import type { Feeder, Project } from '../types';
import { applyRecommendation, recommend } from '../calc/sizing';
import type { PvResult, PvSystem } from '../calc/solar';

/** Solar PV → "Add / Update on the SLD": one generation feeder (PV-<board>) whose phase
 * system follows the inverter — 2 cores (phase + neutral) for one-phase inverters, 4 cores
 * for three-phase — set before the breaker and cable are sized, on creation and on update. */
export function pvToSld(project: Project, pv: PvSystem, r: Pick<PvResult, 'inverters' | 'kwp'>, boardId: string): { project: Project; feeder: Feeder; existing: boolean; unresolved?: string } | null {
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
  // The feeder is sized by the general recommendation (its own breaker rule, I ÷ 0.85, and the
  // shared breaker list). When that finds no breaker or no cable, nothing is applied: the SLD is left
  // unchanged and the reason is returned, so a placeholder or old rating is never shown as sized.
  const rec = recommend(p0, f, 'optimise');
  if (!rec.breakerRatingA || !rec.cableCsaMm2) {
    return { project, feeder: f, existing: !!existing, unresolved: rec.note ?? 'No breaker or cable fits this connection' };
  }
  const sized = applyRecommendation(f, rec);
  return { project: { ...p0, pv: { ...pv, boardId }, feeders: p0.feeders.map((x) => (x.id === id ? sized : x)) }, feeder: sized, existing: !!existing };
}

/** What the SLD connection would be, without changing the project: the breaker and cable the general
 * sizing gives the PV feeder (length, tray, cable type as on the SLD feeder when it exists), or why one
 * aggregate connection can't be built. Shown on the Solar page and in its report beside the AC breaker. */
export function pvConnection(project: Project, pv: PvSystem, r: Pick<PvResult, 'inverters' | 'kwp'>, boardId: string): { ok: boolean; text: string } | undefined {
  const res = pvToSld(project, pv, r, boardId);
  if (!res) return undefined;
  if (res.unresolved) return { ok: false, text: `Can't be built as one connection on ${boardId}: ${res.unresolved}. Configure separate inverter groups / feeders explicitly.` };
  const f = res.feeder;
  return { ok: true, text: `On ${boardId}: ${f.breakerRatingA} A breaker, ${f.parallel && f.parallel > 1 ? `${f.parallel} × ` : ''}${f.cores}C × ${f.cableCsaMm2} mm², ${f.lengthM} m (SLD sizing: I ÷ 0.85, cable for Iz and voltage drop)` };
}
