import type { DxfPrimitive } from '../docs/dxf';

/** Markups drawn on one sheet: revision clouds, notes, callouts, arrows,
 * lines and boxes. They belong to the sheet, in paper millimetres (origin
 * top-left, y down), so regenerating the drawing from the design never moves
 * or removes them. */
export type MarkupKind = 'cloud' | 'rect' | 'line' | 'arrow' | 'text' | 'callout';
export type MarkupColor = 'red' | 'blue' | 'black';

export interface SheetMarkup {
  id: string;
  kind: MarkupKind;
  /** cloud, rect: top-left corner. line, arrow: start. text: baseline start. callout: text position. */
  x: number;
  y: number;
  /** cloud, rect: size. */
  w?: number;
  h?: number;
  /** line, arrow: end. callout: the point the leader arrow touches. */
  x2?: number;
  y2?: number;
  /** text, callout: lines separated by \n. */
  text?: string;
  /** cloud: revision letter shown in its triangle. */
  rev?: string;
  color?: MarkupColor;
  /** text, callout: letter height (mm). */
  size?: number;
}

export const MARKUP_COLORS: Record<MarkupColor, { css: string; dxf: number; layer: string }> = {
  red: { css: '#d00000', dxf: 1, layer: 'E-MARKUP' },
  blue: { css: '#0050c8', dxf: 5, layer: 'E-MARKUP-BLUE' },
  black: { css: '#000000', dxf: 7, layer: 'E-MARKUP-BLACK' }
};
/** DXF layers (name → AutoCAD colour) the markups use. */
export const MARKUP_LAYERS: Record<string, number> = Object.fromEntries(Object.values(MARKUP_COLORS).map((c) => [c.layer, c.dxf]));

export const MARKUP_LABEL: Record<MarkupKind, string> = { cloud: 'Revision cloud', rect: 'Box', line: 'Line', arrow: 'Arrow', text: 'Note', callout: 'Callout' };
const DEFAULT_SIZE = 3.5;
const LINE_W = 0.35;
const CLOUD_STEP = 5;
const HEAD = 2.8;
const TRI = 7;
const PAD = 1.2;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (v: number) => +v.toFixed(2);
type Pt = [number, number];
export const markupColor = (m: SheetMarkup) => MARKUP_COLORS[m.color ?? 'red'];
export const markupSize = (m: SheetMarkup) => (m.size && m.size > 0 ? m.size : DEFAULT_SIZE);
const linesOf = (m: SheetMarkup) => (m.text ?? '').split('\n');

