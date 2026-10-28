import { buildingInfoOf, nextRoomId, roomTypesOf } from '../calc/building';
import { guessRoomType } from '../model/cadRooms';
import type { BuildingRoom, Project, ProjectBuilding } from '../types';
import {
  EXCHANGE_SCHEMA, EXCHANGE_VERSION, exchangePackage, hashedText,
  type ExchangePackage, type FixtureItem, type LoadItem, type PackageKind, type PackageSource, type RoomItem, type RoomsPackage
} from './contracts';

/** The review inbox: every package from another program is read, checked and compared with the project, and changes
 * only what the engineer accepts. Rooms are applied to Building information; accepted luminaire and ELV load packages
 * are kept in the project (`exchange.packages`) for the load calculations to use. Every decision is logged with the
 * package's hash, so the same package arriving again is recognised. No reading of files here: callers pass the parsed
 * JSON and a SHA-256 function (Node or Web Crypto). */

export interface PackageIssue { row?: number; field?: string; message: string }

export type ReadResult =
  | { ok: true; pkg: ExchangePackage; hash: string; warnings: PackageIssue[] }
  | { ok: false; errors: PackageIssue[] };

export type ChangeKind = 'added' | 'changed' | 'renamed' | 'removed' | 'same';

export interface Change {
  key: string; // what accept lists name
  kind: ChangeKind;
  label: string;
  before?: string;
  after?: string;
  roomId?: string; // the project room it changes (rooms)
}

export interface Review {
  kind: PackageKind;
  hash: string;
  source: PackageSource;
  counts: Record<ChangeKind, number>;
  changes: Change[];
  problems: PackageIssue[]; // rows that cannot be applied (unknown level, unknown room…)
  seenBefore?: ExchangeRecord;
}

export interface ExchangeRecord {
  id: string; // X-001, X-002 …
  hash: string;
  kind: PackageKind;
  source: PackageSource;
  exportedAt: string;
  at: string;
  by: string;
  decision: 'accepted' | 'partly accepted' | 'rejected';
  accepted: Partial<Record<ChangeKind, number>>;
  offered: number; // changes in the package (same rows not counted)
  note?: string;
}

/** An accepted luminaire or ELV load package: the items in force for one source file. */
export interface AcceptedPackage {
  kind: 'fixtures' | 'loads';
  source: PackageSource;
  hash: string;
  at: string;
  by: string;
  fixtures?: FixtureItem[];
  loads?: LoadItem[];
}

export interface ExchangeState { log: ExchangeRecord[]; packages: AcceptedPackage[] }

const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const sameFile = (a: PackageSource, b: PackageSource) => a.app === b.app && lower(a.file) === lower(b.file);

/** Checks a parsed package against contract version 1: shape, units, duplicates and its own sha256. */
export function readPackage(raw: unknown, sha256: (text: string) => string): ReadResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: [{ message: 'This is not an exchange package (a JSON object is expected).' }] };
  const head = raw as { schema?: unknown; version?: unknown };
  if (head.schema !== EXCHANGE_SCHEMA) return { ok: false, errors: [{ field: 'schema', message: `This is not an LV Design Studio exchange package (schema must be "${EXCHANGE_SCHEMA}").` }] };
  if (head.version !== EXCHANGE_VERSION) {
    const newer = typeof head.version === 'number' && head.version > EXCHANGE_VERSION;
    return { ok: false, errors: [{ field: 'version', message: newer ? `The package uses contract version ${head.version}; this app reads version ${EXCHANGE_VERSION}. Update the app.` : `Unknown contract version ${String(head.version)}; this app reads version ${EXCHANGE_VERSION}.` }] };
  }
  const parsed = exchangePackage.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 200).map((i) => {
        const [first, index, ...rest] = i.path;
        return first === 'items' && typeof index === 'number'
          ? { row: index + 1, ...(rest.length ? { field: rest.join('.') } : {}), message: i.message }
          : { ...(i.path.length ? { field: i.path.join('.') } : {}), message: i.message };
      })
    };
  }
  const pkg = parsed.data;
  const hash = sha256(hashedText(pkg));
  const errors: PackageIssue[] = [];
  if (pkg.sha256 && pkg.sha256 !== hash) errors.push({ field: 'sha256', message: 'The contents do not match the package’s sha256: it was changed after it was exported.' });
  const keys = itemKeys(pkg);
  const first = new Map<string, number>();
  keys.forEach((k, i) => {
    const at = first.get(k);
    if (at === undefined) first.set(k, i + 1);
    else errors.push({ row: i + 1, message: `Duplicate of row ${at} (${k.split('|').join(', ')}).` });
  });
  if (errors.length) return { ok: false, errors };
  const warnings: PackageIssue[] = [];
  if (!pkg.source.file) warnings.push({ field: 'source.file', message: 'No source file name: items removed from the source cannot be recognised.' });
  return { ok: true, pkg, hash, warnings };
}

