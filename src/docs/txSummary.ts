import { faultCurrentKA, impedanceToBoard } from '../calc/electrical';
import { STANDARD_ICU_KA } from '../calc/sizing';
import { boardsInSupplyOrder } from '../calc/summary';
import { subtree } from '../calc/pfc';
import type { PhaseKw } from '../calc/loadSchedule';
import type { Board, Feeder, MeterType, Project } from '../types';
import { connectedPhaseKw, suggestedMeter } from './mdSheet';

/** "Details of connected load, max demand & kWh metering — summary of the
 * TCL at transformer level": one row per transformer (main board), grouped
 * by substation, with its main breaker and setting, fault duty, connected
 * load per phase, TCL, demand factor, MDL, the kWh meters of everything it
 * feeds and their CT ratios; totals, diversity, maximum demand and the TCL
 * of duty equipment (standby units left out). */

const SQRT3 = Math.sqrt(3);
/** Standard CT primaries (A), secondary 5 A. */
export const CT_PRIMARIES = [50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1600, 2000, 2400, 2500, 3000, 3200, 4000, 5000];
export const ctFor = (amps: number) => `${CT_PRIMARIES.find((c) => c >= amps - 1e-9) ?? CT_PRIMARIES[CT_PRIMARIES.length - 1]}/5A`;

export interface TxSummaryRow {
  board: Board;
  poles: string;
  device: 'ACB' | 'MCCB';
  ratingA?: number;
  setting?: number; // × In, when below 1
  faultKa?: number;
  cable: string;
  ecc: string;
  phases: PhaseKw;
  tclKw: number;
  df: number;
  mdlKw: number;
  standbyKw: number; // standby units, left out of the TCL (duty)
  meters: Record<MeterType, number>;
  /** CT meters by ratio, e.g. { "2400/5A": 1 }. */
  cts: Record<string, number>;
  /** Nothing drawn below: loads and meters are typed on the form. */
  manual: boolean;
}

export interface TxSummary {
  groups: { name: string; rows: TxSummaryRow[] }[];
  phases: PhaseKw;
  tclKw: number;
  mdlKw: number;
  diversity: number; // MDL ÷ TCL
  tclDutyKw: number;
  meters: Record<MeterType, number>;
  ctText: string; // "7X 2400/5A CT + 1X 1600/5A CT …"
  header: { project: string; area: string; completion: string; owner: string; plotNo: string; consultant: string; location: string };
}

const ZERO: PhaseKw = { R: 0, Y: 0, B: 0 };
const ctText = (cts: Record<string, number>) =>
  Object.entries(cts).sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([r, n]) => `${n}X ${r} CT`).join(' + ');

/** The main breaker's setting: the transformer's full-load current over the
 * breaker rating, rounded up to 0.05. */
export function breakerSetting(project: Project, b: Board, ratingA?: number): number | undefined {
  if (b.supply?.irSetting) return b.supply.irSetting;
  if (!b.sourceKva || !ratingA) return undefined;
  const flc = (b.sourceKva * 1000) / (SQRT3 * project.voltageV);
  const s = Math.ceil((flc / ratingA) / 0.05 - 1e-9) * 0.05;
  return s < 1 ? Math.max(0.4, +s.toFixed(2)) : undefined;
}

