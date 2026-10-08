import type { Board, Feeder, Project } from '../types';
import { settingsOf } from '../types';
import { boardsInSupplyOrder, boardTotals } from './summary';
import { DEFAULT_TRANSFORMER_XR, faultCurrentKA, transformerImpedance } from './electrical';
import { switchedOnBoard } from './capSwitching';
import { STANDARD_BREAKER_A, STANDARD_TRANSFORMER_KVA, chooseGenerator, isEssential, standbyBoards, type GeneratorChoice } from './sizing';
import { GENERATOR_XD_TRANSIENT_PCT, isMotor, MOTOR_START_DIP_LIMIT_PCT, motorStartDipPct, runningKva, startingKva } from './motor';
import { planPfc, subtree } from './pfc';
import { transformerFor } from '../database/catalog';

/** Transformer and standby generator sizing, done at board level:
 *  - a transformer per main board (the ones chosen), with duty / standby
 *    (2 × 100 %) and bus-coupler outage checks, and what the chosen size
 *    means at the MDB: full-load current, ACB, LV fault level, regulation;
 *  - the generator from whole boards (or a share of one) instead of a list
 *    of every circuit, with the largest motor starting last on top of the
 *    running load. */

export interface TxGenPlan {
  /** Main boards to size (empty = all). */
  txBoards: string[];
  /** Standard sizes: DEWA 11 / 0.415 kV (500, 1000, 1500 kVA) or the IEC list. */
  sizeList: 'dewa' | 'iec';
  /** Main boards with two transformers, each carrying the whole load (duty / standby). */
  n1: string[];
  /** Take the planned PF correction (Power factor page) off the demand. */
  includePfc: boolean;
  /** On a bus-coupler outage, the healthy transformer may run up to this % of its rating. */
  emergencyLoadingPct: number;
  /** Boards on the generator, with the share of their load (100 = all of it). */
  genBoards: Record<string, number>;
}

export const TXGEN_DEFAULTS: TxGenPlan = { txBoards: [], sizeList: 'dewa', n1: [], includePfc: true, emergencyLoadingPct: 100, genBoards: {} };
export const txGenPlanOf = (p: Project): TxGenPlan => ({ ...TXGEN_DEFAULTS, ...p.txGen, genBoards: { ...p.txGen?.genBoards } });

export const DEWA_TRANSFORMER_KVA = [500, 1000, 1500];
const SQRT3 = Math.sqrt(3);
const nextStd = (list: number[], v: number) => list.find((x) => x >= v - 1e-9);
export const sizesOf = (plan: TxGenPlan) => (plan.sizeList === 'dewa' ? DEWA_TRANSFORMER_KVA : STANDARD_TRANSFORMER_KVA);

/** Typical impedance (IEC 60076-5 minimum values). */
export const typicalImpedancePct = (kva: number) => transformerFor(kva)?.zPct ?? (kva <= 630 ? 4 : kva <= 1250 ? 5 : 6);

export interface TxChecks {
  kva: number;
  impedancePct: number;
  flcA: number; // full-load current, LV side
  acbA: number; // incomer ACB / main breaker, next standard ≥ FLC
  faultKa: number; // LV busbar, infinite MV source
  regulationPct: number; // at the design demand and PF
  busbarA?: number;
  busbarOk?: boolean;
  minIcuKa?: number; // lowest breaking capacity of the MDB's breakers
  icuOk?: boolean;
}

export interface TxRow {
  board: Board;
  demandKw: number;
  demandKvar: number;
  pfcKvar: number; // planned capacitors taken off
  demandKva: number;
  pf: number;
  designKva: number;
  n1: boolean;
  /** Transformers needed when the design is above the largest standard size. */
  split: number;
  recommendedKva?: number;
  installedKva?: number;
  loadingPct?: number; // demand ÷ installed
  adequate?: boolean;
  /** For the recommended size (or the installed one when there's no recommendation). */
  checks?: TxChecks;
  /** Bus coupler: the other transformer out, this one carries both. */
  outage?: { with: string; kva: number; pctOfRecommended?: number; ok: boolean };
  /** One level down: what the demand is made of. */
  breakdown: { id: string; label: string; kva: number }[];
}

