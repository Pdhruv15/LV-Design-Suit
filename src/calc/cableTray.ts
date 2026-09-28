import { cpcOf } from './cableTable';
import { cableTypeOf } from '../model/cableTypes';
import { brandOf, DEFAULT_CABLE_BRAND, typicalKgPerM } from '../data/cableBrands';
import type { CableOd, Feeder, Project, TrayCable, TrayPlan, TrayRoute, TraySettings, TraySpacing } from '../types';

/** Cable tray sizing, route by route.
 *
 * Which cables are on a route: every SLD cable whose route path (the
 * feeder's trayRoute, e.g. "A-B-C") names the route, plus the route's
 * manual cables. A cable is entered once with its path and appears on
 * every route along it.
 *
 * Spacing method (single layer, the usual one for power cables): cables
 * side by side, largest first, with a clearance between neighbours of a
 * fraction of the larger cable's diameter (or a fixed mm).
 *   width = Σ D + Σ clearances,  required = width × (1 + spare %)
 * Fill method (bunched / several layers): cable area against the tray's
 * usable area.
 *   required width = Σ πD²/4 × (1 + spare %) / (fill % × depth)
 * The next standard width is chosen; wider than the maximum → more tiers.
 *
 * Grouping: the number of loaded cables per tier, touching or spaced, and
 * the tiers give the grouping factor (IEC 60364-5-52 Table B.52.20 for
 * trays, B.52.17 for bunched cables), applied to the cables' ratings. */

export const TRAY_WIDTHS = [50, 75, 100, 150, 200, 300, 400, 450, 500, 600, 750, 900];
export const TRAY_DEPTHS = [25, 50, 75, 100, 150];

export const TRAY_DEFAULTS: Required<TraySettings> = {
  method: 'spacing',
  spacing: 'one',
  spacingMm: 25,
  sparePct: 25,
  fillPct: 40,
  depthMm: 50,
  widths: TRAY_WIDTHS,
  maxWidthMm: 600,
  includeEcc: false,
  trayType: 'Perforated tray (HDG)',
  kind: 'perforated',
  applyGrouping: true,
  supportSpacingM: 1.5,
  lengthM: 3,
  covers: false
};

export const SPACING_LABEL: Record<TraySpacing, string> = {
  touching: 'Touching',
  quarter: '¼ D',
  half: '½ D',
  one: '1 D',
  two: '2 D',
  mm: 'Fixed mm'
};

const SPACING_FACTOR: Record<Exclude<TraySpacing, 'mm'>, number> = { touching: 0, quarter: 0.25, half: 0.5, one: 1, two: 2 };

/** Cable data in use when a project has none of its own: DUCAB. */
export const DEFAULT_CABLE_ODS: CableOd[] = brandOf(DEFAULT_CABLE_BRAND).ods;

export const emptyTrayPlan = (): TrayPlan => ({ routes: [], settings: { ...TRAY_DEFAULTS } });
/** The plan's cable data: its own edited table, else its brand (DUCAB by default). */
export const odsOf = (plan: TrayPlan) => plan.ods ?? brandOf(plan.brand).ods;
/** What the cable data is, for notes on the exports. */
export const odsSource = (plan: TrayPlan) => (plan.ods ? `project cable data (edited from ${brandOf(plan.brand).name})` : brandOf(plan.brand).note);

/** The project's tray plan with every setting filled in (older projects
 * miss the newer settings). */
export function trayPlanOf(project: Project): TrayPlan & { settings: Required<TraySettings> } {
  const p = project.trays ?? emptyTrayPlan();
  return { ...p, settings: { ...TRAY_DEFAULTS, ...p.settings } };
}

/** Minimum bending radius when the cable data doesn't give one: 8 × D
 * (armoured XLPE, typical — DUCAB's own figures are ≈ 8 × D). */
export const BEND_FACTOR = 8;

