import type { DrawingInfo, Project } from '../types';
import { svgToDxf } from '../diagram/exportSvg';
import { dxfText, toDxf, type DxfPrimitive } from './dxf';
import { furnitureScale, sheetTitleBlock, SHEET_MM, type SheetInfo } from './sldSheet';
import { abbreviationsIn } from './sldNotes';
import { fillParams } from '../model/params';
import { FIRE_NOTE } from '../model/cableRefs';

/** A drawing sheet as DXF, as it prints: real paper size in mm, frame,
 * the drawing scaled into its area, legend column (legend, cable schedule,
 * abbreviations), notes, revision table and title block — on named layers
 * so it can be restyled in CAD:
 *   E-FRAME, E-TITLE, E-LEGEND, E-NOTES, E-SYMBOL, E-CABLE, E-BUSBAR, E-TEXT, E-RESULT. */

export const SHEET_LAYERS: Record<string, number> = {
  'E-FRAME': 7, 'E-TITLE': 7, 'E-LEGEND': 8, 'E-NOTES': 7, 'E-SYMBOL': 3, 'E-CABLE': 7, 'E-BUSBAR': 1, 'E-TEXT': 7, 'E-RESULT': 4
};
const LAYER_OF: Record<string, string> = { SYMBOL: 'E-SYMBOL', CABLE: 'E-CABLE', BUSBAR: 'E-BUSBAR', TEXT: 'E-TEXT', RESULT: 'E-RESULT' };

const sizeOf = (svg: string) => {
  const m = svg.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1000, h: 700 };
};

/** SVG placed into a box (mm), scaled to fit (or to a given width), top-aligned or centred. */
function placeSvg(svg: string, box: { x: number; y: number; w: number; h: number }, layer?: string, centre = true): { items: DxfPrimitive[]; usedH: number } {
  const { w, h } = sizeOf(svg);
  const s = Math.min(box.w / w, box.h / h);
  const dw = w * s, dh = h * s;
  const ox = box.x + (centre ? (box.w - dw) / 2 : 0);
  const oy = box.y + (centre ? (box.h - dh) / 2 : box.h - dh); // DXF y up: top-aligned = box top minus height
  const items = svgToDxf(svg, h).map((p): DxfPrimitive => {
    const L = layer ?? LAYER_OF[p.layer] ?? 'E-SYMBOL';
    const X = (x: number) => ox + x * s, Y = (y: number) => oy + y * s;
    switch (p.type) {
      case 'line': return { ...p, layer: L, x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2) };
      case 'polyline': return { ...p, layer: L, points: p.points.map(([a, b]) => [X(a), Y(b)] as [number, number]) };
      case 'circle': return { ...p, layer: L, x: X(p.x), y: Y(p.y), r: p.r * s };
      case 'text': return { ...p, layer: L, x: X(p.x), y: Y(p.y), height: p.height * s };
    }
  });
  return { items, usedH: dh };
}

