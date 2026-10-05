type Point = [number, number];

const TOLERANCE = 0.2;
const MAX_CURVE_SEGMENTS = 2048;
const MAX_CURVE_DEPTH = 16;
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const COMMAND = /^[MmLlHhVvQqTtCcSsAaZz]$/;

const midpoint = (a: Point, b: Point): Point => [a[0] / 2 + b[0] / 2, a[1] / 2 + b[1] / 2];

/** Distance to the complete segment also catches collinear curves that
 * overshoot their end points. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const ux = dx / length, uy = dy / length;
  const projection = Math.max(0, Math.min(length, (p[0] - a[0]) * ux + (p[1] - a[1]) * uy));
  return Math.hypot(p[0] - a[0] - projection * ux, p[1] - a[1] - projection * uy);
}

function flattenBezier(controls: Point[]): Point[] {
  const out: Point[] = [];
  const stack: { points: Point[]; depth: number }[] = [{ points: controls, depth: 0 }];
  while (stack.length) {
    const { points, depth } = stack.pop()!;
    const start = points[0], end = points[points.length - 1];
    const flat = points.slice(1, -1).every((p) => segmentDistance(p, start, end) <= TOLERANCE);
    // Reserve one end point for every pending branch. Extremely large curves
    // deliberately have bounded output rather than allocating unbounded DXF.
    if (flat || depth >= MAX_CURVE_DEPTH || out.length + stack.length + 1 >= MAX_CURVE_SEGMENTS) {
      out.push(end);
      continue;
    }
    let row = points;
    const left = [row[0]], right = [row[row.length - 1]];
    while (row.length > 1) {
      row = row.slice(0, -1).map((p, i) => midpoint(p, row[i + 1]));
      left.push(row[0]);
      right.unshift(row[row.length - 1]);
    }
    stack.push({ points: right, depth: depth + 1 }, { points: left, depth: depth + 1 });
  }
  return out;
}

/** SVG endpoint-form arc, converted to centre form and sampled with an
 * angular step whose chord error is at most TOLERANCE for the larger radius. */
function flattenArc(start: Point, end: Point, rxInput: number, ryInput: number, rotation: number, large: boolean, sweep: boolean): Point[] {
  if (start[0] === end[0] && start[1] === end[1]) return [];
  let rx = Math.abs(rxInput), ry = Math.abs(ryInput);
  if (!rx || !ry) return [end];
  const angle = (rotation % 360) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = start[0] / 2 - end[0] / 2, dy = start[1] / 2 - end[1] / 2;
  const x = cos * dx + sin * dy, y = -sin * dx + cos * dy;
  const scale = Math.hypot(x / rx, y / ry);
  if (scale > 1) { rx *= scale; ry *= scale; }
  // Normalised coordinates avoid squaring large drawing-unit radii.
  const nx = x / rx, ny = y / ry;
  const denominator = nx * nx + ny * ny;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (1 - denominator) / denominator));
  const cxLocal = factor * rx * ny, cyLocal = -factor * ry * nx;
  const cx = cos * cxLocal - sin * cyLocal + start[0] / 2 + end[0] / 2;
  const cy = sin * cxLocal + cos * cyLocal + start[1] / 2 + end[1] / 2;
  const ux = (x - cxLocal) / rx, uy = (y - cyLocal) / ry;
  const vx = (-x - cxLocal) / rx, vy = (-y - cyLocal) / ry;
  const first = Math.atan2(uy, ux);
  let delta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (![rx, ry, cx, cy, first, delta].every(Number.isFinite)) return [end];
  // asin is more accurate than acos(1 - tolerance/radius) for large radii.
  const step = 4 * Math.asin(Math.sqrt(Math.min(1, TOLERANCE / (2 * Math.max(rx, ry)))));
  const count = Math.max(1, Math.min(MAX_CURVE_SEGMENTS, Math.ceil(Math.abs(delta) / step)));
  const out: Point[] = [];
  for (let i = 1; i < count; i++) {
    const theta = first + delta * i / count;
    const ex = rx * Math.cos(theta), ey = ry * Math.sin(theta);
    const sample: Point = [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
    if (!sample.every(Number.isFinite)) return [end];
    out.push(sample);
  }
  out.push(end); // Keep the exact requested endpoint, without rounding drift.
  return out;
}

