import { settingsOf, type Board, type Project } from '../types';
import type { FeederResult, Status } from './electrical';
import { boardSummary, boardTotals } from './summary';
import { existingLoad, isExisting, otherKva } from '../model/existing';
import { txUnits } from '../model/earthingPlan';

/** Checks of an existing installation that is being extended: does what is
 * already there still carry the recorded demand plus the new load?
 *  - transformer: recorded + new demand against kVA × the design loading limit;
 *  - incomer: each existing board's demand current against its rating;
 *  - existing feeders: breaker, cable, voltage drop and fault level as calculated;
 *  - spare ways: new ways on an existing board against the spares found at the survey;
 *  - shared supply: the load kept for each other building on an existing board;
 *  - RMU: a new transformer on the RMU of an existing one needs a spare T-off way (an RMU feeds at most 2). */

export type ExistingCheckKind = 'transformer' | 'incomer' | 'feeder' | 'spare' | 'shared' | 'rmu';

export interface ExistingCheck {
  kind: ExistingCheckKind;
  id: string; // board or feeder id
  item: string;
  value: string;
  limit: string;
  status: Status;
  result: string;
}

const kvaOf = (t: { demandKw: number; demandKvar: number }) => Math.hypot(t.demandKw, t.demandKvar);
const r0 = (n: number) => Math.round(n).toString();

/** New demand (kVA) on a board: everything below it except what its recorded maximum demand covers. */
export const newDemandKva = (project: Project, b: Board) => kvaOf(boardTotals(project, b.id, new Set(), true));

/** Ways added to an existing board: its feeders (or, on a DB, final circuits) that are not existing. */
export const newWaysOn = (project: Project, b: Board) => project.feeders.filter((f) => f.boardId === b.id && !f.existing).length;

export function existingChecks(project: Project, results: FeederResult[]): ExistingCheck[] {
  const out: ExistingCheck[] = [];
  const limitPct = settingsOf(project).transformerMaxLoadingPct;
  for (const b of project.boards.filter(isExisting)) {
    const sm = boardSummary(project, b);
    const ex = existingLoad(project, b);
    const added = newDemandKva(project, b);
    const others = b.existing?.others ?? [];
    const split = ex ? `${r0(ex.covers ? ex.kva : Math.max(0, sm.demandKva - added))} + ${r0(added)} = ${r0(sm.demandKva)} kVA` : `${r0(sm.demandKva)} kVA (no recorded MD)`;
    for (const o of others) {
      const kept = otherKva(o);
      out.push({
        kind: 'shared', id: `${b.id}:${o.name}`, item: `${b.id} → ${o.name} (other building)${o.ref ? `, ${o.ref}` : ''}`,
        value: `allocated ${o.allocatedKva !== undefined ? `${r0(o.allocatedKva)} kVA` : '—'} · recorded ${o.recordedKva !== undefined ? `${r0(o.recordedKva)} kVA` : '—'}`,
        limit: 'the higher is kept', status: kept > 0 ? 'ok' : 'warn',
        result: kept > 0 ? `${r0(kept)} kVA kept` : 'Enter its allocated or recorded load'
      });
    }
    if (!b.upstreamId && b.sourceKva) {
      const cap = (b.sourceKva * limitPct) / 100;
      const spare = cap - sm.demandKva;
      out.push({
        kind: 'transformer', id: b.id, item: `${b.id} transformer ${b.sourceKva} kVA spare capacity`, value: split,
        limit: `${limitPct} % of ${b.sourceKva} = ${r0(cap)} kVA`,
        status: spare < 0 ? 'bad' : spare < b.sourceKva * 0.05 ? 'warn' : 'ok',
        result: spare < 0 ? `Over by ${r0(-spare)} kVA` : `${r0(spare)} kVA left`
      });
    }
    const rating = b.ratedCurrentA ?? (!b.upstreamId ? b.supply?.ratingA : undefined) ?? project.feeders.find((f) => f.feedsBoardId === b.id)?.breakerRatingA;
    if (rating) {
      const pct = (sm.currentA / rating) * 100;
      out.push({
        kind: 'incomer', id: b.id, item: `${b.id} incomer / busbar ${rating} A`, value: `${r0(sm.currentA)} A (${split})`, limit: `${rating} A`,
        status: pct > 100 ? 'bad' : pct > 80 ? 'warn' : 'ok', result: `${pct.toFixed(0)} % loaded`
      });
    }
    const available = b.existing?.spareWays;
    const used = newWaysOn(project, b);
    if (used || available !== undefined) {
      out.push({
        kind: 'spare', id: b.id, item: `${b.id} spare ways`, value: `${used} new way${used === 1 ? '' : 's'}`,
        limit: available !== undefined ? `${available} spare at survey` : 'spares at survey not entered',
        status: available === undefined ? 'warn' : used > available ? 'bad' : 'ok',
        result: available === undefined ? 'Enter the spares found at survey' : used > available ? `${used - available} more than available` : `${available - used} left`
      });
    }
  }
  // A new transformer on the RMU of an existing one: the RMU feeds at most 2 transformers (as Transformers → RMU).
  const units = txUnits(project);
  const byRmu = new Map<string, Board[]>();
  for (const b of project.boards) if (!b.upstreamId && b.sourceKva && b.rmu?.trim()) byRmu.set(b.rmu.trim(), [...(byRmu.get(b.rmu.trim()) ?? []), b]);
  for (const [rmu, bs] of byRmu) {
    const old = bs.filter(isExisting), added = bs.filter((b) => !isExisting(b));
    if (!old.length || !added.length) continue;
    const n = bs.reduce((s, b) => s + (units.get(b.id) ?? 1), 0);
    out.push({
      kind: 'rmu', id: rmu, item: `RMU ${rmu} (existing): new transformer ${added.map((b) => `${b.id} ${b.sourceKva} kVA`).join(', ')}`,
      value: `${n} transformers with existing ${old.map((b) => `${b.id} ${b.sourceKva} kVA`).join(', ')}`, limit: '2 transformers per RMU',
      status: n > 2 ? 'bad' : 'warn',
      result: n > 2 ? `${n - 2} more than the RMU can feed: a new RMU is needed` : 'Confirm the existing RMU has a spare T-off way (else extend it or add an RMU) with DEWA'
    });
  }
  for (const r of results.filter((x) => x.feeder.existing)) {
    const f = r.feeder;
    const why = [r.protectionStatus === 'bad' && 'Ib ≤ In ≤ Iz not met', r.ampacityStatus === 'bad' && 'cable too small', r.icuStatus === 'bad' && 'breaking capacity too low', r.vdStatus !== 'ok' && `Vd ${r.vdTotalPct.toFixed(1)} %`].filter(Boolean);
    out.push({
      kind: 'feeder', id: f.id, item: `${f.boardId} → ${f.feedsBoardId ?? f.name} (existing ${f.breakerRatingA} A, ${f.parallel && f.parallel > 1 ? `${f.parallel} × ` : ''}${f.cableCsaMm2} mm²)`,
      value: `Ib ${r.ib.toFixed(0)} A · Iz ${r.ampacity.toFixed(0)} A · Vd ${r.vdTotalPct.toFixed(1)} %`, limit: `In ${f.breakerRatingA} A · Vd ${project.vdLimitPct} %`,
      status: r.status, result: why.length ? why.join('; ') : `${r.loadingPct.toFixed(0)} % of breaker`
    });
  }
  return out;
}
