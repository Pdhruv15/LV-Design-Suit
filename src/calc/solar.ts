import { STANDARD_BREAKER_A } from './sizing';

/** Solar PV sizing: number of panels, inverters, string design and yield.
 *
 * Array: by target kWp, by roof area, or by daily energy. String length from
 * the panel voltages corrected for temperature (IEC 62548): the coldest Voc
 * must stay below the inverter's maximum DC voltage; the hottest Vmp above
 * its MPPT minimum (and the coldest Vmp below the MPPT maximum). String
 * current: 1.25 × Isc per string against the MPPT input limit.
 * Energy: kWp × peak sun hours × performance ratio, where the ratio
 * includes temperature, soiling, mismatch, DC / AC cable and inverter
 * losses. */

export interface PvPanel {
  name: string;
  pmaxW: number;
  vocV: number;
  vmpV: number;
  iscA: number;
  impA: number;
  betaVocPct: number; // Voc temperature coefficient, %/°C (negative)
  /** Vmp temperature coefficient, %/°C (negative), from the panel datasheet. Blank (older projects, the
   * generic panel): the MPPT checks use VMP_COEFF_ESTIMATE_PCT and are marked estimated, not verified. */
  betaVmpPct?: number;
  gammaPmaxPct: number; // Pmax temperature coefficient, %/°C (negative)
  noctC: number;
  lengthM: number;
  widthM: number;
}

export interface PvInverter {
  name: string;
  acKw: number;
  maxDcV: number;
  mpptMinV: number;
  mpptMaxV: number;
  mppts: number;
  maxInputA: number; // per MPPT (short-circuit current limit)
  efficiencyPct: number;
  phases: 1 | 3;
}

export type PvMode = 'kwp' | 'area' | 'energy';

export interface PvSystem {
  mode: PvMode;
  targetKwp?: number;
  roofAreaM2?: number;
  roofUsePct: number; // share of the roof usable for panels (access, setbacks, shading)
  dailyKwh?: number;
  panel: PvPanel;
  inverter: PvInverter;
  dcAcRatio: number; // target DC ÷ AC
  peakSunHours: number; // kWh/m²/day on the array plane
  tMinC: number;
  tMaxC: number; // design ambient maximum
  tAvgC: number; // average daytime ambient, for the yield
  soilingPct: number;
  mismatchPct: number;
  dcCablePct: number;
  acCablePct: number;
  tariff?: number; // per kWh, for savings
  gridKgPerKwh: number; // CO2 factor
  boardId?: string; // where the PV connects on the SLD
  /** One-phase inverters: the phase they connect to (R / Y / B). Blank = not set — the app then
   * spreads the generation evenly over R / Y / B in the board's phase totals (no phase is assumed). */
  acPhase?: 'R' | 'Y' | 'B';
}

/** The AC connection's voltage: phase-to-neutral for one-phase inverters, line-to-line for three-phase. */
export function acConnection(pv: Pick<PvSystem, 'inverter'>, systemV: number): { volts: number; text: string } {
  return pv.inverter.phases === 3
    ? { volts: systemV, text: `3-phase, ${systemV} V line-to-line` }
    : { volts: systemV / Math.sqrt(3), text: `1-phase, ${Math.round(systemV / Math.sqrt(3))} V phase-to-neutral` };
}

// Generic 550 W monocrystalline panel and a generic 3-phase string inverter —
// replace with the chosen products' datasheets.
export const DEFAULT_PANEL: PvPanel = {
  name: 'Mono PERC 550 W (generic)', pmaxW: 550, vocV: 49.6, vmpV: 41.7, iscA: 14.0, impA: 13.2,
  betaVocPct: -0.27, gammaPmaxPct: -0.35, noctC: 45, lengthM: 2.278, widthM: 1.134
};
export const DEFAULT_INVERTER: PvInverter = {
  name: 'String inverter (generic)', acKw: 50, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mppts: 4, maxInputA: 40, efficiencyPct: 98.2, phases: 3
};
/** Generic Vmp temperature coefficient used only when the datasheet value is missing: a typical value for
 * crystalline-silicon modules (an assumption, not a manufacturer figure). The Voc coefficient is not used for Vmp. */
export const VMP_COEFF_ESTIMATE_PCT = -0.4;

export const INVERTER_KW = [3, 5, 6, 8, 10, 12, 15, 17, 20, 25, 30, 36, 40, 50, 60, 75, 100, 110, 125, 150, 185, 215, 250, 330];

