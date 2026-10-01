import type { Board, BuildingInfo, BuildingLevel, Feeder, LoadType, MeterType, PointType, Project, ProjectBuilding, RoomRules, RoomType } from '../types';
import { buildingInfoOf, roomTypesOf, summarizeBuilding } from './building';
import { addCircuit, balancePhases, updateCircuit } from '../model/schedule';
import { applyRecommendation, recommend } from './sizing';
import { boardTotals } from './summary';
import { circuitWatts, pointWattsFor, scheduleCircuits } from './loadSchedule';
import { rule } from '../database/catalog';

/** Building → design: DBs and load schedules generated from the rooms and
 * the flats on each floor, incomer lengths from the riser, common services,
 * load density against benchmarks, and the building summary. */

/** PLACEHOLDER rules — typical starting values, not authority figures. */
export const DEFAULT_RULES: Record<string, RoomRules & { lpdMax?: number; benchWPerM2?: number }> = {
  apartment: { ltgM2PerPoint: 8, s13M2PerPoint: 10, acM2PerUnit: 30, acKwPerUnit: 2.5, wh: 1, cooker: 1, exfan: 2, lpdMax: 6, benchWPerM2: 170 },
  villa: { ltgM2PerPoint: 8, s13M2PerPoint: 10, acM2PerUnit: 25, acKwPerUnit: 2.5, wh: 3, cooker: 1, exfan: 3, lpdMax: 6, benchWPerM2: 150 },
  office: { ltgM2PerPoint: 9, s13M2PerPoint: 10, acM2PerUnit: 25, acKwPerUnit: 3.5, lpdMax: 7, benchWPerM2: 160 },
  retail: { ltgM2PerPoint: 6, s13M2PerPoint: 20, acM2PerUnit: 25, acKwPerUnit: 3.5, lpdMax: 11, benchWPerM2: 160 },
  fnb: { ltgM2PerPoint: 7, s13M2PerPoint: 8, acM2PerUnit: 20, acKwPerUnit: 3.5, exfan: 2, lpdMax: 9, benchWPerM2: 200 },
  hotel: { ltgM2PerPoint: 6, s13M2PerPoint: 8, acM2PerUnit: 30, acKwPerUnit: 2.5, wh: 1, exfan: 1, lpdMax: 7, benchWPerM2: 170 },
  lobby: { ltgM2PerPoint: 10, s13M2PerPoint: 40, acM2PerUnit: 40, acKwPerUnit: 3.5, lpdMax: 9, benchWPerM2: 100 },
  toilet: { ltgM2PerPoint: 6, s13M2PerPoint: 15, exfan: 1, lpdMax: 7, benchWPerM2: 30 },
  gym: { ltgM2PerPoint: 8, s13M2PerPoint: 10, acM2PerUnit: 20, acKwPerUnit: 3.5, lpdMax: 8, benchWPerM2: 200 },
  parking: { ltgM2PerPoint: 40, s13M2PerPoint: 400, lpdMax: 2, benchWPerM2: 2 },
  plant: { ltgM2PerPoint: 10, s13M2PerPoint: 20, lpdMax: 6, benchWPerM2: 16 },
  store: { ltgM2PerPoint: 15, s13M2PerPoint: 30, lpdMax: 4, benchWPerM2: 11 },
  living: { ltgM2PerPoint: 8, s13M2PerPoint: 8, acM2PerUnit: 20, acKwPerUnit: 2.5, lpdMax: 6, benchWPerM2: 170 },
  bedroom: { ltgM2PerPoint: 8, s13M2PerPoint: 8, acM2PerUnit: 20, acKwPerUnit: 2, lpdMax: 6, benchWPerM2: 155 },
  kitchen: { ltgM2PerPoint: 6, s13M2PerPoint: 4, cooker: 1, exfan: 1, lpdMax: 8, benchWPerM2: 370 },
  bathroom: { ltgM2PerPoint: 5, exfan: 1, wh: 1, lpdMax: 10, benchWPerM2: 320 }
};
const GENERIC: RoomRules = { ltgM2PerPoint: 10, s13M2PerPoint: 12 };
export const rulesOf = (t?: RoomType): RoomRules => t?.rules ?? (t && DEFAULT_RULES[t.id]) ?? GENERIC;
export const lpdOf = (t?: RoomType): number | undefined => t?.lpdMax ?? (t ? DEFAULT_RULES[t.id]?.lpdMax : undefined);
/** Typical total W/m² of a room type (benchmark for the density check). */
export const benchOf = (t?: RoomType): number | undefined => t?.benchWPerM2 ?? (t ? DEFAULT_RULES[t.id]?.benchWPerM2 : undefined) ?? t?.wPerM2;

