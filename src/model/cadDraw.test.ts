import { describe, expect, it } from 'vitest';
import { dashArray, hatchLines, patternLength, tileOf } from './cadDraw';

describe('drawing linetypes and hatches', () => {
  it('turns a linetype pattern into a canvas dash array', () => {
    expect(dashArray([20, -10], 1)).toEqual([20, 10]); // DASHED
    expect(dashArray([12.7, -6.35, 0, -6.35], 0.5)).toEqual([12.7, 6.35, 0.5, 6.35]); // DASHDOT: the dot one pixel
    expect(dashArray([-5, 10], 1)).toEqual([0, 5, 10]); // starts with a gap
    expect(dashArray([], 1)).toEqual([]); // continuous
    expect(dashArray([10, 5], 1)).toEqual([]); // no gap: continuous
    expect(patternLength([20, 10])).toBe(30);
  });

  it('lays a family of hatch lines across a box at their spacing, or none when too close or too many', () => {
    const lines = hatchLines({ angle: 0, base: [0, 0], offset: [0, 2] }, [0, 0, 10, 10], 0.5);
    expect(lines.map((l) => l.a[1])).toEqual([0, 2, 4, 6, 8, 10]);
    expect(lines[0]).toEqual({ a: [0, 0], b: [10, 0], phase: 0 });
    const diag = hatchLines({ angle: Math.PI / 4, base: [0, 0], offset: [-2, 2] }, [0, 0, 10, 10], 0.5);
    expect(diag.length).toBe(5); // 2.83 apart across the square's 14.1 diagonal
    expect(hatchLines({ angle: 0, base: [0, 0], offset: [0, 0.1] }, [0, 0, 10, 10], 0.5)).toEqual([]); // closer than half a unit
    expect(hatchLines({ angle: 0, base: [0, 0], offset: [0, 1] }, [0, 0, 10, 10000], 0.5)).toEqual([]); // over 1500 lines
  });

  it('puts segments in tiles of the drawing', () => {
    expect(tileOf(0, 0, [0, 0, 160, 160])).toBe(0);
    expect(tileOf(159, 0, [0, 0, 160, 160])).toBe(15);
    expect(tileOf(15, 25, [0, 0, 160, 160])).toBe(2 * 16 + 1);
    expect(tileOf(-50, 999, [0, 0, 160, 160])).toBe(15 * 16); // outside: the nearest tile
  });
});
