import { buildingInfoOf, floorsOf } from '../calc/building';
import { cableSizeText } from '../calc/electrical';
import { circuitCategory } from '../calc/loadSchedule';
import { cableLabel, EMERGENCY_ITEMS, LV_PALETTE } from '../model/cadDevices';
import { planOfLevel } from '../model/cadPlans';
import { printedRefs } from '../model/cadRefs';
import { isFrozen, vpWindow, type PlanViewport } from '../model/planViewports';
import { dimOf, scaleLook, segmentsOf, sketchOf, trayLabel, trayLength, trayLine } from '../model/cadSketch';
import { effective, layerStylesOf, styleOf } from '../model/cadLayerStyle';
import { annoOf } from '../model/cadAnnotate';
import { textBaseAt, textCorners } from '../model/cadText';
import { noteBox, noteSegAt } from '../model/cadMtext';
import { pointMark, pointStyleOf } from '../model/cadPoints';
import { attdefAsText, blockDefsOf, expandAll } from '../model/cadBlocks';
import { atOrigin, dotsOnly, hatchDots, hatchStrokes, mirroredY, defOf, placedLines } from '../model/cadHatch';
import { fittingCounts, trayFittings } from '../model/cadTrayFittings';
import { planScale as unitsOf } from '../model/cadUnits';
import { arcPoints, levelWiring } from '../model/cadWiring';
import { PLAN_PREFIX, renumber, startStatus, type DrawingSet, type DrawingSheet, type PlanType, type SheetSize } from '../model/drawingSet';
import { borderOf, templateOf, templateSize } from '../model/titleBlock';
import { tablesOf, type TableKind } from '../model/sheetTables';
import { fillParams } from '../model/params';
import { elvPlanSymbols } from '../components/elv/elvPlanSymbols';
import type { Project, SketchItem } from '../types';
import { escapeHtmlText as esc } from '../util/escape';
import { txt } from '../util/format';
import { furnitureScale, SHEET_MM } from './sldSheet';
import { inkOf, pensFor, plotOf, type Pen, type PenKey } from '../model/plotSetup';

/** Design CAD → Sheets → Plans: a level's lighting, power, ELV or containment layout as a drawing sheet at a true scale
 * (1:100 unless the sheet's scale says 1:50 or 1:200), made from the design, so a design change shows on the sheet.
 * - The architect's plan (the level's room outlines and names) prints in grey, the design in black: devices, DBs, and
 *   on the lighting and power layouts each wired circuit's wiring, home run and tag (Design CAD → Plan → Wiring).
 *   Lighting circuits go on the lighting layout, every other circuit on the power layout.
 * - The containment layout draws the tray runs and cable routes drawn on the level's plan file, with the level's DBs: a
 *   tray is a heavy single line broken for its label ("CT 300 POWER · A", as on the plan), a route dashed and tagged
 *   with its cable and size. The legend counts the tray lengths and fittings on the sheet.
 * - Every plan sheet also prints the drawn work on the level's plan file (Design CAD lines, arcs, circles, hatches, text,
 *   dimensions, leaders, room tags), unless its page setup leaves it off: black, at each object's linetype and lineweight
 *   (else its layer's, else the drawn-lines pen), hatches with the hatch pen (Solid light grey). Layers that are off or
 *   set not to print stay off. The drawn work alone does not make a level's sheet.
 * - Paper: the smallest of A3, A2, A1 that holds the level at the scale. A level too big for A1 is split into parts
 *   over several sheets, each with a key plan (its part shaded) and match lines naming the sheet next to it.
 * - The drawing is in paper millimetres sized to the sheet's drawing area, so it prints at the scale. Title, scale
 *   bar and north arrow under the plan; legend of the symbols used (and the key plan) in the legend column.
 * Black and white, like every report. */

type Pt = [number, number];
interface Box { x0: number; y0: number; x1: number; y1: number }

export const PLAN_LABEL: Record<PlanType, string> = { lighting: 'Lighting layout', power: 'Power layout', elv: 'ELV layout', containment: 'Containment layout' };
export const PLAN_TYPES = Object.keys(PLAN_PREFIX) as PlanType[];
const SIZES: SheetSize[] = ['A3', 'A2', 'A1'];
const MARGIN = 4, STRIP = 14; // mm: around the plan, and the strip under it (title, scale bar, north arrow)
const R = 1.8; // symbol radius on paper (mm)
const TAG = 2.5; // tray and cable text on paper (mm)
const GREY = '#8c8c8c';

/** "1:50" → 50; blank → 100. */
export const planScale = (s?: string) => { const n = Number(/1\s*:\s*(\d+)/.exec(s ?? '')?.[1]); return n > 0 ? n : 100; };

/** The drawing area of a sheet (mm) beside the legend column and above the title block, as src/docs/sldSheet.ts lays
 * it out: the plan is drawn to exactly this size so it prints at its scale. */
export function drawingAreaMm(p: Project, size: SheetSize): { w: number; h: number } {
  const border = borderOf(p, size); // a whole-border template: inside its drawing area, beside the column
  if (border) return { w: +(border.border.area.w - 6 - 92).toFixed(2), h: +(border.border.area.h - 3).toFixed(2) };
  const custom = templateOf(p, 'plan');
  const k = furnitureScale(size, custom ? templateSize(custom) : undefined);
  const { w, h } = SHEET_MM[size];
  return { w: w - 36 - 92 * k, h: h - 23 - 44 * k };
}

/** Where the sheet's notes box starts across the drawing area (mm): it lies over the area's bottom right, as wide as the
 * title block under it. */
function notesLeftMm(p: Project, size: SheetSize): number {
  const border = borderOf(p, size);
  if (border) return border.border.area.x + border.border.area.w - 23 - 180;
  const custom = templateOf(p, 'plan');
  return SHEET_MM[size].w - 33 - (custom ? templateSize(custom).w : 180) * furnitureScale(size, custom ? templateSize(custom) : undefined);
}

interface Mark { x: number; y: number; key: string; label: string; svg: (x: number, y: number, r: number) => string }
/** `trays` and `cables` are the drawn runs in metres; a cable's `text` is its tag. */
interface Content { marks: Mark[]; boards: { x: number; y: number; id: string }[]; wiring: Pt[][]; homes: Pt[][]; tags: { at: Pt; text: string }[]; trays: SketchItem[]; cables: SketchItem[] }

const ink = (body: string) => `<g fill="#fff" stroke="#000" stroke-width="0.25">${body}</g>`;
/** An LV point's plan symbol (the CAD palette's shapes): a light is a circle with a cross, a socket a box … */
function lvSymbol(shape: string, text: string, x: number, y: number, r: number): string {
  const label = text ? `<text x="${x}" y="${y}" font-size="${(text.length > 1 ? 0.8 : 1.05) * r}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#000" stroke="none">${esc(text)}</text>` : '';
  if (shape === 'rect' || shape === 'twin') return ink(`<rect x="${x - r}" y="${y - 0.6 * r}" width="${2 * r}" height="${1.2 * r}"/>${shape === 'twin' ? `<line x1="${x}" y1="${y - 0.6 * r}" x2="${x}" y2="${y + 0.6 * r}"/>` : ''}${label}`);
  if (shape === 'square') return ink(`<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"/>${label}`);
  const k = r * 0.7;
  return ink(`<circle cx="${x}" cy="${y}" r="${r}"/>${shape === 'cross' ? `<path d="M${x - k} ${y - k}L${x + k} ${y + k}M${x - k} ${y + k}L${x + k} ${y - k}"/>` : ''}${label}`);
}
const boardSymbol = (x: number, y: number) => `<g stroke="#000" stroke-width="0.25"><rect x="${x - 2.5}" y="${y - 1.25}" width="5" height="2.5" fill="#fff"/><path d="M${x - 2.5} ${y + 1.25}L${x + 2.5} ${y - 1.25}L${x + 2.5} ${y + 1.25}Z" fill="#000"/></g>`;

