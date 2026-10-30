import { buildingInfoOf, floorsOf } from '../calc/building';
import { circuitCategory } from '../calc/loadSchedule';
import { LV_PALETTE } from '../model/cadDevices';
import { arcPoints, levelWiring } from '../model/cadWiring';
import { PLAN_PREFIX, renumber, startStatus, type DrawingSet, type DrawingSheet, type PlanType, type SheetSize } from '../model/drawingSet';
import { templateOf, templateSize } from '../model/titleBlock';
import { elvPlanSymbols } from '../components/elv/elvPlanSymbols';
import type { Project } from '../types';
import { escapeHtmlText as esc } from '../util/escape';
import { furnitureScale, SHEET_MM } from './sldSheet';

/** Design CAD → Sheets → Plans: a level's lighting, power or ELV layout as a drawing sheet at a true scale (1:100 unless
 * the sheet's scale says 1:50 or 1:200), made from the design, so a design change shows on the sheet.
 * - The architect's plan (the level's room outlines and names) prints in grey, the design in black: devices, DBs, and
 *   on the lighting and power layouts each wired circuit's wiring, home run and tag (Design CAD → Plan → Wiring).
 *   Lighting circuits go on the lighting layout, every other circuit on the power layout.
 * - Paper: the smallest of A3, A2, A1 that holds the level at the scale. A level too big for A1 is split into parts
 *   over several sheets, each with a key plan (its part shaded) and match lines naming the sheet next to it.
 * - The drawing is in paper millimetres sized to the sheet's drawing area, so it prints at the scale. Title, scale
 *   bar and north arrow under the plan; legend of the symbols used (and the key plan) in the legend column.
 * Black and white, like every report. */

type Pt = [number, number];
interface Box { x0: number; y0: number; x1: number; y1: number }

export const PLAN_LABEL: Record<PlanType, string> = { lighting: 'Lighting layout', power: 'Power layout', elv: 'ELV layout' };
export const PLAN_TYPES = Object.keys(PLAN_PREFIX) as PlanType[];
const SIZES: SheetSize[] = ['A3', 'A2', 'A1'];
const MARGIN = 4, STRIP = 14; // mm: around the plan, and the strip under it (title, scale bar, north arrow)
const R = 1.8; // symbol radius on paper (mm)
const GREY = '#8c8c8c';

/** "1:50" → 50; blank → 100. */
export const planScale = (s?: string) => { const n = Number(/1\s*:\s*(\d+)/.exec(s ?? '')?.[1]); return n > 0 ? n : 100; };

/** The drawing area of a sheet (mm) beside the legend column and above the title block, as src/docs/sldSheet.ts lays
 * it out: the plan is drawn to exactly this size so it prints at its scale. */
export function drawingAreaMm(p: Project, size: SheetSize): { w: number; h: number } {
  const custom = templateOf(p);
  const k = furnitureScale(size, custom ? templateSize(custom) : undefined);
  const { w, h } = SHEET_MM[size];
  return { w: w - 36 - 92 * k, h: h - 23 - 44 * k };
}

interface Mark { x: number; y: number; key: string; label: string; svg: (x: number, y: number, r: number) => string }
interface Content { marks: Mark[]; boards: { x: number; y: number; id: string }[]; wiring: Pt[][]; homes: Pt[][]; tags: { at: Pt; text: string }[] }

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

