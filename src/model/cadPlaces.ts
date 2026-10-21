import { metresPerUnit } from './cadLengths';
import { findFloor, floorLabel, levelKey, type LevelRef } from './levels';
import type { Board, Project } from '../types';

/** What a floor plan in CAD says about board locations, in drawing units (from the OpenCADStudio link). */
export interface CadPlan {
  units?: number; // INSUNITS
  places: { boardId: string; x: number; y: number }[]; // symbols linked to a board by hand
  symbols: { name: string; x: number; y: number }[]; // blocks whose TAG / BOARD / PANEL attribute names a board
  outlines: { layer: string; points: [number, number][] }[]; // closed polylines
  texts: { layer: string; x: number; y: number; text: string }[];
}

export interface BoardPlace {
  boardId: string;
  room?: string; // the name of the room outline it sits in
  x: number; // metres on the plan
  y: number;
  currentLocation?: string;
  currentLevel: string;
  newLevel: string;
  how: 'linked' | 'attribute';
}

export interface BoardPlacePull {
  proposals: BoardPlace[]; // boards whose location, level or position differs
  matching: number;
  unknown: string[]; // symbols naming a board that is not in the design
  noRoom: string[]; // boards outside every room outline
  rooms: number; // room outlines found
  units: string;
}

const DEFAULT_ROOM_LAYER = /ROOM|SPACE|AREA/i;

/** Ray casting: is the point inside the closed outline? */
export function inside([x, y]: [number, number], poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const area = (poly: [number, number][]) => Math.abs(poly.reduce((s, [x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]; return s + x * v - u * y; }, 0)) / 2;
const centroid = (poly: [number, number][]): [number, number] => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];

/** The room a point is in: the smallest room outline around it, named by the text inside that outline nearest its
 * centre (texts on a layer with NAME or ROOM first). */
export function roomAt(plan: Pick<CadPlan, 'outlines' | 'texts'>, point: [number, number], roomLayer?: string): string | undefined {
  const isRoom = (layer: string) => (roomLayer?.trim() ? layer.toLowerCase().includes(roomLayer.trim().toLowerCase()) : DEFAULT_ROOM_LAYER.test(layer));
  const around = plan.outlines.filter((o) => isRoom(o.layer) && inside(point, o.points)).sort((a, b) => area(a.points) - area(b.points));
  for (const room of around) {
    const c = centroid(room.points);
    const names = plan.texts.filter((t) => inside([t.x, t.y], room.points));
    const preferred = names.filter((t) => /NAME|ROOM/i.test(t.layer));
    const pick = (preferred.length ? preferred : names).sort((a, b) => Math.hypot(a.x - c[0], a.y - c[1]) - Math.hypot(b.x - c[0], b.y - c[1]))[0];
    if (pick) return tidy(pick.text);
  }
  return undefined;
}

/** "ELECTRICAL ROOM" → "Electrical room"; mixed-case names are kept as drawn. */
function tidy(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() && /[A-Z]/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

/** Proposed board locations from a floor plan: room (location), the plan's level, and the position in metres.
 * A board linked by hand wins over one found by its TAG attribute. */
export function pullBoardPlaces(project: Project, plan: CadPlan, level: LevelRef | undefined): BoardPlacePull {
  const unit = metresPerUnit(plan.units, project.cadLength);
  const info = project.building;
  const levelText = (b: Board | undefined, ref = b?.level) => {
    const f = findFloor(info, ref);
    return f ? floorLabel(info, f) : '—';
  };
  const found = new Map<string, { x: number; y: number; how: BoardPlace['how'] }>();
  const unknown = new Set<string>();
  const byId = (name: string) => project.boards.find((b) => b.id.toLowerCase() === name.trim().toLowerCase());
  for (const s of plan.symbols) {
    const b = byId(s.name);
    if (!b) { unknown.add(s.name); continue; }
    if (!found.has(b.id)) found.set(b.id, { x: s.x, y: s.y, how: 'attribute' });
  }
  for (const p of plan.places) {
    const b = byId(p.boardId);
    if (!b) { unknown.add(p.boardId); continue; }
    found.set(b.id, { x: p.x, y: p.y, how: 'linked' });
  }

  const proposals: BoardPlace[] = [];
  const noRoom: string[] = [];
  let matching = 0;
  for (const b of project.boards) {
    const at = found.get(b.id);
    if (!at) continue;
    const room = roomAt(plan, [at.x, at.y], project.cadRoomLayer);
    if (!room) noRoom.push(b.id);
    const x = Math.round(at.x * unit.factor * 100) / 100, y = Math.round(at.y * unit.factor * 100) / 100;
    const sameLevel = !level || (b.level && levelKey(b.level) === levelKey(level));
    const sameRoom = !room || room === b.location;
    const samePoint = b.planPoint?.x === x && b.planPoint?.y === y;
    if (sameLevel && sameRoom && samePoint) { matching += 1; continue; }
    proposals.push({
      boardId: b.id, room, x, y, how: at.how,
      currentLocation: b.location, currentLevel: levelText(b), newLevel: level ? levelText(b, level) : levelText(b)
    });
  }
  return { proposals, matching, unknown: [...unknown].sort(), noRoom, rooms: plan.outlines.filter((o) => (project.cadRoomLayer?.trim() ? o.layer.toLowerCase().includes(project.cadRoomLayer.trim().toLowerCase()) : DEFAULT_ROOM_LAYER.test(o.layer))).length, units: unit.source };
}

/** Sets the accepted boards' location (room, when one was found), level and position on the plan. */
export function applyBoardPlaces(project: Project, accepted: BoardPlace[], level: LevelRef | undefined): Project {
  const byId = new Map(accepted.map((a) => [a.boardId, a]));
  return {
    ...project,
    boards: project.boards.map((b) => {
      const a = byId.get(b.id);
      if (!a) return b;
      return { ...b, ...(a.room ? { location: a.room } : {}), ...(level ? { level } : {}), planPoint: { x: a.x, y: a.y } };
    })
  };
}
