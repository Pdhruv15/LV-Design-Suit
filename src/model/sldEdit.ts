import { selectCable } from '../calc/electrical';
import { applyRecommendation, generatorForBoard, recommend, sizePfc, upsForBoard } from '../calc/sizing';
import type { LibraryLoad } from '../database/database';
import { BOARD_KINDS, type Board, type BoardKind, type Feeder, type LoadType, type Project } from '../types';

/** Building the SLD by drag and drop: what each library item does when it
 * is dropped on a busbar, on a feeder, or on the empty canvas. Every drop
 * produces ordinary boards and feeders, connected and sized by the app, so
 * the diagram, schedules and every study stay in step. */

export interface LoadPreset {
  id: string;
  label: string;
  name: string;
  loadType: LoadType;
  loadKw: number;
  powerFactor: number;
  demandFactor: number;
  generation?: boolean;
}

export const LOAD_PRESETS: LoadPreset[] = [
  { id: 'motor', label: 'Motor / pump', name: 'Pump', loadType: 'motor', loadKw: 15, powerFactor: 0.86, demandFactor: 1 },
  { id: 'ahu', label: 'AHU', name: 'AHU', loadType: 'hvac', loadKw: 11, powerFactor: 0.85, demandFactor: 1 },
  { id: 'chiller', label: 'Chiller', name: 'Chiller', loadType: 'hvac', loadKw: 150, powerFactor: 0.88, demandFactor: 1 },
  { id: 'fire-pump', label: 'Fire pump', name: 'Fire pump', loadType: 'fire-pump', loadKw: 45, powerFactor: 0.86, demandFactor: 1 },
  { id: 'ev', label: 'EV charger', name: 'EV charger', loadType: 'ev', loadKw: 22, powerFactor: 0.98, demandFactor: 1 },
  { id: 'pv', label: 'Solar PV', name: 'Solar PV inverter', loadType: 'pv', loadKw: 50, powerFactor: 1, demandFactor: 1, generation: true },
  { id: 'lighting', label: 'Lighting', name: 'Lighting', loadType: 'lighting', loadKw: 10, powerFactor: 0.9, demandFactor: 0.9 },
  { id: 'it', label: 'IT / data', name: 'IT room', loadType: 'it', loadKw: 10, powerFactor: 0.95, demandFactor: 1 },
  { id: 'general', label: 'General load', name: 'Load', loadType: 'general', loadKw: 10, powerFactor: 0.9, demandFactor: 1 }
];

export type ProtectionDevice = 'ACB' | 'MCCB' | 'MCB' | 'ISOL';

export type PaletteItem =
  | { kind: 'board'; board: BoardKind }
  | { kind: 'transformer' }
  | { kind: 'generator' }
  | { kind: 'capacitor' }
  | { kind: 'library'; name: string }
  | { kind: 'load'; preset: string }
  | { kind: 'device'; device: ProtectionDevice }
  | { kind: 'cable' };

export type DropTarget = { type: 'bus'; boardId: string } | { type: 'feeder'; feederId: string } | { type: 'canvas' };

export interface PaletteEntry {
  item: PaletteItem;
  label: string;
  title: string;
}

export const PALETTE: { group: string; entries: PaletteEntry[] }[] = [
  {
    group: 'Supply',
    entries: [
      { item: { kind: 'transformer' }, label: 'Transformer', title: 'Drop on the empty canvas for a new supply with its MDB, or on a main board to give it a transformer' },
      { item: { kind: 'board', board: 'MC' }, label: 'Meter cabinet', title: 'Authority supply (e.g. DEWA meter cabinet) — drop on the empty canvas' },
      { item: { kind: 'generator' }, label: 'Generator + ATS', title: 'Drop on a board (e.g. an EMDB): a standby generator through an ATS, sized for that board; everything below it becomes essential load' }
    ]
  },
  {
    group: 'Boards',
    entries: (['MDB', 'SMDB', 'MCC', 'EMDB', 'DB', 'UPS'] as BoardKind[]).map((k) => ({
      item: { kind: 'board', board: k } as PaletteItem,
      label: k,
      title: k === 'MDB'
        ? 'Main board — drop on the empty canvas (new supply) or on a meter cabinet busbar'
        : `${BOARD_KINDS.find((b) => b.value === k)!.label} — drop on a busbar; its breaker and incomer cable are added`
    }))
  },
  {
    group: 'Protection',
    entries: (['ACB', 'MCCB', 'MCB', 'ISOL'] as ProtectionDevice[]).map((d) => ({
      item: { kind: 'device', device: d } as PaletteItem,
      label: d === 'ISOL' ? 'Isolator' : d,
      title: `Drop on a feeder to change its switching device to ${d === 'ISOL' ? 'an isolator' : d === 'MCB' ? 'an MCB' : `an ${d}`}`
    }))
  },
  {
    group: 'Cable',
    entries: [{ item: { kind: 'cable' }, label: 'Cable', title: 'Drop on a feeder to edit its cable (size, cores, length)' }]
  },
  {
    group: 'Loads',
    entries: [
      ...LOAD_PRESETS.map((p) => ({ item: { kind: 'load', preset: p.id } as PaletteItem, label: p.label, title: `Drop on a busbar: breaker, cable and ${p.label.toLowerCase()} (${p.loadKw} kW) are added and sized` })),
      { item: { kind: 'capacitor' } as PaletteItem, label: 'Capacitor bank', title: 'Drop on a board: a capacitor bank sized to bring it to the power factor target (Project settings)' }
    ]
  }
];

