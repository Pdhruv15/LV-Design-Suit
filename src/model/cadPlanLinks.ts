import { curvePoints, curveLength, type CadDrawing, type CadItem } from './cadDrawing';
import type { CadRoute } from './cadLengths';
import type { CadPlan } from './cadPlaces';
import type { CadPlanLinks, Project } from '../types';

type Pt = [number, number];

/** What the engineer linked on a floor plan in the Floor plan window, kept in the project per drawing file (the
 * drawing itself is never changed): curves → a feeder's cable route or a tray route, and boards → a block or a point.
 * Links are by entity handle, so they survive a revised plan saved from the same drawing. */

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const linksFor = (project: Project, file: string): CadPlanLinks => project.cadPlanLinks?.find((l) => same(l.file, file)) ?? { file };

const empty = (l: CadPlanLinks) => !Object.keys(l.routes ?? {}).length && !Object.keys(l.trays ?? {}).length && !Object.keys(l.places ?? {}).length;

/** The project with this drawing's links replaced (dropped when there are none). */
export function withLinks(project: Project, links: CadPlanLinks): Project {
  const rest = (project.cadPlanLinks ?? []).filter((l) => !same(l.file, links.file));
  const all = empty(links) ? rest : [...rest, links];
  const { cadPlanLinks: _old, ...base } = project;
  return all.length ? { ...base, cadPlanLinks: all } : base;
}

/** The drawing with the links written as LVDS tags ("route:<id>", "tray:<name>", "place:<id>"), as OpenCADStudio wrote
 * them into the drawing, so the plan reading and auto-linking work unchanged. Links made here win over tags in the file. */
export function linkedDrawing(d: CadDrawing, links: CadPlanLinks): CadDrawing {
  const places = new Map(Object.entries(links.places ?? {}).filter(([, p]) => p.handle).map(([id, p]) => [p.handle!, id]));
  return {
    ...d,
    entities: d.entities.map((e): CadItem => {
      if (e.k === 'text') return e;
      if (e.k === 'insert') { const id = places.get(e.h); return id ? { ...e, x: `place:${id}` } : e; }
      const feeder = links.routes?.[e.h], tray = links.trays?.[e.h];
      return feeder ? { ...e, x: `route:${feeder}` } : tray ? { ...e, x: `tray:${tray}` } : e;
    })
  };
}

/** A plan with the boards placed at a point (no block) added to its linked places. */
export function withPointPlaces(plan: CadPlan, links: CadPlanLinks): CadPlan {
  const points = Object.entries(links.places ?? {}).filter(([, p]) => !p.handle).map(([boardId, p]) => ({ boardId, x: p.x, y: p.y }));
  return points.length ? { ...plan, places: [...plan.places.filter((p) => !points.some((x) => x.boardId === p.boardId)), ...points] } : plan;
}

/** Cable routes linked to feeders (curves tagged "route:<id>"), measured in drawing units, one per feeder. */
export function linkedRoutes(plan: CadPlan): CadRoute[] {
  const by = new Map<string, CadRoute>();
  for (const c of plan.curves ?? []) {
    if (!c.tag?.startsWith('route:')) continue;
    const id = c.tag.slice('route:'.length);
    const r = by.get(id) ?? { feederId: id, length: 0, pieces: 0 };
    r.length += c.length; r.pieces += 1;
    by.set(id, r);
  }
  return [...by.values()];
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The line, arc or polyline nearest the point within `tol` (drawing units), on the layers given (all when omitted). */
export function curveAt(d: CadDrawing, at: Pt, tol: number, layers?: Set<string>): CadItem | undefined {
  let best: { e: CadItem; dist: number } | undefined;
  for (const e of d.entities) {
    if (e.k !== 'line' && e.k !== 'arc' && e.k !== 'pline') continue;
    if (layers && !layers.has(e.l.toLowerCase())) continue;
    const pts = curvePoints(e);
    if (!pts) continue;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const dist = segmentDistance(at, pts[i], pts[i + 1]);
      if (dist <= tol && (!best || dist < best.dist)) best = { e, dist };
    }
  }
  return best?.e;
}

/** The block (insert) nearest the point within `tol` (drawing units). */
export function blockAt(d: CadDrawing, at: Pt, tol: number): Extract<CadItem, { k: 'insert' }> | undefined {
  let best: { e: Extract<CadItem, { k: 'insert' }>; dist: number } | undefined;
  for (const e of d.entities) {
    if (e.k !== 'insert') continue;
    const dist = Math.hypot(e.at[0] - at[0], e.at[1] - at[1]);
    if (dist <= tol && (!best || dist < best.dist)) best = { e, dist };
  }
  return best?.e;
}

/** Links or unlinks (`to` empty) a curve to a feeder route or a tray route. A curve is on one route or one tray. */
export function toggleCurve(links: CadPlanLinks, kind: 'routes' | 'trays', handle: string, to: string): CadPlanLinks {
  const map = { ...(links[kind] ?? {}) };
  if (!to || map[handle] === to) delete map[handle]; else map[handle] = to;
  const other = kind === 'routes' ? 'trays' : 'routes';
  const rest = { ...(links[other] ?? {}) };
  delete rest[handle];
  return { ...links, [kind]: map, [other]: rest };
}

/** Places a board at a block (by its handle) or at a point; an empty `at` removes the board's place. */
export function placeBoard(links: CadPlanLinks, boardId: string, at?: { handle?: string; x: number; y: number }): CadPlanLinks {
  const places = { ...(links.places ?? {}) };
  if (at) {
    for (const [id, p] of Object.entries(places)) if (at.handle && p.handle === at.handle && id !== boardId) delete places[id];
    places[boardId] = at;
  } else delete places[boardId];
  return { ...links, places };
}

/** Curves linked to something, as paths for drawing on the plan: the feeder or tray each belongs to. */
export function linkedPaths(d: CadDrawing, links: CadPlanLinks): { kind: 'route' | 'tray'; to: string; points: Pt[]; length: number }[] {
  const out: { kind: 'route' | 'tray'; to: string; points: Pt[]; length: number }[] = [];
  for (const e of d.entities) {
    if (e.k !== 'line' && e.k !== 'arc' && e.k !== 'pline') continue;
    const feeder = links.routes?.[e.h], tray = links.trays?.[e.h];
    if (!feeder && !tray) continue;
    const points = curvePoints(e);
    if (points) out.push({ kind: feeder ? 'route' : 'tray', to: (feeder ?? tray)!, points, length: curveLength(e) });
  }
  return out;
}