export function newMarkupId(): string { return `mk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; }

/** Box of a text or callout, estimated (Arial averages ≈ 0.55 × the letter height per character). */
function textBox(m: SheetMarkup): { x: number; y: number; w: number; h: number } {
  const s = markupSize(m), lines = linesOf(m);
  const w = Math.max(s, ...lines.map((l) => l.length * s * 0.55));
  const h = lines.length * s * 1.2;
  const pad = m.kind === 'callout' ? PAD : 0;
  return { x: m.x - pad, y: m.y - s - pad, w: w + 2 * pad, h: h + 2 * pad };
}

/** Bounding box in paper mm. */
export function markupBounds(m: SheetMarkup): { x: number; y: number; w: number; h: number } {
  switch (m.kind) {
    case 'cloud': case 'rect': return { x: m.x, y: m.y, w: m.w ?? 0, h: m.h ?? 0 };
    case 'line': case 'arrow': {
      const x2 = m.x2 ?? m.x, y2 = m.y2 ?? m.y;
      return { x: Math.min(m.x, x2), y: Math.min(m.y, y2), w: Math.abs(x2 - m.x), h: Math.abs(y2 - m.y) };
    }
    case 'text': return textBox(m);
    case 'callout': {
      const b = textBox(m), x2 = m.x2 ?? m.x, y2 = m.y2 ?? m.y;
      const x = Math.min(b.x, x2), y = Math.min(b.y, y2);
      return { x, y, w: Math.max(b.x + b.w, x2) - x, h: Math.max(b.y + b.h, y2) - y };
    }
  }
}

/** The scalloped outline of a revision cloud (clockwise on paper, bumps outward). */
export function cloudPoints(x: number, y: number, w: number, h: number): Pt[] {
  const corners: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const out: Pt[] = [];
  for (let e = 0; e < 4; e++) {
    const [px, py] = corners[e], [qx, qy] = corners[(e + 1) % 4];
    const len = Math.hypot(qx - px, qy - py);
    if (len < 1e-6) continue;
    const dx = (qx - px) / len, dy = (qy - py) / len;
    const nx = dy, ny = -dx; // outward normal
    const n = Math.max(1, Math.round(len / CLOUD_STEP));
    const s = len / n, r = s / 2;
    for (let i = 0; i < n; i++) {
      const cx = px + dx * s * (i + 0.5), cy = py + dy * s * (i + 0.5);
      for (let k = 0; k < 10; k++) {
        const t = (Math.PI * k) / 10;
        out.push([cx - dx * r * Math.cos(t) + nx * r * Math.sin(t), cy - dy * r * Math.cos(t) + ny * r * Math.sin(t)]);
      }
    }
  }
  return out;
}

/** The point of a box's outline nearest a target outside it (where a callout's leader starts). */
function leaderStart(b: { x: number; y: number; w: number; h: number }, t: Pt): Pt {
  const cx = Math.min(Math.max(t[0], b.x), b.x + b.w), cy = Math.min(Math.max(t[1], b.y), b.y + b.h);
  if (cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h) return [b.x + b.w / 2, b.y + b.h]; // target inside: leave from the bottom
  return [cx, cy];
}

function arrowHead(from: Pt, to: Pt): Pt[] {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const wing = (d: number): Pt => [to[0] - HEAD * Math.cos(a + d), to[1] - HEAD * Math.sin(a + d)];
  return [wing(0.45), to, wing(-0.45)];
}

/** Everything a markup draws as plain geometry (shared by the screen, PDF and DXF). */
interface Shapes { polylines: { pts: Pt[]; closed?: boolean }[]; texts: { x: number; y: number; size: number; text: string }[] }
function shapesOf(m: SheetMarkup): Shapes {
  const s: Shapes = { polylines: [], texts: [] };
  switch (m.kind) {
    case 'cloud': {
      const w = m.w ?? 0, h = m.h ?? 0;
      s.polylines.push({ pts: cloudPoints(m.x, m.y, w, h), closed: true });
      if (m.rev?.trim()) { // revision triangle at the top-right corner
        const cx = m.x + w, cy = m.y - TRI * 0.1, k = TRI / 2;
        s.polylines.push({ pts: [[cx, cy - k * 1.2], [cx - k, cy + k * 0.7], [cx + k, cy + k * 0.7]], closed: true });
        s.texts.push({ x: cx - m.rev.trim().length * 0.7, y: cy + k * 0.45, size: 2.6, text: m.rev.trim() });
      }
      break;
    }
    case 'rect': { const w = m.w ?? 0, h = m.h ?? 0; s.polylines.push({ pts: [[m.x, m.y], [m.x + w, m.y], [m.x + w, m.y + h], [m.x, m.y + h]], closed: true }); break; }
    case 'line': s.polylines.push({ pts: [[m.x, m.y], [m.x2 ?? m.x, m.y2 ?? m.y]] }); break;
    case 'arrow': {
      const a: Pt = [m.x, m.y], b: Pt = [m.x2 ?? m.x, m.y2 ?? m.y];
      s.polylines.push({ pts: [a, b] }, { pts: arrowHead(a, b) });
      break;
    }
    case 'text': case 'callout': {
      const size = markupSize(m);
      linesOf(m).forEach((text, i) => { if (text.trim()) s.texts.push({ x: m.x, y: m.y + i * size * 1.2, size, text }); });
      if (m.kind === 'callout') {
        const b = textBox(m), t: Pt = [m.x2 ?? m.x, m.y2 ?? m.y];
        s.polylines.push({ pts: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], closed: true });
        const from = leaderStart(b, t);
        if (Math.hypot(t[0] - from[0], t[1] - from[1]) > 0.5) s.polylines.push({ pts: [from, t] }, { pts: arrowHead(from, t) });
      }
      break;
    }
  }
  return s;
}

/** SVG elements for one markup, in paper mm. */
export function markupSvg(m: SheetMarkup): string {
  const c = markupColor(m).css, sh = shapesOf(m);
  const lines = sh.polylines.map((p) => `<polyline points="${p.pts.concat(p.closed ? [p.pts[0]] : []).map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${LINE_W}" stroke-linejoin="round" stroke-linecap="round"/>`);
  const texts = sh.texts.map((t) => `<text x="${r2(t.x)}" y="${r2(t.y)}" font-size="${t.size}" font-family="Arial, sans-serif" fill="${c}">${esc(t.text)}</text>`);
  return [...lines, ...texts].join('');
}

/** All markups as one SVG layer covering the whole sheet (PDF). */
export function markupLayerHtml(markups: SheetMarkup[], w: number, h: number): string {
  if (!markups.length) return '';
  return `<svg class="markup" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;width:${w}mm;height:${h}mm;pointer-events:none">${markups.map((m) => `<g>${markupSvg(m)}</g>`).join('')}</svg>`;
}

