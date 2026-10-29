import { useEffect, useMemo, useRef, useState } from 'react';
import { INK, SNAP, SNAP_NAMES, type CadView } from '../../engines/cad/cadEngine';
import { ortho as orthoFrom } from '../../model/cadMeasure';
import { dimensionLines, segmentsOf, trayEdges, trayLabel } from '../../model/cadSketch';
import type { SketchItem } from '../../types';

type Pt = [number, number];

export interface CadToggles { snap: boolean; osnap: boolean; ortho: boolean; grid: boolean }
/** What a tool draws over the drawing: picked points (drawing units, absolute), and while `live` a rubber band to the
 * cursor; `closed` outlines are shaded. */
/** A device placed in the app, drawn over the drawing (drawing units, absolute): its symbol, letters and label. */
export interface CanvasDevice { key: string; x: number; y: number; r: number; shape: string; text: string; label: string; selected?: boolean; elv?: boolean }
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
export default function CadCanvas({ view, layersOn, toggles, fitKey, onCursor, onClick, marks, highlight, devices = [], sketch = [], selectedSketch, extraSnaps = [], preview = [], unitsPerMm = 1 }: {
  view: CadView;
  layersOn: Uint8Array;
  toggles: CadToggles;
  /** A click (left button, not panning): the snapped point and the size of one screen pixel in drawing units. */
  onClick?: (at: Pt, pixel: number) => void;
  marks?: CadMarks | null;
  /** Segments of the object picked (start, end), drawn highlighted. */
  highlight?: [number, number] | null;
  devices?: CanvasDevice[];
  /** What the engineer drew (drawing units), the one selected, and their snap points. */
  sketch?: SketchItem[];
  /** Drawing units per millimetre, for the width of tray runs. */
  unitsPerMm?: number;
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
  const space = useRef(false);
  const mouse = useRef<Pt | null>(null);
  const lastAt = useRef<{ at: Pt; snap?: { p: Pt; kind: number } } | null>(null);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [o0, o1] = view.info.origin;

  // Lines batched per layer and colour, in drawing units relative to the origin.
  const batches = useMemo(() => {
    const by = new Map<string, { layer: number; rgb: number; path: Path2D }>();
    const { segs, segLayers, segColors } = view;
    for (let i = 0; i < segLayers.length; i += 1) {
      const key = `${segLayers[i]}:${segColors[i]}`;
      let b = by.get(key);
      if (!b) { b = { layer: segLayers[i], rgb: segColors[i], path: new Path2D() }; by.set(key, b); }
      b.path.moveTo(segs[i * 4], segs[i * 4 + 1]);
      b.path.lineTo(segs[i * 4 + 2], segs[i * 4 + 3]);
    }
    return [...by.values()];
  }, [view]);

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
    const bg = colour('--cad-bg', '#1b1f27'), ink = colour('--cad-ink', '#e6ebf3');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    const { scale, ox, oy } = t;
    if (toggles.grid) {
      // Grid lines: fine every step, stronger every fifth (in drawing units relative to the origin).
      const step = gridStep(scale);
      const minor = colour('--cad-grid', '#2a3140'), major = colour('--cad-grid-major', '#3a4356');
      const x0 = Math.floor(ox / step), y0 = Math.floor(oy / step);
      ctx.lineWidth = Math.max(1, dpr * 0.5);
      for (let i = x0; i * step < ox + size.w / scale; i += 1) {
        const sx = Math.round((i * step - ox) * scale * dpr) + 0.5;
        ctx.strokeStyle = i % 5 === 0 ? major : minor;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, c.height); ctx.stroke();
      }
      for (let j = y0; j * step < oy + size.h / scale; j += 1) {
        const sy = Math.round((size.h - (j * step - oy) * scale) * dpr) + 0.5;
        ctx.strokeStyle = j % 5 === 0 ? major : minor;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(c.width, sy); ctx.stroke();
      }
    }
    ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, -dpr * ox * scale, dpr * (size.h + oy * scale));
    ctx.lineWidth = 1 / scale;
    for (const b of batches) {
      if (!layersOn[b.layer]) continue;
      ctx.strokeStyle = b.rgb === INK ? ink : hex(b.rgb);
      ctx.stroke(b.path);
    }
    if (highlight && highlight[1] > highlight[0]) {
      const p = new Path2D();
      for (let i = highlight[0]; i < highlight[1]; i += 1) { p.moveTo(view.segs[i * 4], view.segs[i * 4 + 1]); p.lineTo(view.segs[i * 4 + 2], view.segs[i * 4 + 3]); }
      ctx.strokeStyle = colour('--cad-snap', '#3df27a');
      ctx.lineWidth = 3 / scale;
      ctx.stroke(p);
    }
    // What the engineer drew, over the drawing.
    const skC = colour('--cad-sketch', '#7fe3ff'), selSk = colour('--cad-snap', '#3df27a');
    for (const it of sketch) {
      if (it.kind === 'text') continue;
      ctx.strokeStyle = it.id === selectedSketch ? selSk : skC;
      ctx.lineWidth = (it.id === selectedSketch ? 3 : 1.5) / scale;
      ctx.beginPath();
      for (const [a, b] of segmentsOf(it)) { ctx.moveTo(a[0] - o0, a[1] - o1); ctx.lineTo(b[0] - o0, b[1] - o1); }
      ctx.stroke();
      if (!it.tray) continue;
      // A tray run: its edges at the tray width; the centreline thinner.
      ctx.lineWidth = (it.id === selectedSketch ? 3 : 2) / scale;
      ctx.beginPath();
      for (const [a, b] of trayEdges(it, unitsPerMm)) { ctx.moveTo(a[0] - o0, a[1] - o1); ctx.lineTo(b[0] - o0, b[1] - o1); }
      ctx.stroke();
    }
    // Devices placed in the app: symbols in drawing units (they zoom with the plan), letters and labels below.
    const lvC = colour('--cad-dev', '#f5c04a'), elvC = colour('--cad-elv', '#59c3ff'), selC = colour('--cad-snap', '#3df27a');
    for (const d of devices) {
      const x = d.x - o0, y = d.y - o1, r = d.r;
      ctx.strokeStyle = d.selected ? selC : d.elv ? elvC : lvC;
      ctx.lineWidth = (d.selected ? 3 : 1.5) / scale;
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
      ctx.fillStyle = tx.rgb === INK ? ink : hex(tx.rgb);
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
    for (const it of sketch) {
      const label = it.kind === 'text' ? { at: it.pts[0], s: it.text ?? '', h: it.h ?? 0, rot: it.rot ?? 0, align: 'left' as CanvasTextAlign }
        : it.kind === 'dim' ? (() => { const d = dimensionLines(it.pts[0], it.pts[1], it.pts[2]); return { at: d.text, s: it.text ?? '', h: it.h ?? d.length * 0.04, rot: d.angle, align: 'center' as CanvasTextAlign }; })()
        : it.tray ? (() => { const l = trayLabel(it); return { at: l.at, s: l.text, h: 150 * unitsPerMm, rot: l.rot, align: 'center' as CanvasTextAlign }; })()
        : null;
      if (!label || !label.s) continue;
      const px = label.h * scale;
      if (px < 4) continue;
      ctx.save();
      ctx.translate((label.at[0] - o0 - ox) * scale, size.h - (label.at[1] - o1 - oy) * scale);
      ctx.rotate(-label.rot);
      ctx.font = `${Math.min(px, 200)}px system-ui, sans-serif`;
      ctx.textAlign = label.align;
      ctx.fillStyle = it.id === selectedSketch ? selSk : skC;
      ctx.fillText(label.s, 0, 0);
      ctx.restore();
    }
  }, [t, size, batches, layersOn, toggles.grid, view, highlight, devices, sketch, selectedSketch, unitsPerMm]); // eslint-disable-line react-hooks/exhaustive-deps -- colours read from CSS each draw

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
        const snapC = colour('--cad-snap', '#3df27a');
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
      ctx.strokeStyle = colour('--cad-sketch', '#7fe3ff');
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
    ctx.strokeStyle = colour('--cad-cross', '#e8eef7');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(size.w, Math.round(sy) + 0.5);
    ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, size.h);
    ctx.stroke();
    ctx.strokeRect(Math.round(sx) - 4.5, Math.round(sy) - 4.5, 9, 9);
    if (!snap) return;
    const mx = (snap.p[0] - o0 - ox) * scale, my = size.h - (snap.p[1] - o1 - oy) * scale;
    ctx.strokeStyle = colour('--cad-snap', '#3df27a');
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
  useEffect(() => { drawCursor(mouse.current ? lastAt.current?.at ?? null : null, mouse.current ? lastAt.current?.snap : undefined); }, [marks, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { space.current = true; } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
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
          // Pinch (ctrl + wheel) and a mouse wheel zoom; a two-finger scroll (sideways or fine steps) pans.
          const pan = !e.ctrlKey && (e.deltaX !== 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)));
          if (pan) setT((v) => ({ ...v, ox: v.ox + e.deltaX / v.scale, oy: v.oy - e.deltaY / v.scale }));
          else zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
        }}
        onMouseDown={(e) => {
          if (e.button === 1 || (e.button === 0 && space.current)) {
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
        onAuxClick={(e) => { if (e.button === 1 && e.detail === 2) { const [x0, y0, x1, y1] = view.info.extents; const scale = Math.min(size.w / Math.max(1e-9, x1 - x0), size.h / Math.max(1e-9, y1 - y0)) * 0.92; setT({ scale, ox: (x0 + x1) / 2 - o0 - size.w / 2 / scale, oy: (y0 + y1) / 2 - o1 - size.h / 2 / scale }); } }}
        onMouseLeave={() => { drag.current = null; mouse.current = null; drawCursor(null); onCursor(null); }}
      />
    </div>
  );
}
