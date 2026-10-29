import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { trayPlanOf } from '../calc/cableTray';
import { planDrawings, scheduleSummary, updateSchedules } from './cadPlanSchedules';
import type { Project, SketchItem } from '../types';

type Pt = [number, number];
const tray = (id: string, pts: Pt[], widthMm: number, route?: string): SketchItem => ({ id, kind: 'pline', layer: 'E-TRAY', pts, tray: { widthMm, ...(route ? { route } : {}) } });
const cable = (id: string, pts: Pt[], feederId: string): SketchItem => ({ id, kind: 'pline', layer: 'E-CABLE', pts, cable: { feederId } });
const feeder = sampleProject.feeders[0];
const base: Project = {
  ...sampleProject, trays: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First', kind: 'typical', heightM: 4 }] }], rooms: [] },
  cadPlans: [{ building: 'V', level: 'GF', file: 'GF.dxf', units: 4 }, { building: 'V', level: 'FF', file: 'FF.dxf', units: 4 }]
};

describe('Design CAD → schedules', () => {
  it('gives tray routes their length and fittings from the runs on every level, and feeders their length and trays', () => {
    const p: Project = { ...base, cadSketch: [
      { file: 'GF.dxf', items: [
        tray('S1', [[0, 0], [10000, 0], [10000, 5000]], 300, 'A'), // 15 m with a bend
        tray('S2', [[4000, 0], [4000, 3000]], 150, 'B'), // a branch: a tee on A
        tray('S3', [[0, 8000], [6000, 8000]], 300), // no route: not counted
        cable('S4', [[0, 0], [10000, 0], [10000, 2000]], feeder.id) // 12 m along tray A
      ] },
      { file: 'FF.dxf', items: [tray('S1', [[0, 0], [5000, 0]], 300, 'A')] } // 5 m more of A upstairs
    ] };
    const u = updateSchedules(p, planDrawings(p));
    const routes = trayPlanOf(u.project).routes;
    expect(routes.find((r) => r.name === 'A')).toMatchObject({ lengthM: 20, fittings: { bends: 1, tees: 1, reducers: 0 } });
    expect(routes.find((r) => r.name === 'B')).toMatchObject({ lengthM: 3, fittings: { bends: 0, tees: 0, reducers: 0 } });
    const f = u.project.feeders.find((x) => x.id === feeder.id)!;
    expect(f.lengthM).toBe(Math.ceil((12 + 6 + 3) * 1.05)); // route + vertical + terminations, +5 %
    expect(f.trayRoute).toBe('A');
    expect(scheduleSummary(u)).toBe('route A 20.0 m (1 bend, 1 tee) · route B 3.0 m · 1 cable length · 1 feeder on trays');
    expect(scheduleSummary(updateSchedules(u.project, planDrawings(u.project)))).toBe('route A 20.0 m (1 bend, 1 tee) · route B 3.0 m'); // nothing else to change
  });

  it('reads the open drawing in its own units, and says when nothing is drawn to take', () => {
    const p: Project = { ...base, cadPlans: undefined, cadSketch: [{ file: 'X.dxf', items: [tray('S1', [[0, 0], [12, 0]], 300, 'A')] }] };
    const [d] = planDrawings(p, { file: 'X.dxf', insunits: 6 });
    expect(d).toMatchObject({ file: 'X.dxf', mPerUnit: 1 });
    expect(trayPlanOf(updateSchedules(p, [d]).project).routes[0].lengthM).toBe(12);
    expect(scheduleSummary(updateSchedules(base, planDrawings(base)))).toMatch(/^nothing drawn to take/);
  });
});
