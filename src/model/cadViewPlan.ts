import type { CadObject, CadView } from '../engines/cad/cadEngine';
import type { CadLayerStats, CadPlan } from './cadPlaces';

type Pt = [number, number];

/** A Design CAD drawing read as a plan for the room reader (src/model/cadRooms.ts roomsFromPlan): its closed outlines
 * (absolute drawing units) and texts by layer, and what each layer holds for guessing its role. */

/** The corners of a closed object: the start of each drawn segment along its first loop (arcs come tessellated; a
 * hatch's islands are left out). */
export function outlinePoints(view: CadView, o: CadObject): Pt[] {
  const [ox, oy] = view.info.origin, s = view.segs;
  const pts: Pt[] = [];
  for (let i = o.seg_start; i < o.seg_end; i += 1) {
    if (pts.length && i > o.seg_start && (s[i * 4] !== s[i * 4 - 2] || s[i * 4 + 1] !== s[i * 4 - 1])) break; // the loop ended
    pts.push([s[i * 4] + ox, s[i * 4 + 1] + oy]);
  }
  return pts;
}

/** The path of a drawn object (a line, polyline, arc…) along its segments, end to end, in absolute drawing units. */
export function objectPath(view: CadView, o: CadObject): Pt[] {
  const [ox, oy] = view.info.origin, s = view.segs;
  const pts: Pt[] = [];
  for (let i = o.seg_start; i < o.seg_end; i += 1) {
    if (pts.length && (s[i * 4] + ox !== pts[pts.length - 1][0] || s[i * 4 + 1] + oy !== pts[pts.length - 1][1])) break; // a second piece
    if (!pts.length) pts.push([s[i * 4] + ox, s[i * 4 + 1] + oy]);
    pts.push([s[i * 4 + 2] + ox, s[i * 4 + 3] + oy]);
  }
  return pts;
}

/** What each layer of the drawing holds (only layers that hold something). */
export function layerStatsOf(view: CadView): CadLayerStats[] {
  const closed = view.outlines();
  return view.info.layers.map((l, i) => ({
    name: l.name, curves: l.count, texts: view.info.texts.filter((t) => t.layer === i).length,
    outlines: closed.filter((o) => o.layer === i && o.kind !== 'Hatch').length, hatches: closed.filter((o) => o.layer === i && o.kind === 'Hatch').length, blocks: 0
  })).filter((l) => l.curves + l.texts > 0);
}

/** The drawing as a plan: outlines on shown layers, texts, layer stats; `units` is the INSUNITS code to read it in. */
export function planOfView(view: CadView, units: number, layersOn: Uint8Array): CadPlan {
  const name = (i: number) => view.info.layers[i]?.name ?? '';
  const on = (i: number) => layersOn[i] !== 0;
  return {
    units, file: view.file, places: [], symbols: [],
    outlines: view.outlines().filter((o) => on(o.layer)).map((o) => ({ layer: name(o.layer), handle: o.handle, points: outlinePoints(view, o) })).filter((o) => o.points.length >= 3),
    texts: view.info.texts.filter((t) => on(t.layer)).map((t) => ({ layer: name(t.layer), x: t.x, y: t.y, text: t.s })),
    layers: layerStatsOf(view)
  };
}
