import { useRef, useState } from 'react';
import { ArrowUpRight, Cloud, CloudCog, Crosshair, MessageSquareText, MousePointer2, Slash, Square, Trash2, Type , type LucideIcon } from 'lucide-react';
import {
  dragHandle, markupBounds, markupFromDrag, markupHandles, markupHit, markupSvg, MARKUP_COLORS, MARKUP_LABEL, markupSize, moveMarkup, newMarkupId,
  type MarkupColor, type MarkupHandle, type MarkupKind, type SheetMarkup
} from '../../model/sheetMarkup';

export type MarkupTool = 'select' | MarkupKind | 'pcloud' | 'parrow';
/** A panel or circuit outline on the page, in paper mm (target `f:<id>` for a circuit). */
export interface SheetAnchor { target: string; x: number; y: number; w: number; h: number }
type PanelArrow = { target: string; text: string; dir: 'ne' | 'nw' | 'se' | 'sw'; len: number };
type Pt = [number, number];

export const MARKUP_TOOLS: { tool: MarkupTool; label: string; key: string; icon: LucideIcon; hint: string }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: MousePointer2, hint: 'Click a markup to select it; drag to move, drag a handle to resize, Delete to remove, double-click to edit its text' },
  { tool: 'cloud', label: 'Cloud', key: 'C', icon: Cloud, hint: 'Drag a rectangle to draw a revision cloud with its revision triangle' },
  { tool: 'rect', label: 'Box', key: 'B', icon: Square, hint: 'Drag a rectangle' },
  { tool: 'line', label: 'Line', key: 'L', icon: Slash, hint: 'Drag a line' },
  { tool: 'arrow', label: 'Arrow', key: 'A', icon: ArrowUpRight, hint: 'Drag from the tail to the point' },
  { tool: 'text', label: 'Note', key: 'T', icon: Type, hint: 'Click where the note goes' },
  { tool: 'callout', label: 'Callout', key: 'O', icon: MessageSquareText, hint: 'Press on what you point at, drag to where the text goes, release' }
];
/** Tools tied to panels and circuits: they follow the design when it moves. */
export const ANCHORED_TOOLS: typeof MARKUP_TOOLS = [
  { tool: 'pcloud', label: 'Panel cloud', key: 'P', icon: CloudCog, hint: 'Drag around panels: a revision cloud that stays around them when the design changes' },
  { tool: 'parrow', label: 'Panel arrow', key: 'R', icon: Crosshair, hint: 'Press on a panel or circuit, drag to where the text goes: the arrow follows it when the design changes' }
];
export const ALL_TOOLS = [...MARKUP_TOOLS, ...ANCHORED_TOOLS];
const inside = (p: Pt, a: SheetAnchor) => p[0] >= a.x && p[0] <= a.x + a.w && p[1] >= a.y && p[1] <= a.y + a.h;
/** The smallest outline under a point: a circuit wins over the panel around it. */
export const anchorAt = (anchors: SheetAnchor[], p: Pt) => anchors.filter((a) => inside(p, a)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
/** Panels whose outline centre lies in the dragged box. */
export const panelsIn = (anchors: SheetAnchor[], a: Pt, b: Pt) => {
  const [x1, x2, y1, y2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return anchors.filter((n) => !n.target.startsWith('f:') && n.x + n.w / 2 >= x1 && n.x + n.w / 2 <= x2 && n.y + n.h / 2 >= y1 && n.y + n.h / 2 <= y2).map((n) => n.target);
};
/** A drag from the target to the text as a design arrow; `mmPerUnit` converts paper mm back to drawing units. */
export const arrowFromDrag = (target: string, a: Pt, b: Pt, mmPerUnit: number, text: string): PanelArrow => ({
  target, text,
  dir: `${b[1] < a[1] ? 'n' : 's'}${b[0] >= a[0] ? 'e' : 'w'}` as PanelArrow['dir'],
  len: Math.round(Math.min(300, Math.max(30, Math.abs(b[0] - a[0]) / mmPerUnit)))
});
export const MARKUP_SIZES = [2.5, 3.5, 5];

const textOf = (m: SheetMarkup) => (m.text ?? '').split('\n').join(' | ');
const fromText = (s: string) => s.split('|').map((x) => x.trim()).join('\n').trim();

type Drag =
  | { mode: 'new'; a: Pt; b: Pt }
  | { mode: 'move'; start: Pt; orig: SheetMarkup; cur: SheetMarkup }
  | { mode: 'handle'; handle: MarkupHandle['id']; cur: SheetMarkup };

/** Drawing and editing of a sheet's markups, over the page preview. Positions are paper mm. */
export default function SheetMarkupLayer({ markups, mmW, mmH, width, height, tool, color, size, selected, rev, anchors = [], mmPerUnit = 1, onSelect, onChange, onTool, onPanelCloud, onPanelArrow, onStatus }: {
  markups: SheetMarkup[]; mmW: number; mmH: number; width: number; height: number;
  tool: MarkupTool; color: MarkupColor; size: number; selected: string | null; rev: string;
  anchors?: SheetAnchor[]; mmPerUnit?: number;
  onSelect: (id: string | null) => void; onChange: (next: SheetMarkup[]) => void; onTool: (t: MarkupTool) => void;
  onPanelCloud?: (c: { boards: string[]; rev: string }) => void; onPanelArrow?: (a: PanelArrow) => void; onStatus?: (m: string) => void;
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
    if (drag.mode === 'new') {
      if (tool === 'text' || tool === 'select') return undefined;
      if (tool === 'pcloud') return markupFromDrag('rect', drag.a, drag.b, { color: 'blue' });
      if (tool === 'parrow') return markupFromDrag('arrow', drag.b, drag.a, { color: 'blue' });
      return markupFromDrag(tool, drag.a, drag.b, { color, rev, size, text: '' });
    }
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
    if (tool === 'parrow' && !anchorAt(anchors, p)) { onStatus?.('Press on a panel or a circuit to start the arrow'); return; }
    svg.current!.setPointerCapture(e.pointerId);
    setDrag({ mode: 'new', a: p, b: p });
  };
  // Outlines lit while dragging: the panels a cloud takes, or the arrow's target.
  const lit = drag?.mode === 'new' ? (tool === 'pcloud' ? anchors.filter((n) => panelsIn(anchors, drag.a, drag.b).includes(n.target)) : tool === 'parrow' ? [anchorAt(anchors, drag.a)].filter(Boolean) as SheetAnchor[] : []) : [];
  const hoverable = tool === 'parrow' || tool === 'pcloud';

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
      if (tool === 'pcloud') {
        const boards = panelsIn(anchors, d.a, d.b);
        if (!boards.length) { onStatus?.('No panel inside — drag around the panels to cloud'); return; }
        onPanelCloud?.({ boards, rev });
        onStatus?.(`Revision cloud △${rev || '—'} around ${boards.join(', ')}`);
        onTool('select');
        return;
      }
      if (tool === 'parrow') {
        const t = anchorAt(anchors, d.a);
        if (!t || Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < 3) return;
        const text = window.prompt(`Arrow text for ${t.target.replace(/^f:/, 'circuit ')}`, '')?.trim();
        if (!text) return;
        onPanelArrow?.(arrowFromDrag(t.target, d.a, d.b, mmPerUnit, text));
        onTool('select');
        return;
      }
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
      {hoverable && anchors.filter((n) => tool === 'parrow' || !n.target.startsWith('f:')).map((n) => (
        <rect key={n.target} x={n.x} y={n.y} width={n.w} height={n.h} fill="none" stroke="#2f80ed" strokeWidth={0.25} strokeDasharray="1 1.2" opacity={0.35} style={{ pointerEvents: 'none' }} />
      ))}
      {lit.map((n) => <rect key={`lit-${n.target}`} x={n.x} y={n.y} width={n.w} height={n.h} fill="#2f80ed" fillOpacity={0.12} stroke="#2f80ed" strokeWidth={0.4} style={{ pointerEvents: 'none' }} />)}
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
export function MarkupToolbar({ tool, color, size, selected, count, anchored, onTool, onColor, onSize, onDelete }: {
  anchored?: boolean; tool: MarkupTool; color: MarkupColor; size: number; selected: SheetMarkup | undefined; count: number;
  onTool: (t: MarkupTool) => void; onColor: (c: MarkupColor) => void; onSize: (s: number) => void; onDelete: () => void;
}) {
  const hint = ALL_TOOLS.find((t) => t.tool === tool)?.hint ?? '';
  const btn = ({ tool: t, label, key, icon: Icon, hint: h }: (typeof ALL_TOOLS)[number]) => (
    <button key={t} className={`icon-btn markup-tool${tool === t ? ' on' : ''}`} title={`${label} (${key}) — ${h}`} aria-label={label} aria-pressed={tool === t} onClick={() => onTool(t)}><Icon size={16} /></button>
  );
  const textual = tool === 'text' || tool === 'callout' || selected?.kind === 'text' || selected?.kind === 'callout';
  return (
    <div className="markup-bar">
      <b>Markup</b>
      <span className="markup-tools" role="toolbar" aria-label="Markup tools">
        {MARKUP_TOOLS.map(btn)}
      </span>
      {anchored && <span className="markup-tools" role="toolbar" aria-label="Panel annotation tools" title="Tied to panels and circuits">{ANCHORED_TOOLS.map(btn)}</span>}
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
      <button className="icon-btn markup-tool" disabled={!selected} onClick={onDelete} title={`Delete the selected ${selected ? MARKUP_LABEL[selected.kind].toLowerCase() : 'markup'} (Delete key)`} aria-label="Delete markup"><Trash2 size={16} /></button>
      <span className="m">{ALL_TOOLS.find((t) => t.tool === tool)?.label}: {hint}{count ? ` · ${count} on this sheet` : ''}</span>
    </div>
  );
}