// Dubai defaults: ≈ 5.8 kWh/m²/day on a fixed south-facing tilt, 48 °C design maximum.
export const PV_DEFAULTS: PvSystem = {
  mode: 'kwp', targetKwp: 50, roofUsePct: 60, panel: DEFAULT_PANEL, inverter: DEFAULT_INVERTER,
  dcAcRatio: 1.2, peakSunHours: 5.8, tMinC: 10, tMaxC: 48, tAvgC: 35,
  soilingPct: 5, mismatchPct: 2, dcCablePct: 1.5, acCablePct: 1, tariff: 0.38, gridKgPerKwh: 0.4
};

export interface PvResult {
  panels: number;
  kwp: number;
  arrayAreaM2: number; // panel area
  roofNeededM2: number; // at the roof use %
  // Strings
  tCellMaxC: number;
  vocColdV: number;
  vmpHotV: number;
  vmpColdV: number;
  /** The Vmp coefficient used and where it came from: the datasheet, or the generic estimate. */
  vmpCoeffPct: number;
  vmpBasis: 'datasheet' | 'estimated';
  maxPerString: number;
  minPerString: number;
  perString: number;
  strings: number;
  inverters: number;
  inverterKw: number;
  stringsPerMppt: number;
  mpptCurrentA: number; // 1.25 × Isc × strings on the busiest MPPT
  dcAcRatio: number;
  // Energy
  tempLossPct: number;
  prPct: number;
  dailyKwh: number;
  annualKwh: number;
  specificYield: number; // kWh/kWp/year
  savings?: number;
  co2Tonnes: number;
  // AC connection
  acCurrentA: number; // all inverters
  /** The AC breaker: the smallest available rating ≥ 1.25 × the AC current. Undefined when the array
   * has no generation, or when no available rating is large enough (acBreakerNoFit). */
  acBreakerA?: number;
  /** Required rating (1.25 × AC current) and the largest available, for the no-fit message. */
  acBreakerRequiredA: number;
  acBreakerMaxA: number;
  acBreakerNoFit: boolean;
  status: 'ok' | 'warn' | 'bad';
  notes: string[];
}

/** Breakers the AC connection is chosen from: the app's shared list (the same as the general cable and
 * breaker sizing, from 16 A — up to 4000 A with the built-in list), so the Solar page can't refuse a
 * rating the SLD sizing would use. Never clamped to the largest: a load above it is reported as no fit. */
const breakers = () => STANDARD_BREAKER_A.filter((b) => b >= 16);

