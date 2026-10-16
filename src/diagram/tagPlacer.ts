/** Cable tags that keep clear of the drawing: a leader from a dot on the cable to a boxed label,
 * placed where neither the box nor the leader touches any other line, text or symbol.
 *
 * The obstacles are read back from the drawing's own SVG (paths, lines, rects, circles, text), so
 * anything drawn before the tags are placed is avoided without each part reporting its geometry. */

export interface Box { x1: number; y1: number; x2: number; y2: number }
/** A tag to place on the vertical cable at x, anywhere between y0 and y1. */
export interface CableTag { x: number; y0: number; y1: number; text: string }

const num = (s: string | undefined) => Number(s ?? 0);
const attr = (el: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(el)?.[1];
const seg = (ax: number, ay: number, bx: number, by: number, pad: number): Box => ({ x1: Math.min(ax, bx) - pad, y1: Math.min(ay, by) - pad, x2: Math.max(ax, bx) + pad, y2: Math.max(ay, by) + pad });

/** Boxes around everything an SVG fragment draws (untransformed elements only). */
export function obstaclesFromSvg(svg: string): Box[] {
  const out: Box[] = [];
  for (const m of svg.matchAll(/<path\b[^>]*>/g)) {
    const d = attr(m[0], 'd');
    if (!d) continue;
    let cx = 0, cy = 0, sx = 0, sy = 0;
    for (const [, c, args] of d.matchAll(/([MLHVhvlaqZz])([^MLHVhvlaqZz]*)/g)) {
      const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      let nx = cx, ny = cy;
      if (c === 'M') { cx = sx = n[0]; cy = sy = n[1]; continue; }
      if (c === 'L') { nx = n[0]; ny = n[1]; } else if (c === 'l') { nx += n[0]; ny += n[1]; }
      else if (c === 'H') nx = n[0]; else if (c === 'h') nx += n[0];
      else if (c === 'V') ny = n[0]; else if (c === 'v') ny += n[0];
      else if (c === 'a') { nx += n[5]; ny += n[6]; out.push(seg(cx, cy - 6, nx, ny, 2)); }
      else if (c === 'q') { nx += n[2]; ny += n[3]; }
      else if (c === 'Z' || c === 'z') { nx = sx; ny = sy; }
      out.push(seg(cx, cy, nx, ny, 3));
      cx = nx; cy = ny;
    }
  }
  for (const m of svg.matchAll(/<line\b[^>]*>/g)) out.push(seg(num(attr(m[0], 'x1')), num(attr(m[0], 'y1')), num(attr(m[0], 'x2')), num(attr(m[0], 'y2')), 3));
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const x = num(attr(m[0], 'x')), y = num(attr(m[0], 'y')), w = num(attr(m[0], 'width')), h = num(attr(m[0], 'height'));
    // An outline (zones, pit chambers) blocks only its edges; a filled rect (bars, tags, boxes) all of it.
    if (attr(m[0], 'fill') === 'none') out.push(seg(x, y, x + w, y, 3), seg(x, y + h, x + w, y + h, 3), seg(x, y, x, y + h, 3), seg(x + w, y, x + w, y + h, 3));
    else out.push({ x1: x - 2, y1: y - 2, x2: x + w + 2, y2: y + h + 2 });
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
    const x = num(attr(m[0], 'cx')), y = num(attr(m[0], 'cy')), r = num(attr(m[0], 'r'));
    out.push({ x1: x - r - 2, y1: y - r - 2, x2: x + r + 2, y2: y + r + 2 });
  }
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const el = `<text${m[1]}>`, fs = num(attr(el, 'font-size') ?? '10') || 10, x = num(attr(el, 'x')), y = num(attr(el, 'y'));
    const len = m[2].replace(/&\w+;/g, '_').length, w = len * fs * 0.56;
    const a = attr(el, 'text-anchor'), x1 = a === 'middle' ? x - w / 2 : a === 'end' ? x - w : x;
    out.push({ x1: x1 - 2, y1: y - fs * 0.85 - 2, x2: x1 + w + 2, y2: y + fs * 0.25 + 2 });
  }
  return out;
}

const hit = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

export interface PlacedTag { dot: [number, number]; elbow: [number, number]; end: [number, number]; box: Box; text: string; /** false when no free spot was found (placed at the default) */ clear: boolean }

/** Places each tag clear of the obstacles and of the tags placed before it. Tries points along the
 * cable from its middle outward, the label up-right, up-left, down-right, down-left of each point
 * and, failing those, further out; the first free spot wins (the middle up-right if none is free). */
export function placeTags(tags: CableTag[], obstacles: Box[], fontSize = 8): PlacedTag[] {
  const taken: Box[] = [];
  const free = (b: Box) => !obstacles.some((o) => hit(b, o)) && !taken.some((o) => hit(b, o));
  return tags.map((t) => {
    const w = t.text.length * fontSize * 0.56 + 12, h = 15;
    const mid = (t.y0 + t.y1) / 2, span = Math.max(0, t.y1 - t.y0);
    const ys: number[] = [mid];
    for (let d = 8; d <= span / 2; d += 8) ys.push(mid - d, mid + d);
    const make = (ay: number, sx: number, sy: number, reach: number): PlacedTag => {
      const ex = t.x + sx * reach, ey = ay + sy * reach, bx = sx > 0 ? ex + 8 : ex - 8 - w;
      return { dot: [t.x, ay], elbow: [ex, ey], end: [sx > 0 ? bx : bx + w, ey], box: { x1: bx, y1: ey - h / 2, x2: bx + w, y2: ey + h / 2 }, text: t.text, clear: true };
    };
    /** How many things the box and the leader (sampled, clear of the dot itself) touch: 0 = free. */
    const clashes = (p: PlacedTag) => {
      const box = { x1: p.box.x1 - 3, y1: p.box.y1 - 3, x2: p.box.x2 + 3, y2: p.box.y2 + 3 };
      let n = obstacles.filter((o) => hit(box, o)).length + taken.filter((o) => hit(box, o)).length;
      const pts: [number, number][] = [];
      for (let i = 4; i <= 10; i++) pts.push([p.dot[0] + (p.elbow[0] - p.dot[0]) * i / 10, p.dot[1] + (p.elbow[1] - p.dot[1]) * i / 10]);
      for (let i = 1; i <= 6; i++) pts.push([p.elbow[0] + (p.end[0] - p.elbow[0]) * i / 6, p.elbow[1]]);
      for (const [x, y] of pts) if (!free({ x1: x - 1, y1: y - 1, x2: x + 1, y2: y + 1 })) n++;
      return n;
    };
    let best: PlacedTag | undefined, least: { p: PlacedTag; n: number } | undefined;
    for (const reach of [14, 30, 50]) {
      for (const ay of ys) {
        for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const) {
          const p = make(ay, sx, sy, reach), n = clashes(p);
          if (!n) { best = p; break; }
          if (!least || n < least.n) least = { p, n };
        }
        if (best) break;
      }
      if (best) break;
    }
    // No free spot: the one touching the fewest things.
    const p = best ?? { ...(least?.p ?? make(mid, 1, -1, 14)), clear: false };
    taken.push({ x1: p.box.x1 - 3, y1: p.box.y1 - 3, x2: p.box.x2 + 3, y2: p.box.y2 + 3 }, { x1: Math.min(p.dot[0], p.end[0]), y1: Math.min(p.dot[1], p.elbow[1]) - 2, x2: Math.max(p.dot[0], p.end[0]), y2: Math.max(p.dot[1], p.elbow[1]) + 2 });
    return p;
  });
}
