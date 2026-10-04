/** Minimal DXF (AutoCAD R12, ASCII) writer: lines, polylines, circles and
 * text on named layers. R12 opens in every CAD program (AutoCAD, BricsCAD,
 * DraftSight, LibreCAD, QCAD). Coordinates are in drawing units, y up. */

/** Width is a physical stroke width for lines/polylines, and an exact fitted
 * baseline length for text. All widths are in the same drawing units as x/y. */
export type DxfPrimitive =
  | { type: 'line'; layer: string; x1: number; y1: number; x2: number; y2: number; width?: number }
  | { type: 'polyline'; layer: string; points: [number, number][]; closed?: boolean; width?: number }
  | { type: 'circle'; layer: string; x: number; y: number; r: number }
  | { type: 'text'; layer: string; x: number; y: number; height: number; text: string; align?: 'left' | 'center' | 'right'; rotation?: number; width?: number };

/** Layer → AutoCAD colour index. */
export const DXF_LAYERS: Record<string, number> = {
  BUSBAR: 1, // red
  CABLE: 7, // white / black
  SYMBOL: 3, // green
  TEXT: 7,
  RESULT: 4, // cyan
  FRAME: 7,
  TITLE: 7
};

const n = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''));
/** DXF text can't hold newlines; R12 is not Unicode, so keep printable ASCII
 * and spell out the few symbols the diagram uses. */
export const dxfText = (s: string) =>
  s.replace(/²/g, '2').replace(/[×]/g, 'x').replace(/[·•]/g, '-').replace(/[–—−]/g, '-').replace(/±/g, '+/-').replace(/[″]/g, '"').replace(/Δ/g, 'd')
    .replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '');

const positiveWidth = (width?: number) => typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 0;
type DxfTextPrimitive = Extract<DxfPrimitive, { type: 'text' }>;

/** Fit is R12 TEXT justification 5. Its two baseline endpoints control the
 * rendered width independently of the CAD font, without changing text height.
 * Keep the original left/centre/right anchor when deriving those endpoints. */
function fittedBaseline(i: DxfTextPrimitive): { start: [number, number]; end: [number, number]; dx: number; dy: number } {
  const width = positiveWidth(i.width);
  const rotation = (i.rotation ?? 0) * Math.PI / 180;
  const dx = Math.cos(rotation), dy = Math.sin(rotation);
  const offset = width * (i.align === 'center' ? 0.5 : i.align === 'right' ? 1 : 0);
  const start: [number, number] = [i.x - dx * offset, i.y - dy * offset];
  return { start, end: [start[0] + dx * width, start[1] + dy * width], dx, dy };
}

function boundsPoints(i: DxfPrimitive): [number, number][] {
  if (i.type === 'line' || i.type === 'polyline') {
    const points: [number, number][] = i.type === 'line' ? [[i.x1, i.y1], [i.x2, i.y2]] : i.points;
    const halfWidth = positiveWidth(i.width) / 2;
    if (!halfWidth) return points;
    // Include segment widths, then the miter corners at polyline joins.
    const envelope = points.flatMap(([x, y]) => [[x - halfWidth, y - halfWidth], [x + halfWidth, y + halfWidth]] as [number, number][]);
    if (i.type === 'polyline') {
      const closed = !!i.closed;
      for (let j = closed ? 0 : 1; j < points.length - (closed ? 0 : 1); j++) {
        const [x, y] = points[j], prev = points[(j + points.length - 1) % points.length], next = points[(j + 1) % points.length];
        const a = Math.hypot(x - prev[0], y - prev[1]), b = Math.hypot(next[0] - x, next[1] - y);
        if (!a || !b) continue;
        const ax = (x - prev[0]) / a, ay = (y - prev[1]) / a, bx = (next[0] - x) / b, by = (next[1] - y) / b;
        const divisor = 1 + ax * bx + ay * by;
        if (divisor < 1e-9) continue; // a reversing segment has no finite miter
        const mx = -(ay + by) * halfWidth / divisor, my = (ax + bx) * halfWidth / divisor;
        envelope.push([x + mx, y + my], [x - mx, y - my]);
      }
    }
    return envelope;
  }
  if (i.type === 'text' && positiveWidth(i.width) && dxfText(i.text).trim()) {
    const { start, end, dx, dy } = fittedBaseline(i);
    // Include a descender allowance as well as the nominal cap height. The
    // exact glyph envelope is font-dependent; the fitted baseline is exact.
    return [start, end].flatMap(([x, y]) => [-i.height * 0.25, i.height].map((h): [number, number] => [x - dy * h, y + dx * h]));
  }
  // Preserve legacy extents for unmeasured text and circle centre points.
  return [[i.x, i.y]];
}

