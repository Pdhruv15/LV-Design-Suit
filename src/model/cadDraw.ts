type Pt = [number, number];

/** How Design CAD draws a drawing's linetypes and hatches on screen (drawing units). */

/** A canvas dash array for a linetype pattern (dash > 0, gap < 0, dot 0): dashes and gaps alternate, starting with a
 * dash; a dot is `dot` long (one screen pixel in drawing units). Empty for continuous. */
export function dashArray(pattern: number[], dot: number): number[] {
  const out: number[] = [];
  for (const v of pattern) {
    const on = v >= 0, len = v === 0 ? dot : Math.abs(v);
    const wantOn = out.length % 2 === 0;
    if (on === wantOn) out.push(len);
    else if (out.length) out[out.length - 1] += len;
    else out.push(0, len); // starts with a gap
  }
  return out.length >= 2 && out.some((v, i) => i % 2 === 1 && v > 0) ? out : [];
}

/** The repeat length of a dash array. */
export const patternLength = (dash: number[]) => dash.reduce((t, v) => t + v, 0);

/** One family of hatch pattern lines across a box: each line's two ends and where along it the pattern starts (for
 * the dash phase). Empty when the lines would be closer than `minGap` apart, or more than `max` of them. */
export function hatchLines(line: { angle: number; base: Pt; offset: Pt }, box: [number, number, number, number], minGap: number, max = 1500): { a: Pt; b: Pt; phase: number }[] {
  const dir: Pt = [Math.cos(line.angle), Math.sin(line.angle)], n: Pt = [-dir[1], dir[0]];
  const step = line.offset[0] * n[0] + line.offset[1] * n[1]; // distance between the lines
  if (Math.abs(step) < minGap || !Number.isFinite(step)) return [];
  const [x0, y0, x1, y1] = box;
  const corners: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const dot = (p: Pt, v: Pt) => p[0] * v[0] + p[1] * v[1];
  const ds = corners.map((c) => dot(c, n)), d0 = dot(line.base, n);
  let k0 = Math.ceil((Math.min(...ds) - d0) / step), k1 = Math.floor((Math.max(...ds) - d0) / step);
  if (k0 > k1) [k0, k1] = [k1, k0];
  if (k1 - k0 + 1 > max) return [];
  const out: { a: Pt; b: Pt; phase: number }[] = [];
  for (let k = k0; k <= k1; k += 1) {
    const p: Pt = [line.base[0] + k * line.offset[0], line.base[1] + k * line.offset[1]];
    const ts = corners.map((c) => dot([c[0] - p[0], c[1] - p[1]], dir));
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    out.push({ a: [p[0] + t0 * dir[0], p[1] + t0 * dir[1]], b: [p[0] + t1 * dir[0], p[1] + t1 * dir[1]], phase: t0 });
  }
  return out;
}

/** Square tiles over the drawing's extents for drawing only what is on screen: the tile a segment's midpoint is in. */
export function tileOf(x: number, y: number, extents: [number, number, number, number], n = 16): number {
  const [x0, y0, x1, y1] = extents;
  const cx = Math.min(n - 1, Math.max(0, Math.floor(((x - x0) / Math.max(1e-9, x1 - x0)) * n)));
  const cy = Math.min(n - 1, Math.max(0, Math.floor(((y - y0) / Math.max(1e-9, y1 - y0)) * n)));
  return cy * n + cx;
}
