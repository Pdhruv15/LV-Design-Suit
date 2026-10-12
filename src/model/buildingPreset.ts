import type { BuildingInfo, BuildingRoom, ProjectBuilding, RoomType, UnitType } from '../types';
import { roomTypesOf, summarizeBuilding } from '../calc/building';
import { catalog } from '../database/catalog';
import { pushLibrary } from '../database/librarySync';

/** Reusing building information: a building saved as a preset, or buildings
 * copied from a past project. Both travel as a bundle — buildings, their
 * rooms, the flat layouts placed on their levels and the room types they
 * use — and are merged into a project with new ids. Nothing tied to the
 * other project's single-line diagram comes along: the DBs serving rooms and
 * the board the riser is fed from are left for you to set here. */

export interface BuildingBundle {
  buildings: ProjectBuilding[];
  rooms: BuildingRoom[];
  unitTypes: UnitType[];
  /** The room types the rooms and flats use, with the figures they had. */
  roomTypes: RoomType[];
}

export interface BundleOptions {
  /** The rooms on the levels (flats placed on levels always come). */
  rooms: boolean;
  /** Plot area, GFA and built-up area typed for the building (they rarely carry over). */
  areas: boolean;
}

const clone = <T,>(x: T): T => structuredClone(x);

/** The bundle for some buildings of a project. */
export function bundleFrom(info: BuildingInfo, buildingIds: string[], opts: BundleOptions = { rooms: true, areas: false }): BuildingBundle {
  const buildings = info.buildings.filter((b) => buildingIds.includes(b.id)).map((b) => {
    const x = clone(b);
    if (x.riser) {
      const { horizontalM, perDbM } = x.riser;
      x.riser = horizontalM !== undefined || perDbM !== undefined ? { horizontalM, perDbM } : undefined;
      if (!x.riser) delete x.riser;
    }
    if (!opts.areas) { delete x.plotAreaM2; delete x.gfaM2; delete x.buaM2; }
    return x;
  });
  const ids = new Set(buildings.map((b) => b.id));
  const rooms = opts.rooms ? info.rooms.filter((r) => ids.has(r.buildingId)).map(({ boardId: _db, ...r }) => clone(r)) : [];
  const unitIds = new Set(buildings.flatMap((b) => b.levels.flatMap((l) => l.units?.map((u) => u.unitTypeId) ?? [])));
  const unitTypes = (info.unitTypes ?? []).filter((u) => unitIds.has(u.id)).map(clone);
  const typeIds = new Set([...rooms.map((r) => r.type), ...unitTypes.flatMap((u) => u.rooms.map((r) => r.type))]);
  const roomTypes = roomTypesOf(info).filter((t) => typeIds.has(t.id)).map(clone);
  return { buildings, rooms, unitTypes, roomTypes };
}

/** DB links that a bundle of these buildings would leave behind. */
export const dbLinksOf = (info: BuildingInfo, buildingIds: string[]) => info.rooms.filter((r) => buildingIds.includes(r.buildingId) && r.boardId).length;

/** How a bundle's room type differs from this project's, or undefined when the same. */
export function roomTypeDiff(here: RoomType, there: RoomType): string | undefined {
  const parts: string[] = [];
  if (here.wPerM2 !== there.wPerM2) parts.push(`${here.wPerM2} → ${there.wPerM2} W/m²`);
  if (here.demandFactor !== there.demandFactor) parts.push(`DF ${here.demandFactor} → ${there.demandFactor}`);
  if ((here.lux ?? null) !== (there.lux ?? null)) parts.push(`${here.lux ?? '—'} → ${there.lux ?? '—'} lux`);
  if (JSON.stringify(here.rules ?? {}) !== JSON.stringify(there.rules ?? {}) || (here.lpdMax ?? null) !== (there.lpdMax ?? null) || (here.benchWPerM2 ?? null) !== (there.benchWPerM2 ?? null)) parts.push('load schedule rules');
  return parts.length ? parts.join(', ') : undefined;
}

