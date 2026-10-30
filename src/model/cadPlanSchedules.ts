import { joinPath, routeNames, trayPlanOf } from '../calc/cableTray';
import { applyCadLengths, pullCadLengths } from './cadLengths';
import { plansOf } from './cadPlans';
import { applyWiringLengths } from './cadWiring';
import { trayLength } from './cadSketch';
import { applyCadTrays, pullCadTrays, type FeederTrayProposal, type TrayLengthProposal } from './cadTrays';
import { trayFittings } from './cadTrayFittings';
import { planScale } from './cadUnits';
import type { Project, SketchItem } from '../types';

type Pt = [number, number];

/** Design CAD → schedules: the cable tray runs and cable routes drawn on the plans of the project's levels give
 * - each tray route its length (all its runs on all levels) and fittings (bends, tees, reducers; a cross counts as a
 *   tee) for the tray BOQ;
 * - each feeder with a cable route its length (route + vertical + terminations + waste, as from the CAD floor plan);
 * - each such feeder the tray routes it runs along (only where it runs along a tray, on the same plan);
 * - each wired circuit without a cable route its wiring length (src/model/cadWiring.ts).
 * Only runs with a tray route assigned count. One undo step; what did not change is left as it is. */

export interface PlanDrawing { file: string; mPerUnit: number; items: SketchItem[] }

/** The drawings the schedules come from: each level's plan (in level order) and the drawing open, if it is not one. */
export function planDrawings(p: Project, open?: { file: string; insunits: number }): PlanDrawing[] {
  const files = plansOf(p).map((x) => x.file).filter((f): f is string => !!f);
  if (open && !files.some((f) => f.toLowerCase() === open.file.toLowerCase())) files.push(open.file);
  return files.map((file) => {
    const isOpen = open && open.file.toLowerCase() === file.toLowerCase();
    const insunits = isOpen ? open.insunits : p.cadPlans?.find((x) => x.file.toLowerCase() === file.toLowerCase())?.units;
    return { file, mPerUnit: planScale(p, file, insunits).factor, items: p.cadSketch?.find((s) => s.file.toLowerCase() === file.toLowerCase())?.items ?? [] };
  });
}

const metres = (pts: Pt[], k: number): Pt[] => pts.map(([x, y]) => [x * k, y * k]);
const pathM = (pts: Pt[]) => pts.slice(1).reduce((t, q, i) => t + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);

/** The tray route a fitting is counted on: the main run's for a tee or cross (listed last), else the first run's. */
function fittingRoute(runs: string[], kind: string, items: SketchItem[]): string | undefined {
  const route = (id: string) => items.find((it) => it.id === id)?.tray?.route;
  if ((kind === 'tee' || kind === 'cross') && route(runs[runs.length - 1])) return route(runs[runs.length - 1]);
  return runs.map(route).find((r): r is string => !!r);
}

export interface ScheduleUpdate {
  project: Project;
  trays: { name: string; lengthM: number; fittings: { bends: number; tees: number; reducers: number } }[];
  lengths: number; // feeders whose length changed
  feederTrays: number; // feeders whose tray routes changed
}

