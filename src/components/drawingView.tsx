import { useEffect, useRef } from 'react';

/** One set of view controls for every drawing (the SLD, Design CAD, Design CAD → Sheets): what a wheel turn, a key or
 * a mouse button does to the view. Each drawing applies it to its own view (SVG viewBox, canvas transform, paper zoom
 * and scroll). */

/** Zoom per wheel notch, and per key or button press. */
export const WHEEL_STEP = 1.15;
export const KEY_STEP = 1.25;
/** Arrow keys pan a tenth of the view. */
export const PAN_STEP = 0.1;

type Wheel = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey'> & { wheelDeltaY?: number };

/** Two fingers on a trackpad (or a pinch), not a mouse wheel: a mouse notch moves a whole line, or (Chromium) a
 * multiple of 120 straight up or down. */
export function isTrackpad(e: Wheel): boolean {
  if (e.deltaMode !== 0) return false;
  if (e.deltaX !== 0) return true;
  if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0) return e.wheelDeltaY % 120 !== 0;
  return !Number.isInteger(e.deltaY);
}

/** A wheel event as a zoom (factor above 1 zooms in, about the cursor) or a pan (screen pixels): a mouse wheel zooms,
 * a trackpad pinch zooms, two fingers on a trackpad pan. */
export function wheelAction(e: Wheel): { zoom: number } | { pan: [number, number] } {
  const pad = isTrackpad(e);
  if (pad && e.ctrlKey) return { zoom: Math.min(2, Math.max(0.5, Math.exp(-e.deltaY / 100))) };
  if (pad) return { pan: [e.deltaX, e.deltaY] };
  return { zoom: e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP };
}

export type ViewKey = 'fit' | 'in' | 'out' | 'grid' | { pan: [number, number] };
/** A key as a view command, or null: F (or 0) fits, + and − zoom, arrows pan, G steps the grid. Not with Ctrl, ⌘ or
 * Alt, nor while typing in a field. `letters` false leaves F and G to a command line (Design CAD). */
export function viewKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>, letters = true): ViewKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return null;
  switch (e.key) {
    case '+': case '=': return 'in';
    case '-': case '_': return 'out';
    case '0': return 'fit';
    case 'ArrowLeft': return { pan: [-1, 0] };
    case 'ArrowRight': return { pan: [1, 0] };
    case 'ArrowUp': return { pan: [0, -1] };
    case 'ArrowDown': return { pan: [0, 1] };
    case 'f': case 'F': return letters ? 'fit' : null;
    case 'g': case 'G': return letters ? 'grid' : null;
    default: return null;
  }
}

/** A press that pans instead of using the tool: the middle button, or the left one with Space held. */
export const isPanPress = (e: Pick<MouseEvent, 'button'>, space: boolean) => e.button === 1 || (e.button === 0 && space);
/** A double click of the middle button (auxclick), which fits the drawing. */
export const isFitClick = (e: Pick<MouseEvent, 'button' | 'detail'>) => e.button === 1 && e.detail === 2;

/** Whether Space is held (to pan with any tool), not counting Space typed into a field. */
export function useSpaceHeld() {
  const held = useRef(false);
  useEffect(() => {
    const field = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, button, [contenteditable="true"]');
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !field(e)) held.current = true; };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') held.current = false; };
    const blur = () => { held.current = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  return held;
}

/** The zoom of a drawing in its bottom-right corner (100 % = the whole drawing in view); a click fits it. */
export function ZoomChip({ pct, onFit }: { pct: number; onFit: () => void }) {
  const p = Math.round(pct);
  return <button type="button" className="zoom-chip" title="Zoom (100 % = all in view) — click to fit (F, or double-click the wheel)" aria-label={`Zoom ${p} %, click to fit`} onClick={onFit}>{p} %</button>;
}
