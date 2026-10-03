import { boardTotals } from './summary';
import { STANDARD_UPS_KVA } from './sizing';
import type { Project } from '../types';

/** UPS and battery sizing.
 *
 * UPS: load kVA and kW (with growth) against the design loading; the UPS
 * must cover both the kVA and the kW (kVA × its output power factor).
 * Battery (constant power, IEEE 485 / 1184 practice):
 *   P_dc = load kW ÷ inverter efficiency
 *   Ah (C10) = P_dc × t ÷ (V_dc,nominal) ÷ capacity-at-rate
 *              × ageing × temperature × design margin
 * where capacity-at-rate is the share of the C10 capacity a battery can
 * deliver over the backup time (short discharges give much less). The
 * string is cells / blocks in series for the DC bus; strings in parallel
 * when one block size isn't enough. */

export type BatteryChem = 'vrla' | 'li-ion';

export interface UpsLoad {
  id: string;
  name: string;
  qty: number;
  va?: number; // per unit, VA
  w?: number; // per unit, W (if VA is not given, VA = W ÷ PF)
  pf?: number;
}

export interface UpsSystem {
  id: string;
  name: string;
  boardId?: string; // UPS board on the SLD whose demand is the load
  loads: UpsLoad[]; // used when there is no board
  growthPct: number;
  maxLoadingPct: number;
  outputPf: number; // UPS rated output power factor (0.9 or 1.0)
  inverterEff: number; // DC → AC, 0–1
  autonomyMin: number;
  chem: BatteryChem;
  dcVoltage: number; // nominal DC bus (V)
  blockV: number; // block / module nominal voltage (12 V VRLA block, 51.2 V Li-ion module…)
  endCellV?: number; // VRLA end-of-discharge per 2 V cell (1.75 typical)
  rateCapacityPct?: number; // override: % of C10 available at this backup time
  ageing: number; // 1.25 (IEEE 485)
  tempFactor: number; // 1.0 at 25 °C; > 1 for colder rooms
  designMargin: number; // 1.1
  blockAhOptions?: number[]; // available block sizes (Ah)
}

export const VRLA_BLOCK_AH = [7, 9, 12, 18, 26, 33, 40, 55, 65, 75, 100, 120, 150, 200];
export const LI_MODULE_AH = [50, 100, 105, 150, 200, 280];
export const DC_VOLTAGES = [192, 240, 360, 384, 480, 512, 540];

/** Share of the C10 capacity a battery delivers over a backup time. Typical
 * figures; use the manufacturer's constant-power table for the final design.
 * VRLA to 1.75 V/cell; Li-ion (LFP) is nearly rate-independent. */
const VRLA_RATE: [number, number][] = [[5, 0.25], [10, 0.34], [15, 0.4], [30, 0.5], [60, 0.6], [120, 0.72], [180, 0.8], [300, 0.88], [480, 0.95], [600, 1]];
const LI_RATE: [number, number][] = [[5, 0.85], [10, 0.9], [15, 0.92], [30, 0.95], [60, 0.97], [120, 1]];

export function capacityAtRate(chem: BatteryChem, minutes: number): number {
  const t = chem === 'vrla' ? VRLA_RATE : LI_RATE;
  if (minutes <= t[0][0]) return t[0][1];
  if (minutes >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 0; i < t.length - 1; i++) {
    const [m1, f1] = t[i];
    const [m2, f2] = t[i + 1];
    if (minutes <= m2) return f1 + ((minutes - m1) / (m2 - m1)) * (f2 - f1);
  }
  return 1;
}

export const UPS_DEFAULTS: Omit<UpsSystem, 'id' | 'name'> = {
  loads: [],
  growthPct: 20,
  maxLoadingPct: 80,
  outputPf: 0.9,
  inverterEff: 0.94,
  autonomyMin: 15,
  chem: 'vrla',
  dcVoltage: 384,
  blockV: 12,
  endCellV: 1.75,
  ageing: 1.25,
  tempFactor: 1,
  designMargin: 1.1
};

