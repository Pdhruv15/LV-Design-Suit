import { incomerDeviceOf, type Board, type BoardKind, type BusTie, type Feeder, type Project } from '../types';
import { boardsInSupplyOrder } from '../calc/summary';
import { runsOf } from '../calc/electrical';
import { sizeRiser } from '../calc/busbar';
import { cableTypeOf } from './cableTypes';
import { floorList, type Floor } from './levels';

/** "Boards by level" riser of one building, for tall buildings: identical floors
 * share a row, every row counts its boards by kind, and the risers (busbar or
 * cable) split over sheets with match lines when the rows do not fit one sheet.
 * Everything comes from each panel's Level and kind, the feeders and the bus
 * risers. A row collapses only when its floors really match, so "×20" is true.
 *
 * Mains are panels drawn with their busbar: a supply root, an MDB / EMDB, or a
 * panel feeding a board on another floor. Every other panel is an entry on its
 * floor, fed by a riser run of a main or from a main on the same floor. */

export type CountCol = 'mdb' | 'smdb' | 'db' | 'edb' | 'mcc' | 'ups';
export const COUNT_COLS: CountCol[] = ['mdb', 'smdb', 'db', 'edb', 'mcc', 'ups'];
export type RowCounts = Record<CountCol, number>;

const MAIN_KINDS = new Set<BoardKind>(['MC', 'LV-ACB', 'MDB', 'LV-MDB', 'EMDB', 'LV-EMDB']);
const kindOf = (b: Board): BoardKind => b.kind ?? (b.upstreamId ? 'DB' : 'MDB');
const shortKind = (k: BoardKind) => k.replace(/^LV-/, '');
export function countCol(k: BoardKind): CountCol {
  if (MAIN_KINDS.has(k)) return 'mdb';
  return k === 'SMDB' ? 'smdb' : k === 'EDB' ? 'edb' : k === 'MCC' || k === 'EMCC' || k === 'FP' ? 'mcc' : k === 'UPS' ? 'ups' : 'db';
}
const zero = (): RowCounts => ({ mdb: 0, smdb: 0, db: 0, edb: 0, mcc: 0, ups: 0 });
export const countTotal = (c: RowCounts) => COUNT_COLS.reduce((s, k) => s + c[k], 0);

/** Boards of one kind on a row, by reference: `ids` on the row's first floor, `lastIds` on its last when it has several floors. */
export interface KindCount { kind: string; ids: string[]; lastIds?: string[]; ratings: number[] }
/** One box (with what it feeds on the same floor) of a row, on a run of a main. tapOffA: it hangs on a busbar riser through a tap-off box. */
export interface RowEntry extends KindCount { board: Board; kids: KindCount[]; runId?: string; tapOff: boolean; tapOffA?: number }
export interface DbRiserRow {
  index: number; label: string; sub: string; floors: Floor[]; counts: RowCounts; entries: RowEntry[];
  mainIds: string[]; page: number; /** Tap-off boxes on each of its floors. */ tapOffs: number
}
export interface DbRiserRun {
  id: string; kind: 'bus' | 'cable'; mainId: string; heavy: boolean; name: string; type: string; breaker: string; verticalM: number;
  /** Boards fed at each row (all its floors), by row index. */
  fed: Map<number, number>; /** Mains fed at each row. */ mains: Map<number, string[]>;
  rowMin: number; rowMax: number; letter?: string; serves: string; /** Tap-off box rating, by board. */ tapOffA: Map<string, number>
}
export interface DbRiserMain {
  board: Board; row: number; runs: DbRiserRun[]; fromLocal?: string; localEntries: boolean; sourceKva?: number; standbyKva?: number; hasStandby: boolean;
  changeover?: 'ATS' | 'ACB'; changeoverA?: number; incomer?: string; /** Fed from another panel through the changeover. */ mainsFrom?: string;
  /** Mains cable to the changeover of this panel, from this panel's busbar, and its breaker. */ feedsChangeover: { boardId: string; breaker: string }[]
}
export interface DbRiserLayout {
  buildingName: string; rows: DbRiserRow[]; mains: DbRiserMain[]; runs: DbRiserRun[]; pages: number[][];
  /** In the supply chain with no level here: drawn on the lowest level. */ notOnLevel: string[];
  /** Fed from this building with no level: not counted. */ unplaced: string[]; /** Tap-offs entered with a load and no board. */ looseTapOffs: string[];
  ties: BusTie[]; empty: boolean
}