/** DXF geometry of the markups on a sheet of the given height (paper mm, y up). */
export function markupDxf(markups: SheetMarkup[], paperH: number): DxfPrimitive[] {
  const out: DxfPrimitive[] = [];
  for (const m of markups) {
    const layer = markupColor(m).layer, sh = shapesOf(m);
    for (const p of sh.polylines) out.push({ type: 'polyline', layer, closed: p.closed, points: p.pts.map(([x, y]): Pt => [x, paperH - y]) });
    for (const t of sh.texts) out.push({ type: 'text', layer, x: t.x, y: paperH - t.y, height: t.size, text: t.text });
  }
  return out;
}

/** An invisible, easy-to-click shape for selecting a markup on screen. */
export function markupHit(m: SheetMarkup): string {
  if (m.kind === 'line' || m.kind === 'arrow') return `<line x1="${m.x}" y1="${m.y}" x2="${m.x2 ?? m.x}" y2="${m.y2 ?? m.y}" stroke="transparent" stroke-width="4" stroke-linecap="round"/>`;
  const b = markupBounds(m);
  return `<rect x="${r2(b.x - 1)}" y="${r2(b.y - 1)}" width="${r2(b.w + 2)}" height="${r2(b.h + 2)}" fill="transparent"/>`;
}

export interface MarkupHandle { id: 'se' | 'p1' | 'p2' | 'target'; x: number; y: number }
export function markupHandles(m: SheetMarkup): MarkupHandle[] {
  switch (m.kind) {
    case 'cloud': case 'rect': return [{ id: 'se', x: m.x + (m.w ?? 0), y: m.y + (m.h ?? 0) }];
    case 'line': case 'arrow': return [{ id: 'p1', x: m.x, y: m.y }, { id: 'p2', x: m.x2 ?? m.x, y: m.y2 ?? m.y }];
    case 'callout': return [{ id: 'target', x: m.x2 ?? m.x, y: m.y2 ?? m.y }];
    default: return [];
  }
}

/** The markup with one handle dragged to (x, y). */
export function dragHandle(m: SheetMarkup, id: MarkupHandle['id'], x: number, y: number): SheetMarkup {
  if (id === 'se') return { ...m, w: Math.max(4, x - m.x), h: Math.max(4, y - m.y) };
  if (id === 'p1') return { ...m, x, y };
  if (id === 'p2' || id === 'target') return { ...m, x2: x, y2: y };
  return m;
}

/** The markup moved by (dx, dy). A callout's pointer stays on what it points at. */
export function moveMarkup(m: SheetMarkup, dx: number, dy: number): SheetMarkup {
  const moved = { ...m, x: m.x + dx, y: m.y + dy };
  if (m.kind === 'line' || m.kind === 'arrow') { moved.x2 = (m.x2 ?? m.x) + dx; moved.y2 = (m.y2 ?? m.y) + dy; }
  return moved;
}

/** A new markup from a drag (a → b, paper mm); undefined when it would be too small to see. */
export function markupFromDrag(kind: MarkupKind, a: Pt, b: Pt, extra: Partial<SheetMarkup> = {}): SheetMarkup | undefined {
  const base = { id: newMarkupId(), kind, ...extra };
  if (kind === 'cloud' || kind === 'rect') {
    const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
    return w < 4 || h < 4 ? undefined : { ...base, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w, h };
  }
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) return undefined;
  if (kind === 'line' || kind === 'arrow') return { ...base, x: a[0], y: a[1], x2: b[0], y2: b[1] };
  if (kind === 'callout') return { ...base, x: b[0], y: b[1], x2: a[0], y2: a[1] }; // pressed on the target, released where the text goes
  return undefined;
}
