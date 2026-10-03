import type { Feeder, Project } from '../types';
import { settingsOf } from '../types';
import { boardsInSupplyOrder, boardTotals, loadTypeOf } from './summary';
import { applyRecommendation, breakerRatings, recommend } from './sizing';

/** Power factor correction plan: where the capacitor banks go and how
 * they're built.
 *  - central: one bank per main board (all, or the ones chosen);
 *  - group: banks at the boards chosen (e.g. a chiller SMDB or an MCC), plus
 *    optionally the main board for what's left;
 *  - individual: fixed capacitors at the larger motors / HVAC units, plus
 *    optionally the main board for what's left.
 * Banks are sized from the bottom up: a board's bank only covers what the
 * banks below it (planned, and already on the SLD) don't. */

export type PfcStrategy = 'central' | 'group' | 'individual';
export type Detuning = 'auto' | 0 | 7 | 14;

export interface PfcPlan {
  strategy: PfcStrategy;
  /** central: main boards to correct (empty = all); group: boards that get a bank. */
  boards: string[];
  /** group / individual: a bank at the main board for what's left. */
  remainder: boolean;
  stepKvar: number;
  detuning: Detuning;
  /** individual: loads from this size (kW). */
  minKw: number;
  /** Light-load check: load as % of the maximum demand. */
  lightLoadPct: number;
}

export const PFC_DEFAULTS: PfcPlan = { strategy: 'central', boards: [], remainder: true, stepKvar: 25, detuning: 'auto', minKw: 11, lightLoadPct: 30 };
export const PFC_STEPS = [5, 10, 12.5, 25, 50];
export const pfcPlanOf = (p: Project): PfcPlan => ({ ...PFC_DEFAULTS, ...p.pfc });

export const STRATEGY_LABEL: Record<PfcStrategy, string> = {
  central: 'Central — at the main board (MDB)',
  group: 'Group — at the boards you choose',
  individual: 'Individual — at the larger motors / HVAC'
};

const SQRT3 = Math.sqrt(3);
const CAP_VOLTAGES = [400, 415, 440, 460, 480, 525, 550, 690];
/** Share of non-linear load above which a detuned bank is recommended. */
const DETUNE_AT = 0.25;

export interface PfcRow {
  key: string;
  kind: 'board' | 'load';
  boardId: string; // where the bank connects
  feederId?: string; // individual: the load corrected
  label: string;
  remainder?: boolean; // the main board's bank for what's left
  demandKw: number;
  /** Reactive demand after the capacitors already on the SLD. */
  demandKvar: number;
  existingKvar: number; // capacitors already on the SLD, here and below
  downstreamKvar: number; // planned banks below, taken off this one
  pfBefore: number; // with existing capacitors, before the planned banks (here and below)
  pfTarget: number;
  requiredKvar: number;
  bankKvar: number;
  steps: number;
  stepKvar: number;
  pfAfter: number;
  kvaBefore: number;
  kvaAfter: number;
  currentBeforeA: number;
  currentAfterA: number;
  harmonicPct: number; // non-linear load (VFD, IT, EV, PV inverters, LED lighting) as % of demand
  detunedPct: number;
  capVoltageV: number; // capacitor rated voltage
  bankCurrentA: number;
  breakerA?: number; // ≥ 1.43 × bank current (IEC 60831: 1.3 × 1.1 capacitance tolerance)
  cable?: string;
  notes: string[];
  warn: boolean;
}

export interface PfcMain {
  boardId: string;
  demandKw: number;
  pfBefore: number;
  pfAfter: number;
  kvaBefore: number;
  kvaAfter: number;
  releasedKva: number;
  plannedKvar: number;
  existingKvar: number;
  transformerKva?: number;
  loadingBeforePct?: number;
  loadingAfterPct?: number;
}

export interface PfcResult {
  plan: PfcPlan;
  pfTarget: number;
  rows: PfcRow[];
  mains: PfcMain[];
  /** Boards without a bank of their own (corrected above them, or not at all). */
  notCorrected: string[];
  totalKvar: number;
}

const kvarOf = (p: number, pf: number) => p * Math.tan(Math.acos(Math.min(Math.max(pf, 0.01), 1)));
const pfOf = (p: number, q: number) => (Math.hypot(p, q) > 0 ? p / Math.hypot(p, q) : 1);

