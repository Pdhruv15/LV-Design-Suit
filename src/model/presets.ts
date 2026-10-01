import { pushLibrary } from '../database/librarySync';
import { cableTypeDef } from './cableTypes';
import { designCurrentA, selectCable, upstreamVoltageDropPct } from '../calc/electrical';
import { applyRecommendation, recommend } from '../calc/sizing';
import { BOARD_KINDS, type Board, type BoardKind, type Feeder, type LoadType, type MeterType, type Project, type StarterType } from '../types';

/** Feeder presets: a whole outgoing way in one drag — breaker, earth
 * leakage, metering, local isolator and the load or sub-board it feeds.
 * Built-in combinations, plus the user's own saved from any feeder
 * ("Save as preset"), kept on this computer for every project. */

export type PresetBreaker = 'MCB' | 'MCCB' | 'ACB';

export interface FeederPreset {
  id: string;
  name: string;
  /** What the way feeds. */
  kind: 'load' | 'board';
  // Load
  loadType?: LoadType;
  loadName?: string;
  loadKw?: number;
  powerFactor?: number;
  demandFactor?: number;
  singlePhase?: boolean;
  starter?: StarterType;
  essential?: boolean;
  kvar?: number;
  // Sub-board
  boardKind?: BoardKind;
  boardRatingA?: number;
  // The way
  breaker?: PresetBreaker; // blank = the app's choice for the rating
  breakerRatingA?: number; // blank = sized for the load
  icuKa?: number;
  rcdMa?: number;
  kwhMeter?: MeterType;
  localIsolator?: boolean;
  cableType?: string; // blank = the default (fire-rated automatically for life safety circuits)
  lengthM?: number;
  builtIn?: boolean;
}

export const BUILT_IN_PRESETS: FeederPreset[] = [
  { id: 'bi-sockets', name: 'MCB + RCD 30 mA → sockets 3 kW', kind: 'load', loadType: 'sockets', loadName: 'Sockets', loadKw: 3, powerFactor: 0.9, demandFactor: 0.6, singlePhase: true, breaker: 'MCB', rcdMa: 30, lengthM: 25 },
  { id: 'bi-heater', name: 'MCB + RCD 30 mA + isolator → water heater 3 kW', kind: 'load', loadType: 'general', loadName: 'Water heater', loadKw: 3, powerFactor: 1, demandFactor: 1, singlePhase: true, breaker: 'MCB', rcdMa: 30, localIsolator: true, lengthM: 20 },
  { id: 'bi-split', name: 'MCB + isolator → split AC 3.5 kW', kind: 'load', loadType: 'hvac', loadName: 'Split AC', loadKw: 3.5, powerFactor: 0.85, demandFactor: 1, singlePhase: true, breaker: 'MCB', localIsolator: true, lengthM: 20 },
  { id: 'bi-ahu', name: 'MCCB + RCD 300 mA + isolator → AHU 30 kW', kind: 'load', loadType: 'hvac', loadName: 'AHU', loadKw: 30, powerFactor: 0.85, demandFactor: 1, breaker: 'MCCB', rcdMa: 300, localIsolator: true, lengthM: 40 },
  { id: 'bi-fcu', name: 'MCB + isolator → FCU group 5 kW', kind: 'load', loadType: 'hvac', loadName: 'FCU group', loadKw: 5, powerFactor: 0.85, demandFactor: 0.9, breaker: 'MCB', localIsolator: true, lengthM: 30 },
  { id: 'bi-pump', name: 'MCCB + isolator → pump 15 kW (star-delta)', kind: 'load', loadType: 'motor', loadName: 'Pump', loadKw: 15, powerFactor: 0.86, demandFactor: 1, starter: 'SD', breaker: 'MCCB', localIsolator: true, lengthM: 30 },
  { id: 'bi-chiller', name: 'MCCB + CT meter → chiller 150 kW (soft starter)', kind: 'load', loadType: 'hvac', loadName: 'Chiller', loadKw: 150, powerFactor: 0.9, demandFactor: 1, starter: 'SS', breaker: 'MCCB', kwhMeter: 'CT', lengthM: 50 },
  { id: 'bi-ev', name: 'MCB + RCD 30 mA + kWh meter → EV charger 22 kW', kind: 'load', loadType: 'ev', loadName: 'EV charger', loadKw: 22, powerFactor: 0.98, demandFactor: 1, breaker: 'MCB', rcdMa: 30, kwhMeter: '3-PH', lengthM: 30 },
  { id: 'bi-db', name: 'MCCB + kWh meter → DB 63 A', kind: 'board', boardKind: 'DB', boardRatingA: 63, breaker: 'MCCB', breakerRatingA: 63, kwhMeter: '3-PH', lengthM: 30 },
  { id: 'bi-smdb', name: 'MCCB + CT meter → SMDB 250 A', kind: 'board', boardKind: 'SMDB', boardRatingA: 250, breaker: 'MCCB', breakerRatingA: 250, kwhMeter: 'CT', lengthM: 40 },
  { id: 'bi-mcc', name: 'MCCB + CT meter → MCC 400 A', kind: 'board', boardKind: 'MCC', boardRatingA: 400, breaker: 'MCCB', breakerRatingA: 400, kwhMeter: 'CT', lengthM: 40 },
  { id: 'bi-emdb', name: 'MCCB → EMDB 250 A (essential)', kind: 'board', boardKind: 'EMDB', boardRatingA: 250, breaker: 'MCCB', breakerRatingA: 250, lengthM: 30 }
];

