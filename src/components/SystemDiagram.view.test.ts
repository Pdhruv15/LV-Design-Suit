import { describe, expect, it } from 'vitest';
import { openingView, READABLE_PX_PER_UNIT } from './SystemDiagram';

const scale = (v: { w: number; h: number }, boxW: number, boxH: number) => Math.min(boxW / v.w, boxH / v.h);

describe('SLD opening view', () => {
  it('shows the whole drawing when its text is readable fitted', () => {
    expect(openingView(600, 300, 900, 450)).toEqual({ x: 0, y: 0, w: 600, h: 300 });
  });

  it('opens a large drawing with text at its drawn size, from the top, centred on the main board', () => {
    // The sample project: 1656 × 1330 units in an 886 × 445 px canvas fits at 0.33 px per unit.
    const v = openingView(1656, 1330, 886, 445, 900);
    expect(scale(v, 886, 445)).toBeCloseTo(READABLE_PX_PER_UNIT);
    expect(v.y).toBe(0);
    expect(v.x + v.w / 2).toBeCloseTo(900);
  });

  it('fits the width when that is already readable, and keeps the view inside the drawing', () => {
    const wide = openingView(800, 3000, 1000, 500);
    expect(wide).toMatchObject({ x: 0, y: 0, w: 800 });
    expect(openingView(2000, 2000, 500, 500, 1950).x).toBe(1500);
    expect(openingView(2000, 2000, 500, 500, 10).x).toBe(0);
  });

  it('falls back to the whole drawing before the canvas has a size', () => {
    expect(openingView(1656, 1330, 0, 0)).toEqual({ x: 0, y: 0, w: 1656, h: 1330 });
  });
});