/** The board and everything below it. */
export function subtree(project: Project, boardId: string): Set<string> {
  const out = new Set<string>([boardId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of project.feeders) {
      if (f.feedsBoardId && out.has(f.boardId) && !out.has(f.feedsBoardId)) { out.add(f.feedsBoardId); grew = true; }
    }
  }
  return out;
}

const isNonLinear = (f: Feeder) => f.starter === 'VFD' || ['it', 'ev', 'pv'].includes(loadTypeOf(f)) || loadTypeOf(f) === 'lighting';
const isCap = (f: Feeder) => !!f.kvar || loadTypeOf(f) === 'capacitor';

/** Share of the demand that's non-linear (lighting counted at half: LED drivers). */
export function harmonicShare(project: Project, boards: Set<string>): number {
  let all = 0, nl = 0;
  for (const f of project.feeders) {
    if (!boards.has(f.boardId) || f.feedsBoardId || isCap(f) || f.generation) continue;
    const kw = f.loadKw * f.demandFactor;
    all += kw;
    if (isNonLinear(f)) nl += loadTypeOf(f) === 'lighting' ? kw / 2 : kw;
  }
  return all > 0 ? nl / all : 0;
}

/** Capacitor rating: 1.05 × U ÷ (1 − p) for the reactor's voltage rise, next standard. */
export const capVoltage = (systemV: number, detunedPct: number) =>
  CAP_VOLTAGES.find((v) => v >= (1.05 * systemV) / (1 - detunedPct / 100) - 1e-6) ?? 690;

/** A capacitor bank way: breaker ≥ 1.43 × its current and a cable to suit. */
export function capacitorFeeder(project: Project, boardId: string, id: string, name: string, kvar: number, steps = 1, detunedPct = 0): Feeder {
  const f: Feeder = {
    id, boardId, name, loadKw: 0, demandFactor: 1, powerFactor: 1, kvar, lengthM: 10, cableCsaMm2: 4, cores: 4,
    breakerRatingA: 16, breakerIcuKa: 25, loadType: 'capacitor',
    capSteps: Math.max(1, Math.round(steps)), // an automatic bank (APFC relay) — switched by steps in the calculations
    ...(detunedPct ? { detunedPct } : {})
  };
  return applyRecommendation(f, recommend({ ...project, feeders: [...project.feeders, f] }, f, 'optimise'));
}

const cableText = (f: Feeder) => `${(f.parallel ?? 1) > 1 ? `${f.parallel} × ` : ''}${f.cores}C × ${f.cableCsaMm2} mm²`;

