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
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const positive = (value: number) => Number.isFinite(value) && value > 0;
const phaseCount = (phases: Phases) => phases === 1 || phases === 3;
const powerFactor = (pf: number, allowZero = false) => Number.isFinite(pf) && (allowZero ? pf >= 0 : pf > 0) && pf <= 1;
const efficiencyFactor = (efficiency: number) => positive(efficiency) && efficiency <= 1;
const parallelRuns = (runs: number) => Number.isInteger(runs) && runs > 0;
/** Unknown cable sizes (including stale saved selections) must not throw in the UI. */
const cableData = (csaMm2: number) => {
  if (!positive(csaMm2)) return undefined;
  try {
    const cable = getCable(csaMm2);
    return positive(cable.rOhmPerKm20C) && nonnegative(cable.xOhmPerKm) ? cable : undefined;
  } catch { return undefined; }
};

/** Line current. 3-phase: V is line-to-line; 1-phase: V is phase-to-neutral.
 * kW and HP are output (shaft) power when an efficiency below 1 is given. */
export function currentFromPower(value: number, unit: PowerUnit, phases: Phases, voltageV: number, pf = 1, efficiency = 1): number {
  if (!positive(voltageV) || !nonnegative(value) || !phaseCount(phases) || !['kW', 'kVA', 'HP', 'W'].includes(unit)) return NaN;
  // Neither PF nor efficiency enters a calculation from apparent power.
  if (unit !== 'kVA' && (!powerFactor(pf) || !efficiencyFactor(efficiency))) return NaN;
  const kva = unit === 'kVA' ? value : (unit === 'HP' ? value * HP_KW : unit === 'W' ? value / 1000 : value) / (pf * efficiency);
  return (kva * 1000) / (phases === 3 ? SQRT3 * voltageV : voltageV);
}