/** One key per item: two items with the same key are duplicates. */
function itemKeys(pkg: ExchangePackage): string[] {
  if (pkg.kind === 'rooms') return pkg.items.map((r) => r.sourceId);
  if (pkg.kind === 'fixtures') return pkg.items.map((f) => `${f.room}|${f.code}|${f.use}`);
  return pkg.items.map((l) => l.id);
}

export const exchangeOf = (p: Project): ExchangeState => ({ log: p.exchange?.log ?? [], packages: p.exchange?.packages ?? [] });

const tally = (changes: Change[]): Record<ChangeKind, number> => {
  const c: Record<ChangeKind, number> = { added: 0, changed: 0, renamed: 0, removed: 0, same: 0 };
  for (const x of changes) c[x.kind] += 1;
  return c;
};

/** Compares a checked package with the project: what accepting it would add, change, rename or remove. */
export function reviewPackage(project: Project, pkg: ExchangePackage, hash: string): Review {
  const { changes, problems } = pkg.kind === 'rooms' ? roomChanges(project, pkg.items, pkg.source) : itemChanges(project, pkg);
  const seenBefore = [...exchangeOf(project).log].reverse().find((r) => r.hash === hash);
  return { kind: pkg.kind, hash, source: pkg.source, counts: tally(changes), changes, problems, ...(seenBefore ? { seenBefore } : {}) };
}

// ---- rooms ----

interface RoomPlan { item: RoomItem; building: ProjectBuilding; levelId: string; existing?: BuildingRoom; type: string }

function findLevel(project: Project, item: RoomItem): { building?: ProjectBuilding; levelId?: string } {
  const info = buildingInfoOf(project);
  const building = info.buildings.find((b) => b.id === item.building) ?? info.buildings.find((b) => lower(b.name) === lower(item.building));
  const level = building?.levels.find((l) => l.id === item.level) ?? building?.levels.find((l) => lower(l.name) === lower(item.level));
  return { building, levelId: level?.id };
}

/** Rooms of the package matched to the project's rooms: by source (same program, file and ID) anywhere in the
 * project, else by name on the same level. */
function roomPlans(project: Project, items: RoomItem[], source: PackageSource): { plans: (RoomPlan | undefined)[]; problems: PackageIssue[]; matched: Set<string> } {
  const info = buildingInfoOf(project);
  const types = roomTypesOf(info);
  const problems: PackageIssue[] = [];
  const used = new Set<string>();
  const app = source.app === 'cad' || source.app === 'ifc' ? source.app : undefined;
  if (!app) return { plans: [], problems: [{ field: 'source.app', message: `Rooms are imported from CAD or IFC; this package was written by "${source.app}".` }], matched: used };
  const located = items.map((item, i) => {
    const { building, levelId } = findLevel(project, item);
    if (!building) problems.push({ row: i + 1, field: 'building', message: `No building "${item.building}" in the project.` });
    else if (!levelId) problems.push({ row: i + 1, field: 'level', message: `No level "${item.level}" in ${building.name}.` });
    return building && levelId ? { item, building, levelId } : undefined;
  });
  const bySource = located.map((x) => {
    if (!x) return undefined;
    const hit = info.rooms.find((r) => !used.has(r.id) && r.source?.app === app && lower(r.source.file) === lower(source.file) && r.source.sourceId === x.item.sourceId);
    if (hit) used.add(hit.id);
    return hit;
  });
  const plans = located.map((x, i): RoomPlan | undefined => {
    if (!x) return undefined;
    let existing = bySource[i];
    if (!existing) {
      existing = info.rooms.find((r) => !used.has(r.id) && r.buildingId === x.building.id && r.levelId === x.levelId && lower(r.name) === lower(x.item.name) && (!r.source || r.source.app !== app || lower(r.source.file) !== lower(source.file)));
      if (existing) used.add(existing.id);
    }
    const named = x.item.type ? types.find((t) => t.id === x.item.type) ?? types.find((t) => lower(t.label) === lower(x.item.type)) : undefined;
    if (x.item.type && !named) problems.push({ row: i + 1, field: 'type', message: `Room type "${x.item.type}" is not in the project; ${existing ? 'its current type is kept' : 'the type is guessed from the name'}.` });
    const type = named?.id ?? existing?.type ?? guessRoomType(x.item.name, types, project.cadRoomTypes) ?? types[0]?.id ?? 'office';
    return { ...x, existing, type };
  });
  return { plans, problems, matched: used };
}