const onLevel = (d: { buildingId: string; levelId: string }, b: string, l: string) => d.buildingId === b && d.levelId === l;
const boardsOn = (p: Project, b: string, l: string) => p.boards.flatMap((bd) => (bd.planPoint && bd.level?.building === b && bd.level?.level === l ? [{ x: bd.planPoint.x, y: bd.planPoint.y, id: bd.id }] : []));

/** The tray runs and cable routes drawn on the level's plan file, in metres, and the level's DBs when there are any. A
 * route of a circuit no longer in the design is left off (the plan still shows it, as removed). */
function addContainment(p: Project, out: Content, b: string, l: string) {
  const plan = planOfLevel(p, { building: b, level: l });
  if (!plan) return;
  const k = unitsOf(p, plan.file, plan.units).factor;
  for (const it of sketchOf(p, plan.file)) {
    if (it.pts.length < 2) continue;
    const pts = it.pts.map(([x, y]): Pt => [x * k, y * k]);
    if (it.tray) out.trays.push({ ...it, pts });
    const f = it.cable && p.feeders.find((x) => x.id === it.cable!.feederId);
    if (f) out.cables.push({ ...it, pts, text: `${cableLabel(p, f).split(' · ')[0]} · ${cableSizeText(f)}` });
  }
  if (out.trays.length || out.cables.length) out.boards = boardsOn(p, b, l);
}

/** What the layout shows of a level, in metres on the level's plan. */
function contentOf(p: Project, type: PlanType, b: string, l: string): Content {
  const out: Content = { marks: [], boards: [], wiring: [], homes: [], tags: [], trays: [], cables: [] };
  if (type === 'elv') { out.marks = elvPlanSymbols(p, b, l); return out; }
  if (type === 'containment') { addContainment(p, out, b, l); return out; }
  const wanted = (feederId: string) => { const f = p.feeders.find((x) => x.id === feederId); return !!f && (circuitCategory(f) === 'lighting') === (type === 'lighting'); };
  for (const d of p.lvPoints ?? []) {
    if (!onLevel(d, b, l) || !wanted(d.feederId)) continue;
    const pal = d.emergency ? EMERGENCY_ITEMS[d.emergency] : LV_PALETTE.find((x) => x.id === d.type);
    const shape = pal?.symbol.shape ?? 'circle', text = pal ? pal.symbol.text : d.type.toUpperCase();
    out.marks.push({ x: d.x, y: d.y, key: d.emergency ? `lv:em:${d.emergency}` : `lv:${d.type}`, label: pal?.label ?? d.type.toUpperCase(), svg: (x, y, r) => lvSymbol(shape, text, x, y, r) });
  }
  // The DBs feeding this layout's circuits, and any DB with nothing of either layout yet.
  const used = new Set(p.feeders.filter((f) => (p.lvPoints ?? []).some((d) => d.feederId === f.id && onLevel(d, b, l)) && wanted(f.id)).map((f) => f.boardId));
  out.boards = boardsOn(p, b, l).filter((d) => used.has(d.id) || type === 'power');
  for (const w of levelWiring(p, { building: b, level: l })) {
    if (!wanted(w.feederId)) continue;
    for (const a of w.arcs) out.wiring.push(arcPoints(a));
    if (w.home) out.homes.push(arcPoints(w.home));
    out.tags.push({ at: w.tagAt, text: w.tag });
  }
  return out;
}

const hasContent = (c: Content) => c.marks.length > 0 || c.boards.length > 0 || c.trays.length > 0 || c.cables.length > 0;

/** The levels with something on the layout, in building order, with their names and the floors a typical level
 * stands for. */
export function planLevels(p: Project, type: PlanType): { buildingId: string; levelId: string; name: string; typical: string }[] {
  const info = buildingInfoOf(p);
  const out: { buildingId: string; levelId: string; name: string; typical: string }[] = [];
  for (const b of info.buildings) {
    const tags = new Map<string, string[]>();
    for (const f of floorsOf(info, b)) tags.set(f.level.id, [...(tags.get(f.level.id) ?? []), f.tag]);
    for (const l of b.levels) {
      if (!hasContent(contentOf(p, type, b.id, l.id))) continue;
      const t = tags.get(l.id) ?? [];
      out.push({ buildingId: b.id, levelId: l.id, name: `${info.buildings.length > 1 ? `${b.name} · ` : ''}${l.name}`, typical: (l.count ?? 1) > 1 && t.length > 1 ? `${t[0]}–${t[t.length - 1]}` : '' });
    }
  }
  return out;
}