/** SVG paths as polygonal runs suitable for an R12 DXF. Curves use a 0.2
 * source-unit error target; pathological sizes are bounded to 2048 segments
 * per curve. Parsing stops safely at malformed or unsupported commands. */
export function pathPoints(d: string): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];
  let point: Point = [0, 0], start: Point = [0, 0];
  let command = '', previous = '';
  let quadratic: Point = [0, 0], cubic: Point = [0, 0];
  let index = 0, positioned = false;
  const skip = () => { while (index < d.length && /[\s,]/.test(d[index])) index++; };
  const number = (): number | undefined => {
    skip();
    NUMBER.lastIndex = index;
    const match = NUMBER.exec(d);
    if (!match) return undefined;
    index += match[0].length;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : undefined;
  };
  const flag = (): number | undefined => {
    skip();
    if (d[index] !== '0' && d[index] !== '1') return undefined;
    return Number(d[index++]);
  };
  const flush = () => { if (current.length > 1) runs.push(current); current = []; };
  const add = (points: Point[]) => {
    if (!current.length) current = [[...point]];
    current.push(...points);
  };
  while (true) {
    skip();
    if (index >= d.length) break;
    if (/[a-zA-Z]/.test(d[index])) {
      if (!COMMAND.test(d[index])) break;
      command = d[index++];
    } else if (!command) break;
    const lower = command.toLowerCase(), relative = command !== command.toUpperCase();
    if (lower === 'z') {
      if (!positioned) break;
      if (current.length && (point[0] !== start[0] || point[1] !== start[1])) current.push([...start]);
      point = [...start];
      flush();
      previous = lower;
      command = ''; // Trailing numbers after close-path must not loop.
      continue;
    }
    if (!positioned && lower !== 'm') break;
    const count = ({ m: 2, l: 2, h: 1, v: 1, q: 4, t: 2, c: 6, s: 4, a: 7 } as Record<string, number>)[lower];
    const values: number[] = [];
    for (let n = 0; n < count; n++) {
      const value = lower === 'a' && (n === 3 || n === 4) ? flag() : number();
      if (value === undefined) break;
      values.push(value);
    }
    if (values.length !== count) break;
    const absolute = (x: number, y: number): Point => relative ? [point[0] + x, point[1] + y] : [x, y];
    let end: Point;
    if (lower === 'h') end = [relative ? point[0] + values[0] : values[0], point[1]];
    else if (lower === 'v') end = [point[0], relative ? point[1] + values[0] : values[0]];
    else end = absolute(values[count - 2], values[count - 1]);
    if (!end.every(Number.isFinite)) break;
    if (lower === 'm') {
      flush();
      current = [[...end]];
      start = [...end];
      positioned = true;
      command = relative ? 'l' : 'L'; // Repeated move pairs are line-tos.
    } else if (lower === 'q' || lower === 't') {
      const control = lower === 'q' ? absolute(values[0], values[1])
        : previous === 'q' || previous === 't' ? [2 * point[0] - quadratic[0], 2 * point[1] - quadratic[1]] as Point : point;
      if (!control.every(Number.isFinite)) break;
      add(flattenBezier([point, control, end]));
      quadratic = control;
    } else if (lower === 'c' || lower === 's') {
      const first = lower === 'c' ? absolute(values[0], values[1])
        : previous === 'c' || previous === 's' ? [2 * point[0] - cubic[0], 2 * point[1] - cubic[1]] as Point : point;
      const second = absolute(values[count - 4], values[count - 3]);
      if (![...first, ...second].every(Number.isFinite)) break;
      add(flattenBezier([point, first, second, end]));
      cubic = second;
    } else if (lower === 'a') add(flattenArc(point, end, values[0], values[1], values[2], !!values[3], !!values[4]));
    else add([end]);
    point = end;
    previous = lower;
  }
  flush();
  return runs;
}
