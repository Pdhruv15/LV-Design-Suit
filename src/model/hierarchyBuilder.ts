import type { Board, Feeder, Project } from '../types';
import { incomerLengthM } from '../calc/buildingDesign';
import { evenAssignment, levelRef, panelName, type HierarchyPlan, type PlanCheck } from './hierarchy';
import { floorList, levelKey, type Floor } from './levels';

export type QuantityBasis = 'total' | 'floor' | 'parent';
export interface PanelQuantity { count: number; basis: QuantityBasis }
export interface BatchHierarchySpec {
  mode: 'floors' | 'quantity';
  buildingId?: string;
  floors?: string[];
  mdbs: { create: number } | { existing: string[] };
  smdb: PanelQuantity;
  db: PanelQuantity;
  assign?: Record<string, number>;
  incomers: boolean;
  /** Name prefixes for MDB / SMDB / DB (project naming table); default the type. */
  names?: { MDB?: string; SMDB?: string; DB?: string };
}
/** Keys refer to the unedited draft. Changing a tag never breaks a parent
 * selection or another edit in the same preview. */
export interface PanelDraftEdit { tag?: string; parentKey?: string; floorKey?: string; location?: string }
export type PanelDraftEdits = Record<string, PanelDraftEdit>;
export interface DraftPanel { key: string; board: Board; parentKey?: string }
export interface BatchHierarchyPlan extends HierarchyPlan { draft: DraftPanel[] }

const MAX_TOTAL = 5000;
const MAX_PER_GROUP = 50;
const MAX_PANELS = 20000;
const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
/** Contiguous, deterministic distribution. Remainders go to the first
 * groups; totals are never rounded up or multiplied implicitly. */
/** Incremental names continue after the highest existing number of that type (DB-100 → DB-101),
 * padded like the existing names or the batch size (01…10, 001…100; at least two digits). */
export function sequence(project: Project, type: string, total: number) {
  const re = new RegExp(`^${type}-(\\d+)$`);
  let last = 0, width = 2;
  for (const b of project.boards) { const m = re.exec(b.id); if (m) { last = Math.max(last, Number(m[1])); width = Math.max(width, m[1].length); } }
  width = Math.max(width, String(last + total).length);
  return (n: number) => String(last + n).padStart(width, '0');
}
const spread = (count: number, groups: number) => Array.from({ length: groups }, (_, i) => Math.floor(count / groups) + (i < count % groups ? 1 : 0));

function uniqueTag(base: string, taken: Set<string>): string {
  let tag = base;
  if (taken.has(tag)) {
    const numbered = /^(.*)-(\d+)$/.exec(base);
    const stem = numbered?.[1] ?? base;
    let n = numbered ? Number(numbered[2]) + 1 : 2;
    do { tag = `${stem}-${String(n++).padStart(2, '0')}`; } while (taken.has(tag));
  }
  taken.add(tag);
  return tag;
}

/** Create a structure draft only. All cable/breaker values are the app's
 * existing placeholders, not engineering selections. The original project
 * remains untouched until the user confirms the reviewed plan. */