/** What the layout shows of a level, in metres on the level's plan. */
function contentOf(p: Project, type: PlanType, b: string, l: string): Content {
  const out: Content = { marks: [], boards: [], wiring: [], homes: [], tags: [] };
  if (type === 'elv') { out.marks = elvPlanSymbols(p, b, l); return out; }
  const wanted = (feederId: string) => { const f = p.feeders.find((x) => x.id === feederId); return !!f && (circuitCategory(f) === 'lighting') === (type === 'lighting'); };
  for (const d of p.lvPoints ?? []) {
    if (!onLevel(d, b, l) || !wanted(d.feederId)) continue;
    const pal = LV_PALETTE.find((x) => x.id === d.type);
    const shape = pal?.symbol.shape ?? 'circle', text = pal ? pal.symbol.text : d.type.toUpperCase();
    out.marks.push({ x: d.x, y: d.y, key: `lv:${d.type}`, label: pal?.label ?? d.type.toUpperCase(), svg: (x, y, r) => lvSymbol(shape, text, x, y, r) });
  }
  // The DBs feeding this layout's circuits, and any DB with nothing of either layout yet.
  const used = new Set(p.feeders.filter((f) => (p.lvPoints ?? []).some((d) => d.feederId === f.id && onLevel(d, b, l)) && wanted(f.id)).map((f) => f.boardId));
  for (const bd of p.boards) if (bd.planPoint && bd.level?.building === b && bd.level?.level === l && (used.has(bd.id) || type === 'power')) out.boards.push({ x: bd.planPoint.x, y: bd.planPoint.y, id: bd.id });
  for (const w of levelWiring(p, { building: b, level: l })) {
    if (!wanted(w.feederId)) continue;
    for (const a of w.arcs) out.wiring.push(arcPoints(a));
    if (w.home) out.homes.push(arcPoints(w.home));
    out.tags.push({ at: w.tagAt, text: w.tag });
  }
  return out;
}