export function toDxf(items: DxfPrimitive[], layerColours: Record<string, number> = DXF_LAYERS): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === 'number' ? n(value) : value);
  const layers = [...new Set([...Object.keys(layerColours), ...items.map((i) => i.layer)])];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, hasPoints = false;
  // Accumulate per entity: large drawings must not pass every coordinate as
  // function arguments, or allocate drawing-wide point/x/y copies.
  for (const item of items) {
    for (const [x, y] of boundsPoints(item)) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      hasPoints = true;
    }
  }

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$FILLMODE'); g(70, 1);
  g(9, '$EXTMIN'); g(10, hasPoints ? minX : 0); g(20, hasPoints ? minY : 0); g(30, 0);
  g(9, '$EXTMAX'); g(10, hasPoints ? maxX : 0); g(20, hasPoints ? maxY : 0); g(30, 0);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const l of layers) { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, layerColours[l] ?? 7); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt.shx'); g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  const polyline = (layer: string, vertices: [number, number][], closed: boolean, width?: number) => {
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    const strokeWidth = positiveWidth(width);
    if (strokeWidth) { g(40, strokeWidth); g(41, strokeWidth); }
    for (const [x, y] of vertices) { g(0, 'VERTEX'); g(8, layer); g(10, x); g(20, y); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };

  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const i of items) {
    if (i.type === 'line') {
      if (positiveWidth(i.width)) polyline(i.layer, [[i.x1, i.y1], [i.x2, i.y2]], false, i.width);
      else { g(0, 'LINE'); g(8, i.layer); g(10, i.x1); g(20, i.y1); g(30, 0); g(11, i.x2); g(21, i.y2); g(31, 0); }
    } else if (i.type === 'circle') {
      g(0, 'CIRCLE'); g(8, i.layer); g(10, i.x); g(20, i.y); g(30, 0); g(40, i.r);
    } else if (i.type === 'polyline') {
      if (i.points.length < 2) continue;
      polyline(i.layer, i.points, !!i.closed, i.width);
    } else {
      const text = dxfText(i.text);
      if (!text.trim()) continue;
      const fit = positiveWidth(i.width) ? fittedBaseline(i) : undefined;
      g(0, 'TEXT'); g(8, i.layer); g(7, 'STANDARD'); g(10, fit?.start[0] ?? i.x); g(20, fit?.start[1] ?? i.y); g(30, 0); g(40, i.height); g(1, text);
      if (i.rotation) g(50, i.rotation);
      const h = i.align === 'center' ? 1 : i.align === 'right' ? 2 : 0;
      if (fit) { g(72, 5); g(73, 0); g(11, fit.end[0]); g(21, fit.end[1]); g(31, 0); }
      else if (h) { g(72, h); g(11, i.x); g(21, i.y); g(31, 0); }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/** Title block as DXF lines and text, bottom-right corner at (x, y), in
 * drawing units; rows of [label, value] cells. */
export function titleBlockDxf(x: number, y: number, width: number, rows: [string, string][][]): DxfPrimitive[] {
  const rowH = width / 12;
  const out: DxfPrimitive[] = [];
  const left = x - width;
  const top = y + rowH * rows.length;
  out.push({ type: 'polyline', layer: 'TITLE', closed: true, points: [[left, y], [x, y], [x, top], [left, top]] });
  rows.forEach((cells, i) => {
    const y0 = top - rowH * (i + 1);
    if (i > 0) out.push({ type: 'line', layer: 'TITLE', x1: left, y1: y0 + rowH, x2: x, y2: y0 + rowH });
    const cw = width / cells.length;
    cells.forEach(([k, v], j) => {
      const cx = left + cw * j;
      if (j > 0) out.push({ type: 'line', layer: 'TITLE', x1: cx, y1: y0, x2: cx, y2: y0 + rowH });
      const available = Math.max(0, cw - rowH * 0.24);
      const text = (value: string, height: number, baseline: number): DxfPrimitive => {
        // Manual title cells have no SVG/font measurement. Only constrain long
        // values: ordinary short labels keep their natural CAD text width.
        const estimate = dxfText(value).length * height * 0.8;
        return { type: 'text', layer: 'TITLE', x: cx + rowH * 0.12, y: y0 + rowH * baseline, height, text: value, ...(estimate > available && available > 0 ? { width: available } : {}) };
      };
      out.push(text(k.toUpperCase(), rowH * 0.18, 0.66));
      out.push(text(v, rowH * 0.3, 0.18));
    });
  });
  return out;
}
