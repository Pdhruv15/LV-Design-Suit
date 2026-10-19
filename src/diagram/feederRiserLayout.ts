import type { Board, BoardKind, Feeder, Project } from '../types';
import { boardsInSupplyOrder, boardTotals } from '../calc/summary';
import { floorList, levelKey } from '../model/levels';
import { cableTypeOf } from '../model/cableTypes';
import { runsOf } from '../calc/electrical';
import { deviceKind, devicePoles } from './deviceText';
import { sizeRiser, type BusRiser } from '../calc/busbar';
import { U } from './riserLayout';

/** Riser schematic with individual feeders: every panel that feeds other
 * boards (MDB, EMDB, SMDB …) is drawn as an enclosure with its busbar, and
 * each board it feeds gets its own outgoing breaker and its own cable,
 * rising (or dropping) straight to that board on its level. Boards that feed
 * nothing are drawn as a symbol for their kind (DB / EDB, SMDB, MCC / EMCC,
 * UPS) with a REF / TCL tag. The busbar-trunking riser is riserLayout.ts.
 *
 * Every board has its own column; a panel's column is its incomer, followed
 * by the columns of what it feeds, so no two feeders share a vertical.
 * A busbar trunking riser from a panel is one breaker on its busbar and the
 * busway beside it, with a tap-off unit to each board on it (those boards in
 * one column, a floor each). */

export const COL = 6 * U; // one column (feeder + its text)
const LEFT = 4.2 * U; // level names
const TOP = U;
const BOX_H = 4 * U; // panel enclosure
const PANEL_BAND = 5 * U; // one panel band of a level
const LEAF_BAND = 4 * U; // tags and symbols of a level
const SOURCE_BAND = 4.2 * U; // transformers / generators under the lowest level
const BUS_FROM_TOP = 2.8 * U; // busbar position in the enclosure: outgoing breakers above, incomer below

export type LeafSymbol = 'db' | 'smdb' | 'mcc' | 'ups';
export const leafSymbol = (k: BoardKind | undefined): LeafSymbol =>
  k === 'MCC' || k === 'EMCC' ? 'mcc' : k === 'UPS' ? 'ups' : k === 'DB' || k === 'EDB' || !k ? 'db' : 'smdb';

export interface FRRow { label: string; sub: string; yTop: number; yLine: number }
export interface FRPanel { board: Board; x1: number; x2: number; y1: number; y2: number; busY: number; incomerX: number; titleTop: boolean; lines: string[] }
export interface FRLeaf { board: Board; x: number; y: number; tagY: number; symbol: LeafSymbol; lines: string[] }
/** A vertical run with a breaker on it: bus → breaker → yTo. */
export interface FRFeeder { x: number; yBus: number; brk: [number, number]; yTo: number; device: string[]; cable: string; cableAt?: [number, number]; fireRated?: boolean; incomer?: boolean }
export interface FRTap { y: number; x2: number; up?: number; text: string }
export interface FRBusway { id: string; x: number; y1: number; y2: number; label: string; taps: FRTap[] }
export interface FRSource { kind: 'tx' | 'gen'; x: number; y: number; title: string; sub: string }
export interface FeederRiserLayout {
  width: number; height: number; rows: FRRow[]; panels: FRPanel[]; leaves: FRLeaf[]; feeders: FRFeeder[]; busways: FRBusway[];
  sources: FRSource[]; wires: { points: [number, number][]; standby?: boolean }[]; ats: { x: number; y: number }[]; used: Set<string>; empty: boolean
}