const sameLayout = (a: UnitType, b: UnitType) => (a.meter ?? null) === (b.meter ?? null) && JSON.stringify(a.rooms) === JSON.stringify(b.rooms);

export interface MergeResult {
  info: BuildingInfo;
  buildingIds: string[];
  /** Building names as added (renamed when the name was taken). */
  buildingNames: string[];
  rooms: number;
  unitTypesAdded: string[];
  unitTypesReused: string[];
  roomTypesAdded: string[];
  /** Room types this project already has with other figures: kept, or replaced with `roomTypes: 'replace'`. */
  roomTypesDiffer: { id: string; label: string; diff: string }[];
}

/** Adds a bundle to a project: new ids for the buildings, levels, rooms and flat layouts; a layout the project already has
 * (same name, same rooms) is reused; missing room types are added; room types the project has already keep this project's
 * figures unless `roomTypes` is 'replace'. */
export function mergeBundle(info: BuildingInfo, bundle: BuildingBundle, opts: { roomTypes: 'keep' | 'replace' } = { roomTypes: 'keep' }): MergeResult {
  // Room types.
  const current = roomTypesOf(info);
  const types = [...current];
  const roomTypesAdded: string[] = [];
  const roomTypesDiffer: MergeResult['roomTypesDiffer'] = [];
  for (const t of bundle.roomTypes) {
    const i = types.findIndex((x) => x.id === t.id);
    if (i < 0) { types.push(clone(t)); roomTypesAdded.push(t.label); continue; }
    const diff = roomTypeDiff(types[i], t);
    if (!diff) continue;
    roomTypesDiffer.push({ id: t.id, label: t.label, diff });
    if (opts.roomTypes === 'replace') types[i] = clone(t);
  }
  const typesChanged = roomTypesAdded.length > 0 || (opts.roomTypes === 'replace' && roomTypesDiffer.length > 0);

  // Flat layouts.
  const units = [...(info.unitTypes ?? [])];
  const unitMap = new Map<string, string>();
  const unitTypesAdded: string[] = [], unitTypesReused: string[] = [];
  for (const u of bundle.unitTypes) {
    const same = units.find((x) => x.name.trim().toLowerCase() === u.name.trim().toLowerCase() && sameLayout(x, u));
    if (same) { unitMap.set(u.id, same.id); unitTypesReused.push(same.name); continue; }
    let name = u.name.trim();
    while (units.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) name = `${name} (copy)`;
    let n = units.length + 1;
    while (units.some((x) => x.id === `U${n}`)) n++;
    units.push({ ...clone(u), id: `U${n}`, name });
    unitMap.set(u.id, `U${n}`);
    unitTypesAdded.push(name);
  }

  // Buildings, levels, rooms.
  const buildings = [...info.buildings];
  const rooms = [...info.rooms];
  const buildingIds: string[] = [], buildingNames: string[] = [];
  let roomN = rooms.length;
  let added = 0;
  for (const src of bundle.buildings) {
    let n = buildings.length + 1;
    while (buildings.some((x) => x.id === `BLD${n}`)) n++;
    const id = `BLD${n}`;
    let name = src.name.trim() || 'Building';
    while (buildings.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) name = `${name} (copy)`;
    const levelMap = new Map<string, string>();
    const levels = src.levels.map((l, i) => {
      const lid = `${id}-L${i + 1}`;
      levelMap.set(l.id, lid);
      const units = l.units?.map((u) => ({ ...u, unitTypeId: unitMap.get(u.unitTypeId) ?? u.unitTypeId }));
      return { ...clone(l), id: lid, ...(units ? { units } : {}) };
    });
    buildings.push({ ...clone(src), id, name, levels });
    buildingIds.push(id);
    buildingNames.push(name);
    for (const r of bundle.rooms.filter((x) => x.buildingId === src.id)) {
      const levelId = levelMap.get(r.levelId);
      if (!levelId) continue;
      while (rooms.some((x) => x.id === `R${roomN}`) || roomN === 0) roomN++;
      const { boardId: _db, ...rest } = clone(r);
      rooms.push({ ...rest, id: `R${roomN}`, buildingId: id, levelId });
      added++;
    }
  }

  const next: BuildingInfo = { ...info, buildings, rooms, ...(units.length ? { unitTypes: units } : {}) };
  if (typesChanged) next.roomTypes = types;
  return { info: next, buildingIds, buildingNames, rooms: added, unitTypesAdded, unitTypesReused, roomTypesAdded, roomTypesDiffer };
}

