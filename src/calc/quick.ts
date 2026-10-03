import { ambientCorrectionFactor, cables, getCable } from './cableTable';
import { cableImpedance, faultCurrentKA, rOperatingOhmPerKm, selectCableRuns, transformerImpedance, zMagnitude } from './electrical';
import { STARTERS } from './motor';
import { breakerRatings } from './sizing';
import type { StarterType } from '../types';

/** Everyday electrical calculators, independent of the project: current
 * from power and back, kW / kVA / kVAr, voltage drop, cable and breaker
 * size, transformer and motor currents, power factor correction, fault
 * level at the end of a cable, Ohm's law, energy cost and unit
 * conversions. Same formulas and cable data as the network studies. */

const SQRT3 = Math.sqrt(3);
export type Phases = 1 | 3;
export type PowerUnit = 'kW' | 'kVA' | 'HP' | 'W';
export const HP_KW = 0.7457;

/** Line current. 3-phase: V is line-to-line; 1-phase: V is phase-to-neutral.
 * kW and HP are output (shaft) power when an efficiency below 1 is given. */
export function currentFromPower(value: number, unit: PowerUnit, phases: Phases, voltageV: number, pf = 1, efficiency = 1): number {
  if (!(voltageV > 0) || !(value >= 0)) return NaN;
  const kva = unit === 'kVA' ? value : (unit === 'HP' ? value * HP_KW : unit === 'W' ? value / 1000 : value) / (Math.max(pf, 0.01) * Math.max(efficiency, 0.01));
  return (kva * 1000) / (phases === 3 ? SQRT3 * voltageV : voltageV);
}

/** Power drawn at a current: apparent, active and reactive. */
export function powerFromCurrent(currentA: number, phases: Phases, voltageV: number, pf = 1) {
  const kva = ((phases === 3 ? SQRT3 : 1) * voltageV * currentA) / 1000;
  if (kva === 0 && pf >= 0 && pf <= 1) return { kw: 0, kva: 0, kvar: 0, pf }; // no current: no power
  return triangle({ kva, pf });
}

/** Relative tolerance for round-off when a side equals the hypotenuse (P = S or Q = S). */
export const TRIANGLE_TOL = 1e-9;
export interface Triangle { kw: number; kva: number; kvar: number; pf: number; /** Why the inputs don't form a triangle (all values NaN). */ invalid?: string }
const bad = (invalid: string): Triangle => ({ kw: NaN, kva: NaN, kvar: NaN, pf: NaN, invalid });

/** Power triangle from two of kW, kVA, kVAr, power factor (magnitudes,
 * lagging or leading alike). Inputs that can't form a triangle — kW or kVAr
 * above kVA, PF outside 0–1, too little information — are rejected with the
 * reason, never clamped into a result. */
export function triangle(k: { kw?: number; kva?: number; kvar?: number; pf?: number }): Triangle {
  const given = Object.entries(k).filter(([, v]) => v !== undefined) as [string, number][];
  if (given.length !== 2) return bad('Enter exactly two values');
  if (given.some(([, v]) => !Number.isFinite(v))) return bad('Enter numbers');
  if (given.some(([, v]) => v < 0)) return bad('Enter magnitudes (0 or more); leading or lagging is not set here');
  const { kw, kva, kvar, pf } = k;
  if (pf !== undefined && pf > 1) return bad('Power factor cannot be above 1');
  const over = (side: number, s: number) => side > s * (1 + TRIANGLE_TOL) + 1e-12;
  const leg = (s: number, side: number) => Math.sqrt(Math.max(0, s * s - side * side)); // ≥ 0 only after the over() check
  const done = (P: number, S: number, Q: number): Triangle => ({ kw: P, kva: S, kvar: Q, pf: S > 0 ? Math.min(1, P / S) : NaN });
  if (kva !== undefined) {
    if (kva === 0) return bad('kVA is 0 — no power factor');
    if (pf !== undefined) return done(kva * pf, kva, kva * Math.sqrt(1 - pf * pf));
    if (kw !== undefined) return over(kw, kva) ? bad('kW cannot be more than kVA (|P| ≤ S)') : done(kw, kva, leg(kva, kw));
    return over(kvar!, kva) ? bad('kVAr cannot be more than kVA (|Q| ≤ S)') : done(leg(kva, kvar!), kva, kvar!);
  }
  if (kw !== undefined && kvar !== undefined) return kw === 0 && kvar === 0 ? bad('kW and kVAr are both 0') : done(kw, Math.hypot(kw, kvar), kvar);
  if (kw !== undefined && pf !== undefined) {
    if (pf === 0) return bad(kw === 0 ? 'kW 0 at PF 0 — the kVA is not defined; enter kVA or kVAr' : 'kW above 0 at PF 0 is contradictory');
    return kw === 0 ? bad('kW is 0 — enter kVA or kVAr') : done(kw, kw / pf, (kw / pf) * Math.sqrt(1 - pf * pf));
  }
  if (kvar !== undefined && pf !== undefined) {
    if (pf === 1) return bad(kvar === 0 ? 'kVAr 0 at PF 1 — the kVA is not defined; enter kW or kVA' : 'kVAr above 0 at PF 1 is contradictory');
    if (kvar === 0) return bad('kVAr is 0 — enter kW or kVA');
    const S = kvar / Math.sqrt(1 - pf * pf);
    return done(S * pf, S, kvar);
  }
  return bad('Enter two values');
}