const rect = (layer: string, x: number, y: number, w: number, h: number): DxfPrimitive => ({ type: 'polyline', layer, closed: true, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
const text = (layer: string, x: number, y: number, height: number, t: string, align: 'left' | 'center' | 'right' = 'left'): DxfPrimitive => ({ type: 'text', layer, x, y, height, text: dxfText(t), align });

export function buildSheetDxf(project: Project, svg: string, size: NonNullable<DrawingInfo['sheet']>, one: SheetInfo): string {
  const { w, h } = SHEET_MM[size];
  const out: DxfPrimitive[] = [];
  const t = sheetTitleBlock(project, one);
  const abbr = project.drawing?.abbreviations === false ? [] : abbreviationsIn(svg);
  const cables = one.cables ?? [];
  const legend = one.legendSvg ?? '';
  const k = furnitureScale(size, svg);
  const notes = [...(project.drawing?.notes ?? []), ...(one.notes ?? [])].map((n) => fillParams(n, project));

  // Sheet edge and frame (20 mm left for binding, 10 mm elsewhere).
  out.push(rect('E-FRAME', 0, 0, w, h));
  const fx = 20, fy = 10, fw = w - 30, fh = h - 20;
  out.push(rect('E-FRAME', fx, fy, fw, fh));

  // Title block (bottom right) and revision table (bottom left), same layout as the PDF.
  const band = 44 * k, tbW = 180 * k;
  const tbx = fx + fw - tbW, tby = fy;
  const rowsH = [8, 8, 9, 7, 6, 6].map((r) => (r * band) / 44);
  out.push(rect('E-TITLE', tbx, tby, tbW, band));
  const cells: [string, string, number][][] = [
    [['Company / consultant', t.company, 3]],
    [['Project', t.project, 2], ['Owner', t.owner, 1]],
    [[`Drawing title${one.status ? ` - ${one.status}` : ''}`, t.title, 3]],
    [['Drawing no.', t.number, 1], ['Revision', t.revision, 1], ['Date', t.date, 1]],
    [['Drawn', t.drawnBy, 1], ['Checked', t.checkedBy, 1], ['Approved', t.approvedBy, 1]],
    [['Sheet', `${one.index} of ${one.count} - ${size} - Scale ${t.scale}`, 2], ['System', `${project.voltageV} V, 3Ph + N, ${project.frequencyHz} Hz`, 1]]
  ];
  let yTop = tby + band;
  cells.forEach((row, i) => {
    const rh = rowsH[i];
    const y0 = yTop - rh;
    if (i > 0) out.push({ type: 'line', layer: 'E-TITLE', x1: tbx, y1: yTop, x2: tbx + tbW, y2: yTop });
    let cx = tbx;
    row.forEach(([key, val, span]) => {
      const cw = (tbW * span) / 3;
      if (cx > tbx) out.push({ type: 'line', layer: 'E-TITLE', x1: cx, y1: y0, x2: cx, y2: yTop });
      out.push(text('E-TITLE', cx + 1.5 * k, yTop - 2.6 * k, 1.6 * k, key.toUpperCase()));
      const small = rh < 7.5 * k; // the 6–7 mm rows: smaller value text so it clears the label
      out.push(text('E-TITLE', cx + 1.5 * k, y0 + (small ? 1.0 : 1.4) * k, (i === 2 ? 3.2 : small ? 1.9 : 2.4) * k, val));
      cx += cw;
    });
    yTop = y0;
  });
  // Revision table.
  const rvx = fx, rvw = fw - tbW;
  out.push(rect('E-TITLE', rvx, tby, rvw, band));
  const rh = 4.2 * k;
  out.push(text('E-TITLE', rvx + 1.5 * k, tby + band - 3 * k, 1.8 * k, 'REV'));
  out.push(text('E-TITLE', rvx + rvw * 0.1, tby + band - 3 * k, 1.8 * k, 'DATE'));
  out.push(text('E-TITLE', rvx + rvw * 0.28, tby + band - 3 * k, 1.8 * k, 'DESCRIPTION'));
  out.push({ type: 'line', layer: 'E-TITLE', x1: rvx, y1: tby + band - rh, x2: rvx + rvw, y2: tby + band - rh });
  (t.history.length ? t.history : [{ id: '-', date: '', description: 'Not issued' }]).forEach((r, i) => {
    const y = tby + band - rh * (i + 2) + 1.2 * k;
    out.push(text('E-TITLE', rvx + 1.5 * k, y, 2 * k, r.id));
    out.push(text('E-TITLE', rvx + rvw * 0.1, y, 2 * k, r.date));
    out.push(text('E-TITLE', rvx + rvw * 0.28, y, 2 * k, r.description));
  });

  // Legend column (right): legend, cable schedule, abbreviations.
  const side = !!(legend || cables.length || abbr.length);
  const colW = side ? 92 * k : 0;
  const colX = fx + fw - colW, colTop = fy + fh, colBottom = fy + band + 3 * k;
  if (side) {
    out.push({ type: 'line', layer: 'E-LEGEND', x1: colX, y1: colBottom, x2: colX, y2: colTop });
    let y = colTop - 2 * k;
    if (legend) {
      const r = placeSvg(legend, { x: colX + 2 * k, y: colBottom, w: colW - 4 * k, h: y - colBottom }, 'E-LEGEND', false); // top-aligned
      out.push(...r.items);
      y -= r.usedH + 3 * k;
    }
    const line = (s: string, bold = false) => { if (y < colBottom + 3 * k) return; out.push(text('E-LEGEND', colX + 2 * k, y - 2.4 * k, (bold ? 2.4 : 1.9) * k, s)); y -= (bold ? 4 : 3.1) * k; };
    if (cables.length) {
      line('CABLE SCHEDULE', true);
      for (const c of cables) line(`(${c.ref})  ${c.text}`);
      if (cables.some((c) => c.fireRated)) line(`NOTE: ${FIRE_NOTE}`);
      y -= 2 * k;
    }
    if (abbr.length) {
      line('ABBREVIATIONS', true);
      for (const [a, d] of abbr) line(`${a}   ${d}`);
    }
  }
  // Notes (above the title block, right).
  if (notes.length) {
    let y = fy + band + 3 * k + notes.length * 3.2 * k + 5 * k;
    out.push(text('E-NOTES', tbx + 2 * k, y, 2.4 * k, 'NOTES'));
    notes.forEach((n, i) => { y -= 3.2 * k; out.push(text('E-NOTES', tbx + 2 * k, y, 1.9 * k, `${i + 1}. ${n}`)); });
  }

  // The drawing, scaled into the rest of the frame.
  const area = { x: fx + 3, y: fy + band + 3, w: fw - 6 - colW, h: fh - band - 6 };
  out.push(...placeSvg(svg, area).items);
  return toDxf(out, SHEET_LAYERS);
}

