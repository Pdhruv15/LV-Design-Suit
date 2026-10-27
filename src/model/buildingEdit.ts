import { buildingInfoOf } from '../calc/building';
import type { BuildingLevel, LevelKind, Project, ProjectBuilding } from '../types';

/** Adding buildings and levels to Building information without the app (lvds add-building / add-level), so a rooms
 * package can be accepted into a project that does not have its building yet. Levels are kept bottom to top. */

const lower = (s: string) => s.trim().toLowerCase();

/** A building by ID, else by name (case does not matter). */
export function findBuilding(project: Project, ref: string): ProjectBuilding {
  const all = buildingInfoOf(project).buildings;
  const b = all.find((x) => x.id === ref) ?? all.find((x) => lower(x.name) === lower(ref)) ?? all.find((x) => lower(x.id) === lower(ref));
  if (!b) throw new Error(all.length ? `No building "${ref}". Buildings: ${all.map((x) => `${x.id} (${x.name})`).join(', ')}` : `No building "${ref}": the project has no buildings yet. Add one with add_building.`);
  return b;
}

export interface NewBuilding { id?: string; name: string; use?: string }

export function addBuilding(project: Project, spec: NewBuilding): { project: Project; building: ProjectBuilding } {
  const info = buildingInfoOf(project);
  const name = spec.name.trim();
  if (!name) throw new Error('The building name is empty.');
  if (info.buildings.some((b) => lower(b.name) === lower(name))) throw new Error(`A building named "${name}" already exists.`);
  const ids = new Set(info.buildings.map((b) => b.id));
  let id = spec.id?.trim();
  if (id !== undefined && !id) throw new Error('The building id is empty.');
  if (id && ids.has(id)) throw new Error(`Building ${id} already exists.`);
  if (!id) for (let n = info.buildings.length + 1; ; n++) if (!ids.has(`B${n}`)) { id = `B${n}`; break; }
  const building: ProjectBuilding = { id: id!, name, ...(spec.use?.trim() ? { use: spec.use.trim() } : {}), levels: [] };
  return { project: { ...project, building: { ...info, buildings: [...info.buildings, building] } }, building };
}

export interface NewLevel { id?: string; name: string; kind: LevelKind; heightM?: number; count?: number; grossM2?: number; above?: string }

/** Floor-to-floor height by kind when none is given (the app's new-building defaults). */
const HEIGHT: Record<LevelKind, number> = { basement: 3.6, ground: 4.5, podium: 4.5, typical: 3.6, roof: 3, other: 3.6 };

/** Where a level goes when `above` is not given: a basement at the bottom, the ground above the basements, a roof on
 * top, anything else below the roof. */
function defaultIndex(levels: BuildingLevel[], kind: LevelKind): number {
  if (kind === 'basement') return 0;
  if (kind === 'ground') return levels.filter((l) => l.kind === 'basement').length;
  if (kind === 'roof') return levels.length;
  const roofAt = levels.findIndex((l) => l.kind === 'roof');
  return roofAt < 0 ? levels.length : roofAt;
}

export function addLevel(project: Project, buildingRef: string, spec: NewLevel): { project: Project; building: ProjectBuilding; level: BuildingLevel; index: number } {
  const info = buildingInfoOf(project);
  const b = findBuilding(project, buildingRef);
  const name = spec.name.trim();
  if (!name) throw new Error('The level name is empty.');
  if (b.levels.some((l) => lower(l.name) === lower(name))) throw new Error(`${b.name} already has a level named "${name}".`);
  const ids = new Set(info.buildings.flatMap((x) => x.levels.map((l) => l.id)));
  let id = spec.id?.trim();
  if (id !== undefined && !id) throw new Error('The level id is empty.');
  if (id && ids.has(id)) throw new Error(`Level ${id} already exists.`);
  if (!id) for (let n = b.levels.length + 1; ; n++) if (!ids.has(`${b.id}-L${n}`)) { id = `${b.id}-L${n}`; break; }
  if (spec.count !== undefined && !(Number.isInteger(spec.count) && spec.count >= 1)) throw new Error('count must be a whole number of floors, 1 or more.');
  if (spec.count !== undefined && spec.count > 1 && spec.kind !== 'typical') throw new Error('Only a typical level can repeat (count above 1).');
  let index = defaultIndex(b.levels, spec.kind);
  if (spec.above !== undefined) {
    const at = b.levels.findIndex((l) => l.id === spec.above || lower(l.name) === lower(spec.above!));
    if (at < 0) throw new Error(`No level "${spec.above}" in ${b.name}. Levels: ${b.levels.map((l) => l.name).join(', ') || 'none'}`);
    index = at + 1;
  }
  const level: BuildingLevel = {
    id: id!, name, kind: spec.kind, heightM: spec.heightM ?? HEIGHT[spec.kind],
    ...(spec.grossM2 !== undefined ? { grossM2: spec.grossM2 } : {}),
    ...(spec.count !== undefined && spec.count > 1 ? { count: spec.count } : {})
  };
  const levels = [...b.levels.slice(0, index), level, ...b.levels.slice(index)];
  const building = { ...b, levels };
  return { project: { ...project, building: { ...info, buildings: info.buildings.map((x) => (x.id === b.id ? building : x)) } }, building, level, index };
}