// ---- The user's presets (this computer) --------------------------------------

const KEY = 'lvds.feederPresets';
export function loadUserPresets(): FeederPreset[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}
export function saveUserPresets(list: FeederPreset[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(({ builtIn: _b, ...p }) => p))); void pushLibrary();
    return true;
  } catch {
    return false;
  }
}

/** Merge presets (e.g. from a file or a project) into a list: same id or
 * same name replaces, others are added. */
export function mergePresets(into: FeederPreset[], add: FeederPreset[]): { list: FeederPreset[]; added: number; updated: number } {
  let added = 0, updated = 0;
  const list = [...into];
  for (const raw of add) {
    if (!raw || typeof raw.name !== 'string' || (raw.kind !== 'load' && raw.kind !== 'board')) continue;
    const p = { ...raw, id: typeof raw.id === 'string' && raw.id ? raw.id : `up-${Date.now().toString(36)}-${list.length}` };
    delete (p as { builtIn?: boolean }).builtIn;
    const i = list.findIndex((x) => x.id === p.id || x.name === p.name);
    if (i >= 0) { if (JSON.stringify(list[i]) !== JSON.stringify(p)) { list[i] = p; updated++; } }
    else { list.push(p); added++; }
  }
  return { list, added, updated };
}

/** The presets file: { format, presets }. */
export const presetsFile = (list: FeederPreset[]) => JSON.stringify({ format: 'lv-design-studio/feeder-presets', version: 1, presets: list }, null, 2);
export function readPresetsFile(text: string): FeederPreset[] | null {
  try {
    const v = JSON.parse(text);
    const arr = Array.isArray(v) ? v : Array.isArray(v?.presets) ? v.presets : null;
    return arr;
  } catch {
    return null;
  }
}

const breakerOf = (f: Feeder): PresetBreaker => (f.breakerType === 'ACB' ? 'ACB' : f.breakerType === 'MCCB' || (!f.breakerType && f.breakerRatingA > 63) ? 'MCCB' : 'MCB');