const hasContent = (c: Content) => c.marks.length > 0 || c.boards.length > 0;

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
function extentOf(p: Project, c: Content, b: string, l: string): { box: Box; rooms: { name: string; outline: Pt[] }[] } {
  const rooms = buildingInfoOf(p).rooms.filter((r) => r.buildingId === b && r.levelId === l && r.outline && r.outline.length >= 3).map((r) => ({ name: r.name, outline: r.outline as Pt[] }));
  const pts: Pt[] = [...rooms.flatMap((r) => r.outline), ...c.marks.map((m): Pt => [m.x, m.y]), ...c.boards.map((d): Pt => [d.x, d.y])];
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
function layoutOf(p: Project, s: Pick<DrawingSheet, 'plan' | 'buildingId' | 'levelId' | 'scale' | 'size'>) {
  if (!s.plan || !s.buildingId || !s.levelId) return undefined;
  const c = contentOf(p, s.plan, s.buildingId, s.levelId);
  if (!hasContent(c)) return undefined;
  const { box, rooms } = extentOf(p, c, s.buildingId, s.levelId);
  const scale = planScale(s.scale);
  return { c, box, rooms, scale, fit: planFit(p, box, scale, s.size) };
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

export interface PlanDrawing { svg: string; size: SheetSize; legendSvg: string; parts: number }
/** The sheet's plan as SVG in paper mm (the drawing area's size), with its legend; `numberOf(part)` names the sheet of
 * another part of the level for the match lines. Nothing when there is nothing to draw (or the part is gone). */
export function planDrawing(p: Project, s: DrawingSheet, numberOf: (part: number) => string | undefined = () => undefined): PlanDrawing | undefined {
  const lay = layoutOf(p, s);
  const part = s.part ?? 0;
  if (!lay || part >= lay.fit.parts) return undefined;
  const { c, box, rooms, scale, fit } = lay;
  const area = drawingAreaMm(p, fit.size);
  const win = windowOf(box, fit, part);
  const f = 1000 / scale;
  const ox = MARGIN + (area.w - 2 * MARGIN - (win.x1 - win.x0) * f) / 2, oy = MARGIN + (area.h - 2 * MARGIN - STRIP - (win.y1 - win.y0) * f) / 2;
  const X = (x: number) => n(ox + (x - win.x0) * f), Y = (y: number) => n(oy + (win.y1 - y) * f);
  const seg = (a: Pt, b: Pt) => { const k = clip(a, b, win); return k ? `M${X(k[0][0])} ${Y(k[0][1])}L${X(k[1][0])} ${Y(k[1][1])}` : ''; };
  const path = (pts: Pt[], closed = false) => (closed ? [...pts, pts[0]] : pts).slice(1).map((q, i, all) => seg(i ? all[i - 1] : pts[0], q)).join('');
  const out: string[] = [];
  // The architect's plan, grey.
  const arch = rooms.map((r) => path(r.outline, true)).join('');
  if (arch) out.push(`<path d="${arch}" fill="none" stroke="${GREY}" stroke-width="0.18"/>`);
  for (const r of rooms) {
    const at: Pt = [r.outline.reduce((t, q) => t + q[0], 0) / r.outline.length, r.outline.reduce((t, q) => t + q[1], 0) / r.outline.length];
    if (within(at, win)) out.push(`<text x="${X(at[0])}" y="${n(Y(at[1]) + 3.5)}" font-size="2.6" text-anchor="middle" fill="${GREY}">${esc(r.name.toUpperCase())}</text>`);
  }
  // The design, black: wiring and home runs (arrow at the DB), then DBs and devices on top.
  const wires = c.wiring.map((w) => path(w)).join('');
  if (wires) out.push(`<path class="ln" d="${wires}" fill="none" stroke="#000" stroke-width="0.25"/>`);
  for (const h of c.homes) {
    const d = path(h);
    if (!d) continue;
    out.push(`<path class="ln" d="${d}" fill="none" stroke="#000" stroke-width="0.35"/>`);
    const [a, b] = [h[h.length - 2], h[h.length - 1]];
    if (!within(b, win)) continue;
    const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]), bx = X(b[0]), by = Y(b[1]), back = 3.2; // stops short of the DB symbol
    const tx = bx - back * Math.cos(ang), ty = by - back * Math.sin(ang);
    out.push(`<path d="M${n(tx)} ${n(ty)}L${n(tx - 1.6 * Math.cos(ang - 0.4))} ${n(ty - 1.6 * Math.sin(ang - 0.4))}L${n(tx - 1.6 * Math.cos(ang + 0.4))} ${n(ty - 1.6 * Math.sin(ang + 0.4))}Z" fill="#000" stroke="#000" stroke-width="0.2"/>`);
  }
  for (const t of c.tags) if (within(t.at, win)) out.push(`<text x="${n(X(t.at[0]) + 1)}" y="${n(Y(t.at[1]) - 1)}" font-size="2.5" fill="#000">${esc(t.text)}</text>`);
  for (const d of c.boards) if (within([d.x, d.y], win)) out.push(boardSymbol(X(d.x), Y(d.y)), `<text x="${n(X(d.x) + 3.2)}" y="${n(Y(d.y) - 1.8)}" font-size="2.8" font-weight="700" fill="#000">${esc(d.id)}</text>`);
  const counts = new Map<string, { label: string; n: number; svg: Mark['svg'] }>();
  for (const m of c.marks) {
    if (!within([m.x, m.y], win)) continue;
    out.push(m.svg(X(m.x), Y(m.y), R));
    const k = counts.get(m.key) ?? { label: m.label, n: 0, svg: m.svg };
    counts.set(m.key, { ...k, n: k.n + 1 });
  }
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
  // Under the plan: title and scale, scale bar (5 segments, 50 mm long), north arrow (up the architect's plan).
  const lv = planLevels(p, s.plan!).find((x) => x.buildingId === s.buildingId && x.levelId === s.levelId);
  const title = `${(lv?.name ?? s.levelId!).toUpperCase()} · ${PLAN_LABEL[s.plan!].toUpperCase()}${fit.parts > 1 ? ` · PART ${part + 1} OF ${fit.parts}` : ''}`;
  const by = area.h - MARGIN - STRIP + 6, barM = (50 * scale) / 1000;
  out.push(`<text x="${MARGIN}" y="${by}" font-size="4.2" font-weight="700" fill="#000">${esc(title)}</text>`,
    `<line x1="${MARGIN}" y1="${by + 1.2}" x2="${n(MARGIN + Math.min(area.w * 0.5, title.length * 2.6))}" y2="${by + 1.2}" stroke="#000" stroke-width="0.35"/>`,
    `<text x="${MARGIN}" y="${by + 6}" font-size="3" fill="#000">SCALE 1:${scale} AT ${fit.size}</text>`);
  const sx = n(Math.max(MARGIN + 70, area.w * 0.5));
  for (let i = 0; i < 5; i++) out.push(`<rect x="${sx + i * 10}" y="${by + 2}" width="10" height="1.6" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="0.2"/>`);
  out.push(`<text x="${sx}" y="${by + 7}" font-size="2.5" text-anchor="middle" fill="#000">0</text>`, `<text x="${sx + 50}" y="${by + 7}" font-size="2.5" text-anchor="middle" fill="#000">${n(barM)} m</text>`);
  const nx = n(area.w - MARGIN - 6), ny = n(by + 1);
  out.push(`<circle cx="${nx}" cy="${ny}" r="4.5" fill="none" stroke="#000" stroke-width="0.25"/>`, `<path d="M${nx} ${n(ny - 4)}L${n(nx + 2)} ${n(ny + 2.5)}L${nx} ${n(ny + 1.2)}L${n(nx - 2)} ${n(ny + 2.5)}Z" fill="#000" stroke="#000" stroke-width="0.2"/>`, `<text x="${nx}" y="${n(ny - 5.5)}" font-size="3" font-weight="700" text-anchor="middle" fill="#000">N</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(area.w)} ${n(area.h)}" width="${n(area.w)}mm" height="${n(area.h)}mm" font-family="Arial, sans-serif">${out.join('')}</svg>`;
  return { svg, size: fit.size, legendSvg: legendOf(s.plan!, [...counts.values()], c, win, box, rooms, fit, part), parts: fit.parts };
}

/** The legend column: the symbols on this sheet with their counts, the DB and wiring keys, and the key plan of a
 * level split over sheets. 88 mm wide, the column's width. */
function legendOf(type: PlanType, used: { label: string; n: number; svg: Mark['svg'] }[], c: Content, win: Box, box: Box, rooms: { outline: Pt[] }[], fit: PlanFit, part: number): string {
  const rows: string[] = [];
  let y = 10;
  const row = (sym: string, label: string, count = '') => { rows.push(sym, `<text x="11" y="${y + 1}" font-size="3">${esc(label)}</text>`, count ? `<text x="86" y="${y + 1}" font-size="3" text-anchor="end">${count}</text>` : ''); y += 6; };
  for (const u of used.sort((a, b) => a.label.localeCompare(b.label))) row(u.svg(4, y, R), u.label, String(u.n));
  if (c.boards.some((d) => within([d.x, d.y], win))) row(boardSymbol(4, y), 'Distribution board');
  if (type !== 'elv' && c.wiring.length) row(`<line x1="0.5" y1="${y}" x2="7.5" y2="${y}" stroke="#000" stroke-width="0.25"/>`, 'Circuit wiring');
  if (type !== 'elv' && c.homes.length) row(`<line x1="0.5" y1="${y}" x2="7.5" y2="${y}" stroke="#000" stroke-width="0.35"/><path d="M7.5 ${y}L5.8 ${y - 0.7}L5.8 ${y + 0.7}Z" fill="#000"/>`, 'Home run to DB: circuit · cable · length');
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

/** The notes a plan sheet adds to the project's: what it shows and that it is a design-stage drawing. */
export function planNotes(p: Project, s: DrawingSheet): string[] {
  const lv = s.plan && planLevels(p, s.plan).find((x) => x.buildingId === s.buildingId && x.levelId === s.levelId);
  return [
    ...(lv && lv.typical ? [`Typical floors ${lv.typical}: this level is drawn once and applies to each of those floors.`] : []),
    'Architect\'s plan shown grey for reference; the electrical design in black.',
    ...(s.plan !== 'elv' ? ['Circuit tags: DB / circuit · cable · length (wiring, home run and a drop per device, with the allowance).'] : []),
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
