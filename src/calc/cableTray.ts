import { cpcOf } from './earthing';
import type { CableOd, Feeder, Project, TrayCable, TrayPlan, TrayRoute, TraySettings, TraySpacing } from '../types';

/** Cable tray sizing, route by route.
 *
 * Spacing method (single layer, the usual one for power cables): cables
 * side by side, largest first, with a clearance between neighbours of a
 * fraction of the larger cable's diameter (or a fixed mm).
 *   width = Σ D + Σ clearances,  required = width × (1 + spare %)
 * Fill method (bunched / several layers): cable area against the tray's
 * usable area.
 *   required width = Σ πD²/4 × (1 + spare %) / (fill % × depth)
 * The next standard width is chosen; wider than the maximum → more tiers. */

export const TRAY_WIDTHS = [50, 75, 100, 150, 200, 300, 400, 450, 500, 600, 750, 900];
export const TRAY_DEPTHS = [25, 50, 75, 100, 150];

export const TRAY_DEFAULTS: TraySettings = {
  method: 'spacing',
  spacing: 'one',
  spacingMm: 25,
  sparePct: 25,
  fillPct: 40,
  depthMm: 50,
  widths: TRAY_WIDTHS,
  maxWidthMm: 600,
  includeEcc: false,
  trayType: 'Perforated tray (HDG)'
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

// Rough overall diameters (mm) and weights (kg/m) of 0.6/1 kV Cu XLPE/PVC/SWA/PVC
// multicore cable (BS 5467 type, typical catalogue figures), and 1C PVC earth
// cable. PLACEHOLDER — replace with your manufacturer's data.
const SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400];
const OD4 = [13.0, 14.4, 16.5, 17.9, 20.6, 22.8, 26.9, 29.4, 32.0, 36.5, 41.5, 45.3, 50.1, 55.8, 62.9, 68.8, 77.6];
const KG4 = [0.4, 0.5, 0.65, 0.8, 1.1, 1.4, 2.0, 2.5, 3.0, 4.1, 5.4, 6.6, 8.1, 10.0, 12.9, 15.9, 20.1];
const OD1 = [3.3, 3.9, 4.4, 5.0, 6.3, 7.3, 9.0, 10.2, 11.9, 13.7, 15.8, 17.5, 19.5, 21.8, 24.8, 27.6, 31.4];
const KG1 = [0.02, 0.03, 0.05, 0.07, 0.11, 0.17, 0.26, 0.36, 0.49, 0.69, 0.94, 1.18, 1.46, 1.83, 2.37, 2.96, 3.9];
const r1 = (v: number) => Math.round(v * 10) / 10;

export const DEFAULT_CABLE_ODS: CableOd[] = [
  ...SIZES.map((csaMm2, i) => ({ cores: 1, csaMm2, odMm: OD1[i], kgPerM: KG1[i] })),
  ...SIZES.map((csaMm2, i) => ({ cores: 2, csaMm2, odMm: r1(OD4[i] * 0.86), kgPerM: r1(KG4[i] * 0.62) })),
  ...SIZES.map((csaMm2, i) => ({ cores: 3, csaMm2, odMm: r1(OD4[i] * 0.93), kgPerM: r1(KG4[i] * 0.8) })),
  ...SIZES.map((csaMm2, i) => ({ cores: 4, csaMm2, odMm: OD4[i], kgPerM: KG4[i] }))
];

export const emptyTrayPlan = (): TrayPlan => ({ routes: [], settings: { ...TRAY_DEFAULTS } });
export const odsOf = (plan: TrayPlan) => plan.ods ?? DEFAULT_CABLE_ODS;

/** Diameter and weight of cores × size: the table's row, or the nearest
 * bigger size (a size missing from the table is never under-sized). */
export function lookupOd(ods: CableOd[], cores: number, csaMm2: number): { odMm: number; kgPerM: number; found: boolean } {
  const rows = ods.filter((o) => o.cores === cores && o.odMm > 0).sort((a, b) => a.csaMm2 - b.csaMm2);
  const exact = rows.find((o) => o.csaMm2 === csaMm2);
  if (exact) return { ...exact, found: true };
  const up = rows.find((o) => o.csaMm2 > csaMm2) ?? rows[rows.length - 1];
  return up ? { odMm: up.odMm, kgPerM: up.kgPerM, found: false } : { odMm: 0, kgPerM: 0, found: false };
}

/** One line of a route's cable list, as drawn in the schedule. */
export interface TrayLine {
  id: string; // TrayCable id (ECC lines: id + ':ecc')
  cableId: string;
  feederId?: string;
  from: string;
  to: string;
  description: string; // "4C × 240 mm²", "1C × 120 mm² ECC"
  cores: number;
  csaMm2: number;
  qty: number;
  odMm: number;
  kgPerM: number;
  ecc: boolean;
  missing?: string; // why the line can't be sized
  unknownSize?: boolean; // diameter from the next size up
}

const runsOf = (f: Feeder) => Math.max(1, f.parallel ?? 1);

