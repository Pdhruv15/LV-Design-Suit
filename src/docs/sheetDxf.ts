import type { DrawingInfo, Project } from '../types';
import { svgToDxf } from '../diagram/exportSvg';
import { toDxf, type DxfPrimitive } from './dxf';
import { furnitureScale, sheetTitleBlock, SHEET_MM, type SheetInfo } from './sldSheet';
import { abbreviationsIn } from './sldNotes';
import { fillParams } from '../model/params';
import { FIRE_NOTE } from '../model/cableRefs';
import { templateOf, templateSize } from '../model/titleBlock';
import { templateTitleBlockDxf, type TitleDetail } from './titleBlockDxf';
import { textInBox, textWidth, wrapDxfText, type DxfBox } from './dxfLayout';

/** Paper-sized, editable R12 drawings. Overflow is placed on additional
 * sheets, never discarded or drawn across the diagram. */
export const SHEET_LAYERS: Record<string, number> = {
  'E-FRAME': 7, 'E-TITLE': 7, 'E-LEGEND': 8, 'E-NOTES': 7, 'E-SYMBOL': 3, 'E-CABLE': 7, 'E-BUSBAR': 1, 'E-TEXT': 7, 'E-RESULT': 4
};
const LAYER_OF: Record<string, string> = { SYMBOL: 'E-SYMBOL', CABLE: 'E-CABLE', BUSBAR: 'E-BUSBAR', TEXT: 'E-TEXT', RESULT: 'E-RESULT' };
type SheetSize = NonNullable<DrawingInfo['sheet']>;
export interface DxfSheetPage { data: string; index: number; count: number; continuation: boolean; warnings: string[] }
const rect = (layer: string, b: DxfBox): DxfPrimitive => ({ type: 'polyline', layer, closed: true, points: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] });

function sizeOf(svg: string) {
  const match = svg.match(/viewBox=["']([^"']+)["']/);
  if (!match) return { x: 0, y: 0, w: 1000, h: 700 };
  const a = match[1].trim().split(/[\s,]+/).map(Number);
  if (a.length !== 4 || !a.every(Number.isFinite) || a[2] <= 0 || a[3] <= 0) throw new Error('The drawing has an invalid SVG viewBox.');
  return { x: a[0], y: a[1], w: a[2], h: a[3] };
}

function shift(p: DxfPrimitive, dx: number, dy = 0): DxfPrimitive {
  switch (p.type) {
    case 'line': return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    case 'polyline': return { ...p, points: p.points.map(([x, y]) => [x + dx, y + dy]) };
    default: return { ...p, x: p.x + dx, y: p.y + dy };
  }
}

function placeSvg(svg: string, box: DxfBox, layer?: string, centre = true): { items: DxfPrimitive[]; usedH: number; scale: number } {
  if (box.w <= 0 || box.h <= 0) throw new Error('The title block leaves no room for the drawing.');
  const source = sizeOf(svg);
  const s = Math.min(box.w / source.w, box.h / source.h);
  const dw = source.w * s, dh = source.h * s;
  const ox = box.x + (centre ? (box.w - dw) / 2 : 0);
  const oy = box.y + (centre ? (box.h - dh) / 2 : box.h - dh);
  const items = svgToDxf(svg, source.h).map((p): DxfPrimitive => {
    const L = layer ?? LAYER_OF[p.layer] ?? 'E-SYMBOL';
    const X = (x: number) => ox + (x - source.x) * s, Y = (y: number) => oy + (y + source.y) * s;
    switch (p.type) {
      case 'line': return { ...p, layer: L, x1: X(p.x1), y1: Y(p.y1), x2: X(p.x2), y2: Y(p.y2), ...(p.width ? { width: p.width * s } : {}) };
      case 'polyline': return { ...p, layer: L, points: p.points.map(([a, b]) => [X(a), Y(b)]), ...(p.width ? { width: p.width * s } : {}) };
      case 'circle': return { ...p, layer: L, x: X(p.x), y: Y(p.y), r: p.r * s };
      case 'text': return { ...p, layer: L, x: X(p.x), y: Y(p.y), height: p.height * s, ...(p.width ? { width: p.width * s } : {}) };
    }
  });
  return { items, usedH: dh, scale: s };
}

interface FlowLine { text: string; layer: string; heading?: boolean; section: string; blockLines?: number }

/** Lay out every physical sheet before serializing it, so file/ZIP export
 * and the single-file API share the same complete output. */
