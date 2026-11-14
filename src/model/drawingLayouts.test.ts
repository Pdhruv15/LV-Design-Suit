import { describe, expect, it } from 'vitest';
import { arrangeDrawingViewports, asFileLayout, fitDrawingViewports, LAYOUT_PAPERS, paperName, viewportScaleN, withPaper, drawingLayoutsOf, fitScale, newDrawingLayout, nextLayoutName, withDrawingLayouts } from './drawingLayouts';
import { fileLayoutTitle, viewportScale } from './fileLayouts';
import { arrangementOf } from './planViewports';
import type { Project } from '../types';

describe('layouts made on a drawing', () => {
  it('are named LayoutN, the first free (case ignored)', () => {
    expect(nextLayoutName([])).toBe('Layout1');
    expect(nextLayoutName(['Layout1', 'A1 Lighting', 'layout2'])).toBe('Layout3');
  });

  it('fit the drawing at the largest standard scale', () => {
    // 30 m × 20 m in mm on a 400 × 277 mm frame needs 1:75.0 by width → 1:75.
    expect(fitScale([0, 0, 30000, 20000], 400, 277, 1)).toBe(75);
    // The same in metres (1000 mm per unit).
    expect(fitScale([0, 0, 30, 20], 400, 277, 1000)).toBe(75);
    expect(fitScale([0, 0, 0, 0], 400, 277, 1)).toBe(100); // empty drawing
    expect(fitScale([0, 0, 1e9, 1], 400, 277, 1)).toBe(2500000); // beyond the list: whole thousands
  });

  it('new: A3 landscape, one viewport inside a 10 mm margin, centred on the drawing, at that scale', () => {
    const l = newDrawingLayout('Layout2', [1000, 2000, 31000, 22000], 1);
    expect(l).toEqual({ name: 'Layout2', paper: [420, 297], viewports: [{ x: 10, y: 10, w: 400, h: 277, cx: 16000, cy: 12000, vh: 277 * 75 }] });
    const f = asFileLayout(l, 3);
    expect(viewportScale(f.viewports[0], f.mm_per_unit, 1)).toBe('1:75');
    expect(fileLayoutTitle(f, 1)).toBe('420 × 297 mm · 1 viewport at 1:75');
  });

  it('are kept by drawing file (case ignored); the last one gone takes the entry with it', () => {
    const p = {} as Project, l = newDrawingLayout('Layout2', [0, 0, 10, 10], 1);
    const q = withDrawingLayouts(p, 'GF.DWG', [l]);
    expect(q.cadLayouts).toEqual({ 'gf.dwg': [l] });
    expect(drawingLayoutsOf(q, 'gf.dwg')).toEqual([l]);
    expect(drawingLayoutsOf(q, undefined)).toEqual([]);
    expect('cadLayouts' in withDrawingLayouts(q, 'gf.dwg', [])).toBe(false);
  });
});

describe('layout tools on a drawing', () => {
  const ext: [number, number, number, number] = [1000, 2000, 31000, 22000];
  it('names papers in either orientation, or by size', () => {
    expect(LAYOUT_PAPERS.map((x) => x.id)).toEqual(['A4', 'A3', 'A2', 'A1', 'A0']);
    expect([paperName([420, 297]), paperName([594, 841]), paperName([297, 210]), paperName([500, 300])]).toEqual(['A3 landscape', 'A1 portrait', 'A4 landscape', '500 × 300 mm']);
  });
  it('a new paper keeps each viewport in proportion, its centre and its scale', () => {
    const l = { ...newDrawingLayout('Layout2', ext, 1), name: 'Layout2' };
    const q = withPaper(l, [841, 594]);
    expect(q.paper).toEqual([841, 594]);
    expect(viewportScaleN(q.viewports[0], 1)).toBe(viewportScaleN(l.viewports[0], 1));
    expect(q.viewports[0]).toMatchObject({ cx: l.viewports[0].cx, cy: l.viewports[0].cy });
    expect(q.viewports[0].x).toBeCloseTo(10 * 841 / 420, 0);
    const portrait = withPaper(l, [297, 420]);
    expect(viewportScaleN(portrait.viewports[0], 1)).toBe(75);
    expect(portrait.viewports[0].w).toBeLessThan(l.viewports[0].w);
  });
  it('arranges viewports inside the margin from the bottom, keeping existing scales', () => {
    const l = newDrawingLayout('Layout2', ext, 1);
    const q = arrangeDrawingViewports(l, arrangementOf('2V')!, ext, 1);
    expect(q.viewports).toHaveLength(2);
    expect(viewportScaleN(q.viewports[0], 1)).toBe(75);
    for (const v of q.viewports) { expect(v.x).toBeGreaterThanOrEqual(10); expect(v.y).toBeGreaterThanOrEqual(10 - 0.1); expect(v.x + v.w).toBeLessThanOrEqual(410.1); expect(v.y + v.h).toBeLessThanOrEqual(287.1); }
    expect(q.viewports[1].cx).toBe(16000);
    const four = arrangeDrawingViewports(l, arrangementOf('4')!, ext, 1);
    expect(four.viewports).toHaveLength(4);
    const upper = four.viewports[0], lower = four.viewports[2];
    expect(upper.y).toBeGreaterThan(lower.y); // the first frame is at the top: y runs up from the bottom
    const key = arrangeDrawingViewports(l, arrangementOf('KEY')!, ext, 1);
    expect(viewportScaleN(key.viewports[1], 1)).toBeGreaterThan(viewportScaleN(key.viewports[0], 1));
    expect(arrangeDrawingViewports(four, arrangementOf('1')!, ext, 1).viewports).toHaveLength(1);
  });
  it('fits every viewport to the whole drawing, centred', () => {
    const l = arrangeDrawingViewports(newDrawingLayout('Layout2', ext, 1), arrangementOf('2H')!, ext, 1);
    const f = fitDrawingViewports({ ...l, viewports: l.viewports.map((v) => ({ ...v, cx: 0, cy: 0, vh: 5 })) }, ext, 1);
    for (const v of f.viewports) {
      expect([v.cx, v.cy]).toEqual([16000, 12000]);
      const n = viewportScaleN(v, 1);
      expect(n * v.w).toBeGreaterThanOrEqual(30000 - 1); expect(n * v.h).toBeGreaterThanOrEqual(20000 - 1);
    }
  });
});