/** A preset from a feeder as it is on the SLD (a load, or a sub-board's incomer). */
export function presetFromFeeder(project: Project, f: Feeder, name: string): FeederPreset {
  const way = {
    breaker: breakerOf(f), breakerRatingA: f.breakerRatingA, icuKa: f.breakerIcuKa, lengthM: f.lengthM,
    ...(f.rcdMa ? { rcdMa: f.rcdMa } : {}), ...(f.kwhMeter ? { kwhMeter: f.kwhMeter } : {}), ...(f.localIsolator ? { localIsolator: true } : {}),
    ...(f.cableType ? { cableType: f.cableType } : {})
  };
  const id = `up-${Date.now().toString(36)}`;
  if (f.feedsBoardId) {
    const b = project.boards.find((x) => x.id === f.feedsBoardId);
    return { id, name, kind: 'board', boardKind: b?.kind ?? 'DB', boardRatingA: b?.ratedCurrentA ?? f.breakerRatingA, ...way };
  }
  return {
    id, name, kind: 'load', loadType: f.loadType ?? 'general', loadName: f.name.replace(/\s+\d+$/, '') || f.name, // "AHU 2" → "AHU"
    loadKw: f.loadKw, powerFactor: f.powerFactor, demandFactor: f.demandFactor,
    ...(f.cores === 2 ? { singlePhase: true } : {}), ...(f.starter ? { starter: f.starter } : {}), ...(f.essential ? { essential: true } : {}), ...(f.kvar ? { kvar: f.kvar } : {}),
    ...way
  };
}

/** What the preset's way is made of, e.g. "MCCB 63 A · RCD 300 mA · isolator". */
export function presetParts(p: FeederPreset): string {
  const way = [
    `${p.breaker ?? 'Breaker'}${p.breakerRatingA ? ` ${p.breakerRatingA} A` : ''}`,
    p.rcdMa ? `RCD ${p.rcdMa} mA` : '',
    p.kwhMeter ? (p.kwhMeter === 'CT' ? 'CT meter' : 'kWh meter') : '',
    p.localIsolator ? 'isolator' : '',
    p.cableType ? `${cableTypeDef(p.cableType).code} cable` : ''
  ].filter(Boolean).join(' + ');
  const to = p.kind === 'board' ? `${p.boardKind} ${p.boardRatingA ?? ''} A` : `${p.loadName ?? 'load'} ${p.loadKw ?? ''} kW${p.singlePhase ? ' 1-ph' : ''}`;
  return `${way} → ${to}`;
}

// ---- Dropping a preset ---------------------------------------------------------------

function uniqueId(taken: Set<string>, base: string): string {
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}
const tag = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'LOAD';

/** Breaker type from the preset's family and the rating. */
function breakerType(p: FeederPreset, ratingA: number): Feeder['breakerType'] {
  if (p.breaker === 'ACB') return 'ACB';
  if (p.breaker === 'MCCB') return 'MCCB';
  if (p.breaker === 'MCB') return ratingA <= 63 ? 'C' : 'MCCB';
  return undefined;
}

/** Whether a preset can go on this board. */
export function canDropPreset(project: Project, p: FeederPreset, boardId: string): boolean {
  const b = project.boards.find((x) => x.id === boardId);
  if (!b) return false;
  if (p.kind === 'board' && p.boardKind === 'MDB') return b.kind === 'MC';
  if (p.kind === 'board' && p.boardKind === 'MC') return false;
  return true;
}