export function transformerChecks(project: Project, board: Board, kva: number, demandKva: number, pf: number, impedancePct = typicalImpedancePct(kva)): TxChecks {
  const xr = board.sourceXr ?? DEFAULT_TRANSFORMER_XR;
  const flcA = (kva * 1000) / (SQRT3 * project.voltageV);
  const acbA = nextStd(STANDARD_BREAKER_A, flcA) ?? STANDARD_BREAKER_A[STANDARD_BREAKER_A.length - 1];
  const faultKa = faultCurrentKA(transformerImpedance(kva, impedancePct, project.voltageV, xr), project.voltageV);
  const ur = impedancePct / Math.sqrt(1 + xr * xr);
  const ux = ur * xr;
  const load = demandKva / kva;
  const regulationPct = load * (ur * pf + ux * Math.sin(Math.acos(Math.min(pf, 1))));
  const icus = project.feeders.filter((f) => f.boardId === board.id && f.breakerIcuKa).map((f) => f.breakerIcuKa!);
  const minIcuKa = icus.length ? Math.min(...icus) : undefined;
  return {
    kva, impedancePct, flcA, acbA, faultKa, regulationPct,
    busbarA: board.ratedCurrentA, busbarOk: board.ratedCurrentA ? board.ratedCurrentA >= flcA - 1e-6 : undefined,
    minIcuKa, icuOk: minIcuKa !== undefined ? minIcuKa >= faultKa - 1e-6 : undefined
  };
}

export function sizeTransformers(project: Project, plan: TxGenPlan = txGenPlanOf(project)): TxRow[] {
  const s = settingsOf(project);
  const sizes = sizesOf(plan);
  const mains = boardsInSupplyOrder(project).filter((b) => !b.upstreamId);
  const chosen = mains.filter((b) => plan.txBoards.includes(b.id));
  const pfc = plan.includePfc ? planPfc(project) : undefined;
  const pq = (id: string) => {
    const t = boardTotals(project, id);
    const cap = pfc?.mains.find((m) => m.boardId === id)?.plannedKvar ?? 0;
    return { p: t.demandKw, q: Math.max(0, t.demandKvar - cap), cap };
  };
  return (chosen.length ? chosen : mains).map((b) => {
    const { p, q, cap } = pq(b.id);
    const demandKva = Math.hypot(p, q);
    const pf = demandKva > 0 ? p / demandKva : 1;
    const designKva = (demandKva * (1 + s.futureGrowthPct / 100)) / (s.transformerMaxLoadingPct / 100);
    const largest = sizes[sizes.length - 1];
    const split = designKva > largest ? Math.ceil(designKva / largest) : 1;
    const recommendedKva = split > 1 ? largest : nextStd(sizes, designKva);
    const installedKva = b.sourceKva;
    const checkKva = recommendedKva ?? installedKva;
    const tie = (project.ties ?? []).find((t) => t.a === b.id || t.b === b.id);
    let outage: TxRow['outage'];
    if (tie) {
      const other = tie.a === b.id ? tie.b : tie.a;
      const o = pq(other);
      const both = Math.hypot(p + o.p, q + o.q);
      const cap2 = (recommendedKva ?? installedKva ?? 0) * (plan.emergencyLoadingPct / 100);
      outage = { with: other, kva: both, pctOfRecommended: recommendedKva ? (both / recommendedKva) * 100 : undefined, ok: cap2 > 0 && both <= cap2 + 1e-6 };
    }
    // Breakdown one level down: sub-boards by their incomer, and the MDB's own loads together.
    const breakdown: TxRow['breakdown'] = [];
    let ownP = 0, ownQ = 0;
    // Banks on the MDB: their switched kvar at this load (as in boardTotals), shown with its own loads.
    const capsHere = project.feeders.filter((x) => x.boardId === b.id && x.kvar && !x.feedsBoardId);
    const noCaps = capsHere.length ? boardTotals({ ...project, feeders: project.feeders.filter((x) => !capsHere.includes(x)) }, b.id) : undefined;
    const switched = noCaps ? switchedOnBoard(capsHere, noCaps.demandKw, noCaps.demandKvar, settingsOf(project).pfTarget) : new Map<string, number>();
    for (const f of project.feeders.filter((x) => x.boardId === b.id)) {
      if (f.feedsBoardId) {
        const t = boardTotals(project, f.feedsBoardId);
        breakdown.push({ id: f.feedsBoardId, label: project.boards.find((x) => x.id === f.feedsBoardId)?.name ?? f.feedsBoardId, kva: Math.hypot(t.demandKw, t.demandKvar) });
      } else if (!f.generation) {
        const kw = f.loadKw * f.demandFactor;
        ownP += kw;
        ownQ += f.kvar ? -(switched.get(f.id) ?? 0) : kw * Math.tan(Math.acos(Math.min(Math.max(f.powerFactor, 0.01), 1)));
      }
    }
    if (ownP || ownQ) breakdown.push({ id: b.id, label: 'Loads on the MDB itself', kva: Math.hypot(ownP, ownQ) });
    return {
      board: b, demandKw: p, demandKvar: q, pfcKvar: cap, demandKva, pf, designKva, n1: plan.n1.includes(b.id), split,
      recommendedKva, installedKva, loadingPct: installedKva ? (demandKva / installedKva) * 100 : undefined,
      // The installed source (one rating on the main board) against the design demand. The split is a
      // proposal for new transformers, never a count of installed ones.
      adequate: installedKva ? installedKva >= designKva - 1e-6 : undefined,
      checks: checkKva ? transformerChecks(project, b, checkKva, demandKva / split, pf, checkKva === installedKva && b.sourceImpedancePct ? b.sourceImpedancePct : typicalImpedancePct(checkKva)) : undefined,
      outage, breakdown: breakdown.sort((x, y) => y.kva - x.kva)
    };
  });
}

