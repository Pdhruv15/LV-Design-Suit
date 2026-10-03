import { faultCurrentKA, impedanceToBoard, upstreamVoltageDropPct, type Status } from './electrical';
import { settingsOf, type Board, type Feeder, type LoadType, type Project } from '../types';
import { switchedOnBoard } from './capSwitching';

const SQRT3 = Math.sqrt(3);

export function loadTypeOf(f: Feeder): LoadType {
  return f.loadType ?? (f.generation ? 'pv' : 'general');
}

export interface PowerTotals {
  connectedKw: number; // sum of nameplate loads
  demandKw: number; // after demand factors
  demandKvar: number;
  generationKw: number; // PV / generator feeders, reported separately
}

const ZERO: PowerTotals = { connectedKw: 0, demandKw: 0, demandKvar: 0, generationKw: 0 };

function add(a: PowerTotals, b: PowerTotals): PowerTotals {
  return {
    connectedKw: a.connectedKw + b.connectedKw,
    demandKw: a.demandKw + b.demandKw,
    demandKvar: a.demandKvar + b.demandKvar,
    generationKw: a.generationKw + b.generationKw
  };
}

/** Everything supplied through a board, including all downstream boards.
 * Real and reactive power are summed separately, so the combined kVA and
 * power factor are correct for loads with different power factors. */
export function boardTotals(project: Project, boardId: string, seen = new Set<string>()): PowerTotals {
  if (seen.has(boardId)) return ZERO;
  seen.add(boardId);
  const own = project.feeders.filter((f) => f.boardId === boardId);
  const caps = own.filter((f) => f.kvar && !f.feedsBoardId);
  const base = own.filter((f) => !caps.includes(f)).reduce((acc, f) => {
    if (f.feedsBoardId) return add(acc, boardTotals(project, f.feedsBoardId, seen));
    const kw = f.loadKw * f.demandFactor;
    if (f.generation) return add(acc, { ...ZERO, generationKw: kw });
    const pf = Math.min(Math.max(f.powerFactor, 0.01), 1);
    return add(acc, {
      connectedKw: f.loadKw,
      demandKw: kw,
      demandKvar: kw * Math.tan(Math.acos(pf)),
      generationKw: 0
    });
  }, ZERO);
  if (!caps.length) return base;
  // Capacitor banks: the steps the relay switches in at this load (no leading), not the full rating.
  const sw = switchedOnBoard(caps, base.demandKw, base.demandKvar, settingsOf(project).pfTarget);
  return { ...base, demandKvar: base.demandKvar - caps.reduce((a, c) => a + (sw.get(c.id) ?? 0), 0) };
}

export interface BoardSummary extends PowerTotals {
  board: Board;
  depth: number; // 0 for a main board
  demandKva: number;
  powerFactor: number;
  currentA: number; // balanced 3-phase demand current
  loadingPct?: number; // demand current vs board rating, when the rating is known
  loadingStatus?: Status;
  /** Busbar voltage as % of nominal, from the built-in engine's voltage-drop
   * figures: 100 % at the main board (transformer regulation not included)
   * minus the drops on the incomer cables above this board. */
  voltagePct: number;
  voltageV: number;
  faultKA: number; // 3-phase prospective fault at the busbar
  outgoing: number; // feeders on this board (including incomers to sub-boards)
  incomer?: Feeder; // the feeder supplying this board (sub-boards only)
}

function depthOf(project: Project, board: Board): number {
  let depth = 0;
  let current: Board | undefined = board;
  const seen = new Set<string>();
  while (current?.upstreamId && !seen.has(current.id)) {
    seen.add(current.id);
    depth++;
    current = project.boards.find((b) => b.id === current!.upstreamId);
  }
  return depth;
}

export function loadingStatus(pct: number): Status {
  return pct > 100 ? 'bad' : pct > 80 ? 'warn' : 'ok';
}

export function boardSummary(project: Project, board: Board): BoardSummary {
  const totals = boardTotals(project, board.id);
  const demandKva = Math.hypot(totals.demandKw, totals.demandKvar);
  const currentA = (demandKva * 1000) / (SQRT3 * project.voltageV);
  const loadingPct = board.ratedCurrentA ? (currentA / board.ratedCurrentA) * 100 : undefined;
  const voltagePct = 100 - upstreamVoltageDropPct(project, board.id);
  return {
    ...totals,
    board,
    depth: depthOf(project, board),
    demandKva,
    powerFactor: demandKva > 0 ? totals.demandKw / demandKva : 1,
    currentA,
    loadingPct,
    loadingStatus: loadingPct === undefined ? undefined : loadingStatus(loadingPct),
    voltagePct,
    voltageV: (project.voltageV * voltagePct) / 100,
    faultKA: faultCurrentKA(impedanceToBoard(project, board.id), project.voltageV),
    outgoing: project.feeders.filter((f) => f.boardId === board.id).length,
    incomer: project.feeders.find((f) => f.feedsBoardId === board.id && f.boardId === board.upstreamId)
  };
}

/** Boards in supply order (each main board followed by its sub-boards,
 * depth-first), so tables read top-down like the diagram. */
export function boardsInSupplyOrder(project: Project): Board[] {
  const out: Board[] = [];
  const seen = new Set<string>();
  const visit = (b: Board) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    out.push(b);
    for (const f of project.feeders.filter((f) => f.boardId === b.id && f.feedsBoardId)) {
      const child = project.boards.find((x) => x.id === f.feedsBoardId);
      if (child) visit(child);
    }
  };
  project.boards.filter((b) => !b.upstreamId).forEach(visit);
  project.boards.forEach(visit); // any board not reachable from a main board
  return out;
}

export interface SystemSummary extends PowerTotals {
  demandKva: number;
  powerFactor: number;
  currentA: number;
  transformerKva: number; // sum over main boards
  transformerLoadingPct?: number;
  transformerLoadingStatus?: Status;
}

export function systemSummary(project: Project): SystemSummary {
  const mains = project.boards.filter((b) => !b.upstreamId);
  const totals = mains.reduce((acc, b) => add(acc, boardTotals(project, b.id)), ZERO);
  const demandKva = Math.hypot(totals.demandKw, totals.demandKvar);
  const transformerKva = mains.reduce((s, b) => s + (b.sourceKva ?? 0), 0);
  const transformerLoadingPct = transformerKva > 0 ? (demandKva / transformerKva) * 100 : undefined;
  return {
    ...totals,
    demandKva,
    powerFactor: demandKva > 0 ? totals.demandKw / demandKva : 1,
    currentA: (demandKva * 1000) / (SQRT3 * project.voltageV),
    transformerKva,
    transformerLoadingPct,
    transformerLoadingStatus: transformerLoadingPct === undefined ? undefined : loadingStatus(transformerLoadingPct)
  };
}
