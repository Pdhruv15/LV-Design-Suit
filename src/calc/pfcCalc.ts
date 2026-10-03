import { capVoltage } from './pfc';
import { rule } from '../database/catalog';
import { breakerRatings } from './sizing';

/** Standalone power factor correction (an existing installation, no design
 * needed): from measured values, a utility bill or a list of loads to the
 * capacitor bank, its steps, detuning, breaker, and the before / after. */

export type PfcInputMode = 'kw-pf' | 'kva-pf' | 'vi-pf' | 'bill' | 'loads';
export interface PfcLoadRow { name: string; kw: number; pf: number; qty: number }
export interface PfcCalcInput {
  mode: PfcInputMode;
  kw?: number;
  kva?: number;
  currentA?: number;
  pf?: number;
  kwh?: number; // bill: active energy
  kvarh?: number; // bill: reactive energy
  hours?: number; // bill: operating hours in the period (for the average kW)
  loads?: PfcLoadRow[];
  voltageV: number;
  targetPf: number;
  stepKvar: number;
  harmonics: 'none' | 'some' | 'high'; // VFDs / UPS / LED share: none, up to 25 %, above
  thdIPct?: number; // measured current THD, if known
  transformerKva?: number;
  lossesKw?: number; // present cable / transformer copper losses, if known
  title?: string; // e.g. "MDB-1, Al Barsha villa"
}

export const PFC_CALC_DEFAULT: PfcCalcInput = {
  mode: 'kw-pf', kw: 400, pf: 0.8, voltageV: 400, targetPf: 0.95, stepKvar: 25, harmonics: 'some',
  loads: [{ name: 'Chillers', kw: 250, pf: 0.82, qty: 1 }, { name: 'Pumps', kw: 15, pf: 0.8, qty: 4 }, { name: 'Lighting', kw: 40, pf: 0.92, qty: 1 }], hours: 720
};

const SQRT3 = Math.sqrt(3);
const tan = (pf: number) => Math.tan(Math.acos(Math.min(Math.max(pf, 0.05), 1)));
const STANDARD_BANKS = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200];

/** The switching state at this load: k whole steps (0…steps). The fewest steps that reach the target with
 * Q ≥ 0 (no leading); if none does, the most steps that keep Q ≥ 0 (the best non-leading PF). */
export function operatingState(p: number, q1: number, steps: number, step: number, target: number): { k: number; reached: boolean } {
  const pfAt = (k: number) => { const q = q1 - k * step; const s = Math.hypot(p, q); return { q, pf: s > 0 ? p / s : 1 }; };
  for (let k = 0; k <= steps; k++) { const x = pfAt(k); if (x.q >= -1e-9 && x.pf >= target - 1e-9) return { k, reached: true }; }
  let best = 0;
  for (let k = 0; k <= steps; k++) if (pfAt(k).q >= -1e-9) best = k;
  return { k: best, reached: false };
}

/** A smaller standard step that has a whole number of steps between the need and Q1 (reaches the target, not leading). */
function suggestStep(q1: number, need: number, step: number): number | undefined {
  return [50, 40, 30, 25, 20, 15, 12.5, 10, 7.5, 5, 2.5].filter((s) => s < step).find((s) => Math.ceil(need / s - 1e-9) * s <= q1 + 1e-9);
}

/** A power factor with its direction, e.g. "0.800 lagging" / "0.800 leading" / "1.000". */
export const pfText = (pf: number, leading: boolean, d = 3) => (pf >= 1 - 1e-9 ? (1).toFixed(d) : `${pf.toFixed(d)} ${leading ? 'leading' : 'lagging'}`);
/** Signed phase angle from P and Q: atan2(Q, P) — negative when leading. */
const angleDeg = (p: number, q: number) => (Math.atan2(q, p) * 180) / Math.PI;

