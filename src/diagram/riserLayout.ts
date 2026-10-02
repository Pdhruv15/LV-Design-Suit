import type { Board, Project } from '../types';
import { boardsInSupplyOrder, boardSummary } from '../calc/summary';
import { floorList, type Floor } from '../model/levels';
import { cableTypeOf } from '../model/cableTypes';
import { runsOf } from '../calc/electrical';
import { sizeRiser } from '../calc/busbar';

/** Riser diagram of one building: its levels bottom to top, each panel on
 * its level, how it's fed — busbar trunking (tap-off per floor) or cable —
 * and the sources (transformer, standby generator with changeover).
 * Every symbol is drawn from one unit U, so they all scale together. */

export const U = 20; // symbol unit (px): DB 1.6U × 0.9U, transformer circles r 0.5U, generator r 0.6U, tap-off 0.6U
export const ROW_H = 3.4 * U; // one level
const COL_W = 7.5 * U; // one column (symbol + its text)
const LEFT = 4.2 * U; // level names
const TOP = 1.5 * U;

export interface RiserRow { label: string; sub: string; y: number; floors: Floor[] }
export interface RiserNode { board: Board; x: number; y: number; title: string; sub: string; count?: number }
export interface RiserBus { id: string; label: string; x: number; y1: number; y2: number; taps: number[] }
export interface RiserLink { points: [number, number][]; label: string; standby?: boolean; fireRated?: boolean; labelAt: [number, number]; vertical: boolean }
export interface RiserSource { kind: 'tx' | 'gen'; x: number; y: number; title: string; sub: string }
export interface RiserLayout {
  width: number; height: number; rows: RiserRow[]; nodes: RiserNode[]; buses: RiserBus[]; links: RiserLink[]; sources: RiserSource[];
  ats: { x: number; y: number }[]; used: Set<string>; notOnLevel: string[]; empty: boolean
}

/** Floors of the building as rows (top row first). Tall buildings: a
 * typical group with no different panels on it is one row ("L01–L14 ×14"). */
function rowsOf(project: Project, buildingId: string, boards: Board[]): { rows: RiserRow[]; rowOfFloor: Map<string, number> } {
  const floors = floorList(project.building).filter((f) => f.buildingId === buildingId);
  const groups: Floor[][] = [];
  for (const f of floors) {
    const last = groups[groups.length - 1];
    const sameGroup = last && last[0].ref.level === f.ref.level && floors.length > 14;
    if (sameGroup) last.push(f); else groups.push([f]);
  }
  const rows: RiserRow[] = [];
  const rowOfFloor = new Map<string, number>();
  const n = groups.length;
  groups.forEach((g, i) => {
    const y = TOP + (n - 1 - i) * ROW_H + ROW_H / 2;
    const e = g[0].elevationM;
    const label = g.length > 1 ? `${g[0].tag}–${g[g.length - 1].tag}` : g[0].name.includes('(') ? g[0].tag : g[0].name;
    rows.push({ label, sub: g.length > 1 ? `typical ×${g.length}` : `${e >= 0 ? (e === 0 ? '±' : '+') : '−'}${Math.abs(e).toFixed(2)}`, y, floors: g });
    for (const f of g) rowOfFloor.set(f.key, rows.length - 1);
  });
  void boards;
  return { rows, rowOfFloor };
}

const fmtA = (b: Board) => (b.ratedCurrentA ? `${b.ratedCurrentA} A` : '');

