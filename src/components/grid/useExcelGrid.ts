import { useEffect, useRef, type RefObject } from 'react';
import { axes, blockOf, cellKey, fillDownEdits, parseClipboard, parseKey, pasteEdits, toClipboard, type GridEdit, type Pos } from './excelGrid';

type Cell = HTMLInputElement | HTMLSelectElement | HTMLElement;

const valueOf = (el: Cell): string => {
  if (el instanceof HTMLInputElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.value;
  return (el.textContent ?? '').trim();
};
const isField = (el: Element | null): el is HTMLInputElement | HTMLSelectElement => el instanceof HTMLInputElement || el instanceof HTMLSelectElement;

/** Adds Excel-style keyboard, selection, copy, paste, fill-down and clear
 * to a table (see excelGrid.ts). `onEdits` receives the changes for
 * multi-cell operations; single-cell typing stays with the inputs' own
 * handlers. */
export function useExcelGrid(ref: RefObject<HTMLElement>, onEdits: (edits: GridEdit[]) => void) {
  const latest = useRef(onEdits);
  latest.current = onEdits;
  const sel = useRef<{ anchor: Pos; focus: Pos } | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cells = () => [...root.querySelectorAll<HTMLElement>('[data-cell]')];
    const at = (p: Pos) => root.querySelector<HTMLElement>(`[data-cell="${cellKey(p.y, p.x)}"]`);
    const posOf = (el: Element | null) => parseKey(el?.closest('[data-cell]')?.getAttribute('data-cell') ?? null);
    const allPos = () => cells().map((c) => parseKey(c.getAttribute('data-cell'))!).filter(Boolean);
    const paint = () => {
      root.querySelectorAll('.gx-sel').forEach((e) => e.classList.remove('gx-sel'));
      const s = sel.current;
      if (!s || (s.anchor.y === s.focus.y && s.anchor.x === s.focus.x)) return;
      const { ys, xs } = axes(allPos());
      for (const p of blockOf(s.anchor, s.focus, ys, xs)) (at(p)?.closest('td') ?? at(p))?.classList.add('gx-sel');
    };
    const block = (): Pos[] => {
      const s = sel.current;
      if (!s) return [];
      const { ys, xs } = axes(allPos());
      return blockOf(s.anchor, s.focus, ys, xs);
    };
    const multi = () => block().length > 1;
    const focusCell = (p: Pos) => {
      const el = at(p);
      if (!el) return;
      if (isField(el)) {
        el.focus();
        if (el instanceof HTMLInputElement) el.select();
      } else {
        el.tabIndex = -1;
        el.focus();
      }
    };
    /** Next cell in a direction, in the table's own row / column order. */
    const step = (p: Pos, dy: number, dx: number): Pos | undefined => {
      const { ys, xs } = axes(allPos());
      const y = ys[ys.indexOf(p.y) + dy];
      const x = xs[xs.indexOf(p.x) + dx];
      if (dy && y !== undefined) {
        // Nearest row below / above that has this column.
        const rows = ys.filter((r) => (dy > 0 ? r > p.y : r < p.y)).sort((a, b) => (dy > 0 ? a - b : b - a));
        const r = rows.find((r) => at({ y: r, x: p.x }));
        return r !== undefined ? { y: r, x: p.x } : undefined;
      }
      if (dx && x !== undefined) {
        const cols = xs.filter((c) => (dx > 0 ? c > p.x : c < p.x)).sort((a, b) => (dx > 0 ? a - b : b - a));
        const c = cols.find((c) => at({ y: p.y, x: c }));
        return c !== undefined ? { y: p.y, x: c } : undefined;
      }
      return undefined;
    };

    const onKey = (e: KeyboardEvent) => {
      const p = posOf(e.target as Element);
      if (!p) return;
      // A key in a cell other than the selection's current one (focus came
      // from outside the grid's own moves) starts a fresh selection there.
      if (!sel.current || sel.current.focus.y !== p.y || sel.current.focus.x !== p.x) {
        sel.current = { anchor: p, focus: p };
        paint();
      }
      const mod = e.metaKey || e.ctrlKey;
      const t = e.target as Element;
      const text = t instanceof HTMLInputElement ? t : null;
      const atStart = !text || (text.selectionStart === 0 && text.selectionEnd === 0) || text.selectionEnd === text.value.length && text.selectionStart === 0;
      const atEnd = !text || text.selectionEnd === text.value.length;

      if (mod && e.key.toLowerCase() === 'c' && multi()) {
        e.preventDefault();
        const b = block();
        const { ys, xs } = axes(b);
        const rows = ys.map((y) => xs.map((x) => { const el = at({ y, x }); return el ? valueOf(el) : ''; }));
        void navigator.clipboard?.writeText(toClipboard(rows));
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const b = multi() ? block() : [];
        if (b.length) latest.current(fillDownEdits(b, (q) => { const el = at(q); return el ? valueOf(el) : ''; }));
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && multi()) {
        e.preventDefault();
        latest.current(block().map((q) => ({ ...q, value: '' })));
        return;
      }
      const move = (dy: number, dx: number) => {
        const next = step(p, dy, dx);
        if (!next) return;
        e.preventDefault();
        if (e.shiftKey && (dy || dx) && e.key.startsWith('Arrow')) {
          sel.current = { anchor: sel.current?.anchor ?? p, focus: next };
        } else sel.current = { anchor: next, focus: next };
        paint();
        focusCell(next);
      };
      if (t instanceof HTMLSelectElement && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey) return; // let the dropdown work
      if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) move(1, 0);
      else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) move(-1, 0);
      else if (e.key === 'ArrowRight' && (e.shiftKey || atEnd)) move(0, 1);
      else if (e.key === 'ArrowLeft' && (e.shiftKey || atStart)) move(0, -1);
      else if (e.key === 'Escape') { sel.current = null; paint(); }
    };

    const onPaste = (e: ClipboardEvent) => {
      const p = posOf(e.target as Element);
      if (!p) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return; // one value: the input's own paste
      e.preventDefault();
      const { ys, xs } = axes(allPos());
      const start = multi() ? block()[0] : p;
      latest.current(pasteEdits(parseClipboard(text), start, ys, xs));
    };

    const onFocus = (e: FocusEvent) => {
      const p = posOf(e.target as Element);
      if (!p || dragging.current) return;
      if (!sel.current || (sel.current.focus.y !== p.y || sel.current.focus.x !== p.x)) {
        sel.current = { anchor: p, focus: p };
        paint();
      }
    };
    const onDown = (e: MouseEvent) => {
      const p = posOf(e.target as Element);
      if (!p || e.button !== 0) return;
      if (e.shiftKey && sel.current) {
        sel.current = { anchor: sel.current.anchor, focus: p };
        paint();
        e.preventDefault();
        return;
      }
      sel.current = { anchor: p, focus: p };
      dragging.current = true;
      paint();
    };
    const onOver = (e: MouseEvent) => {
      if (!dragging.current || !sel.current) return;
      const p = posOf(e.target as Element);
      if (p && (p.y !== sel.current.focus.y || p.x !== sel.current.focus.x)) {
        sel.current = { ...sel.current, focus: p };
        paint();
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    const onUp = () => {
      if (dragging.current && sel.current && multi()) focusCell(sel.current.anchor);
      dragging.current = false;
    };

    root.addEventListener('keydown', onKey);
    root.addEventListener('paste', onPaste);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('mousedown', onDown);
    root.addEventListener('mouseover', onOver);
    window.addEventListener('mouseup', onUp);
    return () => {
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('paste', onPaste);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('mousedown', onDown);
      root.removeEventListener('mouseover', onOver);
      window.removeEventListener('mouseup', onUp);
    };
    // Re-attached after every render: the table may appear later (e.g. when
    // switching from another form), and a ref change doesn't re-run effects.
  });
}
