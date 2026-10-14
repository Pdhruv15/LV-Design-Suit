import type { Feeder, Project } from '../types';

// Reference data for copper, XLPE-insulated, steel-wire-armoured (SWA) cable,
// 4-core, laid in free air at 30°C ambient — a common LV distribution cable
// construction. R values (ohm/km at 20°C DC) are IEC 60228 standard values.
// X and ampacity are typical published figures for this cable type and are
// approximations: for a real project, replace with the manufacturer's
// datasheet or the exact IEC 60364-5-52 table for your installation method.
export interface CableSpec {
  csaMm2: number;
  rOhmPerKm20C: number; // DC resistance at 20°C, ohm/km (IEC 60228)
  xOhmPerKm: number; // reactance, ohm/km (typical, multicore)
  ampacityA: number; // current rating in free air, 30°C ambient, XLPE 90°C
  ratePerM?: number; // supply + install rate for the BOQ (from Cables.xlsx)
  /** Where the row's values come from (Cables.xlsx; blank on the built-in reference rows). */
  manufacturer?: string;
  cableType?: string; // e.g. "Cu/XLPE/SWA/PVC 0.6/1 kV, 4-core"
  installMethod?: string; // e.g. "IEC 60364-5-52 method E, free air"
  referenceDoc?: string; // datasheet or table the values were taken from
  /** Current rating (A, 30 °C air / 20 °C ground, before derating) for other installation methods. */
  methodRatings?: Partial<Record<InstallMethod, number>>;
}

/** IEC 60364-5-52 reference installation methods. `ampacityA` is method E. */
export type InstallMethod = 'E' | 'C' | 'B1' | 'B2' | 'A1' | 'A2' | 'D1' | 'D2';
export const INSTALL_METHODS: { id: InstallMethod; label: string; ground: boolean }[] = [
  { id: 'E', label: 'E — in free air / on a tray', ground: false },
  { id: 'C', label: 'C — clipped direct to a wall', ground: false },
  { id: 'B1', label: 'B1 — single cores in conduit / trunking on a wall', ground: false },
  { id: 'B2', label: 'B2 — multicore in conduit / trunking on a wall', ground: false },
  { id: 'A1', label: 'A1 — single cores in conduit in an insulated wall', ground: false },
  { id: 'A2', label: 'A2 — multicore in conduit in an insulated wall', ground: false },
  { id: 'D1', label: 'D1 — in ducts in the ground', ground: true },
  { id: 'D2', label: 'D2 — direct in the ground', ground: true }
];
export const methodOf = (f: Pick<Feeder, 'installMethod'>): InstallMethod => f.installMethod ?? 'E';
export const isBuried = (m: InstallMethod) => m === 'D1' || m === 'D2';

/** Built-in reference ratings for the methods other than E, by size (A). Empty until the IEC 60364-5-52
 * Annex B tables are added from a verified copy of the standard; without a value (here or in Cables.xlsx) a
 * circuit on that method has no rating and shows DATA REQUIRED — nothing is substituted. */
export const REFERENCE_METHOD_RATINGS: Partial<Record<Exclude<InstallMethod, 'E'>, Record<number, number>>> = {};

/** Where a cable size's values come from:
 * - reference: the app's built-in approximate values (or a Cables.xlsx row still holding them unchanged)
 * - user: a Cables.xlsx row edited without naming a manufacturer and reference document
 * - manufacturer: a Cables.xlsx row naming its manufacturer and reference document
 * - fallback: the size is missing from Cables.xlsx, so the built-in reference value was used. */
export type CableSource = 'reference' | 'user' | 'manufacturer' | 'fallback';
export const CABLE_SOURCE_TEXT: Record<CableSource, string> = {
  reference: 'app reference value (approximate, not manufacturer-verified)',
  user: 'user-entered in Cables.xlsx (no manufacturer / reference document given)',
  manufacturer: 'manufacturer data (Cables.xlsx)',
  fallback: 'not in Cables.xlsx; app reference value used instead (approximate)'
};