/** PLACEHOLDER watts per point on generated DBs (edit on the load schedule). */
/** Watts per point on generated DBs: Rules.xlsx, else these placeholders. */
export const genPointWatts = (): Partial<Record<PointType, number>> => ({ ltg: rule('wattsLtg'), exfan: rule('wattsExfan'), s13: rule('wattsS13'), wh: rule('wattsWh'), cooker: rule('wattsCooker'), sac: 2500 });
const maxPerCircuit = (): Partial<Record<PointType, number>> => ({ ltg: rule('maxLtgPerCircuit'), s13: rule('maxS13PerCircuit') });

/** Every floor of the building, bottom to top, with a short tag (B2, B1, G, L1… R). */
export interface FloorInstance { level: BuildingLevel; index: number; tag: string; name: string; elevationM: number }
export function floorsOf(info: BuildingInfo, b: ProjectBuilding): FloorInstance[] {
  const sum = summarizeBuilding(info, b);
  const out: FloorInstance[] = [];
  const basements = sum.levels.filter((l) => l.level.kind === 'basement').reduce((s, l) => s + l.count, 0);
  let bIdx = basements, upper = 0, podium = 0, mezz = 0;
  for (const li of sum.levels) {
    for (let k = 0; k < li.count; k++) {
      const l = li.level;
      let tag: string;
      if (l.kind === 'basement') tag = `B${bIdx--}`;
      else if (l.kind === 'ground') tag = 'G';
      else if (l.kind === 'roof') tag = 'R';
      else if (l.kind === 'podium') tag = `P${++podium}`;
      else if (l.kind === 'other') tag = `M${++mezz}`;
      else tag = `L${String(++upper).padStart(2, '0')}`;
      out.push({ level: l, index: k, tag, name: li.count > 1 ? `${l.name} (${tag})` : l.name, elevationM: li.elevationM + k * l.heightM });
    }
  }
  return out;
}

const meterFor = (kw: number): MeterType => (kw <= rule('meter1PhMaxKw') ? '1-PH' : kw <= rule('meter3PhMaxKw') ? '3-PH' : 'CT');

/** Incomer cable length from the riser: horizontal run at the source, up or
 * down the riser to the floor, and across to the DB. */
export function incomerLengthM(b: ProjectBuilding, elevationM: number): number {
  return Math.max(5, Math.round((b.riser?.horizontalM ?? 15) + Math.abs(elevationM) + (b.riser?.perDbM ?? 10)));
}

interface RoomSpec { key: string; name: string; type?: RoomType; areaM2: number }
interface DbSpec { id: string; name: string; location: string; floor: FloorInstance; rooms: RoomSpec[]; meter?: MeterType; unit?: string }

/** The DBs the building would get: a common DB per floor for its rooms (not
 * already served by a DB you chose), and a DB per flat. */
