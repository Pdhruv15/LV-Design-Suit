import { useEffect, useMemo, useRef, useState } from 'react';
import { INK, SNAP, SNAP_NAMES, type CadView } from '../../engines/cad/cadEngine';

type Pt = [number, number];

export interface CadToggles { snap: boolean; osnap: boolean; ortho: boolean; grid: boolean }
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
export default function CadCanvas({ view, layersOn, toggles, fitKey, onCursor }: {
  view: CadView;
  layersOn: Uint8Array;
  toggles: CadToggles;
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
      const step = gridStep(scale);
      ctx.fillStyle = colour('--cad-grid', '#3a4152');
      const x0 = Math.floor(ox / step) * step, y0 = Math.floor(oy / step) * step;
      for (let x = x0; x < ox + size.w / scale; x += step) for (let y = y0; y < oy + size.h / scale; y += step) {
        ctx.fillRect(Math.round((x - ox) * scale * dpr), Math.round((size.h - (y - oy) * scale) * dpr), Math.max(1, dpr), Math.max(1, dpr));
      }
    }
    ctx.setTransform(dpr * scale, 0, 0, -dpr * scale, -dpr * ox * scale, dpr * (size.h + oy * scale));
    ctx.lineWidth = 1 / scale;
    for (const b of batches) {
      if (!layersOn[b.layer]) continue;
      ctx.strokeStyle = b.rgb === INK ? ink : hex(b.rgb);
      ctx.stroke(b.path);
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
  }, [t, size, batches, layersOn, toggles.grid, view]); // eslint-disable-line react-hooks/exhaustive-deps -- colours read from CSS each draw

  /** The cursor: crosshair and pick box, and the snap marker with its name. */
  function drawCursor(at: Pt | null, snap?: { p: Pt; kind: number }) {
    const c = over.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr)) { c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    if (!at) return;
    const { scale, ox, oy } = tRef.current;
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
      const s = view.snap(raw[0], raw[1], 10 / v.scale, OSNAP_ALL, layersOn);
      if (s.length === 3) snap = { p: [s[0], s[1]], kind: s[2] };
    }
    if (snap) at = snap.p;
    else if (toggles.snap) { const g = gridStep(v.scale); at = [Math.round(raw[0] / g) * g, Math.round(raw[1] / g) * g]; }
    drawCursor(at, snap);
    onCursor(at, snap ? SNAP_NAMES[snap.kind] : undefined);
  }
  useEffect(() => { if (mouse.current) track(mouse.current[0], mouse.current[1]); }, [t]); // eslint-disable-line react-hooks/exhaustive-deps -- keep the cursor on screen after zoom / pan

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
        onMouseUp={() => { drag.current = null; }}
        onDoubleClick={(e) => { if (e.button === 1) e.preventDefault(); }}
        onAuxClick={(e) => { if (e.button === 1 && e.detail === 2) { const [x0, y0, x1, y1] = view.info.extents; const scale = Math.min(size.w / Math.max(1e-9, x1 - x0), size.h / Math.max(1e-9, y1 - y0)) * 0.92; setT({ scale, ox: (x0 + x1) / 2 - o0 - size.w / 2 / scale, oy: (y0 + y1) / 2 - o1 - size.h / 2 / scale }); } }}
        onMouseLeave={() => { drag.current = null; mouse.current = null; drawCursor(null); onCursor(null); }}
      />
    </div>
  );
}
