/** Form-4 MDB / SMDB enclosure drawing: front view with the plan view below it, dimensioned,
 * in real millimetres (y up). One geometry for the screen, the PDF (SVG) and the DXF (1:1),
 * so all three always agree. Illustrative, not a manufacturing drawing. */
import { stackSections, type Form4Counts, type Form4Result } from '../calc/form4';
import { toDxf, type DxfPrimitive } from '../docs/dxf';
import { escapeHtmlAttr } from '../util/escape';

/** Layer → AutoCAD colour index. */
export const FORM4_LAYERS: Record<string, number> = { 'F4-OUTLINE': 7, 'F4-DEVICE': 3, 'F4-CHAMBER': 8, 'F4-DIM': 4, 'F4-TEXT': 7 };

const T = 60; // general text height, mm
const GAP = 600; // front view (plinth bottom, y = 0) to the plan's back edge
const OUT = 'F4-OUTLINE', DEV = 'F4-DEVICE', CH = 'F4-CHAMBER', DIM = 'F4-DIM', TXT = 'F4-TEXT';

const rect = (layer: string, x: number, y: number, w: number, h: number): DxfPrimitive =>
  ({ type: 'polyline', layer, closed: true, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
const text = (s: string, x: number, y: number, height = T, align: 'left' | 'center' | 'right' = 'center', rotation = 0, layer = TXT): DxfPrimitive =>
  ({ type: 'text', layer, x, y, height, text: s, align, ...(rotation ? { rotation } : {}) });

/** Horizontal dimension between x1 and x2 at height y, with extension lines down to yFrom. */
function hDim(x1: number, x2: number, y: number, yFrom: number, label: string): DxfPrimitive[] {
  const t = 40, up = y > yFrom ? 1 : -1;
  return [
    { type: 'line', layer: DIM, x1, y1: yFrom + up * 30, x2: x1, y2: y + up * 40 },
    { type: 'line', layer: DIM, x1: x2, y1: yFrom + up * 30, x2, y2: y + up * 40 },
    { type: 'line', layer: DIM, x1, y1: y, x2, y2: y },
    { type: 'line', layer: DIM, x1: x1 - t, y1: y - t, x2: x1 + t, y2: y + t },
    { type: 'line', layer: DIM, x1: x2 - t, y1: y - t, x2: x2 + t, y2: y + t },
    text(label, (x1 + x2) / 2, y + 25, 50, 'center', 0, DIM)
  ];
}

/** Vertical dimension between y1 and y2 at x, extension lines from xFrom. */
function vDim(y1: number, y2: number, x: number, xFrom: number, label: string): DxfPrimitive[] {
  const t = 40;
  return [
    { type: 'line', layer: DIM, x1: xFrom + 30, y1, x2: x + 40, y2: y1 },
    { type: 'line', layer: DIM, x1: xFrom + 30, y1: y2, x2: x + 40, y2 },
    { type: 'line', layer: DIM, x1: x, y1, x2: x, y2 },
    { type: 'line', layer: DIM, x1: x - t, y1: y1 - t, x2: x + t, y2: y1 + t },
    { type: 'line', layer: DIM, x1: x - t, y1: y2 - t, x2: x + t, y2: y2 + t },
    text(label, x + 70, (y1 + y2) / 2 - 25, 50, 'left', 0, DIM)
  ];
}

export function form4Drawing(counts: Form4Counts, r: Form4Result, title?: string): DxfPrimitive[] {
  const out: DxfPrimitive[] = [];
  if (!r.widthMm) return out;
  const { w: W, h: H, d: D, plinth: P } = r.dims;
  const top = P + H; // top of the panel
  const pTop = -GAP, pBot = -GAP - D; // plan: back edge (top) and front edge (bottom)
  const stacks = stackSections(counts, r.sections);
  let x = 0, sec = 0;

  for (const part of r.parts) {
    const w = part.mm;
    // Front view section and plan view section
    out.push(rect(OUT, x, P, w, H), rect(OUT, x, pBot, w, D));
    if (part.kind === 'device' && part.column && part.qty) {
      const each = w / part.qty;
      for (let i = 0; i < part.qty; i++) {
        const x0 = x + each * i, cx = x0 + each / 2;
        if (i) out.push({ type: 'line', layer: OUT, x1: x0, y1: P, x2: x0, y2: top }, { type: 'line', layer: OUT, x1: x0, y1: pBot, x2: x0, y2: pTop });
        out.push(rect(DEV, cx - each * 0.3, top - H * 0.57, each * 0.6, H * 0.22));
        out.push(text(part.column.short, cx, top - H * 0.48));
        out.push(text(part.column.short, cx, (pTop + pBot) / 2 - T / 2));
      }
    } else if (part.kind === 'section') {
      let y = top - 50;
      for (const c of stacks[sec] ?? []) {
        const h = c.heightMm!;
        out.push(rect(DEV, x + 40, y - h + 20, w - 80, h - 20), text(c.short, x + w / 2, y - h / 2 - 15, 50));
        y -= h;
      }
      sec++;
      out.push(text(`OUTGOING ${sec}`, x + w / 2, (pTop + pBot) / 2 - T / 2, 50));
    } else {
      out.push(text('CABLE CHAMBER', x + w / 2 + 20, P + H / 2, 50, 'center', 90, CH));
      out.push(text('CABLE CHAMBER', x + w / 2 + 20, (pTop + pBot) / 2, 45, 'center', 90, CH));
    }
    x += w;
  }

  // Plinth, front view
  out.push(rect(OUT, 0, 0, W, P));
  // Dimensions: overall width above the front view; height and plinth to the right; plan depth and section widths
  out.push(...hDim(0, W, top + 250, top, `W ${W}`));
  out.push(...vDim(P, top, W + 250, W, `H ${H}`));
  out.push(...vDim(0, P, W + 250, W, `${P} PLINTH`).slice(2, 5)); // shares the extension line at P
  out.push(text(`${P} PLINTH`, W + 320, 25, 45, 'left', 0, DIM));
  out.push(...vDim(pBot, pTop, W + 250, W, `D ${D}`));
  let cx = 0;
  for (const part of r.parts) { out.push(...hDim(cx, cx + part.mm, pBot - 250, pBot, String(part.mm))); cx += part.mm; }

  // View titles, front marker, drawing title
  out.push(text('FRONT VIEW', W / 2, -250, 80));
  out.push(text('FRONT', W / 2, pBot - 130, 50));
  out.push(text('PLAN VIEW', W / 2, pBot - 520, 80));
  // The DXF carries its own title and note; on screen and in the PDF the page says them.
  if (title) out.push(text(title, 0, top + 560, 70, 'left'), text('FORM-4, INCOMING AND OUTGOING BOTTOM ENTRY - ILLUSTRATIVE, NOT A MANUFACTURING DRAWING - DIMENSIONS IN MM', 0, top + 450, 45, 'left'));
  return out;
}

/** The drawing as an R12 DXF, 1 unit = 1 mm. */
export const form4Dxf = (counts: Form4Counts, r: Form4Result, title?: string) => toDxf(form4Drawing(counts, r, title), FORM4_LAYERS);

/** Escaped for text and quoted attributes (project data is untrusted). */
const esc = escapeHtmlAttr;

/** The drawing as SVG for the screen (device outlines in the accent colour) or the PDF (mono: black). */
export function form4DrawingSvg(counts: Form4Counts, r: Form4Result, mono = false): string {
  const items = form4Drawing(counts, r);
  if (!items.length) return '';
  const pad = 120;
  const minX = -pad, maxX = r.widthMm + 900, maxY = r.dims.h + r.dims.plinth + 450, minY = -GAP - r.dims.d - 600;
  const Y = (y: number) => maxY - y;
  const stroke = (layer: string) => (layer === DEV ? (mono ? '#000' : 'var(--acc)') : 'currentColor');
  const op = (layer: string) => (layer === DIM || layer === CH ? ' stroke-opacity=".7" fill-opacity=".7"' : '');
  const svg = items.map((p) => {
    switch (p.type) {
      case 'line': return `<line x1="${p.x1}" y1="${Y(p.y1)}" x2="${p.x2}" y2="${Y(p.y2)}" stroke="${stroke(p.layer)}"${op(p.layer)}/>`;
      case 'polyline': return `<polyline points="${p.points.map(([a, b]) => `${a},${Y(b)}`).join(' ')}${p.closed ? ` ${p.points[0][0]},${Y(p.points[0][1])}` : ''}" fill="none" stroke="${stroke(p.layer)}"${op(p.layer)}/>`;
      case 'circle': return `<circle cx="${p.x}" cy="${Y(p.y)}" r="${p.r}" fill="none" stroke="${stroke(p.layer)}"/>`;
      case 'text': {
        const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
        const rot = p.rotation ? ` transform="rotate(${-p.rotation} ${p.x} ${Y(p.y)})"` : '';
        return `<text x="${p.x}" y="${Y(p.y)}" style="font-size:${p.height * 1.35}px" text-anchor="${anchor}" fill="currentColor"${op(p.layer)}${rot}>${esc(p.text)}</text>`;
      }
    }
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${maxX - minX} ${maxY - minY}" font-family="Arial"><g vector-effect="non-scaling-stroke" style="stroke-width:1px">${svg.replace(/<(line|polyline|circle) /g, '<$1 vector-effect="non-scaling-stroke" ')}</g></svg>`;
}