export function plannedDbs(project: Project, buildingId: string): DbSpec[] {
  const info = buildingInfoOf(project);
  const b = info.buildings.find((x) => x.id === buildingId);
  if (!b) return [];
  const types = roomTypesOf(info);
  const prefix = info.buildings.length > 1 ? `${b.id}-` : '';
  const out: DbSpec[] = [];
  for (const fl of floorsOf(info, b)) {
    const rooms = info.rooms.filter((r) => r.buildingId === b.id && r.levelId === fl.level.id && !r.boardId);
    const specs: RoomSpec[] = rooms.flatMap((r) => Array.from({ length: Math.max(1, Math.round(r.count ?? 1)) }, (_, i) => ({
      key: `room:${r.id}:${i + 1}`, name: (r.count ?? 1) > 1 ? `${r.name} ${i + 1}` : r.name, type: types.find((t) => t.id === r.type), areaM2: r.areaM2
    })));
    if (specs.length) out.push({ id: `DB-${prefix}${fl.tag}`, name: `${fl.name} common DB`, location: `${b.name} — ${fl.name}`, floor: fl, rooms: specs });
    let n = 0;
    for (const u of fl.level.units ?? []) {
      const ut = info.unitTypes?.find((x) => x.id === u.unitTypeId);
      if (!ut) continue;
      for (let k = 0; k < Math.max(0, Math.round(u.count)); k++) {
        const no = String(++n).padStart(2, '0');
        out.push({
          id: `DB-${prefix}${fl.tag}-${no}`, name: `${ut.name} ${fl.tag}-${no}`, location: `${b.name} — ${fl.name}, unit ${fl.tag}-${no}`, floor: fl, unit: `${fl.tag}-${no}`, meter: ut.meter,
          rooms: ut.rooms.map((r, i) => ({ key: `unit:${fl.tag}-${no}:${i}`, name: r.name, type: types.find((t) => t.id === r.type), areaM2: r.areaM2 }))
        });
      }
    }
  }
  return out;
}

/** Circuits for one room: lighting (+ exhaust fans) and 13 A sockets split
 * at the per-circuit maximum, an A/C, water heater and cooker circuit each. */
function roomCircuits(r: RoomSpec): Partial<Record<PointType, number>>[] {
  const rule = rulesOf(r.type);
  const out: Partial<Record<PointType, number>>[] = [];
  const split = (t: PointType, n: number, extra?: Partial<Record<PointType, number>>) => {
    const max = maxPerCircuit()[t] ?? 1;
    for (let left = n, first = true; left > 0; left -= max, first = false) out.push({ [t]: Math.min(max, left), ...(first ? extra : {}) });
  };
  const ltg = rule.ltgM2PerPoint ? Math.max(1, Math.ceil(r.areaM2 / rule.ltgM2PerPoint)) : 0;
  split('ltg', ltg, rule.exfan ? { exfan: rule.exfan } : undefined);
  if (!ltg && rule.exfan) out.push({ exfan: rule.exfan });
  if (rule.s13M2PerPoint) split('s13', Math.max(1, Math.ceil(r.areaM2 / rule.s13M2PerPoint)));
  if (rule.acM2PerUnit) for (let i = 0; i < Math.max(1, Math.ceil(r.areaM2 / rule.acM2PerUnit)); i++) out.push({ sac: 1 });
  for (let i = 0; i < (rule.wh ?? 0); i++) out.push({ wh: 1 });
  for (let i = 0; i < (rule.cooker ?? 0); i++) out.push({ cooker: 1 });
  return out;
}

export interface GenerateResult { project: Project; dbs: string[]; circuits: number; replaced: number }

/** Creates (or refreshes) the planned DBs: board, incomer from the riser's
 * source board with its length and meter, and the load schedule. Circuits
 * made earlier by this command are replaced; your own are kept. */