/** A route's cables, with feeders read from the design and ECCs added. */
export function trayLines(project: Project, plan: TrayPlan, route: TrayRoute): TrayLine[] {
  const ods = odsOf(plan);
  const out: TrayLine[] = [];
  for (const c of route.cables) {
    const f = c.feederId ? project.feeders.find((x) => x.id === c.feederId) : undefined;
    if (c.feederId && !f) {
      out.push({ id: c.id, cableId: c.id, feederId: c.feederId, from: c.from ?? '', to: c.to ?? '', description: `${c.feederId} (deleted from the design)`, cores: 0, csaMm2: 0, qty: 0, odMm: 0, kgPerM: 0, ecc: false, missing: 'not in the design any more' });
      continue;
    }
    const cores = f ? f.cores : c.cores ?? 4;
    const csa = f ? f.cableCsaMm2 : c.csaMm2 ?? 0;
    const qty = c.qty ?? (f ? runsOf(f) : 1);
    const from = c.from ?? f?.boardId ?? '';
    const to = c.to ?? (f ? f.feedsBoardId ?? f.name : '');
    const d = lookupOd(ods, cores, csa);
    out.push({
      id: c.id, cableId: c.id, feederId: f?.id, from, to,
      description: `${cores}C × ${csa} mm²`,
      cores, csaMm2: csa, qty,
      odMm: c.odMm ?? d.odMm,
      kgPerM: c.kgPerM ?? d.kgPerM,
      ecc: false,
      missing: csa > 0 ? undefined : 'enter the cable size',
      unknownSize: !c.odMm && csa > 0 && !d.found
    });
    if (f && plan.settings.includeEcc) {
      const e = cpcOf(f);
      const de = lookupOd(ods, 1, e);
      out.push({ id: `${c.id}:ecc`, cableId: c.id, feederId: f.id, from, to, description: `1C × ${e} mm² ECC`, cores: 1, csaMm2: e, qty, odMm: de.odMm, kgPerM: de.kgPerM, ecc: true, unknownSize: !de.found });
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

export function sizeRoute(project: Project, plan: TrayPlan, route: TrayRoute): TrayResult {
  const s = routeSettings(plan, route);
  const lines = trayLines(project, plan, route);
  const notes: string[] = [];
  // Every cable, largest first (the usual laying order).
  const ds = lines.filter((l) => !l.missing).flatMap((l) => Array<number>(l.qty).fill(l.odMm)).sort((a, b) => b - a);
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
  const kg = lines.filter((l) => !l.missing).reduce((a, l) => a + l.qty * l.kgPerM, 0);

  let status: TrayResult['status'] = 'ok';
  if (total < occupied - 1e-6) { status = 'bad'; notes.push('The cables do not fit the selected tray'); }
  else if (total < required - 1e-6) { status = 'warn'; notes.push(`Spare ${spareActual.toFixed(0)} % — less than ${s.sparePct} %`); }
  if (s.method === 'spacing' && fillActual > 50) notes.push(`Fill ${fillActual.toFixed(0)} % of the tray depth`);
  const missing = lines.filter((l) => l.missing);
  if (missing.length) { notes.push(`${missing.length} cable${missing.length === 1 ? '' : 's'} without a size`); if (status === 'ok') status = 'warn'; }
  if (lines.some((l) => l.unknownSize)) notes.push('Some sizes are not in the cable data — the next size up is used');
  if (tiers > 1) notes.push(`${tiers} tiers of ${widthMm} mm`);

  return {
    route, lines,
    cableCount: ds.length,
    panels: [...new Set(lines.map((l) => l.from).filter(Boolean))],
    sumOdMm: sumOd, clearanceMm: clearance, cableAreaMm2: area,
    occupiedMm: occupied, requiredMm: required,
    autoWidthMm: auto.widthMm, autoTiers: auto.tiers,
    widthMm, tiers, depthMm: s.depthMm, manual,
    sparePctActual: spareActual, fillPctActual: fillActual,
    kgPerM: kg, status, notes
  };
}

export const sizeAll = (project: Project, plan: TrayPlan) => plan.routes.map((r) => sizeRoute(project, plan, r));

/** Tray quantities for the BOQ: metres of each size (tiers counted). */
export function trayQuantities(results: TrayResult[]): { size: string; widthMm: number; depthMm: number; lengthM: number; routes: string[] }[] {
  const m = new Map<string, { size: string; widthMm: number; depthMm: number; lengthM: number; routes: string[] }>();
  for (const r of results) {
    if (!r.cableCount) continue;
    const size = `${r.widthMm} × ${r.depthMm}`;
    const q = m.get(size) ?? { size, widthMm: r.widthMm, depthMm: r.depthMm, lengthM: 0, routes: [] };
    q.lengthM += (r.route.lengthM ?? 0) * r.tiers;
    q.routes.push(r.route.name);
    m.set(size, q);
  }
  return [...m.values()].sort((a, b) => a.widthMm - b.widthMm || a.depthMm - b.depthMm);
}

/** Next route name: A, B … Z, AA, AB … */
export function nextRouteName(plan: TrayPlan): string {
  const used = new Set(plan.routes.map((r) => r.name));
  for (let i = 0; ; i++) {
    let n = i, s = '';
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    if (!used.has(s)) return s;
  }
}

let seq = 0;
export const newTrayId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Cables of a panel that go on trays: its outgoing feeders, without the
 * final circuits of its load schedule (those are wired in conduit). */
export function panelCables(project: Project, boardId: string, withFinalCircuits = false): Feeder[] {
  return project.feeders.filter((f) => f.boardId === boardId && (withFinalCircuits || !f.phase));
}

/** Adds feeders to a route, skipping ones already on it. */
export function addFeeders(route: TrayRoute, feederIds: string[]): TrayRoute {
  const on = new Set(route.cables.map((c) => c.feederId).filter(Boolean));
  const add = feederIds.filter((id) => !on.has(id)).map((feederId) => ({ id: newTrayId('c'), feederId }));
  return add.length ? { ...route, cables: [...route.cables, ...add] } : route;
}