/** Diameter, weight and bending radius of cores × size: the table's row, or
 * the nearest bigger size (a size missing from the table is never
 * under-sized). */
export function lookupOd(ods: CableOd[], cores: number, csaMm2: number): { odMm: number; kgPerM: number; bendMm: number; bendEstimated: boolean; found: boolean } {
  const rows = ods.filter((o) => o.cores === cores && o.odMm > 0).sort((a, b) => a.csaMm2 - b.csaMm2);
  const exact = rows.find((o) => o.csaMm2 === csaMm2);
  const row = exact ?? rows.find((o) => o.csaMm2 > csaMm2) ?? rows[rows.length - 1];
  if (!row) return { odMm: 0, kgPerM: 0, bendMm: 0, bendEstimated: true, found: false };
  const kg = row.kgPerM || typicalKgPerM(cores, row.csaMm2);
  return { odMm: row.odMm, kgPerM: kg, bendMm: row.bendMm ?? Math.round(row.odMm * BEND_FACTOR), bendEstimated: row.bendMm === undefined, found: !!exact };
}

// ---- Route paths -----------------------------------------------------------

/** Route names in a path: "A-B-C", "A, B, C", "A > B > C" → ['A', 'B', 'C']. */
export function routeNames(path: string | undefined): string[] {
  if (!path) return [];
  const out: string[] = [];
  for (const n of path.split(/[\s,;/>→–-]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)) if (!out.includes(n)) out.push(n);
  return out;
}
export const joinPath = (names: string[]) => names.join('-');
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Cables that go on trays: SLD feeders, without the final circuits of the
 * load schedules (wired in conduit) unless asked for. */
export const trayFeeders = (project: Project, withFinalCircuits = false) => project.feeders.filter((f) => withFinalCircuits || !f.phase);

export function onRoute(route: TrayRoute, f: Feeder): boolean {
  return routeNames(f.trayRoute).some((n) => same(n, route.name)) || route.cables.some((c) => c.feederId === f.id);
}

/** Cables of a panel that go on trays. */
export function panelCables(project: Project, boardId: string, withFinalCircuits = false): Feeder[] {
  return trayFeeders(project, withFinalCircuits).filter((f) => f.boardId === boardId);
}

/** Puts feeders on a route: the route is added to the end of each one's path. */
export function addFeedersToRoute(project: Project, routeName: string, ids: string[]): { project: Project; added: number } {
  let added = 0;
  const feeders = project.feeders.map((f) => {
    if (!ids.includes(f.id)) return f;
    const names = routeNames(f.trayRoute);
    if (names.some((n) => same(n, routeName))) return f;
    added++;
    return { ...f, trayRoute: joinPath([...names, routeName.toUpperCase()]) };
  });
  return { project: added ? { ...project, feeders } : project, added };
}

/** Takes a feeder off a route (its path and the route's override). */
export function removeFeederFromRoute(project: Project, routeId: string, feederId: string): Project {
  const plan = trayPlanOf(project);
  const route = plan.routes.find((r) => r.id === routeId);
  if (!route) return project;
  return {
    ...project,
    feeders: project.feeders.map((f) => (f.id === feederId ? { ...f, trayRoute: joinPath(routeNames(f.trayRoute).filter((n) => !same(n, route.name))) || undefined } : f)),
    trays: { ...plan, routes: plan.routes.map((r) => (r.id === routeId ? { ...r, cables: r.cables.filter((c) => c.feederId !== feederId) } : r)) }
  };
}