/** Rows per sheet are limited by height (px of the drawing), so that A3 stays readable. */
export const PAGE_ROWS_H = 560;
const MAX_CABLE_LINES = 3;
export const ROW_MIN_H = 84, ENTRY_H = 42, MAIN_H = 92, SOURCE_H = 74;

/** Under a panel: its transformer, generator and changeover. */
export const hasSourceBand = (b: Board) => !!b.sourceKva || !!b.standby;

/** A box stack's height of one row entry. */
export const entryHeight = (e: RowEntry) => Math.max(1, e.kids.length) * ENTRY_H;

const ratingsOf = (list: Board[]) => [...new Set(list.map((b) => b.ratedCurrentA).filter((a): a is number => !!a))].sort((a, b) => a - b);

/** G+2 and above (podium and typical floors count, basements and the roof do not). Villas and G+1 use the other risers. */
export function dbRiserOffered(project: Project, buildingId: string): boolean {
  const b = project.building?.buildings.find((x) => x.id === buildingId);
  if (!b) return false;
  return b.levels.reduce((n, l) => n + (l.kind === 'basement' || l.kind === 'roof' ? 0 : Math.max(1, l.count ?? 1)), 0) >= 3;
}

export function dbRiserLayout(project: Project, buildingId: string): DbRiserLayout {
  const building = project.building?.buildings.find((b) => b.id === buildingId);
  const floors = floorList(project.building).filter((f) => f.buildingId === buildingId);
  const none: DbRiserLayout = { buildingName: building?.name ?? buildingId, rows: [], mains: [], runs: [], pages: [], notOnLevel: [], unplaced: [], looseTapOffs: [], ties: [], empty: true };
  if (!floors.length) return none;
  const floorIx = new Map(floors.map((f, i) => [f.key, i]));
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const order = boardsInSupplyOrder(project);
  const levelled = new Map<string, number>();
  for (const b of order) {
    const i = b.level && b.level.building === buildingId ? floorIx.get(`${b.level.building}/${b.level.level}/${b.level.index ?? 0}`) : undefined;
    if (i !== undefined) levelled.set(b.id, i);
  }
  if (!levelled.size) return none;

  // Supplies of the boards here: drawn on the lowest level when they have no level in this building.
  const place = new Map(levelled);
  const notOnLevel: string[] = [];
  for (const id of levelled.keys()) {
    const seen = new Set([id]);
    for (let x = byId.get(id)?.upstreamId; x && !seen.has(x); x = byId.get(x)?.upstreamId) {
      seen.add(x);
      if (byId.has(x) && !place.has(x)) { place.set(x, 0); notOnLevel.push(x); }
    }
  }
  const boards = order.filter((b) => place.has(b.id));
  const single = (project.building?.buildings.length ?? 0) === 1;
  const unplaced = order.filter((b) => !place.has(b.id) && (!b.level || !floorList(project.building).some((f) => f.ref.building === b.level!.building && f.ref.level === b.level!.level && (f.ref.index ?? 0) === (b.level!.index ?? 0))))
    .filter((b) => {
      if (single) return true;
      const seen = new Set([b.id]);
      for (let x = b.upstreamId; x && !seen.has(x); x = byId.get(x)?.upstreamId) { if (place.has(x)) return true; seen.add(x); }
      return false;
    }).map((b) => b.id);

  const kids = new Map<string, Board[]>();
  for (const b of boards) if (b.upstreamId && place.has(b.upstreamId)) kids.set(b.upstreamId, [...(kids.get(b.upstreamId) ?? []), b]);
  const isMain = (b: Board) => !b.upstreamId || !place.has(b.upstreamId) || MAIN_KINDS.has(kindOf(b)) || (kids.get(b.id) ?? []).some((c) => place.get(c.id) !== place.get(b.id));
  const mainSet = new Set(boards.filter(isMain).map((b) => b.id));

  const risers = project.busRisers ?? [];
  const busOf = (b: Board) => {
    const r = risers.find((x) => x.sourceBoardId === b.upstreamId && x.floors.some((f) => f.boardId === b.id));
    return r?.id;
  };
  const feederTo = (b: Board): Feeder | undefined => project.feeders.find((f) => f.feedsBoardId === b.id);
  const isFr = (b: Board) => { const f = feederTo(b); return !!(f && cableTypeOf(project, f).fireRated); };
  const sameFloor = (b: Board) => place.get(b.id) === place.get(b.upstreamId ?? '');
  /** How a board is fed: a bus riser, a cable of its main, or from the main on its floor. */
  const feedKey = (b: Board) => {
    const bus = busOf(b);
    if (bus) return `bus:${bus}`;
    return sameFloor(b) ? `local:${b.upstreamId}` : `cable:${b.upstreamId}:${isFr(b) ? 'fr' : ''}`;
  };
  const sameFloorKids = (b: Board): Board[] => (kids.get(b.id) ?? []).filter((c) => !mainSet.has(c.id)).flatMap((c) => [c, ...sameFloorKids(c)]);
  const onFloor = new Map<number, Board[]>();
  for (const b of boards) onFloor.set(place.get(b.id)!, [...(onFloor.get(place.get(b.id)!) ?? []), b]);
  const headsOf = (i: number) => (onFloor.get(i) ?? []).filter((b) => !mainSet.has(b.id) && mainSet.has(b.upstreamId ?? ''));
  const kindCounts = (list: Board[]): KindCount[] => {
    const m = new Map<string, Board[]>();
    for (const b of list) m.set(shortKind(kindOf(b)), [...(m.get(shortKind(kindOf(b))) ?? []), b]);
    return [...m.entries()].map(([kind, l]) => ({ kind, ids: l.map((b) => b.id), ratings: ratingsOf(l) }));
  };
  const signature = (i: number) => {
    const list = (onFloor.get(i) ?? []).filter((b) => mainSet.has(b.id)).map((b) => `M:${b.id}`);
    for (const h of headsOf(i)) list.push(`${kindOf(h)}|${feedKey(h)}|${kindCounts(sameFloorKids(h)).map((k) => `${k.kind}${k.ids.length}`).sort().join(',')}`);
    return list.sort().join(';');
  };

  // Rows: runs of floors of one typical group with matching boards.
  const levelKind = (f: Floor) => building?.levels.find((l) => l.id === f.ref.level)?.kind;
  const rows: DbRiserRow[] = [];
  let lastSig = '';
  floors.forEach((f, i) => {
    const sig = signature(i), last = rows[rows.length - 1], prev = last?.floors[last.floors.length - 1];
    const joins = prev && sig === lastSig && (prev.ref.level === f.ref.level || (levelKind(prev) === 'typical' && levelKind(f) === 'typical'));
    if (joins) last.floors.push(f);
    else rows.push({ index: rows.length, label: '', sub: '', floors: [f], counts: zero(), entries: [], mainIds: [], page: 0, tapOffs: 0 });
    lastSig = sig;
  });
  const rowOfFloor = new Map<number, number>();
  rows.forEach((r) => r.floors.forEach((f) => rowOfFloor.set(floorIx.get(f.key)!, r.index)));
  const rowOf = (b: Board) => rowOfFloor.get(place.get(b.id)!) ?? 0;

  rows.forEach((r) => {
    const f = r.floors[0], last = r.floors[r.floors.length - 1], e = f.elevationM;
    r.label = r.floors.length > 1 ? `${f.tag}–${last.tag}` : f.name.includes('(') ? f.tag : f.name;
    r.sub = r.floors.length > 1 ? `typical ×${r.floors.length}` : `${e >= 0 ? (e === 0 ? '±' : '+') : '−'}${Math.abs(e).toFixed(2)}`;
    const first = floorIx.get(f.key)!;
    for (const b of onFloor.get(first) ?? []) r.counts[countCol(kindOf(b))]++;
    r.mainIds = (onFloor.get(first) ?? []).filter((b) => mainSet.has(b.id)).map((b) => b.id);
    r.tapOffs = (onFloor.get(first) ?? []).filter((b) => busOf(b)).length;
  });

  // Pages, bottom first: never inside a row; a chosen break starts a new sheet at its row.
  const breaks = new Set(project.drawingSet?.riserBreaks?.[buildingId] ?? []);
  const rowHeight = (r: DbRiserRow) => {
    const stack = new Map<string, number>();
    for (const h of headsOf(floorIx.get(r.floors[0].key)!)) stack.set(h.upstreamId!, (stack.get(h.upstreamId!) ?? 0) + Math.max(1, kindCounts(sameFloorKids(h)).length) * ENTRY_H);
    const band = r.mainIds.some((id) => hasSourceBand(byId.get(id)!)) ? SOURCE_H : 0;
    return Math.max(ROW_MIN_H, Math.max(0, ...stack.values()) + (r.mainIds.length ? MAIN_H : 0) + band + 16);
  };
  const pages: number[][] = [[]];
  let used = 0;
  rows.forEach((r, i) => {
    const h = rowHeight(r);
    const chosen = r.floors.some((f) => breaks.has(f.key));
    if (pages[pages.length - 1].length && (chosen || used + h > PAGE_ROWS_H)) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(i);
    r.page = pages.length - 1;
    used += h;
  });

  // Runs: a busbar riser each. Cables of a panel have a line per row, but share one line when going to another
  // sheet or to more rows than MAX_CABLE_LINES, so a tall building stays narrow.
  // Panels with a coupler between them sit side by side.
  const ties = (project.ties ?? []).filter((t) => mainSet.has(t.a) && mainSet.has(t.b));
  const allMains = boards.filter((b) => mainSet.has(b.id));
  for (const t of ties) {
    const at = allMains.findIndex((b) => b.id === t.a), bt = allMains.findIndex((b) => b.id === t.b);
    if (rowOf(allMains[at]) === rowOf(allMains[bt]) && bt > at + 1) allMains.splice(at + 1, 0, ...allMains.splice(bt, 1));
  }
  const runs = new Map<string, DbRiserRun>();
  const topElevation = (rowIx: number) => { const fl = rows[rowIx].floors; return fl[fl.length - 1].elevationM; };
  const fedBoards = new Map<string, Board[]>();
  const cableRows = new Map<string, Set<number>>();
  for (const b of boards) {
    if (!b.upstreamId || !mainSet.has(b.upstreamId) || busOf(b) || sameFloor(b)) continue;
    const k = `${b.upstreamId}:${isFr(b)}`;
    cableRows.set(k, (cableRows.get(k) ?? new Set()).add(rowOf(b)));
  }
  const runIdOf = (b: Board) => {
    const bus = busOf(b);
    if (bus) return bus;
    const r = rowOf(b), m = rowOf(byId.get(b.upstreamId!)!);
    const shared = rows[r].page !== rows[m].page || (cableRows.get(`${b.upstreamId}:${isFr(b)}`)?.size ?? 0) > MAX_CABLE_LINES;
    return shared ? `far:${b.upstreamId}:${isFr(b)}` : `row:${b.upstreamId}:${r}:${isFr(b)}`;
  };
  for (const b of boards) {
    if (!b.upstreamId || !place.has(b.upstreamId) || !mainSet.has(b.upstreamId)) continue;
    if (!busOf(b) && sameFloor(b)) continue;
    const id = runIdOf(b), row = rowOf(b), main = byId.get(b.upstreamId)!;
    const bus = busOf(b), mr = rowOf(main);
    if (!runs.has(id)) runs.set(id, { id, kind: bus ? 'bus' : 'cable', mainId: main.id, heavy: !!bus || isFr(b), name: '', type: '', breaker: '', verticalM: 0, fed: new Map(), mains: new Map(), rowMin: mr, rowMax: mr, serves: '', tapOffA: new Map() });
    const run = runs.get(id)!;
    run.fed.set(row, (run.fed.get(row) ?? 0) + 1);
    if (mainSet.has(b.id)) run.mains.set(row, [...(run.mains.get(row) ?? []), b.id]);
    run.rowMin = Math.min(run.rowMin, row);
    run.rowMax = Math.max(run.rowMax, row);
    fedBoards.set(id, [...(fedBoards.get(id) ?? []), b]);
  }

  const ordered: DbRiserRun[] = [];
  const mains: DbRiserMain[] = allMains.map((board) => {
    const row = rowOf(board);
    const own = [...runs.values()].filter((r) => r.mainId === board.id)
      .sort((a, b) => Number(b.kind === 'bus') - Number(a.kind === 'bus') || Number(b.id.startsWith('far')) - Number(a.id.startsWith('far')) || a.rowMax - b.rowMax);
    ordered.push(...own);
    const parent = board.upstreamId && place.has(board.upstreamId) ? board.upstreamId : undefined;
    const device = incomerDeviceOf(board);
    return {
      board, row, runs: own, fromLocal: parent && sameFloor(board) && !busOf(board) && !board.standby ? parent : undefined,
      localEntries: false, sourceKva: board.sourceKva, standbyKva: board.standby?.kva, hasStandby: !!board.standby,
      changeover: board.standby ? board.standby.changeover ?? 'ATS' : undefined, changeoverA: board.standby?.atsRatingA ?? board.ratedCurrentA,
      incomer: device === 'MCCB-NA' ? 'MCCB (NA)' : device === 'ISOL' ? 'Isolator' : device, mainsFrom: board.standby ? parent : undefined,
      feedsChangeover: boards.filter((c) => c.upstreamId === board.id && c.standby && mainSet.has(c.id) && sameFloor(c) && !busOf(c)).map((c) => {
        const f = feederTo(c);
        return { boardId: c.id, breaker: f ? `${f.breakerRatingA} A` : '' };
      })
    };
  });

  // What each run is, in words, for the drawing and the riser table.
  const mixed = (list: string[]) => { const u = [...new Set(list)]; return u.length === 1 ? u[0] : `${u[0]} …`; };
  let cables = 0;
  for (const run of ordered) {
    const fed = fedBoards.get(run.id) ?? [];
    const main = byId.get(run.mainId)!;
    const rowsFed = [...run.fed.keys()].sort((a, b) => a - b);
    run.serves = rowsFed.map((r) => rows[r].label).join(', ');
    const reach = Math.max(...rowsFed.map((r) => Math.abs(topElevation(r) - rows[rowOf(main)].floors[0].elevationM)));
    run.verticalM = reach;
    if (run.kind === 'bus') {
      const r = risers.find((x) => x.id === run.id)!;
      const res = (() => { try { return sizeRiser(project, r); } catch { return undefined; } })();
      run.name = r.name;
      const a = res?.type?.ratingA;
      run.type = `Busbar${a ? ` ${a} A` : ''} ${r.material === 'cu' ? 'Cu' : 'Al'}`;
      run.breaker = a ? `${a} A` : '';
      for (const x of res?.floors ?? []) if (x.floor.boardId && x.tapOffA) run.tapOffA.set(x.floor.boardId, x.tapOffA);
    } else {
      cables++;
      const fs = fed.map(feederTo).filter((f): f is Feeder => !!f);
      run.name = `${run.heavy ? 'FR cable' : 'Cable'} C${cables}`;
      run.type = fs.length ? mixed(fs.map((f) => `${runsOf(f) > 1 ? `${runsOf(f)}× ` : ''}${f.cores}C ${f.cableCsaMm2} mm²`)) : 'Cable';
      const amps = [...new Set(fs.map((f) => f.breakerRatingA))].sort((a, b) => a - b);
      run.breaker = !amps.length ? '' : `${fed.length > 1 ? `${fed.length}× ` : ''}${amps.length === 1 ? amps[0] : `${amps[0]}–${amps[amps.length - 1]}`} A`;
    }
  }

  // Row entries, by reference. Every tap-off and every panel feeding others has its own box; other boards of one kind share one.
  const entriesOf = (floor: number): { key: string; entry: RowEntry }[] => {
    const out: { key: string; entry: RowEntry }[] = [];
    let n = 0;
    for (const h of headsOf(floor)) {
      const ks = kindCounts(sameFloorKids(h)), tapOff = !!busOf(h);
      const runId = !tapOff && sameFloor(h) ? undefined : runIdOf(h);
      const key = `${h.upstreamId}|${runId ?? 'local'}|${kindOf(h)}|${ks.map((k) => `${k.kind}${k.ids.length}`).join(',')}`;
      const had = !tapOff && !ks.length ? out.find((x) => x.key === key) : undefined;
      if (had) { had.entry.ids.push(h.id); had.entry.ratings = [...new Set([...had.entry.ratings, ...ratingsOf([h])])].sort((a, b) => a - b); continue; }
      out.push({ key: tapOff || ks.length ? `${key}#${n++}` : key, entry: { board: h, kind: shortKind(kindOf(h)), ids: [h.id], ratings: ratingsOf([h]), kids: ks, runId, tapOff, tapOffA: runId ? runs.get(runId)?.tapOffA.get(h.id) : undefined } });
    }
    return out;
  };
  rows.forEach((r) => {
    const first = entriesOf(floorIx.get(r.floors[0].key)!);
    if (r.floors.length > 1) {
      const last = entriesOf(floorIx.get(r.floors[r.floors.length - 1].key)!);
      first.forEach((x, i) => {
        const y = last.find((l) => l.key === x.key) ?? last[i];
        if (!y) return;
        x.entry.lastIds = y.entry.ids;
        x.entry.kids.forEach((k, j) => { k.lastIds = y.entry.kids[j]?.ids; });
      });
    }
    r.entries = first.map((x) => x.entry);
  });
  const looseTapOffs = risers.filter((r) => r.sourceBoardId && place.has(r.sourceBoardId)).flatMap((r) => { const n = r.floors.filter((f) => !f.boardId).reduce((s, f) => s + Math.max(1, f.count ?? 1), 0); return n ? [`${r.name} (${n})`] : []; });
  for (const m of mains) m.localEntries = rows[m.row].entries.some((e) => e.board.upstreamId === m.board.id && !e.runId);

  // Flags for the runs that cross a sheet break.
  let n = 0;
  for (const run of ordered) if (rows[run.rowMin].page !== rows[run.rowMax].page) run.letter = flagLetter(n++);

  return { buildingName: building?.name ?? buildingId, rows, mains, runs: ordered, pages, notOnLevel, unplaced, looseTapOffs, ties, empty: false };
}

