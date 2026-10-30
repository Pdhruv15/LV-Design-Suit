import { cableSizeText } from '../calc/electrical';
import { circuitRef } from '../calc/loadSchedule';
import { CAD_LENGTH_DEFAULTS } from './cadLengths';
import type { LevelRef } from './levels';
import type { LvPoint } from './cadDevices';
import type { Feeder, Project } from '../types';

type Pt = [number, number];

/** Design CAD → Plan → Wiring: each wired circuit's devices joined by wiring arcs in circuit order, and a home run from
 * the first device to its DB, in metres on the level's plan (the same coordinates as the devices).
 * - Order: the order the engineer saved, else from the device nearest the DB, each next device the nearest left.
 * - Length: along the arcs and the home run, plus a drop per device, plus an allowance, rounded up to a whole metre.
 *   Update schedules gives it to the circuit (a drawn cable route of the circuit takes precedence).
 * - A circuit whose DB is not placed on the level gets a warning instead of a home run. */

export interface CadWiring { feederId: string; order?: string[] } // order: LV point IDs
/** How far an arc bows out from its chord, as a part of the chord. */
const BOW = 0.15;

/** A quadratic curve from a to b through its control point c. */
export interface WiringArc { a: Pt; c: Pt; b: Pt }
export interface CircuitWiring {
  feederId: string;
  arcs: WiringArc[];
  home?: WiringArc; // from the first device to the DB
  routeM: number; // along the arcs and home run on this level
  devices: number;
  tag: string; // "DB-GF1/L3 · 2C × 1.5 mm² · 23 m"
  tagAt: Pt;
  warning?: string;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** The arc from a to b bowing to one side (side ±1): its control point is twice the bow off the chord's middle. */
function arc(a: Pt, b: Pt, side: number): WiringArc {
  const l = dist(a, b) || 1;
  const k = 2 * BOW * side;
  return { a, b, c: [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / l) * k * l, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / l) * k * l] };
}
/** Points along an arc (ends included), for drawing it as a polyline and measuring it. */
export function arcPoints(w: WiringArc, n = 16): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * w.a[0] + 2 * u * t * w.c[0] + t * t * w.b[0], u * u * w.a[1] + 2 * u * t * w.c[1] + t * t * w.b[1]] as Pt;
  });
}
export const arcLength = (w: WiringArc) => arcPoints(w).slice(1).reduce((s, q, i, all) => s + dist(i ? all[i - 1] : w.a, q), 0);

const onLevel = (d: { buildingId: string; levelId: string }, level: LevelRef) => d.buildingId === level.building && d.levelId === level.level;

/** The circuit's points on a level in wiring order: the saved order first, then the rest nearest-first from `start`. */
export function wiringOrder(points: LvPoint[], saved: string[] | undefined, start: Pt | undefined): LvPoint[] {
  const out = (saved ?? []).map((id) => points.find((d) => d.id === id)).filter((d): d is LvPoint => !!d);
  const left = points.filter((d) => !out.includes(d));
  let at: Pt | undefined = out.length ? [out[out.length - 1].x, out[out.length - 1].y] : start;
  while (left.length) {
    let i = 0;
    if (at) left.forEach((d, j) => { if (dist(at!, [d.x, d.y]) < dist(at!, [left[i].x, left[i].y])) i = j; });
    const [d] = left.splice(i, 1);
    out.push(d);
    at = [d.x, d.y];
  }
  return out;
}

const settingsOf = (p: Project) => ({ ...CAD_LENGTH_DEFAULTS, ...p.cadLength });
/** The circuit's wiring length: (route + a drop per device) × (1 + allowance), rounded up to a whole metre. */
export function wiringLengthM(p: Project, routeM: number, devices: number): number {
  const s = settingsOf(p);
  return Math.ceil((routeM + s.dropM * devices) * (1 + s.allowancePct / 100) - 1e-9);
}

export const isWired = (p: Project, feederId: string) => !!p.cadWiring?.some((w) => w.feederId === feederId);

/** "DB-GF1/L3 · 2C × 1.5 mm² · 23 m", as the home run is tagged. */
export function wiringTag(f: Feeder, lengthM: number): string {
  const ref = circuitRef(f);
  return `${f.boardId}${ref ? `/${ref}` : ''} · ${cableSizeText(f)} · ${lengthM} m`;
}