/** Built-in reference data; replaced by Cables.xlsx when that has rows. */
export const REFERENCE_CABLE_TABLE: CableSpec[] = [
  { csaMm2: 1.5, rOhmPerKm20C: 12.1, xOhmPerKm: 0.1, ampacityA: 26 },
  { csaMm2: 2.5, rOhmPerKm20C: 7.41, xOhmPerKm: 0.1, ampacityA: 36 },
  { csaMm2: 4, rOhmPerKm20C: 4.61, xOhmPerKm: 0.09, ampacityA: 47 },
  { csaMm2: 6, rOhmPerKm20C: 3.08, xOhmPerKm: 0.09, ampacityA: 60 },
  { csaMm2: 10, rOhmPerKm20C: 1.83, xOhmPerKm: 0.09, ampacityA: 80 },
  { csaMm2: 16, rOhmPerKm20C: 1.15, xOhmPerKm: 0.085, ampacityA: 105 },
  { csaMm2: 25, rOhmPerKm20C: 0.727, xOhmPerKm: 0.085, ampacityA: 138 },
  { csaMm2: 35, rOhmPerKm20C: 0.524, xOhmPerKm: 0.08, ampacityA: 168 },
  { csaMm2: 50, rOhmPerKm20C: 0.387, xOhmPerKm: 0.08, ampacityA: 200 },
  { csaMm2: 70, rOhmPerKm20C: 0.268, xOhmPerKm: 0.08, ampacityA: 253 },
  { csaMm2: 95, rOhmPerKm20C: 0.193, xOhmPerKm: 0.075, ampacityA: 306 },
  { csaMm2: 120, rOhmPerKm20C: 0.153, xOhmPerKm: 0.075, ampacityA: 354 },
  { csaMm2: 150, rOhmPerKm20C: 0.124, xOhmPerKm: 0.075, ampacityA: 393 },
  { csaMm2: 185, rOhmPerKm20C: 0.0991, xOhmPerKm: 0.07, ampacityA: 448 },
  { csaMm2: 240, rOhmPerKm20C: 0.0754, xOhmPerKm: 0.07, ampacityA: 528 },
  { csaMm2: 300, rOhmPerKm20C: 0.0601, xOhmPerKm: 0.07, ampacityA: 603 }
];

// Ambient temperature correction factors for 90°C (XLPE) cable, relative to
// 30°C ambient — typical values from IEC 60364-5-52 Table B.52.14.
const AMBIENT_POINTS: [number, number][] = [
  [25, 1.03], [30, 1.0], [35, 0.96], [40, 0.91], [45, 0.87],
  [50, 0.82], [55, 0.76], [60, 0.71], [65, 0.65], [70, 0.58]
];

/** Range the correction table covers. Outside it the factor is held at the
 * end value (no extrapolation): conservative below 25 °C, NOT conservative
 * above 70 °C — see ambientCheck. */
export const AMBIENT_RANGE_C = { min: AMBIENT_POINTS[0][0], max: AMBIENT_POINTS[AMBIENT_POINTS.length - 1][0] } as const;

/** Ambient correction factor, interpolated in the table. Not a number in →
 * NaN out (never a made-up 1.0), so a missing ambient fails every rating check. */
export function ambientCorrectionFactor(ambientC: number): number {
  if (!Number.isFinite(ambientC)) return NaN;
  const pts = AMBIENT_POINTS;
  if (ambientC <= pts[0][0]) return pts[0][1];
  if (ambientC >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t1, f1] = pts[i];
    const [t2, f2] = pts[i + 1];
    if (ambientC >= t1 && ambientC <= t2) {
      const frac = (ambientC - t1) / (t2 - t1);
      return f1 + frac * (f2 - f1);
    }
  }
  return NaN;
}

/** Whether an ambient temperature is inside the correction table, and what
 * using it means: 'bad' when the factor would be optimistic or there is no
 * number, 'warn' when it is held at the (conservative) 25 °C value. */
export function ambientCheck(ambientC: number): { status: 'ok' | 'warn' | 'bad'; problem?: string } {
  const { min, max } = AMBIENT_RANGE_C;
  if (!Number.isFinite(ambientC)) return { status: 'bad', problem: 'Design ambient temperature is not a number — cable ratings cannot be derated' };
  if (ambientC > max) return { status: 'bad', problem: `Design ambient ${ambientC} °C is above the ${max} °C the derating table covers — the ${max} °C factor would overstate the cable rating` };
  if (ambientC < min) return { status: 'warn', problem: `Design ambient ${ambientC} °C is below the ${min} °C the derating table covers — the ${min} °C factor is used (conservative)` };
  return { status: 'ok' };
}

