import type { BuildingInfo, BuildingLevel, BuildingRoom, LevelKind, Project, ProjectBuilding, RoomType } from '../types';
import { boardTotals } from './summary';
import type { SpaceArea, SpacePlan } from '../types';

/** Architectural information as project parameters: GFA and floors from
 * the levels (typical floors counted as many times as they repeat), room
 * loads from their type's W/m², totals per level, building and DB, and a
 * check of each DB's scheduled load against the rooms it serves. */

/** PLACEHOLDER densities — not authority figures. Replace them with your
 * own (Building → Room types); your library is kept on this computer. */
export const DEFAULT_ROOM_TYPES: RoomType[] = [
  { id: 'apartment', label: 'Apartment', wPerM2: 80, demandFactor: 0.7, lux: 150 },
  { id: 'villa', label: 'Villa', wPerM2: 70, demandFactor: 0.7, lux: 150 },
  { id: 'office', label: 'Office', wPerM2: 100, demandFactor: 0.8, lux: 500 },
  { id: 'retail', label: 'Retail / shop', wPerM2: 120, demandFactor: 0.8, lux: 500 },
  { id: 'fnb', label: 'F&B / restaurant', wPerM2: 150, demandFactor: 0.8, lux: 300 },
  { id: 'hotel', label: 'Hotel room', wPerM2: 90, demandFactor: 0.7, lux: 200 },
  { id: 'lobby', label: 'Lobby / corridor', wPerM2: 40, demandFactor: 0.9, lux: 200 },
  { id: 'toilet', label: 'Toilet / pantry', wPerM2: 30, demandFactor: 0.8, lux: 200 },
  { id: 'gym', label: 'Gym / amenity', wPerM2: 80, demandFactor: 0.8, lux: 300 },
  { id: 'parking', label: 'Car park', wPerM2: 10, demandFactor: 0.9, lux: 75 },
  { id: 'plant', label: 'Plant / electrical room', wPerM2: 20, demandFactor: 0.8, lux: 300 },
  { id: 'store', label: 'Store', wPerM2: 15, demandFactor: 0.8, lux: 150 },
  { id: 'living', label: 'Flat — living / dining', wPerM2: 150, demandFactor: 0.7, lux: 150 },
  { id: 'bedroom', label: 'Flat — bedroom', wPerM2: 140, demandFactor: 0.7, lux: 100 },
  { id: 'kitchen', label: 'Flat — kitchen', wPerM2: 350, demandFactor: 0.6, lux: 300 },
  { id: 'bathroom', label: 'Flat — bathroom', wPerM2: 300, demandFactor: 0.6, lux: 150 }
];

export const LEVEL_KINDS: { value: LevelKind; label: string; short: string }[] = [
  { value: 'basement', label: 'Basement', short: 'B' },
  { value: 'ground', label: 'Ground', short: 'G' },
  { value: 'podium', label: 'Podium', short: 'P' },
  { value: 'typical', label: 'Typical', short: '' },
  { value: 'roof', label: 'Roof', short: 'R' },
  { value: 'other', label: 'Other', short: 'M' }
];

export const emptyBuildingInfo = (): BuildingInfo => ({ buildings: [], rooms: [] });
export const buildingInfoOf = (p: Project): BuildingInfo => p.building ?? emptyBuildingInfo();
export const roomTypesOf = (info: BuildingInfo): RoomType[] => info.roomTypes ?? DEFAULT_ROOM_TYPES;

export const newBuilding = (id: string, name = 'Building'): ProjectBuilding => ({
  id, name, levels: [
    { id: `${id}-G`, name: 'Ground', kind: 'ground', heightM: 4.5 },
    { id: `${id}-T`, name: 'Typical floors', kind: 'typical', heightM: 3.6, count: 10 },
    { id: `${id}-R`, name: 'Roof', kind: 'roof', heightM: 3 }
  ]
});

const countOf = (l: BuildingLevel) => Math.max(1, Math.round(l.count ?? 1));

export interface LevelInfo {
  level: BuildingLevel;
  count: number;
  /** Finished floor level of the first of its floors, from the ground floor (basements negative). */
  elevationM: number;
  grossM2: number; // all its floors
  roomsM2: number; // all its floors
  connectedKw: number; // all its floors
  demandKw: number; // all its floors
  perFloorDemandKw: number;
}

export interface BuildingSummary {
  building: ProjectBuilding;
  levels: LevelInfo[];
  floors: number; // every floor, typical counted
  aboveGround: number;
  basements: number;
  /** e.g. "2B + G + 2P + 20 + R". */
  description: string;
  gfaM2: number;
  gfaFromLevels: number;
  buaM2: number;
  roomsM2: number;
  heightM: number; // ground to the top of the roof level
  connectedKw: number;
  demandKw: number;
}

export interface RoomLoad {
  room: BuildingRoom;
  type?: RoomType;
  /** Room count × the level's identical floors. */
  total: number;
  areaM2: number; // all of them
  connectedKw: number;
  demandKw: number;
}

