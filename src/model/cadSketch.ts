import type { CadSketch, Project, SketchItem } from '../types';

type Pt = [number, number];

/** What the engineer draws in the CAD view over the architect's drawing (which stays as received): lines, polylines,
 * rectangles, circles, arcs, texts and dimensions, in drawing units, kept in the project per drawing file and written
 * into the drawing by Save DXF. Move, copy, rotate and erase work on them; they snap like the drawing. */

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const sketchOf = (p: Project, file: string): SketchItem[] => p.cadSketch?.find((s) => same(s.file, file))?.items ?? [];

function withItems(p: Project, file: string, items: SketchItem[]): Project {
  const rest = (p.cadSketch ?? []).filter((s) => !same(s.file, file));
  const all: CadSketch[] = items.length ? [...rest, { file, items }] : rest;
  const { cadSketch: _old, ...base } = p;
  return all.length ? { ...base, cadSketch: all } : base;
}
const nextId = (p: Project) => (p.cadSketch ?? []).flatMap((s) => s.items).reduce((m, it) => Math.max(m, Number(/^S(\d+)$/.exec(it.id)?.[1] ?? 0)), 0) + 1;

export function addSketch(p: Project, file: string, item: Omit<SketchItem, 'id'>): { project: Project; id: string } {
  const id = `S${nextId(p)}`;
  return { project: withItems(p, file, [...sketchOf(p, file), { ...item, id } as SketchItem]), id };
}
export const updateSketch = (p: Project, file: string, item: SketchItem) => withItems(p, file, sketchOf(p, file).map((it) => (it.id === item.id ? item : it)));
export const removeSketch = (p: Project, file: string, id: string) => withItems(p, file, sketchOf(p, file).filter((it) => it.id !== id));

// ---- geometry

export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const rot = (p: Pt, c: Pt, a: number): Pt => { const s = Math.sin(a), k = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * k - y * s, c[1] + x * s + y * k]; };

/** The item moved by (dx, dy). */
export const moved = (it: SketchItem, dx: number, dy: number): SketchItem => ({ ...it, pts: it.pts.map((q) => [q[0] + dx, q[1] + dy] as Pt) });
/** The item rotated by `a` radians about `c`. */
export function rotated(it: SketchItem, c: Pt, a: number): SketchItem {
  const pts = it.pts.map((q) => rot(q, c, a));
  if (it.kind === 'arc') return { ...it, pts, a0: (it.a0 ?? 0) + a, a1: (it.a1 ?? 0) + a };
  if (it.kind === 'text') return { ...it, pts, rot: (it.rot ?? 0) + a };
  return { ...it, pts };
}

/** A rectangle from two opposite corners, as a closed polyline. */
export const rectangle = (a: Pt, b: Pt): Pt[] => [a, [b[0], a[1]], b, [a[0], b[1]]];

/** The circle through three points (centre, radius), or undefined when they are in line. */
export function circleThrough(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return undefined;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [x, y], r: dist([x, y], a) };
}

/** An arc through start, a point on it, and end: centre in pts[0], start / end angles (anticlockwise). */
export function arcThrough(s: Pt, m: Pt, e: Pt): Omit<SketchItem, 'id' | 'layer'> | undefined {
  const c = circleThrough(s, m, e);
  if (!c) return undefined;
  const ang = (p: Pt) => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
  let a0 = ang(s), a1 = ang(e);
  const am = ang(m);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Anticlockwise from a0 to a1 must pass the middle point; else the arc runs the other way.
  if (norm(am - a0) > norm(a1 - a0)) [a0, a1] = [a1, a0];
  return { kind: 'arc', pts: [c.c], r: c.r, a0, a1 };
}

/** The lines of a dimension from p1 to p2 placed through `at`: extension lines, the dimension line, its ticks, and where
 * its text goes. Aligned with p1 → p2. */
