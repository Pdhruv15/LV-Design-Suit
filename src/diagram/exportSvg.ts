import type { DxfPrimitive } from '../docs/dxf';
import { pathPoints } from './svgPath';
import { dashedRuns } from './svgDash';
export { pathPoints } from './svgPath';

/** The SLD for printing and CAD: the live diagram copied with its computed
 * styles written in, dark-theme colours turned into black-on-white (status
 * and heat colours kept), and interactive-only parts removed. */

const STYLE_PROPS = ['stroke', 'stroke-width', 'stroke-dasharray', 'fill', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'display', 'writing-mode'];
const DROP = '.bus-hit, .sel-ring, title, .grid-bg';

/** Theme colour (rgb string) → print colour. */
function printPalette(): Map<string, string> {
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const rgb = (cssVar: string) => {
    probe.style.color = `var(${cssVar})`;
    return getComputedStyle(probe).color;
  };
  const map = new Map<string, string>([
    [rgb('--tx'), '#000000'], [rgb('--mut'), '#444444'], [rgb('--line'), '#000000'], [rgb('--bus'), '#000000'],
    [rgb('--acc'), '#000000'], [rgb('--p2'), '#ffffff'], [rgb('--panel'), '#ffffff'], [rgb('--bg'), '#ffffff'],
    [rgb('--ok'), '#13803d'], [rgb('--warn'), '#a86500'], [rgb('--bad'), '#c21f32']
  ]);
  probe.remove();
  return map;
}

export function printableSvg(live: SVGSVGElement, width: number, height: number): string {
  const palette = printPalette();
  const clone = live.cloneNode(true) as SVGSVGElement;
  const src = [live, ...live.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const out = dst[i] as SVGElement;
    const cs = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => {
      let v = cs.getPropertyValue(p);
      if (!v) return '';
      if (p === 'stroke' || p === 'fill') v = palette.get(v) ?? v;
      if (p === 'font-family') v = 'Arial, Helvetica, sans-serif';
      return `${p}:${v}`;
    }).filter(Boolean).join(';');
    out.setAttribute('style', style);
    // CAD uses a different font. Store the live text's length before this
    // clone is detached so TEXT Fit can preserve its horizontal footprint.
    if (el instanceof SVGTextElement) {
      const length = el.getComputedTextLength();
      if (Number.isFinite(length) && length > 0) out.setAttribute('data-dxf-width', String(length));
    }
  });
  clone.querySelectorAll(DROP).forEach((e) => e.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.style.background = '#ffffff';
  return new XMLSerializer().serializeToString(clone);
}

// ---- SVG → DXF ----