export function generateBuildingDbs(project: Project, buildingId: string, sourceBoardId: string): GenerateResult {
  const info = buildingInfoOf(project);
  const b = info.buildings.find((x) => x.id === buildingId);
  if (!b || !project.boards.some((x) => x.id === sourceBoardId)) return { project, dbs: [], circuits: 0, replaced: 0 };
  let p = project;
  let circuits = 0, replaced = 0;
  const dbs: string[] = [];
  for (const spec of plannedDbs(project, buildingId)) {
    const exists = p.boards.find((x) => x.id === spec.id);
    const acKw = Math.max(0, ...spec.rooms.map((r) => rulesOf(r.type).acKwPerUnit ?? 0)) || 2.5;
    const watts = { ...genPointWatts(), sac: acKw * 1000, ...exists?.pointWatts };
    const board: Board = { ...(exists ?? { id: spec.id, name: spec.name, kind: 'DB', upstreamId: sourceBoardId }), location: spec.location, pointWatts: watts, generated: `${b.id}:${spec.unit ?? spec.floor.tag}` };
    if (!exists) {
      p = { ...p, boards: [...p.boards, board] };
    } else {
      p = { ...p, boards: p.boards.map((x) => (x.id === spec.id ? board : x)) };
      const old = p.feeders.filter((f) => f.boardId === spec.id && f.fromRoom).length;
      replaced += old;
      p = { ...p, feeders: p.feeders.filter((f) => !(f.boardId === spec.id && f.fromRoom)) };
    }
    for (const r of spec.rooms) {
      for (const pts of roomCircuits(r)) {
        const a = addCircuit(p, spec.id);
        p = updateCircuit(a.project, a.id, { room: r.name, points: pts });
        p = { ...p, feeders: p.feeders.map((f) => (f.id === a.id ? { ...f, fromRoom: r.key } : f)) };
        circuits++;
      }
    }
    p = balancePhases(p, spec.id);
    // fromRoom survives the renumbering (ids change, fields are kept).
    // Incomer: from the source board, length from the riser, a meter for flats.
    const upstream = p.boards.find((x) => x.id === spec.id)!.upstreamId ?? sourceBoardId;
    let inc = p.feeders.find((f) => f.feedsBoardId === spec.id);
    const kw = boardTotals(p, spec.id).connectedKw;
    const lengthM = incomerLengthM(b, spec.floor.elevationM);
    if (!inc) {
      inc = { id: `INC-${spec.id}`, boardId: upstream, feedsBoardId: spec.id, name: spec.name, loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM, cableCsaMm2: 10, cores: 4, breakerRatingA: 63, breakerIcuKa: 25, fromRoom: `db:${spec.id}` };
      p = { ...p, feeders: [...p.feeders, inc] };
    }
    const next: Feeder = { ...inc, lengthM: inc.fromRoom ? lengthM : inc.lengthM, kwhMeter: spec.unit ? spec.meter ?? meterFor(kw) : inc.kwhMeter };
    const tmp = { ...p, feeders: p.feeders.map((f) => (f.id === inc!.id ? next : f)) };
    const sized = next.manualSize ? next : applyRecommendation(next, recommend(tmp, next, 'optimise'));
    p = { ...tmp, feeders: tmp.feeders.map((f) => (f.id === inc!.id ? sized : f)) };
    dbs.push(spec.id);
  }
  return { project: p, dbs, circuits, replaced };
}

/** Re-applies the riser lengths to the incomers of generated DBs. */
export function applyRiserLengths(project: Project, buildingId: string): { project: Project; changed: number } {
  const info = buildingInfoOf(project);
  const b = info.buildings.find((x) => x.id === buildingId);
  if (!b) return { project, changed: 0 };
  const at = new Map(plannedDbs(project, buildingId).map((d) => [d.id, d.floor.elevationM]));
  let changed = 0;
  const feeders = project.feeders.map((f) => {
    if (!f.feedsBoardId || !at.has(f.feedsBoardId) || f.manualSize) return f;
    const lengthM = incomerLengthM(b, at.get(f.feedsBoardId)!);
    if (lengthM === f.lengthM) return f;
    changed++;
    return { ...f, lengthM };
  });
  return { project: { ...project, feeders }, changed };
}

// ---- Common area services -------------------------------------------------

export interface ServiceItem { id: string; label: string; kw: number; qty: number; loadType: LoadType; essential?: boolean; standby?: number /* units on standby */ }