const roomLabel = (r: { name: string; areaM2?: number; netAreaM2?: number }) => `${r.name}, ${Math.round((r.areaM2 ?? r.netAreaM2 ?? 0) * 100) / 100} m²`;

function roomChanges(project: Project, items: RoomItem[], source: PackageSource): { changes: Change[]; problems: PackageIssue[] } {
  const { plans, problems, matched } = roomPlans(project, items, source);
  const changes: Change[] = [];
  plans.forEach((p) => {
    if (!p) return;
    const key = `room:${p.item.sourceId}`;
    const after = roomLabel(p.item);
    if (!p.existing) { changes.push({ key, kind: 'added', label: p.item.name, after }); return; }
    const e = p.existing;
    const moved = e.buildingId !== p.building.id || e.levelId !== p.levelId;
    const differs = moved || Math.abs(e.areaM2 - p.item.netAreaM2) >= 0.05 || e.type !== p.type || (e.count ?? 1) !== (p.item.count ?? 1);
    const kind: ChangeKind = lower(e.name) !== lower(p.item.name) ? 'renamed' : differs ? 'changed' : 'same';
    changes.push({ key, kind, label: e.name, before: roomLabel(e), after, roomId: e.id });
  });
  // Rooms read from this same file before and no longer in it.
  if (source.file && (source.app === 'cad' || source.app === 'ifc')) {
    for (const r of buildingInfoOf(project).rooms) {
      if (matched.has(r.id) || r.source?.app !== source.app || lower(r.source.file) !== lower(source.file)) continue;
      changes.push({ key: `remove:${r.id}`, kind: 'removed', label: r.name, before: roomLabel(r), roomId: r.id });
    }
  }
  return { changes, problems };
}

// ---- luminaires and ELV loads ----

type ItemPackage = Extract<ExchangePackage, { kind: 'fixtures' | 'loads' }>;

/** A room reference (project room ID, or the source ID of an imported room) → the project room ID. */
function roomResolver(project: Project): (ref: string) => string | undefined {
  const rooms = buildingInfoOf(project).rooms;
  return (ref) => rooms.find((r) => r.id === ref)?.id ?? rooms.find((r) => r.source?.sourceId === ref)?.id;
}

const fixtureKey = (f: FixtureItem, room: string) => `fixture:${room}|${f.code}|${f.use}`;
const fixtureLabel = (f: FixtureItem) => `${f.quantity} × ${f.code} @ ${f.inputW} W${f.use === 'emergency' ? ' (emergency)' : ''}`;
const loadLabel = (l: LoadItem) => `${l.equipment}: ${l.kW} kW, ${l.supply}`;

/** The items of a package with resolved room IDs (rows naming an unknown room are problems). */
function resolvedItems(project: Project, pkg: ItemPackage): { items: Map<string, { item: FixtureItem | LoadItem; label: string; room?: string }>; problems: PackageIssue[] } {
  const resolve = roomResolver(project);
  const problems: PackageIssue[] = [];
  const items = new Map<string, { item: FixtureItem | LoadItem; label: string; room?: string }>();
  if (pkg.kind === 'fixtures') {
    pkg.items.forEach((f, i) => {
      const room = resolve(f.room);
      if (!room) problems.push({ row: i + 1, field: 'room', message: `No room "${f.room}" in the project (import the rooms first).` });
      else items.set(fixtureKey(f, room), { item: { ...f, room }, label: fixtureLabel(f), room });
    });
  } else {
    pkg.items.forEach((l, i) => {
      const rooms = (l.rooms ?? []).map((ref) => ({ ref, id: resolve(ref) }));
      const unknown = rooms.filter((x) => !x.id).map((x) => x.ref);
      if (unknown.length) problems.push({ row: i + 1, field: 'rooms', message: `No room ${unknown.map((u) => `"${u}"`).join(', ')} in the project.` });
      else items.set(`load:${l.id}`, { item: { ...l, ...(l.rooms ? { rooms: rooms.map((x) => x.id!) } : {}) }, label: loadLabel(l) });
    });
  }
  return { items, problems };
}

