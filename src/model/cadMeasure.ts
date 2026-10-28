import { roomBoundaryAt, type Seg } from './cadBoundary';

type Pt = [number, number];

/** Measuring on a CAD drawing: units, lengths, areas, ORTHO, and a room's outline from the walls around a point.
 * Lengths are in drawing units unless named in metres; results are shown to two decimals. */

const BY_CODE: Record<number, [number, string]> = { 1: [0.0254, 'in'], 2: [0.3048, 'ft'], 4: [0.001, 'mm'], 5: [0.01, 'cm'], 6: [1, 'm'] };

/** Metres per drawing unit from INSUNITS; a drawing that does not say is taken as millimetres (architects' plans). */
export function drawingUnits(insunits: number): { factor: number; label: string; assumed: boolean } {
  const known = BY_CODE[insunits];
  return known ? { factor: known[0], label: known[1], assumed: false } : { factor: 0.001, label: 'mm', assumed: true };
}

export const distance = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The point constrained horizontally or vertically from `from` (ORTHO), whichever is nearer the cursor. */
export function ortho(from: Pt, to: Pt): Pt {
  return Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]];
}

/** Area (always positive) and perimeter of a closed outline. */
export function areaOf(points: Pt[]): { area: number; perimeter: number } {
  let twice = 0, perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += a[0] * b[1] - b[0] * a[1];
    perimeter += distance(a, b);
  }
  return { area: Math.abs(twice) / 2, perimeter };
}

/** Angle of a → b in degrees, 0–360 anticlockwise from east (as CAD reports it). */
export function angleDeg(a: Pt, b: Pt): number {
  const d = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return d < 0 ? d + 360 : d;
}

export const m2 = (v: number) => `${v.toFixed(2)} m²`;
export const m = (v: number) => `${v.toFixed(2)} m`;

export function inside([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Layers that hold walls by their name (WALL, PARTITION, COLUMN). */
export const WALL_LAYER = /WALL|PARTITION|COLUMN|COLM/i;

/** Segments (absolute drawing units) of the given layers, from the view's segment list relative to `origin`. */
export function segmentsOn(segs: Float32Array, segLayers: Uint16Array, origin: Pt, layers: Set<number>): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < segLayers.length; i += 1) {
    if (!layers.has(segLayers[i])) continue;
    out.push([[segs[i * 4] + origin[0], segs[i * 4 + 1] + origin[1]], [segs[i * 4 + 2] + origin[0], segs[i * 4 + 3] + origin[1]]]);
  }
  return out;
}

/** The room around a point from the walls: openings up to `doorM` metres (doors) are closed. Undefined when the point
 * is on a wall or the space is open (or larger than 50 m across). */
export function roomAround(walls: Seg[], at: Pt, metresPerUnit: number, doorM = 1.2): { points: Pt[]; area: number } | undefined {
  return roomBoundaryAt(walls, at, { gap: doorM / metresPerUnit, reach: 25 / metresPerUnit });
}