export interface UpsResult {
  loadKva: number;
  loadKw: number;
  designKva: number; // with growth, at the design loading
  designKw: number;
  upsKva: number | undefined; // standard size
  upsKw: number | undefined;
  /** Today's load (no growth) on the chosen UPS, against each of its limits: kVA and kW (kVA × output PF).
   * loadingPct is the larger — the limit reached first (loadingBy). Undefined with no UPS / no rating. */
  loadingKvaPct: number | undefined;
  loadingKwPct: number | undefined;
  loadingPct: number | undefined;
  loadingBy: 'kVA' | 'kW' | undefined;
  dcKw: number; // battery discharge power
  blocksPerString: number;
  rate: number; // capacity at the backup time, share of C10
  requiredAh: number; // C10, all strings together
  strings: number;
  blockAh: number | undefined;
  totalBlocks: number;
  energyKwh: number; // installed nominal
  dcCurrentMaxA: number; // at the end of discharge, all strings together (the battery bus)
  /** Battery-bus (aggregate) DC breaker: the smallest listed rating ≥ 1.25 × the maximum current.
   * Undefined when no listed rating is large enough (dcBreakerNoFit) — never the largest instead. */
  dcBreakerA: number | undefined;
  dcBreakerRequiredA: number;
  dcBreakerMaxA: number;
  dcBreakerNoFit: boolean;
  runtimeMin: number | undefined; // with the chosen battery
  notes: string[];
}

const DC_BREAKERS = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600];

/** Utilisation of a UPS by today's load: kVA and kW separately; the overall figure is the larger. */
function loadingOf(kva: number, kw: number, upsKva?: number, upsKw?: number): Pick<UpsResult, 'loadingKvaPct' | 'loadingKwPct' | 'loadingPct' | 'loadingBy'> {
  const loadingKvaPct = upsKva && upsKva > 0 ? (kva / upsKva) * 100 : undefined;
  const loadingKwPct = upsKw && upsKw > 0 ? (kw / upsKw) * 100 : undefined;
  if (loadingKvaPct === undefined || loadingKwPct === undefined) return { loadingKvaPct, loadingKwPct, loadingPct: undefined, loadingBy: undefined };
  const byKw = loadingKwPct > loadingKvaPct + 1e-9;
  return { loadingKvaPct, loadingKwPct, loadingPct: byKw ? loadingKwPct : loadingKvaPct, loadingBy: byKw ? 'kW' : 'kVA' };
}

/** Load of a UPS: its board's demand, or its load list. */
export function upsLoad(project: Project, s: UpsSystem): { kva: number; kw: number } {
  if (s.boardId && project.boards.some((b) => b.id === s.boardId)) {
    const t = boardTotals(project, s.boardId);
    return { kw: t.demandKw, kva: Math.hypot(t.demandKw, Math.max(0, t.demandKvar)) };
  }
  let kw = 0, kva = 0;
  for (const l of s.loads) {
    const pf = l.pf ?? 0.9;
    const va = l.va ?? (l.w !== undefined ? l.w / pf : 0);
    const w = l.w ?? va * pf;
    kva += (va * l.qty) / 1000;
    kw += (w * l.qty) / 1000;
  }
  return { kva, kw };
}