let active: CableSpec[] = REFERENCE_CABLE_TABLE;

/** Cable data in use: the database's Cables.xlsx when it has valid rows,
 * otherwise the built-in reference table. Sorted by size. */
export function cables(): CableSpec[] {
  return active;
}

/** Sets the cable data (null = back to the built-in reference). */
export function setCables(rows: CableSpec[] | null): void {
  active = rows && rows.length ? [...rows].sort((a, b) => a.csaMm2 - b.csaMm2) : REFERENCE_CABLE_TABLE;
}
/** True when the calculations use the app's built-in reference cable values
 * (approximations — replace with manufacturer data via Cables.xlsx). */
export const usingReferenceCables = () => active === REFERENCE_CABLE_TABLE;
export const cablesSource = () => (usingReferenceCables() ? 'app reference values (approximate, not manufacturer data)' : 'Cables.xlsx (LV Database)');
/** Notice printed on outputs made with the reference values. */
export const REFERENCE_DATA_NOTICE = 'Cable data: app reference values (approximate, not manufacturer-verified). Replace them in Cables.xlsx before relying on these results.';

const sameValues = (a: CableSpec, b: CableSpec) => a.rOhmPerKm20C === b.rOhmPerKm20C && a.xOhmPerKm === b.xOhmPerKm && a.ampacityA === b.ampacityA;

/** A cable size's data and where it comes from; null when no data has the size. */
export function resolveCable(csaMm2: number): { spec: CableSpec; source: CableSource } | null {
  const ref = REFERENCE_CABLE_TABLE.find((c) => c.csaMm2 === csaMm2);
  if (usingReferenceCables()) return ref ? { spec: ref, source: 'reference' } : null;
  const db = active.find((c) => c.csaMm2 === csaMm2);
  if (!db) return ref ? { spec: ref, source: 'fallback' } : null;
  if (db.manufacturer?.trim() && db.referenceDoc?.trim()) return { spec: db, source: 'manufacturer' };
  return { spec: db, source: ref && sameValues(db, ref) ? 'reference' : 'user' };
}

export function getCable(csaMm2: number): CableSpec {
  // A project may use a size the database doesn't list; the reference value
  // is used for it rather than failing the whole calculation — resolveCable /
  // cableDataStatus report that it happened.
  const c = resolveCable(csaMm2);
  if (!c) throw new Error(`No cable data for ${csaMm2} mm²`);
  return c.spec;
}

/** The current rating of a size for an installation method (before derating), and where it comes from;
 * null when neither Cables.xlsx nor the built-in reference has one. Method E is the cable data's own rating. */
export function methodRating(csaMm2: number, method: InstallMethod): { a: number; source: CableSource } | null {
  const r = resolveCable(csaMm2);
  if (!r) return null;
  if (method === 'E') return { a: r.spec.ampacityA, source: r.source };
  const own = r.source === 'fallback' ? undefined : r.spec.methodRatings?.[method];
  if (own !== undefined && Number.isFinite(own) && own > 0) return { a: own, source: r.source === 'manufacturer' ? 'manufacturer' : usingReferenceCables() ? 'reference' : 'user' };
  const ref = REFERENCE_METHOD_RATINGS[method]?.[csaMm2];
  return ref ? { a: ref, source: usingReferenceCables() ? 'reference' : 'fallback' } : null;
}

/** Where the data for each cable size the project uses comes from (phase and
 * protective conductors), smallest size first. `missing`: sizes no data has. */
