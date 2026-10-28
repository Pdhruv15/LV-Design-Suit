import { curvePoints, type CadDrawing } from './cadDrawing';

type Pt = [number, number];
export type Seg = [Pt, Pt];

/** Room outlines from the walls around a point, like CAD's BOUNDARY with a gap tolerance: the wall lines are drawn on a
 * fine grid, openings narrower than `gap` (doors) are closed, and the space around the point is filled up to the walls.
 * Works with single-line and double-line walls, with or without jamb lines. 2D plan geometry only; lengths in drawing
 * units. */

/** The straight pieces of the drawing's lines, arcs and polylines (closed ones too) on the given layers (lower case). */
export function wallSegments(d: CadDrawing, layers: Set<string>): Seg[] {
  const out: Seg[] = [];
  for (const e of d.entities) {
    if (e.k === 'hatch' || e.k === 'text' || e.k === 'insert' || !layers.has(e.l.toLowerCase())) continue;
    const points = curvePoints(e);
    if (!points) continue;
    for (let i = 0; i + 1 < points.length; i += 1) out.push([points[i], points[i + 1]]);
  }
  return out;
}

/** Signed area of a polygon (counter-clockwise > 0). */
export function polygonArea(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Distance (in cells) from every cell to the nearest `from` cell: two-pass chamfer, close to Euclidean. */
function distance(from: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  const big = w + h;
  for (let i = 0; i < d.length; i += 1) d[i] = from[i] ? 0 : big;
  const diag = Math.SQRT2;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[i - w] + 1);
      if (x > 0) v = Math.min(v, d[i - w - 1] + diag);
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + diag);
    }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y -= 1) for (let x = w - 1; x >= 0; x -= 1) {
    const i = y * w + x;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + 1);
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + diag);
      if (x > 0) v = Math.min(v, d[i + w - 1] + diag);
    }
    d[i] = v;
  }
  return d;
}

