import type { DrawingSet, DrawingSheet, PlanType } from './drawingSet';
import type { Project } from '../types';

/** Design CAD → layouts (paper space): a plan sheet is a layout of its level's model, a paper with its title block and
 * one or more viewports. A viewport is a rectangle on the paper (mm, in the sheet's drawing area, y down) showing the
 * model around a centre (metres) at a scale: the plan at 1:100, a key plan at 1:500. It can show another plan type,
 * freeze layers and hide references for itself only, and its frame does not print unless asked. A plan sheet without
 * viewports has one, worked out from the level (src/docs/planLayout.ts layoutViewports), and prints as before. 2D only. */

type Pt = [number, number];
export interface PlanViewport {
  id: string;
  /** On the paper: left, top, width, height (mm, in the drawing area). */
  box: [number, number, number, number];
  /** The model point at the viewport's centre (metres). */
  at: Pt;
  /** 1:scale. */
  scale: number;
  /** Pan and zoom inside it leave its view alone (default). */
  locked?: boolean;
  /** Another plan type than the sheet's (blank = the sheet's). */
  shows?: PlanType;
  /** Layers frozen in this viewport only: drawn layers, and reference layers as NAME|LAYER. */
  frozen?: string[];
  /** References not shown in this viewport (by name). */
  refsOff?: string[];
  /** Its frame prints (default: on screen only). */
  frame?: boolean;
}

/** Scales offered for a viewport. */
export const VP_SCALES = [20, 50, 100, 200, 500, 1000];

export const isLocked = (v: PlanViewport) => v.locked !== false;

/** The model window a viewport shows (metres). */
export function vpWindow(v: PlanViewport): { x0: number; y0: number; x1: number; y1: number } {
  const hw = (v.box[2] * v.scale) / 2000, hh = (v.box[3] * v.scale) / 2000;
  return { x0: v.at[0] - hw, x1: v.at[0] + hw, y0: v.at[1] - hh, y1: v.at[1] + hh };
}
/** A model point (metres) on the paper (mm, drawing area). */
export function vpToPaper(v: PlanViewport, [x, y]: Pt): Pt {
  const f = 1000 / v.scale;
  return [v.box[0] + v.box[2] / 2 + (x - v.at[0]) * f, v.box[1] + v.box[3] / 2 - (y - v.at[1]) * f];
}
/** A paper point (mm, drawing area) in the model (metres). */
export function vpToModel(v: PlanViewport, [x, y]: Pt): Pt {
  const k = v.scale / 1000;
  return [v.at[0] + (x - v.box[0] - v.box[2] / 2) * k, v.at[1] - (y - v.box[1] - v.box[3] / 2) * k];
}
/** Whether a paper point is inside the viewport's frame. */
export const insideVp = (v: PlanViewport, [x, y]: Pt) => x >= v.box[0] && x <= v.box[0] + v.box[2] && y >= v.box[1] && y <= v.box[1] + v.box[3];

/** A rectangle from two corners picked on the paper (mm). */
export const boxFrom = (a: Pt, b: Pt): PlanViewport['box'] => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];

/** A new viewport id on the sheet. */
export function vpId(list: PlanViewport[]): string {
  for (let i = 1; ; i++) if (!list.some((v) => v.id === `vp${i}`)) return `vp${i}`;
}
/** Its name on screen: Viewport 1, 2 … in the sheet's order. */
export const vpName = (list: PlanViewport[], id: string) => `Viewport ${list.findIndex((v) => v.id === id) + 1}`;

