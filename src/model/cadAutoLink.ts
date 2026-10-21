import { metresPerUnit } from './cadLengths';
import { findCircuit } from './cadLoads';
import { layersWith } from './cadRooms';
import type { CadPlan } from './cadPlaces';
import { chain } from './cadTrays';
import type { CadLayerMap, Project } from '../types';

type Pt = [number, number];
type Curve = NonNullable<CadPlan['curves']>[number];

/** How close (m) curve ends must be to join (drafting snaps), and a route end to a board or fixture to count as
 * touching it. Ends at a board never join: separate cables often end side by side at the same board. */
export const JOIN_M = 0.1;
/** Within this distance (m) of a board symbol a curve end is where a cable ends at the board, and is not joined. */
export const AT_BOARD_M = 0.6;
export const TOUCH_M = 1;
/** How close (m) a "TRAY A" label must be to a tray run to name it. */
export const LABEL_M = 1.5;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function distToPath(p: Pt, path: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const [a, b] = [path[i], path[i + 1]];
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    d = Math.min(d, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return d;
}

/** Curves that touch end to end (within `join`), as groups of curve indexes; ends where `stop` says so (at a board)
 * do not join. */
function connected(curves: Curve[], join: number, stop: (p: Pt) => boolean = () => false): number[][] {
  const parent = curves.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = (c: Curve) => [c.points[0], c.points[c.points.length - 1]];
  for (let i = 0; i < curves.length; i += 1) {
    for (let j = i + 1; j < curves.length; j += 1) {
      if (ends(curves[i]).some((a) => !stop(a) && ends(curves[j]).some((b) => !stop(b) && dist(a, b) <= join))) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  curves.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()];
}

/** The free ends of a group of joined curves: ends no other end in the group touches, and ends at a board. */
function freeEnds(group: Curve[], join: number, stop: (p: Pt) => boolean = () => false): Pt[] {
  const all = group.flatMap((c, i) => [{ i, at: c.points[0] }, { i, at: c.points[c.points.length - 1] }]);
  return all.filter((e, k) => stop(e.at) || !all.some((o, m) => m !== k && dist(o.at, e.at) <= join)).map((e) => e.at);
}

/** A linked route: its pieces joined into one path that starts at the feeder's own board. */
export interface AutoRoute { feederId: string; pieces: Pt[][]; length: number }
export interface UnmatchedRoute { layer: string; lengthM: number; reason: string; at: Pt }

/** Cable routes on route layers, joined end to end and linked to the feeder their ends touch: board to board (the
 * feeder between them) or board to a fixture with a circuit attribute (that circuit). Feeders linked by hand are
 * left to their hand links. Lengths and points are in drawing units. */
export function autoRoutes(project: Project, plan: CadPlan, map: CadLayerMap[]): { routes: AutoRoute[]; unmatched: UnmatchedRoute[] } {
  const unit = metresPerUnit(plan.units, project.cadLength);
  const join = JOIN_M / unit.factor, touch = TOUCH_M / unit.factor;
  const routeLayers = layersWith(map, 'route');
  const handLinked = new Set((plan.curves ?? []).filter((c) => c.tag?.startsWith('route:')).map((c) => c.tag!.slice('route:'.length)));
  const curves = (plan.curves ?? []).filter((c) => !c.tag && routeLayers.has(c.layer.toLowerCase()) && c.points.length >= 2);
  const boards = [...(plan.places ?? []).map((p) => ({ id: p.boardId, at: [p.x, p.y] as Pt })), ...plan.symbols.map((s) => ({ id: s.name, at: [s.x, s.y] as Pt }))]
    .map((b) => ({ ...b, board: project.boards.find((x) => x.id.toLowerCase() === b.id.trim().toLowerCase()) }))
    .filter((b) => b.board);
  const nearestBoard = (p: Pt) => boards.filter((b) => dist(b.at, p) <= touch).sort((a, b) => dist(a.at, p) - dist(b.at, p))[0];
  const boardAt = (p: Pt) => nearestBoard(p)?.board;
  const fixtureAt = (p: Pt) => (plan.fixtures ?? []).filter((f) => dist([f.x, f.y], p) <= touch).sort((a, b) => dist([a.x, a.y], p) - dist([b.x, b.y], p))[0];

  const routes = new Map<string, AutoRoute>();
  const unmatched: UnmatchedRoute[] = [];
  const atBoard = (p: Pt) => boards.some((b) => dist(b.at, p) <= AT_BOARD_M / unit.factor);
  for (const idx of connected(curves, join, atBoard)) {
    const group = idx.map((i) => curves[i]);
    const length = group.reduce((s, c) => s + c.length, 0);
    const miss = (reason: string) => unmatched.push({ layer: group[0].layer, lengthM: Math.round(length * unit.factor * 10) / 10, reason, at: group[0].points[0] });
    const ends = freeEnds(group, join, atBoard);
    if (ends.length !== 2) { miss(ends.length > 2 ? 'branches' : 'closed loop'); continue; }
    const [a, b] = ends;
    const [ba, bb] = [boardAt(a), boardAt(b)];
    let feederId: string | undefined;
    if (ba && bb) {
      feederId = project.feeders.find((f) => (f.boardId === ba.id && f.feedsBoardId === bb.id) || (f.boardId === bb.id && f.feedsBoardId === ba.id))?.id;
      if (!feederId) { miss(`no feeder between ${ba.id} and ${bb.id}`); continue; }
    } else if (ba || bb) {
      const board = (ba ?? bb)!;
      const fixture = fixtureAt(ba ? b : a);
      const circuit = fixture && findCircuit(project, fixture.cct);
      if (!fixture) { miss(`starts at ${board.id}, the other end touches no fixture or board`); continue; }
      if (!circuit || circuit.boardId !== board.id) { miss(`fixture circuit ${fixture.cct} is not on ${board.id}`); continue; }
      feederId = circuit.id;
    } else { miss('touches no board'); continue; }
    if (handLinked.has(feederId)) continue;
    const at = routes.get(feederId);
    // One path from the end at the feeder's own board, so trays along it are listed in order from that board.
    const source = project.feeders.find((f) => f.id === feederId)!.boardId;
    const from = [a, b].find((e) => nearestBoard(e)?.board?.id === source);
    const pieces = [chain(group.map((c) => c.points), from)];
    routes.set(feederId, at ? { feederId, pieces: [...at.pieces, ...pieces], length: at.length + length } : { feederId, pieces, length });
  }
  return { routes: [...routes.values()], unmatched };
}

export interface AutoTray { name: string; points: Pt[]; length: number }

/** Tray runs on tray layers, named: by the nearest tray label ("TRAY A", "CT-2", or a short name on a tray layer)
 * within reach; runs joined to a named run take its name; the rest are T1, T2… Runs linked by hand keep their name. */
export function autoTrays(project: Project, plan: CadPlan, map: CadLayerMap[]): AutoTray[] {
  const unit = metresPerUnit(plan.units, project.cadLength);
  const join = JOIN_M / unit.factor, reach = LABEL_M / unit.factor;
  const trayLayers = layersWith(map, 'tray');
  const curves = (plan.curves ?? []).filter((c) => !c.tag && trayLayers.has(c.layer.toLowerCase()) && c.points.length >= 2);
  const labelOf = (text: string, layer: string) => {
    const m = text.trim().match(/^(?:CABLE\s+)?(?:TRAY|CT|C\.T\.)\s*[-:#.]?\s*([A-Z0-9][A-Z0-9-]{0,5})$/i);
    if (m) return m[1].toUpperCase();
    return trayLayers.has(layer.toLowerCase()) && /^[A-Z0-9][A-Z0-9-]{0,5}$/i.test(text.trim()) ? text.trim().toUpperCase() : undefined;
  };
  const labels = plan.texts.map((t) => ({ name: labelOf(t.text, t.layer), at: [t.x, t.y] as Pt })).filter((l): l is { name: string; at: Pt } => !!l.name);
  const names: (string | undefined)[] = curves.map(() => undefined);
  for (const l of labels) {
    let best = -1, d = Infinity;
    curves.forEach((c, i) => { const x = distToPath(l.at, c.points); if (x < d) { d = x; best = i; } });
    if (best >= 0 && d <= reach && !names[best]) names[best] = l.name;
  }
  const groups = connected(curves, join);
  let n = 0;
  const taken = new Set([...names.filter(Boolean) as string[], ...(plan.curves ?? []).filter((c) => c.tag?.startsWith('tray:')).map((c) => c.tag!.slice(5))]);
  for (const g of groups) {
    // Unnamed runs take the name of a named run they are joined to, spreading along the group.
    let changed = true;
    while (changed) {
      changed = false;
      for (const i of g) {
        if (names[i]) continue;
        const ends = [curves[i].points[0], curves[i].points[curves[i].points.length - 1]];
        const named = g.find((j) => names[j] && [curves[j].points[0], curves[j].points[curves[j].points.length - 1]].some((e) => ends.some((x) => dist(e, x) <= join)));
        if (named !== undefined) { names[i] = names[named]; changed = true; }
      }
    }
    if (g.some((i) => !names[i])) {
      do n += 1; while (taken.has(`T${n}`));
      taken.add(`T${n}`);
      for (const i of g) if (!names[i]) names[i] = `T${n}`;
    }
  }
  return curves.map((c, i) => ({ name: names[i]!, points: c.points, length: c.length }));
}
