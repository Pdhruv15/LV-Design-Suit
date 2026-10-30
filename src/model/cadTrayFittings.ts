import type { SketchItem } from '../types';

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Cable tray fittings found from the runs drawn in Design CAD (drawing units): a bend where a run turns or two runs
 * meet at an angle, a tee where a run ends on another (a branch), a cross where four meet, a reducer where two runs of
 * different widths meet in line. Ends meet when they are within half the wider tray of each other; a run ending inside
 * another tray's width away from its ends is a branch off it. */

export type FittingKind = 'bend' | 'tee' | 'cross' | 'reducer';
export interface TrayFitting {
  kind: FittingKind;
  at: Pt;
  /** Widths (mm): a bend or cross its width; a tee main × branch; a reducer wider → narrower. */
  sizes: number[];
  /** A bend's angle (degrees, rounded to 5°). */
  angle?: number;
  /** Tray routes of the runs it joins (assigned ones only). */
  routes: string[];
  /** The runs it joins (sketch IDs). */
  runs: string[];
}

/** Turns under this (degrees) are straight: no bend. */
const STRAIGHT_DEG = 10;

const dir = (a: Pt, b: Pt): Pt => { const d = dist(a, b) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
const turnDeg = (u: Pt, v: Pt) => (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
const round5 = (a: number) => Math.round(a / 5) * 5;
function nearestOn(p: Pt, a: Pt, b: Pt): { q: Pt; d: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  const q: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { q, d: dist(p, q), t };
}

interface End { run: SketchItem; at: Pt; out: Pt; which: 'start' | 'end' } // `out`: direction from the joint into the run

/** Fittings of the tray runs among `items` (other drawn objects are ignored); `unitsPerMm` converts widths. */
export function trayFittings(items: SketchItem[], unitsPerMm: number): { fittings: TrayFitting[] } {
  const runs = items.filter((it) => it.tray && it.pts.length >= 2);
  const half = (it: SketchItem) => ((it.tray?.widthMm ?? 0) * unitsPerMm) / 2;
  const routesOf = (rs: SketchItem[]) => [...new Set(rs.map((r) => r.tray?.route).filter((x): x is string => !!x))].sort();
  const fittings: TrayFitting[] = [];

  // Bends inside each run.
  for (const r of runs) {
    for (let i = 1; i < r.pts.length - 1; i += 1) {
      const a = turnDeg(dir(r.pts[i - 1], r.pts[i]), dir(r.pts[i], r.pts[i + 1]));
      if (a >= STRAIGHT_DEG) fittings.push({ kind: 'bend', at: r.pts[i], sizes: [r.tray!.widthMm], angle: round5(a), routes: routesOf([r]), runs: [r.id] });
    }
  }

  // Run ends: grouped where they meet; an end inside another run's width (away from its ends) branches off it.
  const ends: End[] = runs.flatMap((r): End[] => {
    const n = r.pts.length;
    return [{ run: r, at: r.pts[0], out: dir(r.pts[0], r.pts[1]), which: 'start' }, { run: r, at: r.pts[n - 1], out: dir(r.pts[n - 1], r.pts[n - 2]), which: 'end' }];
  });
  const used = new Set<End>();
  for (const e of ends) {
    if (used.has(e)) continue;
    // A main run this end is on, away from that run's own ends: a branch off it.
    const onMain = (p: Pt, skip: Set<SketchItem>) => {
      for (const r of runs) {
        if (skip.has(r)) continue;
        for (let i = 0; i + 1 < r.pts.length; i += 1) {
          const q = nearestOn(p, r.pts[i], r.pts[i + 1]);
          const nearEnd = (i === 0 && q.t < 1e-6) || (i === r.pts.length - 2 && q.t > 1 - 1e-6);
          if (q.d <= half(r) + 1e-9 && !nearEnd) return { run: r, seg: i };
        }
      }
      return undefined;
    };
    let main = onMain(e.at, new Set([e.run]));
    // Ends meet within half the wider tray (the main tray's, for branches off it).
    const tol = (f: End) => Math.max(half(e.run), half(f.run), main ? half(main.run) : 0);
    const group = ends.filter((f) => !used.has(f) && f.run !== e.run && f.run !== main?.run && dist(f.at, e.at) <= tol(f));
    const members = [e, ...group.filter((f, i) => group.findIndex((g) => g.run === f.run) === i)];
    if (main && members.some((m) => m.run === main!.run)) main = undefined;
    if (members.length < 2 && !main) continue;
    members.forEach((m) => used.add(m));
    const at = e.at;
    const all = [...members.map((m) => m.run), ...(main ? [main.run] : [])];
    const routes = routesOf(all), ids = all.map((r) => r.id);
    const legs = members.length + (main ? 2 : 0);
    if (main) {
      const w = main.run.tray!.widthMm;
      if (legs >= 4) fittings.push({ kind: 'cross', at, sizes: [w, ...members.map((m) => m.run.tray!.widthMm)], routes, runs: ids });
      else fittings.push({ kind: 'tee', at, sizes: [w, members[0].run.tray!.widthMm], routes, runs: ids });
      continue;
    }
    if (legs === 2) {
      const [a, b] = members;
      const turn = 180 - turnDeg(a.out, b.out); // 0 when in line
      const wa = a.run.tray!.widthMm, wb = b.run.tray!.widthMm;
      if (turn >= STRAIGHT_DEG) fittings.push({ kind: 'bend', at, sizes: [Math.max(wa, wb)], angle: round5(turn), routes, runs: ids });
      else if (wa !== wb) fittings.push({ kind: 'reducer', at, sizes: [Math.max(wa, wb), Math.min(wa, wb)], routes, runs: ids });
      continue; // in line, same width: a straight joint, no fitting
    }
    const widths = members.map((m) => m.run.tray!.widthMm).sort((x, y) => y - x);
    fittings.push(legs === 3 ? { kind: 'tee', at, sizes: [widths[0], widths[widths.length - 1]], routes, runs: ids } : { kind: 'cross', at, sizes: widths, routes, runs: ids });
  }
  return { fittings };
}

/** "Bend 90° 300", "Tee 300 × 150", "Cross 300", "Reducer 300 → 150". */
export function fittingLabel(f: TrayFitting): string {
  if (f.kind === 'bend') return `Bend ${f.angle}° ${f.sizes[0]}`;
  if (f.kind === 'reducer') return `Reducer ${f.sizes[0]} → ${f.sizes[1]}`;
  if (f.kind === 'tee') return f.sizes[0] === f.sizes[1] ? `Tee ${f.sizes[0]}` : `Tee ${f.sizes[0]} × ${f.sizes[1]}`;
  return new Set(f.sizes).size === 1 ? `Cross ${f.sizes[0]}` : `Cross ${f.sizes.join(' × ')}`;
}

/** Fittings counted by their label, most first: [label, count]. */
export function fittingCounts(fittings: TrayFitting[]): [string, number][] {
  const n = new Map<string, number>();
  for (const f of fittings) n.set(fittingLabel(f), (n.get(fittingLabel(f)) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
}
