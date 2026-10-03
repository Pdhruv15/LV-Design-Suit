import type { Board, Project } from '../types';
import { findFloor } from './levels';
import { levelRef, panelName } from './hierarchy';
import { prefixOf, roleOf } from './emergency';

/** Rename panels everywhere they are referenced, and "rename by level":
 * type – level – number (SMDB-L1, DB-L3-07). Panels without a level keep
 * their names. Every field that holds a board id is updated — parents,
 * feeders, ties, sheets, clouds, arrows, risers, rooms, UPS / PV systems,
 * report scopes — and circuit / incomer ids that carry the board's name
 * follow it (DB-037-R3 → DB-L3-07-R3, INC-DB-037 → INC-DB-L3-07). */

const BOARD_KEYS = new Set(['boardId', 'feedsBoardId', 'upstreamId', 'sourceBoardId', 'fromBoardId']);
const BOARD_LIST_KEYS = new Set(['boards']);

export const kindOf = (b: Board) => b.kind ?? (b.upstreamId ? 'DB' : 'MDB');

/** New ids by level: per type and level, numbered in the current order (natural sort), number only when more than one. */
export function renameByLevel(project: Project, only?: Set<string>): { from: string; to: string; level: string }[] {
  const groups = new Map<string, Board[]>();
  for (const b of project.boards) {
    if (only && !only.has(b.id)) continue;
    const f = findFloor(project.building, b.level);
    if (!f) continue;
    // Prefix from the naming table for the panel's role (EDB for a DB below an EMDB).
    const key = `${prefixOf(project, roleOf(project, b))}|${levelRef(f.tag)}|${f.buildingId}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(b);
  }
  const out: { from: string; to: string; level: string }[] = [];
  const nat = new Intl.Collator('en', { numeric: true });
  for (const [key, list] of groups) {
    const [kind, level] = key.split('|');
    list.sort((x, y) => nat.compare(x.id, y.id));
    list.forEach((b, i) => { const to = panelName(kind, level, i + 1, list.length); if (to !== b.id) out.push({ from: b.id, to, level }); });
  }
  return out;
}

/** Problems with a set of renames: clashes with panels or feeders that keep their ids, repeats, empty names. */
export function renameProblems(project: Project, pairs: { from: string; to: string }[]): string[] {
  const moving = new Set(pairs.map((p) => p.from));
  const staying = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id)].filter((id) => !moving.has(id)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pairs) {
    if (!p.to.trim()) out.push(`${p.from}: the new name is empty`);
    else if (staying.has(p.to)) out.push(`${p.to} already exists — ${p.from} can't take that name`);
    else if (seen.has(p.to)) out.push(`${p.to} would be used twice`);
    seen.add(p.to);
  }
  return out;
}

/** The project with boards renamed and every reference updated. */
export function renamePanels(project: Project, pairs: { from: string; to: string }[]): Project {
  const map = new Map(pairs.filter((p) => p.from !== p.to).map((p) => [p.from, p.to.trim()]));
  if (!map.size) return project;
  const problems = renameProblems(project, [...map].map(([from, to]) => ({ from, to })));
  if (problems.length) throw new Error(problems[0]);
  // Feeder ids that carry their board's name follow it.
  const feederMap = new Map<string, string>();
  const taken = new Set(project.feeders.map((f) => f.id));
  for (const f of project.feeders) {
    let to: string | undefined;
    const nb = map.get(f.boardId);
    if (nb && f.id.startsWith(`${f.boardId}-`)) to = nb + f.id.slice(f.boardId.length);
    else if (f.feedsBoardId && map.get(f.feedsBoardId) && f.id === `INC-${f.feedsBoardId}`) to = `INC-${map.get(f.feedsBoardId)}`;
    if (to && to !== f.id && !taken.has(to)) { feederMap.set(f.id, to); taken.add(to); }
  }
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return BOARD_LIST_KEYS.has(key ?? '') ? v.map((x) => (typeof x === 'string' ? map.get(x) ?? x : walk(x))) : v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === 'string' && BOARD_KEYS.has(k)) o[k] = map.get(x) ?? x;
        else if (typeof x === 'string' && k === 'feederId') o[k] = feederMap.get(x) ?? x;
        else if (typeof x === 'string' && k === 'target') o[k] = x.startsWith('f:') ? `f:${feederMap.get(x.slice(2)) ?? x.slice(2)}` : map.get(x) ?? x;
        else o[k] = walk(x, k);
      }
      return o;
    }
    return v;
  };
  const next = walk({ ...project, boards: undefined, feeders: undefined }) as Project;
  return {
    ...next,
    ...(project.ties ? { ties: project.ties.map((t) => ({ ...t, a: map.get(t.a) ?? t.a, b: map.get(t.b) ?? t.b })) } : {}),
    boards: project.boards.map((b) => {
      const c = walk(b) as Board;
      const to = map.get(b.id);
      return to ? { ...c, id: to, name: b.name === b.id ? to : b.name } : c;
    }),
    feeders: project.feeders.map((f) => {
      const c = walk(f) as typeof f;
      const to = feederMap.get(f.id);
      return to ? { ...c, id: to, name: c.feedsBoardId && f.name === `To ${f.feedsBoardId}` ? `To ${c.feedsBoardId}` : c.name } : c;
    })
  };
}

/** Proposed names for every panel of one role (by roleOf), in the order given by `order`
 * (No. per board id; missing = after, in current natural order).
 * incremental: PREFIX-01, -02 … from `start` (a single panel starting at 1 is just PREFIX);
 * level: PREFIX-L2, or PREFIX-L2-01 … when the level has more than one; no level = unchanged. */
export function proposeNumbers(project: Project, role: string, scheme: 'incremental' | 'level', start = 1, order: Record<string, number> = {}): { names: Record<string, string>; withoutLevel: number } {
  const nat = new Intl.Collator('en', { numeric: true });
  const list = project.boards.filter((b) => roleOf(project, b) === role);
  const key = (b: Board) => (Number.isFinite(order[b.id]) ? order[b.id] : Infinity);
  const sorted = [...list].sort((x, y) => key(x) - key(y) || nat.compare(x.id, y.id));
  const prefix = prefixOf(project, role);
  const names: Record<string, string> = {};
  let withoutLevel = 0;
  if (scheme === 'incremental') {
    const first = Math.max(0, start);
    const width = Math.max(2, String(first + sorted.length - 1).length);
    sorted.forEach((b, i) => { names[b.id] = sorted.length === 1 && first === 1 ? prefix : `${prefix}-${String(first + i).padStart(width, '0')}`; });
  } else {
    const byLevel = new Map<string, Board[]>();
    for (const b of sorted) {
      const f = findFloor(project.building, b.level);
      if (!f) { withoutLevel++; continue; }
      const l = `${levelRef(f.tag)}|${f.buildingId}`;
      (byLevel.get(l) ?? byLevel.set(l, []).get(l)!).push(b);
    }
    for (const [l, bs] of byLevel) bs.forEach((b, i) => { names[b.id] = panelName(prefix, l.split('|')[0], i + 1, bs.length); });
  }
  return { names, withoutLevel };
}
