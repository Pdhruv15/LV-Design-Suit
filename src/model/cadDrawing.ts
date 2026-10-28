import type { CadBlock } from './cadLoads';
import type { CadLayerStats, CadPlan } from './cadPlaces';
import type { CadTrayPlan } from './cadTrays';

type Pt = [number, number];

/** A DWG / DXF drawing as the built-in reader (src/engines/cad, acadrust) returns it: model-space entities only, in
 * drawing units. `x` is the entity's LVDS tag ("route:<id>", "tray:<name>", "place:<id>"…), `h` its handle (hex). */
export type CadItem =
  | { k: 'line'; l: string; h: string; x?: string; a: Pt; b: Pt }
  | { k: 'arc'; l: string; h: string; x?: string; c: Pt; r: number; s: number; e: number } // angles in radians
  | { k: 'pline'; l: string; h: string; x?: string; v: [number, number, number][]; closed: boolean } // [x, y, bulge]
  | { k: 'hatch'; l: string; h: string; x?: string; v: [number, number, number][] } // outer boundary
  | { k: 'text'; l: string; h: string; at: Pt; s: string; ht?: number } // ht: text height
  | { k: 'insert'; l: string; h: string; x?: string; name: string; at: Pt; attrs: Record<string, string> };

export interface CadDrawing {
  format: 'DWG' | 'DXF';
  units: number; // INSUNITS
  entities: CadItem[];
}

const TAGS = /^(feeder|board|sheet|route|place|tray):/;
const tagOf = (e: CadItem): string | undefined => ('x' in e && e.x && TAGS.test(e.x) ? e.x : undefined);

/** Length of one straight or bulged (arc) polyline segment; bulge = tan(θ/4). */
function segmentLength(a: Pt, b: Pt, bulge: number): number {
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!bulge || !chord) return chord;
  const theta = 4 * Math.atan(Math.abs(bulge));
  return (chord / (2 * Math.sin(theta / 2))) * theta;
}

/** Points along a bulged polyline segment from a to b (straight: just b), every ~10°. */
function segmentPoints(a: Pt, b: Pt, bulge: number): Pt[] {
  if (!bulge) return [b];
  const theta = 4 * Math.atan(bulge); // signed sweep
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!chord) return [b];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * (Math.abs(theta) > Math.PI ? -1 : 1) * Math.sign(theta);
  const centre: Pt = [mid[0] - (h * (b[1] - a[1])) / chord, mid[1] + (h * (b[0] - a[0])) / chord];
  const start = Math.atan2(a[1] - centre[1], a[0] - centre[0]);
  const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
  return Array.from({ length: steps }, (_, i) => {
    const t = start + (theta * (i + 1)) / steps;
    return [centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)] as Pt;
  });
}

const sweepOf = (s: number, e: number) => ((((e - s) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) || 2 * Math.PI;

/** A curve as a path of points (drawing units): lines, arcs, open polylines with arc segments; else undefined. */
export function curvePoints(e: CadItem): Pt[] | undefined {
  if (e.k === 'line') return [e.a, e.b];
  if (e.k === 'arc') {
    const sweep = sweepOf(e.s, e.e);
    const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 18)));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = e.s + (sweep * i) / steps;
      return [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)] as Pt;
    });
  }
  if (e.k === 'pline' && e.v.length >= 2) {
    const v = e.v;
    const out: Pt[] = [[v[0][0], v[0][1]]];
    for (let i = 0; i + 1 < v.length; i += 1) out.push(...segmentPoints([v[i][0], v[i][1]], [v[i + 1][0], v[i + 1][1]], v[i][2]));
    if (e.closed) out.push(...segmentPoints([v[v.length - 1][0], v[v.length - 1][1]], [v[0][0], v[0][1]], v[v.length - 1][2]));
    return out;
  }
  return undefined;
}

/** Plan length of a curve in drawing units: lines, arcs and polylines with arc segments; anything else 0. */
export function curveLength(e: CadItem): number {
  if (e.k === 'line') return Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
  if (e.k === 'arc') return e.r * sweepOf(e.s, e.e);
  if (e.k === 'pline') {
    const v = e.v;
    let length = 0;
    for (let i = 0; i + 1 < v.length; i += 1) length += segmentLength([v[i][0], v[i][1]], [v[i + 1][0], v[i + 1][1]], v[i][2]);
    if (e.closed && v.length > 2) length += segmentLength([v[v.length - 1][0], v[v.length - 1][1]], [v[0][0], v[0][1]], v[v.length - 1][2]);
    return length;
  }
  return 0;
}

/** A closed outline (room boundary) from a closed polyline or a hatch's outer boundary; else undefined. */
function closedOutline(e: CadItem): { points: Pt[]; bulges?: number[] } | undefined {
  const v = e.k === 'hatch' ? e.v : e.k === 'pline' && e.closed ? e.v : undefined;
  if (!v || v.length < 3) return undefined;
  const bulges = v.map((p) => p[2] || 0);
  return { points: v.map((p) => [p[0], p[1]] as Pt), ...(bulges.some(Boolean) ? { bulges } : {}) };
}

