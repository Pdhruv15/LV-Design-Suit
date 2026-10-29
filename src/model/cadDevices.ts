import { buildingInfoOf } from '../calc/building';
import { updateCircuit } from './schedule';
import { circuitRef } from '../calc/loadSchedule';
import type { LevelRef } from './levels';
import type { Feeder, PointType, Project } from '../types';

/** Devices the engineer places in the CAD view, in metres on a level's plan (the same coordinates as the room outlines
 * and the ELV devices):
 * - LV points (lights, sockets, fans…) on a circuit: kept in `project.lvPoints`, and counted on that circuit — placing
 *   one adds a point of its type, deleting it takes the point away;
 * - a distribution board: the board's position and level on the plan.
 * ELV devices are placed through src/components/elv/elvCadDevices.ts (the ELV placement); their palette and placed
 * items have the same shape as these. */

export interface LvPoint {
  id: string; // permanent: never reused
  type: PointType;
  feederId: string;
  buildingId: string;
  levelId: string;
  x: number; // metres on the level's plan
  y: number;
}

/** The devices the CAD palette offers (ELV ones come from the ELV side with `kind: { elv }`). */
export type CadDeviceKind = { lv: PointType } | { elv: string } | { board: true };
export interface PaletteItem { id: string; label: string; kind: CadDeviceKind; symbol: { shape: string; text: string } }

export const LV_PALETTE: PaletteItem[] = [
  { id: 'ltg', label: 'Light', kind: { lv: 'ltg' }, symbol: { shape: 'cross', text: '' } },
  { id: 's13', label: 'Socket 13 A', kind: { lv: 's13' }, symbol: { shape: 'rect', text: '' } },
  { id: 's13t', label: 'Twin socket', kind: { lv: 's13t' }, symbol: { shape: 'twin', text: '' } },
  { id: 'cfan', label: 'Ceiling fan', kind: { lv: 'cfan' }, symbol: { shape: 'circle', text: 'F' } },
  { id: 'exfan', label: 'Exhaust fan', kind: { lv: 'exfan' }, symbol: { shape: 'circle', text: 'EF' } },
  { id: 'sac', label: 'Split A/C', kind: { lv: 'sac' }, symbol: { shape: 'square', text: 'AC' } },
  { id: 'wh', label: 'Water heater', kind: { lv: 'wh' }, symbol: { shape: 'square', text: 'WH' } },
  { id: 'db', label: 'DB', kind: { board: true }, symbol: { shape: 'rect', text: 'DB' } }
];

/** The smallest room outline on the level around a point (metres). */
function roomAt(p: Project, level: LevelRef, x: number, y: number) {
  const inside = (pts: [number, number][]) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  return buildingInfoOf(p).rooms
    .filter((r) => r.buildingId === level.building && r.levelId === level.level && r.outline && r.outline.length >= 3 && inside(r.outline))
    .sort((a, b) => a.areaM2 - b.areaM2)[0];
}

/** Final circuits a point can go on (not feeders to other boards), by board and way. */
export const finalCircuits = (p: Project): Feeder[] =>
  p.feeders.filter((f) => !f.feedsBoardId && !f.generation).sort((a, b) => circuitLabel(p, a).localeCompare(circuitLabel(p, b), undefined, { numeric: true }));
/** "DB-GF1/R1 · Living lighting", as circuits are written on plans (CCT). */
export function circuitLabel(_p: Project, f: Feeder): string {
  const ref = circuitRef(f);
  return `${f.boardId}${ref ? `/${ref}` : ''}${f.name ? ` · ${f.name}` : ''}`;
}

/** A cable as plans name it: "MDB-1 → SMDB-GF" for a feeder to a board, else its circuit ("DB-GF1/R1 · Living lighting"). */
export const cableLabel = (p: Project, f: Feeder): string => (f.feedsBoardId ? `${f.boardId} → ${f.feedsBoardId}` : circuitLabel(p, f));
/** Every cable a route can be drawn for: feeders to boards first, then final circuits. */
export const cablesOf = (p: Project): Feeder[] => [...p.feeders].filter((f) => !f.generation)
  .sort((a, b) => Number(!a.feedsBoardId) - Number(!b.feedsBoardId) || cableLabel(p, a).localeCompare(cableLabel(p, b), undefined, { numeric: true }));

const nextLvId = (p: Project) => (p.lvPoints ?? []).reduce((m, d) => Math.max(m, Number(/^P(\d+)$/.exec(d.id)?.[1] ?? 0)), p.lvPointSeq ?? 0) + 1;
const withCount = (p: Project, feederId: string, type: PointType, delta: number): Project => {
  const f = p.feeders.find((x) => x.id === feederId);
  if (!f) return p;
  const n = Math.max(0, (f.points?.[type] ?? 0) + delta);
  return updateCircuit(p, feederId, { points: { ...(f.points ?? {}), [type]: n } });
};