function sheetPages(project: Project, svg: string, size: SheetSize, one?: SheetInfo): { items: DxfPrimitive[][]; warnings: string[] } {
  const { w, h } = SHEET_MM[size];
  const frame = { x: 20, y: 10, w: w - 30, h: h - 20 };
  const t = sheetTitleBlock(project, one);
  const custom = templateOf(project);
  const dims = custom ? templateSize(custom) : { w: 180, h: 44 };
  if (custom && [...custom.cols, ...custom.rows].some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('The title block needs positive row heights and column widths.');
  const k = furnitureScale(size, svg, dims);
  const extra: Record<string, string> = {
    SheetNo: t.number, DrawingNo: t.number, SheetTitle: t.title, DrawingTitle: t.title,
    SheetCount: String(one?.count ?? 1), SheetIndex: String(one?.index ?? 1), SheetSize: size,
    Status: one?.status ?? '', Scale: t.scale, Rev: t.revision, RevDate: t.date,
    ...(one?.history?.length ? { RevDescription: t.history[0]?.description ?? '' } : {}),
    ...(one?.drawnBy ? { DrawnBy: t.drawnBy } : {}), ...(one?.checkedBy ? { CheckedBy: t.checkedBy } : {}), ...(one?.approvedBy ? { ApprovedBy: t.approvedBy } : {})
  };
  const warnings: string[] = [], details: TitleDetail[] = [];
  const title: DxfPrimitive[] = [];
  const bounded = (b: DxfBox, value: string, height: number, label: string) => {
    let items = textInBox('E-TITLE', b, value, height);
    if (items.some((p) => p.type === 'text' && (p.width ?? 0) < textWidth(p.text, p.height) * 0.55)) {
      const reference = details.length + 1;
      details.push({ label: `[${reference}] ${label}`, value });
      items = textInBox('E-TITLE', b, `[${reference}]`, height);
    }
    title.push(...items);
  };
  const tbW = dims.w * k;
  const tbx = frame.x + frame.w - tbW;
  const cells: [string, string, number][][] = [
    [['Company / consultant', t.company, 3]],
    [['Project', t.project, 2], ['Owner', t.owner, 1]],
    [[`Drawing title${one?.status ? ` - ${one.status}` : ''}`, t.title, 3]],
    [['Drawing no.', t.number, 1], ['Revision', t.revision, 1], ['Date', t.date, 1]],
    [['Drawn', t.drawnBy, 1], ['Checked', t.checkedBy, 1], ['Approved', t.approvedBy, 1]],
    [['Sheet', `${one?.index ?? 1} of ${one?.count ?? 1} - ${size} - Scale ${t.scale}`, 2], ['System', `${project.voltageV} V, 3Ph + N, ${project.frequencyHz} Hz`, 1]]
  ];
  // Grow ordinary rows to accommodate wrapped values; exceptionally large
  // values are listed in the additional-information area instead of crushed.
  const rows = cells.map((row, i) => Math.max([8, 8, 9, 7, 6, 6][i] * k, ...row.map(([, value, span]) => {
    const height = (i === 2 ? 3.2 : i >= 3 ? 1.9 : 2.4) * k;
    const count = Math.min(3, Math.max(1, wrapDxfText(value, tbW * span / 3 - 3 * k, height).length));
    return 3.5 * k + count * height * 1.5;
  })));
  const history = t.history.length ? t.history : [{ id: '-', date: '', description: 'Not issued' }];
  const titleH = custom ? dims.h * k : rows.reduce((a, b) => a + b, 0);
  const band = Math.max(titleH, (5 + history.length * 4.5) * k);
  if (!Number.isFinite(band) || band > frame.h * 0.65 || !Number.isFinite(tbW) || tbW <= 0 || tbW >= frame.w) throw new Error('The title block is too large for the selected paper size.');
  const titleBox = { x: tbx, y: frame.y, w: tbW, h: titleH };
  if (custom) {
    const result = templateTitleBlockDxf(custom, project, titleBox, extra, t.history);
    title.push(...result.items); warnings.push(...result.warnings); details.push(...result.details);
  } else {
    title.push(rect('E-TITLE', titleBox));
    let top = frame.y + band;
    cells.forEach((row, i) => {
      const rh = rows[i], bottom = top - rh;
      if (i) title.push({ type: 'line', layer: 'E-TITLE', x1: tbx, y1: top, x2: tbx + tbW, y2: top });
      let x = tbx;
      row.forEach(([label, value, span]) => {
        const cw = tbW * span / 3;
        if (x > tbx) title.push({ type: 'line', layer: 'E-TITLE', x1: x, y1: bottom, x2: x, y2: top });
        bounded({ x: x + 1.5 * k, y: top - 3 * k, w: cw - 3 * k, h: 2.5 * k }, label.toUpperCase(), 1.6 * k, `${label} caption`);
        bounded({ x: x + 1.5 * k, y: bottom + 0.6 * k, w: cw - 3 * k, h: rh - 3.6 * k }, value, (i === 2 ? 3.2 : i >= 3 ? 1.9 : 2.4) * k, label);
        x += cw;
      });
      top = bottom;
    });
    if (t.logo) warnings.push('DXF omits the raster logo; the logo is available in the PDF.');
  }
  const rvw = frame.w - tbW;
  title.push(rect('E-TITLE', { x: frame.x, y: frame.y, w: rvw, h: band }));
  const revCols = [0, 0.14, 0.36, 1];
  ['REV', 'DATE', 'DESCRIPTION'].forEach((s, j) => bounded({ x: frame.x + rvw * revCols[j] + k, y: frame.y + band - 4.5 * k, w: rvw * (revCols[j + 1] - revCols[j]) - 2 * k, h: 3.5 * k }, s, 1.8 * k, s));
  const rowH = Math.min(9 * k, (band - 5 * k) / history.length);
  history.forEach((r, i) => {
    const top = frame.y + band - 5 * k - i * rowH;
    title.push({ type: 'line', layer: 'E-TITLE', x1: frame.x, y1: top, x2: frame.x + rvw, y2: top });
    [r.id, r.date, r.description].forEach((s, j) => bounded({ x: frame.x + rvw * revCols[j] + k, y: top - rowH + 0.5 * k, w: rvw * (revCols[j + 1] - revCols[j]) - 2 * k, h: rowH - k }, s, 2 * k, `Revision ${r.id}${j === 2 ? ' description' : j === 1 ? ' date' : ''}`));
  });

  const bodyBottom = frame.y + band + 3;
  const bodyTop = frame.y + frame.h - 3;
  const bodyH = bodyTop - bodyBottom;
  const colW = Math.min(92 * k, frame.w * 0.4);
  const contentW = colW - 4 * k;
  const cap = Math.max(1.5, 1.9 * k), headingCap = Math.max(1.8, 2.4 * k);
  const step = Math.max(3.1 * k, cap * 1.5), headingStep = Math.max(4 * k, headingCap * 1.5);
  const flow: FlowLine[] = [];
  const section = (heading: string, values: string[], layer = 'E-LEGEND') => {
    const content = values.flatMap((value) => {
      const lines = wrapDxfText(value, contentW, cap);
      return lines.map((text, i): FlowLine => ({ text, layer, section: heading, ...(i === 0 ? { blockLines: lines.length } : {}) }));
    });
    if (!content.length) return;
    flow.push({ text: heading, layer, heading: true, section: heading });
    flow.push(...content);
  };
  const cables = one?.cables ?? [];
  if (cables.length) section('CABLE SCHEDULE', [...cables.map((c) => `(${c.ref})${c.fireRated ? ' *' : ''}  ${c.text}`), ...(cables.some((c) => c.fireRated) ? [`NOTE: ${FIRE_NOTE}`] : [])]);
  const abbr = project.drawing?.abbreviations === false ? [] : abbreviationsIn(svg);
  if (abbr.length) section('ABBREVIATIONS', abbr.map(([a, d]) => `${a}   ${d}`));
  const notes = [...(project.drawing?.notes ?? []), ...(one?.notes ?? [])].filter((n) => n.trim()).map((n, i) => `${i + 1}. ${fillParams(n, project, extra)}`);
  if (notes.length) section('NOTES', notes, 'E-NOTES');
  if (details.length) section('TITLE BLOCK DETAILS', details.map((d) => `${d.label}: ${d.value}`), 'E-NOTES');
  const legend = one?.legendSvg ?? '';
  const side = !!(legend || flow.length);
  const pages: DxfPrimitive[][] = [];
  const base = () => [rect('E-FRAME', { x: 0, y: 0, w, h }), rect('E-FRAME', frame), ...title];
  const first = base(); pages.push(first);
  const colX = frame.x + frame.w - colW;
  let cursor = 0;
  const writeColumn = (out: DxfPrimitive[], x: number, top: number, bottom: number) => {
    let y = top;
    if (cursor && cursor < flow.length && !flow[cursor].heading) {
      out.push(...textInBox(flow[cursor].layer, { x: x + 2 * k, y: y - headingStep, w: contentW, h: headingStep }, `${flow[cursor].section} - continued`, headingCap));
      y -= headingStep;
    }
    while (cursor < flow.length) {
      const line = flow[cursor], height = line.heading ? headingStep : step;
      const blockHeight = (line.blockLines ?? 1) * step;
      const nextHeight = (flow[cursor + 1]?.blockLines ?? 1) * step;
      // Keep ordinary schedule rows together. Exceptionally long paragraphs
      // can continue across columns without losing any of their lines.
      const needed = line.heading ? height + (nextHeight <= top - bottom - height ? nextHeight : step)
        : line.blockLines && blockHeight <= top - bottom - headingStep ? blockHeight : height;
      if (y - needed < bottom - 1e-8) break;
      out.push(...textInBox(line.layer, { x: x + 2 * k, y: y - height, w: contentW, h: height }, line.text, line.heading ? headingCap : cap));
      y -= height; cursor++;
    }
  };
  if (side) {
    first.push({ type: 'line', layer: 'E-LEGEND', x1: colX, y1: bodyBottom, x2: colX, y2: bodyTop });
    let top = bodyTop;
    if (legend) {
      const r = placeSvg(legend, { x: colX + 2 * k, y: bodyBottom, w: contentW, h: flow.length ? bodyH * 0.3 : bodyH }, 'E-LEGEND', false);
      first.push(...r.items); top -= r.usedH + 3 * k;
    }
    writeColumn(first, colX, top, bodyBottom);
  }
  const hasContinuation = cursor < flow.length;
  const noticeH = hasContinuation ? Math.max(5, 4 * k) : 0;
  const drawing = placeSvg(svg, { x: frame.x + 3, y: bodyBottom + noticeH, w: frame.w - 6 - (side ? colW : 0), h: bodyH - noticeH });
  first.push(...drawing.items);
  if (drawing.items.some((p) => p.type === 'text' && p.text.trim() && p.height < 1.5)) warnings.push('Some diagram labels are smaller than 1.5 mm; use a larger paper size or split the drawing for readability.');
  if (hasContinuation) {
    const columns = Math.max(1, Math.floor((frame.w - 6) / colW));
    while (cursor < flow.length) {
      const page = base(), start = cursor;
      pages.push(page);
      for (let j = 0; j < columns && cursor < flow.length; j++) {
        const x = frame.x + 3 + j * colW;
        if (j) page.push({ type: 'line', layer: 'E-LEGEND', x1: x, y1: bodyBottom, x2: x, y2: bodyTop - noticeH });
        writeColumn(page, x, bodyTop - noticeH, bodyBottom);
      }
      if (cursor === start) throw new Error('The title block leaves too little space for notes and schedules. Choose a larger paper size.');
    }
    first.push(...textInBox('E-NOTES', { x: frame.x + 3, y: bodyBottom, w: frame.w - 6 - colW, h: noticeH }, `Additional information: ${pages.length - 1} continuation sheet${pages.length > 2 ? 's' : ''}`, Math.max(1.5, 1.9 * k)));
    pages.slice(1).forEach((page, i) => page.push(...textInBox('E-NOTES', { x: frame.x + 3, y: bodyTop - noticeH, w: frame.w - 6, h: noticeH }, `${t.number || 'SLD'} - CONTINUATION ${i + 1} OF ${pages.length - 1}`, headingCap)));
  }
  return { items: pages, warnings: [...new Set(warnings)] };
}

/** One portable DXF per paper sheet, suitable for ZIP export. */
export function buildSheetDxfPages(project: Project, svg: string, size: SheetSize, one?: SheetInfo): DxfSheetPage[] {
  const result = sheetPages(project, svg, size, one);
  return result.items.map((items, i) => ({ data: toDxf(items, SHEET_LAYERS), index: i + 1, count: result.items.length, continuation: i > 0, warnings: result.warnings }));
}

/** Compatibility API: a single DXF retains all continuation sheets arranged
 * side by side. User-facing exports use the individual paper sheets above. */
export function buildSheetDxf(project: Project, svg: string, size: SheetSize, one?: SheetInfo): string {
  const result = sheetPages(project, svg, size, one);
  return toDxf(result.items.flatMap((items, i) => items.map((p) => shift(p, i * (SHEET_MM[size].w + 20)))), SHEET_LAYERS);
}
