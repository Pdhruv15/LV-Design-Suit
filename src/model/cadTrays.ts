import { ensureRoutes, joinPath, newTrayId, routeNames, trayPlanOf } from '../calc/cableTray';
import { metresPerUnit } from './cadLengths';
import type { Project } from '../types';

type Pt = [number, number];
/** Tray runs and cable routes on a CAD floor plan, as paths in drawing units (from the built-in reader). */
export interface CadTrayPlan {
  units?: number; // INSUNITS
  trays: { name: string; points: Pt[]; length: number }[];
  routes: { feederId: string; points: Pt[] }[];
}

/** How close a cable route must run to a tray run to be on it (m), and how far along it (m) to count — more than a
 * square crossing reads (2 × the tolerance), so a cable that only crosses a tray is not put on it. */
export const TRAY_TOLERANCE_M = 0.5;
export const TRAY_MIN_RUN_M = 2;

export interface FeederTrayProposal { feederId: string; label: string; current: string; proposed: string; runs: { name: string; m: number }[] }
export interface TrayLengthProposal { name: string; currentM?: number; proposedM: number; isNew: boolean }
export interface CadTrayPull {
  feeders: FeederTrayProposal[];
  lengths: TrayLengthProposal[];
  matching: number; // feeders whose tray route already agrees
  unknownFeeders: string[];
  units: string;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const distToPath = (p: Pt, path: Pt[]) => { let d = Infinity; for (let i = 0; i + 1 < path.length; i += 1) d = Math.min(d, distToSegment(p, path[i], path[i + 1])); return d; };
const pathLength = (path: Pt[]) => path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);

/** The pieces of one cable route chained into a single path (greedy, nearest ends), starting at the end nearest
 * `from` when given (the source board's position), else at a free end. */
export function chain(pieces: Pt[][], from?: Pt): Pt[] {
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  if (!left.length) return [];
  const ends = left.flatMap((p, i) => [{ i, at: p[0], first: true }, { i, at: p[p.length - 1], first: false }]);
  const freeness = (e: typeof ends[number]) => Math.min(...ends.filter((o) => o.i !== e.i).map((o) => Math.hypot(o.at[0] - e.at[0], o.at[1] - e.at[1])), Infinity);
  const start = from
    ? ends.reduce((best, e) => (Math.hypot(e.at[0] - from[0], e.at[1] - from[1]) < Math.hypot(best.at[0] - from[0], best.at[1] - from[1]) ? e : best))
    : ends.reduce((best, e) => (freeness(e) > freeness(best) ? e : best));
  let path = start.first ? left[start.i] : [...left[start.i]].reverse();
  left.splice(start.i, 1);
  while (left.length) {
    const tail = path[path.length - 1];
    let best = 0, flip = false, d = Infinity;
    left.forEach((p, i) => {
      const a = Math.hypot(p[0][0] - tail[0], p[0][1] - tail[1]), b = Math.hypot(p[p.length - 1][0] - tail[0], p[p.length - 1][1] - tail[1]);
      if (a < d) { d = a; best = i; flip = false; }
      if (b < d) { d = b; best = i; flip = true; }
    });
    const next = flip ? [...left[best]].reverse() : left[best];
    path = [...path, ...next];
    left.splice(best, 1);
  }
  return path;
}

