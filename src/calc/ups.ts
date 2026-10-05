import { boardTotals } from './summary';
import { STANDARD_UPS_KVA } from './sizing';
import type { Project } from '../types';

/** UPS and battery sizing.
 *
 * UPS: load kVA and kW (with growth) against the design loading; the UPS
 * must cover both the kVA and the kW (kVA × its output power factor).
 * Battery (constant power, IEEE 485 / 1184 practice):
 *   P_dc = load kW ÷ inverter efficiency
 *   Ah (C10) = P_dc × t ÷ (V_string = blocks × block V) ÷ capacity-at-rate
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

export interface BatteryPowerTable {
  model: string;
  source: string;
  blockAh: number;
  blockV: number;
  endCellV: number;
  temperatureC: number;
  points: { minutes: number; wattsPerBlock: number }[];
}

/** Total coincident starting scenario, including all loads that remain running. */
export interface UpsSurge {
  totalKw?: number;
  totalKva?: number;
  durationSeconds?: number;
  ratedKw?: number;
  ratedKva?: number;
  ratedSeconds?: number;
  source: string; // inverter model and overload datasheet reference
}
export interface UpsSurgeResult {
  status: 'not checked' | 'pass' | 'fail';
  kw?: number;
  kva?: number;
  issue: string;
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
  surge?: UpsSurge;
  powerTable?: BatteryPowerTable; // VRLA, absolute W per block; never scaled between models
  startSocPct?: number;
  minSocPct?: number;
  endModuleV?: number;
  bmsDischargeA?: number; // continuous limit per series string, shared equally in parallel
  chargerCurrentA?: number; // total charger output
  rechargeLoadA?: number; // concurrent load on that charger
  rechargeFromSocPct?: number;
  rechargeToSocPct?: number;
  chargeEfficiencyPct?: number;
  absorptionHours?: number;
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
  /** Nominal voltage of the series string actually built (blocks × block V) — the basis of every battery figure. */
  stringV: number;
  /** The string doesn't make the requested DC bus (dcVoltage): the battery figures are for stringV and the
   * configuration is not valid until the bus or block voltage is changed. */
  busMismatch: string | undefined;
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
  surge: UpsSurgeResult;
  batteryIssue?: string;
  /** Set when the linked panel is gone: the figures are not a valid sizing. */
  sourceIssue?: string;
  batteryBasis: 'estimate' | 'manufacturer table';
  tableWattsPerBlock?: number;
  tableMinutes?: number;
  usableFraction: number;
  usableEnergyKwh: number;
  stringCurrentA: number;
  bmsOk?: boolean;
  rechargeHours?: number;
  rechargeNetA?: number;
  rechargeIssue?: string;
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
/** The panel a UPS is linked to no longer exists (it must be reassigned, or the link removed on purpose). */
export const upsSourceMissing = (project: Project, s: UpsSystem): boolean => !!s.boardId && !project.boards.some((b) => b.id === s.boardId);

export function upsLoad(project: Project, s: UpsSystem): { kva: number; kw: number } {
  if (upsSourceMissing(project, s)) return { kva: 0, kw: 0 }; // never falls back to the manual load list
  if (s.boardId) {
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

export function checkUpsSurge(s: UpsSystem, loadKw: number, loadKva: number): UpsSurgeResult {
  const x = s.surge;
  if (!x) return { status: 'not checked', issue: 'Starting scenario and inverter overload data not entered.' };
  const values = [x.totalKw, x.totalKva, x.durationSeconds, x.ratedKw, x.ratedKva, x.ratedSeconds];
  if (values.some(v => v === undefined) || !x.source.trim()) return { status: 'not checked', issue: 'Enter total starting kW/kVA, duration, inverter peak kW/kVA, supported duration and model/datasheet source.' };
  if (values.some(v => !Number.isFinite(v) || v! <= 0) || x.totalKw! > x.totalKva! || x.ratedKw! > x.ratedKva! || x.totalKw! < loadKw - 1e-9 || x.totalKva! < loadKva - 1e-9 || !Number.isFinite(s.growthPct) || s.growthPct < 0) return { status: 'fail', issue: 'Invalid surge data: positive values required, kW ≤ kVA, and total starting demand must include the running load.' };
  const g = 1 + s.growthPct / 100;
  const kw = x.totalKw! * g, kva = x.totalKva! * g;
  const failures: string[] = [];
  if (kw > x.ratedKw! + 1e-9) failures.push('starting kW exceeds peak kW');
  if (kva > x.ratedKva! + 1e-9) failures.push('starting kVA exceeds peak kVA');
  if (x.durationSeconds! > x.ratedSeconds! + 1e-9) failures.push('starting duration exceeds supported overload duration');
  return { status: failures.length ? 'fail' : 'pass', kw, kva, issue: failures.length ? failures.join('; ') : 'Within entered inverter peak power and duration. Battery/BMS transient current, voltage dip and overload curve are separate checks.' };
}

export function sizeUps(project: Project, s: UpsSystem): UpsResult {
  const notes: string[] = [];
  const { kva, kw } = upsLoad(project, s);
  const g = 1 + s.growthPct / 100;
  const lim = s.maxLoadingPct / 100;
  const designKva = (kva * g) / lim;
  const designKw = (kw * g) / lim;
  // Smallest standard UPS whose kVA and kW (kVA × output PF) both cover the design.
  const upsKva = upsSourceMissing(project, s) ? undefined : STANDARD_UPS_KVA.find((k) => k >= designKva - 1e-9 && k * s.outputPf >= designKw - 1e-9);
  if (!upsKva && !upsSourceMissing(project, s)) notes.push(`Above ${STANDARD_UPS_KVA[STANDARD_UPS_KVA.length - 1]} kVA — use UPS modules in parallel`);
  if (upsKva && upsKva * s.outputPf < designKw * 1.0001 && upsKva >= designKva) notes.push('Sized by kW (the UPS output power factor), not kVA');

  // Battery sized for the load with growth (not the UPS rating).
  const dcKw = (kw * g) / Math.max(0.5, s.inverterEff);
  const blocksPerString = Math.max(1, Math.round(s.dcVoltage / s.blockV));
  // Series voltages add: the string is what's built, the bus is what's requested — they must agree.
  const stringV = blocksPerString * s.blockV;
  const busMismatch = Math.abs(stringV - s.dcVoltage) > 1e-6 * Math.max(1, s.dcVoltage)
    ? `${blocksPerString} × ${s.blockV} V = ${+stringV.toFixed(2)} V, not the ${s.dcVoltage} V DC bus — no whole number of ${s.blockV} V ${s.chem === 'vrla' ? 'blocks' : 'modules'} makes ${s.dcVoltage} V. Change the DC bus or the ${s.chem === 'vrla' ? 'block' : 'module'} voltage; figures below are for the ${+stringV.toFixed(2)} V string and its UPS compatibility is not verified.`
    : undefined;
  if (busMismatch) notes.push(busMismatch);
  const rate = s.rateCapacityPct ? s.rateCapacityPct / 100 : capacityAtRate(s.chem, s.autonomyMin);
  const h = s.autonomyMin / 60;
  const usableFraction = s.chem === 'li-ion' ? ((s.startSocPct ?? 100) - (s.minSocPct ?? 0)) / 100 : 1;
  let batteryIssue = usableFraction > 0 && usableFraction <= 1 && (s.minSocPct ?? 0) >= 0 && (s.startSocPct ?? 100) <= 100 ? undefined : 'Invalid SOC window: require 0 ≤ minimum SOC < starting SOC ≤ 100.';
  const requiredAh = ((dcKw * 1000 * h) / stringV / Math.max(0.05, rate)) * s.ageing * s.tempFactor * s.designMargin / (usableFraction > 0 ? usableFraction : 1);
  const sizes = [...(s.blockAhOptions ?? (s.chem === 'vrla' ? VRLA_BLOCK_AH : LI_MODULE_AH))].sort((a, b) => a - b);
  let strings = 1;
  let blockAh = sizes.find((a) => a >= requiredAh);
  while (!blockAh && strings < 8) {
    strings++;
    blockAh = sizes.find((a) => a >= requiredAh / strings);
  }
  const table = s.powerTable;
  let tableWattsPerBlock: number | undefined;
  let tableMinutes: number | undefined;
  if (table) {
    const valid = s.chem === 'vrla' && table.model.trim() && table.source.trim() && Number.isFinite(table.temperatureC) && table.blockAh > 0 && Number.isFinite(table.blockAh)
      && Math.abs(table.blockV - s.blockV) < 1e-6 && Math.abs(table.endCellV - (s.endCellV ?? 1.75)) < 1e-6
      && table.points.length >= 2 && table.points.every((p, i, a) => Number.isFinite(p.minutes) && p.minutes > 0 && Number.isFinite(p.wattsPerBlock) && p.wattsPerBlock > 0 && (!i || p.minutes > a[i - 1].minutes && p.wattsPerBlock <= a[i - 1].wattsPerBlock));
    if (!valid) batteryIssue = 'Invalid manufacturer table: enter model/source, matching VRLA block/end voltage, temperature and increasing durations with positive, non-increasing W/block.';
    else if (s.autonomyMin < table.points[0].minutes || s.autonomyMin > table.points[table.points.length - 1].minutes) batteryIssue = 'Backup time is outside the manufacturer table; extrapolation is disabled.';
    else {
      const point = table.points.find(p => p.minutes >= s.autonomyMin)!;
      tableWattsPerBlock = point.wattsPerBlock;
      tableMinutes = point.minutes;
      strings = Math.max(1, Math.ceil(dcKw * 1000 * s.ageing * s.tempFactor * s.designMargin / (blocksPerString * point.wattsPerBlock) - 1e-9));
      blockAh = strings <= 8 ? table.blockAh : undefined;
      notes.push(`Manufacturer table: ${table.model}, ${table.temperatureC} °C, ${table.endCellV} V/cell. Conservative next-duration row (${point.minutes} min); no interpolation or scaling to other Ah sizes. Confirm temperature factor against this table's reference temperature.`);
    }
  }
  const vEnd = s.chem === 'vrla' ? (stringV / 2) * (s.endCellV ?? 1.75) : blocksPerString * (s.endModuleV ?? s.blockV * (2.8 / 3.2));
  const dcCurrentMaxA = (dcKw * 1000) / vEnd;
  if (!(vEnd > 0 && vEnd <= stringV)) batteryIssue = 'End-of-discharge voltage must be positive and no greater than nominal voltage.';
  if (s.chem === 'li-ion' && s.bmsDischargeA !== undefined) {
    if (!(s.bmsDischargeA > 0 && Number.isFinite(s.bmsDischargeA))) batteryIssue = 'BMS continuous discharge current must be positive.';
    else {
      strings = Math.max(strings, Math.ceil(dcCurrentMaxA / s.bmsDischargeA - 1e-9));
      blockAh = strings <= 8 ? sizes.find(a => a >= requiredAh / strings) : undefined;
    }
  }
  const sourceIssue = upsSourceMissing(project, s) ? `The linked panel ${s.boardId} no longer exists — assign this UPS to a panel (or remove the link and enter its loads) before relying on this study.` : undefined;
  if (sourceIssue) batteryIssue = sourceIssue;
  if (batteryIssue) { blockAh = undefined; notes.push(batteryIssue); }
  if (!blockAh && !batteryIssue) notes.push('More than 8 strings — use a larger block or a higher DC voltage');
  if (strings > 1) notes.push(`${strings} strings in parallel`);
  const installedAh = (blockAh ?? 0) * strings;
  const energyKwh = (installedAh * stringV) / 1000;
  // End of discharge: VRLA at the end-cell voltage; Li-ion ≈ 2.8 V of 3.2 V per cell.

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
      t = ((installedAh * stringV * r * usableFraction) / (s.ageing * s.tempFactor * s.designMargin) / (dcKw * 1000)) * 60;
    }
    runtimeMin = t;
  }
  if (table && blockAh) {
    const covered = table.points.filter(p => p.wattsPerBlock * blocksPerString * strings >= dcKw * 1000 * s.ageing * s.tempFactor * s.designMargin - 1e-9);
    runtimeMin = covered[covered.length - 1]?.minutes;
  }
  const stringCurrentA = dcCurrentMaxA / strings;
  const bmsOk = s.chem === 'li-ion' && s.bmsDischargeA !== undefined ? !!blockAh && stringCurrentA <= s.bmsDischargeA && !batteryIssue : undefined;
  if (s.chem === 'li-ion' && s.bmsDischargeA !== undefined) notes.push('BMS check covers continuous current with equal sharing only; confirm permitted series/parallel counts, cutoff voltage and transient capability with the manufacturer.');
  if (s.chem === 'li-ion' && s.bmsDischargeA === undefined) notes.push('BMS current limit not entered: discharge capability and permitted series/parallel configuration are not verified.');
  let rechargeHours: number | undefined, rechargeNetA: number | undefined, rechargeIssue: string | undefined;
  if (s.chargerCurrentA !== undefined) {
    rechargeNetA = s.chargerCurrentA - (s.rechargeLoadA ?? 0);
    const from = s.rechargeFromSocPct ?? 20, to = s.rechargeToSocPct ?? 100, efficiency = (s.chargeEfficiencyPct ?? 95) / 100;
    if (![s.chargerCurrentA, rechargeNetA, from, to, efficiency, s.absorptionHours ?? 0, s.rechargeLoadA ?? 0].every(Number.isFinite) || rechargeNetA <= 0 || (s.rechargeLoadA ?? 0) < 0 || from < 0 || to > 100 || to <= from || efficiency <= 0 || efficiency > 1 || (s.absorptionHours ?? 0) < 0) rechargeIssue = 'Invalid recharge inputs: charger must exceed concurrent load; require 0 ≤ starting SOC < target SOC ≤ 100 and positive efficiency ≤ 100%.';
    else if (blockAh) rechargeHours = installedAh * (to - from) / 100 / (rechargeNetA * efficiency) + (s.absorptionHours ?? 0);
    if (rechargeIssue) notes.push(rechargeIssue);
    notes.push('Recharge is a constant-current bulk estimate plus the entered absorption/taper allowance; confirm charge-current limits and the charger profile with the battery manufacturer.');
  }
  if (s.chem === 'vrla' && s.autonomyMin < 5) notes.push('VRLA capacity below 5 minutes is very rate-dependent — check the manufacturer\'s table');

  return {
    surge: checkUpsSurge(s, kw, kva),
    sourceIssue,
    loadKva: kva, loadKw: kw, designKva, designKw,
    upsKva, upsKw: upsKva ? upsKva * s.outputPf : undefined,
    ...loadingOf(kva, kw, upsKva, upsKva ? upsKva * s.outputPf : undefined),
    dcKw, blocksPerString, stringV, busMismatch, rate, requiredAh, strings, blockAh,
    totalBlocks: blockAh ? blocksPerString * strings : 0,
    energyKwh, dcCurrentMaxA, dcBreakerA, dcBreakerRequiredA, dcBreakerMaxA, dcBreakerNoFit, runtimeMin, batteryIssue, batteryBasis: table ? 'manufacturer table' : 'estimate',
    tableWattsPerBlock, tableMinutes, usableFraction, usableEnergyKwh: energyKwh * usableFraction,
    stringCurrentA, bmsOk, rechargeHours, rechargeNetA, rechargeIssue, notes
  };
}