/** PLACEHOLDER kW — typical values to start from; edit before adding. */
export function defaultServices(project: Project, buildingId: string): ServiceItem[] {
  const info = buildingInfoOf(project);
  const b = info.buildings.find((x) => x.id === buildingId);
  const sum = b ? summarizeBuilding(info, b) : undefined;
  const parkingM2 = info.rooms.filter((r) => r.buildingId === buildingId && r.type === 'parking').reduce((s, r) => s + r.areaM2 * (r.count ?? 1), 0);
  const floors = sum?.aboveGround ?? 1;
  const lifts = floors > 12 ? 3 : floors > 4 ? 2 : floors > 2 ? 1 : 0;
  return [
    { id: 'lift', label: 'Lift', kw: floors > 12 ? 22 : 15, qty: lifts, loadType: 'motor', essential: true },
    { id: 'booster', label: 'Booster pump set', kw: 7.5, qty: 2, loadType: 'motor', standby: 1 },
    { id: 'transfer', label: 'Water transfer pump', kw: 5.5, qty: 2, loadType: 'motor', standby: 1 },
    { id: 'fire', label: 'Fire pump (electric)', kw: 55, qty: floors > 4 ? 1 : 0, loadType: 'fire-pump', essential: true },
    { id: 'jockey', label: 'Jockey pump', kw: 3, qty: floors > 4 ? 1 : 0, loadType: 'motor', essential: true },
    { id: 'carpark', label: 'Car park ventilation fans', kw: parkingM2 ? Math.max(5.5, Math.round(parkingM2 * 0.006 * 10) / 10) : 11, qty: parkingM2 ? 1 : 0, loadType: 'motor', essential: true },
    { id: 'stair', label: 'Stair pressurisation fan', kw: 7.5, qty: floors > 4 ? 1 : 0, loadType: 'motor', essential: true },
    { id: 'facade', label: 'Façade lighting', kw: 10, qty: 0, loadType: 'lighting' },
    { id: 'external', label: 'External / landscape lighting', kw: 5, qty: 1, loadType: 'lighting' },
    { id: 'ev', label: 'EV charger 7.4 kW', kw: 7.4, qty: 0, loadType: 'ev' },
    { id: 'pool', label: 'Swimming pool plant', kw: 15, qty: 0, loadType: 'motor' },
    { id: 'irrigation', label: 'Irrigation pump', kw: 3, qty: 0, loadType: 'motor' },
    { id: 'elv', label: 'ELV / BMS / security', kw: 3, qty: 1, loadType: 'it', essential: true },
    { id: 'kitchen-exh', label: 'Kitchen exhaust fan', kw: 5.5, qty: 0, loadType: 'motor' }
  ];
}

/** Adds the services as feeders on a board (one per unit; standby units marked). */
export function addServices(project: Project, boardId: string, items: ServiceItem[]): { project: Project; added: number } {
  let p = project;
  let added = 0;
  for (const it of items) {
    for (let k = 0; k < it.qty; k++) {
      let n = 1;
      while (p.feeders.some((f) => f.id === `${boardId}-${it.id.toUpperCase()}${n}`)) n++;
      const f: Feeder = {
        id: `${boardId}-${it.id.toUpperCase()}${n}`, boardId, name: it.qty > 1 ? `${it.label} ${k + 1}` : it.label, loadKw: it.kw, demandFactor: 1,
        powerFactor: it.loadType === 'lighting' ? 0.9 : 0.85, lengthM: 40, cableCsaMm2: 6, cores: 4, breakerRatingA: 32, breakerIcuKa: 25,
        loadType: it.loadType, essential: it.essential || undefined, standbyUnit: it.standby && k >= it.qty - it.standby ? true : undefined,
        localIsolator: it.loadType === 'motor' || it.loadType === 'fire-pump' ? true : undefined
      };
      const tmp = { ...p, feeders: [...p.feeders, f] };
      p = { ...tmp, feeders: tmp.feeders.map((x) => (x.id === f.id ? applyRecommendation(f, recommend(tmp, f, 'optimise')) : x)) };
      added++;
    }
  }
  return { project: p, added };
}

// ---- Load density -----------------------------------------------------------

export interface RoomDensity {
  key: string; name: string; floor: string; db: string; type?: RoomType; areaM2: number;
  lightingW: number; powerW: number; acW: number; totalW: number;
  lpd: number; lpdMax?: number; wPerM2: number; expectedWPerM2?: number;
  status: 'ok' | 'warn';
  note?: string;
}

/** Each generated room's W/m² from its circuits: lighting against the LPD
 * limit, total against its room type (½× to 1.5×). */