export function dimensionLines(p1: Pt, p2: Pt, at: Pt): { lines: [Pt, Pt][]; text: Pt; angle: number; length: number } {
  const len = dist(p1, p2) || 1e-9;
  const ux = (p2[0] - p1[0]) / len, uy = (p2[1] - p1[1]) / len; // along
  const nx = -uy, ny = ux; // across
  const off = (at[0] - p1[0]) * nx + (at[1] - p1[1]) * ny;
  const d1: Pt = [p1[0] + nx * off, p1[1] + ny * off], d2: Pt = [p2[0] + nx * off, p2[1] + ny * off];
  const ext = Math.sign(off || 1) * len * 0.02;
  const tick = len * 0.015;
  const ticks = [d1, d2].map((d): [Pt, Pt] => [[d[0] - (ux + nx) * tick, d[1] - (uy + ny) * tick], [d[0] + (ux + nx) * tick, d[1] + (uy + ny) * tick]]);
  let angle = Math.atan2(uy, ux);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; // keep the text readable
  return {
    lines: [[p1, [d1[0] + nx * ext, d1[1] + ny * ext]], [p2, [d2[0] + nx * ext, d2[1] + ny * ext]], [d1, d2], ...ticks],
    text: [(d1[0] + d2[0]) / 2 + nx * Math.sign(off || 1) * len * 0.015, (d1[1] + d2[1]) / 2 + ny * Math.sign(off || 1) * len * 0.015],
    angle, length: len
  };
}

/** The straight pieces an item is drawn with (arcs and circles stepped every 5°). */
export function segmentsOf(it: SketchItem): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  const poly = (pts: Pt[], closed: boolean) => { for (let i = 0; i + 1 < pts.length; i += 1) out.push([pts[i], pts[i + 1]]); if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]); };
  const arc = (c: Pt, r: number, a0: number, a1: number) => {
    let s = a1 - a0;
    while (s <= 0) s += 2 * Math.PI;
    const n = Math.max(8, Math.ceil(s / (Math.PI / 36)));
    const pts = Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + (s * i) / n), c[1] + r * Math.sin(a0 + (s * i) / n)] as Pt);
    poly(pts, false);
  };
  if (it.kind === 'line' || it.kind === 'pline') poly(it.pts, !!it.closed);
  else if (it.kind === 'circle') arc(it.pts[0], it.r ?? 0, 0, 2 * Math.PI);
  else if (it.kind === 'arc') arc(it.pts[0], it.r ?? 0, it.a0 ?? 0, it.a1 ?? 0);
  else if (it.kind === 'dim') out.push(...dimensionLines(it.pts[0], it.pts[1], it.pts[2]).lines);
  return out;
}

/** Points the cursor snaps to on drawn items: endpoint (1), midpoint (2), centre (4), insertion (16). */
export function snapPoints(items: SketchItem[]): { x: number; y: number; kind: number }[] {
  const out: { x: number; y: number; kind: number }[] = [];
  for (const it of items) {
    if (it.kind === 'line' || it.kind === 'pline') {
      it.pts.forEach((q) => out.push({ x: q[0], y: q[1], kind: 1 }));
      const n = it.pts.length;
      for (let i = 0; i + 1 < n + (it.closed ? 1 : 0); i += 1) { const a = it.pts[i], b = it.pts[(i + 1) % n]; out.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, kind: 2 }); }
    } else if (it.kind === 'circle') out.push({ x: it.pts[0][0], y: it.pts[0][1], kind: 4 });
    else if (it.kind === 'arc') {
      const c = it.pts[0], r = it.r ?? 0;
      out.push({ x: c[0], y: c[1], kind: 4 }, { x: c[0] + r * Math.cos(it.a0 ?? 0), y: c[1] + r * Math.sin(it.a0 ?? 0), kind: 1 }, { x: c[0] + r * Math.cos(it.a1 ?? 0), y: c[1] + r * Math.sin(it.a1 ?? 0), kind: 1 });
    } else if (it.kind === 'text') out.push({ x: it.pts[0][0], y: it.pts[0][1], kind: 16 });
    else if (it.kind === 'dim') out.push({ x: it.pts[0][0], y: it.pts[0][1], kind: 1 }, { x: it.pts[1][0], y: it.pts[1][1], kind: 1 });
  }
  return out;
}

