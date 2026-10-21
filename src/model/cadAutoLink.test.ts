import { describe, expect, it } from 'vitest';
import { autoRoutes, autoTrays } from './cadAutoLink';
import type { CadPlan } from './cadPlaces';
import type { CadLayerMap, Project } from '../types';

type Pt = [number, number];
const cable = { demandFactor: 1, powerFactor: 0.9, cableCsaMm2: 35, cores: 4 as const, breakerRatingA: 100, breakerIcuKa: 36, loadKw: 10, lengthM: 30 };
const project: Project = {
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [{ id: 'SMDB-GF', name: 'S', sourceKva: 1000, sourceImpedancePct: 5 }, { id: 'DB-GF1', name: 'D', upstreamId: 'SMDB-GF' }, { id: 'DB-X', name: 'X', upstreamId: 'SMDB-GF' }],
  feeders: [
    { ...cable, id: 'INC', boardId: 'SMDB-GF', name: 'To DB-GF1', feedsBoardId: 'DB-GF1' },
    { ...cable, id: 'R1', boardId: 'DB-GF1', name: 'Living lighting', phase: 'R', way: 1 },
    { ...cable, id: 'HAND', boardId: 'SMDB-GF', name: 'To DB-X', feedsBoardId: 'DB-X' }
  ]
};
const map: CadLayerMap[] = [{ layer: 'E-CABLE', role: 'route' }, { layer: 'E-TRAY', role: 'tray' }];
const curve = (layer: string, points: Pt[], tag?: string) => ({ layer, points, length: points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0), ...(tag ? { tag } : {}) });
const plan = (curves: ReturnType<typeof curve>[], extra: Partial<CadPlan> = {}): CadPlan => ({
  units: 4, places: [], outlines: [], texts: [],
  symbols: [{ name: 'SMDB-GF', x: 22000, y: 6000 }, { name: 'DB-GF1', x: 22000, y: 1500 }, { name: 'DB-X', x: 0, y: 0 }],
  fixtures: [{ x: 13000, y: 9750, cct: 'DB-GF1/R1' }, { x: 5000, y: 5000, cct: 'DB-GF1/Z9' }],
  curves, ...extra
});

describe('cable routes linked from the route layers', () => {
  it('links a route from board to board, joining its pieces drawn in any order', () => {
    const r = autoRoutes(project, plan([
      curve('E-CABLE', [[21000, 6000], [21000, 1500], [21600, 1500]]), // second piece first
      curve('E-CABLE', [[21600, 6000], [21000, 6000]])
    ]), map);
    expect(r.unmatched).toEqual([]);
    expect(r.routes.map((x) => [x.feederId, x.pieces.length, x.length])).toEqual([['INC', 1, 5700]]);
    // Joined into one path that starts at the feeder's own board (SMDB-GF, at 22 000, 6 000).
    expect(r.routes[0].pieces[0][0]).toEqual([21600, 6000]);
    expect(r.routes[0].pieces[0][r.routes[0].pieces[0].length - 1]).toEqual([21600, 1500]);
  });

  it('keeps cables that end side by side at the same board apart', () => {
    const r = autoRoutes(project, plan([
      curve('E-CABLE', [[21600, 6000], [21000, 6000], [21000, 1500], [21600, 1500]]), // SMDB-GF → DB-GF1
      curve('E-CABLE', [[21600, 1550], [19500, 1550], [19500, 9000], [13000, 9000], [13000, 9750]]) // DB-GF1 → light, 50 mm away
    ]), map);
    expect(r.unmatched).toEqual([]);
    expect(r.routes.map((x) => [x.feederId, Math.round(x.length)])).toEqual([['INC', 5700], ['R1', 16800]]);
  });

  it('links a route from a board to a fixture with a circuit attribute', () => {
    const r = autoRoutes(project, plan([curve('E-CABLE', [[21600, 1800], [19500, 1800], [19500, 9000], [13000, 9000], [13000, 9750]])]), map);
    expect(r.routes.map((x) => x.feederId)).toEqual(['R1']);
    expect(r.routes[0].pieces[0][0]).toEqual([21600, 1800]); // from DB-GF1, its board
  });

  it('lists routes it cannot link, and leaves feeders linked by hand alone', () => {
    const r = autoRoutes(project, plan([
      curve('E-CABLE', [[50000, 0], [60000, 0]]), // touches nothing
      curve('E-CABLE', [[21600, 1500], [21600, 1000], [5000, 5000]]), // DB-GF1 to a fixture on circuit Z9 (not on DB-GF1)
      curve('E-CABLE', [[21600, 6000], [21600, -2000]]), curve('E-CABLE', [[21600, -2000], [30000, -2000]]), curve('E-CABLE', [[21600, -2000], [21600, -8000]]), // branches
      curve('E-CABLE', [[300, 0], [21600, 6000]]), // DB-X to SMDB-GF: but HAND is linked by hand
      curve('E-CABLE', [[0, 0], [1, 1]], 'route:HAND'),
      curve('A-WALL', [[22000, 6000], [22000, 1500]]) // not a route layer
    ]), map);
    expect(r.routes).toEqual([]);
    expect(r.unmatched.map((u) => u.reason)).toEqual(['touches no board', 'fixture circuit DB-GF1/Z9 is not on DB-GF1', 'branches']);
  });
});

describe('tray runs named from the tray layers', () => {
  it('names runs from nearby labels, passes a name along joined runs, and numbers the rest', () => {
    const trays = autoTrays(project, plan([
      curve('E-TRAY', [[19650, 1500], [19650, 9150]]),
      curve('E-TRAY', [[19650, 9150], [12500, 9150]]),
      curve('E-TRAY', [[12500, 9150], [12500, 14000]]), // joined to B, unlabelled → B
      curve('E-TRAY', [[0, 20000], [9000, 20000]]), // alone, unlabelled → T1
      curve('E-TRAY', [[0, 30000], [9000, 30000]], 'tray:T1') // linked by hand: keeps T1, so the new one is T2
    ], {
      texts: [
        { layer: 'E-TRAY-TAG', x: 19900, y: 5000, text: 'TRAY A' },
        { layer: 'NOTES', x: 16000, y: 9500, text: 'Cable tray B' }, // a label in any case, on any layer
        { layer: 'E-TRAY', x: 12800, y: 12000, text: 'B' }, // a short name on a tray layer (the run up to 14 000)
        { layer: 'NOTES', x: 3000, y: 20300, text: 'B' }, // a short name on another layer is not a label
        { layer: 'NOTES', x: 30000, y: 30000, text: 'TRAY Z' } // too far from any run
      ]
    }), map);
    expect(trays.map((t) => [t.name, Math.round(t.length)])).toEqual([['A', 7650], ['B', 7150], ['B', 4850], ['T2', 9000]]);
  });
});
