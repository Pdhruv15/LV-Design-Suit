import { useEffect, useMemo, useRef, useState } from 'react';
import { INK, SNAP, SNAP_NAMES, type CadView } from '../../engines/cad/cadEngine';
import { ortho as orthoFrom } from '../../model/cadMeasure';
import { dimensionLines, segmentsOf, trayLabel, trayLine, TRAY_TEXT_MM } from '../../model/cadSketch';
import type { PlanCells, PlanCover } from '../elv/elvOverlay';
import { fittingLabel, trayFittings } from '../../model/cadTrayFittings';
import { cssRgb, dashArray, hatchLines, patternLength, screenColour, tileOf } from '../../model/cadDraw';
import type { SketchItem } from '../../types';
import { onScreenThemeChange, screenTheme } from '../../theme/theme';
import { isFitClick, isPanPress, KEY_STEP, PAN_STEP, useSpaceHeld, viewKey, wheelAction, ZoomChip } from '../drawingView';

type Pt = [number, number];

export interface CadToggles { snap: boolean; osnap: boolean; ortho: boolean; grid: boolean }
/** What a tool draws over the drawing: picked points (drawing units, absolute), and while `live` a rubber band to the
 * cursor; `closed` outlines are shaded. */
/** A device placed in the app, drawn over the drawing (drawing units, absolute): its symbol, letters and label. */
export interface CanvasDevice { key: string; x: number; y: number; r: number; shape: string; text: string; label: string; selected?: boolean; elv?: boolean; ghost?: boolean }
/** A wired circuit (drawing units, absolute): arcs between its devices, the home run to its DB (an arrow at the DB) and
 * its tag; `warn` when it has no home run. */
export interface CanvasWiring { arcs: { a: Pt; c: Pt; b: Pt }[]; home?: { a: Pt; c: Pt; b: Pt }; tag?: { at: Pt; s: string; warn: boolean } }
export interface CadMarks { points: Pt[]; live?: boolean; closed?: boolean; area?: boolean; label?: string }
/** View transform: screen = (world − origin − (ox, oy)) × scale, y up. */
interface ViewT { scale: number; ox: number; oy: number }

const OSNAP_ALL = SNAP.endpoint | SNAP.midpoint | SNAP.center | SNAP.intersection | SNAP.insertion | SNAP.node | SNAP.quadrant;
const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/** Grid spacing for the zoom: the smallest of 1, 2, 5 × 10ⁿ drawing units that is at least 24 px on screen. */
export function gridStep(scale: number): number {
  const target = 24 / scale;
  const p = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= target) ?? 10 * p;
}

/** The drawing in a CAD model space: lines by layer and colour, texts at their height, a crosshair cursor with the snap
 * point under it, live coordinates. Wheel zooms at the cursor (two-finger scroll pans, pinch zooms), the middle button
 * or Space + drag pans, a middle double-click fits. */
