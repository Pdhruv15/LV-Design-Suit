import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addSketch, arcThrough, dimensionLines, itemAt, moved, rectangle, removeSketch, rotated, shapesOut, sketchOf, snapPoints, trayEdges, trayLabel, trayLength, typedPoint, updateSketch } from './cadSketch';
import type { SketchItem } from '../types';

const p0 = { ...sampleProject, cadSketch: undefined };
const line: Omit<SketchItem, 'id'> = { kind: 'line', layer: 'LV-SKETCH', pts: [[0, 0], [4000, 0]] };

describe('drawing in the CAD view', () => {
  it('keeps what was drawn per drawing file, with permanent IDs', () => {
    const a = addSketch(p0, 'GF.dwg', line);
    const b = addSketch(a.project, 'gf.DWG', { kind: 'circle', layer: 'LV-SKETCH', pts: [[0, 0]], r: 500 });
    expect(sketchOf(b.project, 'GF.dwg').map((x) => x.id)).toEqual(['S1', 'S2']);
    expect(sketchOf(b.project, 'L1.dwg')).toEqual([]);
    const c = updateSketch(b.project, 'GF.dwg', moved(sketchOf(b.project, 'GF.dwg')[0], 100, 50));
    expect(sketchOf(c, 'GF.dwg')[0].pts).toEqual([[100, 50], [4100, 50]]);
    const d = removeSketch(removeSketch(c, 'GF.dwg', 'S1'), 'GF.dwg', 'S2');
    expect(d.cadSketch).toBeUndefined();
  });

  it('rotates lines, arcs and texts about a point', () => {
    const r = rotated({ ...line, id: 'S1' }, [0, 0], Math.PI / 2);
    expect(r.pts[1][0]).toBeCloseTo(0, 9);
    expect(r.pts[1][1]).toBeCloseTo(4000, 9);
    const t = rotated({ id: 'S2', kind: 'text', layer: 'x', pts: [[0, 0]], text: 'A', rot: 0 }, [0, 0], 1);
    expect(t.rot).toBe(1);
  });

  it('builds rectangles, arcs through three points and aligned dimensions', () => {
    expect(rectangle([0, 0], [3000, 2000])).toEqual([[0, 0], [3000, 0], [3000, 2000], [0, 2000]]);
    const a = arcThrough([1000, 0], [0, 1000], [-1000, 0])!;
    expect(a.r).toBeCloseTo(1000, 6);
    expect(a.a0).toBeCloseTo(0, 6);
    expect(a.a1).toBeCloseTo(Math.PI, 6);
    expect(arcThrough([0, 0], [1, 1], [2, 2])).toBeUndefined();
    const d = dimensionLines([0, 0], [4000, 0], [2000, 800]);
    expect(d.length).toBe(4000);
    expect(d.lines[2]).toEqual([[0, 800], [4000, 800]]); // the dimension line through the point picked
  });

  it('reads typed points: absolute, relative, polar and a plain distance along the cursor', () => {
    expect(typedPoint('1000,2000', undefined, null)).toEqual([1000, 2000]);
    expect(typedPoint('@500,0', [1000, 1000], null)).toEqual([1500, 1000]);
    const polar = typedPoint('@1000<90', [0, 0], null)!;
    expect(polar[0]).toBeCloseTo(0, 9);
    expect(polar[1]).toBeCloseTo(1000, 9);
    expect(typedPoint('2500', [0, 0], [10, 0])).toEqual([2500, 0]);
    expect(typedPoint('abc', [0, 0], [1, 0])).toBeUndefined();
  });

  it('finds what was drawn under a click, snaps to it, and writes it for the DXF', () => {
    const items: SketchItem[] = [{ ...line, id: 'S1' }, { id: 'S2', kind: 'dim', layer: 'LV-ANNO', pts: [[0, 0], [4000, 0], [2000, 800]], text: '4.00' }];
    expect(itemAt(items, [2000, 30], 50)?.id).toBe('S1');
    expect(itemAt(items, [2000, 780], 50)?.id).toBe('S2');
    expect(itemAt(items, [2000, 400], 50)).toBeUndefined();
    expect(snapPoints(items)).toContainEqual({ x: 2000, y: 0, kind: 2 });
    const out = shapesOut(items, 0.001);
    expect(out.filter((s) => s.layer === 'LV-ANNO' && s.kind === 'text')[0].text).toBe('4.00');
    expect(out.filter((s) => s.layer === 'LV-ANNO' && s.kind === 'line').length).toBe(5);
  });
});

describe('cable tray runs', () => {
  const run: SketchItem = { id: 'S1', kind: 'pline', layer: 'E-TRAY', pts: [[0, 0], [1000, 0], [1000, 1000]], tray: { widthMm: 300 } };
  const round = (e: [number, number][][]) => e.map((l) => l.map(([x, y]) => [Math.round(x), Math.round(y)]));

  it('draws both edges at the tray width, mitred at a bend, and closes the ends', () => {
    expect(round(trayEdges(run, 1))).toEqual([
      [[0, 150], [850, 150]], [[850, 150], [850, 1000]], // the inside edge
      [[0, -150], [1150, -150]], [[1150, -150], [1150, 1000]], // the outside edge
      [[0, 150], [0, -150]], [[850, 1000], [1150, 1000]] // the ends
    ]);
    expect(trayEdges({ ...run, tray: undefined }, 1)).toEqual([]);
    expect(trayLength(run)).toBe(2000);
  });

  it('labels a run "CT 300" with its route once assigned, never upside down', () => {
    expect(trayLabel(run)).toEqual({ at: [500, 0], text: 'CT 300', rot: 0 });
    const back = trayLabel({ ...run, pts: [[1000, 0], [0, 0]], tray: { widthMm: 450, route: 'A' } });
    expect(back.text).toBe('CT 450 · A');
    expect(back.rot).toBeCloseTo(0);
  });

  it('writes the edges, the centreline and the label into the DXF', () => {
    const out = shapesOut([run], 0.001);
    expect(out.map((o) => o.kind)).toEqual(['line', 'line', 'line', 'line', 'line', 'line', 'pline', 'text', 'text']);
    expect(out.every((o) => o.layer === 'E-TRAY')).toBe(true);
    expect(out[7]).toMatchObject({ text: 'CT 300', h: 150 });
    expect(out[8]).toMatchObject({ text: 'Bend 90° 300', h: 100 }); // its fitting
  });

  it('keeps the tray when moved, copied or rotated', () => {
    expect(moved(run, 10, 0).tray).toEqual({ widthMm: 300 });
    expect(rotated(run, [0, 0], Math.PI / 2).tray).toEqual({ widthMm: 300 });
  });
});