/** The level's extent (metres): its rooms and what the layout shows, with a metre round it. */
function extentOf(p: Project, c: Content, b: string, l: string, drawn: Drawn[] = []): { box: Box; rooms: { name: string; outline: Pt[] }[] } {
  const rooms = buildingInfoOf(p).rooms.filter((r) => r.buildingId === b && r.levelId === l && r.outline && r.outline.length >= 3).map((r) => ({ name: r.name, outline: r.outline as Pt[] }));
  const pts: Pt[] = [...rooms.flatMap((r) => r.outline), ...c.marks.map((m): Pt => [m.x, m.y]), ...c.boards.map((d): Pt => [d.x, d.y]), ...[...c.trays, ...c.cables].flatMap((r) => r.pts),
    ...drawn.flatMap(({ it }): Pt[] => (it.kind === 'circle' || it.kind === 'arc' ? [[it.pts[0][0] - (it.r ?? 0), it.pts[0][1] - (it.r ?? 0)], [it.pts[0][0] + (it.r ?? 0), it.pts[0][1] + (it.r ?? 0)]] : it.kind === 'ellipse' ? segmentsOf(it).flat() : it.pts))];
  if (!pts.length) pts.push([0, 0]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return { rooms, box: { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 } };
}

export interface PlanFit { size: SheetSize; cols: number; rows: number; parts: number }
/** The paper and the split: the smallest paper that holds the level at the scale (auto), else parts on A1 (or on the
 * chosen paper), in as few columns and rows as fit. */
export function planFit(p: Project, extent: Box, scale: number, size: 'auto' | SheetSize = 'auto'): PlanFit {
  const f = 1000 / scale, bw = (extent.x1 - extent.x0) * f, bh = (extent.y1 - extent.y0) * f;
  const room = (z: SheetSize) => { const a = drawingAreaMm(p, z); return { w: a.w - 2 * MARGIN, h: a.h - 2 * MARGIN - STRIP }; };
  const grid = (z: SheetSize): PlanFit => { const a = room(z), cols = Math.max(1, Math.ceil(bw / a.w - 1e-9)), rows = Math.max(1, Math.ceil(bh / a.h - 1e-9)); return { size: z, cols, rows, parts: cols * rows }; };
  if (size !== 'auto') return grid(size);
  for (const z of SIZES) { const g = grid(z); if (g.parts === 1) return g; }
  return grid('A1');
}

/** The level's layout as the sheet's plan: its fit and extent, or nothing when the sheet names no level with content. */
function layoutOf(p: Project, s: Pick<DrawingSheet, 'plan' | 'buildingId' | 'levelId' | 'scale' | 'size' | 'plot'>) {
  if (!s.plan || !s.buildingId || !s.levelId) return undefined;
  const c = contentOf(p, s.plan, s.buildingId, s.levelId);
  if (!hasContent(c)) return undefined;
  const drawn = plotOf(p, s).drawn === false ? [] : drawnOf(p, s.buildingId, s.levelId);
  const { box, rooms } = extentOf(p, c, s.buildingId, s.levelId, drawn);
  const scale = planScale(s.scale);
  return { c, drawn, refs: refsOnSheet(p, s.buildingId, s.levelId), box, rooms, scale, fit: planFit(p, box, scale, s.size) };
}

/** The references of the level's plan that print (src/model/cadRefs.ts), their lines in metres; one not read in this
 * session cannot print and says so. They do not widen the sheet: what is outside the level's extent is cut off. */
function refsOnSheet(p: Project, b: string, l: string) {
  const plan = planOfLevel(p, { building: b, level: l });
  return plan ? printedRefs(p, plan.file, unitsOf(p, plan.file, plan.units).factor) : [];
}

/** Part i's window on the level (metres): columns left to right, rows top to bottom. */
function windowOf(box: Box, fit: PlanFit, i: number): Box {
  const c = i % fit.cols, r = Math.floor(i / fit.cols), w = (box.x1 - box.x0) / fit.cols, h = (box.y1 - box.y0) / fit.rows;
  return { x0: box.x0 + c * w, x1: box.x0 + (c + 1) * w, y1: box.y1 - r * h, y0: box.y1 - (r + 1) * h };
}

/** A segment cut to the window (Liang–Barsky), or nothing when it lies outside. */
function clip(a: Pt, b: Pt, w: Box): [Pt, Pt] | undefined {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [q, r] of [[-dx, a[0] - w.x0], [dx, w.x1 - a[0]], [-dy, a[1] - w.y0], [dy, w.y1 - a[1]]]) {
    if (Math.abs(q) < 1e-12) { if (r < 0) return undefined; continue; }
    const t = r / q;
    if (q < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return undefined;
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}
const within = ([x, y]: Pt, w: Box) => x >= w.x0 - 1e-9 && x <= w.x1 + 1e-9 && y >= w.y0 - 1e-9 && y <= w.y1 + 1e-9;
const n = (v: number) => +v.toFixed(2);

/** The pieces of a drawn run showing in the window, each with its length and whether it takes a label `width` long: a
 * run split over sheets is labelled on each, unless too little of it shows there for the label to fit. */
function shownPieces(it: SketchItem, win: Box, width: number): { run: SketchItem; m: number; labelled: boolean }[] {
  const paths: Pt[][] = [];
  for (let i = 0; i + 1 < it.pts.length; i++) {
    const k = clip(it.pts[i], it.pts[i + 1], win);
    if (!k) continue;
    const last = paths[paths.length - 1], end = last?.[last.length - 1];
    if (end && Math.hypot(end[0] - k[0][0], end[1] - k[0][1]) < 1e-9) last.push(k[1]); else paths.push([k[0], k[1]]);
  }
  const whole = paths.length === 1 && within(it.pts[0], win) && within(it.pts[it.pts.length - 1], win);
  return paths.map((pts) => { const run = { ...it, pts }, m = trayLength(run); return { run, m, labelled: whole || m >= width }; });
}

/** A route's segments without what lies under the tray labels (each box `w` long along `rot` and `h` high, in metres): a
 * route on a tray would otherwise strike through the tray's label. */
function clearOf(pts: Pt[], labels: { at: Pt; rot: number; w: number }[], h: number): [Pt, Pt][] {
  let segs = pts.slice(1).map((q, i): [Pt, Pt] => [pts[i], q]);
  for (const { at, rot, w } of labels) {
    const cos = Math.cos(rot), sin = Math.sin(rot), box = { x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2 };
    const local = ([x, y]: Pt): Pt => [(x - at[0]) * cos + (y - at[1]) * sin, (y - at[1]) * cos - (x - at[0]) * sin];
    const plan = ([x, y]: Pt): Pt => [at[0] + x * cos - y * sin, at[1] + x * sin + y * cos];
    segs = segs.flatMap(([a, b]): [Pt, Pt][] => {
      const k = clip(local(a), local(b), box);
      return k ? ([[a, plan(k[0])], [plan(k[1]), b]] as [Pt, Pt][]).filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) : [[a, b]];
    });
  }
  return segs;
}

/** A drawn object for the sheet, in metres, with its linetype (dashes in paper mm) and lineweight (mm; 0 = the pen's). */
/** A drawn point carries its style: the marker's shape, and its radius in metres when sized in drawing units. */
interface Drawn { it: SketchItem; dash: number[]; lw: number; pt?: { mode: number; r?: number } }

/** The drawn work on the level's plan file: what was drawn in Design CAD other than trays and cable routes, on layers
 * that are on and print, in metres. */
function drawnOf(p: Project, b: string, l: string): Drawn[] {
  const plan = planOfLevel(p, { building: b, level: l });
  if (!plan) return [];
  const k = unitsOf(p, plan.file, plan.units).factor, styles = layerStylesOf(p, plan.file), ps = pointStyleOf(p);
  const out: Drawn[] = [];
  // An insert prints as what its block shows.
  for (const it0 of expandAll(sketchOf(p, plan.file), blockDefsOf(p, plan.file))) {
    const it = it0.kind === 'attdef' ? attdefAsText(it0) : it0; // an attribute definition prints as its tag
    if (it.tray || it.cable || !it.pts.length) continue;
    const st = styleOf(styles, it.layer);
    if (st.hidden || st.freeze || st.noPrint) continue;
    const ef = effective(it, styles);
    const m: SketchItem = {
      ...it, pts: it.pts.map(([x, y]): Pt => [x * k, y * k]), ...(it.r !== undefined ? { r: it.r * k } : {}), ...(it.h !== undefined ? { h: it.h * k } : {}),
      ...(it.look ? { look: scaleLook(it.look, k) } : {})
    };
    out.push({ it: m, dash: ef.dash, lw: ef.lw, ...(it.kind === 'point' ? { pt: { mode: ps.mode, ...(ps.relative ? {} : { r: (ps.size * k) / 2 }) } } : {}) });
  }
  return out;
}

/** The annotation scale and text height (paper mm) the plan sheet's drawn text was made for, when it has any: Page
 * setup warns when the sheet's scale differs. */
export function drawnTextMm(p: Project, s: Pick<DrawingSheet, 'buildingId' | 'levelId'>): { scale: number; mm: number } | undefined {
  if (!s.buildingId || !s.levelId || !drawnOf(p, s.buildingId, s.levelId).some(({ it }) => it.kind === 'text' || it.kind === 'dim')) return undefined;
  const a = annoOf(p);
  return { scale: a.scale, mm: a.textMm };
}

/** The drawn work in paper mm, clipped to the window: hatches (pattern lines or dots with the hatch pen, Solid light
 * grey), lines at their linetype and lineweight (else the drawn-lines pen; all thin when the sheet prints thin), leader
 * arrows (3 mm), and text at its drawn height. `id` keeps the sheet's clip paths apart from other sheets'. */
function drawnSvg(items: Drawn[], X: (x: number) => number, Y: (y: number) => number, f: number, win: Box, pen: Record<PenKey, Pen>, thin: boolean, id: string): string {
  if (!items.length) return '';
  const P = ([x, y]: Pt) => `${X(x)} ${Y(y)}`, ink = inkOf(pen.sketch), defs: string[] = [], body: string[] = [];
  const text = (at: Pt, s: string, h: number, rot: number, anchor: 'start' | 'middle' | 'end', look: { b?: boolean; u?: boolean } = {}) => {
    if (!s || !(h > 0) || !within(at, win)) return;
    const x = X(at[0]), y = Y(at[1]);
    body.push(`<text x="${x}" y="${y}"${rot ? ` transform="rotate(${n((-rot * 180) / Math.PI)} ${x} ${y})"` : ''} font-size="${n(h * f)}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${look.b ? ' font-weight="bold"' : ''}${look.u ? ' text-decoration="underline"' : ''} fill="${ink}">${esc(s)}</text>`);
  };
  items.forEach(({ it, dash, lw, pt }, i) => {
    if (it.kind === 'point') {
      // A point: its style's marker, 2 mm across when sized to the screen, else at its size in the drawing's units.
      if (!within(it.pts[0], win)) return;
      const r = pt?.r !== undefined ? pt.r * f : 1, mk = pointMark(pt?.mode ?? 0), x = X(it.pts[0][0]), y = Y(it.pts[0][1]);
      const d = mk.lines.map(([a, b]) => `M${n(x + a[0] * r)} ${n(y - a[1] * r)}L${n(x + b[0] * r)} ${n(y - b[1] * r)}`).join('');
      if (d) body.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${n(pen.sketch.w)}"/>`);
      if (mk.circle) body.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke="${ink}" stroke-width="${n(pen.sketch.w)}"/>`);
      if (mk.dot) body.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.max(0.25, r * 0.2))}" fill="${ink}" stroke="none"/>`);
      return;
    }
    if (it.hatch) {
      const circle = it.kind === 'circle', r = (it.r ?? 0) * f, holes = (it.holes ?? []).map((h) => `M${h.map(P).join('L')}Z`).join('');
      // The outline and its islands as one path, filled and clipped even-odd (a circle as two arcs).
      const cx = circle ? X(it.pts[0][0]) : 0, cy = circle ? Y(it.pts[0][1]) : 0;
      const outline = circle ? (holes ? `<path d="M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z${holes}" fill-rule="evenodd"` : `<circle cx="${X(it.pts[0][0])}" cy="${Y(it.pts[0][1])}" r="${n(r)}"`) : `<path d="M${it.pts.map(P).join('L')}Z${holes}" fill-rule="evenodd"`;
      if (defOf(it.hatch).solid) { body.push(`${outline} fill="${inkOf({ w: 0, grey: Math.min(30, pen.hatch.grey) })}" stroke="none"/>`); return; }
      const xs = circle ? [X(it.pts[0][0]) - r, X(it.pts[0][0]) + r] : it.pts.map((q) => X(q[0])), ys = circle ? [Y(it.pts[0][1]) - r, Y(it.pts[0][1]) + r] : it.pts.map((q) => Y(q[1]));
      const box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      // One path for the continuous lines, one per dashed family (its dash array), one for the dots; y is down on paper.
      let lines = '', dots = '';
      const dashed: string[] = [];
      for (const fam of atOrigin(mirroredY(placedLines(it.hatch, 1)), it.hatch.origin ? [X(it.hatch.origin[0]), Y(it.hatch.origin[1])] : undefined)) {
        if (dotsOnly(fam)) { for (const [x, y] of hatchDots(fam, box, 0.2, 20000)) dots += `M${n(x)} ${n(y)}h0`; continue; }
        const { lines: ls, dash } = hatchStrokes(fam, box, 0.2, 4000, 0.2);
        const d = ls.map((l) => `M${n(l.a[0])} ${n(l.a[1])}L${n(l.b[0])} ${n(l.b[1])}`).join('');
        if (!d) continue;
        if (dash.length) dashed.push(`<path d="${d}" clip-path="url(#${id}-${i})" fill="none" stroke="${inkOf(pen.hatch)}" stroke-width="${n(pen.hatch.w)}" stroke-dasharray="${dash.map(n).join(' ')}"/>`);
        else lines += d;
      }
      if (!lines && !dots && !dashed.length) return;
      defs.push(`<clipPath id="${id}-${i}">${outline.replace('fill-rule=', 'clip-rule=')}/></clipPath>`);
      if (lines) body.push(`<path d="${lines}" clip-path="url(#${id}-${i})" fill="none" stroke="${inkOf(pen.hatch)}" stroke-width="${n(pen.hatch.w)}"/>`);
      body.push(...dashed);
      if (dots) body.push(`<path d="${dots}" clip-path="url(#${id}-${i})" fill="none" stroke="${inkOf(pen.hatch)}" stroke-width="0.35" stroke-linecap="round"/>`);
      return;
    }
    if (it.kind === 'mtext') {
      // A note: each piece of each line at its place, bold and underlined as drawn.
      const b = noteBox(it);
      for (const line of b.lines) for (const seg of line.segs) text(noteSegAt(b, line, seg), seg.s, seg.h, it.rot ?? 0, 'start', seg);
      return;
    }
    if (it.kind === 'text') {
      // Its mask in the paper colour under it, the text, then its frame with the lines below.
      if (it.mask) body.push(`<path d="M${textCorners(it).map(P).join('L')}Z" fill="#fff" stroke="none"/>`);
      const b = textBaseAt(it); text(b.at, it.text ?? '', it.h ?? 0, it.rot ?? 0, b.align === 'center' ? 'middle' : b.align === 'right' ? 'end' : 'start');
      if (!it.frame) return;
    }
    let d = '', end = '';
    for (const [a, b] of segmentsOf(it, 1)) { const s = P(a); d += `${s === end ? '' : `M${s}`}L${(end = P(b))}`; }
    if (d) body.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${n(thin || !lw ? pen.sketch.w : lw)}"${dash.length ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/>`);
    if (it.kind === 'dim' && it.pts.length > 2) { const dl = dimOf(it, 1); text(dl.text, dl.label, dl.h, dl.angle, 'middle'); }
    if (it.leader && it.pts.length > 1) {
      const ax = X(it.pts[0][0]), ay = Y(it.pts[0][1]), ang = Math.atan2(ay - Y(it.pts[1][1]), ax - X(it.pts[1][0]));
      const tip = (s: number) => `${n(ax - 3 * Math.cos(ang + s))} ${n(ay - 3 * Math.sin(ang + s))}`;
      body.push(`<path d="M${ax} ${ay}L${tip(-0.3)}L${tip(0.3)}Z" fill="${ink}" stroke="none"/>`);
    }
  });
  if (!body.length) return '';
  defs.push(`<clipPath id="${id}"><rect x="${X(win.x0)}" y="${Y(win.y1)}" width="${n((win.x1 - win.x0) * f)}" height="${n((win.y1 - win.y0) * f)}"/></clipPath>`);
  return `<defs>${defs.join('')}</defs><g class="drawn" clip-path="url(#${id})">${body.join('')}</g>`;
}