/** The set with the sheet's viewports replaced (none left: back to the worked-out one). */
export function withViewports(set: DrawingSet, sheetId: string, list: PlanViewport[] | undefined): DrawingSet {
  return { ...set, sheets: set.sheets.map((s): DrawingSheet => {
    if (s.id !== sheetId) return s;
    const { viewports: _old, ...rest } = s;
    return list && list.length ? { ...rest, viewports: list } : rest;
  }) };
}
/** A viewport changed; `undefined` in the patch clears a field. */
export function patchViewport(list: PlanViewport[], id: string, patch: Partial<PlanViewport>): PlanViewport[] {
  return list.map((v) => {
    if (v.id !== id) return v;
    const next = { ...v, ...patch } as PlanViewport & Record<string, unknown>;
    for (const k of Object.keys(patch)) if ((patch as Record<string, unknown>)[k] === undefined) delete next[k];
    return next;
  });
}
/** A layer frozen in the viewport, or thawed (case ignored). */
export function toggleFrozen(v: PlanViewport, layer: string): Partial<PlanViewport> {
  const has = (v.frozen ?? []).some((l) => l.toLowerCase() === layer.toLowerCase());
  const frozen = has ? (v.frozen ?? []).filter((l) => l.toLowerCase() !== layer.toLowerCase()) : [...(v.frozen ?? []), layer];
  return { frozen: frozen.length ? frozen : undefined };
}
export const isFrozen = (v: Pick<PlanViewport, 'frozen'>, layer: string) => (v.frozen ?? []).some((l) => l.toLowerCase() === layer.toLowerCase());