/** Renames a route and every path that names it. */
export function renameRoute(project: Project, routeId: string, name: string): Project {
  const plan = trayPlanOf(project);
  const route = plan.routes.find((r) => r.id === routeId);
  const next = name.trim().toUpperCase().replace(/[\s,;/>→–-]+/g, ''); // separators belong to paths
  if (!route || !next || same(route.name, next) || plan.routes.some((r) => r.id !== routeId && same(r.name, next))) return project;
  return {
    ...project,
    feeders: project.feeders.map((f) => (routeNames(f.trayRoute).some((n) => same(n, route.name)) ? { ...f, trayRoute: joinPath(routeNames(f.trayRoute).map((n) => (same(n, route.name) ? next : n))) } : f)),
    trays: { ...plan, routes: plan.routes.map((r) => (r.id === routeId ? { ...r, name: next } : r)) }
  };
}

/** Removes a route, and its name from every path. */
export function deleteRoute(project: Project, routeId: string): Project {
  const plan = trayPlanOf(project);
  const route = plan.routes.find((r) => r.id === routeId);
  if (!route) return project;
  return {
    ...project,
    feeders: project.feeders.map((f) => (routeNames(f.trayRoute).some((n) => same(n, route.name)) ? { ...f, trayRoute: joinPath(routeNames(f.trayRoute).filter((n) => !same(n, route.name))) || undefined } : f)),
    trays: { ...plan, routes: plan.routes.filter((r) => r.id !== routeId) }
  };
}

/** Creates the routes that paths name but that don't exist yet. */
export function ensureRoutes(project: Project): { project: Project; created: string[] } {
  const plan = trayPlanOf(project);
  const created: string[] = [];
  for (const f of project.feeders) {
    for (const n of routeNames(f.trayRoute)) {
      if (!plan.routes.some((r) => same(r.name, n)) && !created.includes(n)) created.push(n);
    }
  }
  if (!created.length) return { project, created };
  const routes = [...plan.routes, ...created.map((name) => ({ id: newTrayId('r'), name, cables: [] }))];
  return { project: { ...project, trays: { ...plan, routes } }, created };
}

/** Tray cables that are on no route. */
export function unroutedFeeders(project: Project, withFinalCircuits = false): Feeder[] {
  const plan = trayPlanOf(project);
  return trayFeeders(project, withFinalCircuits).filter((f) => !plan.routes.some((r) => onRoute(r, f)));
}

// ---- Cable lines -----------------------------------------------------------

/** One line of a route's cable list, as drawn in the schedule. */
export interface TrayLine {
  id: string;
  /** The route's TrayCable entry (manual cable or feeder override), if any. */
  cableId?: string;
  feederId?: string;
  from: string;
  to: string;
  description: string; // "4C × 240 mm²", "1C × 120 mm² ECC"
  cores: number;
  csaMm2: number;
  qty: number;
  odMm: number;
  kgPerM: number;
  bendMm: number; // minimum bending radius
  bendEstimated: boolean; // 8 × D (the cable data doesn't give it)
  ecc: boolean;
  fireRated?: boolean; // fire-rated cable (segregated from the others)
  path?: string; // the feeder's whole route path
  missing?: string; // why the line can't be sized
  unknownSize?: boolean; // diameter from the next size up
}

const runsOf = (f: Feeder) => Math.max(1, f.parallel ?? 1);

/** A route's cables: SLD feeders on it (in design order), then its manual
 * cables; ECCs added when the plan asks for them. */
