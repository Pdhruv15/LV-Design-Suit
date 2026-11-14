import type { FileLayout } from '../engines/cad/cadEngine';
import type { Project } from '../types';
import { DEFAULT_EDGE_MM, DEFAULT_PAPER } from './fileLayouts';
import { arrangeBoxes, keyScale, type VpArrangement } from './planViewports';

/** Layouts made in Design CAD on a drawing (+ under the drawing: Layout2, Layout3…), kept in the project by drawing file;
 * the drawing file is never changed. Each is a paper with viewports onto the model, shown as the file's own layouts are
 * (CadFilePaper), and is not a project sheet: plan sheets of a level are made from a tab's right-click menu. */

/** A viewport on the paper: its frame in mm from the paper's lower left corner, the model point at its centre and the
 * model height it shows (drawing units). */
export interface DrawingViewport { x: number; y: number; w: number; h: number; cx: number; cy: number; vh: number }
export interface DrawingLayout { name: string; paper: [number, number]; viewports: DrawingViewport[] }

/** Space left round a new layout's viewport (mm from each paper edge). */
export const VIEWPORT_INSET_MM = 10;
/** Scales a new viewport is set to (1:n): the largest that fits the whole drawing. */
const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 1250, 2000, 2500, 5000, 10000];

/** The tab id of a drawing layout; never the id of a project sheet or of the file's own layout. */
export const drawingLayoutId = (name: string) => `dwg:${name}`;
const key = (file: string) => file.toLowerCase();
export const drawingLayoutsOf = (p: Project, file: string | undefined): DrawingLayout[] => (file ? p.cadLayouts?.[key(file)] ?? [] : []);
export const drawingLayoutOf = (list: DrawingLayout[], id: string | null | undefined): DrawingLayout | undefined =>
  id?.startsWith('dwg:') ? list.find((l) => drawingLayoutId(l.name) === id) : undefined;

/** The project with the drawing's layouts replaced (none: the entry goes). */
export function withDrawingLayouts(p: Project, file: string, list: DrawingLayout[]): Project {
  const { [key(file)]: _gone, ...rest } = p.cadLayouts ?? {};
  const all = list.length ? { ...rest, [key(file)]: list } : rest;
  const { cadLayouts: _c, ...base } = p;
  return Object.keys(all).length ? { ...base, cadLayouts: all } : base;
}

/** The first "LayoutN" not taken (case ignored), from Layout1. */
export function nextLayoutName(taken: string[]): string {
  const t = new Set(taken.map((n) => n.toLowerCase()));
  let n = 1;
  while (t.has(`layout${n}`)) n += 1;
  return `Layout${n}`;
}

/** The standard scale 1:n at which the model extents fit a frame w × h mm (mmPerUnit: model mm per drawing unit). */
export function fitScale(ext: [number, number, number, number], w: number, h: number, mmPerUnit: number): number {
  const ew = (ext[2] - ext[0]) * mmPerUnit, eh = (ext[3] - ext[1]) * mmPerUnit;
  if (!(ew > 0) && !(eh > 0)) return 100;
  const need = Math.max(ew / w, eh / h);
  return SCALES.find((n) => n >= need) ?? Math.ceil(need / 1000) * 1000;
}

/** A new layout: A3 landscape with one viewport filling it inside a margin, the whole drawing in it at a standard scale. */
export function newDrawingLayout(name: string, ext: [number, number, number, number], mmPerUnit: number): DrawingLayout {
  const [pw, ph] = DEFAULT_PAPER, m = VIEWPORT_INSET_MM, w = pw - 2 * m, h = ph - 2 * m;
  const n = fitScale(ext, w, h, mmPerUnit), mpu = mmPerUnit > 0 ? mmPerUnit : 1;
  const ok = Number.isFinite(ext[0]) && ext[2] >= ext[0];
  return { name, paper: [pw, ph], viewports: [{ x: m, y: m, w, h, cx: ok ? (ext[0] + ext[2]) / 2 : 0, cy: ok ? (ext[1] + ext[3]) / 2 : 0, vh: (h * n) / mpu }] };
}