type M = [number, number, number, number, number, number]; // a b c d e f
const IDENT: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** translate / rotate / scale, as the diagram uses them. */
export function parseTransform(t: string | null): M {
  let m = IDENT;
  for (const [, fn, args] of (t ?? '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
    else if (fn === 'scale') m = mul(m, [a[0], 0, 0, a[1] ?? a[0], 0, 0]);
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      m = mul(mul(mul(m, [1, 0, 0, 1, cx, cy]), [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return m;
}

const layerOf = (el: Element): string => {
  if (el.getAttribute('data-dxf-layer') === 'BUSBAR') return 'BUSBAR';
  const parent = el.parentNode?.nodeType === 1 ? el.parentNode as Element : undefined;
  const cls = `${el.getAttribute('class') ?? ''} ${parent?.getAttribute('class') ?? ''}`;
  if (el.tagName === 'text') return /\bres\b/.test(cls) ? 'RESULT' : 'TEXT';
  if (/\bbus\b/.test(el.getAttribute('class') ?? '') || /\briser-bus\b/.test(cls)) return 'BUSBAR';
  if (/\bln\b/.test(el.getAttribute('class') ?? '')) return 'CABLE';
  return 'SYMBOL';
};

/** DXF entities from printable SVG markup, y flipped so the drawing is
 * upright in CAD (SVG y grows downward). */
export function svgToDxf(svgMarkup: string, height: number): DxfPrimitive[] {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const out: DxfPrimitive[] = [];
  const flip = ([x, y]: [number, number]): [number, number] => [x, height - y];
  const walk = (el: Element, m: M, inheritedSize = 11, inheritedDash = '') => {
    const style = el.getAttribute('style') ?? '';
    if (/display:\s*none/.test(style) || /opacity:\s*0(?![.\d])/.test(style)) return;
    // Generated SVGs such as the earthing drawing use presentation attributes
    // and inherited sizes; live diagram exports write the computed inline style.
    const declaredSize = Number(style.match(/font-size:\s*([\d.]+)/)?.[1] ?? el.getAttribute('font-size'));
    const size = Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : inheritedSize;
    const dash = style.match(/(?:^|;)\s*stroke-dasharray:\s*([^;]+)/)?.[1] ?? (el.hasAttribute('stroke-dasharray') ? el.getAttribute('stroke-dasharray')! : inheritedDash);
    const mm = mul(m, parseTransform(el.getAttribute('transform')));
    const num = (a: string) => Number(el.getAttribute(a) ?? 0);
    const layer = layerOf(el);
    const scale = Math.hypot(mm[0], mm[1]) || 1;
    const pattern = dash.trim().split(/[\s,]+/).filter(Boolean).map((v) => /^(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(v) ? parseFloat(v) : NaN);
    const dashed = pattern.length > 0 && pattern.every((v) => Number.isFinite(v) && v >= 0) && pattern.some((v) => v > 0);
    const push = (p: DxfPrimitive) => {
      if (!dashed || (p.type !== 'line' && p.type !== 'polyline')) { out.push(p); return; }
      const points: [number, number][] = p.type === 'line' ? [[p.x1, p.y1], [p.x2, p.y2]] : p.points;
      const closed = p.type === 'polyline' && p.closed;
      // Dash in SVG user space, then transform each endpoint. Using only an
      // x-axis scale would distort spacing on vertically stretched paths.
      const determinant = mm[0] * mm[3] - mm[1] * mm[2];
      const invertible = Math.abs(determinant) > 1e-12;
      const source = invertible ? points.map(([x, y]): [number, number] => {
        const dx = x - mm[4], dy = height - y - mm[5];
        return [(mm[3] * dx - mm[2] * dy) / determinant, (-mm[1] * dx + mm[0] * dy) / determinant];
      }) : points;
      for (const run of dashedRuns(closed && source.length ? [...source, source[0]] : source, invertible ? pattern : pattern.map((v) => v * scale))) {
        out.push({ type: 'polyline', layer: p.layer, points: invertible ? run.map(([x, y]) => flip(apply(mm, x, y))) : run, ...(p.width ? { width: p.width } : {}) });
      }
    };
    // Only busbars need a filled CAD width. Ordinary lines retain thin,
    // editable centrelines rather than turning every symbol into a ribbon.
    const strokeWidth = Number(style.match(/(?:^|;)\s*stroke-width:\s*([\d.]+)/)?.[1] ?? el.getAttribute('stroke-width') ?? 4);
    const width = layer === 'BUSBAR' && strokeWidth > 0 ? strokeWidth * scale : undefined;
    const noStroke = /stroke:\s*none/.test(style) || /stroke:\s*rgba\(0, 0, 0, 0\)/.test(style);
    switch (el.tagName) {
      case 'line': {
        if (noStroke) break;
        const [x1, y1] = flip(apply(mm, num('x1'), num('y1')));
        const [x2, y2] = flip(apply(mm, num('x2'), num('y2')));
        push({ type: 'line', layer, x1, y1, x2, y2, ...(width ? { width } : {}) });
        break;
      }
      case 'rect': {
        if (noStroke) break;
        const [x, y, w, h] = [num('x'), num('y'), num('width'), num('height')];
        push({ type: 'polyline', layer, closed: true, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => flip(apply(mm, a, b))), ...(width ? { width } : {}) });
        break;
      }
      case 'ellipse': {
        if (noStroke) break;
        const [cx, cy, rx, ry] = [num('cx'), num('cy'), num('rx'), num('ry')];
        if (rx <= 0 || ry <= 0) break;
        // R12 has no ELLIPSE entity; use a closed polyline for the RCD symbol.
        const count = Math.min(512, Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 0.2 / Math.max(rx, ry))))));
        const points = Array.from({ length: count }, (_, i) => {
          const a = 2 * Math.PI * i / count;
          return flip(apply(mm, cx + rx * Math.cos(a), cy + ry * Math.sin(a)));
        });
        push({ type: 'polyline', layer, closed: true, points });
        break;
      }
      case 'circle': {
        if (noStroke) break;
        const [x, y] = flip(apply(mm, num('cx'), num('cy')));
        if (dashed && num('r') > 0) {
          const count = Math.min(512, Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - 0.2 / num('r'))))));
          const points = Array.from({ length: count }, (_, j) => {
            const angle = 2 * Math.PI * j / count;
            return flip(apply(mm, num('cx') + num('r') * Math.cos(angle), num('cy') + num('r') * Math.sin(angle)));
          });
          push({ type: 'polyline', layer, points, closed: true });
        } else out.push({ type: 'circle', layer, x, y, r: num('r') * Math.hypot(mm[0], mm[1]) });
        break;
      }
      case 'polygon':
      case 'polyline': {
        if (noStroke && el.tagName === 'polyline') break;
        const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
        const run: [number, number][] = [];
        for (let i = 0; i + 1 < pts.length; i += 2) run.push(flip(apply(mm, pts[i], pts[i + 1])));
        if (run.length > 1) push({ type: 'polyline', layer, points: run, closed: el.tagName === 'polygon', ...(width ? { width } : {}) });
        break;
      }
      case 'path': {
        if (noStroke) break;
        for (const run of pathPoints(el.getAttribute('d') ?? '')) push({ type: 'polyline', layer, points: run.map(([a, b]) => flip(apply(mm, a, b))), ...(width ? { width } : {}) });
        break;
      }
      case 'text': {
        const text = el.textContent ?? '';
        const anchor = style.match(/text-anchor:\s*(\w+)/)?.[1] ?? el.getAttribute('text-anchor');
        // Export-only clearance moves DEWA cable text below the glands;
        // neither printable SVG/PDF nor the interactive canvas is changed.
        const [x, y] = flip(apply(mm, num('x') + num('data-dxf-dx'), num('y') + num('data-dxf-dy')));
        const measured = num('data-dxf-width');
        const limit = num('data-dxf-max-width');
        const textWidth = measured > 0 ? (limit > 0 ? Math.min(measured, limit) : measured) : limit;
        const rot = -Math.atan2(mm[1], mm[0]) * 180 / Math.PI; // SVG y is down, DXF y is up
        out.push({ type: 'text', layer, x, y, height: size * 0.72 * scale, text, align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left', ...(textWidth > 0 ? { width: textWidth * scale } : {}), ...(Math.abs(rot) > 0.5 ? { rotation: rot } : {}) });
        return; // tspans are part of the text
      }
    }
    for (const c of Array.from(el.childNodes)) if (c.nodeType === 1) walk(c as Element, mm, size, dash);
  };
  walk(doc.documentElement, IDENT);
  return out;
}
