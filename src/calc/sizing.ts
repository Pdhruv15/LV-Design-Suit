import { deratedAmpacityA, designCurrentA, evaluateFeeder, faultCurrentKA, impedanceToBoard, runsOf, selectCableRuns, upstreamVoltageDropPct, voltageDropPct } from './electrical';
import { boardTotals, loadTypeOf, systemSummary } from './summary';
import { breakerTypeOf } from './earthing';
import { isMotor, motorStartDipPct, runningKva, startingKva } from './motor';
import { settingsOf, type Board, type BreakerType, type Feeder, type Project } from '../types';

const SQRT3 = Math.sqrt(3);

export const STANDARD_BREAKER_A = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
export const STANDARD_ICU_KA = [6, 10, 15, 25, 36, 50, 65, 70, 85, 100];

let breakerList = STANDARD_BREAKER_A;
let icuList = STANDARD_ICU_KA;

/** Breaker ratings the sizing may choose from (Breakers.xlsx, else standard). */
export const breakerRatings = () => breakerList;
/** Icu steps the sizing may choose from (Breakers.xlsx Icu column, else standard). */
export const icuSteps = () => icuList;

/** Sets the ratings / Icu steps from the database (null or empty = standard). */
export function setBreakerLists(ratings: number[] | null, icu: number[] | null): void {
  const clean = (l: number[] | null, fallback: number[]) => (l && l.length ? [...new Set(l)].sort((a, b) => a - b) : fallback);
  breakerList = clean(ratings, STANDARD_BREAKER_A);
  icuList = clean(icu, STANDARD_ICU_KA);
}
export const STANDARD_TRANSFORMER_KVA = [100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150];
export const STANDARD_GENERATOR_KVA = [20, 30, 45, 60, 80, 100, 125, 150, 200, 250, 300, 350, 400, 500, 630, 750, 800, 1000, 1250, 1500, 2000, 2500];

export { settingsOf };
const nextStandard = (list: number[], v: number) => list.find((x) => x >= v - 1e-9);

// ---------------------------------------------------------------- transformer

export interface TransformerSizing {
  demandKva: number;
  designKva: number; // demand × (1 + growth) ÷ max loading
  recommendedKva?: number; // next standard size, undefined if above the list
  installedKva: number;
  loadingPct?: number; // present demand vs installed
  adequate: boolean;
}

export function sizeTransformer(project: Project): TransformerSizing {
  const s = settingsOf(project);
  const sys = systemSummary(project);
  const designKva = (sys.demandKva * (1 + s.futureGrowthPct / 100)) / (s.transformerMaxLoadingPct / 100);
  return {
    demandKva: sys.demandKva,
    designKva,
    recommendedKva: nextStandard(STANDARD_TRANSFORMER_KVA, designKva),
    installedKva: sys.transformerKva,
    loadingPct: sys.transformerLoadingPct,
    adequate: sys.transformerKva >= designKva
  };
}

// ------------------------------------------------------------------ generator

export const isEssential = (f: Feeder) => !f.feedsBoardId && !f.generation && (f.essential ?? loadTypeOf(f) === 'fire-pump');

/** Boards backed by a standby generator (through an ATS), and every board
 * below them. */
export function standbyBoards(project: Project): Set<string> {
  const out = new Set(project.boards.filter((b) => b.standby).map((b) => b.id));
  for (let added = true; added; ) {
    added = false;
    for (const b of project.boards) if (b.upstreamId && out.has(b.upstreamId) && !out.has(b.id)) { out.add(b.id); added = true; }
  }
  return out;
}

/** Loads the generator must carry: those marked essential (fire pumps by
 * default) and everything on a generator-backed board. */
export function essentialFeeders(project: Project): Feeder[] {
  const backed = standbyBoards(project);
  return project.feeders.filter((f) => !f.feedsBoardId && !f.generation && !f.kvar && (isEssential(f) || backed.has(f.boardId)));
}

export const STANDARD_UPS_KVA = [1, 2, 3, 6, 10, 15, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500, 600, 800];

/** Demand kVA of everything supplied through a board. */
export function boardDemandKva(project: Project, boardId: string): number {
  const t = boardTotals(project, boardId);
  return Math.hypot(t.demandKw, Math.max(0, t.demandKvar));
}

/** Standard generator for a board's load at the design loading limit. */
export function generatorForBoard(project: Project, boardId: string): number {
  const kva = boardDemandKva(project, boardId) / (settingsOf(project).generatorMaxLoadingPct / 100);
  return nextStandard(STANDARD_GENERATOR_KVA, kva) ?? STANDARD_GENERATOR_KVA[STANDARD_GENERATOR_KVA.length - 1];
}

/** Standard UPS for a board's load at 80 % loading. */
export function upsForBoard(project: Project, boardId: string): number {
  return nextStandard(STANDARD_UPS_KVA, boardDemandKva(project, boardId) / 0.8) ?? STANDARD_UPS_KVA[STANDARD_UPS_KVA.length - 1];
}