/** One line per building in a bundle: name, floors description, rooms, flats. */
export function bundleLines(bundle: BuildingBundle): { id: string; name: string; description: string; rooms: number; flats: number }[] {
  const info: BuildingInfo = { buildings: bundle.buildings, rooms: bundle.rooms, unitTypes: bundle.unitTypes, roomTypes: bundle.roomTypes };
  return bundle.buildings.map((b) => {
    const s = summarizeBuilding(info, b);
    return {
      id: b.id, name: b.name, description: s.description,
      rooms: bundle.rooms.filter((r) => r.buildingId === b.id).length,
      flats: b.levels.reduce((a, l) => a + (l.units?.reduce((x, u) => x + u.count, 0) ?? 0) * Math.max(1, Math.round(l.count ?? 1)), 0)
    };
  });
}

// ---- Presets ---------------------------------------------------------------------

/** A building saved for reuse: one building with its levels, flats, rooms and room types. */
export interface BuildingPreset {
  id: string;
  name: string;
  note?: string;
  savedAt: string;
  bundle: BuildingBundle;
}

export const BUILDING_PRESETS_KEY = 'lvds.buildingPresets';
const newId = () => `bp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function presetFromBuilding(info: BuildingInfo, buildingId: string, name: string, opts: BundleOptions & { note?: string }, now = new Date()): BuildingPreset {
  return { id: newId(), name: name.trim(), ...(opts.note?.trim() ? { note: opts.note.trim() } : {}), savedAt: now.toISOString(), bundle: bundleFrom(info, [buildingId], opts) };
}

const isBundle = (x: unknown): x is BuildingBundle => {
  const b = x as BuildingBundle;
  return !!b && Array.isArray(b.buildings) && b.buildings.every((y) => y && typeof y.id === 'string' && Array.isArray(y.levels)) && Array.isArray(b.rooms ?? []);
};
const isPreset = (x: unknown): x is BuildingPreset => !!x && typeof (x as BuildingPreset).name === 'string' && isBundle((x as BuildingPreset).bundle);
const normalise = (p: BuildingPreset): BuildingPreset => ({
  ...p, id: typeof p.id === 'string' && p.id ? p.id : newId(), savedAt: p.savedAt || new Date().toISOString(),
  bundle: { buildings: p.bundle.buildings, rooms: p.bundle.rooms ?? [], unitTypes: p.bundle.unitTypes ?? [], roomTypes: p.bundle.roomTypes ?? [] }
});

/** Your building presets on this computer (synced through Library.json). */
export function loadBuildingPresets(): BuildingPreset[] {
  try {
    const v = JSON.parse(localStorage.getItem(BUILDING_PRESETS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isPreset).map(normalise) : [];
  } catch { return []; }
}
export function saveBuildingPresets(list: BuildingPreset[]): boolean {
  try { localStorage.setItem(BUILDING_PRESETS_KEY, JSON.stringify(list)); void pushLibrary(); return true; } catch { return false; }
}

/** A name not used by another preset. */
export function presetNameIssue(name: string, list: BuildingPreset[], exceptId?: string): string | undefined {
  if (!name.trim()) return 'Give the preset a name.';
  if (list.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === name.trim().toLowerCase())) return `A preset is already called "${name.trim()}".`;
  return undefined;
}

export function exportBuildingPresets(list: BuildingPreset[]): string {
  return JSON.stringify({ kind: 'lvds-building-presets', exportedAt: new Date().toISOString(), presets: list }, null, 2);
}

/** Reads an exported file; a preset whose id or name is taken comes in as a new copy. */
export function importBuildingPresets(text: string, existing: BuildingPreset[]): { added: BuildingPreset[]; error?: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { added: [], error: 'The file is not valid JSON.' }; }
  const raw = Array.isArray(data) ? data : (data as { presets?: unknown })?.presets;
  if (!Array.isArray(raw)) return { added: [], error: 'No building presets found in the file.' };
  const names = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  const ids = new Set(existing.map((p) => p.id));
  const added: BuildingPreset[] = [];
  for (const x of raw.filter(isPreset)) {
    const p = normalise(x);
    let name = p.name.trim();
    while (names.has(name.toLowerCase())) name = `${name} (imported)`;
    names.add(name.toLowerCase());
    const id = ids.has(p.id) ? newId() : p.id;
    ids.add(id);
    added.push({ ...p, id, name });
  }
  return added.length ? { added } : { added, error: 'No building presets found in the file.' };
}

// ---- Flat / tenant layout library ------------------------------------------------

const UNIT_TYPES_KEY = 'lvds.unitTypes';
const key = (s: string) => s.trim().toLowerCase();

/** Your flat layouts: UnitTypes.xlsx (database), else the copy on this computer. */
export function unitTypeLibrary(): UnitType[] {
  if (catalog().unitTypes.length) return catalog().unitTypes;
  try { const v = JSON.parse(localStorage.getItem(UNIT_TYPES_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((u) => u && typeof u.name === 'string' && Array.isArray(u.rooms)) : []; } catch { return []; }
}
export function saveLocalUnitTypeLibrary(list: UnitType[]): boolean {
  try { localStorage.setItem(UNIT_TYPES_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

const libId = (name: string) => `lib-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** The library with these layouts written in by name: a layout with the same name is updated, others are added. */
export function libraryWith(lib: UnitType[], units: UnitType[]): { list: UnitType[]; added: string[]; updated: string[]; same: string[] } {
  const list = lib.map(clone);
  const added: string[] = [], updated: string[] = [], same: string[] = [];
  for (const u of units) {
    const i = list.findIndex((x) => key(x.name) === key(u.name));
    const copy: UnitType = { id: libId(u.name), name: u.name.trim(), rooms: u.rooms.map((r) => ({ ...r })), ...(u.meter ? { meter: u.meter } : {}) };
    if (i < 0) { list.push(copy); added.push(copy.name); } else if (sameLayout(list[i], copy)) same.push(copy.name); else { list[i] = { ...copy, id: list[i].id }; updated.push(copy.name); }
  }
  return { list, added, updated, same };
}