/** Removes points that add little to the outline (Douglas–Peucker, tolerance in drawing units). */
function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, dist = tol;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / l;
      if (d > dist) { dist = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

export interface BoundaryOptions {
  /** Widest opening closed as a wall (doors), drawing units. */
  gap: number;
  /** How far from the point walls are looked for, drawing units; a room larger than this is not found. */
  reach: number;
  /** Grid cells across the search square (more = finer, slower). */
  cells?: number;
}

/** The room around `at`: its outline (counter-clockwise, simplified) and area in drawing units², or undefined when
 * the point is on a wall or the space is not closed within `reach`. */
export function roomBoundaryAt(segments: Seg[], at: Pt, options: BoundaryOptions): { points: Pt[]; area: number } | undefined {
  const n = options.cells ?? 1200;
  const cell = (2 * options.reach) / n;
  const x0 = at[0] - options.reach, y0 = at[1] - options.reach;
  const w = n, h = n;
  const wall = new Uint8Array(w * h);
  let any = false;
  for (const [a, b] of segments) {
    if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x0 + w * cell || Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y0 + h * cell) continue;
    const steps = Math.max(1, Math.ceil((Math.hypot(b[0] - a[0], b[1] - a[1]) / cell) * 2));
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.floor((a[0] + ((b[0] - a[0]) * s) / steps - x0) / cell), y = Math.floor((a[1] + ((b[1] - a[1]) * s) / steps - y0) / cell);
      if (x >= 0 && x < w && y >= 0 && y < h) { wall[y * w + x] = 1; any = true; }
    }
  }
  if (!any) return undefined;

  // A disk half the door gap across cannot pass through a door: fill the places its centre can reach from the point,
  // sweep the disk over them, then fill the room's corners (which the disk cannot reach into). A space narrower than
  // the disk (a corridor) is tried again with a smaller disk.
  const fromWall = distance(wall, w, h);
  const start = Math.floor((at[1] - y0) / cell) * w + Math.floor((at[0] - x0) / cell);
  if (wall[start]) return undefined;
  const queue = new Int32Array(w * h);
  /** Cells reachable from `seed` through `ok` cells (4-connected); undefined when they reach the edge of the grid. */
  const fill = (seeds: number[], ok: (i: number) => boolean): Uint8Array | undefined => {
    const got = new Uint8Array(w * h);
    let head = 0, tail = 0;
    for (const s0 of seeds) { got[s0] = 1; queue[tail++] = s0; }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return undefined;
      for (const j of [i - 1, i + 1, i - w, i + w]) if (!got[j] && ok(j)) { got[j] = 1; queue[tail++] = j; }
    }
    return got;
  };
  const full = options.gap / 2 / cell;
  const r = [full, full * 0.6, full * 0.35].find((x) => fromWall[start] > x);
  if (r === undefined) return undefined;
  const centres = fill([start], (i) => fromWall[i] > r);
  if (!centres) return undefined;
  const fromCentres = distance(centres, w, h);
  const swept: number[] = [];
  for (let i = 0; i < centres.length; i += 1) if (!wall[i] && fromCentres[i] <= r) swept.push(i);
  // Corners and shallow niches the disk cannot reach are small free regions next to the swept area; the next room
  // (through a door) or the outside is a large one and stays out.
  const room = new Uint8Array(w * h);
  for (const i of swept) room[i] = 1;
  const seen = new Uint8Array(w * h);
  const limit = Math.ceil(2 * r * r);
  for (const i0 of swept) for (const s0 of [i0 - 1, i0 + 1, i0 - w, i0 + w]) {
    if (seen[s0] || room[s0] || wall[s0]) continue;
    const part: number[] = [];
    let head = 0, tail = 0, big = false;
    seen[s0] = 1; queue[tail++] = s0;
    while (head < tail) {
      const i = queue[head++];
      if (!big) { part.push(i); if (part.length > limit) big = true; }
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { big = true; continue; }
      for (const j of [i - 1, i + 1, i - w, i + w]) if (!seen[j] && !room[j] && !wall[j]) { seen[j] = 1; queue[tail++] = j; }
    }
    if (!big) for (const i of part) room[i] = 1;
  }
  let count = 0;
  for (let i = 0; i < room.length; i += 1) count += room[i];

  // Outline: the cell edges between room and not-room, chained with the room on the left; the longest loop.
  const next = new Map<number, number>(); // grid corner → next corner
  const at2 = (x: number, y: number) => y * (w + 1) + x;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (!room[y * w + x]) continue;
    if (!room[(y - 1) * w + x]) next.set(at2(x, y), at2(x + 1, y)); // bottom edge, left to right
    if (!room[y * w + x + 1]) next.set(at2(x + 1, y), at2(x + 1, y + 1)); // right edge, upwards
    if (!room[(y + 1) * w + x]) next.set(at2(x + 1, y + 1), at2(x, y + 1)); // top edge, right to left
    if (!room[y * w + x - 1]) next.set(at2(x, y + 1), at2(x, y)); // left edge, downwards
  }
  // The wall line runs, on average, through the middle of its cell: count half a cell beyond each boundary edge.
  const area = (count + next.size / 2) * cell * cell;
  let loop: number[] = [];
  const done = new Set<number>();
  for (const s of next.keys()) {
    if (done.has(s)) continue;
    const l: number[] = [];
    for (let c = s; !done.has(c) && next.has(c); c = next.get(c)!) { done.add(c); l.push(c); }
    if (l.length > loop.length) loop = l;
  }
  const ring = loop.map((c): Pt => [x0 + (c % (w + 1)) * cell, y0 + Math.floor(c / (w + 1)) * cell]);
  // A closed ring is simplified in two halves, split at the corner farthest from its first point.
  let far = 0;
  ring.forEach((p, k) => { if (Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = k; });
  const points = [...simplify(ring.slice(0, far + 1), cell * 1.5), ...simplify([...ring.slice(far), ring[0]], cell * 1.5).slice(1, -1)];
  return { points, area };
}