/** The design of the level for one window of the model (metres), `f` paper mm per metre, placed by X and Y: references,
 * the architect's plan, the drawn work, containment, wiring and devices, clipped to the window. `frozen` leaves out
 * layers (drawn, and references' NAME|LAYER) for a viewport; without `tags` (a key plan) the circuit, tray and route
 * tags and the DB names are left out, too big to read there. Returns the SVG pieces and what the legend counts. */
function contentSvg(p: Project, s: DrawingSheet, c: Content, drawn: Drawn[], refs: ReturnType<typeof refsOnSheet>, rooms: { name: string; outline: Pt[] }[], win: Box, X: (x: number) => number, Y: (y: number) => number, f: number, id: string, frozen?: (layer: string) => boolean, tags = true) {
  const seg = (a: Pt, b: Pt) => { const k = clip(a, b, win); return k ? `M${X(k[0][0])} ${Y(k[0][1])}L${X(k[1][0])} ${Y(k[1][1])}` : ''; };
  const path = (pts: Pt[], closed = false) => (closed ? [...pts, pts[0]] : pts).slice(1).map((q, i, all) => seg(i ? all[i - 1] : pts[0], q)).join('');
  const out: string[] = [];
  // The pens of the sheet's page setup (src/model/plotSetup.ts); by default as below.
  const pen = pensFor(p, s), w = (q: Pen, k = 1) => n(q.w * k);
  const archInk = pen.arch.grey === 45 ? GREY : inkOf(pen.arch);
  // References under everything, with the References pen (grey, thin).
  for (const r of refs) {
    if (!r.segs) continue;
    let d = '';
    for (let i = 0; i + 3 < r.segs.length; i += 4) if (!frozen || !frozen(`${r.ref.name}|${r.layerNames?.[r.segLayers?.[i / 4] ?? 0] ?? ''}`)) d += seg([r.segs[i], r.segs[i + 1]], [r.segs[i + 2], r.segs[i + 3]]);
    if (d) out.push(`<path class="ref" d="${d}" fill="none" stroke="${inkOf(pen.refs)}" stroke-width="${w(pen.refs)}"/>`);
  }
  // The architect's plan, grey.
  const arch = rooms.map((r) => path(r.outline, true)).join('');
  if (arch) out.push(`<path d="${arch}" fill="none" stroke="${archInk}" stroke-width="${w(pen.arch)}"/>`);
  for (const r of rooms) {
    const at: Pt = [r.outline.reduce((t, q) => t + q[0], 0) / r.outline.length, r.outline.reduce((t, q) => t + q[1], 0) / r.outline.length];
    if (within(at, win)) out.push(`<text x="${X(at[0])}" y="${n(Y(at[1]) + 3.5)}" font-size="2.6" text-anchor="middle" fill="${archInk}">${esc(r.name.toUpperCase())}</text>`);
  }
  // The drawn work, over the architect's plan and under the design.
  out.push(drawnSvg(frozen ? drawn.filter((d) => !frozen(d.it.layer)) : drawn, X, Y, f, win, pen, plotOf(p, s).weights === 'thin', id));
  // The containment, black: trays heavy and broken for their labels, cable routes dashed with their tags beside the
  // line. Tags of routes on one path stack outward rather than print over each other.
  const h = TAG / f, taken: { x: number; y: number; w: number; a: number }[] = [], labels: string[] = [];
  const along = (at: Pt, rot: number, off: number, text: string, stack = 0) => {
    const a = -rot, cos = Math.cos(a), sin = Math.sin(a), w = 0.6 * TAG * text.length; // a: clockwise on paper, y being down
    let x = X(at[0]) + off * sin, y = Y(at[1]) - off * cos;
    const hit = (q: typeof taken[number]) => Math.abs(q.a - a) < 1e-6 && Math.abs((x - q.x) * cos + (y - q.y) * sin) < (w + q.w) / 2 && Math.abs((y - q.y) * cos - (x - q.x) * sin) < stack;
    while (stack && taken.some(hit)) { x += stack * sin; y -= stack * cos; }
    taken.push({ x, y, w, a });
    labels.push(`<text x="${n(x)}" y="${n(y)}" transform="rotate(${n((a * 180) / Math.PI)} ${n(x)} ${n(y)})" font-size="${TAG}" text-anchor="middle" fill="#000">${esc(text)}</text>`);
  };
  const trayM = new Map<string, number>(), breaks: { at: Pt; rot: number; w: number }[] = [];
  let trays = '', routes = '';
  for (const it of c.trays) {
    const text = trayLabel(it).text;
    for (const { run, m, labelled } of shownPieces(it, win, 0.6 * h * text.length)) {
      trayM.set(text, (trayM.get(text) ?? 0) + m);
      trays += (labelled ? trayLine(run, h).pieces : [run.pts]).map((q) => path(q)).join('');
      if (!labelled) continue;
      const l = trayLabel(run);
      along(l.at, l.rot, -0.35 * TAG, text); // centred in the break: the baseline below the line
      breaks.push({ at: l.at, rot: l.rot, w: 0.6 * h * text.length + h });
    }
  }
  for (const it of c.cables) {
    for (const { run, labelled } of shownPieces(it, win, 0.6 * h * it.text!.length)) {
      routes += clearOf(run.pts, breaks, h).map(([a, b]) => seg(a, b)).join('');
      if (labelled) { const l = trayLabel(run); along(l.at, l.rot, 1.4, it.text!, 3); }
    }
  }
  if (trays) out.push(`<path d="${trays}" fill="none" stroke="${inkOf(pen.trays)}" stroke-width="${w(pen.trays)}"/>`);
  if (routes) out.push(`<path class="ln" d="${routes}" fill="none" stroke="${inkOf(pen.routes)}" stroke-width="${w(pen.routes)}" stroke-dasharray="2 1"/>`);
  if (tags) out.push(...labels);
  // The design, black: wiring and home runs (arrow at the DB), then DBs and devices on top.
  const wires = c.wiring.map((w) => path(w)).join('');
  if (wires) out.push(`<path class="ln" d="${wires}" fill="none" stroke="${inkOf(pen.routes)}" stroke-width="${w(pen.routes)}"/>`);
  for (const h of c.homes) {
    const d = path(h);
    if (!d) continue;
    out.push(`<path class="ln" d="${d}" fill="none" stroke="${inkOf(pen.routes)}" stroke-width="${w(pen.routes, 1.4)}"/>`);
    const [a, b] = [h[h.length - 2], h[h.length - 1]];
    if (!within(b, win)) continue;
    const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]), bx = X(b[0]), by = Y(b[1]), back = 3.2; // stops short of the DB symbol
    const tx = bx - back * Math.cos(ang), ty = by - back * Math.sin(ang);
    out.push(`<path d="M${n(tx)} ${n(ty)}L${n(tx - 1.6 * Math.cos(ang - 0.4))} ${n(ty - 1.6 * Math.sin(ang - 0.4))}L${n(tx - 1.6 * Math.cos(ang + 0.4))} ${n(ty - 1.6 * Math.sin(ang + 0.4))}Z" fill="#000" stroke="#000" stroke-width="0.2"/>`);
  }
  if (tags) for (const t of c.tags) if (within(t.at, win)) out.push(`<text x="${n(X(t.at[0]) + 1)}" y="${n(Y(t.at[1]) - 1)}" font-size="2.5" fill="#000">${esc(t.text)}</text>`);
  // Devices and DBs at the devices pen (their symbols are drawn at 0.25 mm in black).
  const dev = (svg: string) => (pen.devices.w === 0.25 && pen.devices.grey >= 100 ? svg : svg.replace(/stroke="#000" stroke-width="0\.25"/g, `stroke="${inkOf(pen.devices)}" stroke-width="${w(pen.devices)}"`));
  for (const d of c.boards) if (within([d.x, d.y], win)) out.push(dev(boardSymbol(X(d.x), Y(d.y))), tags ? `<text x="${n(X(d.x) + 3.2)}" y="${n(Y(d.y) - 1.8)}" font-size="2.8" font-weight="700" fill="#000">${esc(d.id)}</text>` : '');
  const counts = new Map<string, { label: string; n: number; svg: Mark['svg'] }>();
  for (const m of c.marks) {
    if (!within([m.x, m.y], win)) continue;
    out.push(dev(m.svg(X(m.x), Y(m.y), R)));
    const k = counts.get(m.key) ?? { label: m.label, n: 0, svg: m.svg };
    counts.set(m.key, { ...k, n: k.n + 1 });
  }
  return { out, counts, trayM, pen };
}