/** Places an LV point on a circuit: added to the plan and counted on the circuit. */
export function placeLvPoint(p: Project, level: LevelRef, type: PointType, feederId: string, x: number, y: number): { project: Project; id: string } {
  if (!p.feeders.some((f) => f.id === feederId)) throw new Error('Choose the circuit the point is on.');
  const id = `P${nextLvId(p)}`;
  const point: LvPoint = { id, type, feederId, buildingId: level.building, levelId: level.level, x, y };
  return { project: withCount({ ...p, lvPoints: [...(p.lvPoints ?? []), point] }, feederId, type, 1), id };
}

export function moveLvPoint(p: Project, id: string, x: number, y: number): Project {
  return { ...p, lvPoints: (p.lvPoints ?? []).map((d) => (d.id === id ? { ...d, x, y } : d)) };
}

/** Removes an LV point and takes it off its circuit's count; its ID is not given out again. */
export function removeLvPoint(p: Project, id: string): Project {
  const d = (p.lvPoints ?? []).find((x) => x.id === id);
  if (!d) return p;
  const rest = (p.lvPoints ?? []).filter((x) => x.id !== id);
  const { lvPoints: _old, ...base } = p;
  const next = rest.length ? { ...base, lvPoints: rest, lvPointSeq: nextLvId(p) - 1 } : { ...base, lvPointSeq: nextLvId(p) - 1 };
  return withCount(next, d.feederId, d.type, -1);
}

/** Places a board on the plan: its position and level, and the room it is in (when that room has an outline). */
export function placeBoard(p: Project, boardId: string, level: LevelRef, x: number, y: number): Project {
  const room = roomAt(p, level, x, y);
  return { ...p, boards: p.boards.map((b) => (b.id === boardId ? { ...b, planPoint: { x, y }, level, ...(room ? { location: room.name } : {}) } : b)) };
}

/** One device shown in the CAD view (metres on the level's plan). */
export interface PlacedItem { key: string; id: string; what: 'lv' | 'elv' | 'board'; x: number; y: number; label: string; detail: string; symbol: PaletteItem['symbol']; room?: string }

/** LV points and boards placed on a level (ELV devices: src/components/elv/elvCadDevices.ts). */
export function placedOn(p: Project, level: LevelRef): PlacedItem[] {
  const roomName = (x: number, y: number) => roomAt(p, level, x, y)?.name;
  const lv = (p.lvPoints ?? []).filter((d) => d.buildingId === level.building && d.levelId === level.level).map((d): PlacedItem => {
    const f = p.feeders.find((x) => x.id === d.feederId);
    const item = LV_PALETTE.find((x) => 'lv' in x.kind && x.kind.lv === d.type);
    return { key: `lv:${d.id}`, id: d.id, what: 'lv', x: d.x, y: d.y, label: item?.label ?? d.type, detail: f ? circuitLabel(p, f) : 'circuit removed', symbol: item?.symbol ?? { shape: 'circle', text: '?' }, room: roomName(d.x, d.y) };
  });
  const boards = p.boards.filter((b) => b.planPoint && b.level?.building === level.building && b.level?.level === level.level).map((b): PlacedItem => ({
    key: `board:${b.id}`, id: b.id, what: 'board', x: b.planPoint!.x, y: b.planPoint!.y, label: b.id, detail: b.name, symbol: { shape: 'rect', text: 'DB' }, room: b.location
  }));
  return [...lv, ...boards];
}

/** Places an LV palette item (a point on a circuit, or a board) at a point. */
export function placeItem(p: Project, item: PaletteItem, level: LevelRef, x: number, y: number, target: { feederId?: string; boardId?: string }): { project: Project; message: string } {
  if ('elv' in item.kind) throw new Error('ELV devices are placed through the ELV placement.');
  if ('lv' in item.kind) {
    const { project } = placeLvPoint(p, level, item.kind.lv, target.feederId ?? '', x, y);
    const f = project.feeders.find((q) => q.id === target.feederId)!;
    return { project, message: `${item.label} placed on ${circuitLabel(project, f)} — ${f.points?.[item.kind.lv] ?? 0} on the circuit` };
  }
  if (!target.boardId) throw new Error('Choose the board to place.');
  return { project: placeBoard(p, target.boardId, level, x, y), message: `${target.boardId} placed on the plan` };
}

/** Moves or removes a placed LV point or board. */
export function moveItem(p: Project, it: PlacedItem, x: number, y: number, level: LevelRef): Project {
  return it.what === 'lv' ? moveLvPoint(p, it.id, x, y) : placeBoard(p, it.id, level, x, y);
}
export function removeItem(p: Project, it: PlacedItem): Project {
  if (it.what === 'lv') return removeLvPoint(p, it.id);
  return { ...p, boards: p.boards.map((b) => { if (b.id !== it.id) return b; const { planPoint: _pp, ...rest } = b; return rest; }) };
}
