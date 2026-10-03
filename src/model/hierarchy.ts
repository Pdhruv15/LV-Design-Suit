import type { Board, BoardKind, Feeder, Project } from '../types';
import { floorList, type Floor } from './levels';
import { incomerLengthM } from '../calc/buildingDesign';

/** Build panel hierarchy: plan many panels at once from the building's floors
 * (Building information) — MDBs, SMDBs per floor, DBs under each SMDB — with
 * their incomers. Structure only: incomer cables and breakers are placeholders
 * marked sizingPending until sized; MDB supplies are left to assign.
 *
 * Names: type – level – number, the number only when the level has more than
 * one of that type: SMDB-GF, SMDB-L1, SMDB-L2-01, SMDB-L2-02, DB-L3-01 …
 * Level references: G → GF, L01 → L1, R → RF; B2, P1, M1 as they are. */

export interface HierarchySpec {
  buildingId: string;
  /** Floors to fill (Floor.key); default every floor of the building. */
  floors?: string[];
  /** Existing main boards to feed from, or new MDBs to create (MDB, or MDB-01 … when more than one). */
  mdbs: { existing: string[] } | { create: number };
  /** Which MDB (index into the MDB list) feeds each floor; default: floors split evenly, bottom up. */
  assign?: Record<string, number>;
  smdbPerFloor: number;
  dbPerSmdb: number;
  /** Create the incomer feeders (MDB → SMDB, SMDB → DB). */
  incomers: boolean;
}

export interface PlanCheck { level: 'ok' | 'warn' | 'bad'; text: string }
export interface HierarchyPlan {
  boards: Board[];
  feeders: Feeder[];
  mdbIds: string[];
  /** Floor → MDB id actually used. */
  assignment: { floor: Floor; mdbId: string }[];
  checks: PlanCheck[];
  ok: boolean; // no 'bad' check: safe to create
}

/** "GF", "L1", "B2", "RF" from a floor tag (G, L01, B2, R …). */
export function levelRef(tag: string): string {
  if (tag === 'G') return 'GF';
  if (tag === 'R') return 'RF';
  const m = /^L0*(\d+)$/.exec(tag);
  return m ? `L${m[1]}` : tag;
}

/** Panel name: type – level – number, the number (01, 02 …) only when more than one on the level. */
export const panelName = (type: string, level: string, n: number, of: number) => `${type}-${level}${of > 1 ? `-${String(n).padStart(2, '0')}` : ''}`;

const MAX_PER_FLOOR = 50;

/** Floors split into contiguous groups, bottom up, as evenly as possible (11 over 5 → 3, 2, 2, 2, 2). */
export function evenAssignment(floors: Floor[], mdbs: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (mdbs < 1) return out;
  const base = Math.floor(floors.length / mdbs), extra = floors.length % mdbs;
  let i = 0;
  for (let m = 0; m < mdbs; m++) for (let k = 0; k < base + (m < extra ? 1 : 0); k++) out[floors[i++].key] = m;
  return out;
}