function acceptedFor(project: Project, kind: 'fixtures' | 'loads', source: PackageSource): AcceptedPackage | undefined {
  return exchangeOf(project).packages.find((a) => a.kind === kind && sameFile(a.source, source));
}

function previousItems(project: Project, pkg: ItemPackage): Map<string, { item: FixtureItem | LoadItem; label: string }> {
  const prev = acceptedFor(project, pkg.kind, pkg.source);
  const out = new Map<string, { item: FixtureItem | LoadItem; label: string }>();
  for (const f of prev?.fixtures ?? []) out.set(fixtureKey(f, f.room), { item: f, label: fixtureLabel(f) });
  for (const l of prev?.loads ?? []) out.set(`load:${l.id}`, { item: l, label: loadLabel(l) });
  return out;
}

function itemChanges(project: Project, pkg: ItemPackage): { changes: Change[]; problems: PackageIssue[] } {
  const { items, problems } = resolvedItems(project, pkg);
  const prev = previousItems(project, pkg);
  const changes: Change[] = [];
  for (const [key, x] of items) {
    const old = prev.get(key);
    const label = 'room' in x.item ? `${x.item.code} in ${x.item.room}` : `${x.item.id} (${x.item.system})`;
    if (!old) changes.push({ key, kind: 'added', label, after: x.label });
    else changes.push({ key, kind: JSON.stringify(old.item) === JSON.stringify(x.item) ? 'same' : 'changed', label, before: old.label, after: x.label });
  }
  for (const [key, old] of prev) {
    if (items.has(key)) continue;
    changes.push({ key, kind: 'removed', label: 'room' in old.item ? `${old.item.code} in ${old.item.room}` : `${old.item.id} (${old.item.system})`, before: old.label });
  }
  return { changes, problems };
}

// ---- decision ----

export interface Decision {
  /** 'all' accepts every change; a list accepts the changes with those keys; [] rejects the package. */
  accept: 'all' | string[];
  by: string;
  at: string; // ISO date-time
  note?: string;
}

/** Applies what the engineer accepted and logs the decision. Changes not accepted are left as they are. */
export function decide(project: Project, pkg: ExchangePackage, hash: string, d: Decision): { project: Project; record: ExchangeRecord; review: Review } {
  const by = d.by.trim();
  if (by.length < 2) throw new Error('A decision needs the name of the engineer who made it.');
  const review = reviewPackage(project, pkg, hash);
  const offered = review.changes.filter((c) => c.kind !== 'same');
  const keys = d.accept === 'all' ? new Set(offered.map((c) => c.key)) : new Set(d.accept);
  const unknown = [...keys].filter((k) => !offered.some((c) => c.key === k));
  if (unknown.length) throw new Error(`Not a change in this package: ${unknown.slice(0, 10).join(', ')}.`);
  const accepted = offered.filter((c) => keys.has(c.key));
  let next = project;
  if (pkg.kind === 'rooms') next = applyRooms(project, pkg.items, pkg.source, review, keys);
  else if (accepted.length) next = storeItems(project, pkg, hash, keys, by, d.at);
  const state = exchangeOf(next);
  const counts: Partial<Record<ChangeKind, number>> = {};
  for (const c of accepted) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  const record: ExchangeRecord = {
    id: `X-${String(state.log.length + 1).padStart(3, '0')}`, hash, kind: pkg.kind, source: pkg.source, exportedAt: pkg.exportedAt, at: d.at, by,
    decision: !accepted.length ? 'rejected' : accepted.length === offered.length ? 'accepted' : 'partly accepted',
    accepted: counts, offered: offered.length, ...(d.note?.trim() ? { note: d.note.trim() } : {})
  };
  return { project: { ...next, exchange: { ...state, log: [...state.log, record] } }, record, review };
}