export function riserLayout(project: Project, buildingId: string): RiserLayout {
  const order = boardsInSupplyOrder(project);
  const inBuilding = new Set(order.filter((b) => b.level?.building === buildingId).map((b) => b.id));
  // Their supplies too (an MDB in the basement without a level is drawn on the lowest level).
  for (const id of [...inBuilding]) {
    let x = project.boards.find((b) => b.id === id);
    while (x?.upstreamId) { inBuilding.add(x.upstreamId); x = project.boards.find((b) => b.id === x!.upstreamId); }
  }
  const boards = order.filter((b) => inBuilding.has(b.id));
  const { rows, rowOfFloor } = rowsOf(project, buildingId, boards);
  const used = new Set<string>();
  const empty = !rows.length || !boards.length;
  if (empty) return { width: 600, height: 200, rows, nodes: [], buses: [], links: [], sources: [], ats: [], used, notOnLevel: [], empty };
  const notOnLevel = boards.filter((b) => b.level?.building !== buildingId).map((b) => b.id);
  const rowIdx = (b: Board) => {
    const key = b.level && b.level.building === buildingId ? `${b.level.building}/${b.level.level}/${b.level.index ?? 0}` : undefined;
    return key !== undefined && rowOfFloor.has(key) ? rowOfFloor.get(key)! : 0;
  };
  const yOf = (b: Board) => rows[rowIdx(b)].y;

  // Busbar risers: which boards hang on which riser.
  const risers = project.busRisers ?? [];
  const onBus = new Map<string, string>(); // board → riser id
  for (const r of risers) for (const f of r.floors) if (f.boardId && inBuilding.has(f.boardId)) onBus.set(f.boardId, r.id);

  const nodes: RiserNode[] = [], buses: RiserBus[] = [], links: RiserLink[] = [], sources: RiserSource[] = [], ats: { x: number; y: number }[] = [];
  let cursor = LEFT + 3.6 * U; // room for the transformer / generator left of the first main board
  // Typical groups: boards on a collapsed row with the same parent are drawn once, "×n".
  const placed = new Set<string>();

  const place = (b: Board, x: number) => {
    const sm = boardSummary(project, b);
    const row = rows[rowIdx(b)];
    const twins = row.floors.length > 1 ? boards.filter((o) => o.id !== b.id && o.upstreamId === b.upstreamId && rowIdx(o) === rowIdx(b) && !placed.has(o.id)) : [];
    twins.forEach((t) => placed.add(t.id));
    placed.add(b.id);
    const node: RiserNode = { board: b, x, y: yOf(b), title: twins.length ? `${b.id} …` : b.id, sub: [fmtA(b), sm.demandKw ? `${sm.demandKw.toFixed(0)} kW` : ''].filter(Boolean).join(' · '), count: twins.length ? twins.length + 1 : undefined };
    nodes.push(node);
    used.add('db');
    return node;
  };

  const feederTo = (child: Board) => project.feeders.find((f) => f.feedsBoardId === child.id);
  const cableText = (child: Board) => {
    const f = feederTo(child);
    return f ? `${runsOf(f) > 1 ? `${runsOf(f)}× ` : ''}${f.cores}C ${f.cableCsaMm2} mm² · ${f.lengthM} m` : '';
  };

  const walk = (parent: RiserNode) => {
    const kids = boards.filter((c) => c.upstreamId === parent.board.id && !placed.has(c.id));
    // Busbar risers from this board.
    const byRiser = new Map<string, Board[]>();
    for (const c of kids) { const r = onBus.get(c.id); if (r && risers.find((x) => x.id === r)?.sourceBoardId === parent.board.id) byRiser.set(r, [...(byRiser.get(r) ?? []), c]); }
    for (const [rid, list] of byRiser) {
      const r = risers.find((x) => x.id === rid)!;
      const bx = cursor;
      cursor += COL_W;
      const res = (() => { try { return sizeRiser(project, r); } catch { return undefined; } })();
      const childNodes = list.map((c) => place(c, bx + 1.8 * U));
      const ys = [...childNodes.map((n) => n.y), parent.y];
      buses.push({ id: rid, label: `${r.name}${res?.type ? ` · ${res.type.ratingA} A ${r.material === 'cu' ? 'Cu' : 'Al'}` : ''}`, x: bx, y1: Math.max(...ys), y2: Math.min(...childNodes.map((n) => n.y)), taps: childNodes.map((n) => n.y) });
      links.push({ points: [[parent.x + 0.8 * U, parent.y], [bx, parent.y]], label: '', labelAt: [0, 0], vertical: false });
      used.add('bus'); used.add('tap');
      for (const n of childNodes) walk(n);
    }
    // Cables.
    for (const c of kids.filter((k) => !placed.has(k.id))) {
      const sameRow = rowIdx(c) === rowIdx(parent.board);
      const x = sameRow ? cursor + 0.8 * U : cursor + 0.8 * U;
      cursor += COL_W;
      const n = place(c, x);
      const f = feederTo(c);
      const fr = !!(f && cableTypeOf(project, f).fireRated);
      used.add(fr ? 'fr' : 'cable');
      const pts: [number, number][] = sameRow
        ? [[parent.x + 0.8 * U, parent.y], [n.x - 0.8 * U, n.y]]
        : [[parent.x + 0.8 * U, parent.y], [n.x, parent.y], [n.x, n.y + (n.y < parent.y ? 0.45 * U : -0.45 * U)]];
      const midY = (parent.y + n.y) / 2;
      links.push({ points: pts, label: cableText(c), fireRated: fr, labelAt: sameRow ? [(parent.x + n.x) / 2, parent.y - 0.4 * U] : [n.x - 0.35 * U, midY], vertical: !sameRow });
      walk(n);
    }
  };

  for (const root of boards.filter((b) => !b.upstreamId || !inBuilding.has(b.upstreamId))) {
    const x = cursor;
    cursor += COL_W;
    const n = place(root, x);
    if (root.sourceKva) {
      sources.push({ kind: 'tx', x: x - 2.6 * U, y: n.y, title: `TX-${root.id}`, sub: `${root.sourceKva} kVA` });
      links.push({ points: [[x - 2.1 * U, n.y], [x - 0.8 * U, n.y]], label: '', labelAt: [0, 0], vertical: false });
      used.add('tx');
    }
    if (root.standby) {
      const gx = x - 1.5 * U, gy = n.y + 1.6 * U;
      sources.push({ kind: 'gen', x: gx, y: gy, title: 'GEN', sub: root.standby.kva ? `${root.standby.kva} kVA` : '' });
      ats.push({ x: x - 1.5 * U, y: n.y });
      links.push({ points: [[gx, gy - 0.6 * U], [gx, n.y + 0.25 * U]], label: '', labelAt: [0, 0], vertical: false, standby: true });
      used.add('gen'); used.add('ats'); used.add('standby');
    }
    walk(n);
  }
  return { width: cursor + U, height: TOP * 2 + rows.length * ROW_H, rows, nodes, buses, links, sources, ats, used, notOnLevel, empty };
}