/** Each wired circuit's route over all levels (metres) and devices: what its length is made from. */
function routes(p: Project): Map<string, { routeM: number; devices: number }> {
  const out = new Map<string, { routeM: number; devices: number }>();
  const levels = new Map<string, LevelRef>();
  for (const d of p.lvPoints ?? []) levels.set(`${d.buildingId}/${d.levelId}`, { building: d.buildingId, level: d.levelId });
  for (const level of levels.values()) for (const w of levelWiring(p, level, false)) {
    const x = out.get(w.feederId) ?? { routeM: 0, devices: 0 };
    out.set(w.feederId, { routeM: x.routeM + w.routeM, devices: x.devices + w.devices });
  }
  return out;
}

/** The wired circuits' lengths (metres, whole), by circuit. */
export function wiringLengths(p: Project): Map<string, number> {
  return new Map([...routes(p)].map(([id, r]) => [id, wiringLengthM(p, r.routeM, r.devices)]));
}

/** The wiring of every wired circuit with devices on the level. */
export function levelWiring(p: Project, level: LevelRef, tagged = true): CircuitWiring[] {
  const all = tagged ? wiringLengths(p) : undefined;
  return (p.cadWiring ?? []).flatMap((w, i): CircuitWiring[] => {
    const f = p.feeders.find((x) => x.id === w.feederId);
    const points = (p.lvPoints ?? []).filter((d) => d.feederId === w.feederId && onLevel(d, level));
    if (!f || !points.length) return [];
    const board = p.boards.find((b) => b.id === f.boardId);
    const db: Pt | undefined = board?.planPoint && board.level?.building === level.building && board.level?.level === level.level ? [board.planPoint.x, board.planPoint.y] : undefined;
    const order = wiringOrder(points, w.order, db);
    // Arcs of neighbouring circuits bow to opposite sides, so they don't lie on each other.
    const side = i % 2 ? -1 : 1;
    const arcs = order.slice(1).map((d, j) => arc([order[j].x, order[j].y], [d.x, d.y], side));
    const first: Pt = [order[0].x, order[0].y];
    const home = db ? arc(first, db, side) : undefined;
    const routeM = [...arcs, ...(home ? [home] : [])].reduce((s, a) => s + arcLength(a), 0);
    const lengthM = all?.get(f.id) ?? wiringLengthM(p, routeM, order.length);
    const tagAt: Pt = home ? arcPoints(home, 2)[1] : first;
    return [{
      feederId: f.id, arcs, ...(home ? { home } : {}), routeM, devices: order.length, tag: wiringTag(f, lengthM), tagAt,
      ...(db ? {} : { warning: board?.planPoint ? `${f.boardId} is on another level: no home run here` : `${f.boardId} is not placed on the plan: no home run` })
    }];
  });
}

/** Wire circuits: every circuit with devices on the level that is not wired yet. */
export function wireLevel(p: Project, level: LevelRef): { project: Project; added: string[] } {
  const ids = [...new Set((p.lvPoints ?? []).filter((d) => onLevel(d, level)).map((d) => d.feederId))]
    .filter((id) => !isWired(p, id) && p.feeders.some((f) => f.id === id));
  return { project: ids.length ? { ...p, cadWiring: [...(p.cadWiring ?? []), ...ids.map((feederId) => ({ feederId }))] } : p, added: ids };
}

/** Wire one: wires the circuit, or takes its wiring off when it is wired. */
export function toggleWiring(p: Project, feederId: string): { project: Project; wired: boolean } {
  if (!isWired(p, feederId)) return { project: { ...p, cadWiring: [...(p.cadWiring ?? []), { feederId }] }, wired: true };
  const rest = (p.cadWiring ?? []).filter((w) => w.feederId !== feederId);
  const { cadWiring: _old, ...base } = p;
  return { project: rest.length ? { ...base, cadWiring: rest } : base, wired: false };
}

/** Update schedules: each wired circuit (without a drawn cable route) gets its wiring length; returns those changed. */
export function applyWiringLengths(p: Project, routed: Set<string>): { project: Project; changed: number } {
  const lengths = wiringLengths(p);
  let changed = 0;
  const feeders = p.feeders.map((f) => {
    const m = lengths.get(f.id);
    if (m === undefined || routed.has(f.id) || (m === f.lengthM && !f.lengthToCheck)) return f;
    changed += 1;
    return { ...f, lengthM: m, lengthToCheck: undefined };
  });
  return { project: changed ? { ...p, feeders } : p, changed };
}
