import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import {
  addFeedersToRoute, deleteRoute, emptyTrayPlan, ensureRoutes, groupingFactor, lookupOd, nextRouteName, panelCables, pickTray, removeFeederFromRoute,
  renameRoute, routeNames, sizeRoute, trayGrouping, trayPlanOf, trayQuantities, unroutedFeeders, DEFAULT_CABLE_ODS
} from './cableTray';
import { evaluateFeeder } from './electrical';
import { runCalculations, staleStudies } from './runs';
import type { Project, TrayPlan, TrayRoute } from '../types';

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
    expect(r.sumOdMm).toBeCloseTo(189, 1); // 3 × 63.0 (DUCAB 4C × 240)
    expect(r.clearanceMm).toBeCloseTo(126, 1); // 2 gaps × 63.0
    expect(r.requiredMm).toBeCloseTo(315 * 1.25, 1);
    expect([r.widthMm, r.tiers, r.status]).toEqual([400, 1, 'ok']);
  });

  it('touching and fixed-mm spacing', () => {
    expect(sizeRoute(sampleProject, plan({ spacing: 'touching' }), route()).occupiedMm).toBeCloseTo(189, 1);
    expect(sizeRoute(sampleProject, plan({ spacing: 'mm', spacingMm: 20 }), route()).occupiedMm).toBeCloseTo(229, 1);
  });

  it('fill method: cable area against fill % × depth', () => {
    const r = sizeRoute(sampleProject, plan({ method: 'fill' }), route());
    const area = 3 * Math.PI * 63 ** 2 / 4;
    expect(r.occupiedMm).toBeCloseTo(area / (0.4 * 50), 1);
    expect(r.widthMm).toBe(600);
  });

  it('a route setting overrides the default', () => {
    expect(sizeRoute(sampleProject, plan(), route({ sparePct: 0 })).widthMm).toBe(400); // 315 → 400
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
    expect(r.sparePctActual).toBeCloseTo((400 / 315 - 1) * 100, 1);
  });

  it('feeders from several panels go on a route through their path; size and runs follow the design; ECC optional', () => {
    const boards = [...new Set(sampleProject.feeders.filter((f) => !f.phase).map((f) => f.boardId))].slice(0, 2);
    let p: Project = { ...sampleProject, trays: { ...emptyTrayPlan(), routes: [{ id: 'r', name: 'B', cables: [] }] } };
    for (const b of boards) p = addFeedersToRoute(p, 'B', panelCables(p, b).map((f) => f.id)).project;
    const ids = boards.flatMap((b) => panelCables(sampleProject, b).map((f) => f.id));
    expect(p.feeders.filter((f) => f.trayRoute === 'B').map((f) => f.id).sort()).toEqual([...ids].sort());
    expect(addFeedersToRoute(p, 'B', [ids[0]]).added).toBe(0); // no duplicates
    const route = trayPlanOf(p).routes[0];
    const res = sizeRoute(p, trayPlanOf(p), route);
    expect(res.panels.sort()).toEqual([...boards].sort());
    const runs = boards.flatMap((b) => panelCables(sampleProject, b)).reduce((a, f) => a + (f.parallel ?? 1), 0);
    expect(res.cableCount).toBe(runs);
    const withEcc = sizeRoute(p, { ...trayPlanOf(p), settings: { ...trayPlanOf(p).settings, includeEcc: true } }, route);
    expect(withEcc.cableCount).toBe(runs * 2);
    expect(withEcc.loadedPerTier).toBe(res.loadedPerTier); // ECCs don't count for grouping
  });

  it('a path puts a cable on every route along it; rename, remove and delete keep paths in step', () => {
    expect(routeNames('a-b, c > b')).toEqual(['A', 'B', 'C']);
    const f = sampleProject.feeders.find((x) => !x.phase)!;
    let p: Project = { ...sampleProject, feeders: sampleProject.feeders.map((x) => (x.id === f.id ? { ...x, trayRoute: 'A-B-C' } : x)) };
    const made = ensureRoutes(p);
    expect(made.created).toEqual(['A', 'B', 'C']);
    p = made.project;
    const plan = trayPlanOf(p);
    for (const r of plan.routes) expect(sizeRoute(p, plan, r).lines.map((l) => l.feederId)).toEqual([f.id]);
    const b = plan.routes.find((r) => r.name === 'B')!;
    p = renameRoute(p, b.id, 'riser');
    expect(p.feeders.find((x) => x.id === f.id)!.trayRoute).toBe('A-RISER-C');
    expect(renameRoute(p, b.id, 'A')).toBe(p); // name taken
    p = removeFeederFromRoute(p, trayPlanOf(p).routes[0].id, f.id);
    expect(p.feeders.find((x) => x.id === f.id)!.trayRoute).toBe('RISER-C');
    p = deleteRoute(p, trayPlanOf(p).routes.find((r) => r.name === 'C')!.id);
    expect(p.feeders.find((x) => x.id === f.id)!.trayRoute).toBe('RISER');
    expect(unroutedFeeders(p).some((x) => x.id === f.id)).toBe(false);
    expect(unroutedFeeders(sampleProject).length).toBe(sampleProject.feeders.filter((x) => !x.phase).length);
  });

  it('grouping factors: IEC 60364-5-52 B.52.20 on trays, B.52.17 bunched', () => {
    expect(groupingFactor('perforated', 'touching', 1, 1)).toBe(1);
    expect(groupingFactor('perforated', 'touching', 3, 1)).toBe(0.82);
    expect(groupingFactor('perforated', 'touching', 5, 1)).toBe(0.76); // between 4 and 6 → 6
    expect(groupingFactor('perforated', 'touching', 20, 2)).toBe(0.68); // beyond 9 → 9
    expect(groupingFactor('perforated', 'spaced', 4, 1)).toBe(0.95);
    expect(groupingFactor('ladder', 'spaced', 4, 1)).toBe(1);
    expect(groupingFactor('ladder', 'touching', 3, 5)).toBe(0.79); // > 3 tiers → 3
    expect(groupingFactor('perforated', 'bunched', 4, 1)).toBe(0.65);
    // Route: 3 cables, 1 D spacing → spaced; touching → 0.82.
    expect(sizeRoute(sampleProject, plan(), route()).groupFactor).toBe(0.98);
    expect(sizeRoute(sampleProject, plan({ spacing: 'touching' }), route()).groupFactor).toBe(0.82);
  });

  it('the tray grouping derates the cables on it — after a Run, the checks are out of date', () => {
    const ids = panelCables(sampleProject, 'MDB-1').map((f) => f.id);
    const base: Project = { ...sampleProject, trays: { ...emptyTrayPlan(), settings: { ...emptyTrayPlan().settings, spacing: 'touching' }, routes: [{ id: 'r', name: 'A', cables: [] }] } };
    const run = runCalculations(base);
    const p = addFeedersToRoute(base, 'A', ids).project;
    expect(staleStudies(run, p)).toEqual(['checks']);
    const g = trayGrouping(p);
    const n = ids.reduce((a, id) => a + (sampleProject.feeders.find((f) => f.id === id)!.parallel ?? 1), 0);
    const expected = groupingFactor('perforated', 'touching', Math.ceil(n / sizeRoute(p, trayPlanOf(p), trayPlanOf(p).routes[0]).tiers), sizeRoute(p, trayPlanOf(p), trayPlanOf(p).routes[0]).tiers);
    expect(g.get(ids[0])).toEqual({ factor: expected, route: 'A' });
    const f = p.feeders.find((x) => x.id === ids[0])!;
    const before = evaluateFeeder(sampleProject, sampleProject.feeders.find((x) => x.id === ids[0])!);
    const after = evaluateFeeder(p, f);
    expect(after.tray).toEqual({ factor: expected, route: 'A' });
    expect(after.ampacity).toBeLessThan(before.ampacity);
    const off = { ...p, trays: { ...trayPlanOf(p), settings: { ...trayPlanOf(p).settings, applyGrouping: false } } };
    expect(evaluateFeeder(off, f).ampacity).toBeCloseTo(before.ampacity, 6);
  });

  it('a size missing from the cable data takes the next size up', () => {
    expect(lookupOd(DEFAULT_CABLE_ODS, 4, 240)).toMatchObject({ odMm: 63, bendMm: 510, found: true });
    expect(lookupOd(DEFAULT_CABLE_ODS, 4, 200)).toMatchObject({ odMm: 63, found: false });
  });

  it('quantities by tray size and route names A, B … Z, AA', () => {
    const p = plan();
    const a = sizeRoute(sampleProject, p, route());
    const b = sizeRoute(sampleProject, p, route({ id: 'r2', name: 'B', lengthM: 10, tiers: 2 }));
    expect(trayQuantities([a, b])).toEqual([{ size: '400 × 50', widthMm: 400, depthMm: 50, lengthM: 60, bends: 0, tees: 0, reducers: 0, risers: 0, supports: 28 + 16, couplers: 13 + 6, coverM: 0, bendRadiusMm: 510, routes: ['A', 'B'] }]);
    const fit = sizeRoute(sampleProject, p, route({ fittings: { bends: 2, tees: 1 }, tiers: 2 }));
    const q = trayQuantities([fit], { covers: true, supportSpacingM: 2, lengthM: 2.5 })[0];
    expect([q.bends, q.tees, q.supports, q.couplers, q.coverM]).toEqual([4, 2, 42, 30, 80]);
    expect(nextRouteName({ ...p, routes: [route(), route({ name: 'B' })] })).toBe('C');
    expect(nextRouteName({ ...p, routes: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((name) => route({ name })) })).toBe('AA');
  });
});

