import { settingsOf, type Board, type Project } from '../types';
import type { FeederResult, Status } from './electrical';
import { boardSummary, boardTotals } from './summary';
import { isExisting, recordedKva } from '../model/existing';

/** Checks of an existing installation that is being extended: does what is
 * already there still carry the recorded demand plus the new load?
 *  - transformer: recorded + new demand against kVA × the design loading limit;
 *  - incomer: each existing board's demand current against its rating;
 *  - existing feeders: breaker, cable, voltage drop and fault level as calculated;
 *  - spare ways: new ways on an existing board against the spares found at the survey. */

export type ExistingCheckKind = 'transformer' | 'incomer' | 'feeder' | 'spare';

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
    const rec = recordedKva(project, b);
    const added = newDemandKva(project, b);
    const split = rec !== undefined ? `${r0(rec)} + ${r0(added)} = ${r0(sm.demandKva)} kVA` : `${r0(sm.demandKva)} kVA (no recorded MD)`;
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