export function sizePv(s: PvSystem, voltageV = 400): PvResult {
  const p = s.panel;
  const inv = s.inverter;
  const notes: string[] = [];
  let status: PvResult['status'] = 'ok';
  const bad = (m: string) => { notes.push(m); status = 'bad'; };
  const warn = (m: string) => { notes.push(m); if (status === 'ok') status = 'warn'; };

  // Losses and performance ratio.
  const tCellAvg = s.tAvgC + ((p.noctC - 20) / 800) * 1000 * 0.8; // average daytime irradiance ≈ 800 W/m²
  const tempLoss = Math.max(0, -(p.gammaPmaxPct / 100) * (tCellAvg - 25));
  const pr = (1 - tempLoss) * (1 - s.soilingPct / 100) * (1 - s.mismatchPct / 100) * (1 - s.dcCablePct / 100) * (1 - s.acCablePct / 100) * (inv.efficiencyPct / 100);
  const perKwpDaily = s.peakSunHours * pr;

  // Number of panels.
  const panelArea = p.lengthM * p.widthM;
  let panels: number;
  if (s.mode === 'area') panels = Math.floor(((s.roofAreaM2 ?? 0) * (s.roofUsePct / 100)) / panelArea);
  else if (s.mode === 'energy') panels = Math.ceil(((s.dailyKwh ?? 0) / perKwpDaily) * 1000 / p.pmaxW);
  else panels = Math.ceil(((s.targetKwp ?? 0) * 1000) / p.pmaxW);
  panels = Math.max(0, panels);

  // String voltages at the temperature extremes.
  const tCellMax = s.tMaxC + ((p.noctC - 20) / 800) * 1000;
  // Linear temperature approximation, each voltage with its own coefficient: Voc with the Voc
  // coefficient (maximum DC voltage), Vmp with the Vmp coefficient (MPPT window).
  const beta = p.betaVocPct / 100;
  const vmpBasis: PvResult['vmpBasis'] = p.betaVmpPct !== undefined && Number.isFinite(p.betaVmpPct) ? 'datasheet' : 'estimated';
  const vmpCoeffPct = vmpBasis === 'datasheet' ? p.betaVmpPct! : VMP_COEFF_ESTIMATE_PCT;
  const betaVmp = vmpCoeffPct / 100;
  const vocCold = p.vocV * (1 + beta * (s.tMinC - 25));
  const vmpHot = p.vmpV * (1 + betaVmp * (tCellMax - 25));
  const vmpCold = p.vmpV * (1 + betaVmp * (s.tMinC - 25));
  if (vmpBasis === 'estimated') warn(`MPPT window not verified: no Vmp temperature coefficient for the panel — estimated at ${VMP_COEFF_ESTIMATE_PCT} %/°C (typical crystalline silicon). Enter the datasheet value.`);
  const maxPerString = Math.floor(Math.min(inv.maxDcV / vocCold, inv.mpptMaxV / vmpCold));
  const minPerString = Math.ceil(inv.mpptMinV / vmpHot);
  if (minPerString > maxPerString) bad('No string length fits this inverter — check the panel and inverter voltages');

  // String length: of the lengths that fit, the one that matches the target
  // best — whole strings, rounded up for a kWp / energy target, down for a
  // roof area; the longer string wins a tie (fewer strings, less cable).
  let perString = 0;
  let strings = 0;
  const wanted = panels;
  if (minPerString <= maxPerString && wanted > 0) {
    let best: { len: number; n: number; off: number } | undefined;
    for (let len = maxPerString; len >= Math.max(1, minPerString); len--) {
      const n = s.mode === 'area' ? Math.floor(wanted / len) : Math.ceil(wanted / len);
      if (n < 1) continue;
      const off = Math.abs(n * len - wanted);
      if (!best || off < best.off) best = { len, n, off };
    }
    if (best) { perString = best.len; strings = best.n; }
  }
  panels = perString * strings;
  if (wanted && panels !== wanted) notes.push(`${panels} panels (${strings} strings of ${perString}) instead of ${wanted} — whole strings`);
  // Inverters: total AC for the DC/AC ratio, in units of the chosen inverter.
  const kwpRaw = (panels * p.pmaxW) / 1000;
  const inverters = panels ? Math.max(1, Math.ceil(kwpRaw / s.dcAcRatio / inv.acKw - 1e-9)) : 0;
  const kwp = (panels * p.pmaxW) / 1000;
  const mpptTotal = inverters * inv.mppts;
  const stringsPerMppt = mpptTotal ? Math.ceil(strings / mpptTotal) : 0;
  const mpptCurrentA = stringsPerMppt * p.iscA * 1.25;
  if (mpptCurrentA > inv.maxInputA) warn(`MPPT current ${mpptCurrentA.toFixed(1)} A > ${inv.maxInputA} A — add inverters or use more MPPTs`);
  const ratio = inverters ? kwp / (inverters * inv.acKw) : 0;
  if (ratio > 1.35) warn(`DC/AC ratio ${ratio.toFixed(2)} — the inverters will clip`);
  if (ratio > 0 && ratio < 0.9) warn(`DC/AC ratio ${ratio.toFixed(2)} — inverters oversized`);

  const dailyKwh = kwp * perKwpDaily;
  const annualKwh = dailyKwh * 365;
  const acKw = inverters * inv.acKw;
  const acCurrentA = inv.phases === 3 ? (acKw * 1000) / (Math.sqrt(3) * voltageV) : (acKw * 1000) / (voltageV / Math.sqrt(3));
  const list = breakers();
  const acBreakerRequiredA = acCurrentA * 1.25;
  const acBreakerMaxA = list[list.length - 1];
  const acBreakerA = acCurrentA > 0 ? list.find((b) => b >= acBreakerRequiredA - 1e-9) : undefined;
  const acBreakerNoFit = acCurrentA > 0 && acBreakerA === undefined;
  if (acBreakerNoFit) bad(`No suitable AC breaker in the available list: ${acBreakerRequiredA.toFixed(0)} A needed (1.25 × ${acCurrentA.toFixed(0)} A), largest available ${acBreakerMaxA} A. One aggregate connection can't be protected — configure separate inverter groups / feeders explicitly.`);
  if (s.mode === 'area' && !panels) bad('The roof area is too small for one string');

  return {
    panels, kwp, arrayAreaM2: panels * panelArea, roofNeededM2: (panels * panelArea) / (s.roofUsePct / 100),
    tCellMaxC: tCellMax, vocColdV: vocCold, vmpHotV: vmpHot, vmpColdV: vmpCold, vmpCoeffPct, vmpBasis,
    maxPerString, minPerString, perString, strings, inverters, inverterKw: inv.acKw, stringsPerMppt, mpptCurrentA, dcAcRatio: ratio,
    tempLossPct: tempLoss * 100, prPct: pr * 100, dailyKwh, annualKwh, specificYield: kwp ? annualKwh / kwp : 0,
    savings: s.tariff !== undefined ? annualKwh * s.tariff : undefined, co2Tonnes: (annualKwh * s.gridKgPerKwh) / 1000,
    acCurrentA, acBreakerA, acBreakerRequiredA, acBreakerMaxA, acBreakerNoFit, status, notes
  };
}