describe('cable brands', () => {
  it('DUCAB is the default; the generic set can be chosen; an edited table wins', async () => {
    const { brandOf, GENERIC_ODS, DUCAB_ODS } = await import('../data/cableBrands');
    const { odsOf, BEND_FACTOR } = await import('./cableTray');
    expect(odsOf(emptyTrayPlan())).toBe(DUCAB_ODS);
    expect(odsOf({ ...emptyTrayPlan(), brand: 'generic' })).toBe(GENERIC_ODS);
    expect(brandOf('nope').id).toBe('ducab');
    // DUCAB rows as given: 630 is 1C only; 4C 400 has no bending radius → 8 × D.
    expect(DUCAB_ODS.filter((o) => o.csaMm2 === 630).map((o) => o.cores)).toEqual([1]);
    expect(lookupOd(DUCAB_ODS, 4, 400)).toMatchObject({ odMm: 75.5, bendMm: Math.round(75.5 * BEND_FACTOR), bendEstimated: true });
    expect(lookupOd(DUCAB_ODS, 3, 35)).toMatchObject({ odMm: 29.6, bendMm: 180, bendEstimated: false, kgPerM: 2 });
    expect(lookupOd(DUCAB_ODS, 2, 2.5)).toMatchObject({ odMm: 14.7, found: false }); // below DUCAB's smallest → 4 mm²
  });

  it('a route needs bends at least the largest cable bending radius', () => {
    const r = sizeRoute(sampleProject, plan(), route({ cables: [{ id: 'a', cores: 4, csaMm2: 240, qty: 1 }, { id: 'b', cores: 4, csaMm2: 95, qty: 2 }] }));
    expect([r.bendMm, r.bendEstimated]).toEqual([510, false]);
  });
});
