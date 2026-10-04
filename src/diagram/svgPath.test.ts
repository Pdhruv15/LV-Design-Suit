import { describe, expect, it } from 'vitest';
import { pathPoints } from './svgPath';

type Point = [number, number];

function distanceToRun(p: Point, run: Point[]): number {
  let distance = Infinity;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1], b = run[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const fraction = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(p[0] - a[0] - fraction * dx, p[1] - a[1] - fraction * dy));
  }
  return distance;
}

describe('SVG path flattening for DXF', () => {
  it('keeps cable-gland bends instead of turning them into vertical ticks', () => {
    const runs = pathPoints('M95 43 q3 4 0 8 M105 43 q-3 4 0 8');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toContainEqual([96.5, 47]);
    expect(runs[1]).toContainEqual([103.5, 47]);
    expect(runs.map((run) => [run[0], run[run.length - 1]])).toEqual([[[95, 43], [95, 51]], [[105, 43], [105, 51]]]);
    for (let n = 0; n <= 100; n++) {
      const t = n / 100;
      expect(distanceToRun([95 + 6 * t * (1 - t), 43 + 8 * t], runs[0])).toBeLessThanOrEqual(0.2);
    }
  });

  it('handles repeated relative move pairs, lines and closed runs', () => {
    expect(pathPoints('m10 20 5 0 h5 v10 l-10 0 z M30 40 L35 45')).toEqual([
      [[10, 20], [15, 20], [20, 20], [20, 30], [10, 30], [10, 20]],
      [[30, 40], [35, 45]]
    ]);
    expect(pathPoints('M0 0L5 0Z l0 5')).toEqual([[[0, 0], [5, 0], [0, 0]], [[0, 0], [0, 5]]]);
  });

  it('accepts signed exponents and compact numeric separators', () => {
    expect(pathPoints('M+1e+2,-2E-1L.5-.5')).toEqual([[[100, -0.2], [0.5, -0.5]]]);
  });

  it('reflects quadratic controls only after Q/T and resets after lines', () => {
    const run = pathPoints('M0 0q5 10 10 0t10 0 L30 0t10 0')[0];
    expect(run).toContainEqual([5, 5]);
    expect(run).toContainEqual([15, -5]);
    expect(run[run.length - 1]).toEqual([40, 0]);
    expect(run.filter(([x]) => x >= 30).every(([, y]) => y === 0)).toBe(true);
  });

  it('preserves cubic curves and smooth reflected control tangents', () => {
    const run = pathPoints('M0 0C0 10 10 10 10 0s10-10 10 0')[0];
    expect(run).toContainEqual([5, 7.5]);
    expect(run).toContainEqual([15, -7.5]);
    expect(run[run.length - 1]).toEqual([20, 0]);
    for (let n = 0; n <= 100; n++) {
      const t = n / 100;
      expect(distanceToRun([30 * t * t - 20 * t ** 3, 30 * t * (1 - t)], run)).toBeLessThanOrEqual(0.2);
    }
    const reset = pathPoints('M0 0C0 10 10 10 10 0L20 0S30 0 40 0')[0];
    expect(reset.filter(([x]) => x >= 20).every(([, y]) => y === 0)).toBe(true);
  });

  it('preserves collinear Bézier overshoot', () => {
    const run = pathPoints('M0 0Q20 0 10 0')[0];
    expect(Math.max(...run.map(([x]) => x))).toBeGreaterThan(13);
    expect(run[run.length - 1]).toEqual([10, 0]);
  });

  it('renders socket semicircles within the error target, with either sweep direction', () => {
    const upper = pathPoints('M0 0a10 10 0 0 1 20 0')[0];
    const lower = pathPoints('M0 0A10 10 0 0 0 20 0')[0];
    expect(upper.length).toBeGreaterThan(2);
    expect(Math.min(...upper.map(([, y]) => y))).toBeLessThan(-9.8);
    expect(Math.max(...lower.map(([, y]) => y))).toBeGreaterThan(9.8);
    expect(upper[upper.length - 1]).toEqual([20, 0]);
    for (let n = 0; n <= 100; n++) {
      const theta = Math.PI + Math.PI * n / 100;
      expect(distanceToRun([10 + 10 * Math.cos(theta), 10 * Math.sin(theta)], upper)).toBeLessThanOrEqual(0.2);
    }
  });

  it('handles compact arc flags, radius correction, rotations and degenerate arcs', () => {
    expect(pathPoints('M0 0A10 10 0 0120 0')).toEqual(pathPoints('M0 0A10 10 0 0 1 20 0'));
    const corrected = pathPoints('M0 0A1 1 0 0 1 20 0')[0];
    expect(Math.min(...corrected.map(([, y]) => y))).toBeLessThan(-9.8);
    const rotated = pathPoints('M0 0A15 5 45 1 0 20 10')[0];
    expect(rotated.length).toBeGreaterThan(3);
    expect(rotated[rotated.length - 1]).toEqual([20, 10]);
    expect(rotated.flat().every(Number.isFinite)).toBe(true);
    expect(pathPoints('M0 0A0 5 0 0 0 10 10A5 5 0 1 0 10 10')).toEqual([[[0, 0], [10, 10]]]);
  });

  it('keeps the error target for a rotated ellipse and selects the large arc', () => {
    const c = Math.SQRT1_2;
    const run = pathPoints(`M${15 * c} ${15 * c}A15 5 45 0 1 ${-15 * c} ${-15 * c}`)[0];
    for (let n = 0; n <= 100; n++) {
      const angle = Math.PI * n / 100;
      const x = 15 * Math.cos(angle), y = 5 * Math.sin(angle);
      expect(distanceToRun([c * x - c * y, c * x + c * y], run)).toBeLessThanOrEqual(0.2);
    }
    const small = pathPoints('M10 0A10 10 0 0 1 0 10')[0];
    const large = pathPoints('M10 0A10 10 0 1 1 0 10')[0];
    expect(Math.max(...small.map(([x]) => x))).toBe(10);
    expect(Math.max(...large.map(([x]) => x))).toBeGreaterThan(19.8);
    expect(large[large.length - 1]).toEqual([0, 10]);
  });

  it('terminates safely on unsupported, incomplete and malformed input', () => {
    for (const tail of ['Q4', 'C1 2 3', 'A10 10 0 2 1 20 0', 'A10 10 0 0', 'X10 20', '?20', 'L1e999 0', 'z 4 5']) {
      const result = pathPoints(`M0 0L10 0 ${tail}`);
      expect(result[0]?.slice(0, 2)).toEqual([[0, 0], [10, 0]]);
      expect(result.flat(2).every(Number.isFinite)).toBe(true);
    }
    expect(pathPoints('L10 20')).toEqual([]);
    expect(pathPoints('M10')).toEqual([]);
    expect(pathPoints('')).toEqual([]);
  });

  it('bounds output for pathological curve coordinates', () => {
    const cubic = pathPoints('M0 0C0 1e20 1e20 -1e20 10 0')[0];
    const arc = pathPoints('M0 0A1e20 1e20 0 1 1 10 0')[0];
    expect(cubic.length).toBeLessThanOrEqual(2049);
    expect(arc.length).toBeLessThanOrEqual(2049);
    expect(cubic[cubic.length - 1]).toEqual([10, 0]);
    expect(arc[arc.length - 1]).toEqual([10, 0]);
    expect([...cubic, ...arc].flat().every(Number.isFinite)).toBe(true);
  });
});
