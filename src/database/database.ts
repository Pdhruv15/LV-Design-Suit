import spec from '../../electron/databaseSpec.json';
import { REFERENCE_CABLE_TABLE, setCables, type CableSpec } from '../calc/cableTable';
import { STANDARD_BREAKER_A, setBreakerLists } from '../calc/sizing';
import { breakerRateAed, CABLE_RATE_PER_M, setBreakerPrices } from '../data/rates';
import { BUILT_IN_CABLES, cableBuildText, cableKey } from '../model/cableRefs';
import { EMPTY_CATALOG, RULES, setCatalog, type Catalog, type CatalogBusbar } from './catalog';
import { DEFAULT_ROOM_TYPES } from '../calc/building';
import { DEFAULT_RULES } from '../calc/buildingDesign';
import { TYPICAL_BUSBAR_DATA } from '../calc/busbar';
import { STANDARD_GENERATOR_KVA, STANDARD_TRANSFORMER_KVA } from '../calc/sizing';
import { typicalImpedancePct } from '../calc/txGen';
import type { RoomType, UnitType } from '../types';
import type { PriceList } from '../model/priceList';
import { POINT_TYPES, STUDY_DEFAULTS, type Board, type PointType, type Project, type StudySettings } from '../types';

export const DATABASE_FOLDER = spec.folderName;
export const BOOKS = spec.books;

/** What the Electron side reads from the workbooks. */
export interface RawBook {
  file: string;
  rows: Record<string, string | number>[]; // keyed by column key; _row = Excel row number
  error?: string;
  missingColumns?: string[];
  modified?: number;
}
export interface RawDatabase {
  folder: string;
  books: Record<string, RawBook>;
  readAt: number;
}

export interface LibraryLoad {
  name: string;
  category?: string;
  column?: PointType; // DEWA schedule column it belongs to
  watts: number;
  pf?: number;
  phases?: 1 | 3;
  demandFactor?: number;
  starting?: string;
  manufacturer?: string;
  model?: string;
  notes?: string;
}

export interface BreakerRow {
  ratingA: number;
  type?: string;
  icuKa?: number;
  price?: number;
}

/** Design parameters Parameters.xlsx can set (blank = app default). */
export const PARAMETERS: { key: string; label: string; unit: string }[] = [
  { key: 'voltageV', label: 'System voltage (phase-phase)', unit: 'V' },
  { key: 'ambientC', label: 'Design ambient temperature', unit: '°C' },
  { key: 'vdLimitPct', label: 'Voltage drop limit, source to load', unit: '%' },
  { key: 'pfTarget', label: 'Power factor target', unit: '' },
  { key: 'futureGrowthPct', label: 'Future load growth', unit: '%' },
  { key: 'transformerMaxLoadingPct', label: 'Transformer max loading', unit: '%' },
  { key: 'generatorMaxLoadingPct', label: 'Generator max loading', unit: '%' },
  { key: 'minWireLightingMm2', label: 'Lighting circuits - min wire', unit: 'mm²' },
  { key: 'minWirePowerMm2', label: 'Power circuits - min wire', unit: 'mm²' },
  { key: 'elcbLightingMa', label: 'Lighting circuits - ELCB', unit: 'mA' },
  { key: 'elcbPowerMa', label: 'Power circuits - ELCB', unit: 'mA' }
];

export interface Database {
  loads: LibraryLoad[];
  cables: CableSpec[]; // empty = using the built-in reference
  breakers: BreakerRow[];
  parameters: Record<string, number>;
  issues: string[]; // human-readable problems, with file and row
  raw?: RawDatabase;
  catalog: Catalog;
}

export const EMPTY_DATABASE: Database = { loads: [], cables: [], breakers: [], parameters: {}, issues: [], catalog: EMPTY_CATALOG };

const num = (v: unknown): number | undefined => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const columnOf = (label: string): PointType | undefined =>
  POINT_TYPES.find((p) => p.label.toLowerCase() === label.toLowerCase())?.value ?? (label.toUpperCase() === 'OTHER' ? 'spare1' : undefined);

