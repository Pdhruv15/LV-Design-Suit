import { describe, expect, it } from 'vitest';
import { fittingCounts, fittingLabel, trayFittings } from './cadTrayFittings';
import { shapesOut } from './cadSketch';
import type { SketchItem } from '../types';

type Pt = [number, number];
let n = 0;
const run = (pts: Pt[], widthMm = 300, route?: string): SketchItem => ({ id: `S${(n += 1)}`, kind: 'pline', layer: 'E-TRAY', pts, tray: { widthMm, ...(route ? { route } : {}) } });
const found = (items: SketchItem[]) => trayFittings(items, 1).fittings.map(fittingLabel); // drawing in mm

describe('cable tray fittings from the runs drawn', () => {
  it('finds a bend where a run turns, and where two runs meet at an angle', () => {
    expect(found([run([[0, 0], [3000, 0], [3000, 2000]])])).toEqual(['Bend 90° 300']);
    expect(found([run([[0, 0], [3000, 0]]), run([[3000, 0], [5000, 2000]])])).toEqual(['Bend 45° 300']);
    expect(found([run([[0, 0], [3000, 0], [6000, 100]])])).toEqual([]); // under 10°: straight
  });

  it('finds a reducer where runs of different widths meet in line; same width in line is a plain joint', () => {
    expect(found([run([[0, 0], [3000, 0]], 300), run([[3000, 0], [6000, 0]], 150)])).toEqual(['Reducer 300 → 150']);
    expect(found([run([[0, 0], [3000, 0]]), run([[3000, 0], [6000, 0]])])).toEqual([]);
  });

  it('finds a tee where a run branches off another, inside its width; a cross for branches on both sides', () => {
    const main = run([[0, 0], [6000, 0]], 300, 'A');
    const branch = run([[2000, 100], [2000, 3000]], 150, 'B'); // ends inside the main tray's 300 mm
    const r = trayFittings([main, branch], 1);
    expect(r.fittings.map(fittingLabel)).toEqual(['Tee 300 × 150']);
    expect(r.fittings[0]).toMatchObject({ routes: ['A', 'B'], runs: [branch.id, main.id] });
    expect(found([main, branch, run([[2000, 0], [2000, -2500]], 150)])).toEqual(['Cross 300 × 150 × 150']);
    expect(found([run([[0, 0], [3000, 0]]), run([[3000, 0], [6000, 0]]), run([[3000, 0], [3000, 2000]])])).toEqual(['Tee 300']); // three ends meet
  });

  it('counts fittings by kind and size, and writes them into the DXF as labels', () => {
    const items = [run([[0, 0], [3000, 0], [3000, 3000]]), run([[0, 5000], [3000, 5000], [3000, 8000]]), run([[3000, 3000], [3000, 4000]], 150)];
    expect(fittingCounts(trayFittings(items, 1).fittings)).toEqual([['Bend 90° 300', 2], ['Reducer 300 → 150', 1]]);
    const texts = shapesOut(items, 0.001).filter((s) => s.kind === 'text').map((s) => s.text);
    expect(texts).toEqual(expect.arrayContaining(['Bend 90° 300', 'Reducer 300 → 150']));
  });
});