/** Power drawn at a current: apparent, active and reactive. */
export function powerFromCurrent(currentA: number, phases: Phases, voltageV: number, pf = 1): Triangle {
  if (!nonnegative(currentA) || !positive(voltageV) || !phaseCount(phases)) return bad('Enter a current of 0 or more, a voltage above 0 and a supported phase count');
  if (!powerFactor(pf, true)) return bad(pf > 1 ? 'Power factor cannot be above 1' : 'Power factor must be from 0 to 1');
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
export interface VoltageDrop { volts: number; pct: number; mvPerAm: number; invalid?: string }
export function voltageDrop(currentA: number, lengthM: number, csaMm2: number, phases: Phases, voltageV: number, pf = 0.85, runs = 1): VoltageDrop {
  const invalid = (reason: string): VoltageDrop => ({ volts: NaN, pct: NaN, mvPerAm: NaN, invalid: reason });
  if (!nonnegative(currentA) || !nonnegative(lengthM) || !positive(voltageV) || !phaseCount(phases)) return invalid('Enter a current and length of 0 or more, a voltage above 0 and a supported phase count');
  if (!powerFactor(pf, true)) return invalid('Power factor must be from 0 to 1');
  if (!parallelRuns(runs)) return invalid('Parallel runs must be a whole number above 0');
  const cable = cableData(csaMm2);
  if (!cable) return invalid('Select a cable size with valid resistance and reactance data');
  const r = rOperatingOhmPerKm(csaMm2) / runs;
  const x = cable.xOhmPerKm / runs;
  const sin = Math.sqrt(Math.max(0, 1 - pf * pf));
  const volts = ((phases === 3 ? SQRT3 : 2) * currentA * lengthM * (r * pf + x * sin)) / 1000;
  const base = voltageV;
  const pct = (volts / base) * 100;
  const mvPerAm = (phases === 3 ? SQRT3 : 2) * (r * pf + x * sin);
  if (![volts, pct, mvPerAm].every(Number.isFinite)) return invalid('These values do not produce a finite voltage drop. Check the current, length, voltage and cable data');
  return { volts, pct, mvPerAm };
}

/** Next standard breaker at or above the current. */
export const nextBreaker = (currentA: number) => nonnegative(currentA) ? breakerRatings().find((b) => positive(b) && b >= currentA - 1e-9) : undefined;

export interface QuickCableSelection {
  status: 'ok' | 'invalid' | 'no-breaker' | 'no-cable';
  message?: string;
  breakerA: number | undefined;
  sel: { csaMm2: number; runs: number } | null;
  iz: number;
  vd: VoltageDrop | null;
}

/** Smallest cable for a current (Iz ≥ max(Ib, In)) and voltage drop limit,
 * after ambient and grouping derating; parallel runs when one isn't enough. */
export function cableFor(currentA: number, opts: { lengthM: number; phases: Phases; voltageV: number; pf: number; ambientC: number; groupFactor: number; vdLimitPct: number; breakerA?: number }): QuickCableSelection {
  const invalid = (message: string): QuickCableSelection => ({ status: 'invalid', message, breakerA: undefined, sel: null, iz: NaN, vd: null });
  if (!positive(currentA) || !nonnegative(opts.lengthM) || !positive(opts.voltageV) || !phaseCount(opts.phases)) return invalid('Enter a current and voltage above 0, a length of 0 or more and a supported phase count');
  if (!powerFactor(opts.pf, true)) return invalid('Power factor must be from 0 to 1');
  if (!Number.isFinite(opts.ambientC) || opts.ambientC < 25 || opts.ambientC > 70) return invalid('Ambient temperature must be within the supported correction range, 25–70 °C');
  if (!efficiencyFactor(opts.groupFactor)) return invalid('Grouping factor must be above 0 and at most 1');
  if (!positive(opts.vdLimitPct) || opts.vdLimitPct > 100) return invalid('Voltage drop limit must be above 0 and at most 100%');
  if (opts.breakerA !== undefined && (!positive(opts.breakerA) || opts.breakerA < currentA - 1e-9)) return invalid('Breaker rating must be above 0 and at least the design current');
  const cores = opts.phases === 3 ? 4 : 2;
  const threePhaseV = opts.phases === 3 ? opts.voltageV : opts.voltageV * SQRT3; // selectCableRuns takes line-to-line V
  const breakerA = opts.breakerA ?? nextBreaker(currentA);
  if (breakerA === undefined) return { status: 'no-breaker', message: 'No available breaker rating meets this current. Review the breaker catalogue or reduce the design current.', breakerA: undefined, sel: null, iz: 0, vd: null };
  const sel = selectCableRuns(currentA, opts.lengthM, threePhaseV, cores, opts.pf, opts.ambientC, opts.vdLimitPct, breakerA, 8, opts.groupFactor);
  if (!sel) return { status: 'no-cable', message: 'No cable arrangement meets both the current rating and voltage drop limit within 8 parallel runs.', breakerA, sel: null, iz: 0, vd: null };
  const iz = getCable(sel.csaMm2).ampacityA * ambientCorrectionFactor(opts.ambientC) * sel.runs * opts.groupFactor;
  return { status: 'ok', breakerA, sel, iz, vd: voltageDrop(currentA, opts.lengthM, sel.csaMm2, opts.phases, opts.voltageV, opts.pf, sel.runs) };
}

/** Transformer full-load current and the fault at its LV terminals
 * (infinite MV source, c = 1). */
export function transformer(kva: number, voltageV: number, impedancePct: number): { flc: number; faultKA: number; invalid?: string } {
  if (!positive(kva) || !positive(voltageV) || !positive(impedancePct)) return { flc: NaN, faultKA: NaN, invalid: 'Transformer rating, voltage and impedance must be finite and above 0' };
  const flc = (kva * 1000) / (SQRT3 * voltageV);
  const faultKA = flc / (impedancePct / 100) / 1000;
  return { flc, faultKA };
}

/** Motor full-load and starting current. */
export function motor(outputKw: number, voltageV: number, phases: Phases, pf: number, efficiency: number, starter: StarterType): { flc: number; inputKw: number; inputKva: number; startA: number; multiple: number; hp: number; invalid?: string } {
  const starterInfo = STARTERS.find((s) => s.value === starter);
  if (!nonnegative(outputKw) || !positive(voltageV) || !phaseCount(phases) || !powerFactor(pf) || !efficiencyFactor(efficiency) || !starterInfo) return { flc: NaN, inputKw: NaN, inputKva: NaN, startA: NaN, multiple: NaN, hp: NaN, invalid: 'Enter finite nonnegative output power, positive voltage, a supported phase count and starter, and PF/efficiency above 0 and at most 1' };
  const flc = currentFromPower(outputKw, 'kW', phases, voltageV, pf, efficiency);
  const inputKw = outputKw / efficiency;
  const mult = starterInfo.multiple;
  return { flc, inputKw, inputKva: inputKw / pf, startA: flc * mult, multiple: mult, hp: outputKw / HP_KW };
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
export function faultAtCableEnd(startKA: number, voltageV: number, csaMm2: number, lengthM: number, runs = 1, sourceXr = 5): { endKA: number; cableOhm: number; invalid?: string } {
  if (!positive(startKA) || !positive(voltageV) || !nonnegative(lengthM) || !parallelRuns(runs) || !nonnegative(sourceXr) || !cableData(csaMm2)) return { endKA: NaN, cableOhm: NaN, invalid: 'Enter positive source fault current and voltage, nonnegative length and X/R, whole positive runs and a supported cable size' };
  // Source impedance from the fault at the start, split with X/R.
  const zs = voltageV / (SQRT3 * startKA * 1000);
  const rs = zs / Math.sqrt(1 + sourceXr * sourceXr);
  const zc = cableImpedance(csaMm2, lengthM, runs);
  const z = { r: rs + zc.r, x: rs * sourceXr + zc.x };
  return { endKA: faultCurrentKA(z, voltageV), cableOhm: zMagnitude(zc) };
}

/** Fault at the end of a cable fed straight from a transformer. */
export function faultFromTransformer(kva: number, impedancePct: number, voltageV: number, csaMm2: number, lengthM: number, runs = 1): { startKA: number; endKA: number; invalid?: string } {
  if (!positive(kva) || !positive(impedancePct) || !positive(voltageV) || !nonnegative(lengthM) || !parallelRuns(runs) || !cableData(csaMm2)) return { startKA: NaN, endKA: NaN, invalid: 'Enter positive transformer rating, impedance and voltage, nonnegative length, whole positive runs and a supported cable size' };
  const zt = transformerImpedance(kva, impedancePct, voltageV);
  const zc = cableImpedance(csaMm2, lengthM, runs);
  return { startKA: faultCurrentKA(zt, voltageV), endKA: faultCurrentKA({ r: zt.r + zc.r, x: zt.x + zc.x }, voltageV) };
}

/** Ohm's law and power, from any two of V, I, R, P. */
export function ohm(k: { v?: number; i?: number; r?: number; p?: number }): { v: number; i: number; r: number; p: number; invalid?: string } {
  const given = Object.entries(k).filter(([, value]) => value !== undefined);
  const invalid = (reason: string) => ({ v: NaN, i: NaN, r: NaN, p: NaN, invalid: reason });
  if (given.length !== 2 || given.some(([, value]) => !nonnegative(value!))) return invalid('Enter exactly two finite values of 0 or more');
  if (k.r !== undefined && !positive(k.r)) return invalid('Resistance must be above 0');
  if ((k.v === 0 && (k.i !== undefined || k.p !== undefined)) || (k.i === 0 && (k.v !== undefined || k.p !== undefined)) || (k.p === 0 && (k.v !== undefined || k.i !== undefined))) return invalid('This zero-valued pair does not define a finite positive resistance; enter resistance with voltage, current or power');
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
export function energy(kw: number, hoursPerDay: number, days: number, rate: number): { kwh: number; cost: number; invalid?: string } {
  if (![kw, hoursPerDay, days, rate].every(nonnegative) || hoursPerDay > 24) return { kwh: NaN, cost: NaN, invalid: 'Power, days and tariff must be finite and 0 or more; daily hours must be from 0 to 24' };
  const kwh = kw * hoursPerDay * days;
  return { kwh, cost: kwh * rate };
}

/** AWG → mm² (ASTM B258). */
export const awgToMm2 = (awg: number) => Number.isInteger(awg) && awg >= -3 ? (Math.PI / 4) * (0.127 * 92 ** ((36 - awg) / 39)) ** 2 : NaN;
/** mm² → nearest AWG; 0 = 1/0, −1 = 2/0, −2 = 3/0, −3 = 4/0. */
export const mm2ToAwg = (mm2: number) => positive(mm2) ? Math.round(36 - 39 * Math.log(Math.sqrt((4 * mm2) / Math.PI) / 0.127) / Math.log(92)) + 0 : NaN;
export const awgLabel = (awg: number) => Number.isInteger(awg) ? (awg > 0 ? `${awg} AWG` : `${1 - awg}/0 AWG`) : '—';
export const kcmilToMm2 = (kcmil: number) => nonnegative(kcmil) ? kcmil * 0.506707 : NaN;

export const cableSizes = () => cables().map((c) => c.csaMm2);
