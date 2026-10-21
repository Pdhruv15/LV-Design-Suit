import { describe, expect, it } from 'vitest';
import { applyCadTrays, chain, pullCadTrays, traysAlong, type CadTrayPlan } from './cadTrays';
import { TRAY_DEFAULTS, trayPlanOf } from '../calc/cableTray';
import type { Project } from '../types';

type Pt = [number, number];
const cable = { demandFactor: 1, powerFactor: 0.9, cableCsaMm2: 35, cores: 4 as const, breakerRatingA: 100, breakerIcuKa: 36, loadKw: 10, lengthM: 40 };
function project(): Project {
  return {
    name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
    boards: [
      { id: 'SMDB-GF', name: 'S', sourceKva: 1000, sourceImpedancePct: 5, planPoint: { x: 21.6, y: 1.8 } },
      { id: 'DB-GF1', name: 'D', upstreamId: 'SMDB-GF' }
    ],
    feeders: [
      { ...cable, id: 'F1', boardId: 'SMDB-GF', name: 'Living', trayRoute: 'B' },
      { ...cable, id: 'F2', boardId: 'SMDB-GF', name: 'Kitchen', trayRoute: 'A' },
      { ...cable, id: 'F3', boardId: 'SMDB-GF', name: 'Store', trayRoute: 'A' }
    ],
    trays: { routes: [{ id: 'r-a', name: 'A', cables: [], lengthM: 7 }], settings: { ...TRAY_DEFAULTS } }
  };
}
// Tray A runs up x = 19 500 from y 1 800 to 9 000; tray B runs left along y = 9 000 to x = 13 000 (mm).
const trays: CadTrayPlan['trays'] = [
  { name: 'a', points: [[19500, 1800], [19500, 9000]], length: 7200 },
  { name: 'B', points: [[19500, 9000], [13000, 9000]], length: 6500 }
];

describe('tray routes from the CAD floor plan', () => {
  it('chains route pieces end to end, from the end nearest the source board', () => {
    const pieces: Pt[][] = [[[19500, 9000], [13000, 9000]], [[21600, 1800], [19500, 1800], [19500, 9000]]];
    expect(chain(pieces, [21600, 1800])).toEqual([[21600, 1800], [19500, 1800], [19500, 9000], [19500, 9000], [13000, 9000]]);
    // Without a source position the chain starts at a free end (here the drawn far end).
    expect(chain([[[13000, 9000], [19500, 9000]]])[0]).toEqual([13000, 9000]);
  });

  it('lists the trays a path runs along, in order, with how far', () => {
    const path: Pt[] = [[21600, 1800], [19500, 1800], [19500, 9000], [13000, 9000], [13000, 11500]];
    const runs = traysAlong(path, trays, 500, 250);
    expect(runs.map((r) => r.name)).toEqual(['A', 'B']);
    expect(runs[0].along).toBeGreaterThan(7000);
    expect(runs[1].along).toBeGreaterThan(6000);
  });

  it('proposes each feeder’s tray route and the tray lengths, ignoring a brief crossing', () => {
    const plan: CadTrayPlan = {
      units: 4,
      trays,
      routes: [
        // F1: two pieces, drawn in any order and direction → A then B (oriented from SMDB-GF).
        { feederId: 'F1', points: [[13000, 11500], [13000, 9000], [19500, 9000]] },
        { feederId: 'F1', points: [[19500, 9000], [19500, 1800], [21600, 1800]] },
        // F2: runs along A, then crosses tray B square on (≈1 m within reach) → "A" only (as designed).
        { feederId: 'F2', points: [[19500, 2000], [19500, 8000], [16000, 8000], [16000, 10500]] },
        // F3: off every tray → its tray route is cleared.
        { feederId: 'F3', points: [[0, 0], [5000, 0]] },
        { feederId: 'GONE', points: [[0, 0], [1, 1]] }
      ]
    };
    const pull = pullCadTrays(project(), plan);
    expect(pull.units).toBe('drawing in mm');
    expect(pull.unknownFeeders).toEqual(['GONE']);
    expect(pull.matching).toBe(1);
    expect(pull.feeders.map((f) => [f.feederId, f.current, f.proposed])).toEqual([['F1', 'B', 'A-B'], ['F3', 'A', '']]);
    expect(pull.lengths).toEqual([{ name: 'A', currentM: 7, proposedM: 7.2, isNew: false }, { name: 'B', currentM: undefined, proposedM: 6.5, isNew: true }]);
  });

  it('applies tray routes and lengths, adding tray routes named for the first time', () => {
    const p = project();
    const pull = pullCadTrays(p, { units: 4, trays, routes: [{ feederId: 'F1', points: [[21600, 1800], [19500, 1800], [19500, 9000], [13000, 9000]] }] });
    const next = applyCadTrays(p, pull.feeders, pull.lengths);
    expect(next.feeders.find((f) => f.id === 'F1')!.trayRoute).toBe('A-B');
    expect(trayPlanOf(next).routes.map((r) => [r.name, r.lengthM])).toEqual([['A', 7.2], ['B', 6.5]]);
    const cleared = applyCadTrays(p, [{ feederId: 'F3', label: '', current: 'A', proposed: '', runs: [] }], []);
    expect(cleared.feeders.find((f) => f.id === 'F3')!.trayRoute).toBeUndefined();
  });
});