/** Validates the raw workbook rows. Bad rows are skipped and reported with
 * their Excel row number; nothing throws. */
export function parseDatabase(raw: RawDatabase): Database {
  const issues: string[] = [];
  const book = (id: string) => raw.books[id] ?? { file: id, rows: [] };
  for (const [, b] of Object.entries(raw.books)) {
    if (b.error) issues.push(`${b.file}: ${b.error}`);
    if (b.missingColumns?.length) issues.push(`${b.file}: missing column(s) ${b.missingColumns.join(', ')}`);
  }
  const bad = (file: string, row: unknown, why: string) => issues.push(`${file} row ${row}: ${why} — skipped`);

  const loads: LibraryLoad[] = [];
  const seen = new Set<string>();
  const lb = book('loads');
  for (const r of lb.rows) {
    const name = str(r.name);
    const watts = num(r.watts);
    if (!name) { bad(lb.file, r._row, 'no name'); continue; }
    if (watts === undefined || Number.isNaN(watts) || watts < 0) { bad(lb.file, r._row, `"${name}" needs Power (W) as a number`); continue; }
    if (seen.has(name.toLowerCase())) { bad(lb.file, r._row, `duplicate name "${name}"`); continue; }
    seen.add(name.toLowerCase());
    const pf = num(r.pf);
    const df = num(r.demandFactor);
    const phases = num(r.phases);
    loads.push({
      name,
      watts,
      category: str(r.category) || undefined,
      column: str(r.column) ? columnOf(str(r.column)) : undefined,
      pf: pf !== undefined && pf > 0 && pf <= 1 ? pf : undefined,
      demandFactor: df !== undefined && df > 0 && df <= 1 ? df : undefined,
      phases: phases === 3 ? 3 : phases === 1 ? 1 : undefined,
      starting: str(r.starting) || undefined,
      manufacturer: str(r.manufacturer) || undefined,
      model: str(r.model) || undefined,
      notes: str(r.notes) || undefined
    });
  }

  const cables: CableSpec[] = [];
  const cb = book('cables');
  for (const r of cb.rows) {
    const [csa, rr, x, amp, rate] = [num(r.csaMm2), num(r.rOhmPerKm20C), num(r.xOhmPerKm), num(r.ampacityA), num(r.ratePerM)];
    if ([csa, rr, x, amp].some((v) => v === undefined || Number.isNaN(v) || v! <= 0)) {
      bad(cb.file, r._row, 'size, R, X and current rating must all be positive numbers');
      continue;
    }
    if (cables.some((c) => c.csaMm2 === csa)) { bad(cb.file, r._row, `duplicate size ${csa} mm²`); continue; }
    cables.push({ csaMm2: csa!, rOhmPerKm20C: rr!, xOhmPerKm: x!, ampacityA: amp!, ratePerM: rate !== undefined && !Number.isNaN(rate) ? rate : undefined });
  }

  const breakers: BreakerRow[] = [];
  const bb = book('breakers');
  for (const r of bb.rows) {
    const rating = num(r.ratingA);
    if (rating === undefined || Number.isNaN(rating) || rating <= 0) { bad(bb.file, r._row, 'Rating (A) must be a positive number'); continue; }
    const icu = num(r.icuKa);
    const price = num(r.price);
    breakers.push({
      ratingA: rating,
      type: str(r.type) || undefined,
      icuKa: icu !== undefined && !Number.isNaN(icu) && icu > 0 ? icu : undefined,
      price: price !== undefined && !Number.isNaN(price) ? price : undefined
    });
  }

  const parameters: Record<string, number> = {};
  const pb = book('parameters');
  for (const r of pb.rows) {
    const key = str(r.key);
    if (!PARAMETERS.some((p) => p.key === key)) continue;
    const v = num(r.value);
    if (v === undefined) continue;
    if (Number.isNaN(v) || v <= 0) { bad(pb.file, r._row, `${str(r.parameter) || key}: value must be a positive number`); continue; }
    parameters[key] = v;
  }

  return { loads, cables, breakers, parameters, issues, raw, catalog: parseCatalog(raw, bad) };
}