export function buildTxSummary(project: Project): TxSummary {
  const mains = boardsInSupplyOrder(project).filter((b) => !b.upstreamId);
  const dfDefault = project.info?.mdDemandFactor ?? 0.8;
  const rows: TxSummaryRow[] = mains.map((b) => {
    const tree = subtree(project, b.id);
    const feeders = project.feeders.filter((f) => tree.has(f.boardId));
    const ratingA = b.supply?.ratingA ?? b.ratedCurrentA;
    const device = b.supply?.device === 'MCCB' || (!b.supply?.device && (ratingA ?? 0) < 800) ? 'MCCB' : 'ACB';
    const setting = breakerSetting(project, b, ratingA);
    const fault = faultCurrentKA(impedanceToBoard(project, b.id), project.voltageV);
    const faultKa = b.supply?.faultKa ?? (Number.isFinite(fault) && b.sourceKva ? STANDARD_ICU_KA.find((k) => k >= fault - 1e-6) : undefined);
    const manual = !project.feeders.some((f) => f.boardId === b.id);
    const phases = manual ? { ...ZERO, ...b.summaryLoad } : connectedPhaseKw(project, b.id);
    const tclKw = phases.R + phases.Y + phases.B;
    const df = b.mdDemandFactor ?? dfDefault;
    const meters: Record<MeterType, number> = { '1-PH': 0, '3-PH': 0, CT: 0 };
    const cts: Record<string, number> = {};
    // The transformer's own meter, then every metered feeder below it.
    const own: MeterType | undefined = b.supply?.meter ?? (ratingA ? suggestedMeter(ratingA, true) : undefined);
    const ownCt = b.supply?.ctRatio ?? ctFor((ratingA ?? 0) * (setting ?? 1));
    if (manual && b.summaryMeters) {
      // Typed on the form: every meter of this transformer, its own included.
      (['1-PH', '3-PH', 'CT'] as MeterType[]).forEach((m) => (meters[m] = b.summaryMeters?.[m] ?? 0));
      if (meters.CT) cts[ownCt] = meters.CT;
    } else if (own) {
      meters[own]++;
      if (own === 'CT') cts[ownCt] = (cts[ownCt] ?? 0) + 1;
    }
    for (const f of feeders) {
      if (!f.kwhMeter) continue;
      meters[f.kwhMeter]++;
      if (f.kwhMeter === 'CT') { const r = ctFor(f.breakerRatingA); cts[r] = (cts[r] ?? 0) + 1; }
    }
    const standbyKw = feeders.filter((f: Feeder) => f.standbyUnit && !f.feedsBoardId).reduce((s, f) => s + f.loadKw, 0);
    return {
      board: b, poles: '4P', device, ratingA, setting, faultKa, cable: b.supply?.cable ?? `BY ${b.supply?.fedFrom ?? 'DEWA'}`, ecc: b.supply?.ecc ?? '',
      phases, tclKw, df, mdlKw: tclKw * df, standbyKw, meters, cts, manual
    };
  });
  // Substations: as set on the main board, else its RMU, else one substation.
  const nameOf = (b: Board) => (b.substation || (b.rmu ? `SUBSTATION ${b.rmu}` : 'SUBSTATION-01')).toUpperCase();
  const groups: TxSummary['groups'] = [];
  for (const r of rows) {
    const n = nameOf(r.board);
    const g = groups.find((x) => x.name === n);
    if (g) g.rows.push(r); else groups.push({ name: n, rows: [r] });
  }
  const phases = rows.reduce((a, r) => ({ R: a.R + r.phases.R, Y: a.Y + r.phases.Y, B: a.B + r.phases.B }), ZERO);
  const tclKw = rows.reduce((s, r) => s + r.tclKw, 0);
  const mdlKw = rows.reduce((s, r) => s + r.mdlKw, 0);
  const meters: Record<MeterType, number> = { '1-PH': 0, '3-PH': 0, CT: 0 };
  const cts: Record<string, number> = {};
  for (const r of rows) {
    (['1-PH', '3-PH', 'CT'] as MeterType[]).forEach((m) => (meters[m] += r.meters[m]));
    for (const [k, v] of Object.entries(r.cts)) cts[k] = (cts[k] ?? 0) + v;
  }
  const info = project.info ?? {};
  return {
    groups, phases, tclKw, mdlKw, diversity: tclKw > 0 ? mdlKw / tclKw : 0,
    tclDutyKw: tclKw - rows.reduce((s, r) => s + r.standbyKw, 0),
    meters, ctText: ctText(cts),
    header: {
      project: project.name, area: info.area ?? '', completion: info.plannedCompletion ?? '', owner: info.owner ?? '', plotNo: info.plotNo ?? '',
      consultant: info.consultant ?? '', location: mains[0]?.location ?? ''
    }
  };
}

/** A new transformer (main board) on the summary form, in a substation. */
export function addTransformerRow(project: Project, substation: string): { project: Project; id: string } {
  const taken = new Set(project.boards.map((b) => b.id));
  let n = project.boards.filter((b) => !b.upstreamId).length + 1;
  while (taken.has(`MDB-${n}`)) n++;
  const id = `MDB-${n}`;
  const board: Board = { id, name: 'Main Distribution Board', kind: 'MDB', sourceKva: 1500, sourceImpedancePct: 6, ratedCurrentA: 2500, substation };
  return { project: { ...project, boards: [...project.boards, board] }, id };
}

/** Substations on the form, in order (as shown in the group rows). */
export const nextSubstationName = (s: TxSummary) => {
  let n = s.groups.length + 1;
  while (s.groups.some((g) => g.name === `SUBSTATION-${String(n).padStart(2, '0')}`)) n++;
  return `SUBSTATION-${String(n).padStart(2, '0')}`;
};

export const rowCtText = (r: TxSummaryRow) => ctText(r.cts).replace(/^1X /, '').replace(/ \+ 1X /g, ' + ');
export const acbText = (r: TxSummaryRow) => (r.ratingA ? `${r.ratingA}${r.setting ? ` @ ${r.setting.toFixed(2)}` : ''}` : '');
