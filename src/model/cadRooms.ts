import { buildingInfoOf, nextRoomId, roomTypesOf } from '../calc/building';
import { metresPerUnit } from './cadLengths';
import { inside, type CadLayerStats, type CadPlan } from './cadPlaces';
import type { BuildingRoom, CadLayerMap, CadLayerRole, Project, RoomSource, RoomType } from '../types';

type Pt = [number, number];

export const LAYER_ROLES: { value: CadLayerRole; label: string }[] = [
  { value: 'room', label: 'Room outline' },
  { value: 'room-name', label: 'Room name' },
  { value: 'wall', label: 'Wall' },
  { value: 'tray', label: 'Cable tray' },
  { value: 'route', label: 'Cable route' },
  { value: 'fixture', label: 'Fixtures' },
  { value: 'board', label: 'Boards' },
  { value: 'ignore', label: 'Ignore' }
];

/** A first guess at what a layer is, from its name and what it holds (AIA-style names such as A-AREA, E-TRAY, and
 * common variants). The engineer confirms or changes it. */
export function guessRole(layer: CadLayerStats): CadLayerRole {
  const n = layer.name.toUpperCase();
  if (/TRAY|LADDER|TRUNK/.test(n)) return 'tray';
  if (/CABLE|ROUTE|CONDUIT|WIRING/.test(n)) return 'route';
  // RM is the usual short form of ROOM (RM-NAMES, A-RM-TAG).
  if (/(ROOM|\bRM\b|SPACE|AREA).*(NAME|TAG|TEXT|IDEN|NUM|NO\b)|(NAME|TAG|IDEN).*(ROOM|\bRM\b|SPACE)/.test(n)) return 'room-name';
  if (/ROOM|\bRM\b|SPACE|AREA|ZONE/.test(n) && layer.outlines + layer.hatches > 0) return 'room';
  if (/WALL|PARTITION|COLUMN|COLM/.test(n)) return 'wall';
  if (/BOARD|PANEL|\bDB\b|SWBD|MDB/.test(n)) return 'board';
  if (/LIGHT|LTG|POWER|SOCKET|FIXT|DEVICE/.test(n)) return 'fixture';
  return 'ignore';
}

/** The layer map for a plan: the project's saved roles, else a guess, for every layer that holds something. */
export function layerMapFor(project: Project, layers: CadLayerStats[]): CadLayerMap[] {
  return layers.map((l) => ({ layer: l.name, role: project.cadLayers?.find((m) => m.layer.toLowerCase() === l.name.toLowerCase())?.role ?? guessRole(l) }));
}
/** The project with this plan's layer roles saved over its earlier ones (other layers kept). */
export const withLayerMap = (project: Project, layers: CadLayerMap[]): Project => ({
  ...project,
  cadLayers: [...(project.cadLayers ?? []).filter((m) => !layers.some((l) => l.layer.toLowerCase() === m.layer.toLowerCase())), ...layers]
});
export const layersWith = (map: CadLayerMap[], role: CadLayerRole) => new Set(map.filter((m) => m.role === role).map((m) => m.layer.toLowerCase()));

/** Area of a closed outline in drawing units², arc segments included (bulge = tan(θ/4)). */
export function outlineArea(points: Pt[], bulges?: number[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  let area = twice / 2;
  for (let i = 0; i < points.length && bulges; i += 1) {
    const b = bulges[i];
    if (!b) continue;
    const [a, c] = [points[i], points[(i + 1) % points.length]];
    const chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const theta = 4 * Math.atan(b); // signed
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    area += (Math.sign(theta) * (r * r * (Math.abs(theta) - Math.sin(Math.abs(theta))))) / 2; // circular segment
  }
  return Math.abs(area);
}
/** A closed outline as points only: each arc segment (bulge) replaced by chords of at most 10°. */
export function flattenOutline(points: Pt[], bulges?: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = bulges?.[i];
    out.push(a);
    if (!b) continue;
    const c = points[(i + 1) % points.length];
    const chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (!chord) continue;
    const theta = 4 * Math.atan(b); // signed sweep, + = anticlockwise
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const [mx, my] = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const h = Math.sign(theta) * Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0)) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const [cx, cy] = [mx - (h * (c[1] - a[1])) / chord, my + (h * (c[0] - a[0])) / chord]; // arc centre
    const start = Math.atan2(a[1] - cy, a[0] - cx);
    const n = Math.ceil(Math.abs(theta) / (Math.PI / 18));
    for (let k = 1; k < n; k += 1) out.push([cx + r * Math.cos(start + (theta * k) / n), cy + r * Math.sin(start + (theta * k) / n)]);
  }
  return out;
}

const centroid = (pts: Pt[]): Pt => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/** A room read from the plan: name (and number) from the room name text or room tag inside it, area in m²; the
 * outline's handle and the drawing's file name, when known, identify it in the next revision of the drawing. */