export function cableDataStatus(project: Pick<Project, 'feeders'>): { sizes: { csaMm2: number; source: CableSource }[]; missing: number[]; methods: { csaMm2: number; method: InstallMethod; source?: CableSource }[] } {
  const used = new Set<number>(), byMethod = new Map<string, { csaMm2: number; method: InstallMethod }>();
  for (const f of project.feeders) {
    used.add(f.cableCsaMm2); if (f.cpcMm2 !== undefined) used.add(f.cpcMm2);
    const m = methodOf(f); if (m !== 'E') byMethod.set(`${f.cableCsaMm2}|${m}`, { csaMm2: f.cableCsaMm2, method: m });
  }
  const sizes: { csaMm2: number; source: CableSource }[] = [], missing: number[] = [];
  for (const csa of [...used].sort((a, b) => a - b)) {
    const r = resolveCable(csa);
    if (r) sizes.push({ csaMm2: csa, source: r.source }); else missing.push(csa);
  }
  /** Ratings for the installation methods other than E, by size and method; no source = no rating. */
  const methods = [...byMethod.values()].sort((a, b) => a.csaMm2 - b.csaMm2 || a.method.localeCompare(b.method))
    .map((x) => ({ ...x, source: methodRating(x.csaMm2, x.method)?.source }));
  return { sizes, missing, methods };
}

/** One line for reports: which sizes (and installation-method ratings) are not manufacturer data, by source; '' when all are. */
export function cableDataNotice(project: Pick<Project, 'feeders'>): string {
  const { sizes, missing, methods } = cableDataStatus(project);
  const by = (s: CableSource) => [...sizes.filter((x) => x.source === s).map((x) => `${x.csaMm2}`), ...methods.filter((x) => x.source === s).map((x) => `${x.csaMm2} (${x.method})`)];
  const list = (xs: string[]) => `${xs.join(', ')} mm²`;
  const parts = (['reference', 'fallback', 'user'] as const).filter((s) => by(s).length).map((s) => `${list(by(s))}: ${CABLE_SOURCE_TEXT[s]}`);
  if (missing.length) parts.push(`${list(missing.map(String))}: no cable data`);
  const noRating = methods.filter((x) => !x.source);
  if (noRating.length) parts.push(`${list(noRating.map((x) => `${x.csaMm2} (${x.method})`))}: no rating for the installation method`);
  return parts.length ? `Cable data — ${parts.join('; ')}. Verify against the manufacturer's datasheet before relying on these results.` : '';
}

/** To-do findings about the cable data: a size taken from the reference table
 * because Cables.xlsx lacks it is always flagged; a circuit whose installation
 * method has no rating fails (DATA REQUIRED); with `strictCableData` (final
 * design) every size or method rating without manufacturer data must be fixed. */
export function cableDataFindings(project: Pick<Project, 'feeders' | 'strictCableData'>): { status: 'warn' | 'bad'; text: string }[] {
  const { sizes, missing, methods } = cableDataStatus(project);
  const strict = !!project.strictCableData;
  const out: { status: 'warn' | 'bad'; text: string }[] = [];
  const of = (s: CableSource) => [...sizes.filter((x) => x.source === s).map((x) => `${x.csaMm2}`), ...methods.filter((x) => x.source === s).map((x) => `${x.csaMm2} (${x.method})`)];
  if (missing.length) out.push({ status: 'bad', text: `Cable data: ${missing.join(', ')} mm² not in Cables.xlsx or the reference table` });
  const noRating = methods.filter((x) => !x.source).map((x) => `${x.csaMm2} mm² ${x.method}`);
  if (noRating.length) out.push({ status: 'bad', text: `Cable data required: no current rating for ${noRating.join(', ')} — add the installation-method rating in Cables.xlsx` });
  if (of('fallback').length) out.push({ status: strict ? 'bad' : 'warn', text: `Cable data: ${of('fallback').join(', ')} mm² missing from Cables.xlsx — approximate app reference values used` });
  if (strict) {
    const unverified = [...of('reference'), ...of('user')];
    if (unverified.length) out.push({ status: 'bad', text: `Cable data: ${unverified.join(', ')} mm² without manufacturer data (manufacturer and reference document in Cables.xlsx) — required for final design` });
  }
  return out;
}

/** Protective conductor size from IEC 60364-5-54 Table 54.2 (same material
 * as the line conductor): S ≤ 16 → S; 16 < S ≤ 35 → 16; S > 35 → S/2,
 * rounded up to the next standard size. */
export function defaultCpcMm2(phaseMm2: number): number {
  if (phaseMm2 <= 16) return phaseMm2;
  if (phaseMm2 <= 35) return 16;
  return cables().find((c) => c.csaMm2 >= phaseMm2 / 2)?.csaMm2 ?? phaseMm2;
}

export const cpcOf = (f: Feeder) => f.cpcMm2 ?? defaultCpcMm2(f.cableCsaMm2);