export function roomLoad(info: BuildingInfo, r: BuildingRoom): RoomLoad {
  const type = roomTypesOf(info).find((t) => t.id === r.type);
  const level = info.buildings.find((b) => b.id === r.buildingId)?.levels.find((l) => l.id === r.levelId);
  const total = Math.max(1, Math.round(r.count ?? 1)) * (level ? countOf(level) : 1);
  const areaM2 = r.areaM2 * total;
  const connectedKw = (areaM2 * (type?.wPerM2 ?? 0)) / 1000;
  return { room: r, type, total, areaM2, connectedKw, demandKw: connectedKw * (type?.demandFactor ?? 1) };
}

export function summarizeBuilding(info: BuildingInfo, b: ProjectBuilding): BuildingSummary {
  const loads = info.rooms.filter((r) => r.buildingId === b.id).map((r) => roomLoad(info, r));
  // Elevations: basements go down from the ground floor (the one listed
  // last is just below it), the other levels up, in the order listed.
  const below = b.levels.filter((l) => l.kind === 'basement');
  const above = b.levels.filter((l) => l.kind !== 'basement');
  const elev = new Map<string, number>();
  let z = 0;
  for (let i = below.length - 1; i >= 0; i--) { z -= below[i].heightM * countOf(below[i]); elev.set(below[i].id, z); }
  z = 0;
  for (const l of above) { elev.set(l.id, z); z += l.heightM * countOf(l); }
  const levels: LevelInfo[] = b.levels.map((l) => {
    const ls = loads.filter((x) => x.room.levelId === l.id);
    const count = countOf(l);
    const demandKw = ls.reduce((s, x) => s + x.demandKw, 0);
    return {
      level: l, count, elevationM: elev.get(l.id) ?? 0, grossM2: (l.grossM2 ?? 0) * count,
      roomsM2: ls.reduce((s, x) => s + x.areaM2, 0), connectedKw: ls.reduce((s, x) => s + x.connectedKw, 0), demandKw, perFloorDemandKw: demandKw / count
    };
  });
  const floors = levels.reduce((s, l) => s + l.count, 0);
  const basements = levels.filter((l) => l.level.kind === 'basement').reduce((s, l) => s + l.count, 0);
  const parts: string[] = [];
  for (const k of LEVEL_KINDS) {
    const n = levels.filter((l) => l.level.kind === k.value).reduce((s, l) => s + l.count, 0);
    if (!n) continue;
    parts.push(k.value === 'typical' ? String(n) : `${n > 1 ? n : ''}${k.short}`);
  }
  const gfaFromLevels = levels.reduce((s, l) => s + l.grossM2, 0);
  const gfaM2 = b.gfaM2 ?? gfaFromLevels;
  return {
    building: b, levels, floors, basements, aboveGround: floors - basements, description: parts.join(' + '),
    gfaM2, gfaFromLevels, buaM2: b.buaM2 ?? gfaM2, roomsM2: levels.reduce((s, l) => s + l.roomsM2, 0),
    heightM: z, connectedKw: levels.reduce((s, l) => s + l.connectedKw, 0), demandKw: levels.reduce((s, l) => s + l.demandKw, 0)
  };
}

/** Built-up area for the DEWA forms: typed in Project settings, else the buildings'. */
export function builtUpAreaOf(p: Project): number | undefined {
  if (p.info?.builtUpAreaM2) return p.info.builtUpAreaM2;
  const info = p.building;
  if (!info?.buildings.length) return undefined;
  const total = info.buildings.reduce((s, b) => s + summarizeBuilding(info, b).buaM2, 0);
  return total > 0 ? Math.round(total) : undefined;
}

export interface DbCheck {
  boardId: string;
  rooms: RoomLoad[];
  areaM2: number;
  expectedKw: number; // the rooms' demand from their types
  scheduledKw: number; // the board's demand in the design
  ratio?: number; // scheduled ÷ expected
  wPerM2: number; // scheduled demand ÷ area
  status: 'ok' | 'warn';
}

/** Each DB against the rooms it serves: its designed demand vs what the
 * room types suggest (within ± tolerance is fine). */
export function dbChecks(p: Project, tolerance = 0.3): DbCheck[] {
  const info = p.building;
  if (!info) return [];
  const by = new Map<string, RoomLoad[]>();
  for (const r of info.rooms) if (r.boardId) by.set(r.boardId, [...(by.get(r.boardId) ?? []), roomLoad(info, r)]);
  return [...by.entries()].filter(([id]) => p.boards.some((b) => b.id === id)).map(([boardId, rooms]) => {
    const areaM2 = rooms.reduce((s, x) => s + x.areaM2, 0);
    const expectedKw = rooms.reduce((s, x) => s + x.demandKw, 0);
    const scheduledKw = boardTotals(p, boardId).demandKw;
    const ratio = expectedKw > 0 ? scheduledKw / expectedKw : undefined;
    return {
      boardId, rooms, areaM2, expectedKw, scheduledKw, ratio, wPerM2: areaM2 > 0 ? (scheduledKw * 1000) / areaM2 : 0,
      status: ratio === undefined || Math.abs(ratio - 1) <= tolerance ? 'ok' : 'warn'
    };
  });
}