export interface PfcCalcResult {
  p: number; q1: number; s1: number; pf1: number; phi1Deg: number; i1: number;
  targetPf: number; q2Target: number; requiredKvar: number;
  bankKvar: number; steps: number; stepKvar: number;
  /** The operating state the after-values come from: whole steps switched in (no leading at this load). */
  activeSteps: number; activeKvar: number;
  /** That state reaches the target PF; else the best non-leading state is shown and the target is not reached. */
  targetReached: boolean;
  /** A smaller step that would reach the target without going leading (a suggestion only). */
  suggestedStepKvar?: number;
  q2: number; s2: number; pf2: number; phi2Deg: number; i2: number;
  /** PF direction from the sign of Q (pf1 / pf2 are magnitudes): Q < 0 = leading (capacitive). */
  leading1: boolean; leading2: boolean;
  releasedKva: number; currentReductionPct: number; lossReductionPct: number; lossSavedKw?: number;
  detunedPct: 0 | 7 | 14; detuneReason: string; capVoltageV: number; bankCurrentA: number; breakerA?: number;
  stepTable: { steps: number; kvar: number; pf: number; kva: number; a: number }[];
  transformer?: { kva: number; before: number; after: number };
  compare: { pf: number; kvar: number; bank: number; activeKvar: number; achievedPf: number; reached: boolean }[];
  derivation: string[]; // how P and Q were found, for the report
  warnings: string[];
}

/** P (kW) and Q (kvar) from what was entered. */
export function loadOf(i: PfcCalcInput): { p: number; q: number; how: string[] } {
  const pf = Math.min(Math.max(i.pf ?? 0.8, 0.05), 1);
  switch (i.mode) {
    case 'kva-pf': { const s = i.kva ?? 0; return { p: s * pf, q: s * Math.sin(Math.acos(pf)), how: [`P = S × PF = ${s} × ${pf} = ${(s * pf).toFixed(1)} kW`] }; }
    case 'vi-pf': { const s = (SQRT3 * i.voltageV * (i.currentA ?? 0)) / 1000; return { p: s * pf, q: s * Math.sin(Math.acos(pf)), how: [`S = √3 × U × I = √3 × ${i.voltageV} × ${i.currentA ?? 0} = ${s.toFixed(1)} kVA`, `P = S × PF = ${(s * pf).toFixed(1)} kW`] }; }
    case 'bill': {
      const h = Math.max(1, i.hours ?? 720);
      const kwh = i.kwh ?? 0, kvarh = i.kvarh ?? 0;
      const pfAvg = kwh > 0 ? kwh / Math.hypot(kwh, kvarh) : 1;
      return { p: kwh / h, q: kvarh / h, how: [`Average PF = kWh ÷ √(kWh² + kvarh²) = ${kwh} ÷ √(${kwh}² + ${kvarh}²) = ${pfAvg.toFixed(3)}`, `Average P = ${kwh} kWh ÷ ${h} h = ${(kwh / h).toFixed(1)} kW (Q = ${(kvarh / h).toFixed(1)} kvar)`] };
    }
    case 'loads': {
      let p = 0, q = 0;
      for (const r of i.loads ?? []) { const kw = r.kw * Math.max(0, r.qty); p += kw; q += kw * tan(r.pf); }
      return { p, q, how: [`P = Σ kW = ${p.toFixed(1)} kW; Q = Σ kW × tan φ = ${q.toFixed(1)} kvar (${(i.loads ?? []).length} loads)`] };
    }
    default: { const p = i.kw ?? 0; return { p, q: p * tan(pf), how: [`Q = P × tan φ1 = ${p} × tan(acos ${pf}) = ${(p * tan(pf)).toFixed(1)} kvar`] }; }
  }
}