/** Library group for the user's own equipment (Loads.xlsx). Items that
 * belong to a load schedule point column (lights, sockets…) stay out. */
export function libraryEntries(library: LibraryLoad[]): PaletteEntry[] {
  return library
    .filter((l) => !l.column && l.watts > 0)
    .map((l) => ({
      item: { kind: 'library', name: l.name } as PaletteItem,
      label: l.name,
      title: `${l.name}: ${(l.watts / 1000).toFixed(l.watts < 10000 ? 2 : 1)} kW${l.pf ? `, PF ${l.pf}` : ''}${l.phases === 1 ? ', 1-phase' : ''} — drop on a busbar`
    }));
}

/** Diagram icon for a library item, from its category or name. */
export function libraryLoadType(l: LibraryLoad): LoadType {
  const t = `${l.category ?? ''} ${l.name}`.toLowerCase();
  if (/fire/.test(t)) return 'fire-pump';
  if (/motor|pump|fan\b|compressor|lift|elevator/.test(t)) return 'motor';
  if (/ahu|fcu|chiller|a\/c|hvac|split|package|vrf|cooling/.test(t)) return 'hvac';
  if (/light|ltg|lamp/.test(t)) return 'lighting';
  if (/\bev\b|charger/.test(t)) return 'ev';
  if (/ups|server|it\b|data/.test(t)) return 'it';
  if (/socket|s\/o/.test(t)) return 'sockets';
  return 'general';
}

export const itemKey = (i: PaletteItem) =>
  i.kind === 'board' ? `board:${i.board}` : i.kind === 'load' ? `load:${i.preset}` : i.kind === 'device' ? `device:${i.device}` : i.kind === 'library' ? `library:${i.name}` : i.kind;

/** Typical rating (A) of a new board by type; its incomer breaker and cable
 * are sized for it until real loads are added. */
const BOARD_RATING: Record<BoardKind, number> = { MC: 400, MDB: 1600, SMDB: 250, MCC: 400, EMDB: 250, DB: 63, UPS: 32 };

const isRoot = (p: Project, boardId: string) => !p.boards.find((b) => b.id === boardId)?.upstreamId;

/** Whether an item can go on a target: shown while dragging. */
export function canDrop(project: Project, item: PaletteItem, target: DropTarget): boolean {
  switch (item.kind) {
    case 'board':
      if (target.type === 'canvas') return item.board === 'MDB' || item.board === 'MC';
      if (target.type !== 'bus') return false;
      if (item.board === 'MC') return false;
      // An MDB goes under a meter cabinet; other boards go on any board.
      if (item.board === 'MDB') return project.boards.find((b) => b.id === target.boardId)?.kind === 'MC';
      return true;
    case 'transformer':
      return target.type === 'canvas' || (target.type === 'bus' && isRoot(project, target.boardId));
    case 'load':
    case 'library':
    case 'generator':
    case 'capacitor':
      return target.type === 'bus';
    case 'device':
    case 'cable':
      return target.type === 'feeder';
  }
}

export interface DropResult {
  project: Project;
  select?: { type: 'board' | 'feeder'; id: string };
  message: string;
}