/** Viewport arrangements (VPORTS): frames as fractions of the region (left, top, width, height), the main one first. */
export interface VpArrangement { id: string; label: string; title: string; boxes: [number, number, number, number][] }
export const VP_ARRANGEMENTS: VpArrangement[] = [
  { id: '1', label: 'Single', title: 'One viewport filling the paper', boxes: [[0, 0, 1, 1]] },
  { id: '2V', label: 'Two: side by side', title: 'Two viewports next to each other, each half the width', boxes: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: '2H', label: 'Two: stacked', title: 'Two viewports one above the other, each half the height', boxes: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: '3L', label: 'Three: large on the left', title: 'A large viewport on the left and two small ones stacked on the right', boxes: [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]] },
  { id: '3R', label: 'Three: large on the right', title: 'A large viewport on the right and two small ones stacked on the left', boxes: [[1 / 3, 0, 2 / 3, 1], [0, 0, 1 / 3, 0.5], [0, 0.5, 1 / 3, 0.5]] },
  { id: '3A', label: 'Three: large above', title: 'A large viewport on top and two small ones side by side below it', boxes: [[0, 0, 1, 2 / 3], [0, 2 / 3, 0.5, 1 / 3], [0.5, 2 / 3, 0.5, 1 / 3]] },
  { id: '3B', label: 'Three: large below', title: 'A large viewport at the bottom and two small ones side by side above it', boxes: [[0, 1 / 3, 1, 2 / 3], [0, 0, 0.5, 1 / 3], [0.5, 0, 0.5, 1 / 3]] },
  { id: '4', label: 'Four: equal', title: 'Four viewports of the same size, two by two', boxes: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: 'KEY', label: 'Plan and key plan', title: 'A large plan with a small key plan at the top right; the space under it is free for the legend and notes', boxes: [[0, 0, 0.78, 1], [0.78, 0, 0.22, 0.25]] }
];
/** The gap left between the viewports of an arrangement (mm). */
export const VP_GAP_MM = 5;
export const arrangementOf = (id: string) => VP_ARRANGEMENTS.find((a) => a.id === id.toUpperCase());
const r1 = (x: number) => Math.round(x * 10) / 10;
/** An arrangement's frames in a region of the paper (mm: left, top, width, height), a gap between neighbours (edges on the region's edge stay there). Rounded to 0.1 mm. */
export function arrangeBoxes(a: VpArrangement, region: [number, number, number, number], gap = VP_GAP_MM): PlanViewport['box'][] {
  const [rx, ry, rw, rh] = region, e = 1e-9;
  return a.boxes.map(([fx, fy, fw, fh]) => {
    const x0 = rx + fx * rw + (fx > e ? gap / 2 : 0), x1 = rx + (fx + fw) * rw - (fx + fw < 1 - e ? gap / 2 : 0);
    const y0 = ry + fy * rh + (fy > e ? gap / 2 : 0), y1 = ry + (fy + fh) * rh - (fy + fh < 1 - e ? gap / 2 : 0);
    return [r1(x0), r1(y0), r1(x1 - x0), r1(y1 - y0)];
  });
}
/** A key plan's scale for a plan at 1:scale: the first of 200, 500, 1000, 2000, 5000 at five times it or more. */
export const keyScale = (scale: number) => [200, 500, 1000, 2000, 5000].find((k) => k >= scale * 5) ?? scale * 5;
/** The layout's viewports in an arrangement: those there keep their view (scale, centre, layers) and take the frames in order; missing ones are added showing what the first shows (a key plan at keyScale, centred on `centre`); those over are dropped. */
export function arrangeViewports(list: PlanViewport[], a: VpArrangement, region: [number, number, number, number], fallback: { at: Pt; scale: number }, centre?: Pt): PlanViewport[] {
  const boxes = arrangeBoxes(a, region), main = list[0] ?? { at: fallback.at, scale: fallback.scale };
  const out: PlanViewport[] = [];
  boxes.forEach((box, i) => {
    if (list[i]) { out.push({ ...list[i], box }); return; }
    const v: PlanViewport = { id: vpId(out.concat(list)), box, at: main.at, scale: main.scale };
    if (a.id === 'KEY' && i === 1) { v.at = centre ?? main.at; v.scale = keyScale(main.scale); }
    out.push(v);
  });
  return out;
}
/** A copy of a viewport, 10 mm right and down, kept inside the drawing area. */
export function copyViewport(list: PlanViewport[], id: string, area: { w: number; h: number }): PlanViewport[] {
  const v = list.find((x) => x.id === id);
  if (!v) return list;
  const x = Math.max(0, Math.min(v.box[0] + 10, area.w - v.box[2])), y = Math.max(0, Math.min(v.box[1] + 10, area.h - v.box[3]));
  return [...list, { ...v, id: vpId(list), box: [r1(x), r1(y), v.box[2], v.box[3]] }];
}
/** The view that shows a whole extent (metres) in the viewport: centred on it, at the smallest of `scales` that fits (else the next round hundred). */
export function fitView(v: PlanViewport, ext: { x0: number; y0: number; x1: number; y1: number }, scales: number[]): { at: Pt; scale: number } {
  const need = Math.max(((ext.x1 - ext.x0) * 1000) / v.box[2], ((ext.y1 - ext.y0) * 1000) / v.box[3]);
  const scale = [...scales].sort((p, q) => p - q).find((n) => n >= need) ?? Math.ceil(need / 100) * 100;
  return { at: [(ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2], scale };
}
/** Where a viewport's centre goes so its view lines up with a base viewport's: 'h' (side by side: the same model height on one paper line) or 'v' (stacked: the same model x on one paper column). */
export function alignView(base: PlanViewport, v: PlanViewport, dir: 'h' | 'v'): Pt {
  const c1x = base.box[0] + base.box[2] / 2, c1y = base.box[1] + base.box[3] / 2, c2x = v.box[0] + v.box[2] / 2, c2y = v.box[1] + v.box[3] / 2;
  return dir === 'h' ? [v.at[0], base.at[1] - ((c2y - c1y) * v.scale) / 1000] : [base.at[0] + ((c2x - c1x) * v.scale) / 1000, v.at[1]];
}
/** More standard scales the scale list can offer (SCALELISTEDIT), beside VP_SCALES. */
export const MORE_SCALES = [1, 2, 5, 10, 25, 75, 125, 150, 250, 1250, 2500];
/** The scales offered for viewports in this project: its own list, else VP_SCALES. Ascending, no repeats. */
export const scalesOf = (p: Pick<Project, 'plot'>): number[] => {
  const own = p.plot?.scales?.filter((n) => Number.isFinite(n) && n > 0);
  return own?.length ? [...new Set(own)].sort((a, b) => a - b) : VP_SCALES;
};
/** The project with its scale list set (the default list: the entry goes). */
export function withScales(p: Project, list: number[]): Project {
  const clean = [...new Set(list.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  const { scales: _old, ...rest } = p.plot ?? {};
  const plot = clean.length && JSON.stringify(clean) !== JSON.stringify(VP_SCALES) ? { ...rest, scales: clean } : rest;
  const { plot: _p, ...base } = p;
  return Object.keys(plot).length ? { ...base, plot } : base;
}
