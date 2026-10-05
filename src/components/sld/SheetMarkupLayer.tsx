import { useRef, useState } from 'react';
import {
  dragHandle, markupBounds, markupFromDrag, markupHandles, markupHit, markupSvg, MARKUP_COLORS, MARKUP_LABEL, markupSize, moveMarkup, newMarkupId,
  type MarkupColor, type MarkupHandle, type MarkupKind, type SheetMarkup
} from '../../model/sheetMarkup';

export type MarkupTool = 'select' | MarkupKind;
type Pt = [number, number];

export const MARKUP_TOOLS: { tool: MarkupTool; label: string; hint: string }[] = [
  { tool: 'select', label: 'Select', hint: 'Click a markup to select it; drag to move, drag a handle to resize, Delete to remove, double-click to edit its text' },
  { tool: 'cloud', label: 'Cloud', hint: 'Drag a rectangle to draw a revision cloud with its revision triangle' },
  { tool: 'rect', label: 'Box', hint: 'Drag a rectangle' },
  { tool: 'line', label: 'Line', hint: 'Drag a line' },
  { tool: 'arrow', label: 'Arrow', hint: 'Drag from the tail to the point' },
  { tool: 'text', label: 'Note', hint: 'Click where the note goes' },
  { tool: 'callout', label: 'Callout', hint: 'Press on what you point at, drag to where the text goes, release' }
];
export const MARKUP_SIZES = [2.5, 3.5, 5];

const textOf = (m: SheetMarkup) => (m.text ?? '').split('\n').join(' | ');
const fromText = (s: string) => s.split('|').map((x) => x.trim()).join('\n').trim();

type Drag =
  | { mode: 'new'; a: Pt; b: Pt }
  | { mode: 'move'; start: Pt; orig: SheetMarkup; cur: SheetMarkup }
  | { mode: 'handle'; handle: MarkupHandle['id']; cur: SheetMarkup };