const BOARD_ATTRIBUTES = ['TAG', 'BOARD', 'PANEL', 'DB', 'DB_REF', 'BOARD_ID', 'PANEL_ID'];
const CCT_ATTRIBUTES = ['CCT', 'CIRCUIT', 'CKT', 'CCT_REF', 'CIRCUIT_REF'];
const ROOM_NAME_ATTRIBUTES = ['NAME', 'ROOM', 'ROOM_NAME', 'ROOMNAME', 'SPACE', 'SPACE_NAME', 'ROOM-NAME'];
const ROOM_NUMBER_ATTRIBUTES = ['NO', 'NUMBER', 'ROOM_NO', 'ROOM_NUMBER', 'ROOMNO', 'NUM', 'ROOM-NO'];
const attributeOf = (attributes: Record<string, string>, names: string[]): string | undefined => {
  const key = Object.keys(attributes).find((k) => names.includes(k.trim().toUpperCase()));
  return (key && attributes[key].trim()) || undefined;
};

/** What a floor plan says, as the CAD dialogs read it (same as the OpenCADStudio link): board symbols, room outlines,
 * texts, room tags and fixtures, with per-layer counts. Curves are returned only for `curveLayers` (an architect's plan
 * has many thousands of wall lines), plus any curve linked to a route or a tray. */
export function planFromDrawing(d: CadDrawing, options: { curveLayers?: string[]; file?: string; units?: number } = {}): CadPlan {
  const curveLayers = new Set((options.curveLayers ?? []).map((l) => l.toLowerCase()));
  const plan: Required<Pick<CadPlan, 'places' | 'symbols' | 'outlines' | 'texts' | 'tags' | 'curves' | 'fixtures'>> = { places: [], symbols: [], outlines: [], texts: [], tags: [], curves: [], fixtures: [] };
  const layers = new Map<string, CadLayerStats>();
  const count = (layer: string, kind: keyof Omit<CadLayerStats, 'name'>) => {
    const at = layers.get(layer) ?? { name: layer, outlines: 0, curves: 0, texts: 0, blocks: 0, hatches: 0 };
    at[kind] += 1;
    layers.set(layer, at);
  };
  for (const e of d.entities) {
    const tag = tagOf(e);
    const layer = e.l;
    if (e.k === 'insert') {
      count(layer, 'blocks');
      const [x, y] = e.at;
      if (tag?.startsWith('place:')) plan.places.push({ boardId: tag.slice('place:'.length), x, y });
      const board = attributeOf(e.attrs, BOARD_ATTRIBUTES);
      if (board) plan.symbols.push({ name: board, x, y });
      const cct = attributeOf(e.attrs, CCT_ATTRIBUTES);
      if (cct) plan.fixtures.push({ x, y, cct });
      const name = attributeOf(e.attrs, ROOM_NAME_ATTRIBUTES), number = attributeOf(e.attrs, ROOM_NUMBER_ATTRIBUTES);
      if (name || number) plan.tags.push({ layer, x, y, ...(name ? { name } : {}), ...(number ? { number } : {}) });
      continue;
    }
    if (e.k === 'text') {
      const text = e.s.trim();
      if (text) { plan.texts.push({ layer, x: e.at[0], y: e.at[1], text }); count(layer, 'texts'); }
      continue;
    }
    const outline = closedOutline(e);
    if (outline) {
      plan.outlines.push({ layer, handle: e.h, ...outline });
      count(layer, e.k === 'hatch' ? 'hatches' : 'outlines');
      continue;
    }
    if (e.k === 'hatch') continue;
    count(layer, 'curves');
    const linked = tag && (tag.startsWith('route:') || tag.startsWith('tray:'));
    if (linked || curveLayers.has(layer.toLowerCase())) {
      const points = curvePoints(e);
      if (points) plan.curves.push({ layer, points, length: curveLength(e), ...(linked ? { tag } : {}) });
    }
  }
  return { units: options.units ?? d.units, ...(options.file ? { file: options.file } : {}), ...plan, layers: [...layers.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Blocks placed in the drawing (light fittings, sockets…) with their attribute values, for Loads from CAD. */
export const blocksFromDrawing = (d: CadDrawing): CadBlock[] =>
  d.entities.flatMap((e) => (e.k === 'insert' ? [{ block: e.name, attributes: { ...e.attrs } }] : []));

/** Tray runs ("tray:<name>") and cable routes ("route:<feeder id>") of the drawing as paths, for Tray routes from CAD. */
export function traysFromDrawing(d: CadDrawing): CadTrayPlan {
  const out: CadTrayPlan = { units: d.units, trays: [], routes: [] };
  for (const e of d.entities) {
    const tag = tagOf(e);
    if (!tag || !(tag.startsWith('tray:') || tag.startsWith('route:'))) continue;
    const points = curvePoints(e);
    if (!points) continue;
    if (tag.startsWith('tray:')) out.trays.push({ name: tag.slice('tray:'.length), points, length: curveLength(e) });
    else out.routes.push({ feederId: tag.slice('route:'.length), points });
  }
  return out;
}

/** Parses the reader's JSON answer: the drawing, or the reader's own error. */
export function parseReaderAnswer(json: string): CadDrawing {
  const answer = JSON.parse(json) as { ok: true; drawing: CadDrawing } | { ok: false; error: string };
  if (!answer.ok) throw new Error(`The drawing could not be read: ${answer.error}`);
  return answer.drawing;
}