/** Sets the recommended transformer on the main board: kVA, typical
 * impedance, and the busbar rating up to the ACB when it's lower. */
export function applyTransformer(project: Project, row: TxRow): Project {
  if (!row.recommendedKva || !row.checks) return project;
  const c = row.checks;
  return {
    ...project,
    boards: project.boards.map((b) => (b.id === row.board.id
      ? { ...b, sourceKva: row.recommendedKva, sourceImpedancePct: c.impedancePct, ratedCurrentA: Math.max(b.ratedCurrentA ?? 0, c.acbA) }
      : b))
  };
}

// ---- Generator ------------------------------------------------------------------

export interface GenPick {
  board: Board;
  pct: number;
  /** Why it's on the generator without being ticked. */
  auto?: 'standby' | 'emdb';
  /** Inside another picked board: already counted there. */
  within?: string;
  kw: number;
  kvar: number;
}

export interface GenSizing {
  picks: GenPick[];
  /** Circuits marked essential (fire pumps by default) outside the picked boards. */
  circuits: Feeder[];
  demandKw: number;
  demandKvar: number;
  demandKva: number;
  runningDesignKva: number; // running rating: max(kVA ÷ L, kW ÷ (0.8 × L))
  /** What sets the size (kVA, kW or the motor start), and no standard set fits. */
  governing: GeneratorChoice['governing'];
  noFit: boolean;
  /** Size for the largest motor start with the dip ≤ limit: X′d · S · (1 − L) ÷ L. */
  startDesignKva: number;
  recommendedKva?: number;
  recommendedKw?: number; // at 0.8 PF
  motor?: { feeder: Feeder; runningKva: number; startingKva: number; baseKva: number; peakKva: number; dipPct?: number };
  /** When the motor start sets the size: the set a soft starter (3 × running) would allow. */
  softStartKva?: number;
  installedKva?: number; // standby sets on the SLD
  installedOk?: boolean;
  flcA?: number;
  atsA?: number;
  mainBreakerA?: number;
}