/** Voltage drop of a cable run (same formula as the network studies):
 * 3-phase √3·I·L·(R cosφ + X sinφ); 1-phase 2·I·L·(…). */
export function voltageDrop(currentA: number, lengthM: number, csaMm2: number, phases: Phases, voltageV: number, pf = 0.85, runs = 1) {
  const r = rOperatingOhmPerKm(csaMm2) / runs;
  const x = getCable(csaMm2).xOhmPerKm / runs;
  const sin = Math.sqrt(Math.max(0, 1 - pf * pf));
  const volts = ((phases === 3 ? SQRT3 : 2) * currentA * lengthM * (r * pf + x * sin)) / 1000;
  const base = voltageV;
  return { volts, pct: (volts / base) * 100, mvPerAm: ((phases === 3 ? SQRT3 : 2) * (r * pf + x * sin)) };
}

/** Next standard breaker at or above the current. */
export const nextBreaker = (currentA: number) => breakerRatings().find((b) => b >= currentA - 1e-9);

/** Smallest cable for a current (Iz ≥ max(Ib, In)) and voltage drop limit,
 * after ambient and grouping derating; parallel runs when one isn't enough. */
export function cableFor(currentA: number, opts: { lengthM: number; phases: Phases; voltageV: number; pf: number; ambientC: number; groupFactor: number; vdLimitPct: number; breakerA?: number }) {
  const cores = opts.phases === 3 ? 4 : 2;
  const threePhaseV = opts.phases === 3 ? opts.voltageV : opts.voltageV * SQRT3; // selectCableRuns takes line-to-line V
  const breakerA = opts.breakerA ?? nextBreaker(currentA) ?? 0;
  const sel = selectCableRuns(currentA, opts.lengthM, threePhaseV, cores, opts.pf, opts.ambientC, opts.vdLimitPct, breakerA, 8, opts.groupFactor);
  if (!sel) return { breakerA, sel: null as null, iz: 0, vd: null as null | ReturnType<typeof voltageDrop> };
  const iz = getCable(sel.csaMm2).ampacityA * ambientCorrectionFactor(opts.ambientC) * sel.runs * opts.groupFactor;
  return { breakerA, sel, iz, vd: voltageDrop(currentA, opts.lengthM, sel.csaMm2, opts.phases, opts.voltageV, opts.pf, sel.runs) };
}

/** Transformer full-load current and the fault at its LV terminals
 * (infinite MV source, c = 1). */
export function transformer(kva: number, voltageV: number, impedancePct: number) {
  const flc = (kva * 1000) / (SQRT3 * voltageV);
  const faultKA = impedancePct > 0 ? flc / (impedancePct / 100) / 1000 : Infinity;
  return { flc, faultKA };
}

/** Motor full-load and starting current. */
export function motor(outputKw: number, voltageV: number, phases: Phases, pf: number, efficiency: number, starter: StarterType) {
  const flc = currentFromPower(outputKw, 'kW', phases, voltageV, pf, efficiency);
  const inputKw = outputKw / Math.max(efficiency, 0.01);
  const mult = STARTERS.find((s) => s.value === starter)?.multiple ?? 6;
  return { flc, inputKw, inputKva: inputKw / Math.max(pf, 0.01), startA: flc * mult, multiple: mult, hp: outputKw / HP_KW };
}

export interface PfCorrection { kvar: number; kvaBefore: number; kvaAfter: number; reductionPct: number; pfAchieved: number; needed: boolean; invalid?: string }

/** Capacitor kvar to raise a lagging power factor: P · (tan φ1 − tan φ2),
 * ideal continuous kvar. Already at or above the target: no capacitor and
 * nothing changes (the target is a request, not the result). */