export function trayLines(project: Project, plan: TrayPlan, route: TrayRoute): TrayLine[] {
  const ods = odsOf(plan);
  const out: TrayLine[] = [];
  const line = (c: TrayCable | undefined, f: Feeder | undefined) => {
    const cores = f ? f.cores : c?.cores ?? 4;
    const csa = f ? f.cableCsaMm2 : c?.csaMm2 ?? 0;
    const qty = c?.qty ?? (f ? runsOf(f) : 1);
    const from = c?.from ?? f?.boardId ?? '';
    const to = c?.to ?? (f ? f.feedsBoardId ?? f.name : '');
    const d = lookupOd(ods, cores, csa);
    const id = c?.id ?? `f:${f!.id}`;
    out.push({
      id, cableId: c?.id, feederId: f?.id, from, to,
      description: `${cores}C × ${csa} mm²${f ? ` ${cableTypeOf(project, f).code}` : ''}`,
      fireRated: f ? !!cableTypeOf(project, f).fireRated : undefined,
      cores, csaMm2: csa, qty,
      odMm: c?.odMm ?? d.odMm,
      kgPerM: c?.kgPerM ?? d.kgPerM,
      bendMm: c?.odMm ? Math.max(d.bendMm, Math.round(c.odMm * BEND_FACTOR)) : d.bendMm,
      bendEstimated: d.bendEstimated,
      ecc: false,
      path: f?.trayRoute,
      missing: csa > 0 ? undefined : 'enter the cable size',
      unknownSize: !c?.odMm && csa > 0 && !d.found
    });
    if (f && plan.settings.includeEcc) {
      const e = cpcOf(f);
      const de = lookupOd(ods, 1, e);
      out.push({ id: `${id}:ecc`, cableId: c?.id, feederId: f.id, from, to, description: `1C × ${e} mm² ECC`, cores: 1, csaMm2: e, qty, odMm: de.odMm, kgPerM: de.kgPerM, bendMm: de.bendMm, bendEstimated: de.bendEstimated, ecc: true, unknownSize: !de.found });
    }
  };
  for (const f of project.feeders) if (onRoute(route, f)) line(route.cables.find((c) => c.feederId === f.id), f);
  for (const c of route.cables) {
    if (!c.feederId) line(c, undefined);
    else if (!project.feeders.some((f) => f.id === c.feederId)) {
      out.push({ id: c.id, cableId: c.id, feederId: c.feederId, from: c.from ?? '', to: c.to ?? '', description: `${c.feederId} (deleted from the design)`, cores: 0, csaMm2: 0, qty: 0, odMm: 0, kgPerM: 0, bendMm: 0, bendEstimated: false, ecc: false, missing: 'not in the design any more' });
    }
  }
  return out;
}

/** A route's settings: its own, else the plan defaults. */
export function routeSettings(plan: TrayPlan, r: TrayRoute) {
  const s = plan.settings;
  return {
    method: r.method ?? s.method,
    spacing: r.spacing ?? s.spacing,
    spacingMm: r.spacingMm ?? s.spacingMm,
    sparePct: r.sparePct ?? s.sparePct,
    fillPct: r.fillPct ?? s.fillPct,
    depthMm: r.depthMm ?? s.depthMm
  };
}

// ---- Grouping factors ------------------------------------------------------

// IEC 60364-5-52 Table B.52.20, multicore cables on trays (method E), rows
// = 1, 2, 3 tiers, columns = 1, 2, 3, 4, 6, 9 cables per tier. Typical
// published values; spaced = clearance ≥ one cable diameter.
const GROUP_N = [1, 2, 3, 4, 6, 9];
const GROUP_TABLE = {
  perforated: {
    touching: [[1, 0.88, 0.82, 0.79, 0.76, 0.73], [1, 0.87, 0.8, 0.77, 0.73, 0.68], [1, 0.86, 0.79, 0.76, 0.71, 0.66]],
    spaced: [[1, 1, 0.98, 0.95, 0.91, 0.91], [1, 0.99, 0.96, 0.92, 0.87, 0.87], [1, 0.98, 0.95, 0.91, 0.85, 0.85]]
  },
  ladder: {
    touching: [[1, 0.87, 0.82, 0.8, 0.79, 0.78], [1, 0.86, 0.8, 0.78, 0.76, 0.73], [1, 0.85, 0.79, 0.76, 0.73, 0.7]],
    spaced: [[1, 1, 1, 1, 1, 1], [1, 0.99, 0.98, 0.97, 0.96, 0.96], [1, 0.98, 0.97, 0.96, 0.93, 0.93]]
  }
};
// IEC 60364-5-52 Table B.52.17 item 1: bunched in air / on a surface.
const BUNCHED: [number, number][] = [[1, 1], [2, 0.8], [3, 0.7], [4, 0.65], [5, 0.6], [6, 0.57], [7, 0.54], [8, 0.52], [9, 0.5], [12, 0.45], [16, 0.41], [20, 0.38]];