/** Rooms pasted from an architect's area schedule (Excel / CSV): columns
 * Level, Room, Type, Area (m²), Count, DB — a header row is skipped. Unknown
 * levels are added to the building; unknown types are matched by name, or
 * added with the placeholder density of "Store" (edit them after). */
export function roomsFromTable(info: BuildingInfo, buildingId: string, text: string): { info: BuildingInfo; added: number; newTypes: string[]; newLevels: string[] } {
  const rows = text.split(/\r?\n/).map((l) => l.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ''))).filter((r) => r.some(Boolean));
  const b = info.buildings.find((x) => x.id === buildingId);
  if (!b) return { info, added: 0, newTypes: [], newLevels: [] };
  const levels = [...b.levels];
  const types = [...roomTypesOf(info)];
  const newTypes: string[] = [];
  const newLevels: string[] = [];
  const rooms: BuildingRoom[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  let n = info.rooms.length;
  for (const r of rows) {
    const [levelName, name, typeName, area, count, db] = r;
    const areaM2 = Number(String(area ?? '').replace(/[^0-9.]/g, ''));
    if (!name || !(areaM2 > 0)) continue; // header or blank
    let level = levels.find((l) => norm(l.name) === norm(levelName ?? '') || norm(l.id) === norm(levelName ?? ''));
    if (!level) {
      level = { id: `${b.id}-L${levels.length + 1}`, name: levelName || 'Level', kind: /^b/i.test(levelName ?? '') ? 'basement' : /roof/i.test(levelName ?? '') ? 'roof' : /^g/i.test(levelName ?? '') ? 'ground' : 'other', heightM: 3.6 };
      // Basements at the bottom, a roof on top, anything else below the roof.
      const roofAt = levels.findIndex((l) => l.kind === 'roof');
      if (level.kind === 'basement') levels.splice(levels.filter((l) => l.kind === 'basement').length, 0, level);
      else if (level.kind === 'roof' || roofAt < 0) levels.push(level);
      else levels.splice(roofAt, 0, level);
      newLevels.push(level.name);
    }
    let type = types.find((t) => norm(t.label) === norm(typeName ?? '') || norm(t.id) === norm(typeName ?? '') || (typeName && norm(t.label).startsWith(norm(typeName))));
    if (!type && typeName) {
      type = { id: norm(typeName) || `type${types.length + 1}`, label: typeName, wPerM2: 15, demandFactor: 0.8 };
      types.push(type);
      newTypes.push(typeName);
    }
    rooms.push({ id: `R${++n}`, buildingId: b.id, levelId: level.id, name, type: type?.id ?? 'store', areaM2, count: Number(count) > 1 ? Math.round(Number(count)) : undefined, boardId: db || undefined });
  }
  return {
    info: { ...info, buildings: info.buildings.map((x) => (x.id === b.id ? { ...x, levels } : x)), rooms: [...info.rooms, ...rooms], roomTypes: newTypes.length || info.roomTypes ? types : undefined },
    added: rooms.length, newTypes, newLevels
  };
}

// ---- Room type library on this computer ---------------------------------------

const KEY = 'lvds.roomTypes';
export function loadRoomTypeLibrary(): RoomType[] | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return Array.isArray(v) ? v : null; } catch { return null; }
}
export function saveRoomTypeLibrary(t: RoomType[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(t)); return true; } catch { return false; }
}

/** Space planning areas from the rooms: one area per room (all its copies),
 * the room types as the use types. Panels already given to an area are kept. */
export function spaceAreasFromRooms(info: BuildingInfo, plan: SpacePlan): SpacePlan {
  const keep = new Map(plan.areas.map((a) => [a.id, a.panel]));
  const areas: SpaceArea[] = info.rooms.map((r) => {
    const b = info.buildings.find((x) => x.id === r.buildingId);
    const l = b?.levels.find((x) => x.id === r.levelId);
    const load = roomLoad(info, r);
    return {
      id: `room-${r.id}`, building: b?.name ?? '', floor: l ? `${l.name}${countOf(l) > 1 ? ` (×${countOf(l)})` : ''}` : undefined,
      name: `${r.name}${load.total > 1 ? ` ×${load.total}` : ''}`, use: r.type, areaM2: Math.round(load.areaM2 * 10) / 10, panel: keep.get(`room-${r.id}`)
    };
  });
  return { ...plan, areas, uses: roomTypesOf(info).map(({ id, label, wPerM2, demandFactor }) => ({ id, label, wPerM2, demandFactor })) };
}