export function pfCorrection(kw: number, pfNow: number, pfTarget: number): PfCorrection {
  const bad = (invalid: string): PfCorrection => ({ kvar: NaN, kvaBefore: NaN, kvaAfter: NaN, reductionPct: NaN, pfAchieved: NaN, needed: false, invalid });
  if (![kw, pfNow, pfTarget].every(Number.isFinite)) return bad('Enter numbers');
  if (!(kw > 0)) return bad('Active power must be above 0');
  if (!(pfNow > 0 && pfNow <= 1) || !(pfTarget > 0 && pfTarget <= 1)) return bad('Power factors must be above 0 and at most 1');
  const kvaBefore = kw / pfNow;
  if (pfNow >= pfTarget) return { kvar: 0, kvaBefore, kvaAfter: kvaBefore, reductionPct: 0, pfAchieved: pfNow, needed: false };
  const tan = (pf: number) => Math.sqrt(1 - pf * pf) / pf;
  return { kvar: kw * (tan(pfNow) - tan(pfTarget)), kvaBefore, kvaAfter: kw / pfTarget, reductionPct: (1 - pfNow / pfTarget) * 100, pfAchieved: pfTarget, needed: true };
}

/** Fault level at the end of a cable, from the fault at its start. */
export function faultAtCableEnd(startKA: number, voltageV: number, csaMm2: number, lengthM: number, runs = 1, sourceXr = 5) {
  // Source impedance from the fault at the start, split with X/R.
  const zs = voltageV / (SQRT3 * startKA * 1000);
  const rs = zs / Math.sqrt(1 + sourceXr * sourceXr);
  const zc = cableImpedance(csaMm2, lengthM, runs);
  const z = { r: rs + zc.r, x: rs * sourceXr + zc.x };
  return { endKA: faultCurrentKA(z, voltageV), cableOhm: zMagnitude(zc) };
}

/** Fault at the end of a cable fed straight from a transformer. */
export function faultFromTransformer(kva: number, impedancePct: number, voltageV: number, csaMm2: number, lengthM: number, runs = 1) {
  const zt = transformerImpedance(kva, impedancePct, voltageV);
  const zc = cableImpedance(csaMm2, lengthM, runs);
  return { startKA: faultCurrentKA(zt, voltageV), endKA: faultCurrentKA({ r: zt.r + zc.r, x: zt.x + zc.x }, voltageV) };
}

/** Ohm's law and power, from any two of V, I, R, P. */
export function ohm(k: { v?: number; i?: number; r?: number; p?: number }): { v: number; i: number; r: number; p: number } {
  let { v, i, r, p } = k;
  if (v !== undefined && i !== undefined) { r = i ? v / i : NaN; p = v * i; }
  else if (v !== undefined && r !== undefined) { i = r ? v / r : NaN; p = (v * v) / r; }
  else if (v !== undefined && p !== undefined) { i = v ? p / v : NaN; r = p ? (v * v) / p : NaN; }
  else if (i !== undefined && r !== undefined) { v = i * r; p = i * i * r; }
  else if (i !== undefined && p !== undefined) { v = i ? p / i : NaN; r = i ? p / (i * i) : NaN; }
  else if (r !== undefined && p !== undefined) { v = Math.sqrt(p * r); i = r ? Math.sqrt(p / r) : NaN; }
  return { v: v ?? NaN, i: i ?? NaN, r: r ?? NaN, p: p ?? NaN };
}

/** Energy and cost. */
export function energy(kw: number, hoursPerDay: number, days: number, rate: number) {
  const kwh = kw * hoursPerDay * days;
  return { kwh, cost: kwh * rate };
}

/** AWG → mm² (ASTM B258). */
export const awgToMm2 = (awg: number) => (Math.PI / 4) * (0.127 * 92 ** ((36 - awg) / 39)) ** 2;
/** mm² → nearest AWG; 0 = 1/0, −1 = 2/0, −2 = 3/0, −3 = 4/0. */
export const mm2ToAwg = (mm2: number) => Math.round(36 - 39 * Math.log(Math.sqrt((4 * mm2) / Math.PI) / 0.127) / Math.log(92)) || 0;
export const awgLabel = (awg: number) => (awg > 0 ? `${awg} AWG` : `${1 - awg}/0 AWG`);
export const kcmilToMm2 = (kcmil: number) => kcmil * 0.506707;

export const cableSizes = () => cables().map((c) => c.csaMm2);