export function planBatchHierarchy(project: Project, spec: BatchHierarchySpec, edits: PanelDraftEdits = {}): BatchHierarchyPlan {
  const checks: PlanCheck[] = [];
  const empty = (): BatchHierarchyPlan => ({ boards: [], feeders: [], mdbIds: [], assignment: [], checks, ok: false, draft: [] });
  const bad = (text: string) => checks.push({ level: 'bad', text });
  const allFloors = floorList(project.building);
  const building = project.building?.buildings.find((b) => b.id === spec.buildingId);
  const floors = spec.mode === 'floors' ? allFloors.filter((f) => f.buildingId === spec.buildingId && (!spec.floors || spec.floors.includes(f.key))) : [];
  if (spec.mode !== 'floors' && spec.mode !== 'quantity') bad('Choose a supported starting point.');
  if (spec.mode === 'floors' && (!building || !floors.length)) bad('Choose a building with levels, or use By quantity.');
  if (spec.mode === 'floors' && spec.floors && new Set(spec.floors).size !== floors.length) bad('Some selected floors no longer exist. Choose the floors again.');
  for (const [label, q] of [['SMDB', spec.smdb], ['DB', spec.db]] as const) {
    if (!['total', 'floor', 'parent'].includes(q.basis)) bad(`Choose a quantity basis for ${label}s.`);
    if (!whole(q.count, 0, q.basis === 'total' ? MAX_TOTAL : MAX_PER_GROUP)) bad(`${label} quantity must be a whole number from 0 to ${q.basis === 'total' ? MAX_TOTAL : MAX_PER_GROUP}.`);
    if (spec.mode === 'quantity' && q.basis === 'floor') bad('Per floor needs Typical floors mode.');
  }
  if (spec.mode === 'floors' && spec.smdb.basis === 'parent') bad('For typical floors, choose SMDBs per floor or a total.');
  const existingIdentifiers = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id)]);
  const taken = new Set(existingIdentifiers);
  const boards: Board[] = [];
  let mdbIds: string[] = [];
  let numbered = 0;
  const tag = (base: string) => { const id = uniqueTag(base, taken); if (id !== base) numbered++; return id; };
  if ('create' in spec.mdbs) {
    const createCount = spec.mdbs.create;
    if (!whole(createCount, 1, 20)) bad('New MDB quantity must be a whole number from 1 to 20.');
    if (checks.some((c) => c.level === 'bad')) return empty();
    const MP = spec.names?.MDB || 'MDB';
    const mdbSeq = sequence(project, MP, createCount);
    mdbIds = Array.from({ length: createCount }, (_, i) => tag(createCount > 1 || project.boards.some((b) => new RegExp(`^${MP}(-\\d+)?$`).test(b.id)) ? `${MP}-${mdbSeq(i + 1)}` : MP));
    boards.push(...mdbIds.map((id): Board => ({ id, name: id, kind: 'MDB' })));
    checks.push({ level: 'warn', text: `${mdbIds.length} new MDBs: supply still to assign.` });
  } else {
    mdbIds = spec.mdbs.existing;
    if (!mdbIds.length || new Set(mdbIds).size !== mdbIds.length) bad('Choose at least one distinct existing main board.');
    for (const id of mdbIds) if (!project.boards.some((b) => b.id === id && !b.upstreamId)) bad(`${id} is not an existing main board.`);
  }
  if (checks.some((c) => c.level === 'bad')) return empty();

  const smdbTotal = spec.smdb.count * (spec.smdb.basis === 'floor' ? floors.length : spec.smdb.basis === 'parent' ? mdbIds.length : 1);
  const dbTotal = spec.db.count * (spec.db.basis === 'floor' ? floors.length : spec.db.basis === 'parent' ? smdbTotal : 1);
  if (spec.db.basis === 'parent' && !smdbTotal && spec.db.count > 0) bad('DBs per SMDB needs at least one SMDB. Use Total to feed DBs directly from MDBs.');
  if (boards.length + smdbTotal + dbTotal > MAX_PANELS) bad(`This batch exceeds ${MAX_PANELS.toLocaleString('en-US')} new panels. Reduce the quantities or create smaller batches.`);
  if (checks.some((c) => c.level === 'bad')) return empty();
  const floorAssignment = { ...evenAssignment(floors, mdbIds.length), ...spec.assign };
  const assignment = floors.map((floor) => ({ floor, mdbId: mdbIds[floorAssignment[floor.key]] }));
  if (assignment.some((a) => !a.mdbId)) { bad('Assign every selected floor to an MDB.'); return empty(); }
  const groupCounts = spread(smdbTotal, spec.mode === 'floors' ? floors.length : mdbIds.length);
  const groups: { floor?: Floor; mdbId: string; count: number }[] = spec.mode === 'floors'
    ? assignment.map((a, i) => ({ ...a, count: spec.smdb.basis === 'floor' ? spec.smdb.count : groupCounts[i] }))
    : mdbIds.map((mdbId, i) => ({ mdbId, count: groupCounts[i] }));
  const SP = spec.names?.SMDB || 'SMDB', DP = spec.names?.DB || 'DB';
  const smdbSeq = sequence(project, SP, smdbTotal), dbSeq = sequence(project, DP, dbTotal);
  const groupBoards: Board[][] = [];
  let smdbN = 0;
  for (const g of groups) {
    const children = Array.from({ length: g.count }, (_, i): Board => {
      const id = tag(g.floor ? panelName(SP, levelRef(g.floor.tag), i + 1, g.count) : `${SP}-${smdbSeq(++smdbN)}`);
      return { id, name: id, kind: 'SMDB', upstreamId: g.mdbId, ...(g.floor ? { level: g.floor.ref } : {}) };
    });
    boards.push(...children); groupBoards.push(children);
  }
  const allSmdbs = groupBoards.flat();
  const perSmdb = spread(dbTotal, allSmdbs.length);
  let dbN = 0, smdbIndex = 0;
  for (let gIndex = 0; gIndex < groups.length; gIndex++) {
    const g = groups[gIndex];
    const parents = groupBoards[gIndex];
    const counts = spec.db.basis === 'floor' ? spread(spec.db.count, parents.length || 1)
      : spec.db.basis === 'parent' ? parents.map(() => spec.db.count)
        : parents.length ? parents.map(() => perSmdb[smdbIndex++]) : [spread(dbTotal, groups.length)[gIndex]];
    // A total is distributed over SMDBs when present, otherwise directly
    // over MDB groups. Floors without SMDBs don't receive a second total.
    if (!parents.length && allSmdbs.length && spec.db.basis !== 'floor') continue;
    const dbOnFloor = counts.reduce((a, b) => a + b, 0);
    let floorDbN = 0;
    for (let p = 0; p < (parents.length || 1); p++) {
      for (let d = 0; d < (counts[p] ?? 0); d++) {
        const id = tag(g.floor ? panelName(DP, levelRef(g.floor.tag), ++floorDbN, dbOnFloor) : `${DP}-${dbSeq(++dbN)}`);
        boards.push({ id, name: id, kind: 'DB', upstreamId: parents[p]?.id ?? g.mdbId, ...(g.floor ? { level: g.floor.ref } : {}) });
      }
    }
  }
  if (!smdbTotal && dbTotal) checks.push({ level: 'warn', text: 'No SMDBs: DBs are supplied directly from MDBs.' });
  if (numbered) checks.push({ level: 'warn', text: `${numbered} panel tags numbered automatically to avoid existing identifiers.` });
  if (!boards.length) bad('Enter at least one new panel to create.');
  const rename = new Map(boards.map((b) => [b.id, (edits[b.id]?.tag ?? b.id).trim()]));
  const draft: DraftPanel[] = boards.map((original) => {
    const edit = edits[original.id];
    const parentKey = original.upstreamId ? edit?.parentKey ?? original.upstreamId : undefined;
    if (original.upstreamId && !parentKey) bad(`${rename.get(original.id) || original.id} needs a parent.`);
    const floor = edit?.floorKey === undefined ? undefined : allFloors.find((f) => f.key === edit.floorKey);
    if (edit?.floorKey && !floor) bad(`Choose a valid floor for ${rename.get(original.id) || original.id}.`);
    const board: Board = {
      ...original, id: rename.get(original.id)!, name: rename.get(original.id)!,
      upstreamId: parentKey ? rename.get(parentKey) ?? parentKey : undefined,
      level: edit?.floorKey === undefined ? original.level : floor?.ref,
      ...(edit?.location !== undefined ? { location: edit.location.trim() } : {})
    };
    return { key: original.id, board, parentKey };
  });
  const resultBoards = draft.map((d) => d.board);
  const seen = new Set<string>();
  for (const b of resultBoards) {
    if (!b.id) bad('Every panel needs a tag.');
    else if (seen.has(b.id)) bad(`Repeated tag: ${b.id}. Edit one of these panels.`);
    else if (existingIdentifiers.has(b.id)) bad(`${b.id} already exists. Edit the panel tag in the preview.`);
    seen.add(b.id);
  }
  const graph = new Map([...project.boards, ...resultBoards].map((b) => [b.id, b]));
  for (const b of resultBoards) {
    if (b.upstreamId && !graph.has(b.upstreamId)) bad(`${b.id} needs an existing parent.`);
    const path = new Set<string>();
    let current: Board | undefined = b;
    while (current) {
      if (path.has(current.id)) { bad(`Connection cycle involving ${b.id}. Choose another parent.`); break; }
      path.add(current.id); current = current.upstreamId ? graph.get(current.upstreamId) : undefined;
    }
  }
  const feeders: Feeder[] = [];
  const draftKeyById = new Map(draft.map((d) => [d.board.id, d.key]));
  const feederIds = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id), ...resultBoards.map((b) => b.id)]);
  if (spec.incomers) for (const { key, board: b } of draft) {
    if (!b.upstreamId) continue;
    const floor = b.level ? allFloors.find((f) => f.key === levelKey(b.level!)) : undefined;
    const parent = graph.get(b.upstreamId);
    const owner = floor ? project.building?.buildings.find((x) => x.id === floor.buildingId) : undefined;
    const toSmdb = b.kind === 'SMDB';
    const edited = edits[key];
    const parentKey = draftKeyById.get(b.upstreamId);
    const parentEdit = parentKey ? edits[parentKey] : undefined;
    const unchecked = !floor || !!edited?.parentKey || edited?.floorKey !== undefined || edited?.location !== undefined
      || parentEdit?.floorKey !== undefined || parentEdit?.location !== undefined;
    feeders.push({ id: uniqueTag(`INC-${b.id}`, feederIds), boardId: b.upstreamId, feedsBoardId: b.id, name: `To ${b.id}`,
      lengthM: owner && floor && parent && !parent.upstreamId ? incomerLengthM(owner, floor.elevationM) : owner?.riser?.perDbM ?? 10,
      cableCsaMm2: toSmdb ? 35 : 16, breakerRatingA: toSmdb ? 100 : 63, breakerIcuKa: toSmdb ? 25 : 10,
      loadKw: 0, powerFactor: 0.9, demandFactor: 1, cores: 4, sizingPending: true, ...(unchecked ? { lengthToCheck: true } : {}) });
  }
  if (!checks.some((c) => c.level === 'bad')) {
    checks.push({ level: 'ok', text: 'Panel tags are unique.' }, { level: 'ok', text: 'Connections have valid parents and no cycles.' });
  }
  if (feeders.length) checks.push({ level: 'warn', text: `${feeders.length} incomers use placeholder cables and breakers. Loads and sizing still to complete.` });
  if (feeders.some((f) => f.lengthToCheck)) checks.push({ level: 'warn', text: 'Check cable lengths for panels without a floor or with edited connections or locations.' });
  if (!spec.incomers) checks.push({ level: 'warn', text: 'Panel structure only: add incomer feeders before running electrical studies.' });
  return { boards: resultBoards, feeders, mdbIds: mdbIds.map((id) => rename.get(id) ?? id),
    assignment: assignment.map((a) => ({ ...a, mdbId: rename.get(a.mdbId) ?? a.mdbId })), checks,
    ok: !checks.some((c) => c.level === 'bad'), draft };
}