/** UPS loading, % of its kVA. */
export function upsLoadingPct(project: Project, board: Board): number | undefined {
  return board.upsKva ? (boardDemandKva(project, board.id) / board.upsKva) * 100 : undefined;
}

export interface GeneratorSizing {
  essential: Feeder[];
  demandKw: number;
  demandKva: number;
  designKva: number;
  recommendedKva?: number;
  /** The motor with the largest starting kVA (with its starter). */
  largestMotor?: { feeder: Feeder; runningKva: number; startingKva: number; dipPct?: number };
}

/** Standby generator sized on the running demand of the essential loads.
 * The largest motor's direct-on-line starting kVA (≈ 6 × running) is shown
 * so it can be checked against the generator's transient dip data — that
 * check needs the manufacturer's curves and is not automated. */
export function sizeGenerator(project: Project): GeneratorSizing {
  const s = settingsOf(project);
  const essential = essentialFeeders(project);
  let p = 0;
  let q = 0;
  for (const f of essential) {
    const kw = f.loadKw * f.demandFactor;
    p += kw;
    q += kw * Math.tan(Math.acos(Math.min(Math.max(f.powerFactor, 0.01), 1)));
  }
  const demandKva = Math.hypot(p, q);
  const designKva = demandKva / (s.generatorMaxLoadingPct / 100);
  const recommendedKva = essential.length ? nextStandard(STANDARD_GENERATOR_KVA, designKva) : undefined;
  const motors = essential
    .filter(isMotor)
    .map((f) => ({ feeder: f, runningKva: runningKva(f), startingKva: startingKva(f), dipPct: recommendedKva ? motorStartDipPct(startingKva(f), recommendedKva) : undefined }))
    .sort((a, b) => b.startingKva - a.startingKva);
  return {
    essential,
    demandKw: p,
    demandKva,
    designKva,
    recommendedKva,
    largestMotor: motors[0]
  };
}

// --------------------------------------------------- power factor correction

export interface PfcSizing {
  boardId: string;
  demandKw: number;
  demandKvar: number;
  pfBefore: number;
  pfTarget: number;
  requiredKvar: number; // exact
  bankKvar: number; // rounded up to 25 kvar steps
  pfAfter: number;
  kvaBefore: number;
  kvaAfter: number;
  currentBeforeA: number;
  currentAfterA: number;
}

/** Capacitor bank at a board: Qc = P (tan φ1 − tan φ2), in 25 kvar steps. */
export function sizePfc(project: Project, boardId: string): PfcSizing {
  const target = settingsOf(project).pfTarget;
  const t = boardTotals(project, boardId);
  const p = t.demandKw;
  const q = t.demandKvar;
  const kvaBefore = Math.hypot(p, q);
  const pfBefore = kvaBefore > 0 ? p / kvaBefore : 1;
  const requiredKvar = pfBefore >= target ? 0 : Math.max(0, q - p * Math.tan(Math.acos(target)));
  const bankKvar = Math.max(0, Math.ceil(requiredKvar / 25 - 1e-9)) * 25;
  const qAfter = Math.max(0, q - bankKvar);
  const kvaAfter = Math.hypot(p, qAfter);
  const i = (kva: number) => (kva * 1000) / (SQRT3 * project.voltageV);
  return {
    boardId,
    demandKw: p,
    demandKvar: q,
    pfBefore,
    pfTarget: target,
    requiredKvar,
    bankKvar,
    pfAfter: kvaAfter > 0 ? p / kvaAfter : 1,
    kvaBefore,
    kvaAfter,
    currentBeforeA: i(kvaBefore),
    currentAfterA: i(kvaAfter)
  };
}

// --------------------------------------------------- breaker & cable selection

/** Voltage-drop budget used when recommending cables: incomers get a fixed
 * share; final circuits get what is left of 85 % of the limit (the point
 * where the checks start warning). */
const INCOMER_VD_BUDGET_PCT = 1;

export interface Recommendation {
  feeder: Feeder;
  ib: number;
  breakerRatingA?: number;
  breakerType: BreakerType;
  breakerIcuKa?: number;
  cableCsaMm2?: number;
  /** Cable runs in parallel for cableCsaMm2. */
  parallel?: number;
  changed: boolean;
  note?: string;
}

/** 'fix' only upsizes what fails a criterion and keeps anything already
 * adequate; 'optimise' also downsizes oversized breakers, Icu and cables. */
export type SelectionMode = 'fix' | 'optimise';

