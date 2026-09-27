import type { DxfPrimitive } from '../docs/dxf';

/** The SLD for printing and CAD: the live diagram copied with its computed
 * styles written in, dark-theme colours turned into black-on-white (status
 * and heat colours kept), and interactive-only parts removed. */

const STYLE_PROPS = ['stroke', 'stroke-width', 'stroke-dasharray', 'fill', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'display', 'writing-mode'];
const DROP = '.bus-hit, .sel-ring, title';

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

/** Straight-line path commands (M L H V Z; curves become straight to
 * their end point — the diagram's curves are tiny symbol details). */
export function pathPoints(d: string): [number, number][][] {
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  const take: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, q: 4, t: 2, c: 6, s: 4, a: 7, z: 0 };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const c = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (c === 'z') {
      cur.push([sx, sy]);
      x = sx; y = sy;
      runs.push(cur); cur = [];
      continue;
    }
    const k = take[c];
    if (k === undefined) break;
    const a = Array.from({ length: k }, num);
    if (a.some(Number.isNaN)) break;
    if (c === 'h') x = rel ? x + a[0] : a[0];
    else if (c === 'v') y = rel ? y + a[0] : a[0];
    else { x = rel ? x + a[k - 2] : a[k - 2]; y = rel ? y + a[k - 1] : a[k - 1]; }
    if (c === 'm') {
      if (cur.length > 1) runs.push(cur);
      cur = [[x, y]]; sx = x; sy = y;
      cmd = rel ? 'l' : 'L'; // further pairs are line-tos
    } else cur.push([x, y]);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

const layerOf = (el: Element): string => {
  const cls = `${el.getAttribute('class') ?? ''} ${el.parentElement?.getAttribute('class') ?? ''}`;
  if (el.tagName === 'text') return /\bres\b/.test(cls) ? 'RESULT' : 'TEXT';
  if (/\bbus\b/.test(el.getAttribute('class') ?? '')) return 'BUSBAR';
  if (/\bln\b/.test(el.getAttribute('class') ?? '')) return 'CABLE';
  return 'SYMBOL';
};

/** DXF entities from printable SVG markup, y flipped so the drawing is
 * upright in CAD (SVG y grows downward). */
export function svgToDxf(svgMarkup: string, height: number): DxfPrimitive[] {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const out: DxfPrimitive[] = [];
  const flip = ([x, y]: [number, number]): [number, number] => [x, height - y];
  const walk = (el: Element, m: M) => {
    const style = el.getAttribute('style') ?? '';
    if (/display:\s*none/.test(style) || /opacity:\s*0(?![.\d])/.test(style)) return;
    const mm = mul(m, parseTransform(el.getAttribute('transform')));
    const num = (a: string) => Number(el.getAttribute(a) ?? 0);
    const layer = layerOf(el);
    const noStroke = /stroke:\s*none/.test(style) || /stroke:\s*rgba\(0, 0, 0, 0\)/.test(style);
    switch (el.tagName) {
      case 'line': {
        if (noStroke) break;
        const [x1, y1] = flip(apply(mm, num('x1'), num('y1')));
        const [x2, y2] = flip(apply(mm, num('x2'), num('y2')));
        out.push({ type: 'line', layer, x1, y1, x2, y2 });
        break;
      }
      case 'rect': {
        if (noStroke) break;
        const [x, y, w, h] = [num('x'), num('y'), num('width'), num('height')];
        out.push({ type: 'polyline', layer, closed: true, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => flip(apply(mm, a, b))) });
        break;
      }
      case 'circle': {
        if (noStroke) break;
        const [x, y] = flip(apply(mm, num('cx'), num('cy')));
        out.push({ type: 'circle', layer, x, y, r: num('r') * Math.hypot(mm[0], mm[1]) });
        break;
      }
      case 'path': {
        if (noStroke) break;
        for (const run of pathPoints(el.getAttribute('d') ?? '')) out.push({ type: 'polyline', layer, points: run.map(([a, b]) => flip(apply(mm, a, b))) });
        break;
      }
      case 'text': {
        const text = el.textContent ?? '';
        const size = Number(style.match(/font-size:\s*([\d.]+)/)?.[1] ?? 11);
        const anchor = style.match(/text-anchor:\s*(\w+)/)?.[1];
        const [x, y] = flip(apply(mm, num('x'), num('y')));
        out.push({ type: 'text', layer, x, y, height: size * 0.72, text, align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left' });
        return; // tspans are part of the text
      }
    }
    for (const c of el.children) walk(c, mm);
  };
  walk(doc.documentElement, IDENT);
  return out;
}