/** The trays a cable path runs along, in order, with how far it runs on each (drawing units). */
export function traysAlong(path: Pt[], trays: CadTrayPlan['trays'], tolerance: number, step: number): { name: string; along: number }[] {
  const order: string[] = [];
  const along = new Map<string, number>();
  for (let i = 0; i + 1 < path.length; i += 1) {
    const [a, b] = [path[i], path[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k += 1) {
      const t = (k + 0.5) / n;
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const near = trays.filter((tr) => distToPath(p, tr.points) <= tolerance).map((tr) => tr.name.toUpperCase());
      for (const name of new Set(near)) {
        if (!order.includes(name)) order.push(name);
        along.set(name, (along.get(name) ?? 0) + len / n);
      }
    }
  }
  return order.map((name) => ({ name, along: along.get(name)! }));
}

/** Proposed tray routes per feeder (from its linked cable route) and tray route lengths (from the linked tray runs). */
export function pullCadTrays(project: Project, plan: CadTrayPlan): CadTrayPull {
  const unit = metresPerUnit(plan.units, project.cadLength);
  const tolerance = TRAY_TOLERANCE_M / unit.factor, minRun = TRAY_MIN_RUN_M / unit.factor, step = tolerance / 2;
  const byFeeder = new Map<string, Pt[][]>();
  for (const r of plan.routes) byFeeder.set(r.feederId, [...(byFeeder.get(r.feederId) ?? []), r.points]);

  const feeders: FeederTrayProposal[] = [];
  const unknownFeeders: string[] = [];
  let matching = 0;
  for (const [id, pieces] of byFeeder) {
    const f = project.feeders.find((x) => x.id === id);
    if (!f) { unknownFeeders.push(id); continue; }
    const source = project.boards.find((b) => b.id === f.boardId)?.planPoint;
    const from: Pt | undefined = source ? [source.x / unit.factor, source.y / unit.factor] : undefined;
    const runs = traysAlong(chain(pieces, from), plan.trays, tolerance, step).filter((r) => r.along >= minRun);
    const proposed = joinPath(runs.map((r) => r.name));
    const current = joinPath(routeNames(f.trayRoute));
    if (proposed === current) { matching += 1; continue; }
    const label = f.feedsBoardId ? `${f.boardId} → ${f.feedsBoardId}` : `${f.boardId} ${f.phase && f.way ? `${f.phase}${f.way}` : f.name}`;
    feeders.push({ feederId: id, label, current, proposed, runs: runs.map((r) => ({ name: r.name, m: Math.round(r.along * unit.factor * 10) / 10 })) });
  }

  const trayPlan = trayPlanOf(project);
  const totals = new Map<string, number>();
  for (const t of plan.trays) totals.set(t.name.toUpperCase(), (totals.get(t.name.toUpperCase()) ?? 0) + (t.length || pathLength(t.points)));
  const lengths: TrayLengthProposal[] = [];
  for (const [name, total] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    const route = trayPlan.routes.find((r) => r.name.toUpperCase() === name);
    const proposedM = Math.round(total * unit.factor * 10) / 10;
    if (route?.lengthM === proposedM) continue;
    lengths.push({ name, currentM: route?.lengthM, proposedM, isNew: !route });
  }
  feeders.sort((a, b) => a.label.localeCompare(b.label));
  return { feeders, lengths, matching, unknownFeeders, units: unit.source };
}

/** Sets the accepted feeders' tray routes and tray route lengths; tray routes named for the first time are added
 * to the tray plan. */
export function applyCadTrays(project: Project, feeders: FeederTrayProposal[], lengths: TrayLengthProposal[]): Project {
  const paths = new Map(feeders.map((f) => [f.feederId, f.proposed]));
  let p: Project = { ...project, feeders: project.feeders.map((f) => (paths.has(f.id) ? { ...f, trayRoute: paths.get(f.id) || undefined } : f)) };
  p = ensureRoutes(p).project;
  if (lengths.length) {
    const plan = trayPlanOf(p);
    const missing = lengths.filter((l) => !plan.routes.some((r) => r.name.toUpperCase() === l.name));
    const routes = [...plan.routes, ...missing.map((l) => ({ id: newTrayId('r'), name: l.name, cables: [] }))];
    const byName = new Map(lengths.map((l) => [l.name, l.proposedM]));
    p = { ...p, trays: { ...(p.trays ?? plan), routes: routes.map((r) => (byName.has(r.name.toUpperCase()) ? { ...r, lengthM: byName.get(r.name.toUpperCase()) } : r)) } };
  }
  return p;
}