export function sizeGeneratorByBoards(project: Project, plan: TxGenPlan = txGenPlanOf(project)): GenSizing {
  const s = settingsOf(project);
  const order = boardsInSupplyOrder(project);
  const standby = new Set(project.boards.filter((b) => b.standby).map((b) => b.id));
  const picked = new Map<string, { pct: number; auto?: GenPick['auto'] }>();
  for (const b of order) {
    if (plan.genBoards[b.id] !== undefined) picked.set(b.id, { pct: plan.genBoards[b.id] });
    else if (standby.has(b.id)) picked.set(b.id, { pct: 100, auto: 'standby' });
    else if (b.kind === 'EMDB') picked.set(b.id, { pct: 100, auto: 'emdb' });
  }
  const inTree = new Map<string, string>(); // board → the picked board above it
  for (const [id, v] of picked) if (v.pct > 0) for (const x of subtree(project, id)) if (x !== id && !inTree.has(x)) inTree.set(x, id);
  const picks: GenPick[] = [];
  for (const b of order) {
    const v = picked.get(b.id);
    if (!v) continue;
    const t = boardTotals(project, b.id);
    picks.push({ board: b, pct: v.pct, auto: v.auto, within: inTree.get(b.id), kw: (t.demandKw * v.pct) / 100, kvar: (Math.max(0, t.demandKvar) * v.pct) / 100 });
  }
  const counted = picks.filter((x) => !x.within && x.pct > 0);
  const covered = new Set(counted.flatMap((x) => [...subtree(project, x.board.id)]));
  const backed = standbyBoards(project);
  const circuits = project.feeders.filter((f) => !f.feedsBoardId && !f.generation && !f.kvar && isEssential(f) && !covered.has(f.boardId) && !backed.has(f.boardId));
  let p = counted.reduce((a, x) => a + x.kw, 0);
  let q = counted.reduce((a, x) => a + x.kvar, 0);
  for (const f of circuits) {
    const kw = f.loadKw * f.demandFactor;
    p += kw;
    q += kw * Math.tan(Math.acos(Math.min(Math.max(f.powerFactor, 0.01), 1)));
  }
  const demandKva = Math.hypot(p, q);
  const loading = s.generatorMaxLoadingPct / 100;
  // Running rating: kVA ÷ L and kW ÷ (0.8 × L), whichever is larger.
  const runningDesignKva = chooseGenerator(p, demandKva, loading).runningKva;
  // Largest motor, started last with everything else running.
  const motors = [...project.feeders.filter((f) => isMotor(f) && covered.has(f.boardId)), ...circuits.filter(isMotor)]
    .map((f) => ({ feeder: f, runningKva: runningKva(f), startingKva: startingKva(f) }))
    .sort((a, b) => b.startingKva - a.startingKva);
  const m = motors[0];
  const L = MOTOR_START_DIP_LIMIT_PCT / 100;
  const startDesignKva = m ? (GENERATOR_XD_TRANSIENT_PCT / 100) * m.startingKva * (1 - L) / L : 0;
  const any = counted.length > 0 || circuits.length > 0;
  // One set meeting the running kVA, the running kW and the motor start (the start rating is not divided by L again).
  const choice = chooseGenerator(p, demandKva, loading, startDesignKva);
  const recommendedKva = any ? choice.kva : undefined;
  const baseKva = m ? Math.max(0, demandKva - m.runningKva) : 0;
  const installed = project.boards.filter((b) => b.standby).reduce((a, b) => a + b.standby!.kva, 0) || undefined;
  const flcA = recommendedKva ? (recommendedKva * 1000) / (SQRT3 * project.voltageV) : undefined;
  return {
    picks, circuits, demandKw: p, demandKvar: q, demandKva, runningDesignKva, startDesignKva,
    recommendedKva, recommendedKw: recommendedKva ? choice.kw : undefined,
    governing: choice.governing, noFit: any && choice.noFit,
    motor: m ? { ...m, baseKva, peakKva: baseKva + m.startingKva, dipPct: recommendedKva ? motorStartDipPct(m.startingKva, recommendedKva) : undefined } : undefined,
    installedKva: installed,
    // Installed sets against the same rule: running kVA and kW within the loading limit and the motor start.
    installedOk: installed === undefined ? undefined : installed * loading >= demandKva - 1e-9 && installed * 0.8 * loading >= p - 1e-9 && installed >= startDesignKva - 1e-9,
    softStartKva: m && startDesignKva > runningDesignKva && m.startingKva > m.runningKva * 3
      // A soft starter lowers the start rating, never below the running kVA and kW floor.
      ? chooseGenerator(p, demandKva, loading, (GENERATOR_XD_TRANSIENT_PCT / 100) * m.runningKva * 3 * (1 - L) / L).kva
      : undefined,
    flcA,
    atsA: flcA ? nextStd(STANDARD_BREAKER_A, flcA) : undefined,
    mainBreakerA: flcA ? nextStd(STANDARD_BREAKER_A, flcA) : undefined
  };
}