export function roomDensities(project: Project, buildingId: string): RoomDensity[] {
  const specs = plannedDbs(project, buildingId);
  const out: RoomDensity[] = [];
  for (const d of specs) {
    const board = project.boards.find((b) => b.id === d.id);
    if (!board) continue;
    const w = pointWattsFor(board);
    const circs = scheduleCircuits(project, d.id);
    for (const r of d.rooms) {
      const cs = circs.filter((c) => c.fromRoom === r.key);
      if (!cs.length) continue;
      let lightingW = 0, powerW = 0, acW = 0;
      for (const c of cs) for (const [t, n] of Object.entries(c.points ?? {})) {
        const v = (n ?? 0) * w[t as PointType];
        if (t === 'ltg') lightingW += v; // fans are not lighting power density else if (t === 'sac' || t === 'wac' || t === 'fcu') acW += v; else powerW += v;
      }
      const totalW = cs.reduce((s, c) => s + circuitWatts(c, board), 0);
      const lpd = r.areaM2 ? lightingW / r.areaM2 : 0;
      const lpdMax = lpdOf(r.type);
      const wPerM2 = r.areaM2 ? totalW / r.areaM2 : 0;
      const exp = benchOf(r.type);
      const notes: string[] = [];
      if (lpdMax && lpd > lpdMax) notes.push(`lighting ${lpd.toFixed(1)} W/m² above ${lpdMax}`);
      if (exp && (wPerM2 > exp * 1.5 || wPerM2 < exp * 0.5)) notes.push(`${wPerM2.toFixed(0)} W/m² vs typical ${exp} for ${r.type!.label}`);
      out.push({ key: r.key, name: r.name, floor: d.floor.name, db: d.id, type: r.type, areaM2: r.areaM2, lightingW, powerW, acW, totalW, lpd, lpdMax, wPerM2, expectedWPerM2: exp, status: notes.length ? 'warn' : 'ok', note: notes.join('; ') || undefined });
    }
  }
  return out;
}

/** Load per floor (connected and demand, W/m² of the floor's gross area). */
export interface FloorLoad { floor: FloorInstance; grossM2: number; connectedKw: number; demandKw: number; dbs: string[] }
export function floorLoads(project: Project, buildingId: string): FloorLoad[] {
  const info = buildingInfoOf(project);
  const b = info.buildings.find((x) => x.id === buildingId);
  if (!b) return [];
  const specs = plannedDbs(project, buildingId);
  return floorsOf(info, b).map((fl) => {
    const gen = specs.filter((d) => d.floor.tag === fl.tag).map((d) => d.id).filter((id) => project.boards.some((x) => x.id === id));
    const manual = [...new Set(info.rooms.filter((r) => r.buildingId === b.id && r.levelId === fl.level.id && r.boardId).map((r) => r.boardId!))].filter((id) => project.boards.some((x) => x.id === id));
    // A DB you chose for a typical level's rooms is shared out over its floors.
    const share = 1 / Math.max(1, fl.level.count ?? 1);
    let c = 0, d = 0;
    for (const id of gen) { const x = boardTotals(project, id); c += x.connectedKw; d += x.demandKw; }
    for (const id of manual) { const x = boardTotals(project, id); c += x.connectedKw * share; d += x.demandKw * share; }
    return { floor: fl, grossM2: fl.level.grossM2 ?? 0, connectedKw: c, demandKw: d, dbs: [...gen, ...manual] };
  });
}

/** Flats: DB, meter, connected and demand load of each unit. */
export interface UnitLoad { db: string; unit: string; type: string; floor: string; meter?: MeterType; connectedKw: number; demandKw: number }
export function unitLoads(project: Project, buildingId: string): UnitLoad[] {
  return plannedDbs(project, buildingId).filter((d) => d.unit && project.boards.some((b) => b.id === d.id)).map((d) => {
    const t = boardTotals(project, d.id);
    const inc = project.feeders.find((f) => f.feedsBoardId === d.id);
    return { db: d.id, unit: d.unit!, type: d.name.replace(/ [^ ]+$/, ''), floor: d.floor.name, meter: inc?.kwhMeter, connectedKw: t.connectedKw, demandKw: t.demandKw };
  });
}