/** A, B … Z, AA, AB … */
export function flagLetter(i: number): string {
  const a = String.fromCharCode(65 + (i % 26));
  return i < 26 ? a : flagLetter(Math.floor(i / 26) - 1) + a;
}

/** Boards of a set of rows, per kind (floors counted). */
export function rowsTotal(rows: DbRiserRow[]): RowCounts {
  const t = zero();
  for (const r of rows) for (const k of COUNT_COLS) t[k] += r.counts[k] * r.floors.length;
  return t;
}

/** A floor's references in a box: a short list, or first … last; a typical row also gives its last floor. */
export function refLines(k: Pick<KindCount, 'ids' | 'lastIds'>): string[] {
  const { ids, lastIds } = k;
  if (lastIds?.length) {
    if (ids.length === 1) return [`${ids[0]} … ${afterPrefix(ids[0], lastIds[0])}`];
    return [`${ids[0]} … ${ids[ids.length - 1]}`, `to ${lastIds[0]} … ${lastIds[lastIds.length - 1]}`];
  }
  if (ids.length > 4) return [`${ids[0]} … ${ids[ids.length - 1]}`];
  const short = ids.map((id, i) => (i % 2 ? afterPrefix(ids[i - 1], id) : id));
  return short.reduce<string[]>((out, s, i) => { if (i % 2) out[out.length - 1] += `, ${s}`; else out.push(s); return out; }, []);
}
/** "DB-L01-A2" after "DB-L01-A1" is "A2": what follows their shared prefix, up to its last separator. */
function afterPrefix(a: string, b: string): string {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  const cut = Math.max(a.lastIndexOf('-', n - 1), a.lastIndexOf('/', n - 1), a.lastIndexOf('.', n - 1));
  return cut >= 0 ? b.slice(cut + 1) : b;
}

/** Sheet titles of a building's riser (one per page). */
export function dbRiserTitles(project: Project, buildingId: string): string[] {
  const L = dbRiserLayout(project, buildingId);
  const n = Math.max(1, L.pages.length);
  return Array.from({ length: n }, (_, i) => `DB riser diagram — ${L.buildingName}${n > 1 ? ` (${i + 1} of ${n})` : ''}`);
}

/** Cables beyond the gap above row g (or below it, under the main): the number on the line's slash. */
export function cablesAtGap(run: DbRiserRun, g: number, mainRow: number): number {
  let n = 0;
  for (const [r, c] of run.fed) if (g >= mainRow ? r > g : r <= g) n += c;
  return n;
}