/** A drawing layout in the shape of the file's own, for CadFilePaper and the status bar: paper mm, nothing on the paper. */
export function asFileLayout(l: DrawingLayout, tab: number): FileLayout {
  const e = DEFAULT_EDGE_MM;
  return {
    name: l.name, tab, paper: l.paper, margins: [e, e, e, e], at: [0, 0], mm_per_unit: 1,
    viewports: l.viewports.map((v) => ({ ...v, locked: false, on: true })),
    origin: [0, 0], segs: new Float32Array(0), segColors: new Uint32Array(0), segLayers: new Uint16Array(0), texts: [], layers: []
  };
}

/** Papers a layout can have (landscape, mm). */
export const LAYOUT_PAPERS: { id: string; mm: [number, number] }[] = [
  { id: 'A4', mm: [297, 210] }, { id: 'A3', mm: [420, 297] }, { id: 'A2', mm: [594, 420] }, { id: 'A1', mm: [841, 594] }, { id: 'A0', mm: [1189, 841] }
];
/** "A3 landscape", "A1 portrait", or "500 × 300 mm" for a paper not in the list (±1 mm). */
export function paperName(paper: [number, number]): string {
  for (const { id, mm } of LAYOUT_PAPERS) {
    if (Math.abs(paper[0] - mm[0]) <= 1 && Math.abs(paper[1] - mm[1]) <= 1) return `${id} landscape`;
    if (Math.abs(paper[0] - mm[1]) <= 1 && Math.abs(paper[1] - mm[0]) <= 1) return `${id} portrait`;
  }
  return `${Math.round(paper[0])} × ${Math.round(paper[1])} mm`;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
/** The layout on another paper: its viewports keep their place in proportion, their centres and their scales. */
export function withPaper(l: DrawingLayout, paper: [number, number]): DrawingLayout {
  const sx = paper[0] / l.paper[0], sy = paper[1] / l.paper[1];
  return { ...l, paper, viewports: l.viewports.map((v) => ({ ...v, x: r1(v.x * sx), y: r1(v.y * sy), w: r1(v.w * sx), h: r1(v.h * sy), vh: v.vh * sy })) };
}
/** The layout's viewports in an arrangement (src/model/planViewports.ts), inside the paper's margin: those there keep their centre and scale; new ones show the whole drawing at the scale it fits (a key plan at keyScale of that). */
export function arrangeDrawingViewports(l: DrawingLayout, a: VpArrangement, ext: [number, number, number, number], mmPerUnit: number): DrawingLayout {
  const [pw, ph] = l.paper, I = VIEWPORT_INSET_MM, mpu = mmPerUnit > 0 ? mmPerUnit : 1;
  const ok = Number.isFinite(ext[0]) && ext[2] >= ext[0];
  const cx = ok ? (ext[0] + ext[2]) / 2 : 0, cy = ok ? (ext[1] + ext[3]) / 2 : 0;
  const boxes = arrangeBoxes(a, [I, I, pw - 2 * I, ph - 2 * I]);
  const viewports = boxes.map(([bx, by, bw, bh], i): DrawingViewport => {
    const x = bx, y = r1(ph - (by + bh)), old = l.viewports[i];
    if (old) return { ...old, x, y, w: bw, h: bh, vh: old.h > 0 ? (old.vh * bh) / old.h : old.vh };
    const n = fitScale(ext, bw, bh, mmPerUnit), sc = a.id === 'KEY' && i === 1 ? keyScale(n) : n;
    return { x, y, w: bw, h: bh, cx, cy, vh: (bh * sc) / mpu };
  });
  return { ...l, viewports };
}
/** Every viewport showing the whole drawing, centred, at the standard scale it fits. */
export function fitDrawingViewports(l: DrawingLayout, ext: [number, number, number, number], mmPerUnit: number): DrawingLayout {
  const mpu = mmPerUnit > 0 ? mmPerUnit : 1, ok = Number.isFinite(ext[0]) && ext[2] >= ext[0];
  return { ...l, viewports: l.viewports.map((v) => ({ ...v, cx: ok ? (ext[0] + ext[2]) / 2 : v.cx, cy: ok ? (ext[1] + ext[3]) / 2 : v.cy, vh: (v.h * fitScale(ext, v.w, v.h, mmPerUnit)) / mpu })) };
}
/** A viewport's scale 1:n (rounded), from its frame and the model height it shows. */
export const viewportScaleN = (v: DrawingViewport, mmPerUnit: number) => (v.h > 0 ? Math.round((v.vh * mmPerUnit) / v.h) : 0);