export function recommend(project: Project, f: Feeder, mode: SelectionMode = 'fix'): Recommendation {
  const ib = designCurrentA(f, project);
  // In ≥ Ib / 0.85 keeps breaker loading below the 85 % warning threshold.
  // Capacitor banks: In ≥ 1.43 × rated current (IEC 60831 — 1.3 for
  // harmonics × 1.1 capacitance tolerance); otherwise keep loading < 85 %.
  const minIn = nextStandard(breakerRatings(), f.kvar ? ib * 1.43 : ib / 0.85);
  const breakerRatingA = mode === 'fix' && minIn !== undefined && f.breakerRatingA >= minIn ? f.breakerRatingA : minIn;
  const faultKA = faultCurrentKA(impedanceToBoard(project, f.boardId), project.voltageV);
  const minIcu = nextStandard(icuSteps(), faultKA);
  const breakerIcuKa = mode === 'fix' && f.breakerIcuKa >= faultKA ? f.breakerIcuKa : minIcu;
  const current = breakerTypeOf(f);
  const isMcb = current === 'B' || current === 'C' || current === 'D';
  const breakerType: BreakerType =
    breakerRatingA && breakerRatingA > 1600
      ? 'ACB'
      : breakerRatingA && breakerRatingA > 63
        ? mode === 'fix' && current === 'ACB' ? 'ACB' : 'MCCB'
        : mode === 'fix' || isMcb ? current : 'C'; // ≤ 63 A: keep the device type; optimise swaps an MCCB for an MCB

  const budget = f.feedsBoardId
    ? INCOMER_VD_BUDGET_PCT
    : project.vdLimitPct * 0.85 - upstreamVoltageDropPct(project, f.boardId);
  // One run up to 300 mm², then 2–4 runs in parallel.
  const minCable = breakerRatingA
    ? selectCableRuns(ib, f.lengthM, project.voltageV, f.cores, f.powerFactor, project.ambientC, budget, breakerRatingA) ?? undefined
    : undefined;
  // 'fix' keeps the cable the feeder has when it already meets both the
  // breaker (Iz ≥ In) and the voltage drop budget.
  const keep = mode === 'fix' && !!breakerRatingA &&
    deratedAmpacityA(f.cableCsaMm2, project.ambientC, runsOf(f)) >= Math.max(ib, breakerRatingA) &&
    voltageDropPct(f, project) <= budget + 1e-9;
  const cableCsaMm2 = keep ? f.cableCsaMm2 : minCable?.csaMm2;
  const parallel = keep ? runsOf(f) : minCable?.runs;

  const note = !breakerRatingA
    ? 'Current above the largest standard breaker'
    : !cableCsaMm2
      ? 'No cable fits, even 4 runs of 300 mm² — shorten the run or split the load'
      : parallel && parallel > 1 && parallel !== runsOf(f)
        ? `${parallel} cables in parallel`
        : undefined;
  const changed =
    (breakerRatingA !== undefined && breakerRatingA !== f.breakerRatingA) ||
    (breakerIcuKa !== undefined && breakerIcuKa !== f.breakerIcuKa) ||
    (cableCsaMm2 !== undefined && cableCsaMm2 !== f.cableCsaMm2) ||
    (parallel !== undefined && parallel !== runsOf(f)) ||
    breakerType !== current;
  return { feeder: f, ib, breakerRatingA, breakerType, breakerIcuKa, cableCsaMm2, parallel, changed, note };
}

export function applyRecommendation(f: Feeder, r: Recommendation): Feeder {
  return {
    ...f,
    breakerRatingA: r.breakerRatingA ?? f.breakerRatingA,
    breakerIcuKa: r.breakerIcuKa ?? f.breakerIcuKa,
    cableCsaMm2: r.cableCsaMm2 ?? f.cableCsaMm2,
    parallel: r.parallel !== undefined ? (r.parallel > 1 ? r.parallel : undefined) : f.parallel,
    breakerType: r.breakerType,
    cpcMm2: r.cableCsaMm2 && r.cableCsaMm2 !== f.cableCsaMm2 ? undefined : f.cpcMm2 // re-derive CPC for a new cable size
  };
}

/** Applies every recommendation, incomers first (top of the tree down), so
 * each circuit is sized against the upstream voltage drop and fault level
 * that result from the circuits above it. */
export function applyAllRecommendations(project: Project, mode: SelectionMode = 'fix'): Project {
  const depth = (boardId: string): number => {
    const b = project.boards.find((x) => x.id === boardId);
    return b?.upstreamId ? 1 + depth(b.upstreamId) : 0;
  };
  const order = [...project.feeders].sort((a, b) => depth(a.boardId) - depth(b.boardId) || Number(!!b.feedsBoardId) - Number(!!a.feedsBoardId));
  let p = project;
  for (const f of order) {
    const current = p.feeders.find((x) => x.id === f.id)!;
    const next = applyRecommendation(current, recommend(p, current, mode));
    p = { ...p, feeders: p.feeders.map((x) => (x.id === f.id ? next : x)) };
  }
  return p;
}

/** Whether a feeder already passes every check (used to label rows). */
export const passes = (project: Project, f: Feeder) => evaluateFeeder(project, f).status === 'ok';
