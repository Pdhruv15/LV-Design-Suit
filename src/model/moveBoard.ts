import type { Board, Project } from '../types';
import { boardSummary } from '../calc/summary';

/** Moving a board (with everything below it) to another source in the
 * panel tree: its incomer feeder moves to the new source's schedule and is
 * flagged so the cable length gets checked (the route changed). */

const byId = (p: Project, id?: string) => (id ? p.boards.find((b) => b.id === id) : undefined);

/** Every board below `id` (not including it). */
export function below(project: Project, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (x: string) => { for (const b of project.boards) if (b.upstreamId === x && !out.has(b.id)) { out.add(b.id); walk(b.id); } };
  walk(id);
  return out;
}

/** Why the move isn't allowed, or undefined when it is. */
export function moveBlocked(project: Project, id: string, to: string): string | undefined {
  const b = byId(project, id), t = byId(project, to);
  if (!b || !t) return 'Board not found';
  if (id === to) return `${id} can't supply itself`;
  if (b.upstreamId === to) return `${id} is already supplied from ${to}`;
  if (below(project, id).has(to)) return `${to} is below ${id} — that would make a loop`;
  return undefined;
}

/** The incomer feeder of a board (on its source's schedule). */
export const incomerOf = (project: Project, id: string) => project.feeders.find((f) => f.feedsBoardId === id);

/** Supply `id` from `to`. The incomer feeder moves to `to` (placed last) and its length is flagged. */
export function moveBoard(project: Project, id: string, to: string): Project {
  if (moveBlocked(project, id, to)) return project;
  const inc = incomerOf(project, id);
  const boards = project.boards.map((b) => (b.id === id ? { ...b, upstreamId: to } : b));
  let feeders = project.feeders;
  if (inc) {
    const moved = { ...inc, boardId: to, lengthToCheck: true };
    feeders = [...feeders.filter((f) => f.id !== inc.id), moved];
  }
  return { ...project, boards, feeders };
}

/** Siblings in tree order (the order of their incomers on the parent). */
export function siblings(project: Project, id: string): Board[] {
  const b = byId(project, id);
  if (!b) return [];
  const peers = project.boards.filter((x) => (x.upstreamId ?? '') === (b.upstreamId ?? ''));
  const pos = (x: Board) => { const i = project.feeders.findIndex((f) => f.feedsBoardId === x.id); return i < 0 ? Infinity : i; };
  return [...peers].sort((a, c) => pos(a) - pos(c));
}

/** Indent: supplied from the board just above it at the same level. */
export function indentTarget(project: Project, id: string): string | undefined {
  const s = siblings(project, id);
  const i = s.findIndex((x) => x.id === id);
  return i > 0 ? s[i - 1].id : undefined;
}

/** Outdent: supplied from its source's source. */
export function outdentTarget(project: Project, id: string): string | undefined {
  const parent = byId(project, byId(project, id)?.upstreamId);
  return parent?.upstreamId;
}

/** Move up / down among the boards on the same source (swaps their incomers' places). */
export function reorderBoard(project: Project, id: string, dir: -1 | 1): Project {
  const s = siblings(project, id);
  const i = s.findIndex((x) => x.id === id);
  const other = s[i + dir];
  if (!other) return project;
  const a = project.feeders.findIndex((f) => f.feedsBoardId === id);
  const c = project.feeders.findIndex((f) => f.feedsBoardId === other.id);
  if (a < 0 || c < 0) return project;
  const feeders = [...project.feeders];
  [feeders[a], feeders[c]] = [feeders[c], feeders[a]];
  return { ...project, feeders };
}

/** What changes, in one sentence, for the confirmation. */
export function moveSummary(project: Project, id: string, to: string): string {
  const after = moveBoard(project, id, to);
  const old = byId(project, id)?.upstreamId;
  const load = (p: Project, bid?: string) => { const b = byId(p, bid); return b ? boardSummary(p, b) : undefined; };
  const part = (bid: string | undefined, label: string) => {
    if (!bid) return '';
    const s0 = load(project, bid), s1 = load(after, bid);
    if (!s0 || !s1) return '';
    const kw = s1.demandKw - s0.demandKw;
    const pct = s1.loadingPct !== undefined ? ` (now ${s1.loadingPct.toFixed(0)} % loaded${s1.loadingPct > 100 ? ' ⚠' : ''})` : '';
    const k = Math.round(kw);
    return `${label} ${bid}: ${k === 0 ? 'demand unchanged' : `${k > 0 ? '+' : ''}${k} kW`}${pct}`;
  };
  const n = below(project, id).size;
  return [`${id}${n ? ` and the ${n} board(s) below it` : ''} will be supplied from ${to}.`, part(to, 'New source'), part(old, 'Old source'), incomerOf(project, id) ? 'The incomer cable moves with it — check its length (the route changed).' : '']
    .filter(Boolean).join('\n');
}
