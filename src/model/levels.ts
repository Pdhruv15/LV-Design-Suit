import type { Board, BuildingInfo, Project } from '../types';
import { floorsOf } from '../calc/buildingDesign';

/** One list of levels for the whole design: Building information is the
 * only place levels are created, renamed or reordered. Panels, space
 * planning areas and rooms store a link to a level (never a copy of its
 * name), so a rename there shows everywhere: SLD summary box, riser
 * diagram, schedules, reports. */

export interface LevelRef { building: string; level: string; index?: number } // index: which floor of a typical group
export interface Floor { ref: LevelRef; key: string; buildingId: string; buildingName: string; tag: string; name: string; elevationM: number; order: number }

export const levelKey = (r: LevelRef) => `${r.building}/${r.level}/${r.index ?? 0}`;

/** Every floor of every building, bottom to top (typical groups expanded). */
export function floorList(info: BuildingInfo | undefined): Floor[] {
  if (!info) return [];
  return info.buildings.flatMap((b) => floorsOf(info, b).map((f, order) => {
    const ref: LevelRef = { building: b.id, level: f.level.id, ...(f.index ? { index: f.index } : {}) };
    return { ref, key: levelKey(ref), buildingId: b.id, buildingName: b.name, tag: f.tag, name: f.name, elevationM: f.elevationM, order };
  }));
}

export const findFloor = (info: BuildingInfo | undefined, ref: LevelRef | undefined): Floor | undefined =>
  ref ? floorList(info).find((f) => f.key === levelKey(ref)) : undefined;

/** "3F" (one building) or "Tower A · 3F". */
export function floorLabel(info: BuildingInfo | undefined, f: Floor): string {
  return (info?.buildings.length ?? 0) > 1 ? `${f.buildingName} · ${f.name}` : f.name;
}

/** A floor from typed text: building by name (or the only building), floor by name or tag. */
export function matchFloor(info: BuildingInfo | undefined, building: string, floor: string): Floor | undefined {
  const all = floorList(info);
  if (!all.length || !floor.trim()) return undefined;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const bs = info!.buildings.length === 1 ? info!.buildings : info!.buildings.filter((b) => norm(b.name) === norm(building) || b.id === building);
  const fl = norm(floor);
  return all.find((f) => bs.some((b) => b.id === f.buildingId) && (norm(f.name) === fl || norm(f.tag) === fl || norm(f.name.replace(/ \(.*\)$/, '')) === fl));
}

/** Where a panel is: "3F · Elec. room 3.01", the level from Building information. */
export function boardLocation(project: Project, b: Board): string {
  const f = findFloor(project.building, b.level);
  const lvl = f ? floorLabel(project.building, f) : '';
  return [lvl, b.location].filter(Boolean).join(' · ');
}

/** Panels without a level, when the project has buildings. */
export const boardsWithoutLevel = (project: Project): Board[] =>
  floorList(project.building).length ? project.boards.filter((b) => !findFloor(project.building, b.level)) : [];
