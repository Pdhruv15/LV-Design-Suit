import { useState, type ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

export const INSPECTOR_W = 290;
const MIN_W = 250, MAX_W = 560;

function stored<T>(key: string, initial: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
}
function store(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* preference only */ }
}

/** The design view's right-hand inspector: drag its left edge to widen it
 * (double-click for the default width), or hide it to give the drawing the
 * room; a thin rail brings it back. Both are this viewer's preferences. */
export default function InspectorPanel({ label, children }: { label: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(() => stored('inspector.hidden', false));
  const [width, setWidth] = useState(() => Math.max(MIN_W, Math.min(MAX_W, stored('inspector.width', INSPECTOR_W))));
  const hide = (v: boolean) => { setHidden(v); store('inspector.hidden', v); };

  if (hidden) {
    return (
      <aside className="side closed" aria-label={label}>
        <button className="icon-btn" onClick={() => hide(false)} title={`Show the ${label.toLowerCase()}`}><PanelRightOpen size={16} /></button>
      </aside>
    );
  }

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    let w = w0;
    const move = (ev: PointerEvent) => { w = Math.max(MIN_W, Math.min(MAX_W, w0 - (ev.clientX - x0))); setWidth(w); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); store('inspector.width', Math.round(w)); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className="side" aria-label={label} style={{ '--side-w': `${width}px` } as React.CSSProperties}>
      <div className="side-resize" onPointerDown={startResize} onDoubleClick={() => { setWidth(INSPECTOR_W); store('inspector.width', INSPECTOR_W); }} title="Drag to resize — double-click for the default width" />
      <div className="side-head">
        <b>{label}</b>
        <span className="sp" />
        <button className="icon-btn" onClick={() => hide(true)} title={`Hide the ${label.toLowerCase()} (more room for the drawing)`}><PanelRightClose size={14} /></button>
      </div>
      <div className="side-body">{children}</div>
    </aside>
  );
}