export interface CadRoom { name: string; number?: string; areaM2: number; layer: string; named: boolean; handle?: string; file?: string; outline?: Pt[] /* metres */ }

/** Rooms on a plan: closed outlines (polylines or hatches) on room layers. An outline that has other room outlines
 * inside it is a zone (a flat, a wing), not a room; outlines drawn twice (a polyline and its hatch) count once. */
export function roomsFromPlan(plan: CadPlan, map: CadLayerMap[], settings?: Project['cadLength']): { rooms: CadRoom[]; zones: number; units: string } {
  const unit = metresPerUnit(plan.units, settings);
  const roomLayers = layersWith(map, 'room'), nameLayers = layersWith(map, 'room-name');
  const outlines = plan.outlines
    .filter((o) => roomLayers.has(o.layer.toLowerCase()))
    .map((o) => ({ ...o, area: outlineArea(o.points, o.bulges), c: centroid(o.points) }))
    .filter((o) => o.area > 0)
    .sort((a, b) => a.area - b.area);
  const kept: typeof outlines = [];
  for (const o of outlines) {
    const twin = kept.find((k) => Math.abs(k.area - o.area) <= 0.01 * o.area && inside(k.c, o.points) && inside(o.c, k.points));
    if (!twin) kept.push(o);
  }
  const isZone = (o: typeof kept[number]) => kept.some((k) => k !== o && k.area < o.area && inside(k.c, o.points));
  const rooms: CadRoom[] = [];
  let zones = 0, unnamed = 0;
  for (const o of kept) {
    if (isZone(o)) { zones += 1; continue; }
    const tag = (plan.tags ?? []).filter((t) => inside([t.x, t.y], o.points)).sort((a, b) => Math.hypot(a.x - o.c[0], a.y - o.c[1]) - Math.hypot(b.x - o.c[0], b.y - o.c[1]))[0];
    const texts = plan.texts.filter((t) => inside([t.x, t.y], o.points) && !/^\s*[\d.,]+\s*(m2|m²|sq\.?\s*m|sqm)?\s*$/i.test(t.text));
    const onNameLayers = texts.filter((t) => nameLayers.has(t.layer.toLowerCase()));
    const pick = (nameLayers.size ? onNameLayers : texts).sort((a, b) => Math.hypot(a.x - o.c[0], a.y - o.c[1]) - Math.hypot(b.x - o.c[0], b.y - o.c[1]))[0];
    const name = tag?.name ?? (pick ? tidy(pick.text) : undefined);
    if (!name) unnamed += 1;
    rooms.push({ name: name ?? `Room ${unnamed}`, ...(tag?.number ? { number: tag.number } : {}), areaM2: Math.round(o.area * unit.factor * unit.factor * 100) / 100, layer: o.layer, named: !!name,
      outline: flattenOutline(o.points, o.bulges).map(([x, y]): Pt => [Math.round(x * unit.factor * 1000) / 1000, Math.round(y * unit.factor * 1000) / 1000]), ...(o.handle ? { handle: o.handle } : {}) });
  }
  // A handle seen twice cannot identify a room; neither can a handle without the drawing it belongs to.
  const seen = new Map<string, number>();
  for (const r of rooms) if (r.handle) seen.set(r.handle, (seen.get(r.handle) ?? 0) + 1);
  for (const r of rooms) {
    if (r.handle && (seen.get(r.handle)! > 1 || !plan.file)) delete r.handle;
    else if (r.handle) r.file = plan.file;
  }
  rooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { rooms, zones, units: unit.source };
}

