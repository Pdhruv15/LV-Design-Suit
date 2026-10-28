import { useEffect, useMemo, useRef, useState } from 'react';
import { curvePoints, type CadDrawing } from '../model/cadDrawing';

type Pt = [number, number];

export interface PlanRoomShape { key: string; points: Pt[]; picked?: boolean; selected?: boolean }
export interface PlanOverlay { points: Pt[]; closed?: boolean; label?: string }
/** A linked curve drawn over the plan: a cable route, a tray run, or one of the current feeder / tray (`on`). */
export interface PlanPath { points: Pt[]; tone: 'route' | 'tray' | 'on' }
/** A board placed on the plan. */
export interface PlanMark { at: Pt; label: string; on?: boolean }

/** The floor plan drawn on a canvas (plan view, drawing units): lines, arcs, polylines, hatch outlines, texts and block
 * positions, with the rooms filled and the current measurement on top. Drag to pan, wheel to zoom. Clicks are reported
 * in drawing units with the size of one screen pixel, for hit-testing. */
export default function FloorPlanCanvas({ drawing, rooms, overlay, paths = [], marks = [], fitKey, zoomKey, onClick, onMove }: {
  drawing: CadDrawing;
  rooms: PlanRoomShape[];
  overlay?: PlanOverlay;
  paths?: PlanPath[];
  marks?: PlanMark[];
  /** Changes to fit the drawing to the view again. */
  fitKey: number;
  /** Changes to zoom in once about the centre. */
  zoomKey: number;
  onClick: (at: Pt, pixel: number) => void;
  onMove?: (at: Pt) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState({ scale: 1, ox: 0, oy: 0 }); // screen = (world - origin) × scale, y up
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  // Paths in drawing units, built once per drawing.
  const geometry = useMemo(() => {
    const lines = new Path2D(), hatches = new Path2D();
    const xs: number[] = [], ys: number[] = [];
    for (const e of drawing.entities) {
      if (e.k === 'text') { xs.push(e.at[0]); ys.push(e.at[1]); continue; }
      if (e.k === 'insert') { xs.push(e.at[0]); ys.push(e.at[1]); continue; }
      const pts = e.k === 'hatch' ? e.v.map((v): Pt => [v[0], v[1]]) : curvePoints(e);
      if (!pts?.length) continue;
      const p = e.k === 'hatch' ? hatches : lines;
      p.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts.slice(1)) p.lineTo(q[0], q[1]);
      if (e.k === 'hatch') p.closePath();
      for (const q of pts) { xs.push(q[0]); ys.push(q[1]); }
    }
    // Fit to where most of the drawing is: stray objects far away would otherwise shrink it to a dot.
    const sx = [...xs].sort((a, b) => a - b), sy = [...ys].sort((a, b) => a - b);
    const at = (s: number[], f: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))] ?? 0;
    const box = { x0: at(sx, 0.01), x1: at(sx, 0.99), y0: at(sy, 0.01), y1: at(sy, 0.99) };
    return { lines, hatches, box };
  }, [drawing]);
  const texts = useMemo(() => drawing.entities.flatMap((e) => (e.k === 'text' ? [e] : [])), [drawing]);
  const blocks = useMemo(() => drawing.entities.flatMap((e) => (e.k === 'insert' ? [e.at] : [])), [drawing]);

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const { x0, x1, y0, y1 } = geometry.box;
    const scale = Math.min(size.w / Math.max(1e-9, x1 - x0), size.h / Math.max(1e-9, y1 - y0)) * 0.92;
    setView({ scale, ox: (x0 + x1) / 2 - size.w / 2 / scale, oy: (y0 + y1) / 2 - size.h / 2 / scale });
  }, [geometry, fitKey, size.w, size.h]);

  useEffect(() => {
    if (!zoomKey) return;
    setView((v) => zoomAbout(v, size.w / 2, size.h / 2, 1.5));
  }, [zoomKey]); // eslint-disable-line react-hooks/exhaustive-deps -- only on the Zoom button

  const toWorld = (sx: number, sy: number, v = view): Pt => [v.ox + sx / v.scale, v.oy + (size.h - sy) / v.scale];
  function zoomAbout(v: typeof view, sx: number, sy: number, k: number) {
    const [wx, wy] = [v.ox + sx / v.scale, v.oy + (size.h - sy) / v.scale];
    const scale = v.scale * k;
    return { scale, ox: wx - sx / scale, oy: wy - (size.h - sy) / scale };
  }

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const css = getComputedStyle(c);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const ink = color('--mut', '#8093b5'), acc = color('--acc', '#4aa8ff'), ok = color('--ok', '#37d67a'), tx = color('--tx', '#dbe4f5'), warn = color('--warn', '#f5c04a');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const { scale, ox, oy } = view;
    const world = () => ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, -dpr * ox * scale, dpr * (size.h + oy * scale));
    world();
    // Rooms
    for (const r of rooms) {
      if (r.points.length < 3) continue;
      const p = new Path2D();
      p.moveTo(r.points[0][0], r.points[0][1]);
      for (const q of r.points.slice(1)) p.lineTo(q[0], q[1]);
      p.closePath();
      ctx.globalAlpha = r.selected ? 0.32 : 0.14;
      ctx.fillStyle = r.picked || r.selected ? ok : acc;
      ctx.fill(p);
      if (r.selected) { ctx.globalAlpha = 1; ctx.strokeStyle = ok; ctx.lineWidth = 2 / scale; ctx.stroke(p); }
    }
    ctx.globalAlpha = 1;
    // Drawing
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.45; ctx.stroke(geometry.hatches);
    ctx.globalAlpha = 1; ctx.stroke(geometry.lines);
    const mark = 3 / scale;
    ctx.fillStyle = ink;
    for (const [x, y] of blocks) ctx.fillRect(x - mark / 2, y - mark / 2, mark, mark);
    // Linked routes and tray runs
    for (const p of paths) {
      if (p.points.length < 2) continue;
      ctx.strokeStyle = p.tone === 'on' ? ok : p.tone === 'tray' ? warn : acc;
      ctx.lineWidth = (p.tone === 'on' ? 5 : 3) / scale;
      ctx.beginPath();
      ctx.moveTo(p.points[0][0], p.points[0][1]);
      for (const q of p.points.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
    // Overlay (measuring, tracing)
    if (overlay && overlay.points.length) {
      ctx.strokeStyle = acc; ctx.lineWidth = 2 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.beginPath();
      ctx.moveTo(overlay.points[0][0], overlay.points[0][1]);
      for (const q of overlay.points.slice(1)) ctx.lineTo(q[0], q[1]);
      if (overlay.closed) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Texts in screen space, at their drawn height (hidden when too small to read).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tx;
    ctx.textBaseline = 'alphabetic';
    for (const t of texts) {
      const px = (t.ht ?? 0) * scale;
      if (px < 5) continue;
      ctx.font = `${Math.min(px, 64)}px system-ui, sans-serif`;
      ctx.fillText(t.s, (t.at[0] - ox) * scale, size.h - (t.at[1] - oy) * scale);
    }
    // Boards placed on the plan
    ctx.font = '600 11px system-ui, sans-serif';
    for (const m of marks) {
      const x = (m.at[0] - ox) * scale, y = size.h - (m.at[1] - oy) * scale;
      ctx.fillStyle = m.on ? ok : acc;
      ctx.beginPath(); ctx.arc(x, y, m.on ? 6 : 4.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(m.label, x + 8, y - 6);
    }
    if (overlay?.label && overlay.points.length) {
      const [x, y] = overlay.points[overlay.points.length - 1];
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = acc;
      ctx.fillText(overlay.label, (x - ox) * scale + 8, size.h - (y - oy) * scale - 8);
    }
  }, [view, size, geometry, paths, texts, blocks, rooms, overlay, marks]);

  const local = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <canvas
      ref={canvas}
      className="fp-canvas"
      style={{ width: size.w, height: size.h }}
      aria-label="Floor plan"
      onWheel={(e) => { const [sx, sy] = local(e); setView((v) => zoomAbout(v, sx, sy, e.deltaY < 0 ? 1.2 : 1 / 1.2)); }}
      onMouseDown={(e) => { const [x, y] = local(e); drag.current = { x, y, ox: view.ox, oy: view.oy, moved: false }; }}
      onMouseMove={(e) => {
        const [x, y] = local(e);
        const d = drag.current;
        if (d && (d.moved || Math.hypot(x - d.x, y - d.y) > 4)) {
          d.moved = true;
          setView((v) => ({ ...v, ox: d.ox - (x - d.x) / v.scale, oy: d.oy + (y - d.y) / v.scale }));
        }
        onMove?.(toWorld(x, y));
      }}
      onMouseUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) { const [x, y] = local(e); onClick(toWorld(x, y), 1 / view.scale); }
      }}
      onMouseLeave={() => { drag.current = null; }}
    />
  );
}