export type GroupArrangement = 'touching' | 'spaced' | 'bunched';

/** Grouping factor for n loaded cables per tier. Between table columns the
 * next larger number is used (the lower factor); beyond the table, its
 * last value. */
export function groupingFactor(kind: 'perforated' | 'ladder', arrangement: GroupArrangement, perTier: number, tiers: number): number {
  if (perTier <= 1 && tiers <= 1) return 1;
  if (arrangement === 'bunched') {
    const n = perTier * Math.max(1, tiers);
    return (BUNCHED.find(([k]) => k >= n) ?? BUNCHED[BUNCHED.length - 1])[1];
  }
  const row = GROUP_TABLE[kind][arrangement][Math.min(3, Math.max(1, tiers)) - 1];
  const i = GROUP_N.findIndex((k) => k >= perTier);
  return row[i < 0 ? row.length - 1 : i];
}

// ---- Sizing ----------------------------------------------------------------

export interface TrayResult {
  route: TrayRoute;
  lines: TrayLine[];
  cableCount: number;
  panels: string[]; // panels the cables come from
  sumOdMm: number;
  clearanceMm: number;
  cableAreaMm2: number;
  /** Width the cables take (spacing) or need at the fill limit (fill), before spare. */
  occupiedMm: number;
  requiredMm: number; // with spare
  autoWidthMm: number;
  autoTiers: number;
  widthMm: number; // selected (auto or chosen)
  tiers: number;
  depthMm: number;
  manual: boolean;
  /** Spare left in the selected tray, % of what the cables need. */
  sparePctActual: number;
  fillPctActual: number; // cable area / tray area (all tiers)
  kgPerM: number; // cable weight on the route (all tiers)
  /** Largest minimum bending radius of the cables: bends and tees need at least this. */
  bendMm: number;
  bendEstimated: boolean;
  /** Loaded cables per tier (ECCs don't count) and the grouping factor. */
  loadedPerTier: number;
  arrangement: GroupArrangement;
  groupFactor: number;
  /** Every cable, largest first — the laying order of the cross-section. */
  laid: { lineId: string; odMm: number; n: number }[];
  status: 'ok' | 'warn' | 'bad';
  notes: string[];
}

/** Next standard width ≥ need, splitting into tiers above the max width. */
export function pickTray(needMm: number, widths: number[], maxWidthMm: number): { widthMm: number; tiers: number } {
  const ws = [...widths].sort((a, b) => a - b);
  const allowed = ws.filter((w) => w <= maxWidthMm);
  const list = allowed.length ? allowed : ws;
  if (needMm <= 0) return { widthMm: list[0] ?? 0, tiers: 1 };
  for (let tiers = 1; tiers <= 10; tiers++) {
    const w = list.find((x) => x >= needMm / tiers - 1e-9);
    if (w) return { widthMm: w, tiers };
  }
  return { widthMm: list[list.length - 1], tiers: Math.ceil(needMm / list[list.length - 1]) };
}