export function applyPreset(project: Project, p: FeederPreset, boardId: string): { project: Project; select: { type: 'board' | 'feeder'; id: string }; message: string } | { project: Project; message: string } {
  if (!canDropPreset(project, p, boardId)) return { project, message: p.boardKind === 'MDB' ? 'An MDB preset goes on a meter cabinet busbar' : `Can't place ${p.name} here` };
  const taken = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id)]);
  const extras: Partial<Feeder> = {
    ...(p.rcdMa ? { rcdMa: p.rcdMa } : {}), ...(p.kwhMeter ? { kwhMeter: p.kwhMeter } : {}),
    ...(p.localIsolator && p.kind === 'load' ? { localIsolator: true } : {}),
    ...(p.cableType ? { cableType: p.cableType } : {})
  };

  if (p.kind === 'board') {
    const kind = p.boardKind ?? 'DB';
    const id = uniqueId(taken, kind);
    const rating = p.boardRatingA ?? 63;
    const board: Board = { id, name: `${kind} ${id.slice(kind.length + 1)}`, kind, upstreamId: boardId, ratedCurrentA: rating };
    const breakerA = p.breakerRatingA ?? rating;
    const cable = selectCable(breakerA, p.lengthM ?? 30, project.voltageV, 4, 0.85, project.ambientC, 100, breakerA) ?? 300;
    const incomer: Feeder = {
      id: `INC-${id}`, boardId, name: `Incomer to ${board.name}`, loadKw: 0, demandFactor: 1, powerFactor: 0.85,
      lengthM: p.lengthM ?? 30, cableCsaMm2: cable, cores: 4, breakerRatingA: breakerA, breakerIcuKa: p.icuKa ?? 36,
      breakerType: breakerType(p, breakerA) ?? (breakerA > 1600 ? 'ACB' : breakerA > 63 ? 'MCCB' : 'C'),
      feedsBoardId: id, ...extras
    };
    return {
      project: { ...project, boards: [...project.boards, board], feeders: [...project.feeders, incomer] },
      select: { type: 'board', id },
      message: `Added ${id} on ${boardId}: ${presetParts({ ...p, breakerRatingA: breakerA })} — ${incomer.cores}C × ${incomer.cableCsaMm2} mm²`
    };
  }

  const id = uniqueId(taken, `${boardId}-${tag(p.loadName ?? p.loadType ?? 'LOAD')}`);
  const draft: Feeder = {
    id, boardId, name: `${p.loadName ?? 'Load'} ${id.slice(id.lastIndexOf('-') + 1)}`,
    loadKw: p.loadKw ?? 1, demandFactor: p.demandFactor ?? 1, powerFactor: p.powerFactor ?? 0.9,
    lengthM: p.lengthM ?? 30, cableCsaMm2: 4, cores: p.singlePhase ? 2 : 4, breakerRatingA: 16, breakerIcuKa: p.icuKa ?? 25,
    loadType: p.loadType ?? 'general',
    ...(p.starter ? { starter: p.starter } : {}), ...(p.essential ? { essential: true } : {}), ...(p.kvar ? { kvar: p.kvar } : {})
  };
  // Breaker and cable sized for the load, then the preset's own choices.
  const sized = applyRecommendation(draft, recommend({ ...project, feeders: [...project.feeders, draft] }, draft, 'optimise'));
  const rating = p.breakerRatingA ?? sized.breakerRatingA;
  let f: Feeder = { ...sized, breakerRatingA: rating, breakerType: breakerType(p, rating) ?? sized.breakerType, ...extras };
  if (p.breakerRatingA && p.breakerRatingA !== sized.breakerRatingA) {
    // A fixed breaker rating: the cable must carry it (Iz ≥ In) within the voltage drop budget.
    const budget = project.vdLimitPct * 0.85 - upstreamVoltageDropPct(project, boardId);
    const csa = selectCable(designCurrentA(f, project), f.lengthM, project.voltageV, f.cores, f.powerFactor, project.ambientC, budget, rating);
    if (csa) f = { ...f, cableCsaMm2: csa, parallel: undefined, cpcMm2: undefined };
  }
  return {
    project: { ...project, feeders: [...project.feeders, f] },
    select: { type: 'feeder', id: f.id },
    message: `Added ${f.id} on ${boardId}: ${presetParts({ ...p, breakerRatingA: f.breakerRatingA })} — ${f.cores}C × ${f.cableCsaMm2} mm², ${f.lengthM} m`
  };
}

export const boardKindLabel = (k: BoardKind) => BOARD_KINDS.find((b) => b.value === k)?.label ?? k;