export function calcPfc(i: PfcCalcInput): PfcCalcResult {
  const { p, q: q1, how } = loadOf(i);
  const warnings: string[] = [];
  const s1 = Math.hypot(p, q1);
  const pf1 = s1 > 0 ? p / s1 : 1;
  const I = (kva: number) => (kva * 1000) / (SQRT3 * i.voltageV);
  const target = Math.min(Math.max(i.targetPf, 0.8), 1);
  const q2Target = p * tan(target);
  const requiredKvar = Math.max(0, q1 - q2Target);
  const step = Math.max(1, i.stepKvar);
  // Next standard bank at or above the need, in whole steps.
  const std = STANDARD_BANKS.find((b) => b >= requiredKvar - 1e-6 && b % step === 0) ?? Math.ceil(requiredKvar / step) * step;
  const bankKvar = requiredKvar > 0 ? std : 0;
  const steps = bankKvar ? Math.round(bankKvar / step) : 0;
  // The bank switches whole steps. Operating policy (automatic PF relay, no leading): the fewest steps
  // that reach the target with Q ≥ 0; if none does, the most steps that stay non-leading.
  const op = operatingState(p, q1, steps, step, target);
  const activeSteps = op.k, activeKvar = activeSteps * step, targetReached = op.reached;
  const q2 = q1 - activeKvar;
  const suggestedStepKvar = !targetReached && requiredKvar > 0 ? suggestStep(q1, requiredKvar, step) : undefined;
  if (!targetReached && requiredKvar > 0) {
    warnings.push(`Target ${target} not achievable with ${step} kvar steps without going leading: ${activeSteps ? `${activeSteps} of ${steps} step${steps > 1 ? 's' : ''} (${activeKvar} kvar) switched in gives PF ${(p / Math.hypot(p, q2)).toFixed(3)}` : `the ${step} kvar step stays off (switching it in would give ${(q1 - step).toFixed(1)} kvar, leading), so nothing changes`}.${suggestedStepKvar ? ` A ${suggestedStepKvar} kvar step would reach it.` : ''}`);
  }
  if (bankKvar > activeKvar && targetReached) warnings.push(`At this load ${activeSteps} of ${steps} steps (${activeKvar} of ${bankKvar} kvar) are switched in; the rest is spare for higher load`);
  const s2 = Math.hypot(p, q2);
  const pf2 = s2 > 0 ? p / s2 : 1;
  const i1 = I(s1), i2 = I(s2);
  const lossReductionPct = i1 > 0 ? (1 - (i2 / i1) ** 2) * 100 : 0;

  const thd = i.thdIPct;
  const detunedPct: 0 | 7 | 14 = (thd !== undefined ? thd > 40 : i.harmonics === 'high') ? 14 : (thd !== undefined ? thd > 10 : i.harmonics !== 'none') ? 7 : 0;
  const detuneReason = thd !== undefined
    ? `Measured current THD ${thd} %: ${detunedPct ? `${detunedPct} % detuned reactors (tuned to ${detunedPct === 7 ? 189 : 134} Hz)` : 'plain capacitors'}`
    : i.harmonics === 'none' ? 'No significant non-linear load: plain capacitors'
      : i.harmonics === 'some' ? 'Some non-linear load (VFDs, UPS, LED): 7 % detuned reactors (189 Hz) to avoid resonance'
        : 'High non-linear load: 14 % detuned reactors (134 Hz) — confirm with a harmonic survey';
  const capV = capVoltage(i.voltageV, detunedPct);
  const bankCurrentA = (bankKvar * 1000) / (SQRT3 * i.voltageV);
  const breakerA = bankKvar ? breakerRatings().find((r) => r >= bankCurrentA * 1.43) : undefined;
  const stepTable = Array.from({ length: steps + 1 }, (_, k) => {
    const kvar = k * step;
    const q = q1 - kvar;
    const s = Math.hypot(p, q);
    return { steps: k, kvar, pf: s > 0 ? (q < 0 ? -p / s : p / s) : 1, kva: s, a: I(s) };
  });
  if (q1 < -1e-9) warnings.push(`The load is net leading (capacitive): Q = ${q1.toFixed(1)} kvar, PF ${pf1.toFixed(3)} leading. Capacitors add leading kvar, so none is selected and nothing changes. A leading PF needs a different remedy (e.g. switching existing capacitors off, a shunt reactor) — not designed here.`);
  else if (pf1 >= target) warnings.push(`The power factor is already ${pf1.toFixed(3)} — at or above the target ${target}`);
  if (i.mode === 'bill') warnings.push('From a bill, P and Q are averages over the period (net kvarh): they can hide times of leading and lagging operation. Check a switched bank against measured load conditions before relying on it.');
  if (pf1 < rule('pfMinimum')) warnings.push(`PF ${pf1.toFixed(2)} is below the authority's ${rule('pfMinimum').toFixed(2)} minimum (Rules.xlsx)`);
  const t = i.transformerKva;
  return {
    p, q1, s1, pf1, phi1Deg: angleDeg(p, q1), i1, leading1: q1 < -1e-9, leading2: q2 < -1e-9,
    targetPf: target, q2Target, requiredKvar, bankKvar, steps, stepKvar: step,
    q2, s2, pf2, phi2Deg: angleDeg(p, q2), i2,
    releasedKva: s1 - s2, currentReductionPct: i1 > 0 ? (1 - i2 / i1) * 100 : 0, lossReductionPct,
    lossSavedKw: i.lossesKw !== undefined ? (i.lossesKw * lossReductionPct) / 100 : undefined,
    detunedPct, detuneReason, capVoltageV: capV, bankCurrentA, breakerA, stepTable,
    transformer: t ? { kva: t, before: (s1 / t) * 100, after: (s2 / t) * 100 } : undefined,
    compare: [0.9, 0.95, 0.98, 1].map((pf) => {
      const k = Math.max(0, q1 - p * tan(pf));
      const bank = k > 0 ? STANDARD_BANKS.find((b) => b >= k - 1e-6 && b % step === 0) ?? Math.ceil(k / step) * step : 0;
      const o = operatingState(p, q1, Math.round(bank / step), step, pf);
      const qa = q1 - o.k * step;
      return { pf, kvar: k, bank, activeKvar: o.k * step, achievedPf: Math.hypot(p, qa) > 0 ? p / Math.hypot(p, qa) : 1, reached: k <= 0 || o.reached };
    }),
    activeSteps, activeKvar, targetReached, suggestedStepKvar,
    derivation: [...how, `Qc = P × (tan φ1 − tan φ2) = ${p.toFixed(1)} × (${(p > 0 ? q1 / p : 0).toFixed(3)} − ${tan(target).toFixed(3)}) = ${(p * ((p > 0 ? q1 / p : 0) - tan(target))).toFixed(1)} kvar${requiredKvar > 0 ? '' : ' → none needed (≤ 0)'}`,
      `Installed ${bankKvar} kvar = ${steps} × ${step} kvar; switched in at this load: ${activeSteps} step${activeSteps === 1 ? '' : 's'} = ${activeKvar} kvar (fewest steps reaching the target without going leading${targetReached ? '' : ' — target not reached'})`,
      `Q2 = Q1 − switched kvar = ${q1.toFixed(1)} − ${activeKvar} = ${q2.toFixed(1)} kvar → PF2 = P ÷ √(P² + Q2²)`],
    warnings
  };
}

