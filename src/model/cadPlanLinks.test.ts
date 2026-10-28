import { describe, expect, it } from 'vitest';
import type { CadDrawing } from './cadDrawing';
import { planFromDrawing } from './cadDrawing';
import { blockAt, curveAt, linkedDrawing, linkedPaths, linkedRoutes, linksFor, placeBoard, toggleCurve, withLinks, withPointPlaces } from './cadPlanLinks';
import { sampleProject } from '../data/sampleProject';

const d: CadDrawing = {
  format: 'DXF', units: 4,
  entities: [
    { k: 'line', l: 'E-CABLE', h: 'A1', a: [0, 0], b: [10000, 0] },
    { k: 'pline', l: 'E-CABLE', h: 'A2', v: [[10000, 0, 0], [10000, 5000, 0]], closed: false },
    { k: 'line', l: 'E-TRAY', h: 'B1', a: [0, 300], b: [10000, 300] },
    { k: 'insert', l: 'E-BOARD', h: 'C1', name: 'DB', at: [10000, 5000], attrs: {} }
  ]
};

describe('floor plan links', () => {
  it('links curves to a feeder or a tray, one at a time, and toggles them off', () => {
    let l = toggleCurve({ file: 'GF.dwg' }, 'routes', 'A1', 'F-03');
    l = toggleCurve(l, 'routes', 'A2', 'F-03');
    l = toggleCurve(l, 'trays', 'B1', 'A');
    expect(l.routes).toEqual({ A1: 'F-03', A2: 'F-03' });
    l = toggleCurve(l, 'trays', 'A2', 'B'); // a curve is on one route or one tray
    expect(l.routes).toEqual({ A1: 'F-03' });
    expect(l.trays).toEqual({ B1: 'A', A2: 'B' });
    expect(toggleCurve(l, 'trays', 'B1', 'A').trays).toEqual({ A2: 'B' });
  });

  it('writes the links as LVDS tags so routes are measured as before', () => {
    const l = { file: 'GF.dwg', routes: { A1: 'F-03', A2: 'F-03' }, trays: { B1: 'A' } };
    const plan = planFromDrawing(linkedDrawing(d, l));
    expect(linkedRoutes(plan)).toEqual([{ feederId: 'F-03', length: 15000, pieces: 2 }]);
    expect(plan.curves?.find((c) => c.tag === 'tray:A')?.length).toBe(10000);
    expect(linkedPaths(d, l).map((p) => `${p.kind}:${p.to}`)).toEqual(['route:F-03', 'route:F-03', 'tray:A']);
  });

  it('places boards at a block or a point; a block holds one board', () => {
    let l = placeBoard({ file: 'GF.dwg' }, 'DB-1', { handle: 'C1', x: 10000, y: 5000 });
    l = placeBoard(l, 'DB-2', { x: 2000, y: 2000 });
    const plan = withPointPlaces(planFromDrawing(linkedDrawing(d, l)), l);
    expect(plan.places).toEqual([{ boardId: 'DB-1', x: 10000, y: 5000 }, { boardId: 'DB-2', x: 2000, y: 2000 }]);
    l = placeBoard(l, 'DB-3', { handle: 'C1', x: 10000, y: 5000 });
    expect(Object.keys(l.places!)).toEqual(['DB-2', 'DB-3']);
    expect(placeBoard(l, 'DB-2').places).toEqual({ 'DB-3': l.places!['DB-3'] });
  });

  it('finds the curve or block nearest a click', () => {
    expect(curveAt(d, [5000, 120], 200)?.h).toBe('A1');
    expect(curveAt(d, [5000, 220], 200)?.h).toBe('B1');
    expect(curveAt(d, [5000, 150], 200, new Set(['e-tray']))?.h).toBe('B1');
    expect(curveAt(d, [5000, 2000], 200)).toBeUndefined();
    expect(blockAt(d, [9900, 5100], 200)?.h).toBe('C1');
  });

  it('keeps the links in the project per drawing file', () => {
    const p = withLinks(sampleProject, { file: 'GF.dwg', routes: { A1: 'F-03' } });
    expect(linksFor(p, 'gf.DWG').routes).toEqual({ A1: 'F-03' });
    expect(linksFor(p, 'L1.dwg')).toEqual({ file: 'L1.dwg' });
    expect(withLinks(p, { file: 'GF.dwg', routes: {} }).cadPlanLinks).toBeUndefined();
  });
});
