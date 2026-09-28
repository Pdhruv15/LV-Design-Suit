import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addFeeders, emptyTrayPlan, lookupOd, nextRouteName, panelCables, pickTray, sizeRoute, trayQuantities, DEFAULT_CABLE_ODS } from './cableTray';
import type { TrayPlan, TrayRoute } from '../types';

const route = (patch: Partial<TrayRoute> = {}): TrayRoute => ({
  id: 'r1', name: 'A', lengthM: 40,
  cables: [{ id: 'm1', from: 'MDB-1', to: 'SMDB-1', cores: 4, csaMm2: 240, qty: 3 }],
  ...patch
});
const plan = (patch: Partial<TrayPlan['settings']> = {}): TrayPlan => {
  const p = emptyTrayPlan();
  return { ...p, settings: { ...p.settings, ...patch } };
};

describe('cable tray sizing', () => {
  it('spacing method: diameters + 1 D clearances + 25 % spare → next standard width', () => {
    const r = sizeRoute(sampleProject, plan(), route());
    expect(r.sumOdMm).toBeCloseTo(188.7, 1); // 3 × 62.9
    expect(r.clearanceMm).toBeCloseTo(125.8, 1); // 2 gaps × 62.9
    expect(r.requiredMm).toBeCloseTo(314.5 * 1.25, 1);
    expect([r.widthMm, r.tiers, r.status]).toEqual([400, 1, 'ok']);
  });

  it('touching and fixed-mm spacing', () => {
    expect(sizeRoute(sampleProject, plan({ spacing: 'touching' }), route()).occupiedMm).toBeCloseTo(188.7, 1);
    expect(sizeRoute(sampleProject, plan({ spacing: 'mm', spacingMm: 20 }), route()).occupiedMm).toBeCloseTo(228.7, 1);
  });

  it('fill method: cable area against fill % × depth', () => {
    const r = sizeRoute(sampleProject, plan({ method: 'fill' }), route());
    const area = 3 * Math.PI * 62.9 ** 2 / 4;
    expect(r.occupiedMm).toBeCloseTo(area / (0.4 * 50), 1);
    expect(r.widthMm).toBe(600);
  });

  it('a route setting overrides the default', () => {
    expect(sizeRoute(sampleProject, plan(), route({ sparePct: 0 })).widthMm).toBe(400); // 314.5 → 400
    expect(sizeRoute(sampleProject, plan(), route({ spacing: 'touching', sparePct: 0 })).widthMm).toBe(200);
  });

  it('wider than the maximum → more tiers', () => {
    const r = sizeRoute(sampleProject, plan({ maxWidthMm: 300 }), route());
    expect([r.widthMm, r.tiers]).toEqual([200, 2]);
    expect(pickTray(1900, [100, 300, 600], 600)).toEqual({ widthMm: 600, tiers: 4 });
  });

  it('a chosen tray is checked: too small fails, less spare warns', () => {
    expect(sizeRoute(sampleProject, plan(), route({ widthMm: 300, tiers: 1 })).status).toBe('bad');
    const r = sizeRoute(sampleProject, plan({ sparePct: 40 }), route({ widthMm: 400, tiers: 1 }));
    expect(r.status).toBe('warn');
    expect(r.sparePctActual).toBeCloseTo((400 / 314.5 - 1) * 100, 1);
  });

  it('feeders from several panels: size and runs follow the design, ECC optional', () => {
    const boards = [...new Set(sampleProject.feeders.filter((f) => !f.phase).map((f) => f.boardId))].slice(0, 2);
    let r: TrayRoute = { id: 'r', name: 'B', cables: [] };
    for (const b of boards) r = addFeeders(r, panelCables(sampleProject, b).map((f) => f.id));
    const n = boards.reduce((a, b) => a + panelCables(sampleProject, b).length, 0);
    expect(r.cables).toHaveLength(n);
    expect(addFeeders(r, [r.cables[0].feederId!]).cables).toHaveLength(n); // no duplicates
    const res = sizeRoute(sampleProject, emptyTrayPlan(), r);
    expect(res.panels.sort()).toEqual([...boards].sort());
    const runs = boards.flatMap((b) => panelCables(sampleProject, b)).reduce((a, f) => a + (f.parallel ?? 1), 0);
    expect(res.cableCount).toBe(runs);
    const withEcc = sizeRoute(sampleProject, { ...emptyTrayPlan(), settings: { ...emptyTrayPlan().settings, includeEcc: true } }, r);
    expect(withEcc.cableCount).toBe(runs * 2);
  });

  it('a size missing from the cable data takes the next size up', () => {
    expect(lookupOd(DEFAULT_CABLE_ODS, 4, 240)).toMatchObject({ odMm: 62.9, found: true });
    expect(lookupOd(DEFAULT_CABLE_ODS, 4, 200)).toMatchObject({ odMm: 62.9, found: false });
  });

  it('quantities by tray size and route names A, B … Z, AA', () => {
    const p = plan();
    const a = sizeRoute(sampleProject, p, route());
    const b = sizeRoute(sampleProject, p, route({ id: 'r2', name: 'B', lengthM: 10, tiers: 2 }));
    expect(trayQuantities([a, b])).toEqual([{ size: '400 × 50', widthMm: 400, depthMm: 50, lengthM: 60, routes: ['A', 'B'] }]);
    expect(nextRouteName({ ...p, routes: [route(), route({ name: 'B' })] })).toBe('C');
    expect(nextRouteName({ ...p, routes: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((name) => route({ name })) })).toBe('AA');
  });
});