export default function CadCanvas({ view, layersOn, toggles, gridDots = false, fitKey, onCursor, onClick, marks, highlight, devices = [], wiring = [], sketch = [], selectedSketch, extraSnaps = [], preview = [], unitsPerMm = 1, labels = {}, covers = [], gaps }: {
  view: CadView;
  layersOn: Uint8Array;
  toggles: CadToggles;
  /** The grid (when on) as dots at the crossings instead of lines. */
  gridDots?: boolean;
  /** A click (left button, not panning): the snapped point and the size of one screen pixel in drawing units. */
  onClick?: (at: Pt, pixel: number) => void;
  marks?: CadMarks | null;
  /** Segments of the object picked (start, end), drawn highlighted. */
  highlight?: [number, number] | null;
  devices?: CanvasDevice[];
  wiring?: CanvasWiring[];
  /** What the engineer drew (drawing units), the one selected, and their snap points. */
  sketch?: SketchItem[];
  /** Drawing units per millimetre, for the width of tray runs. */
  unitsPerMm?: number;
  /** Labels of drawn items by ID (a cable route's cable), shown along them. */
  labels?: Record<string, string>;
  /** ELV coverage (drawing units): what each device covers, cut at its room, and the squares not covered. */
  covers?: PlanCover[];
  gaps?: PlanCells;
  selectedSketch?: string | null;
  extraSnaps?: { x: number; y: number; kind: number }[];
  /** The object being drawn, following the cursor (drawn on the cursor layer). */
  preview?: SketchItem[];
  /** Changes to fit the drawing to the window. */
  fitKey: number;
  /** The cursor in drawing units (absolute), snapped, and the snap kind's name. */
  onCursor: (at: Pt | null, snapName?: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [t, setT] = useState<ViewT>({ scale: 1, ox: 0, oy: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const space = useSpaceHeld(); // Space + drag pans with any tool
  const mouse = useRef<Pt | null>(null);
  const lastAt = useRef<{ at: Pt; snap?: { p: Pt; kind: number } } | null>(null);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [o0, o1] = view.info.origin;
  // Colours are read from CSS on each draw, so a theme change redraws.
  const [theme, setTheme] = useState(screenTheme);
  useEffect(() => onScreenThemeChange(setTheme), []);

  // Lines batched per layer, colour, linetype and tile of the drawing (so what is off screen is not drawn), in drawing
  // units relative to the origin; a segment that goes on from the last one continues its path (dashes run on).
  const batches = useMemo(() => {
    type Batch = { layer: number; rgb: number; lt: number; path: Path2D; box: [number, number, number, number]; end: [number, number] };
    const by = new Map<string, Batch>();
    const { segs, segLayers, segColors, segLinetypes } = view;
    const [e0, e1, e2, e3] = view.info.extents;
    const ext: [number, number, number, number] = [e0 - o0, e1 - o1, e2 - o0, e3 - o1];
    for (let i = 0; i < segLayers.length; i += 1) {
      const [x1, y1, x2, y2] = [segs[i * 4], segs[i * 4 + 1], segs[i * 4 + 2], segs[i * 4 + 3]];
      const lt = segLinetypes?.[i] ?? 0;
      const key = `${segLayers[i]}:${segColors[i]}:${lt}:${tileOf((x1 + x2) / 2, (y1 + y2) / 2, ext)}`;
      let b = by.get(key);
      if (!b) { b = { layer: segLayers[i], rgb: segColors[i], lt, path: new Path2D(), box: [x1, y1, x1, y1], end: [NaN, NaN] }; by.set(key, b); }
      if (b.end[0] !== x1 || b.end[1] !== y1) b.path.moveTo(x1, y1);
      b.path.lineTo(x2, y2);
      b.end = [x2, y2];
      b.box = [Math.min(b.box[0], x1, x2), Math.min(b.box[1], y1, y2), Math.max(b.box[2], x1, x2), Math.max(b.box[3], y1, y2)];
    }
    return [...by.values()];
  }, [view, o0, o1]);
  // Filled areas (solid hatches and 2D solids, pattern hatches): their boundary paths and boxes, relative to the origin.
  const fills = useMemo(() => (view.info.fills ?? []).map((f) => {
    const path = new Path2D();
    let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [a, z] of f.loops) {
      for (let i = a; i < z; i += 1) {
        const [x1, y1, x2, y2] = [view.segs[i * 4], view.segs[i * 4 + 1], view.segs[i * 4 + 2], view.segs[i * 4 + 3]];
        if (i === a) path.moveTo(x1, y1);
        path.lineTo(x2, y2);
        box = [Math.min(box[0], x1, x2), Math.min(box[1], y1, y2), Math.max(box[2], x1, x2), Math.max(box[3], y1, y2)];
      }
      path.closePath();
    }
    return { ...f, path, box };
  }), [view]);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit (on open, on Fit / ZE, and when the window size changes before anything was moved).
  useEffect(() => {
    const [x0, y0, x1, y1] = view.info.extents;
    const scale = Math.min(size.w / Math.max(1e-9, x1 - x0), size.h / Math.max(1e-9, y1 - y0)) * 0.92;
    setT({ scale, ox: (x0 + x1) / 2 - o0 - size.w / 2 / scale, oy: (y0 + y1) / 2 - o1 - size.h / 2 / scale });
  }, [view, fitKey, size.w, size.h, o0, o1]);

  const css = () => getComputedStyle(host.current ?? document.documentElement);
  const colour = (name: string, fallback: string) => css().getPropertyValue(name).trim() || fallback;

  // The drawing (redrawn when the view, layers or zoom change).
  useEffect(() => {
    const c = base.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const bg = colour('--cad-bg', '#0a1120'), ink = colour('--cad-ink', '#dbe4f5');
    // Stored colours too faint on this background are drawn lighter or darker (each worked out once per draw).
    const bgRgb = cssRgb(bg), shown = new Map<number, string>();
    const shade = (rgb: number) => {
      if (rgb === INK) return ink;
      let v = shown.get(rgb);
      if (!v) { v = bgRgb ? screenColour(rgb, bgRgb) : hex(rgb); shown.set(rgb, v); }
      return v;
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    const { scale, ox, oy } = t;
    if (toggles.grid) {
      // Grid lines (or dots at the crossings): fine every step, stronger every fifth (in drawing units relative to the origin).
      const step = gridStep(scale);
      const minor = colour('--cad-grid', '#16223a'), major = colour('--cad-grid-major', '#20304f');
      const x0 = Math.floor(ox / step), y0 = Math.floor(oy / step);
      ctx.lineWidth = Math.max(1, dpr * 0.5);
      if (gridDots) {
        for (let i = x0; i * step < ox + size.w / scale; i += 1) {
          const sx = Math.round((i * step - ox) * scale * dpr);
          for (let j = y0; j * step < oy + size.h / scale; j += 1) {
            const sy = Math.round((size.h - (j * step - oy) * scale) * dpr), big = i % 5 === 0 && j % 5 === 0, r = Math.max(1, Math.round(dpr * (big ? 1.5 : 1)));
            ctx.fillStyle = big ? major : minor;
            ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
          }
        }
      }
      for (let i = x0; !gridDots && i * step < ox + size.w / scale; i += 1) {
        const sx = Math.round((i * step - ox) * scale * dpr) + 0.5;
        ctx.strokeStyle = i % 5 === 0 ? major : minor;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, c.height); ctx.stroke();
      }
      for (let j = y0; !gridDots && j * step < oy + size.h / scale; j += 1) {
        const sy = Math.round((size.h - (j * step - oy) * scale) * dpr) + 0.5;
        ctx.strokeStyle = j % 5 === 0 ? major : minor;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(c.width, sy); ctx.stroke();
      }
    }
    ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, -dpr * ox * scale, dpr * (size.h + oy * scale));
    // What is on screen (drawing units relative to the origin), with a pixel of margin.
    const vx0 = ox - 2 / scale, vy0 = oy - 2 / scale, vx1 = ox + (size.w + 2) / scale, vy1 = oy + (size.h + 2) / scale;
    const onScreen = (bx: [number, number, number, number]) => bx[2] >= vx0 && bx[0] <= vx1 && bx[3] >= vy0 && bx[1] <= vy1;
    const px = 1 / scale;
    // Hatches under the lines: solid ones filled; pattern lines clipped to the boundary, or a light fill when they would
    // be closer than 3 pixels (or too many to draw).
    for (const f of fills) {
      if (!layersOn[f.layer] || !onScreen(f.box)) continue;
      const col = shade(f.rgb);
      if (f.solid) { ctx.fillStyle = col; ctx.fill(f.path, 'evenodd'); continue; }
      const families = f.lines.map((l) => ({ l, lines: hatchLines({ angle: l.angle, base: [l.base[0] - o0, l.base[1] - o1], offset: l.offset }, f.box, 3 * px) }));
      ctx.save();
      ctx.clip(f.path, 'evenodd');
      if (!families.length || families.some((x) => !x.lines.length)) {
        ctx.globalAlpha = 0.18; ctx.fillStyle = col; ctx.fill(f.path, 'evenodd'); ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = col; ctx.lineWidth = px;
        for (const { l, lines } of families) {
          const dash = dashArray(l.dashes, px), len = patternLength(dash);
          ctx.setLineDash(dash.length && len * scale >= 4 ? dash : []);
          ctx.beginPath();
          for (const x of lines) { ctx.lineDashOffset = len ? ((x.phase % len) + len) % len : 0; ctx.moveTo(x.a[0], x.a[1]); ctx.lineTo(x.b[0], x.b[1]); }
          ctx.stroke();
        }
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      ctx.restore();
    }
    ctx.lineWidth = px;
    const dashes = view.info.linetypes ?? [];
    for (const b of batches) {
      if (!layersOn[b.layer] || !onScreen(b.box)) continue;
      ctx.strokeStyle = shade(b.rgb);
      // A linetype too fine to see at this zoom (repeat under 4 pixels) is drawn continuous, as CAD does.
      const dash = b.lt ? dashArray(dashes[b.lt] ?? [], px) : [];
      ctx.setLineDash(dash.length && patternLength(dash) * scale >= 4 ? dash : []);
      ctx.stroke(b.path);
    }
    ctx.setLineDash([]);
    if (highlight && highlight[1] > highlight[0]) {
      const p = new Path2D();
      for (let i = highlight[0]; i < highlight[1]; i += 1) { p.moveTo(view.segs[i * 4], view.segs[i * 4 + 1]); p.lineTo(view.segs[i * 4 + 2], view.segs[i * 4 + 3]); }
      ctx.strokeStyle = colour('--cad-snap', '#37d67a');
      ctx.lineWidth = 3 / scale;
      ctx.stroke(p);
    }
    // ELV coverage: circles and camera views cut at their room, then the squares not covered.
    const bad = colour('--bad', '#ff5d6c');
    if (covers.length || gaps?.at.length) {
      const cov = colour('--cad-elv', '#4aa8ff');
      const poly = (pts: Pt[]) => { const q = new Path2D(); q.moveTo(pts[0][0] - o0, pts[0][1] - o1); for (const v of pts.slice(1)) q.lineTo(v[0] - o0, v[1] - o1); q.closePath(); return q; };
      for (const c of covers) {
        const [x, y] = [c.at[0] - o0, c.at[1] - o1];
        ctx.save();
        if (c.clip && c.clip.length >= 3) ctx.clip(poly(c.clip));
        ctx.fillStyle = cov;
        if (c.cone) {
          const a = (c.cone.rotationDeg * Math.PI) / 180, half = (c.cone.fovDeg * Math.PI) / 360;
          [...c.cone.bands].reverse().forEach((r, i, all) => {
            ctx.globalAlpha = 0.08 * (i + 1) + (i === all.length - 1 ? 0.04 : 0);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, a - half, a + half); ctx.closePath(); ctx.fill();
          });
        } else {
          ctx.globalAlpha = 0.12;
          ctx.beginPath(); ctx.arc(x, y, c.r, 0, 2 * Math.PI); ctx.fill();
          ctx.globalAlpha = 0.6; ctx.strokeStyle = cov; ctx.lineWidth = 1 / scale; ctx.setLineDash([5 / scale, 4 / scale]); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.restore();
      }
      if (gaps?.at.length) {
        ctx.globalAlpha = 0.35; ctx.fillStyle = bad;
        for (const [gx, gy] of gaps.at) ctx.fillRect(gx - o0 - gaps.size / 2, gy - o1 - gaps.size / 2, gaps.size, gaps.size);
        ctx.globalAlpha = 1;
      }
    }
    // What the engineer drew, over the drawing; a tray run as one heavier line, broken at its label when the label shows.
    const { fittings } = trayFittings(sketch, unitsPerMm);
    const skC = colour('--cad-sketch', '#7fd1ff'), selSk = colour('--cad-snap', '#37d67a');
    const trayH = TRAY_TEXT_MM * unitsPerMm, trayText = trayH * scale >= 4;
    for (const it of sketch) {
      if (it.kind === 'text') continue;
      ctx.strokeStyle = it.id === selectedSketch ? selSk : skC;
      ctx.lineWidth = (it.id === selectedSketch ? 3 : it.tray ? 2.5 : 1.5) / scale;
      ctx.beginPath();
      if (it.tray) for (const q of trayText ? trayLine(it, trayH).pieces : [it.pts]) q.forEach((p, i) => (i ? ctx.lineTo(p[0] - o0, p[1] - o1) : ctx.moveTo(p[0] - o0, p[1] - o1)));
      else for (const [a, b] of segmentsOf(it)) { ctx.moveTo(a[0] - o0, a[1] - o1); ctx.lineTo(b[0] - o0, b[1] - o1); }
      if (it.cable) ctx.setLineDash([10 / scale, 5 / scale]); // a cable route: dashed
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Circuit wiring: arcs in the devices' colour, the home run ending in an arrow at the DB.
    const lvC = colour('--cad-dev', '#f5c04a');
    if (wiring.length) {
      ctx.strokeStyle = lvC; ctx.fillStyle = lvC;
      ctx.lineWidth = 1.3 / scale;
      ctx.beginPath();
      for (const w of wiring) for (const a of [...w.arcs, ...(w.home ? [w.home] : [])]) { ctx.moveTo(a.a[0] - o0, a.a[1] - o1); ctx.quadraticCurveTo(a.c[0] - o0, a.c[1] - o1, a.b[0] - o0, a.b[1] - o1); }
      ctx.stroke();
      const head = 9 / scale;
      for (const w of wiring) {
        if (!w.home) continue;
        const { b, c } = w.home, ang = Math.atan2(b[1] - c[1], b[0] - c[0]);
        ctx.beginPath(); ctx.moveTo(b[0] - o0, b[1] - o1);
        ctx.lineTo(b[0] - o0 - head * Math.cos(ang - 0.4), b[1] - o1 - head * Math.sin(ang - 0.4));
        ctx.lineTo(b[0] - o0 - head * Math.cos(ang + 0.4), b[1] - o1 - head * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fill();
      }
    }
    // Devices placed in the app: symbols in drawing units (they zoom with the plan), letters and labels below.
    const elvC = colour('--cad-elv', '#4aa8ff'), selC = colour('--cad-snap', '#37d67a');
    for (const d of devices) {
      const x = d.x - o0, y = d.y - o1, r = d.r;
      ctx.strokeStyle = d.selected ? selC : d.elv ? elvC : lvC;
      ctx.lineWidth = (d.selected ? 3 : 1.5) / scale;
      ctx.globalAlpha = d.ghost ? 0.45 : 1; // a Fill room preview
      ctx.beginPath();
      if (d.shape === 'square' || d.shape === 'rect') ctx.rect(x - r, y - (d.shape === 'rect' ? r * 0.6 : r), 2 * r, d.shape === 'rect' ? r * 1.2 : 2 * r);
      else if (d.shape === 'twin') { ctx.rect(x - r, y - r * 0.6, 2 * r, r * 1.2); ctx.moveTo(x, y - r * 0.6); ctx.lineTo(x, y + r * 0.6); }
      else if (d.shape === 'triangle') { ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r * 0.8); ctx.lineTo(x - r, y - r * 0.8); ctx.closePath(); }
      else if (d.shape === 'diamond') { ctx.moveTo(x, y + r); ctx.lineTo(x + r, y); ctx.lineTo(x, y - r); ctx.lineTo(x - r, y); ctx.closePath(); }
      else if (d.shape === 'hexagon') { for (let k = 0; k < 6; k += 1) { const a = (k * Math.PI) / 3; if (k) ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else ctx.moveTo(x + r, y); } ctx.closePath(); }
      else if (d.shape === 'camera') { ctx.rect(x - r, y - r * 0.5, r * 1.4, r); ctx.moveTo(x + r * 0.4, y); ctx.lineTo(x + r, y + r * 0.4); ctx.lineTo(x + r, y - r * 0.4); ctx.closePath(); }
      else if (d.shape === 'speaker') { ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.moveTo(x + r * 0.5, y); ctx.arc(x, y, r * 0.5, 0, 2 * Math.PI); }
      else { ctx.arc(x, y, r, 0, 2 * Math.PI); }
      if (d.shape === 'cross') { const k = r * 0.7; ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x - k, y + k); ctx.lineTo(x + k, y - k); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Texts in screen space at their drawn height; too small to read: left out.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';
    let drawn = 0;
    for (const tx of view.info.texts) {
      if (!layersOn[tx.layer]) continue;
      const px = tx.h * scale;
      if (px < 4 || drawn > 6000) continue;
      const sx = (tx.x - o0 - ox) * scale, sy = size.h - (tx.y - o1 - oy) * scale;
      if (sx < -2000 || sx > size.w + 2000 || sy < -200 || sy > size.h + 200) continue;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-tx.rot);
      ctx.font = `${Math.min(px, 200)}px system-ui, sans-serif`;
      ctx.textAlign = tx.align === 1 ? 'center' : tx.align === 2 ? 'right' : 'left';
      ctx.fillStyle = shade(tx.rgb);
      ctx.fillText(tx.s, 0, 0);
      ctx.restore();
      drawn += 1;
    }
    for (const d of devices) {
      const px = d.r * scale;
      if (px < 4) continue;
      const sx = (d.x - o0 - ox) * scale, sy = size.h - (d.y - o1 - oy) * scale;
      ctx.fillStyle = d.selected ? selC : d.elv ? elvC : lvC;
      if (d.text) { ctx.font = `600 ${Math.min(px * 0.8, 40)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(d.text, sx, sy + px * 0.3); }
      if (px >= 7 && d.label) { ctx.font = `${Math.min(Math.max(px * 0.6, 9), 16)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.fillText(d.label, sx + px * 1.3, sy + px * 0.3); }
    }
    // Wiring tags, at screen size beside the home run (in red when it has none).
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
    for (const w of wiring) {
      if (!w.tag) continue;
      ctx.fillStyle = w.tag.warn ? bad : lvC;
      ctx.fillText(w.tag.s, (w.tag.at[0] - o0 - ox) * scale + 6, size.h - (w.tag.at[1] - o1 - oy) * scale - 6);
    }
    for (const it of sketch) {
      const label = it.kind === 'text' ? { at: it.pts[0], s: it.text ?? '', h: it.h ?? 0, rot: it.rot ?? 0, align: 'left' as CanvasTextAlign }
        : it.kind === 'dim' ? (() => { const d = dimensionLines(it.pts[0], it.pts[1], it.pts[2]); return { at: d.text, s: it.text ?? '', h: it.h ?? d.length * 0.04, rot: d.angle, align: 'center' as CanvasTextAlign }; })()
        : it.tray ? (() => { const l = trayLabel(it); return { at: l.at, s: l.text, h: trayH, rot: l.rot, align: 'center' as CanvasTextAlign }; })()
        : it.cable && labels[it.id] ? (() => { const l = trayLabel(it); return { at: l.at, s: labels[it.id], h: 120 * unitsPerMm, rot: l.rot, align: 'center' as CanvasTextAlign }; })()
        : null;
      if (!label || !label.s) continue;
      const px = label.h * scale;
      if (px < 4) continue;
      ctx.save();
      ctx.translate((label.at[0] - o0 - ox) * scale, size.h - (label.at[1] - o1 - oy) * scale);
      ctx.rotate(-label.rot);
      ctx.font = `${Math.min(px, 200)}px system-ui, sans-serif`;
      ctx.textAlign = label.align;
      if (it.tray) ctx.textBaseline = 'middle'; // in the gap of the tray's line
      ctx.fillStyle = it.id === selectedSketch ? selSk : skC;
      ctx.fillText(label.s, 0, 0);
      ctx.restore();
    }
    // Tray fittings: a dot at the joint and its name beside it.
    const fpx = 100 * unitsPerMm * scale;
    if (fpx >= 4) {
      ctx.fillStyle = skC;
      ctx.font = `${Math.min(fpx, 40)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      for (const f of fittings) {
        const sx = (f.at[0] - o0 - ox) * scale, sy = size.h - (f.at[1] - o1 - oy) * scale;
        ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(fittingLabel(f), sx + fpx * 1.2, sy - fpx * 1.2);
      }
    }
  }, [t, size, batches, fills, layersOn, toggles.grid, view, highlight, devices, wiring, sketch, selectedSketch, unitsPerMm, labels, covers, gaps, theme, gridDots]); // eslint-disable-line react-hooks/exhaustive-deps -- colours read from CSS each draw

  /** The cursor: crosshair and pick box, and the snap marker with its name. */
  function drawCursor(at: Pt | null, snap?: { p: Pt; kind: number }) {
    const c = over.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr)) { c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const { scale, ox, oy } = tRef.current;
    const mk = marksRef.current;
    if (mk && (mk.points.length || mk.live)) {
      const pts = mk.live && at ? [...mk.points, at] : mk.points;
      const scr = pts.map((p) => [(p[0] - o0 - ox) * scale, size.h - (p[1] - o1 - oy) * scale] as Pt);
      if (scr.length) {
        const snapC = colour('--cad-snap', '#37d67a');
        ctx.beginPath();
        ctx.moveTo(scr[0][0], scr[0][1]);
        for (const q of scr.slice(1)) ctx.lineTo(q[0], q[1]);
        if (mk.closed || (mk.area && scr.length > 2)) {
          ctx.closePath();
          ctx.globalAlpha = 0.2; ctx.fillStyle = snapC; ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = snapC; ctx.lineWidth = 2; ctx.stroke();
        for (const q of scr) { ctx.fillStyle = snapC; ctx.fillRect(q[0] - 2.5, q[1] - 2.5, 5, 5); }
        if (mk.label) {
          const q = scr[scr.length - 1];
          ctx.font = '600 13px system-ui, sans-serif';
          const w = ctx.measureText(mk.label).width + 12;
          ctx.fillStyle = colour('--panel', '#0f1a2f');
          ctx.fillRect(q[0] + 12, q[1] - 30, w, 20);
          ctx.fillStyle = snapC;
          ctx.fillText(mk.label, q[0] + 18, q[1] - 15);
        }
      }
    }
    const pv = previewRef.current;
    if (pv.length) {
      ctx.strokeStyle = colour('--cad-sketch', '#7fd1ff');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (const it of pv) for (const [a, b] of segmentsOf(it)) {
        ctx.moveTo((a[0] - o0 - ox) * scale, size.h - (a[1] - o1 - oy) * scale);
        ctx.lineTo((b[0] - o0 - ox) * scale, size.h - (b[1] - o1 - oy) * scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!at) return;
    const sx = (at[0] - o0 - ox) * scale, sy = size.h - (at[1] - o1 - oy) * scale;
    ctx.strokeStyle = colour('--cad-cross', '#dbe4f5');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(size.w, Math.round(sy) + 0.5);
    ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, size.h);
    ctx.stroke();
    ctx.strokeRect(Math.round(sx) - 4.5, Math.round(sy) - 4.5, 9, 9);
    if (!snap) return;
    const mx = (snap.p[0] - o0 - ox) * scale, my = size.h - (snap.p[1] - o1 - oy) * scale;
    ctx.strokeStyle = colour('--cad-snap', '#37d67a');
    ctx.lineWidth = 2;
    ctx.beginPath();
    const r = 7;
    if (snap.kind === SNAP.endpoint || snap.kind === SNAP.insertion) ctx.rect(mx - r, my - r, 2 * r, 2 * r);
    else if (snap.kind === SNAP.midpoint) { ctx.moveTo(mx, my - r); ctx.lineTo(mx + r, my + r * 0.8); ctx.lineTo(mx - r, my + r * 0.8); ctx.closePath(); }
    else if (snap.kind === SNAP.center) ctx.arc(mx, my, r, 0, 2 * Math.PI);
    else if (snap.kind === SNAP.intersection) { ctx.moveTo(mx - r, my - r); ctx.lineTo(mx + r, my + r); ctx.moveTo(mx + r, my - r); ctx.lineTo(mx - r, my + r); }
    else { ctx.moveTo(mx, my - r); ctx.lineTo(mx + r, my); ctx.lineTo(mx, my + r); ctx.lineTo(mx - r, my); ctx.closePath(); }
    ctx.stroke();
    const label = SNAP_NAMES[snap.kind] ?? '';
    ctx.font = '11px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = colour('--panel', '#0f1a2f');
    ctx.fillRect(mx + 12, my + 10, w, 18);
    ctx.fillStyle = colour('--tx', '#dbe4f5');
    ctx.fillText(label, mx + 17, my + 23);
  }

  const toWorld = (sx: number, sy: number, v = tRef.current): Pt => [o0 + v.ox + sx / v.scale, o1 + v.oy + (size.h - sy) / v.scale];
  function track(sx: number, sy: number) {
    const raw = toWorld(sx, sy);
    const v = tRef.current;
    let at = raw;
    let snap: { p: Pt; kind: number } | undefined;
    if (toggles.osnap) {
      const r = 10 / v.scale;
      const s = view.snap(raw[0], raw[1], r, OSNAP_ALL, layersOn);
      if (s.length === 3) snap = { p: [s[0], s[1]], kind: s[2] };
      // Points on what was drawn in the app snap too; the nearer one wins.
      for (const e of extraSnaps) {
        const d = Math.hypot(e.x - raw[0], e.y - raw[1]);
        if (d <= r && (!snap || d < Math.hypot(snap.p[0] - raw[0], snap.p[1] - raw[1]))) snap = { p: [e.x, e.y], kind: e.kind };
      }
    }
    if (snap) at = snap.p;
    else if (toggles.snap) { const g = gridStep(v.scale); at = [Math.round(raw[0] / g) * g, Math.round(raw[1] / g) * g]; }
    // ORTHO: straight from the last picked point (a snap point wins, as in CAD).
    const mk = marksRef.current;
    if (!snap && toggles.ortho && mk?.live && mk.points.length) at = orthoFrom(mk.points[mk.points.length - 1], at);
    lastAt.current = { at, snap };
    drawCursor(at, snap);
    onCursor(at, snap ? SNAP_NAMES[snap.kind] : undefined);
  }
  // After zoom / pan: the cursor's drawing point moves, so it is tracked again. When only the marks change (a pick, the
  // cursor moving in a tool), they are redrawn without reporting the cursor back (that would loop).
  useEffect(() => { if (mouse.current) track(mouse.current[0], mouse.current[1]); else drawCursor(null); }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { drawCursor(mouse.current ? lastAt.current?.at ?? null : null, mouse.current ? lastAt.current?.snap : undefined); }, [marks, preview, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The whole drawing in view, with a margin (FIT / ZE, 0, a double click of the wheel, the zoom chip). */
  const fitT = (): ViewT => {
    const [x0, y0, x1, y1] = view.info.extents;
    const scale = Math.min(size.w / Math.max(1e-9, x1 - x0), size.h / Math.max(1e-9, y1 - y0)) * 0.92;
    return { scale, ox: (x0 + x1) / 2 - o0 - size.w / 2 / scale, oy: (y0 + y1) / 2 - o1 - size.h / 2 / scale };
  };
  // + / − zoom about the middle, 0 fits, arrows pan (letters go to the command line).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const k = viewKey(e, false);
    if (!k || k === 'grid') return;
    e.preventDefault();
    if (k === 'fit') setT(fitT());
    else if (k === 'in' || k === 'out') zoomAt(size.w / 2, size.h / 2, k === 'in' ? KEY_STEP : 1 / KEY_STEP);
    else setT((v) => ({ ...v, ox: v.ox + (k.pan[0] * size.w * PAN_STEP) / v.scale, oy: v.oy - (k.pan[1] * size.h * PAN_STEP) / v.scale }));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const local = (e: React.MouseEvent | React.WheelEvent) => {
    const r = over.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const zoomAt = (sx: number, sy: number, k: number) => setT((v) => {
    const [wx, wy] = [v.ox + sx / v.scale, v.oy + (size.h - sy) / v.scale];
    const scale = Math.min(1e6, Math.max(1e-6, v.scale * k));
    return { scale, ox: wx - sx / scale, oy: wy - (size.h - sy) / scale };
  });

  return (
    <div ref={host} className="cad-model">
      <canvas ref={base} className="cad-layer" style={{ width: size.w, height: size.h }} aria-hidden="true" />
      <canvas
        ref={over}
        className="cad-layer cad-over"
        style={{ width: size.w, height: size.h }}
        aria-label="Drawing"
        onWheel={(e) => {
          const [sx, sy] = local(e);
          // A mouse wheel and a pinch zoom; two fingers on a trackpad pan.
          const w = wheelAction(e.nativeEvent);
          if ('pan' in w) setT((v) => ({ ...v, ox: v.ox + w.pan[0] / v.scale, oy: v.oy - w.pan[1] / v.scale }));
          else zoomAt(sx, sy, w.zoom);
        }}
        onMouseDown={(e) => {
          if (isPanPress(e, space.current)) {
            e.preventDefault();
            const [x, y] = local(e);
            drag.current = { x, y, ox: tRef.current.ox, oy: tRef.current.oy };
          }
        }}
        onMouseMove={(e) => {
          const [x, y] = local(e);
          mouse.current = [x, y];
          const d = drag.current;
          if (d) setT((v) => ({ ...v, ox: d.ox - (x - d.x) / v.scale, oy: d.oy + (y - d.y) / v.scale }));
          else track(x, y);
        }}
        onMouseUp={(e) => {
          const wasDrag = !!drag.current;
          drag.current = null;
          if (!wasDrag && e.button === 0 && !space.current && lastAt.current) onClick?.(lastAt.current.at, 1 / tRef.current.scale);
        }}
        onDoubleClick={(e) => { if (e.button === 1) e.preventDefault(); }}
        onAuxClick={(e) => { if (isFitClick(e)) setT(fitT()); }}
        onMouseLeave={() => { drag.current = null; mouse.current = null; drawCursor(null); onCursor(null); }}
      />
      <ZoomChip pct={(t.scale / fitT().scale) * 100} onFit={() => setT(fitT())} />
    </div>
  );
}