/** The drawn item nearest the point within `tol` (drawing units), or undefined. Texts by their box. */
export function itemAt(items: SketchItem[], at: Pt, tol: number): SketchItem | undefined {
  let best: { it: SketchItem; d: number } | undefined;
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return dist(p, [a[0] + t * dx, a[1] + t * dy]);
  };
  for (const it of items) {
    let d = Infinity;
    if (it.kind === 'text') {
      const h = it.h ?? 1, w = 0.6 * h * (it.text ?? '').length;
      const a = -(it.rot ?? 0), x = at[0] - it.pts[0][0], y = at[1] - it.pts[0][1];
      const px = x * Math.cos(a) - y * Math.sin(a), py = x * Math.sin(a) + y * Math.cos(a);
      d = px >= -tol && px <= w + tol && py >= -tol && py <= h + tol ? 0 : Infinity;
    } else for (const [a, b] of segmentsOf(it)) d = Math.min(d, segDist(at, a, b));
    if (d <= tol && (!best || d < best.d)) best = { it, d };
  }
  return best?.it;
}

/** Drawn items as the engine writes them into a DXF (drawing units). */
export interface ShapeOut { layer: string; kind: 'line' | 'pline' | 'circle' | 'arc' | 'text'; pts: Pt[]; closed?: boolean; r?: number; a0?: number; a1?: number; text?: string; h?: number; rot?: number }
export function shapesOut(items: SketchItem[], metresPerUnit: number): ShapeOut[] {
  return items.flatMap((it): ShapeOut[] => {
    if (it.kind === 'dim') {
      const d = dimensionLines(it.pts[0], it.pts[1], it.pts[2]);
      return [...d.lines.map((l): ShapeOut => ({ layer: it.layer, kind: 'line', pts: l })),
        { layer: it.layer, kind: 'text', pts: [d.text], text: `${(d.length * metresPerUnit).toFixed(2)}`, h: it.h ?? d.length * 0.04, rot: d.angle }];
    }
    if (it.kind === 'line' && it.pts.length > 2) return [{ layer: it.layer, kind: 'pline', pts: it.pts }];
    return [{ layer: it.layer, kind: it.kind, pts: it.pts, closed: it.closed, r: it.r, a0: it.a0, a1: it.a1, text: it.text, h: it.h, rot: it.rot }];
  });
}

/** A point typed on the command line, in drawing units: "x,y" (absolute), "@dx,dy" (from the last point), "@d<angle"
 * (polar, degrees), or a plain distance along the cursor's direction from the last point (direct distance entry). */
export function typedPoint(text: string, last: Pt | undefined, cursor: Pt | null): Pt | undefined {
  const t = text.trim().replace(/\s+/g, '');
  const num = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
  let m = /^@(-?[\d.]+)<(-?[\d.]+)$/.exec(t);
  if (m && last) { const d = num(m[1]), a = (num(m[2]) * Math.PI) / 180; if (Number.isFinite(d) && Number.isFinite(a)) return [last[0] + d * Math.cos(a), last[1] + d * Math.sin(a)]; }
  m = /^(@?)(-?[\d.]+),(-?[\d.]+)$/.exec(t);
  if (m) {
    const x = num(m[2]), y = num(m[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    if (m[1]) return last ? [last[0] + x, last[1] + y] : undefined;
    return [x, y];
  }
  const d = num(t);
  if (Number.isFinite(d) && last && cursor) {
    const l = dist(last, cursor);
    if (l < 1e-9) return undefined;
    return [last[0] + ((cursor[0] - last[0]) / l) * d, last[1] + ((cursor[1] - last[1]) / l) * d];
  }
  return undefined;
}