/** UnitTypes.xlsx rows: one per room. */
export const unitTypeRows = (list: UnitType[]): Record<string, string | number>[] =>
  list.flatMap((u) => u.rooms.map((r, i) => ({ unitType: u.name, room: r.name, roomType: r.type, areaM2: r.areaM2, meter: i === 0 ? u.meter ?? '' : '' })));

/** The project's layouts with library ones added: a layout with the same name is updated in place (so the levels it is
 * placed on keep it), others are added with new ids. */
export function withLibraryUnits(units: UnitType[], picked: UnitType[]): { list: UnitType[]; added: string[]; updated: string[] } {
  const list = units.map(clone);
  const added: string[] = [], updated: string[] = [];
  for (const u of picked) {
    const i = list.findIndex((x) => key(x.name) === key(u.name));
    if (i >= 0) {
      if (!sameLayout(list[i], u)) { list[i] = { ...list[i], rooms: u.rooms.map((r) => ({ ...r })), meter: u.meter }; if (!u.meter) delete list[i].meter; updated.push(u.name); }
      continue;
    }
    let n = list.length + 1;
    while (list.some((x) => x.id === `U${n}`)) n++;
    list.push({ ...clone(u), id: `U${n}` });
    added.push(u.name);
  }
  return { list, added, updated };
}

/** Room types the layouts use that the project doesn't have. */
export const missingRoomTypes = (info: BuildingInfo, units: UnitType[]): string[] => {
  const have = new Set(roomTypesOf(info).map((t) => t.id));
  return [...new Set(units.flatMap((u) => u.rooms.map((r) => r.type)).filter((t) => !have.has(t)))];
};