function applyRooms(project: Project, items: RoomItem[], source: PackageSource, review: Review, keys: Set<string>): Project {
  const info = buildingInfoOf(project);
  const { plans } = roomPlans(project, items, source);
  const app = source.app as 'cad' | 'ifc';
  const kindOf = new Map(review.changes.map((c) => [c.key, c.kind]));
  let rooms = [...info.rooms];
  for (const p of plans) {
    if (!p) continue;
    const key = `room:${p.item.sourceId}`;
    const linked = { app, ...(source.file ? { file: source.file } : {}), sourceId: p.item.sourceId, ...(source.revision ? { revision: source.revision } : {}) };
    const fields = { buildingId: p.building.id, levelId: p.levelId, name: p.item.name, type: p.type, areaM2: p.item.netAreaM2, count: p.item.count && p.item.count > 1 ? p.item.count : undefined, source: linked } satisfies Partial<BuildingRoom>;
    if (!p.existing) {
      if (keys.has(key)) rooms.push({ id: nextRoomId(rooms), ...fields });
    } else if (keys.has(key)) {
      rooms = rooms.map((r) => (r.id === p.existing!.id ? { ...r, ...fields } : r));
    } else if (kindOf.get(key) === 'same') {
      rooms = rooms.map((r) => (r.id === p.existing!.id ? { ...r, source: linked } : r)); // only the link is recorded
    }
  }
  const removed = new Set(review.changes.filter((c) => c.kind === 'removed' && keys.has(c.key)).map((c) => c.roomId));
  rooms = rooms.filter((r) => !removed.has(r.id));
  return { ...project, building: { ...info, rooms } };
}

function storeItems(project: Project, pkg: ItemPackage, hash: string, keys: Set<string>, by: string, at: string): Project {
  const { items } = resolvedItems(project, pkg);
  const prev = previousItems(project, pkg);
  // Accepted changes take the package's version; everything else stays as accepted before.
  const kept = new Map<string, FixtureItem | LoadItem>();
  for (const [key, x] of prev) if (!keys.has(key)) kept.set(key, x.item);
  for (const [key, x] of items) if (keys.has(key)) kept.set(key, x.item);
  const list = [...kept.values()];
  const entry: AcceptedPackage = { kind: pkg.kind, source: pkg.source, hash, at, by, ...(pkg.kind === 'fixtures' ? { fixtures: list as FixtureItem[] } : { loads: list as LoadItem[] }) };
  const state = exchangeOf(project);
  return { ...project, exchange: { ...state, packages: [...state.packages.filter((a) => !(a.kind === pkg.kind && sameFile(a.source, pkg.source))), entry] } };
}

// ---- export ----

/** The project's rooms as a rooms package for another program (ELV): source IDs are the project's room IDs. */
export function roomsExport(project: Project, exportedAt: string, sha256: (text: string) => string, file?: string): RoomsPackage {
  const info = buildingInfoOf(project);
  const items: RoomItem[] = info.rooms.flatMap((r) => {
    const b = info.buildings.find((x) => x.id === r.buildingId);
    const level = b?.levels.find((l) => l.id === r.levelId);
    if (!b || !level || !(r.areaM2 > 0)) return [];
    return [{ sourceId: r.id, building: b.name, level: level.name, name: r.name, type: r.type, netAreaM2: r.areaM2, ...(r.count && r.count > 1 ? { count: r.count } : {}) }];
  });
  if (!items.length) throw new Error('The project has no rooms with an area to export (Building information).');
  const pkg = {
    schema: EXCHANGE_SCHEMA, version: EXCHANGE_VERSION, kind: 'rooms' as const,
    project: { ...(project.id ? { id: project.id } : {}), name: project.name },
    source: { app: 'lvds' as const, ...(file ? { file } : {}) }, exportedAt, items
  };
  return { ...pkg, sha256: sha256(hashedText(pkg)) };
}

/** The link a circuit keeps to its load: program, file and load ID. */
export const elvLink = (source: PackageSource, id: string) => `${source.app}:${source.file ?? ''}#${id}`;

/** The accepted ELV loads, each with its link. */
export function acceptedElvLoads(project: Project): { link: string; load: LoadItem }[] {
  return exchangeOf(project).packages.filter((a) => a.kind === 'loads').flatMap((a) => (a.loads ?? []).map((load) => ({ link: elvLink(a.source, load.id), load })));
}