export function planPfc(project: Project, plan: PfcPlan = pfcPlanOf(project)): PfcResult {
  const target = settingsOf(project).pfTarget;
  const order = boardsInSupplyOrder(project);
  const mains = order.filter((b) => !b.upstreamId);
  const known = new Set(project.boards.map((b) => b.id));
  const chosen = plan.boards.filter((id) => known.has(id));
  const step = plan.stepKvar > 0 ? plan.stepKvar : 25;
  const trees = new Map(project.boards.map((b) => [b.id, subtree(project, b.id)]));
  const tree = (id: string) => trees.get(id) ?? new Set([id]);

  // Where the banks go.
  const boardBanks: string[] =
    plan.strategy === 'central'
      ? (mains.some((b) => chosen.includes(b.id)) ? mains.filter((b) => chosen.includes(b.id)) : mains).map((b) => b.id)
      : [
          ...(plan.strategy === 'group' ? order.filter((b) => chosen.includes(b.id)).map((b) => b.id) : []),
          ...(plan.remainder ? mains.map((b) => b.id) : [])
        ].filter((id, i, a) => a.indexOf(id) === i);
  const loads = plan.strategy === 'individual'
    ? project.feeders.filter((f) => !f.feedsBoardId && !f.generation && !isCap(f) && ['motor', 'hvac'].includes(loadTypeOf(f)) && f.loadKw >= plan.minKw && f.powerFactor < target)
    : [];

  const rows: PfcRow[] = [];
  const i = (kva: number) => (kva * 1000) / (SQRT3 * project.voltageV);
  const existingIn = (boards: Set<string>) => project.feeders.filter((f) => boards.has(f.boardId) && isCap(f)).reduce((s, f) => s + (f.kvar ?? 0), 0);

  // Individual capacitors first (fixed, at the load; rounded down so the
  // motor is never over-corrected).
  for (const f of loads) {
    const p = f.loadKw * f.demandFactor;
    const q = kvarOf(p, f.powerFactor);
    const vfd = f.starter === 'VFD';
    const need = vfd ? 0 : Math.max(0, q - kvarOf(p, target));
    const unit = step <= 5 ? step : 2.5;
    const bank = Math.floor(need / unit + 1e-9) * unit;
    const notes = [
      ...(vfd ? ['VFD: the drive keeps the supply PF ≈ 0.95 — no capacitor at a drive output'] : []),
      ...(bank ? ['Fixed capacitor switched with the motor; keep it ≤ 90 % of the motor’s no-load kvar (maker’s data) to avoid self-excitation'] : []),
      ...(f.starter === 'SD' && bank ? ['Star-delta: connect on the line side of the starter'] : [])
    ];
    rows.push(makeRow({ key: `load:${f.id}`, kind: 'load', boardId: f.boardId, feederId: f.id, label: `${f.name} (${f.id})`, p, q, existing: 0, downstream: 0, bank, steps: 1, stepKvar: bank, harmonic: vfd ? 1 : 0, detuned: 0, notes }));
  }

  // Board banks, deepest first, each after the planned banks below it.
  const byDepth = [...boardBanks].sort((a, b) => order.findIndex((x) => x.id === b) - order.findIndex((x) => x.id === a));
  for (const id of byDepth) {
    const t = boardTotals(project, id);
    const below = tree(id);
    const downstream = rows.filter((r) => below.has(r.boardId)).reduce((s, r) => s + r.bankKvar, 0);
    const p = t.demandKw;
    const q = t.demandKvar - downstream;
    const need = Math.max(0, q - kvarOf(p, target));
    const bank = Math.ceil(need / step - 1e-9) * step;
    const harmonic = harmonicShare(project, below);
    const detuned = plan.detuning === 'auto' ? (harmonic >= DETUNE_AT ? 7 : 0) : plan.detuning;
    const notes: string[] = [];
    if (bank && plan.detuning === 'auto' && detuned) notes.push(`${Math.round(harmonic * 100)} % non-linear load — detuned bank (7 %, 189 Hz) recommended`);
    else if (bank && !detuned && harmonic >= 0.1) notes.push(`${Math.round(harmonic * 100)} % non-linear load — check harmonics; consider a detuned bank`);
    // Light load: the first step alone mustn't take the board leading.
    const qLight = (q * plan.lightLoadPct) / 100;
    if (bank && step > qLight) notes.push(`At ${plan.lightLoadPct} % load the reactive demand is ${qLight.toFixed(0)} kvar — a ${step} kvar step would go leading; use a smaller first step`);
    const isMain = !project.boards.find((b) => b.id === id)?.upstreamId;
    rows.push(makeRow({
      key: `board:${id}`, kind: 'board', boardId: id, label: id, remainder: isMain && plan.strategy !== 'central' && downstream > 0,
      p, q, existing: existingIn(below), downstream, bank, steps: bank ? Math.round(bank / step) : 0, stepKvar: step, harmonic, detuned, notes
    }));
  }

  function makeRow(a: { key: string; kind: PfcRow['kind']; boardId: string; feederId?: string; label: string; remainder?: boolean; p: number; q: number; existing: number; downstream: number; bank: number; steps: number; stepKvar: number; harmonic: number; detuned: number; notes: string[] }): PfcRow {
    const kvaBefore = Math.hypot(a.p, a.q + a.downstream);
    const qAfter = a.q - a.bank;
    const kvaAfter = Math.hypot(a.p, qAfter);
    const bankCurrentA = (a.bank * 1000) / (SQRT3 * project.voltageV);
    const way = a.bank ? capacitorFeeder(project, a.boardId, 'x', 'x', a.bank, a.steps, a.detuned) : undefined;
    return {
      key: a.key, kind: a.kind, boardId: a.boardId, feederId: a.feederId, label: a.label, remainder: a.remainder,
      demandKw: a.p, demandKvar: a.q + a.downstream, existingKvar: a.existing, downstreamKvar: a.downstream,
      pfBefore: pfOf(a.p, a.q + a.downstream), pfTarget: target, requiredKvar: Math.max(0, a.q - kvarOf(a.p, target)),
      bankKvar: a.bank, steps: a.steps, stepKvar: a.stepKvar, pfAfter: pfOf(a.p, qAfter),
      kvaBefore, kvaAfter, currentBeforeA: i(kvaBefore), currentAfterA: i(kvaAfter),
      harmonicPct: a.harmonic * 100, detunedPct: a.detuned, capVoltageV: capVoltage(project.voltageV, a.detuned),
      bankCurrentA, breakerA: way?.breakerRatingA ?? (a.bank ? breakerRatings().find((r) => r >= bankCurrentA * 1.43) : undefined), cable: way ? cableText(way) : undefined,
      notes: a.notes, warn: a.notes.some((n) => /leading|check harmonics/.test(n))
    };
  }

  // Supply order for display: each board, its loads' capacitors after it.
  const rank = new Map(order.map((b, k) => [b.id, k]));
  rows.sort((a, b) => (rank.get(a.boardId)! - rank.get(b.boardId)!) || (a.kind === b.kind ? 0 : a.kind === 'board' ? -1 : 1));

  const mainsOut: PfcMain[] = mains.map((b) => {
    const t = boardTotals(project, b.id);
    const below = tree(b.id);
    const planned = rows.filter((r) => below.has(r.boardId)).reduce((s, r) => s + r.bankKvar, 0);
    const kvaBefore = Math.hypot(t.demandKw, t.demandKvar);
    const kvaAfter = Math.hypot(t.demandKw, t.demandKvar - planned);
    return {
      boardId: b.id, demandKw: t.demandKw, pfBefore: pfOf(t.demandKw, t.demandKvar), pfAfter: pfOf(t.demandKw, t.demandKvar - planned),
      kvaBefore, kvaAfter, releasedKva: kvaBefore - kvaAfter, plannedKvar: planned, existingKvar: existingIn(below),
      transformerKva: b.sourceKva, loadingBeforePct: b.sourceKva ? (kvaBefore / b.sourceKva) * 100 : undefined, loadingAfterPct: b.sourceKva ? (kvaAfter / b.sourceKva) * 100 : undefined
    };
  });

  const withBank = new Set(rows.filter((r) => r.kind === 'board').map((r) => r.boardId));
  return {
    plan, pfTarget: target, rows, mains: mainsOut,
    notCorrected: order.filter((b) => !withBank.has(b.id)).map((b) => b.id),
    totalKvar: rows.reduce((s, r) => s + r.bankKvar, 0)
  };
}