// ---- Diagrams (SVG markup: the same picture on screen and in the report) ----

const BEFORE = '#d6453d', AFTER = '#1f9d55', CAP = '#2a78d6';
const n0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const arrowDefs = `<defs>${[['b', BEFORE], ['a', AFTER], ['c', CAP], ['k', 'currentColor']].map(([id, c]) => `<marker id="ar-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>`).join('')}</defs>`;

/** Power triangle, before and after on the same axes, to scale: P along the
 * bottom, Q up, S the hypotenuse; the bank's kvar takes Q1 down to Q2. */
export function powerTriangleSvg(r: PfcCalcResult): string {
  const W = 560, H = 366, ox = 70;
  // Q up for lagging (positive), down for leading (negative): the origin sits so both fit.
  const qHi = Math.max(r.q1, r.q2, 0), qLo = Math.min(r.q1, r.q2, 0);
  const sx = (W - ox - 150) / Math.max(r.p, 1);
  const sy = (H - 76 - 30) / Math.max(qHi - qLo, r.p * 0.2, 1);
  const k = Math.min(sx, sy); // same scale both ways: angles are true
  const oy = 30 + qHi * k + (qHi - qLo < r.p * 0.2 ? 0 : 0);
  const X = (v: number) => ox + v * k, Y = (v: number) => oy - v * k;
  const arc = (deg: number, rad: number, color: string) => {
    const a = (deg * Math.PI) / 180;
    return `<path d="M${ox + rad} ${oy} A${rad} ${rad} 0 0 ${deg < 0 ? 1 : 0} ${ox + rad * Math.cos(a)} ${oy - rad * Math.sin(a)}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
  };
  const px = X(r.p);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif" font-size="12" style="color:inherit">${arrowDefs}
  <line x1="${ox - 10}" y1="${oy}" x2="${W - 20}" y2="${oy}" stroke="currentColor" stroke-opacity=".35"/>
  <line x1="${ox}" y1="${oy + 10}" x2="${ox}" y2="16" stroke="currentColor" stroke-opacity=".35"/>
  <text x="${W - 22}" y="${oy + 16}" text-anchor="end" fill="currentColor" opacity=".7">P (kW)</text>
  <text x="${ox - 6}" y="14" text-anchor="end" fill="currentColor" opacity=".7">Q (kvar)</text>
  ${qLo < 0 ? `<text x="${ox + 6}" y="${H - 22}" fill="currentColor" opacity=".7">Q below the axis: leading (capacitive)</text>` : ''}
  <line x1="${ox}" y1="${oy}" x2="${px}" y2="${oy}" stroke="currentColor" stroke-width="3" marker-end="url(#ar-k)"/>
  <text x="${(ox + px) / 2}" y="${oy + 18}" text-anchor="middle" fill="currentColor" font-weight="700">P = ${n0(r.p)} kW</text>
  <line x1="${ox}" y1="${oy}" x2="${px}" y2="${Y(r.q1)}" stroke="${BEFORE}" stroke-width="2.5" marker-end="url(#ar-b)"/>
  <line x1="${px}" y1="${oy}" x2="${px}" y2="${Y(r.q1)}" stroke="${BEFORE}" stroke-width="2" stroke-dasharray="5 3"/>
  <text x="${(ox + px) / 2 - 8}" y="${(oy + Y(r.q1)) / 2 - 8}" text-anchor="end" fill="${BEFORE}" font-weight="700">S1 = ${n0(r.s1)} kVA</text>
  <text x="${px - 6}" y="${Y(r.q1) - 6}" text-anchor="end" fill="${BEFORE}">Q1 = ${n0(r.q1)} kvar</text>
  ${r.activeKvar > 0 ? `
  <line x1="${ox}" y1="${oy}" x2="${px}" y2="${Y(r.q2)}" stroke="${AFTER}" stroke-width="2.5" marker-end="url(#ar-a)"/>
  <text x="${(ox + px) / 2 + 10}" y="${(oy + Y(r.q2)) / 2 + 18}" fill="${AFTER}" font-weight="700">S2 = ${n0(r.s2)} kVA</text>
  <line x1="${px + 26}" y1="${Y(r.q1)}" x2="${px + 26}" y2="${Y(r.q2)}" stroke="${CAP}" stroke-width="3" marker-end="url(#ar-c)"/>
  <text x="${px + 34}" y="${(Y(r.q1) + Y(r.q2)) / 2 + 4}" fill="${CAP}" font-weight="700">Qc = ${n0(r.activeKvar)} kvar (${r.activeSteps} × ${n0(r.stepKvar)})</text>
  <text x="${px - 6}" y="${Y(r.q2) - 6}" text-anchor="end" fill="${AFTER}">Q2 = ${n0(r.q2)} kvar</text>
  ${arc(r.phi2Deg, 46, AFTER)}` : ''}
  ${arc(r.phi1Deg, 34, BEFORE)}
  ${angleLabels(r, ox, oy, px - ox)}
  <text x="${ox}" y="${H - 6}" font-size="12"><tspan fill="${BEFORE}" font-weight="700">φ1 = ${r.phi1Deg.toFixed(1)}°</tspan><tspan fill="currentColor"> · PF ${pfText(r.pf1, r.leading1)} (before)</tspan>${r.activeKvar > 0 ? `<tspan fill="currentColor">   </tspan><tspan fill="${AFTER}" font-weight="700">φ2 = ${r.phi2Deg.toFixed(1)}°</tspan><tspan fill="currentColor"> · PF ${pfText(r.pf2, r.leading2)} (after)</tspan>` : ''}</text>
  </svg>`;
}

/** "φ1" and "φ2" placed where there is room: φ1 halfway between the green
 * and red lines, φ2 halfway between the P axis and the green line — moved out
 * until the gap between the lines is at least one text line high. */
function angleLabels(r: PfcCalcResult, ox: number, oy: number, pLen: number): string {
  const at = (fromDeg: number, toDeg: number, minR: number, text: string, color: string) => {
    const span = Math.max(0.5, toDeg - fromDeg);
    const mid = ((fromDeg + toDeg) / 2) * (Math.PI / 180);
    // Distance at which the wedge is ~16 px wide, kept inside the triangle.
    const need = 16 / (2 * Math.sin(((span / 2) * Math.PI) / 180));
    const rad = Math.min(Math.max(minR, need), pLen * 0.85);
    const x = ox + rad * Math.cos(mid), y = oy - rad * Math.sin(mid);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="${color}" font-weight="700" font-size="12">${text}</text>`;
  };
  const after = r.activeKvar > 0;
  return (after ? at(0, r.phi2Deg, 62, 'φ2', AFTER) : '') + at(after ? r.phi2Deg : 0, r.phi1Deg, 50, 'φ1', BEFORE);
}

/** Current phasors: V as the reference, I lagging by φ — before and after. */
export function phasorSvg(r: PfcCalcResult, voltageV: number): string {
  const W = 320, H = 290, cx = 40, L = 220;
  const k = L / Math.max(r.i1, 1);
  // Lagging current is drawn below V, leading above it (signed angle): leave room above for a leading one.
  const above = Math.max(0, ...[[r.i1, r.phi1Deg], [r.i2, r.phi2Deg]].map(([i, d]) => -i * k * Math.sin((d * Math.PI) / 180)));
  const cy = Math.max(70, 30 + above);
  const tip = (i: number, deg: number) => [cx + i * k * Math.cos((deg * Math.PI) / 180), cy + i * k * Math.sin((deg * Math.PI) / 180)];
  const [b1x, b1y] = tip(r.i1, r.phi1Deg), [a1x, a1y] = tip(r.i2, r.phi2Deg);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif" font-size="12">${arrowDefs}
  <line x1="${cx}" y1="${cy}" x2="${cx + L + 20}" y2="${cy}" stroke="currentColor" stroke-width="2.5" marker-end="url(#ar-k)"/>
  <text x="${cx + L + 18}" y="${cy - 8}" text-anchor="end" fill="currentColor" font-weight="700">V ${voltageV} V</text>
  <line x1="${cx}" y1="${cy}" x2="${b1x}" y2="${b1y}" stroke="${BEFORE}" stroke-width="2.5" marker-end="url(#ar-b)"/>
  <text x="${Math.min(b1x + 6, W - 70)}" y="${b1y + 16}" fill="${BEFORE}" font-weight="700">I1 ${n0(r.i1)} A</text>
  ${r.activeKvar > 0 ? `<line x1="${cx}" y1="${cy}" x2="${a1x}" y2="${a1y}" stroke="${AFTER}" stroke-width="2.5" marker-end="url(#ar-a)"/>
  <text x="${a1x + 6}" y="${a1y - 4}" fill="${AFTER}" font-weight="700">I2 ${n0(r.i2)} A</text>` : ''}
  <text x="${cx}" y="${H - 8}" fill="currentColor" opacity=".7" font-size="11">${r.leading1 ? 'I leads V (drawn above V): the load is capacitive.' : 'I lags V by φ; the bank pulls it in and down.'}</text>
  </svg>`;
}

/** PF as each step switches in, against the target. */
export function stepsSvg(r: PfcCalcResult): string {
  const W = 560, H = 220, L = 50, R = 16, T = 16, B = 40;
  const pts = r.stepTable;
  if (pts.length < 2) return '';
  const lo = Math.min(0.7, ...pts.map((x) => x.pf)), hi = 1;
  const x = (i: number) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(Math.max(lo, p.pf))}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif" font-size="11">
  ${[lo, (lo + 1) / 2, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".15"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="currentColor" opacity=".7">${v.toFixed(2)}</text>`).join('')}
  <line x1="${L}" x2="${W - R}" y1="${y(r.targetPf)}" y2="${y(r.targetPf)}" stroke="${AFTER}" stroke-dasharray="6 4"/>
  <text x="${L + 6}" y="${y(r.targetPf) - 5}" fill="${AFTER}">target ${r.targetPf}</text>
  <path d="${path}" fill="none" stroke="${CAP}" stroke-width="2.5"/>
  ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(Math.max(lo, p.pf))}" r="3.5" fill="${p.pf >= r.targetPf ? AFTER : BEFORE}"/><text x="${x(i)}" y="${H - B + 16}" text-anchor="middle" fill="currentColor" opacity=".8">${p.kvar}</text>`).join('')}
  <text x="${(W + L) / 2}" y="${H - 6}" text-anchor="middle" fill="currentColor" opacity=".7">kvar switched in</text>
  </svg>`;
}

/** A design board's before / after as a triangle (for the diagram). */
export function triangleFrom(p: number, pf1: number, pf2: number, target: number): PfcCalcResult {
  const q1 = p * tan(pf1), q2 = p * tan(pf2);
  const r = calcPfc({ ...PFC_CALC_DEFAULT, mode: 'kw-pf', kw: p, pf: pf1, targetPf: target });
  return { ...r, q1, s1: Math.hypot(p, q1), pf1, phi1Deg: (Math.acos(pf1) * 180) / Math.PI, q2, s2: Math.hypot(p, q2), pf2, phi2Deg: (Math.acos(pf2) * 180) / Math.PI, bankKvar: Math.max(0, q1 - q2), activeKvar: Math.max(0, q1 - q2), activeSteps: 1, leading1: false, leading2: false };
}