export function sizeRoute(project: Project, planIn: TrayPlan, route: TrayRoute): TrayResult {
  const plan = { ...planIn, settings: { ...TRAY_DEFAULTS, ...planIn.settings } };
  const s = routeSettings(plan, route);
  const lines = trayLines(project, plan, route);
  const notes: string[] = [];
  // Every cable, largest first (the usual laying order), numbered by line.
  const ok = lines.filter((l) => !l.missing);
  const laid = ok
    .flatMap((l) => Array.from({ length: l.qty }, () => ({ lineId: l.id, odMm: l.odMm, n: lines.indexOf(l) })))
    .sort((a, b) => b.odMm - a.odMm);
  const ds = laid.map((c) => c.odMm);
  const sumOd = ds.reduce((a, b) => a + b, 0);
  const sp = s.spacing;
  const clearance = sp === 'mm'
    ? Math.max(0, ds.length - 1) * s.spacingMm
    : ds.slice(0, -1).reduce((a, d) => a + d * SPACING_FACTOR[sp], 0);
  const area = ds.reduce((a, d) => a + (Math.PI * d * d) / 4, 0);
  const occupied = s.method === 'fill' ? (s.depthMm > 0 && s.fillPct > 0 ? area / ((s.fillPct / 100) * s.depthMm) : 0) : sumOd + clearance;
  const required = occupied * (1 + s.sparePct / 100);
  const auto = pickTray(required, plan.settings.widths, plan.settings.maxWidthMm);
  const manual = route.widthMm !== undefined || route.tiers !== undefined;
  const widthMm = route.widthMm ?? auto.widthMm;
  const tiers = route.tiers ?? (route.widthMm !== undefined ? Math.max(1, Math.ceil(required / route.widthMm - 1e-9)) : auto.tiers);
  const total = widthMm * tiers;
  const spareActual = occupied > 0 ? (total / occupied - 1) * 100 : 100;
  const fillActual = total * s.depthMm > 0 ? (area / (total * s.depthMm)) * 100 : 0;
  const kg = ok.reduce((a, l) => a + l.qty * l.kgPerM, 0);
  const bendLine = ok.reduce<TrayLine | undefined>((m, l) => (!m || l.bendMm > m.bendMm ? l : m), undefined);

  const loaded = ok.filter((l) => !l.ecc).reduce((a, l) => a + l.qty, 0);
  const loadedPerTier = Math.ceil(loaded / Math.max(1, tiers));
  const maxOd = ds[0] ?? 0;
  const arrangement: GroupArrangement = s.method === 'fill'
    ? 'bunched'
    : (sp === 'mm' ? s.spacingMm >= maxOd : SPACING_FACTOR[sp] >= 1) ? 'spaced' : 'touching';
  const groupFactor = groupingFactor(plan.settings.kind, arrangement, loadedPerTier, tiers);

  let status: TrayResult['status'] = 'ok';
  if (total < occupied - 1e-6) { status = 'bad'; notes.push('The cables do not fit the selected tray'); }
  else if (total < required - 1e-6) { status = 'warn'; notes.push(`Spare ${spareActual.toFixed(0)} % — less than ${s.sparePct} %`); }
  if (s.method === 'spacing' && fillActual > 50) notes.push(`Fill ${fillActual.toFixed(0)} % of the tray depth`);
  const missing = lines.filter((l) => l.missing);
  if (missing.length) { notes.push(`${missing.length} cable${missing.length === 1 ? '' : 's'} without a size`); if (status === 'ok') status = 'warn'; }
  if (lines.some((l) => l.unknownSize)) notes.push('Some sizes are not in the cable data — the next size up is used');
  if (tiers > 1) notes.push(`${tiers} tiers of ${widthMm} mm`);
  if (ok.some((l) => l.fireRated) && ok.some((l) => !l.fireRated && !l.ecc)) {
    notes.push('Fire-rated and other cables share this route — segregate them (separate tray or a divider)');
    if (status === 'ok') status = 'warn';
  }
  if (tiers > 3 && arrangement !== 'bunched') notes.push('Grouping for more than 3 tiers taken as 3 tiers');

  return {
    route, lines,
    cableCount: ds.length,
    panels: [...new Set(lines.map((l) => l.from).filter(Boolean))],
    sumOdMm: sumOd, clearanceMm: clearance, cableAreaMm2: area,
    occupiedMm: occupied, requiredMm: required,
    autoWidthMm: auto.widthMm, autoTiers: auto.tiers,
    widthMm, tiers, depthMm: s.depthMm, manual,
    sparePctActual: spareActual, fillPctActual: fillActual,
    kgPerM: kg, bendMm: bendLine?.bendMm ?? 0, bendEstimated: bendLine?.bendEstimated ?? false, loadedPerTier, arrangement, groupFactor, laid, status, notes
  };
}