function uniqueId(taken: Set<string>, base: string): string {
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

const allIds = (p: Project) => new Set([...p.boards.map((b) => b.id), ...p.feeders.map((f) => f.id)]);

/** Sizes a new feeder with the app's breaker and cable selection. */
function sized(project: Project, f: Feeder): Feeder {
  const p = { ...project, feeders: [...project.feeders, f] };
  return applyRecommendation(f, recommend(p, f, 'optimise'));
}

/** Incomer of a new board: breaker at the board's rating, cable rated for
 * that breaker at the project's ambient. */
function boardIncomer(project: Project, parentId: string, board: Board): Feeder {
  const rating = board.ratedCurrentA ?? 63;
  const cable = selectCable(rating, 30, project.voltageV, 4, 0.85, project.ambientC, 100, rating) ?? 300;
  return {
    id: `INC-${board.id}`, boardId: parentId, name: `Incomer to ${board.name}`,
    loadKw: 0, demandFactor: 1, powerFactor: 0.85, lengthM: 30, cableCsaMm2: cable, cores: 4,
    breakerRatingA: rating, breakerIcuKa: 36, breakerType: rating > 1600 ? 'ACB' : rating > 63 ? 'MCCB' : 'C',
    feedsBoardId: board.id
  };
}

function newBoard(project: Project, kind: BoardKind, upstreamId?: string): Board {
  const id = uniqueId(allIds(project), kind);
  const n = id.slice(kind.length + 1);
  return {
    id,
    name: kind === 'MC' ? `Meter cabinet ${n}` : `${kind} ${n}`,
    kind,
    upstreamId,
    ratedCurrentA: BOARD_RATING[kind],
    ...(kind === 'MC' ? { supply: { fedFrom: 'DEWA', device: 'MCCB' as const, ratingA: BOARD_RATING.MC, meter: 'CT' as const } } : {})
  };
}

/** Applies a drop. Returns the project unchanged (with a message) when the
 * item can't go there. */
export function applyDrop(project: Project, item: PaletteItem, target: DropTarget, library: LibraryLoad[] = []): DropResult {
  if (!canDrop(project, item, target)) return { project, message: dropHint(item) };

  if (item.kind === 'board') {
    const parent = target.type === 'bus' ? target.boardId : undefined;
    const board = newBoard(project, item.board, parent);
    if (!parent) {
      const withSupply = item.board === 'MDB' ? { ...board, supply: { fedFrom: 'DEWA' } } : board;
      return { project: { ...project, boards: [...project.boards, withSupply] }, select: { type: 'board', id: board.id }, message: `Added ${board.id} (new supply) — set its data in the properties panel` };
    }
    const incomer = boardIncomer(project, parent, board);
    if (item.board === 'UPS') board.upsKva = 10;
    const next = { ...project, boards: [...project.boards, board], feeders: [...project.feeders, incomer] };
    const tail = item.board === 'DB' ? ' — double-click it to open its load schedule' : '';
    return { project: next, select: { type: 'board', id: board.id }, message: `Added ${board.id} on ${parent} with a ${incomer.breakerRatingA} A breaker and ${incomer.cores}C × ${incomer.cableCsaMm2} mm² cable${tail}` };
  }

  if (item.kind === 'transformer') {
    if (target.type === 'bus') {
      const b = project.boards.find((x) => x.id === target.boardId)!;
      if (b.sourceKva) return { project, select: { type: 'board', id: b.id }, message: `${b.id} already has a ${b.sourceKva} kVA transformer — edit it in the properties panel` };
      return {
        project: { ...project, boards: project.boards.map((x) => (x.id === b.id ? { ...x, sourceKva: 1000, sourceImpedancePct: 6 } : x)) },
        select: { type: 'board', id: b.id },
        message: `Added a 1000 kVA transformer to ${b.id} — set kVA and impedance in the properties panel`
      };
    }
    const board = { ...newBoard(project, 'MDB'), sourceKva: 1000, sourceImpedancePct: 6 };
    return { project: { ...project, boards: [...project.boards, board] }, select: { type: 'board', id: board.id }, message: `Added a 1000 kVA transformer with ${board.id}` };
  }

  if (item.kind === 'generator' && target.type === 'bus') {
    const b = project.boards.find((x) => x.id === target.boardId)!;
    if (b.standby) return { project, select: { type: 'board', id: b.id }, message: `${b.id} already has a ${b.standby.kva} kVA standby generator — change it in the board's properties` };
    const kva = generatorForBoard(project, b.id);
    return {
      project: { ...project, boards: project.boards.map((x) => (x.id === b.id ? { ...x, standby: { kva } } : x)) },
      select: { type: 'board', id: b.id },
      message: `Added a ${kva} kVA standby generator with ATS to ${b.id}; its loads now count as essential in Transformer & generator sizing`
    };
  }

  if (item.kind === 'capacitor' && target.type === 'bus') {
    const need = sizePfc(project, target.boardId).bankKvar;
    const kvar = need || 25;
    const id = uniqueId(allIds(project), `${target.boardId}-CAP`);
    const f = sized(project, {
      id, boardId: target.boardId, name: `Capacitor bank ${id.slice(id.lastIndexOf('-') + 1)}`,
      loadKw: 0, demandFactor: 1, powerFactor: 1, kvar, lengthM: 10, cableCsaMm2: 4, cores: 4, breakerRatingA: 16, breakerIcuKa: 25, loadType: 'capacitor'
    });
    return {
      project: { ...project, feeders: [...project.feeders, f] },
      select: { type: 'feeder', id: f.id },
      message: need
        ? `Added a ${kvar} kvar capacitor bank on ${target.boardId} (sized for the power factor target): ${f.breakerRatingA} A, ${f.cores}C × ${f.cableCsaMm2} mm²`
        : `Added a ${kvar} kvar capacitor bank on ${target.boardId} — the board is already at the power factor target; set the kvar in the properties`
    };
  }

  if (item.kind === 'library' && target.type === 'bus') {
    const l = library.find((x) => x.name === item.name);
    if (!l) return { project, message: `${item.name} is no longer in the equipment database` };
    const id = uniqueId(allIds(project), `${target.boardId}-EQ`);
    const f: Feeder = sized(project, {
      id, boardId: target.boardId, name: l.name,
      loadKw: l.watts / 1000, demandFactor: l.demandFactor ?? 1, powerFactor: l.pf ?? 0.9,
      lengthM: 30, cableCsaMm2: 4, cores: l.phases === 1 ? 2 : 4, breakerRatingA: 16, breakerIcuKa: 25,
      loadType: libraryLoadType(l), remarks: [l.manufacturer, l.model].filter(Boolean).join(' ') || undefined
    });
    if (!f.remarks) delete f.remarks;
    return {
      project: { ...project, feeders: [...project.feeders, f] },
      select: { type: 'feeder', id: f.id },
      message: `Added ${l.name} (${f.loadKw} kW) on ${target.boardId}: ${f.breakerRatingA} A and ${f.cores}C × ${f.cableCsaMm2} mm²`
    };
  }

  if (item.kind === 'load' && target.type === 'bus') {
    const preset = LOAD_PRESETS.find((p) => p.id === item.preset)!;
    const id = uniqueId(allIds(project), `${target.boardId}-${preset.id.toUpperCase()}`);
    const n = id.slice(id.lastIndexOf('-') + 1);
    const f: Feeder = sized(project, {
      id, boardId: target.boardId, name: `${preset.name} ${n}`,
      loadKw: preset.loadKw, demandFactor: preset.demandFactor, powerFactor: preset.powerFactor,
      lengthM: 30, cableCsaMm2: 4, cores: 4, breakerRatingA: 16, breakerIcuKa: 25,
      loadType: preset.loadType, ...(preset.generation ? { generation: true } : {})
    });
    return {
      project: { ...project, feeders: [...project.feeders, f] },
      select: { type: 'feeder', id: f.id },
      message: `Added ${f.name} on ${target.boardId}: ${f.breakerRatingA} A ${f.breakerType ?? ''} and ${f.cores}C × ${f.cableCsaMm2} mm², ${f.lengthM} m — edit the kW and length in the properties`
    };
  }

  if (item.kind === 'device' && target.type === 'feeder') {
    const f = project.feeders.find((x) => x.id === target.feederId)!;
    const patch: Partial<Feeder> =
      item.device === 'ACB' ? { breakerType: 'ACB', device: 'ACB' }
        : item.device === 'MCCB' ? { breakerType: 'MCCB', device: 'MCCB' }
          : item.device === 'MCB' ? { breakerType: f.breakerRatingA > 63 ? 'MCCB' : 'C', device: undefined }
            : { device: 'ISOL' };
    const next = { ...f, ...patch };
    if (next.device === undefined) delete next.device;
    const note = item.device === 'MCB' && f.breakerRatingA > 63 ? ` (MCBs go up to 63 A — ${f.breakerRatingA} A stays an MCCB)` : '';
    return {
      project: { ...project, feeders: project.feeders.map((x) => (x.id === f.id ? next : x)) },
      select: { type: 'feeder', id: f.id },
      message: `${f.id}: switching device set to ${item.device === 'ISOL' ? 'isolator' : item.device}${note}`
    };
  }

  if (item.kind === 'cable' && target.type === 'feeder') {
    const f = project.feeders.find((x) => x.id === target.feederId)!;
    return { project, select: { type: 'feeder', id: f.id }, message: `${f.id}: ${f.cores}C × ${f.cableCsaMm2} mm², ${f.lengthM} m — change size, cores and length in the properties` };
  }

  return { project, message: dropHint(item) };
}

/** Where an item can go, for when it's dropped somewhere it can't. */
export function dropHint(item: PaletteItem): string {
  switch (item.kind) {
    case 'board':
      return item.board === 'MC' ? 'Drop a meter cabinet on the empty canvas'
        : item.board === 'MDB' ? 'Drop an MDB on the empty canvas, or on a meter cabinet busbar'
          : `Drop the ${item.board} on a busbar`;
    case 'transformer':
      return 'Drop a transformer on the empty canvas, or on a main board';
    case 'load':
    case 'library':
      return 'Drop a load on a busbar';
    case 'generator':
      return 'Drop the generator on the board it backs up (e.g. an EMDB)';
    case 'capacitor':
      return 'Drop the capacitor bank on a board';
    case 'device':
    case 'cable':
      return `Drop the ${item.kind === 'cable' ? 'cable' : 'device'} on a feeder`;
  }
}

// ---- Moving what's already on the diagram ----

/** Something picked up on the diagram: a feeder (load) or a board (moved
 * with its incomer). */
export type MoveItem = { kind: 'feeder'; id: string } | { kind: 'board'; id: string };

const descendants = (project: Project, boardId: string): Set<string> => {
  const out = new Set([boardId]);
  for (let added = true; added; ) {
    added = false;
    for (const b of project.boards) if (b.upstreamId && out.has(b.upstreamId) && !out.has(b.id)) { out.add(b.id); added = true; }
  }
  return out;
};

/** The feeder that moves: a load itself, or a board's incomer. */
function movingFeeder(project: Project, m: MoveItem): Feeder | undefined {
  if (m.kind === 'feeder') return project.feeders.find((f) => f.id === m.id);
  const b = project.boards.find((x) => x.id === m.id);
  return b?.upstreamId ? project.feeders.find((f) => f.feedsBoardId === b.id && f.boardId === b.upstreamId) : undefined;
}

export function canMove(project: Project, m: MoveItem, target: DropTarget): boolean {
  const f = movingFeeder(project, m);
  if (!f || target.type === 'canvas') return false;
  const toBoard = target.type === 'bus' ? target.boardId : project.feeders.find((x) => x.id === target.feederId)?.boardId;
  if (!toBoard) return false;
  if (target.type === 'feeder' && target.feederId === f.id) return false;
  if (target.type === 'bus' && toBoard === f.boardId && m.kind === 'feeder') {
    // Dropping on its own busbar: only as a "move to the end".
    return project.feeders.filter((x) => x.boardId === toBoard).slice(-1)[0]?.id !== f.id;
  }
  const board = f.feedsBoardId;
  if (board && descendants(project, board).has(toBoard)) return false; // not under itself
  return true;
}

/** Moves a feeder (or a board's incomer) to another busbar, or before
 * another feeder. Feeders on a new busbar are re-checked and upsized if the
 * new position needs it (longer upstream run, higher fault level). */
export function applyMove(project: Project, m: MoveItem, target: DropTarget): DropResult {
  const f = movingFeeder(project, m);
  if (!f || !canMove(project, m, target)) {
    return { project, message: m.kind === 'board' && !f ? 'A main board has no incomer to move' : 'It can’t go there' };
  }
  const before = target.type === 'feeder' ? project.feeders.find((x) => x.id === target.feederId)! : undefined;
  const toBoard = before ? before.boardId : (target as { boardId: string }).boardId;
  const moved: Feeder = { ...f, boardId: toBoard };
  const rest = project.feeders.filter((x) => x.id !== f.id);
  const at = before ? rest.findIndex((x) => x.id === before.id) : rest.length;
  let feeders = [...rest.slice(0, at), moved, ...rest.slice(at)];
  let boards = project.boards;
  if (f.feedsBoardId) boards = boards.map((b) => (b.id === f.feedsBoardId ? { ...b, upstreamId: toBoard } : b));
  let p: Project = { ...project, feeders, boards };
  const changedBus = toBoard !== f.boardId;
  if (changedBus && !f.feedsBoardId) {
    const r = applyRecommendation(moved, recommend(p, moved, 'fix'));
    feeders = feeders.map((x) => (x.id === moved.id ? r : x));
    p = { ...p, feeders };
  }
  const what = f.feedsBoardId ? f.feedsBoardId : f.name || f.id;
  const where = before ? `before ${before.name || before.id}` : `to the end of ${toBoard}`;
  return {
    project: p,
    select: f.feedsBoardId ? { type: 'board', id: f.feedsBoardId } : { type: 'feeder', id: f.id },
    message: changedBus ? `Moved ${what} from ${f.boardId} to ${toBoard}${before ? `, ${where}` : ''}` : `Moved ${what} ${where}`
  };
}