export function sizeUps(project: Project, s: UpsSystem): UpsResult {
  const notes: string[] = [];
  const { kva, kw } = upsLoad(project, s);
  const g = 1 + s.growthPct / 100;
  const lim = s.maxLoadingPct / 100;
  const designKva = (kva * g) / lim;
  const designKw = (kw * g) / lim;
  // Smallest standard UPS whose kVA and kW (kVA × output PF) both cover the design.
  const upsKva = STANDARD_UPS_KVA.find((k) => k >= designKva - 1e-9 && k * s.outputPf >= designKw - 1e-9);
  if (!upsKva) notes.push(`Above ${STANDARD_UPS_KVA[STANDARD_UPS_KVA.length - 1]} kVA — use UPS modules in parallel`);
  if (upsKva && upsKva * s.outputPf < designKw * 1.0001 && upsKva >= designKva) notes.push('Sized by kW (the UPS output power factor), not kVA');

  // Battery sized for the load with growth (not the UPS rating).
  const dcKw = (kw * g) / Math.max(0.5, s.inverterEff);
  const blocksPerString = Math.max(1, Math.round(s.dcVoltage / s.blockV));
  const rate = s.rateCapacityPct ? s.rateCapacityPct / 100 : capacityAtRate(s.chem, s.autonomyMin);
  const h = s.autonomyMin / 60;
  const requiredAh = ((dcKw * 1000 * h) / s.dcVoltage / Math.max(0.05, rate)) * s.ageing * s.tempFactor * s.designMargin;
  const sizes = [...(s.blockAhOptions ?? (s.chem === 'vrla' ? VRLA_BLOCK_AH : LI_MODULE_AH))].sort((a, b) => a - b);
  let strings = 1;
  let blockAh = sizes.find((a) => a >= requiredAh);
  while (!blockAh && strings < 8) {
    strings++;
    blockAh = sizes.find((a) => a >= requiredAh / strings);
  }
  if (!blockAh) notes.push('More than 8 strings — use a larger block or a higher DC voltage');
  if (strings > 1) notes.push(`${strings} strings in parallel`);
  const installedAh = (blockAh ?? 0) * strings;
  const energyKwh = (installedAh * s.dcVoltage) / 1000;
  // End of discharge: VRLA at the end-cell voltage; Li-ion ≈ 2.8 V of 3.2 V per cell.
  const vEnd = s.chem === 'vrla' ? (s.dcVoltage / 2) * (s.endCellV ?? 1.75) : s.dcVoltage * (2.8 / 3.2);
  const dcCurrentMaxA = (dcKw * 1000) / vEnd;
  // Aggregate battery-bus protection (all strings together), app policy ≥ 1.25 × the end-of-discharge
  // current. Per-string protection is a separate check. A rating only covers current — DC voltage,
  // poles and breaking capacity must be confirmed for the chosen device.
  const dcBreakerRequiredA = dcCurrentMaxA * 1.25;
  const dcBreakerMaxA = DC_BREAKERS[DC_BREAKERS.length - 1];
  const dcBreakerA = dcCurrentMaxA > 0 ? DC_BREAKERS.find((a) => a >= dcBreakerRequiredA - 1e-9) : undefined;
  const dcBreakerNoFit = dcCurrentMaxA > 0 && dcBreakerA === undefined;
  if (dcBreakerNoFit) notes.push(`No suitable DC breaker in the list for the battery bus: ${dcBreakerRequiredA.toFixed(0)} A needed (1.25 × ${dcCurrentMaxA.toFixed(0)} A), largest listed ${dcBreakerMaxA} A — choose a DC-rated device for this current (or a different DC arrangement) explicitly.`);
  // Runtime with the chosen battery (same factors, solved for t; rate at that t).
  let runtimeMin: number | undefined;
  if (installedAh > 0 && dcKw > 0) {
    let t = s.autonomyMin;
    for (let i = 0; i < 20; i++) {
      const r = s.rateCapacityPct ? s.rateCapacityPct / 100 : capacityAtRate(s.chem, t);
      t = ((installedAh * s.dcVoltage * r) / (s.ageing * s.tempFactor * s.designMargin) / (dcKw * 1000)) * 60;
    }
    runtimeMin = t;
  }
  if (s.chem === 'vrla' && s.autonomyMin < 5) notes.push('VRLA capacity below 5 minutes is very rate-dependent — check the manufacturer\'s table');
  if (Math.abs(blocksPerString * s.blockV - s.dcVoltage) > 0.5) notes.push(`${blocksPerString} × ${s.blockV} V = ${blocksPerString * s.blockV} V, not exactly ${s.dcVoltage} V`);

  return {
    loadKva: kva, loadKw: kw, designKva, designKw,
    upsKva, upsKw: upsKva ? upsKva * s.outputPf : undefined,
    ...loadingOf(kva, kw, upsKva, upsKva ? upsKva * s.outputPf : undefined),
    dcKw, blocksPerString, rate, requiredAh, strings, blockAh,
    totalBlocks: blockAh ? blocksPerString * strings : 0,
    energyKwh, dcCurrentMaxA, dcBreakerA, dcBreakerRequiredA, dcBreakerMaxA, dcBreakerNoFit, runtimeMin, notes
  };
}