export const sizeAll = (project: Project, plan: TrayPlan) => plan.routes.map((r) => sizeRoute(project, plan, r));

/** Worst grouping factor of each SLD cable over the routes it runs on.
 * Cached per project object (the calculations call it per feeder). */
const groupingCache = new WeakMap<Project, Map<string, { factor: number; route: string }>>();
export function trayGrouping(project: Project): Map<string, { factor: number; route: string }> {
  const hit = groupingCache.get(project);
  if (hit) return hit;
  const out = new Map<string, { factor: number; route: string }>();
  const plan = trayPlanOf(project);
  if (plan.settings.applyGrouping && plan.routes.length) {
    for (const r of sizeAll(project, plan)) {
      for (const l of r.lines) {
        if (!l.feederId || l.ecc || l.missing) continue;
        const cur = out.get(l.feederId);
        if (!cur || r.groupFactor < cur.factor) out.set(l.feederId, { factor: r.groupFactor, route: r.route.name });
      }
    }
  }
  groupingCache.set(project, out);
  return out;
}

// ---- Quantities ------------------------------------------------------------

export interface TrayQuantity {
  size: string;
  widthMm: number;
  depthMm: number;
  lengthM: number; // all tiers
  bends: number;
  tees: number;
  reducers: number;
  risers: number;
  supports: number;
  couplers: number; // joint (coupler) sets
  coverM: number;
  bendRadiusMm: number; // minimum inside radius of the bends and tees (largest cable)
  routes: string[];
}

/** Tray BOQ: metres and fittings of each size (tiers counted). Supports at
 * the support spacing (both ends included), a coupler set at each joint of
 * the standard tray lengths. */
export function trayQuantities(results: TrayResult[], settings: Partial<TraySettings> = {}): TrayQuantity[] {
  const s = { ...TRAY_DEFAULTS, ...settings };
  const m = new Map<string, TrayQuantity>();
  for (const r of results) {
    if (!r.cableCount) continue;
    const size = `${r.widthMm} × ${r.depthMm}`;
    const q = m.get(size) ?? { size, widthMm: r.widthMm, depthMm: r.depthMm, lengthM: 0, bends: 0, tees: 0, reducers: 0, risers: 0, supports: 0, couplers: 0, coverM: 0, bendRadiusMm: 0, routes: [] };
    q.bendRadiusMm = Math.max(q.bendRadiusMm, r.bendMm);
    const len = r.route.lengthM ?? 0;
    const t = r.tiers;
    const fit = r.route.fittings ?? {};
    q.lengthM += len * t;
    q.bends += (fit.bends ?? 0) * t;
    q.tees += (fit.tees ?? 0) * t;
    q.reducers += (fit.reducers ?? 0) * t;
    q.risers += (fit.risers ?? 0) * t;
    if (len > 0) {
      q.supports += (Math.ceil(len / s.supportSpacingM) + 1) * t;
      q.couplers += Math.max(0, Math.ceil(len / s.lengthM) - 1) * t;
    }
    if (s.covers) q.coverM += len * t;
    q.routes.push(r.route.name);
    m.set(size, q);
  }
  return [...m.values()].sort((a, b) => a.widthMm - b.widthMm || a.depthMm - b.depthMm);
}

/** Next route name: A, B … Z, AA, AB … */
export function nextRouteName(plan: TrayPlan): string {
  const used = new Set(plan.routes.map((r) => r.name.toUpperCase()));
  for (let i = 0; ; i++) {
    let n = i, s = '';
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    if (!used.has(s)) return s;
  }
}

let seq = 0;
export const newTrayId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
