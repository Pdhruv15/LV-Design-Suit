import spec from '../../electron/databaseSpec.json';
import { REFERENCE_CABLE_TABLE, setCables, type CableSpec } from '../calc/cableTable';
import { STANDARD_BREAKER_A, setBreakerLists } from '../calc/sizing';
import { breakerRateAed, CABLE_RATE_PER_M, setBreakerPrices } from '../data/rates';
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
}

export const EMPTY_DATABASE: Database = { loads: [], cables: [], breakers: [], parameters: {}, issues: [] };

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

  return { loads, cables, breakers, parameters, issues, raw };
}

/** Makes the calculations use the database's cables, breaker ratings and
 * prices (falling back to the built-in values for anything empty). */
export function applyDatabase(db: Database): void {
  setCables(db.cables.length ? db.cables : null);
  setBreakerLists(
    db.breakers.length ? db.breakers.map((b) => b.ratingA) : null,
    db.breakers.some((b) => b.icuKa) ? db.breakers.filter((b) => b.icuKa).map((b) => b.icuKa!) : null
  );
  setBreakerPrices(db.breakers.filter((b) => b.price !== undefined).map((b) => ({ ratingA: b.ratingA, price: b.price! })));
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
    parameters: PARAMETERS.map((p) => [p.label, '', p.unit, p.key])
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