/** A legend or notes table placed on the sheet, drawn (src/model/sheetTables.ts): where it goes (mm, drawing area) and its
 * SVG, as wide as the table and as high as its rows (data-h). */
export interface PlacedTableSvg { id: string; kind: TableKind; x: number; y: number; w: number; h: number; svg: string }
export interface PlanDrawing { svg: string; size: SheetSize; legendSvg: string; parts: number; tables?: PlacedTableSvg[]; labels?: string[]; legendOff?: boolean }
/** The sheet's plan as SVG in paper mm (the drawing area's size), with its legend; `numberOf(part)` names the sheet of
 * another part of the level for the match lines. Nothing when there is nothing to draw (or the part is gone). */
export function planDrawing(p: Project, s: DrawingSheet, numberOf: (part: number) => string | undefined = () => undefined): PlanDrawing | undefined {
  const lay = layoutOf(p, s);
  const part = s.part ?? 0;
  if (!lay || part >= lay.fit.parts) return undefined;
  const { c, drawn, refs, box, rooms, scale, fit } = lay;
  const area = drawingAreaMm(p, fit.size);
  const win = windowOf(box, fit, part);
  const f = 1000 / scale;
  const ox = MARGIN + (area.w - 2 * MARGIN - (win.x1 - win.x0) * f) / 2, oy = MARGIN + (area.h - 2 * MARGIN - STRIP - (win.y1 - win.y0) * f) / 2;
  const X = (x: number) => n(ox + (x - win.x0) * f), Y = (y: number) => n(oy + (win.y1 - y) * f);
  if (s.viewports?.length) return viewportDrawing(p, s, lay);
  const { out, counts, trayM, pen } = contentSvg(p, s, c, drawn, refs, rooms, win, X, Y, f, `dw-${s.id}-${part}`.replace(/[^\w-]/g, '_'));
  // Match lines along each edge shared with another part.
  const col = part % fit.cols, row = Math.floor(part / fit.cols);
  const edges: [boolean, number, Pt, Pt][] = [
    [col > 0, part - 1, [win.x0, win.y0], [win.x0, win.y1]], [col < fit.cols - 1, part + 1, [win.x1, win.y0], [win.x1, win.y1]],
    [row > 0, part - fit.cols, [win.x0, win.y1], [win.x1, win.y1]], [row < fit.rows - 1, part + fit.cols, [win.x0, win.y0], [win.x1, win.y0]]
  ];
  for (const [on, other, a, b] of edges) {
    if (!on) continue;
    const x1 = X(a[0]), y1 = Y(a[1]), x2 = X(b[0]), y2 = Y(b[1]), vertical = x1 === x2;
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="0.5" stroke-dasharray="6 2 1 2"/>`);
    const text = `MATCH LINE · SEE ${esc(numberOf(other) ?? `PART ${other + 1}`)}`;
    const mx = n((x1 + x2) / 2), my = n((y1 + y2) / 2);
    out.push(vertical
      ? `<text x="${mx}" y="${my}" transform="rotate(-90 ${mx} ${my})" dy="${x1 < area.w / 2 ? 4 : -1.5}" font-size="2.8" font-weight="700" text-anchor="middle" fill="#000">${text}</text>`
      : `<text x="${mx}" y="${n(my + (y1 < area.h / 2 ? 4 : -1.5))}" font-size="2.8" font-weight="700" text-anchor="middle" fill="#000">${text}</text>`);
  }
  // Under the plan: title and scale, scale bar (5 segments, 50 mm long), north arrow (up the architect's plan), both left
  // of the notes box.
  const lv = planLevels(p, s.plan!).find((x) => x.buildingId === s.buildingId && x.levelId === s.levelId);
  const title = `${(lv?.name ?? s.levelId!).toUpperCase()} · ${PLAN_LABEL[s.plan!].toUpperCase()}${fit.parts > 1 ? ` · PART ${part + 1} OF ${fit.parts}` : ''}`;
  out.push(...stripSvg(p, area, fit.size, scale, title));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(area.w)} ${n(area.h)}" width="${n(area.w)}mm" height="${n(area.h)}mm" font-family="Arial, sans-serif"${s.plan === 'containment' ? ' data-abbr="CT=Cable tray"' : ''}>${out.join('')}</svg>`;
  const fittings = fittingCounts(trayFittings(c.trays, 0.001).fittings.filter((x) => within(x.at, win)));
  const rows = legendRows(s.plan!, [...counts.values()], c, win, [...trayM], fittings, refs.filter((r) => r.segs).map((r) => ({ name: r.ref.name, ink: inkOf(pen.refs) })));
  return { svg, size: fit.size, legendSvg: legendOf(s.plan!, rows, box, rooms, fit, part), parts: fit.parts, ...sheetTables(p, s, rows) };
}

/** Under the plan: its title and scale, a scale bar (5 segments, 50 mm long) and the north arrow, left of the notes box. */
function stripSvg(p: Project, area: { w: number; h: number }, size: SheetSize, scale: number, title: string): string[] {
  const out: string[] = [];
  const by = area.h - MARGIN - STRIP + 6, barM = (50 * scale) / 1000;
  out.push(`<text x="${MARGIN}" y="${by}" font-size="4.2" font-weight="700" fill="#000">${esc(title)}</text>`,
    `<line x1="${MARGIN}" y1="${by + 1.2}" x2="${n(MARGIN + Math.min(area.w * 0.5, title.length * 2.6))}" y2="${by + 1.2}" stroke="#000" stroke-width="0.35"/>`,
    `<text x="${MARGIN}" y="${by + 6}" font-size="3" fill="#000">SCALE 1:${scale} AT ${size}</text>`);
  const nx = n(Math.min(area.w - MARGIN - 6, notesLeftMm(p, size) - 6)), ny = n(by + 1);
  const sx = n(Math.min(Math.max(MARGIN + 70, area.w * 0.5), nx - 56));
  for (let i = 0; i < 5; i++) out.push(`<rect x="${sx + i * 10}" y="${by + 2}" width="10" height="1.6" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="0.2"/>`);
  out.push(`<text x="${sx}" y="${by + 7}" font-size="2.5" text-anchor="middle" fill="#000">0</text>`, `<text x="${sx + 50}" y="${by + 7}" font-size="2.5" text-anchor="middle" fill="#000">${n(barM)} m</text>`);
  out.push(`<circle cx="${nx}" cy="${ny}" r="4.5" fill="none" stroke="#000" stroke-width="0.25"/>`, `<path d="M${nx} ${n(ny - 4)}L${n(nx + 2)} ${n(ny + 2.5)}L${nx} ${n(ny + 1.2)}L${n(nx - 2)} ${n(ny + 2.5)}Z" fill="#000" stroke="#000" stroke-width="0.2"/>`, `<text x="${nx}" y="${n(ny - 5.5)}" font-size="3" font-weight="700" text-anchor="middle" fill="#000">N</text>`);
  return out;
}

/** A layout's viewports (src/model/planViewports.ts): those set on the sheet, else the one the level works out to (the
 * sheet's part of the level, at its scale, centred on the paper as the sheet has always printed). Empty when the sheet
 * names no level with something on it. */
export function layoutViewports(p: Project, s: DrawingSheet): PlanViewport[] {
  if (s.viewports?.length) return s.viewports;
  const lay = layoutOf(p, s), part = s.part ?? 0;
  if (!lay || part >= lay.fit.parts) return [];
  const area = drawingAreaMm(p, lay.fit.size), win = windowOf(lay.box, lay.fit, part), f = 1000 / lay.scale;
  const w = (win.x1 - win.x0) * f, h = (win.y1 - win.y0) * f;
  const ox = MARGIN + (area.w - 2 * MARGIN - w) / 2, oy = MARGIN + (area.h - 2 * MARGIN - STRIP - h) / 2;
  return [{ id: 'vp1', box: [n(ox), n(oy), n(w), n(h)], at: [(win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2], scale: lay.scale }];
}

/** A layout's paper: its size and drawing area (mm). */
export function layoutPaper(p: Project, s: DrawingSheet): { size: SheetSize; area: { w: number; h: number } } | undefined {
  const lay = layoutOf(p, s);
  if (!lay) return undefined;
  const size = s.size !== 'auto' ? s.size : lay.fit.size;
  return { size, area: drawingAreaMm(p, size) };
}

/** Where a layout's viewports go on its paper (mm, drawing area: left, top, width, height): inside the margin, above the title strip. */
export function layoutRegion(p: Project, s: DrawingSheet): [number, number, number, number] | undefined {
  const paper = layoutPaper(p, s);
  return paper ? [MARGIN, MARGIN, paper.area.w - 2 * MARGIN, paper.area.h - 2 * MARGIN - STRIP] : undefined;
}
/** The level's extent a layout shows (metres), or nothing when the sheet names no level with something on it. */
export function layoutExtent(p: Project, s: DrawingSheet): { x0: number; y0: number; x1: number; y1: number } | undefined {
  return layoutOf(p, s)?.box;
}

/** A plan sheet drawn through its viewports: each shows the model in its window at its scale, its plan type, without
 * the layers frozen in it and the references off in it, cut at its frame (printed only when asked); a key plan (twice
 * the first viewport's scale or more) without tags or DB names. The title strip
 * and the legend follow the first viewport; no match lines (a layout places its own viewports). */
function viewportDrawing(p: Project, s: DrawingSheet, lay: NonNullable<ReturnType<typeof layoutOf>>): PlanDrawing | undefined {
  const paper = layoutPaper(p, s)!, { area, size } = paper;
  const out: string[] = [], defs: string[] = [];
  let main: ReturnType<typeof contentSvg> | undefined, mainWin: Box | undefined, mainC: Content | undefined;
  s.viewports!.forEach((v, i) => {
    const type = v.shows ?? s.plan!;
    const c = type === s.plan ? lay.c : contentOf(p, type, s.buildingId!, s.levelId!);
    const refs = v.refsOff?.length ? lay.refs.filter((r) => !v.refsOff!.includes(r.ref.name)) : lay.refs;
    const win = vpWindow(v), f = 1000 / v.scale, cx = v.box[0] + v.box[2] / 2, cy = v.box[1] + v.box[3] / 2;
    const X = (x: number) => n(cx + (x - v.at[0]) * f), Y = (y: number) => n(cy - (y - v.at[1]) * f);
    const id = `vp-${s.id}-${v.id}`.replace(/[^\w-]/g, '_');
    // A viewport at twice the first one's scale or more is a key plan: no tags or DB names there (they would print over each other).
    const r = contentSvg(p, s, c, lay.drawn, refs, lay.rooms, win, X, Y, f, `dw-${id}`, v.frozen?.length ? (l) => isFrozen(v, l) : undefined, i === 0 || v.scale < 2 * s.viewports![0].scale);
    defs.push(`<clipPath id="${id}"><rect x="${v.box[0]}" y="${v.box[1]}" width="${v.box[2]}" height="${v.box[3]}"/></clipPath>`);
    out.push(`<g class="vp" data-vp="${esc(v.id)}" clip-path="url(#${id})">${r.out.join('')}</g>`);
    if (v.frame) out.push(`<rect x="${v.box[0]}" y="${v.box[1]}" width="${v.box[2]}" height="${v.box[3]}" fill="none" stroke="#000" stroke-width="0.35"/>`);
    if (i === 0) { main = r; mainWin = win; mainC = c; }
  });
  const first = s.viewports![0], lv = planLevels(p, s.plan!).find((x) => x.buildingId === s.buildingId && x.levelId === s.levelId);
  out.push(...stripSvg(p, area, size, first.scale, `${(lv?.name ?? s.levelId!).toUpperCase()} · ${PLAN_LABEL[s.plan!].toUpperCase()}`));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(area.w)} ${n(area.h)}" width="${n(area.w)}mm" height="${n(area.h)}mm" font-family="Arial, sans-serif"${s.plan === 'containment' ? ' data-abbr="CT=Cable tray"' : ''}><defs>${defs.join('')}</defs>${out.join('')}</svg>`;
  const fittings = fittingCounts(trayFittings(mainC!.trays, 0.001).fittings.filter((x) => within(x.at, mainWin!)));
  const one: PlanFit = { size, cols: 1, rows: 1, parts: 1 };
  const rows = legendRows(s.plan!, [...main!.counts.values()], mainC!, mainWin!, [...main!.trayM], fittings, lay.refs.filter((r) => r.segs).map((r) => ({ name: r.ref.name, ink: inkOf(main!.pen.refs) })));
  return { svg, size, legendSvg: legendOf(s.plan!, rows, lay.box, lay.rooms, one, 0), parts: 1, ...sheetTables(p, s, rows) };
}

/** A row of a plan sheet's legend: its symbol drawn at a line's y (8 mm wide at x 0 … 8), its label and count. */
export interface LegendRow { label: string; sym: (y: number) => string; count?: string }
/** The legend rows of a plan sheet: the symbols on it with their counts, the tray lengths and fittings on it, the
 * cable route, DB, wiring and home run keys, and the references shown. */
function legendRows(type: PlanType, used: { label: string; n: number; svg: Mark['svg'] }[], c: Content, win: Box, trayM: [string, number][], fittings: [string, number][], refs: { name: string; ink: string }[] = []): LegendRow[] {
  const rows: LegendRow[] = [];
  const line = (w: number, dash = '', ink = '#000') => (y: number) => `<line x1="0.5" y1="${y}" x2="7.5" y2="${y}" stroke="${ink}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  for (const u of used.sort((a, b) => a.label.localeCompare(b.label))) rows.push({ label: u.label, sym: (y) => u.svg(4, y, R), count: String(u.n) });
  for (const [label, m] of trayM.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) rows.push({ label, sym: line(0.5), count: `${txt.fixed(m, 1)} m` });
  for (const [label, k] of fittings) rows.push({ label, sym: () => '', count: String(k) });
  if (c.cables.length) rows.push({ label: 'Cable route, with its cable and size', sym: line(0.25, '2 1') });
  if (c.boards.some((d) => within([d.x, d.y], win))) rows.push({ label: 'Distribution board', sym: (y) => boardSymbol(4, y) });
  if (type !== 'elv' && c.wiring.length) rows.push({ label: 'Circuit wiring', sym: line(0.25) });
  if (type !== 'elv' && c.homes.length) rows.push({ label: 'Home run to DB: circuit · cable · length', sym: (y) => `${line(0.35)(y)}<path d="M7.5 ${y}L5.8 ${y - 0.7}L5.8 ${y + 0.7}Z" fill="#000"/>` });
  for (const r of refs) rows.push({ label: `${r.name} (reference)`, sym: line(0.25, '', r.ink) });
  return rows;
}
/** The labels of a plan sheet's legend rows (the rows a placed legend table can hide); none for other sheets. */
export function planLegendLabels(p: Project, s: DrawingSheet): string[] {
  const d = s.kind === 'plan' ? planDrawing(p, s) : undefined;
  return d?.labels ?? [];
}

/** The legend column: the rows, and the key plan of a level split over sheets. 88 mm wide, the column's width. */
function legendOf(type: PlanType, rows0: LegendRow[], box: Box, rooms: { outline: Pt[] }[], fit: PlanFit, part: number): string {
  const rows: string[] = [];
  let y = 10;
  const row = (sym: string, label: string, count = '') => { rows.push(sym, `<text x="11" y="${y + 1}" font-size="3">${esc(label)}</text>`, count ? `<text x="86" y="${y + 1}" font-size="3" text-anchor="end">${count}</text>` : ''); y += 6; };
  for (const r of rows0) row(r.sym(y), r.label, r.count ?? '');
  let key = '';
  if (fit.parts > 1) {
    const kw = 60, kh = Math.min(45, (kw * (box.y1 - box.y0)) / (box.x1 - box.x0)), k = Math.min(kw / (box.x1 - box.x0), kh / (box.y1 - box.y0));
    const top = y + 6, KX = (x: number) => n(14 + (x - box.x0) * k), KY = (v: number) => n(top + (box.y1 - v) * k);
    const w = windowOf(box, fit, part);
    key = `<text x="0" y="${y + 2}" font-size="3.4" font-weight="700">KEY PLAN</text>`
      + `<rect x="${KX(w.x0)}" y="${KY(w.y1)}" width="${n((w.x1 - w.x0) * k)}" height="${n((w.y1 - w.y0) * k)}" fill="#d0d0d0" stroke="none"/>`
      + rooms.map((r) => `<path d="M${r.outline.map((q) => `${KX(q[0])} ${KY(q[1])}`).join('L')}Z" fill="none" stroke="#000" stroke-width="0.15"/>`).join('')
      + Array.from({ length: fit.parts }, (_, i) => { const b = windowOf(box, fit, i); return `<rect x="${KX(b.x0)}" y="${KY(b.y1)}" width="${n((b.x1 - b.x0) * k)}" height="${n((b.y1 - b.y0) * k)}" fill="none" stroke="#000" stroke-width="0.3" stroke-dasharray="2 1"/><text x="${n((KX(b.x0) + KX(b.x1)) / 2)}" y="${n((KY(b.y0) + KY(b.y1)) / 2 + 1)}" font-size="3" font-weight="700" text-anchor="middle">${i + 1}</text>`; }).join('');
    y = top + (box.y1 - box.y0) * k + 2;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 ${n(y)}" width="88mm" height="${n(y)}mm" font-family="Arial, sans-serif">
  <text x="0" y="4" font-size="3.4" font-weight="700">LEGEND · ${PLAN_LABEL[type].toUpperCase()}</text>${rows.join('')}${key}
</svg>`;
}

/** The tables placed on the sheet, drawn: a legend table from the rows (less those hidden, plus those typed), a notes
 * table from the sheet's notes; the rows' labels, for the palette. A sheet with a legend table keeps no legend in its
 * column. Text at the table's height (2.5 mm), the symbol 8 mm, the count at the right edge, a rule under the heading. */
function sheetTables(p: Project, s: DrawingSheet, rows: LegendRow[]): { tables?: PlacedTableSvg[]; labels: string[]; legendOff?: boolean } {
  const labels = rows.map((r) => r.label);
  const list = tablesOf(s);
  if (!list.length) return { labels };
  const tables = list.map((t): PlacedTableSvg => {
    const W = t.widthMm, tm = t.textMm ?? 2.5, pad = 2, step = +(tm * 2).toFixed(2), head = +(tm * 1.3).toFixed(2);
    const out: string[] = [];
    let y = pad + head;
    const title = t.title ?? (t.kind === 'legend' ? `LEGEND · ${PLAN_LABEL[s.plan!].toUpperCase()}` : 'NOTES');
    out.push(`<text x="${pad}" y="${n(y)}" font-size="${n(head)}" font-weight="700">${esc(title)}</text>`);
    y += pad; out.push(`<line x1="0" y1="${n(y)}" x2="${W}" y2="${n(y)}" stroke="#000" stroke-width="0.35"/>`); y += step;
    if (t.kind === 'legend') {
      const hidden = new Set(t.hidden ?? []);
      const items: LegendRow[] = [...rows.filter((r) => !hidden.has(r.label)), ...(t.extra ?? []).filter((x) => x.trim()).map((label): LegendRow => ({ label, sym: () => '' }))];
      const cols = t.cols === 2 ? 2 : 1, colW = W / cols, per = Math.ceil(items.length / cols);
      let bottom = y;
      for (let c = 0; c < cols; c++) {
        let yy = y;
        for (const r of items.slice(c * per, (c + 1) * per)) {
          const x0 = c * colW + pad;
          out.push(`<g transform="translate(${n(x0)} 0)">${r.sym(n(yy - tm * 0.35))}</g>`, `<text x="${n(x0 + 11)}" y="${n(yy)}" font-size="${tm}">${esc(r.label)}</text>`, r.count ? `<text x="${n((c + 1) * colW - pad)}" y="${n(yy)}" font-size="${tm}" text-anchor="end">${esc(r.count)}</text>` : '');
          yy += step;
        }
        bottom = Math.max(bottom, yy);
      }
      y = bottom;
    } else {
      const notes = [...(p.drawing?.notes ?? []), ...(s.notes ?? []), ...planNotes(p, s)].map((x) => fillParams(x, p)).filter((x) => x.trim());
      const perLine = Math.max(10, Math.floor((W - 2 * pad - 5) / (tm * 0.56)));
      notes.forEach((note, i) => {
        const words = note.split(/\s+/), lines: string[] = [];
        let cur = '';
        for (const w of words) { if (cur && (cur + ' ' + w).length > perLine) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
        if (cur) lines.push(cur);
        lines.forEach((l, j) => { out.push(`<text x="${n(pad + (j ? 5 : 0))}" y="${n(y)}" font-size="${tm}">${j === 0 ? `${i + 1}. ` : ''}${esc(l)}</text>`); y += +(tm * 1.5).toFixed(2); });
        y += +(tm * 0.5).toFixed(2);
      });
    }
    const H = n(y - step + pad + tm * 0.8);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" data-h="${H}" font-family="Arial, sans-serif" class="ptab-svg"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#000" stroke-width="0.35"/>${out.join('')}</svg>`;
    return { id: t.id, kind: t.kind, x: t.at[0], y: t.at[1], w: W, h: H, svg };
  });
  return { tables, labels, legendOff: list.some((t) => t.kind === 'legend') };
}

/** Notes for the references of the sheet's level: those printed, and those that could not be. */
function refNotes(p: Project, s: DrawingSheet): string[] {
  if (!s.buildingId || !s.levelId) return [];
  const refs = refsOnSheet(p, s.buildingId, s.levelId);
  const shown = refs.filter((r) => r.segs).map((r) => r.ref.name), missing = refs.filter((r) => r.missing).map((r) => r.ref.name);
  return [
    ...(shown.length ? [`References shown grey for coordination: ${shown.join(', ')}.`] : []),
    ...(missing.length ? [`Not printed: reference${missing.length === 1 ? '' : 's'} ${missing.join(', ')} (not read in this session: open the plan in Design CAD, then print again).`] : [])
  ];
}

/** The notes a plan sheet adds to the project's: what it shows and that it is a design-stage drawing. */
export function planNotes(p: Project, s: DrawingSheet): string[] {
  const lv = s.plan && planLevels(p, s.plan).find((x) => x.buildingId === s.buildingId && x.levelId === s.levelId);
  return [
    ...(lv && lv.typical ? [`Typical floors ${lv.typical}: this level is drawn once and applies to each of those floors.`] : []),
    'Architect\'s plan shown grey for reference; the electrical design in black.',
    ...refNotes(p, s),
    ...(s.plan === 'lighting' || s.plan === 'power' ? ['Circuit tags: DB / circuit · cable · length (wiring, home run and a drop per device, with the allowance).'] : []),
    ...(s.plan === 'containment' ? ['Cable trays as a single line: CT width in mm, service and tray route. Cable routes dashed, with the cable and its size.'] : []),
    'Design stage layout: positions are indicative, not for construction or shop drawings.'
  ];
}

/** + New sheet → Plans: a sheet of the layout for every level with something on it (one per part of a level too big
 * for A1), those not in the set yet, after the set's other sheets of that layout. */
export function addPlanSheets(set: DrawingSet, p: Project, type: PlanType): { set: DrawingSet; ids: string[] } {
  const sheets = [...set.sheets], ids: string[] = [];
  for (const lv of planLevels(p, type)) {
    const base = { plan: type, buildingId: lv.buildingId, levelId: lv.levelId, scale: '1:100', size: 'auto' as const };
    const lay = layoutOf(p, base);
    if (!lay) continue;
    for (let part = 0; part < lay.fit.parts; part++) {
      if (sheets.some((x) => x.kind === 'plan' && x.plan === type && x.buildingId === lv.buildingId && x.levelId === lv.levelId && (x.part ?? 0) === part)) continue;
      let id = `pl-${type}-${lv.buildingId}-${lv.levelId}-${part}`;
      for (let k = 2; sheets.some((x) => x.id === id); k++) id = `pl-${type}-${lv.buildingId}-${lv.levelId}-${part}-${k}`;
      const title = `${lv.name}${lv.typical ? ` (typical ${lv.typical})` : ''} · ${PLAN_LABEL[type]}${lay.fit.parts > 1 ? ` · part ${part + 1} of ${lay.fit.parts}` : ''}`;
      const at = sheets.reduce((a, x, i) => (x.kind === 'plan' && x.plan === type ? i + 1 : a), sheets.length);
      sheets.splice(at, 0, { id, number: '', title, kind: 'plan', ...base, part, boards: [], status: startStatus(set) });
      ids.push(id);
    }
  }
  return { set: ids.length ? renumber({ ...set, sheets }) : set, ids };
}