const kw = (v: number) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)} kW`;
const deviceText = (f: Feeder | undefined) => (f ? [`${f.breakerRatingA} A ${devicePoles(f)}`, `${deviceKind(f)}${f.breakerIcuKa ? ` ${f.breakerIcuKa} kA` : ''}`] : []);
const cableText = (f: Feeder | undefined) => (f ? `${runsOf(f) > 1 ? `${runsOf(f)}× ` : ''}${f.cores}C ${f.cableCsaMm2} mm² · ${f.lengthM} m` : '');
const INCOMER_TEXT: Record<string, string> = { MCCB: 'MCCB', 'MCCB-NA': 'MCCB (NA)', ISOL: 'Isolator', ACB: 'ACB' };

export function feederRiserLayout(project: Project, buildingId: string): FeederRiserLayout {
  const order = boardsInSupplyOrder(project);
  const inBuilding = new Set(order.filter((b) => b.level?.building === buildingId).map((b) => b.id));
  for (const id of [...inBuilding]) { // their supplies too
    let x = project.boards.find((b) => b.id === id);
    while (x?.upstreamId) { inBuilding.add(x.upstreamId); x = project.boards.find((b) => b.id === x!.upstreamId); }
  }
  const boards = order.filter((b) => inBuilding.has(b.id));
  const floors = floorList(project.building).filter((f) => f.buildingId === buildingId);
  const used = new Set<string>();
  const none: FeederRiserLayout = { width: 600, height: 200, rows: [], panels: [], leaves: [], feeders: [], busways: [], sources: [], wires: [], ats: [], used, empty: true };
  if (!floors.length || !boards.length) return none;

  const rowOfKey = new Map(floors.map((f, i) => [f.key, i]));
  const rowOf = (b: Board) => (b.level && b.level.building === buildingId ? rowOfKey.get(levelKey(b.level)) ?? 0 : 0);
  const kids = new Map<string, Board[]>();
  for (const b of boards) if (b.upstreamId && inBuilding.has(b.upstreamId)) kids.set(b.upstreamId, [...(kids.get(b.upstreamId) ?? []), b]);
  const childrenOf = (b: Board) => kids.get(b.id) ?? [];
  // Busbar risers: which boards hang on a riser from their own supply panel.
  const risers = (project.busRisers ?? []).filter((r) => r.sourceBoardId && inBuilding.has(r.sourceBoardId));
  const onBus = new Map<string, BusRiser>();
  for (const r of risers) for (const f of r.floors) {
    const b = f.boardId ? boards.find((x) => x.id === f.boardId) : undefined;
    if (b && b.upstreamId === r.sourceBoardId) onBus.set(b.id, r);
  }
  const cabled = (b: Board) => childrenOf(b).filter((c) => !onBus.has(c.id));
  const risersFrom = (b: Board) => risers.filter((r) => r.sourceBoardId === b.id && [...onBus.values()].includes(r));
  const busCol = new Map<string, number>();
  const isPanel = (b: Board) => childrenOf(b).length > 0;
  const depth = new Map<string, number>();
  const roots = boards.filter((b) => !b.upstreamId || !inBuilding.has(b.upstreamId));

  // Columns: a panel's incomer, then what it feeds (depth first).
  const col = new Map<string, number>();
  let next = 0;
  const assign = (b: Board, d: number) => {
    if (col.has(b.id)) return;
    col.set(b.id, next++);
    depth.set(b.id, d);
    for (const c of cabled(b)) assign(c, d + 1);
    for (const r of risersFrom(b)) {
      busCol.set(r.id, next++);
      const on = childrenOf(b).filter((c) => onBus.get(c.id) === r);
      // Boards that feed nothing share one column beside the busway (a floor each); panels get their own.
      const shared = next, taken = new Set<number>();
      let sharedUsed = false;
      for (const c of on.filter((x) => !isPanel(x))) {
        if (taken.has(rowOf(c))) { col.set(c.id, -1); continue; }
        taken.add(rowOf(c)); col.set(c.id, shared); depth.set(c.id, d + 1); sharedUsed = true;
      }
      if (sharedUsed) next++;
      for (const c of on) { if (col.get(c.id) === -1) col.delete(c.id); assign(c, d + 1); }
    }
  };
  for (const r of roots) { assign(r, 0); next += 0.5; }
  const xOf = (b: Board) => LEFT + (col.get(b.id)! + 0.5) * COL;
  const busX = (r: BusRiser) => LEFT + (busCol.get(r.id)! + 0.5) * COL;

  // Each level: panel bands (shallowest at the bottom), tags and symbols on top.
  const bandsOf = floors.map((_, i) => [...new Set(boards.filter((b) => isPanel(b) && rowOf(b) === i).map((b) => depth.get(b.id)!))].sort((a, b) => a - b));
  const hasLeaves = floors.map((_, i) => boards.some((b) => !isPanel(b) && rowOf(b) === i));
  const rowH = floors.map((_, i) => bandsOf[i].length * PANEL_BAND + (hasLeaves[i] ? LEAF_BAND : bandsOf[i].length ? U : 2 * U));
  const yTop: number[] = [];
  let y = TOP;
  for (let i = floors.length - 1; i >= 0; i--) { yTop[i] = y; y += rowH[i]; }
  const rows: FRRow[] = floors.map((f, i) => {
    const e = f.elevationM;
    return { label: f.name.includes('(') ? f.tag : f.name, sub: `${e === 0 ? '±' : e > 0 ? '+' : '−'}${Math.abs(e).toFixed(2)}`, yTop: yTop[i], yLine: yTop[i] + rowH[i] };
  });
  const height = y + SOURCE_BAND;

  // Panels.
  const panels = new Map<string, FRPanel>();
  for (const b of boards.filter(isPanel)) {
    const r = rowOf(b), band = bandsOf[r].indexOf(depth.get(b.id)!);
    const y2 = rows[r].yLine - band * PANEL_BAND - 0.5 * U, y1 = y2 - BOX_H;
    const ix = xOf(b), last = [...cabled(b).map(xOf), ...risersFrom(b).map((r) => busX(r))].reduce((a, v) => Math.max(a, v), ix);
    const parent = b.upstreamId ? panels.get(b.upstreamId) : undefined;
    const titleTop = !parent || parent.busY >= y1; // incomer from below: title in the free top corner
    const t = boardTotals(project, b.id);
    panels.set(b.id, { board: b, x1: ix - 0.4 * COL, x2: last + 0.62 * COL, y1, y2, busY: y1 + BUS_FROM_TOP, incomerX: ix, titleTop,
      lines: [b.id, b.ratedCurrentA ? `${b.ratedCurrentA} A ${b.busbarMaterial === 'aluminium' ? 'Al' : 'Cu'} busbar` : 'Busbar', `TCL ${kw(t.connectedKw)}`] });
    used.add('panel');
  }

  // Boards that feed nothing: tag and symbol on their level.
  const leaves = new Map<string, FRLeaf>();
  for (const b of boards.filter((x) => !isPanel(x))) {
    const r = rowOf(b), top = rows[r].yTop;
    const parent = b.upstreamId ? panels.get(b.upstreamId) : undefined;
    const fromAbove = !onBus.has(b.id) && !!parent && parent.busY < top;
    const symbol = leafSymbol(b.kind);
    used.add(symbol);
    leaves.set(b.id, { board: b, x: xOf(b), y: top + (fromAbove ? 0.9 : 2.95) * U, tagY: top + (fromAbove ? 1.6 : 0.3) * U, symbol,
      lines: [`REF: ${b.id}`, `TCL: ${kw(boardTotals(project, b.id).connectedKw)}`] });
  }

  // One breaker and one cable per board fed.
  const feeders: FRFeeder[] = [];
  const feederTo = (b: Board) => project.feeders.find((f) => f.feedsBoardId === b.id && f.boardId === b.upstreamId);
  for (const p of panels.values()) {
    for (const c of cabled(p.board)) {
      const f = feederTo(c);
      const x = xOf(c);
      const cp = panels.get(c.id), lf = leaves.get(c.id);
      const targetY = cp ? cp.busY : lf!.y;
      const up = targetY < p.busY;
      const yTo = cp ? (up ? cp.y2 : cp.y1) : lf!.y + (up ? 0.45 : -0.45) * U;
      const edge = up ? p.y1 : p.y2;
      const brk: [number, number] = up ? [p.busY - 0.5 * U, p.busY - 1.3 * U] : [p.busY + 0.25 * U, p.busY + 0.95 * U];
      const fr = !!(f && cableTypeOf(project, f).fireRated);
      used.add(fr ? 'fr' : 'cable'); used.add('breaker');
      const run = Math.abs(yTo - edge);
      feeders.push({ x, yBus: p.busY, brk, yTo, device: up ? deviceText(f) : deviceText(f).slice(0, 1), cable: cableText(f), fireRated: fr,
        cableAt: run > 3 * U ? [x - 0.3 * U, (edge + yTo) / 2] : undefined });
    }
  }
  // Busbar trunking risers: one breaker on the panel's busbar, a tap-off per board.
  const busways: FRBusway[] = [];
  for (const p of panels.values()) for (const r of risersFrom(p.board)) {
    const res = (() => { try { return sizeRiser(project, r); } catch { return undefined; } })();
    const tapA = new Map(res?.floors.filter((f) => f.floor.boardId).map((f) => [f.floor.boardId!, f.tapOffA]) ?? []);
    const x = busX(r);
    const taps: FRTap[] = childrenOf(p.board).filter((c) => onBus.get(c.id) === r).map((c) => {
      const cp = panels.get(c.id), lf = leaves.get(c.id);
      const a = tapA.get(c.id) ?? feederTo(c)?.breakerRatingA;
      const text = a ? `${a} A TOU` : 'TOU';
      return cp ? { y: cp.y2 + 0.3 * U, x2: cp.incomerX, up: cp.y2, text } : { y: lf!.y, x2: lf!.x - 0.8 * U, text };
    });
    const top = Math.min(...taps.map((t) => t.y)), bottom = Math.max(...taps.map((t) => t.y));
    const up = top < p.busY;
    const edge = up ? p.y1 : p.y2;
    const a = res?.feederBreakerA;
    feeders.push({ x, yBus: p.busY, brk: up ? [p.busY - 0.5 * U, p.busY - 1.3 * U] : [p.busY + 0.25 * U, p.busY + 0.95 * U], yTo: edge,
      device: a ? [`${a} A TPN`, `${a > 1600 ? 'ACB' : 'MCCB'}${res?.faultKa ? ` ${res.faultKa.toFixed(0)} kA` : ''}`] : [], cable: '' });
    busways.push({ id: r.id, x, y1: up ? edge : Math.min(edge, top), y2: up ? Math.min(top, bottom) : bottom, label: `${r.name}${res?.type ? ` · ${res.type.ratingA} A ${r.material === 'cu' ? 'Cu' : 'Al'}` : ''}`, taps });
    used.add('bus'); used.add('tap'); used.add('breaker');
  }

  // Incomers of the panels fed from another panel.
  for (const p of panels.values()) {
    const dev = p.board.incomerDevice;
    if (!p.board.upstreamId || !panels.has(p.board.upstreamId)) continue;
    const fromBelow = p.titleTop;
    const edge = fromBelow ? p.y2 : p.y1;
    if (dev === 'NONE') { feeders.push({ x: p.incomerX, yBus: p.busY, brk: [p.busY, p.busY], yTo: edge, device: [], cable: '', incomer: true }); continue; }
    const brk: [number, number] = fromBelow ? [p.busY + 0.2 * U, p.busY + 0.95 * U] : [p.busY - 0.5 * U, p.busY - 1.3 * U];
    feeders.push({ x: p.incomerX, yBus: p.busY, brk, yTo: edge, device: [INCOMER_TEXT[dev ?? (p.board.kind === 'DB' || p.board.kind === 'EDB' ? 'ISOL' : 'MCCB-NA')] ?? ''], cable: '', incomer: true });
  }

  // Sources under the main boards.
  const sources: FRSource[] = [], wires: FeederRiserLayout['wires'] = [], ats: { x: number; y: number }[] = [];
  const srcY = height - SOURCE_BAND / 2 - 0.4 * U;
  for (const r of roots) {
    const p = panels.get(r.id);
    const x = p ? p.incomerX : xOf(r);
    const yIn = p ? p.y2 : leaves.get(r.id)!.y + 0.45 * U;
    if (p) feeders.push({ x, yBus: p.busY, brk: [p.busY + 0.2 * U, p.busY + 0.95 * U], yTo: p.y2, device: [r.incomerDevice === 'ACB' || (r.ratedCurrentA ?? 0) > 1600 ? 'ACB' : 'MCCB'], cable: '', incomer: true });
    if (r.sourceKva) {
      sources.push({ kind: 'tx', x, y: srcY, title: r.txRef ?? `TX-${r.id}`, sub: `${r.sourceKva} kVA` });
      wires.push({ points: [[x, yIn], [x, srcY - 0.82 * U]] });
      used.add('tx');
    } else if (r.supply?.fedFrom) {
      sources.push({ kind: 'tx', x, y: srcY, title: `From ${r.supply.fedFrom}`, sub: r.supply.ratingA ? `${r.supply.ratingA} A` : '' });
      wires.push({ points: [[x, yIn], [x, srcY - 0.82 * U]] });
      used.add('tx');
    }
    if (r.standby) {
      const gx = x + 0.5 * COL, ay = yIn + 1.1 * U;
      sources.push({ kind: 'gen', x: gx, y: srcY, title: 'GEN', sub: r.standby.kva ? `${r.standby.kva} kVA` : '' });
      ats.push({ x, y: ay });
      wires.push({ points: [[gx, srcY - 0.6 * U], [gx, ay], [x + 0.35 * U, ay]], standby: true });
      used.add('gen'); used.add('ats'); used.add('standby');
    }
  }

  const width = LEFT + next * COL + U;
  return { width, height, rows, panels: [...panels.values()], leaves: [...leaves.values()], feeders, busways, sources, wires, ats, used, empty: false };
}