export function planHierarchy(project: Project, spec: HierarchySpec): HierarchyPlan {
  const checks: PlanCheck[] = [];
  const building = project.building?.buildings.find((b) => b.id === spec.buildingId);
  const all = floorList(project.building).filter((f) => f.buildingId === spec.buildingId);
  const floors = spec.floors ? all.filter((f) => spec.floors!.includes(f.key)) : all;
  const empty = (): HierarchyPlan => ({ boards: [], feeders: [], mdbIds: [], assignment: [], checks, ok: false });
  if (!building) { checks.push({ level: 'bad', text: 'Choose a building (Building information)' }); return empty(); }
  if (!floors.length) { checks.push({ level: 'bad', text: `${building.name} has no levels yet — add them in Building information` }); return empty(); }
  if (spec.floors && spec.floors.length !== floors.length) checks.push({ level: 'bad', text: `${spec.floors.length - floors.length} chosen floor(s) no longer exist in ${building.name}` });
  if (!(spec.smdbPerFloor >= 1 && spec.smdbPerFloor <= MAX_PER_FLOOR && Number.isInteger(spec.smdbPerFloor))) checks.push({ level: 'bad', text: `SMDBs per floor must be a whole number from 1 to ${MAX_PER_FLOOR}` });
  if (!(spec.dbPerSmdb >= 0 && spec.dbPerSmdb <= MAX_PER_FLOOR && Number.isInteger(spec.dbPerSmdb))) checks.push({ level: 'bad', text: `DBs per SMDB must be a whole number from 0 to ${MAX_PER_FLOOR}` });

  // MDBs: existing main boards, or new ones.
  const taken = new Set(project.boards.map((b) => b.id));
  const boards: Board[] = [];
  let mdbIds: string[];
  if ('existing' in spec.mdbs) {
    mdbIds = spec.mdbs.existing;
    for (const id of mdbIds) if (!taken.has(id)) checks.push({ level: 'bad', text: `${id} is not a board in the project` });
    if (!mdbIds.length) checks.push({ level: 'bad', text: 'Choose at least one board to feed from' });
  } else {
    const n = spec.mdbs.create;
    if (!(n >= 1 && n <= 20 && Number.isInteger(n))) checks.push({ level: 'bad', text: 'MDBs to create must be a whole number from 1 to 20' });
    mdbIds = Array.from({ length: Math.max(0, Math.min(20, Math.floor(n) || 0)) }, (_, i) => (n > 1 ? `MDB-${String(i + 1).padStart(2, '0')}` : 'MDB'));
    for (const id of mdbIds) boards.push({ id, name: id, kind: 'MDB' });
    checks.push({ level: 'warn', text: `${mdbIds.length} new MDB${mdbIds.length > 1 ? 's' : ''}: supply (transformer or authority) still to assign` });
  }
  if (checks.some((c) => c.level === 'bad')) return { ...empty(), checks };

  const assign = { ...evenAssignment(floors, mdbIds.length), ...(spec.assign ?? {}) };
  const assignment = floors.map((floor) => ({ floor, mdbId: mdbIds[assign[floor.key]] }));
  const unassigned = assignment.filter((a) => !a.mdbId);
  if (unassigned.length) checks.push({ level: 'bad', text: `No MDB for ${unassigned.map((a) => levelRef(a.floor.tag)).join(', ')}` });

  const feeders: Feeder[] = [];
  const pending = { sizingPending: true as const, loadKw: 0, demandFactor: 1, powerFactor: 0.9, cores: 4 as const };
  for (const { floor, mdbId } of assignment) {
    if (!mdbId) continue;
    const lvl = levelRef(floor.tag);
    const dbsOnFloor = spec.smdbPerFloor * spec.dbPerSmdb;
    let dbN = 0;
    for (let s = 1; s <= spec.smdbPerFloor; s++) {
      const smdb = panelName('SMDB', lvl, s, spec.smdbPerFloor);
      boards.push({ id: smdb, name: smdb, kind: 'SMDB' as BoardKind, upstreamId: mdbId, level: floor.ref });
      if (spec.incomers) feeders.push({ id: `INC-${smdb}`, boardId: mdbId, feedsBoardId: smdb, name: `To ${smdb}`, lengthM: incomerLengthM(building, floor.elevationM), cableCsaMm2: 35, breakerRatingA: 100, breakerIcuKa: 25, ...pending });
      for (let d = 0; d < spec.dbPerSmdb; d++) {
        const db = panelName('DB', lvl, ++dbN, dbsOnFloor);
        boards.push({ id: db, name: db, kind: 'DB', upstreamId: smdb, level: floor.ref });
        if (spec.incomers) feeders.push({ id: `INC-${db}`, boardId: smdb, feedsBoardId: db, name: `To ${db}`, lengthM: building.riser?.perDbM ?? 10, cableCsaMm2: 16, breakerRatingA: 63, breakerIcuKa: 10, ...pending });
      }
    }
  }

  // Checks: names unique (in the plan and against the project), parents valid.
  const ids = boards.map((b) => b.id);
  const dupPlan = ids.filter((id, i) => ids.indexOf(id) !== i);
  const clash = ids.filter((id) => taken.has(id) && !('existing' in spec.mdbs && spec.mdbs.existing.includes(id)));
  if (dupPlan.length) checks.push({ level: 'bad', text: `Repeated names in the plan: ${[...new Set(dupPlan)].slice(0, 6).join(', ')}` });
  if (clash.length) checks.push({ level: 'bad', text: `Already in the project: ${clash.slice(0, 6).join(', ')}${clash.length > 6 ? ` and ${clash.length - 6} more` : ''} — rename or remove them first` });
  else if (!dupPlan.length) checks.push({ level: 'ok', text: 'Panel names are unique' });
  const known = new Set([...taken, ...ids]);
  const orphans = boards.filter((b) => b.upstreamId && !known.has(b.upstreamId));
  checks.push(orphans.length ? { level: 'bad', text: `Missing parent for ${orphans.length} panel(s)` } : { level: 'ok', text: 'Every panel has a valid parent' });
  if (spec.incomers && feeders.length) checks.push({ level: 'warn', text: `${feeders.length} incomers created as placeholders (35 / 16 mm², 100 / 63 A): sizing pending` });
  if (!spec.incomers) checks.push({ level: 'warn', text: 'No incomer feeders: the panels are not connected electrically until you add them' });
  const ok = !checks.some((c) => c.level === 'bad');
  return { boards, feeders, mdbIds, assignment: assignment.filter((a) => a.mdbId), checks, ok };
}

/** The project with the plan added (one change, so one undo removes it all). */
export function applyHierarchy(project: Project, plan: HierarchyPlan): Project {
  if (!plan.ok) throw new Error('The plan has errors — fix them before creating');
  return { ...project, boards: [...project.boards, ...plan.boards], feeders: [...project.feeders, ...plan.feeders] };
}