/** Puts the planned banks on the SLD: a board with a capacitor bank already
 * gets it enlarged, others a new bank way; individual capacitors go on the
 * load's board, named after the load. keys: only these rows. */
export function addPfcBanks(project: Project, result: PfcResult, keys?: string[]): { project: Project; added: string[] } {
  let p = project;
  const added: string[] = [];
  const taken = new Set([...p.feeders.map((f) => f.id), ...p.boards.map((b) => b.id)]);
  const unique = (base: string) => { if (!taken.has(base)) { taken.add(base); return base; } for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) { taken.add(`${base}-${n}`); return `${base}-${n}`; } };
  for (const r of result.rows) {
    if (!r.bankKvar || (keys && !keys.includes(r.key))) continue;
    const existing = r.kind === 'board' ? p.feeders.find((f) => f.boardId === r.boardId && isCap(f) && !f.name.startsWith('PFC for ')) : undefined;
    if (existing) {
      const kvar = (existing.kvar ?? 0) + r.bankKvar;
      const f = capacitorFeeder(p, r.boardId, existing.id, existing.name, kvar, Math.round(kvar / r.stepKvar), r.detunedPct);
      p = { ...p, feeders: p.feeders.map((x) => (x.id === existing.id ? { ...existing, ...f, name: existing.name, lengthM: existing.lengthM } : x)) };
      added.push(`${existing.id} → ${kvar} kvar`);
    } else {
      const load = r.feederId ? p.feeders.find((f) => f.id === r.feederId) : undefined;
      const id = unique(load ? `${load.id}-CAP` : `${r.boardId}-CAP`);
      const f = capacitorFeeder(p, r.boardId, id, load ? `PFC for ${load.name}` : `PFC bank ${r.bankKvar} kvar`, r.bankKvar, r.steps, r.detunedPct);
      // Next to the load it corrects, else at the end of the board.
      const at = load ? p.feeders.findIndex((x) => x.id === load.id) + 1 : p.feeders.length;
      p = { ...p, feeders: [...p.feeders.slice(0, at), f, ...p.feeders.slice(at)] };
      added.push(`${id} ${r.bankKvar} kvar`);
    }
  }
  return { project: p, added };
}