export function updateSchedules(p: Project, drawings: PlanDrawing[]): ScheduleUpdate {
  // Tray routes: length and fittings from the runs on every plan.
  const len = new Map<string, number>();
  const fit = new Map<string, { bends: number; tees: number; reducers: number }>();
  const add = (name: string, k: 'bends' | 'tees' | 'reducers') => { const f = fit.get(name) ?? { bends: 0, tees: 0, reducers: 0 }; f[k] += 1; fit.set(name, f); };
  for (const d of drawings) {
    for (const it of d.items) if (it.tray?.route) len.set(it.tray.route.toUpperCase(), (len.get(it.tray.route.toUpperCase()) ?? 0) + trayLength(it) * d.mPerUnit);
    for (const f of trayFittings(d.items, 0.001 / d.mPerUnit).fittings) {
      const route = fittingRoute(f.runs, f.kind, d.items)?.toUpperCase();
      if (route) add(route, f.kind === 'bend' ? 'bends' : f.kind === 'reducer' ? 'reducers' : 'tees');
    }
  }
  const plan = trayPlanOf(p);
  const lengthProposals: TrayLengthProposal[] = [...len].map(([name, m]) => {
    const route = plan.routes.find((r) => r.name.toUpperCase() === name);
    return { name, currentM: route?.lengthM, proposedM: Math.round(m * 10) / 10, isNew: !route };
  }).filter((l) => l.currentM !== l.proposedM);

  // Feeders: the tray routes each cable runs along, plan by plan, in level order.
  const along = new Map<string, string[]>();
  for (const d of drawings) {
    const trays = d.items.filter((it) => it.tray?.route).map((it) => ({ name: it.tray!.route!, points: metres(it.pts, d.mPerUnit), length: 0 }));
    const routes = d.items.filter((it) => it.cable).map((it) => ({ feederId: it.cable!.feederId, points: metres(it.pts, d.mPerUnit) }));
    if (!routes.length) continue;
    const pull = pullCadTrays(p, { units: 6, trays, routes });
    const names = new Map(pull.feeders.map((f) => [f.feederId, routeNames(f.proposed)]));
    for (const r of new Set(routes.map((x) => x.feederId))) {
      const f = p.feeders.find((x) => x.id === r);
      if (!f) continue;
      // Not proposed: the plan agrees with the feeder's tray routes as they are.
      const here = names.get(r) ?? routeNames(f.trayRoute);
      along.set(r, [...(along.get(r) ?? []), ...here.filter((n) => !(along.get(r) ?? []).includes(n))]);
    }
  }
  const feederProposals: FeederTrayProposal[] = [...along].flatMap(([id, names]) => {
    const f = p.feeders.find((x) => x.id === id)!;
    const proposed = joinPath(names), current = joinPath(routeNames(f.trayRoute));
    return proposed === current ? [] : [{ feederId: id, label: id, current, proposed, runs: [] }];
  });

  let next = applyCadTrays(p, feederProposals, lengthProposals);
  // Fittings on the routes that have runs drawn (routes with none drawn keep theirs).
  if (fit.size || len.size) {
    const tp = trayPlanOf(next);
    next = { ...next, trays: { ...(next.trays ?? tp), routes: tp.routes.map((r) => {
      const name = r.name.toUpperCase();
      if (!len.has(name)) return r;
      const f = fit.get(name) ?? { bends: 0, tees: 0, reducers: 0 };
      return { ...r, fittings: { ...(r.fittings ?? {}), bends: f.bends, tees: f.tees, reducers: f.reducers } };
    }) } };
  }

  // Feeder lengths from their cable routes on every plan (metres).
  const routeM = new Map<string, { m: number; pieces: number }>();
  for (const d of drawings) for (const it of d.items) if (it.cable) {
    const x = routeM.get(it.cable.feederId) ?? { m: 0, pieces: 0 };
    routeM.set(it.cable.feederId, { m: x.m + pathM(it.pts) * d.mPerUnit, pieces: x.pieces + 1 });
  }
  const pull = pullCadLengths(next, [...routeM].map(([feederId, r]) => ({ feederId, length: r.m, pieces: r.pieces })), 6);
  next = applyCadLengths(next, pull.proposals);
  const wired = applyWiringLengths(next, new Set(routeM.keys()));
  next = wired.project;

  const trays = [...len].sort(([a], [b]) => a.localeCompare(b)).map(([name, m]) => ({ name, lengthM: Math.round(m * 10) / 10, fittings: fit.get(name) ?? { bends: 0, tees: 0, reducers: 0 } }));
  return { project: next, trays, lengths: pull.proposals.length + wired.changed, feederTrays: feederProposals.length };
}

/** "Route A 24.6 m (2 bends, 1 tee) · 3 cable lengths · 2 feeders' tray routes". */
export function scheduleSummary(u: ScheduleUpdate): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const trays = u.trays.map((t) => {
    const f = [t.fittings.bends && n(t.fittings.bends, 'bend'), t.fittings.tees && n(t.fittings.tees, 'tee'), t.fittings.reducers && n(t.fittings.reducers, 'reducer')].filter(Boolean).join(', ');
    return `route ${t.name} ${t.lengthM.toFixed(1)} m${f ? ` (${f})` : ''}`;
  });
  const parts = [...trays, u.lengths && n(u.lengths, 'cable length'), u.feederTrays && `${n(u.feederTrays, 'feeder')} on trays`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing drawn to take: assign tray routes to the tray runs, and draw cable routes';
}