/** Drawing and editing of a sheet's markups, over the page preview. Positions are paper mm. */
export default function SheetMarkupLayer({ markups, mmW, mmH, width, height, tool, color, size, selected, rev, onSelect, onChange, onTool }: {
  markups: SheetMarkup[]; mmW: number; mmH: number; width: number; height: number;
  tool: MarkupTool; color: MarkupColor; size: number; selected: string | null; rev: string;
  onSelect: (id: string | null) => void; onChange: (next: SheetMarkup[]) => void; onTool: (t: MarkupTool) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const point = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.min(mmW, Math.max(0, ((e.clientX - r.left) / r.width) * mmW)), Math.min(mmH, Math.max(0, ((e.clientY - r.top) / r.height) * mmH))];
  };
  const byId = (id: string | null | undefined) => markups.find((m) => m.id === id);
  const replace = (m: SheetMarkup) => onChange(markups.map((x) => (x.id === m.id ? m : x)));

  const preview = (() => {
    if (!drag) return undefined;
    if (drag.mode === 'new') return tool === 'text' || tool === 'select' ? undefined : markupFromDrag(tool, drag.a, drag.b, { color, rev, size, text: '' });
    return drag.cur;
  })();
  const shown = markups.map((m) => (drag && drag.mode !== 'new' && drag.cur.id === m.id ? drag.cur : m));
  const sel = byId(selected);
  const selShown = sel && drag && drag.mode !== 'new' && drag.cur.id === sel.id ? drag.cur : sel;

  const down = (e: React.PointerEvent) => {
    const p = point(e);
    const el = e.target as Element;
    if (tool === 'select') {
      const h = el.closest('[data-handle]')?.getAttribute('data-handle') as MarkupHandle['id'] | null;
      if (h && sel) { svg.current!.setPointerCapture(e.pointerId); setDrag({ mode: 'handle', handle: h, cur: sel }); return; }
      const id = el.closest('[data-mid]')?.getAttribute('data-mid');
      const m = byId(id);
      onSelect(m?.id ?? null);
      if (m) { svg.current!.setPointerCapture(e.pointerId); setDrag({ mode: 'move', start: p, orig: m, cur: m }); }
      return;
    }
    if (tool === 'text') {
      const t = window.prompt('Note text (use | for a new line)', '');
      const text = t ? fromText(t) : '';
      if (text) { const m: SheetMarkup = { id: newMarkupId(), kind: 'text', x: p[0], y: p[1], text, color, size }; onChange([...markups, m]); onSelect(m.id); onTool('select'); }
      return;
    }
    svg.current!.setPointerCapture(e.pointerId);
    setDrag({ mode: 'new', a: p, b: p });
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = point(e);
    if (drag.mode === 'new') setDrag({ ...drag, b: p });
    else if (drag.mode === 'move') setDrag({ ...drag, cur: moveMarkup(drag.orig, p[0] - drag.start[0], p[1] - drag.start[1]) });
    else setDrag({ ...drag, cur: dragHandle(drag.cur, drag.handle, p[0], p[1]) });
  };

  const up = () => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.mode === 'new') {
      if (tool === 'select' || tool === 'text') return;
      let m = markupFromDrag(tool, d.a, d.b, { color, rev: tool === 'cloud' ? rev : undefined, size: tool === 'callout' ? size : undefined });
      if (!m) return;
      if (tool === 'callout') {
        const t = window.prompt('Callout text (use | for a new line)', '');
        const text = t ? fromText(t) : '';
        if (!text) return;
        m = { ...m, text };
      }
      onChange([...markups, m]);
      onSelect(m.id);
      onTool('select');
    } else if (JSON.stringify(d.cur) !== JSON.stringify(byId(d.cur.id))) replace(d.cur);
  };

  const edit = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    const m = byId((e.target as Element).closest('[data-mid]')?.getAttribute('data-mid'));
    if (!m) return;
    if (m.kind === 'cloud') { const r = window.prompt('Revision shown in the cloud triangle (blank = none)', m.rev ?? ''); if (r !== null) replace({ ...m, rev: r.trim() || undefined }); }
    else if (m.kind === 'text' || m.kind === 'callout') { const t = window.prompt('Text (use | for a new line)', textOf(m)); if (t !== null && fromText(t)) replace({ ...m, text: fromText(t) }); }
  };

  const drawing = tool !== 'select';
  const b = selShown ? markupBounds(selShown) : undefined;
  return (
    <svg ref={svg} className="markup-layer" viewBox={`0 0 ${mmW} ${mmH}`} width={width} height={height}
      style={{ position: 'absolute', left: 0, top: 0, touchAction: 'none', cursor: drawing ? 'crosshair' : 'default' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onDoubleClick={edit}>
      {shown.map((m) => (
        <g key={m.id} data-mid={m.id} style={{ cursor: drawing ? 'crosshair' : 'move' }} dangerouslySetInnerHTML={{ __html: markupSvg(m) + (drawing ? '' : markupHit(m)) }} />
      ))}
      {preview && <g opacity={0.7} style={{ pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: markupSvg(preview) }} />}
      {selShown && b && !drawing && (
        <g style={{ pointerEvents: 'none' }}>
          <rect x={b.x - 1.5} y={b.y - 1.5} width={b.w + 3} height={b.h + 3} fill="none" stroke="#2f80ed" strokeWidth={0.3} strokeDasharray="1.5 1" />
        </g>
      )}
      {selShown && !drawing && markupHandles(selShown).map((h) => (
        <circle key={h.id} data-handle={h.id} cx={h.x} cy={h.y} r={1.7} fill="#fff" stroke="#2f80ed" strokeWidth={0.4} style={{ cursor: 'nwse-resize' }} />
      ))}
    </svg>
  );
}

/** Tool buttons, colour and letter height for the markup layer. */
export function MarkupToolbar({ tool, color, size, selected, count, onTool, onColor, onSize, onDelete }: {
  tool: MarkupTool; color: MarkupColor; size: number; selected: SheetMarkup | undefined; count: number;
  onTool: (t: MarkupTool) => void; onColor: (c: MarkupColor) => void; onSize: (s: number) => void; onDelete: () => void;
}) {
  const hint = MARKUP_TOOLS.find((t) => t.tool === tool)?.hint ?? '';
  const textual = tool === 'text' || tool === 'callout' || selected?.kind === 'text' || selected?.kind === 'callout';
  return (
    <div className="markup-bar">
      <b>Markup</b>
      {MARKUP_TOOLS.map((t) => <button key={t.tool} className={`chip${tool === t.tool ? ' on' : ''}`} title={t.hint} onClick={() => onTool(t.tool)}>{t.label}</button>)}
      <span className="markup-colors">
        {(Object.keys(MARKUP_COLORS) as MarkupColor[]).map((c) => (
          <button key={c} className={`markup-dot${(selected?.color ?? color) === c ? ' on' : ''}`} style={{ background: MARKUP_COLORS[c].css }} title={`${c[0].toUpperCase()}${c.slice(1)}`} onClick={() => onColor(c)} />
        ))}
      </span>
      {textual && (
        <select className="chip" title="Letter height on the paper" value={selected && (selected.kind === 'text' || selected.kind === 'callout') ? markupSize(selected) : size} onChange={(e) => onSize(Number(e.target.value))}>
          {MARKUP_SIZES.map((s) => <option key={s} value={s}>{s} mm</option>)}
        </select>
      )}
      <button className="chip" disabled={!selected} onClick={onDelete} title="Delete the selected markup (Delete key)">Delete{selected ? ` ${MARKUP_LABEL[selected.kind].toLowerCase()}` : ''}</button>
      <span className="m">{hint}{count ? ` · ${count} on this sheet` : ''}</span>
    </div>
  );
}