function tidy(text: string): string {
  const t = text.replace(/\\P/g, ' ').replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() && /[A-Z]/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

const TYPE_WORDS: [RegExp, string][] = [
  [/kitchen|pantry/i, 'kitchen'], [/bed|maid|guest room|master/i, 'bedroom'], [/bath|toilet|wc|w\.c|wash|powder|shower/i, 'bathroom'],
  [/living|majlis|dining|family|lounge|sitting|hall/i, 'living'], [/store|storage|closet|laundry/i, 'store'],
  [/elec|plant|mep|pump|lv room|switch|generator|meter/i, 'plant'], [/lobby|corridor|passage|entrance|stair|lift/i, 'lobby'],
  [/office|meeting|reception/i, 'office'], [/parking|garage|car park/i, 'parking'], [/gym|pool|amenit/i, 'gym'],
  [/shop|retail/i, 'retail'], [/restaurant|cafe|café|f&b/i, 'fnb']
];
/** The room type for a room name: the one chosen before for that name, else a guess from words in it, else none. */
export function guessRoomType(name: string, types: RoomType[], remembered: Project['cadRoomTypes']): string | undefined {
  const known = remembered?.find((r) => r.name.toLowerCase() === name.toLowerCase())?.type;
  if (known && types.some((t) => t.id === known)) return known;
  const word = TYPE_WORDS.find(([re]) => re.test(name))?.[1];
  return word && types.some((t) => t.id === word) ? word : undefined;
}

export interface RoomProposal {
  key: string; // unique row key
  name: string;
  number?: string;
  areaM2: number;
  type?: string;
  existingId?: string; // the room on that level from the same outline, else with the same name
  currentAreaM2?: number;
  status: 'new' | 'changed' | 'same';
  source?: RoomSource; // the outline it was read from, recorded on the room when applied
  outline?: Pt[]; // metres, recorded on the room when applied
}

const sameName = (x: BuildingRoom, r: CadRoom) => x.name.toLowerCase() === r.name.toLowerCase();
const fromOutline = (x: BuildingRoom, r: CadRoom) =>
  !!r.handle && !!r.file && x.source?.app === 'cad' && x.source.sourceId === r.handle && x.source.file?.toLowerCase() === r.file.toLowerCase();

/** Rooms of a plan beside the project's rooms on the chosen level. A room keeps its ID when its outline (handle, same
 * drawing) is found again, so a renamed room is updated, not added; else the same name → area update; else a new room.
 * A handle match is trusted for a rename or a resize, not both at once: a re-exported drawing can reuse handles. */
export function proposeRooms(project: Project, rooms: CadRoom[], buildingId: string, levelId: string): { proposals: RoomProposal[]; notOnPlan: BuildingRoom[] } {
  const info = buildingInfoOf(project);
  const types = roomTypesOf(info);
  const onLevel = info.rooms.filter((r) => r.buildingId === buildingId && r.levelId === levelId);
  const used = new Set<string>();
  const matched = rooms.map((r) => {
    const x = onLevel.find((o) => !used.has(o.id) && fromOutline(o, r));
    if (!x || !(sameName(x, r) || Math.abs(x.areaM2 - r.areaM2) <= 0.02 * x.areaM2)) return undefined;
    used.add(x.id);
    return x;
  });
  const proposals = rooms.map((r, i): RoomProposal => {
    let existing = matched[i];
    if (!existing) {
      existing = onLevel.find((x) => !used.has(x.id) && sameName(x, r));
      if (existing) used.add(existing.id);
    }
    const type = existing?.type ?? guessRoomType(r.name, types, project.cadRoomTypes);
    const status = !existing ? 'new' : Math.abs(existing.areaM2 - r.areaM2) < 0.05 && sameName(existing, r) ? 'same' : 'changed';
    return {
      key: `${i}:${r.name}`, name: r.name, ...(r.number ? { number: r.number } : {}), areaM2: r.areaM2, type, existingId: existing?.id, currentAreaM2: existing?.areaM2, status,
      ...(r.handle && r.file ? { source: { app: 'cad' as const, file: r.file, sourceId: r.handle } } : {}), ...(r.outline ? { outline: r.outline } : {})
    };
  });
  return { proposals, notOnPlan: onLevel.filter((r) => !used.has(r.id)) };
}

/** Writes the accepted rooms to Building information (areas of matching rooms, names of rooms found by their outline,
 * new rooms added) with the outline each came from, and remembers the layer map and the room types chosen per name.
 * `unchanged` rows (status "same") only have their outline recorded, so the next revision can find them. */
export function applyRooms(project: Project, accepted: RoomProposal[], buildingId: string, levelId: string, layers: CadLayerMap[], unchanged: RoomProposal[] = []): Project {
  const info = buildingInfoOf(project);
  const types = roomTypesOf(info);
  let rooms = [...info.rooms];
  const drawn = (p: RoomProposal) => ({ ...(p.source ? { source: p.source } : {}), ...(p.outline ? { outline: p.outline } : {}) });
  for (const u of unchanged) if (u.existingId && (u.source || u.outline)) rooms = rooms.map((r) => (r.id === u.existingId ? { ...r, ...drawn(u) } : r));
  for (const a of accepted) {
    const type = a.type ?? types[0]?.id ?? 'office';
    const source = drawn(a);
    if (a.existingId) {
      rooms = rooms.map((r) => (r.id === a.existingId ? { ...r, name: r.name.toLowerCase() === a.name.toLowerCase() ? r.name : a.name, areaM2: a.areaM2, type, ...source } : r));
    } else {
      rooms.push({ id: nextRoomId(rooms), buildingId, levelId, name: a.name, type, areaM2: a.areaM2, ...source });
    }
  }
  const chosen = accepted.filter((a) => a.type).map((a) => ({ name: a.name, type: a.type! }));
  const remembered = [...(project.cadRoomTypes ?? []).filter((r) => !chosen.some((c) => c.name.toLowerCase() === r.name.toLowerCase())), ...chosen];
  return { ...withLayerMap(project, layers), building: { ...info, rooms }, ...(remembered.length ? { cadRoomTypes: remembered } : {}) };
}