const pos = (v: unknown) => { const n = num(v); return n !== undefined && !Number.isNaN(n) && n > 0 ? n : undefined; };
const opt = (v: unknown) => { const n = num(v); return n !== undefined && !Number.isNaN(n) ? n : undefined; };

/** Transformers, generators, busbar, equipment, room / unit types, prices, rules. */
function parseCatalog(raw: RawDatabase, bad: (file: string, row: unknown, why: string) => void): Catalog {
  const rowsOf = (id: string) => raw.books[id]?.rows ?? [];
  const fileOf = (id: string) => raw.books[id]?.file ?? id;
  const c: Catalog = { transformers: [], generators: [], busbar: [], equipment: [], roomTypes: [], unitTypes: [], priceLists: [], rules: {}, cableRefs: [] };
  for (const r of rowsOf('transformers')) {
    const kva = pos(r.kva);
    if (!kva) { bad(fileOf('transformers'), r._row, 'Rating (kVA) must be a positive number'); continue; }
    if (c.transformers.some((t) => t.kva === kva)) { bad(fileOf('transformers'), r._row, `duplicate ${kva} kVA`); continue; }
    c.transformers.push({ kva, zPct: pos(r.zPct), xr: pos(r.xr), vectorGroup: str(r.vectorGroup) || undefined, noLoadW: opt(r.noLoadW), loadLossW: opt(r.loadLossW), dims: str(r.dims) || undefined, weightKg: opt(r.weightKg), price: opt(r.price), manufacturer: str(r.manufacturer) || undefined });
  }
  for (const r of rowsOf('generators')) {
    const kva = pos(r.kva);
    if (!kva) { bad(fileOf('generators'), r._row, 'Rating (kVA) must be a positive number'); continue; }
    if (c.generators.some((t) => t.kva === kva)) { bad(fileOf('generators'), r._row, `duplicate ${kva} kVA`); continue; }
    c.generators.push({ kva, kw: opt(r.kw), xdPct: pos(r.xdPct), fuelLph: opt(r.fuelLph), dims: str(r.dims) || undefined, weightKg: opt(r.weightKg), price: opt(r.price), manufacturer: str(r.manufacturer) || undefined });
  }
  for (const r of rowsOf('busbar')) {
    const m = str(r.material).toLowerCase();
    const material = m.startsWith('cu') ? 'cu' : m.startsWith('al') ? 'al' : undefined;
    const ratingA = pos(r.ratingA), R = pos(r.rMohmPerM), X = opt(r.xMohmPerM);
    if (!material || !ratingA || !R || X === undefined) { bad(fileOf('busbar'), r._row, 'Material (Cu / Al), Rating, R and X are needed'); continue; }
    const b: CatalogBusbar = { material, ratingA, csaMm2: opt(r.csaMm2) ?? 0, rMohmPerM: R, xMohmPerM: X, icwKa: opt(r.icwKa) ?? 0, widthMm: opt(r.widthMm) ?? 0, heightMm: opt(r.heightMm) ?? 0, kgPerM: opt(r.kgPerM) ?? 0, ratePerM: opt(r.ratePerM), manufacturer: str(r.manufacturer) || undefined };
    c.busbar.push(b);
  }
  for (const r of rowsOf('equipment')) {
    const description = str(r.description);
    if (!description) { bad(fileOf('equipment'), r._row, 'no description'); continue; }
    c.equipment.push({ category: str(r.category) || 'Other', description, rating: str(r.rating) || undefined, unit: str(r.unit) || undefined, price: opt(r.price), install: opt(r.install), boqKey: str(r.boqKey) || undefined, manufacturer: str(r.manufacturer) || undefined });
  }
  for (const r of rowsOf('roomTypes')) {
    const id = str(r.id).replace(/\s+/g, '-').toLowerCase(), label = str(r.label), w = opt(r.wPerM2);
    if (!id || !label || w === undefined) { bad(fileOf('roomTypes'), r._row, 'Id, Name and Load (W/m²) are needed'); continue; }
    if (c.roomTypes.some((t) => t.id === id)) { bad(fileOf('roomTypes'), r._row, `duplicate id ${id}`); continue; }
    const t: RoomType = { id, label, wPerM2: w, demandFactor: pos(r.demandFactor) ?? 0.8, lux: opt(r.lux),
      rules: { ltgM2PerPoint: pos(r.ltgM2PerPoint), s13M2PerPoint: pos(r.s13M2PerPoint), acM2PerUnit: pos(r.acM2PerUnit), acKwPerUnit: pos(r.acKwPerUnit), wh: opt(r.wh), cooker: opt(r.cooker), exfan: opt(r.exfan) },
      lpdMax: pos(r.lpdMax), benchWPerM2: pos(r.benchWPerM2) };
    c.roomTypes.push(t);
  }
  const units = new Map<string, UnitType>();
  for (const r of rowsOf('unitTypes')) {
    const name = str(r.unitType), room = str(r.room), type = str(r.roomType).toLowerCase(), area = pos(r.areaM2);
    if (!name || !room || !type || !area) { bad(fileOf('unitTypes'), r._row, 'Unit type, Room, Room type and Area are needed'); continue; }
    const id = `lib-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const u = units.get(id) ?? { id, name, rooms: [] };
    u.rooms.push({ name: room, type, areaM2: area });
    const m = str(r.meter);
    if (m === '1-PH' || m === '3-PH' || m === 'CT') u.meter = m;
    units.set(id, u);
  }
  c.unitTypes = [...units.values()];
  const lists = new Map<string, PriceList>();
  for (const r of rowsOf('prices')) {
    const list = str(r.list), key = str(r.key), rate = opt(r.rate);
    if (!list || !key || rate === undefined) { bad(fileOf('prices'), r._row, 'List, Key and Supply rate are needed'); continue; }
    const id = `xl-${list.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const l = lists.get(id) ?? { id, name: `${list} (Excel)`, date: str(r.date) || new Date().toISOString().slice(0, 10), currency: str(r.currency) || 'AED', markupPct: 0, rates: {} };
    const install = opt(r.install);
    l.rates[key] = { rate, ...(install ? { labour: install } : {}), ...(str(r.description) ? { description: str(r.description) } : {}) };
    lists.set(id, l);
  }
  c.priceLists = [...lists.values()];
  for (const r of rowsOf('rules')) {
    const key = str(r.key);
    if (!RULES.some((x) => x.key === key)) continue;
    const v = opt(r.value);
    if (v === undefined) continue;
    if (v <= 0) { bad(fileOf('rules'), r._row, `${str(r.parameter) || key}: value must be positive`); continue; }
    c.rules[key] = v;
  }
  for (const r of rowsOf('cableSchedule')) {
    const ref = pos(r.ref), csa = pos(r.size);
    const m = str(r.cores).replace(/\s/g, '').match(/^(?:(\d+)[x×])?(\d+)C$/i);
    if (!ref || !csa || !m) { bad(fileOf('cableSchedule'), r._row, 'Ref no., Cores (e.g. 4C, 2x1C) and Size are needed'); continue; }
    if (c.cableRefs.some((x) => x.ref === ref)) { bad(fileOf('cableSchedule'), r._row, `duplicate Ref no. ${ref}`); continue; }
    const build = { runs: Number(m[1] ?? 1), cores: Number(m[2]), csa, type: str(r.construction) || 'XLPE/SWA/PVC', ecc: pos(r.ecc) };
    const key = cableKey(build);
    if (c.cableRefs.some((x) => x.key === key)) { bad(fileOf('cableSchedule'), r._row, `same cable as Ref no. ${c.cableRefs.find((x) => x.key === key)!.ref}`); continue; }
    c.cableRefs.push({ ref, key, text: str(r.description) || cableBuildText(build), standard: true });
  }
  return c;
}

// Built-in lists, kept so an emptied workbook goes back to them.
const BUILT_IN = { tx: [...STANDARD_TRANSFORMER_KVA], gen: [...STANDARD_GENERATOR_KVA], bus: { cu: [...TYPICAL_BUSBAR_DATA.cu], al: [...TYPICAL_BUSBAR_DATA.al] } };
const replaceAll = <T,>(arr: T[], next: T[]) => { arr.splice(0, arr.length, ...next); };

/** Makes the calculations use the database's cables, breaker ratings and
 * prices (falling back to the built-in values for anything empty). */
export function applyDatabase(db: Database): void {
  setCables(db.cables.length ? db.cables : null);
  setBreakerLists(
    db.breakers.length ? db.breakers.map((b) => b.ratingA) : null,
    db.breakers.some((b) => b.icuKa) ? db.breakers.filter((b) => b.icuKa).map((b) => b.icuKa!) : null
  );
  setBreakerPrices(db.breakers.filter((b) => b.price !== undefined).map((b) => ({ ratingA: b.ratingA, price: b.price! })));
  const c = db.catalog ?? EMPTY_CATALOG;
  setCatalog(c);
  replaceAll(STANDARD_TRANSFORMER_KVA, c.transformers.length ? c.transformers.map((t) => t.kva).sort((a, b) => a - b) : BUILT_IN.tx);
  replaceAll(STANDARD_GENERATOR_KVA, c.generators.length ? c.generators.map((g) => g.kva).sort((a, b) => a - b) : BUILT_IN.gen);
  const bus = (m: 'cu' | 'al') => c.busbar.filter((b) => b.material === m).sort((a, b) => a.ratingA - b.ratingA);
  replaceAll(TYPICAL_BUSBAR_DATA.cu, bus('cu').length ? bus('cu') : BUILT_IN.bus.cu);
  replaceAll(TYPICAL_BUSBAR_DATA.al, bus('al').length ? bus('al') : BUILT_IN.bus.al);
}

/** Rows written into newly created workbooks. Loads start empty (user
 * input only); cables/breakers are pre-filled with the built-in reference
 * values so calculations work from day one; parameters list the keys with
 * blank values. */
export function databaseSeeds(): Record<string, (string | number)[][]> {
  return {
    loads: [],
    cables: REFERENCE_CABLE_TABLE.map((c) => [c.csaMm2, c.rOhmPerKm20C, c.xOhmPerKm, c.ampacityA, CABLE_RATE_PER_M[c.csaMm2] ?? '', 'App reference value — replace with manufacturer data']),
    breakers: STANDARD_BREAKER_A.map((a) => [a, a <= 63 ? 'MCB' : a <= 1600 ? 'MCCB' : 'ACB', '', breakerRateAed(a), '', '']),
    parameters: PARAMETERS.map((p) => [p.label, '', p.unit, p.key]),
    transformers: BUILT_IN.tx.map((k) => [k, typicalImpedancePct(k), 5, 'Dyn11', '', '', '', '', '', '', 'Typical — replace with your supplier data']),
    generators: BUILT_IN.gen.map((k) => [k, Math.round(k * 0.8), 15, '', '', '', '', '', 'Typical — replace with your supplier data']),
    busbar: (['cu', 'al'] as const).flatMap((m) => BUILT_IN.bus[m].map((b) => [m === 'cu' ? 'Cu' : 'Al', b.ratingA, b.csaMm2, b.rMohmPerM, b.xMohmPerM, b.icwKa, b.widthMm, b.heightMm, b.kgPerM, '', '', 'Typical — replace with your catalogue (e.g. RR)'])),
    equipment: [
      ['Capacitor bank', 'Automatic capacitor bank with APFC relay, per kvar', '', 'no', '', '', '', '', 'Example row — set your price'],
      ['SPD', 'Surge protection device Type 2, 4P', '', 'no', '', '', 'spd:T2', '', ''],
      ['kWh meter', 'kWh meter, direct 3-phase', '', 'no', '', '', 'kwh:3-PH', '', ''],
      ['kWh meter', 'kWh meter, CT operated, with CTs and test block', '', 'no', '', '', 'kwh:CT', '', '']
    ],
    roomTypes: DEFAULT_ROOM_TYPES.map((t) => { const r = DEFAULT_RULES[t.id] ?? {}; return [t.id, t.label, t.wPerM2, t.demandFactor, t.lux ?? '', r.ltgM2PerPoint ?? '', r.s13M2PerPoint ?? '', r.acM2PerUnit ?? '', r.acKwPerUnit ?? '', r.wh ?? '', r.cooker ?? '', r.exfan ?? '', r.lpdMax ?? '', r.benchWPerM2 ?? '']; }),
    unitTypes: [['2BR apartment', 'Living / dining', 'living', 35, ''], ['2BR apartment', 'Bedroom 1', 'bedroom', 16, ''], ['2BR apartment', 'Bedroom 2', 'bedroom', 14, ''], ['2BR apartment', 'Kitchen', 'kitchen', 10, ''], ['2BR apartment', 'Bathroom 1', 'bathroom', 5, ''], ['2BR apartment', 'Bathroom 2', 'bathroom', 4, '']],
    prices: [],
    rules: RULES.map((r) => [r.label, '', r.unit, r.key]),
    cableSchedule: BUILT_IN_CABLES.map((c) => [c.ref, `${c.build.runs > 1 ? `${c.build.runs}x` : ''}${c.build.cores}C`, c.build.csa, c.build.type, c.build.ecc ?? '', '', c.note ?? ''])
  };
}

/** Project settings from Parameters.xlsx (only the values given there). */
export function projectDefaults(db: Database): Partial<Pick<Project, 'voltageV' | 'ambientC' | 'vdLimitPct'>> & { studySettings: StudySettings } {
  const p = db.parameters;
  const studyKeys = Object.keys(STUDY_DEFAULTS) as (keyof StudySettings)[];
  const studySettings: StudySettings = {};
  for (const k of studyKeys) if (p[k] !== undefined) studySettings[k] = p[k];
  return {
    ...(p.voltageV !== undefined && { voltageV: p.voltageV }),
    ...(p.ambientC !== undefined && { ambientC: p.ambientC }),
    ...(p.vdLimitPct !== undefined && { vdLimitPct: p.vdLimitPct }),
    studySettings
  };
}

export function applyParameters(project: Project, db: Database): Project {
  const d = projectDefaults(db);
  return { ...project, ...d, studySettings: { ...project.studySettings, ...d.studySettings } };
}

/** Library items suitable for a schedule column: those linked to it first,
 * then the rest. */
export function loadsForColumn(db: Database, column: PointType): LibraryLoad[] {
  return [...db.loads.filter((l) => l.column === column), ...db.loads.filter((l) => l.column !== column)];
}

export interface LibrarySync {
  project: Project;
  changes: string[]; // e.g. "DB-GF1 LTG: LED downlight 10 → 12 W"
  missing: string[]; // items a board uses that are no longer in the library
}

/** Brings every board's linked WATT/UNIT values up to date with the
 * library. Returns the boards whose values changed so they can be re-sized. */
export function syncLibrary(project: Project, db: Database): LibrarySync & { changedBoards: string[] } {
  const byName = new Map(db.loads.map((l) => [l.name.toLowerCase(), l]));
  const changes: string[] = [];
  const missing: string[] = [];
  const changedBoards: string[] = [];
  const boards = project.boards.map((b): Board => {
    if (!b.pointItems) return b;
    let pointWatts = b.pointWatts;
    for (const [col, name] of Object.entries(b.pointItems)) {
      if (!name) continue;
      const item = byName.get(name.toLowerCase());
      if (!item) {
        missing.push(`${b.id} ${col}: "${name}"`);
        continue;
      }
      const current = pointWatts?.[col as PointType];
      if (current !== item.watts) {
        changes.push(`${b.id} ${POINT_TYPES.find((p) => p.value === col)?.label ?? col}: ${name} ${current ?? 0} → ${item.watts} W`);
        pointWatts = { ...pointWatts, [col]: item.watts };
      }
    }
    if (pointWatts === b.pointWatts) return b;
    changedBoards.push(b.id);
    return { ...b, pointWatts };
  });
  return { project: changedBoards.length ? { ...project, boards } : project, changes, missing, changedBoards };
}
