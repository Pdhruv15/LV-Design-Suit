import { describe, expect, it } from 'vitest';
import { contrastRatio, cssRgb, dashArray, hatchLines, patternLength, screenColour, tileOf } from './cadDraw';

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

describe('drawing colours on screen', () => {
  const light = cssRgb('#f5f6f8')!, dark = cssRgb('#0a1120')!; // the drawing surface in each theme
  const ratio = (c: string, bg: [number, number, number]) => contrastRatio(cssRgb(c)!, bg);

  it('reads the colour forms the stylesheet gives', () => {
    expect(cssRgb('#0a1120')).toEqual([10, 17, 32]);
    expect(cssRgb(' #fff ')).toEqual([255, 255, 255]);
    expect(cssRgb('rgb(245, 246, 248)')).toEqual([245, 246, 248]);
    expect(cssRgb('color-mix(in srgb, red, blue)')).toBeNull();
  });

  it('keeps colours that already stand out', () => {
    expect(screenColour(0xff0000, light)).toBe('#ff0000');
    expect(screenColour(0xffff00, dark)).toBe('#ffff00');
    expect(screenColour(0x0000ff, light)).toBe('#0000ff');
  });

  it('turns yellow gold on the light surface, the shade chosen on 2026-10-29', () => {
    expect(screenColour(0xffff00, light)).toBe('#b28600');
    expect(ratio('#b28600', light)).toBeGreaterThanOrEqual(3);
  });

  it('darkens cyan, green and light grey on light, keeping their hue', () => {
    for (const rgb of [0x00ffff, 0x00ff00, 0xc0c0c0]) {
      const c = screenColour(rgb, light), [r, g, b] = cssRgb(c)!;
      expect(ratio(c, light), c).toBeGreaterThanOrEqual(3);
      if (rgb === 0x00ffff) expect([r, g === b]).toEqual([0, true]);
      if (rgb === 0x00ff00) expect([r, b]).toEqual([0, 0]);
      if (rgb === 0xc0c0c0) expect(r === g && g === b).toBe(true);
    }
  });

  it('lightens blue and dark grey on dark, keeping their hue', () => {
    const blue = cssRgb(screenColour(0x0000ff, dark))!;
    expect(contrastRatio(blue, dark)).toBeGreaterThanOrEqual(3);
    expect(blue[0] === blue[1] && blue[2] === 255).toBe(true);
    expect(ratio(screenColour(0x333333, dark), dark)).toBeGreaterThanOrEqual(3);
    expect(ratio(screenColour(0x000000, dark), dark)).toBeGreaterThanOrEqual(3);
  });
});
