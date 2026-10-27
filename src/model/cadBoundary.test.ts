import { describe, expect, it } from 'vitest';
import { polygonArea, roomBoundaryAt, type Seg } from './cadBoundary';

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Seg[] => {
  const p: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return p.map((a, i) => [a, p[(i + 1) % 4]] as Seg);
};
const opts = { gap: 1200, reach: 15000 }; // millimetres

describe('room outline from the walls around a point', () => {
  // Two rooms 4 × 3 m side by side; the wall between them has a 900 mm door.
  const single: Seg[] = [...rect(0, 0, 8000, 3000), [[4000, 0], [4000, 1000]], [[4000, 1900], [4000, 3000]]];

  it('finds a closed room and its area, closing a door opening', () => {
    const left = roomBoundaryAt(single, [2000, 1500], opts)!;
    expect(left.area / 1e6).toBeCloseTo(12, 0);
    expect(Math.abs(left.area / 1e6 - 12)).toBeLessThan(0.15);
    expect(polygonArea(left.points)).toBeGreaterThan(0);
    const right = roomBoundaryAt(single, [6000, 1500], opts)!;
    expect(Math.abs(right.area / 1e6 - 12)).toBeLessThan(0.15);
  });

  it('works with double-line walls whose jambs are closed', () => {
    // Outer ring 200 mm walls; middle wall 200 mm thick with a 900 mm door between two closed wall pieces.
    const segs: Seg[] = [...rect(-200, -200, 8400, 3400), ...rect(0, 0, 8000, 3000), ...rect(3900, 0, 200, 1000), ...rect(3900, 1900, 200, 1100)];
    const left = roomBoundaryAt(segs, [2000, 1500], opts)!;
    expect(Math.abs(left.area / 1e6 - 3.9 * 3)).toBeLessThan(0.15);
  });

  it('keeps wide openings open and finds nothing outside or on a wall', () => {
    const open: Seg[] = [...rect(0, 0, 8000, 3000).slice(0, 3), [[0, 3000], [0, 1500]]]; // 1.5 m gap in the left wall
    expect(roomBoundaryAt(open, [4000, 1500], opts)).toBeUndefined();
    expect(roomBoundaryAt(single, [20000, 20000], opts)).toBeUndefined();
    expect(roomBoundaryAt(single, [0, 1500], opts)).toBeUndefined();
  });

  it('handles an L-shaped room and simplifies its outline', () => {
    const l: Pt[] = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 5000], [0, 5000]];
    const segs = l.map((a, i) => [a, l[(i + 1) % l.length]] as Seg);
    const room = roomBoundaryAt(segs, [1000, 1000], opts)!;
    expect(Math.abs(room.area / 1e6 - 18)).toBeLessThan(0.2);
    expect(room.points.length).toBeLessThanOrEqual(10);
  });
});
