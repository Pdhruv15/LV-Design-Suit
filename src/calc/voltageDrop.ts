import { getCable } from './cableTable';
import { boardDemandKw, designCurrentA, rOperatingOhmPerKm, runsOf, upstreamVoltageDropPct, type Status } from './electrical';
import { isScheduleCircuit, scheduleCircuits } from './loadSchedule';
import { boardsInSupplyOrder, loadTypeOf } from './summary';
import { LOAD_TYPES, type Board, type Feeder, type Project } from '../types';

const SQRT3 = Math.sqrt(3);

/** One cable in the voltage drop calculation: from a panel to a panel
 * (MDB → SMDB → DB) or to equipment (motor, AHU, isolator…). */
export interface VdRow {
  feeder: Feeder;
  from: Board;
  /** Board fed by this cable, or undefined when it feeds equipment. */
  toBoard?: Board;
  /** Board id, or the equipment name. */
  toName: string;
  /** e.g. "SMDB", "DB", "Motor", "HVAC". */
  toType: string;
  /** Demand load carried by the cable (kW). A panel's load is the demand of
   * everything below it, including its DB load schedule circuits. */
  loadKw: number;
  /** Final circuits on the fed DB's load schedule (0 when not a DB). */
  scheduleCircuits: number;
  pf: number;
  ib: number;
  threePhase: boolean;
  /** Voltage drop per ampere per metre at the load's power factor. */
  mvPerAm: number;
  vdV: number;
  vdPct: number;
  /** Source to the From panel's busbar. */
  upstreamPct: number;
  totalPct: number;
  limitPct: number;
  status: Status;
}

/** Cables that belong in a voltage drop calculation: every feeder except
 * the final circuits on a DB's load schedule (those end at the DB). */
export const isVdCable = (f: Feeder) => !isScheduleCircuit(f);

/** Every candidate cable, in supply order (MDB first, then each panel below
 * it), so the calculation reads top-down like the SLD. */
export function vdCandidates(project: Project): Feeder[] {
  return boardsInSupplyOrder(project).flatMap((b) => project.feeders.filter((f) => f.boardId === b.id && isVdCable(f)));
}

const typeLabel = (f: Feeder) => LOAD_TYPES.find((t) => t.value === loadTypeOf(f))?.label ?? 'Load';

export function vdRow(project: Project, f: Feeder): VdRow {
  const from = project.boards.find((b) => b.id === f.boardId) ?? { id: f.boardId, name: f.boardId };
  const toBoard = f.feedsBoardId ? project.boards.find((b) => b.id === f.feedsBoardId) : undefined;
  const ib = designCurrentA(f, project);
  const pf = f.powerFactor;
  const sin = Math.sqrt(Math.max(0, 1 - pf * pf));
  const threePhase = f.cores >= 3;
  // Ω/km equals mV per A per m; 3-phase: √3·Z against the line voltage,
  // single-phase: phase + neutral (2·Z) against the phase voltage.
  const z = (rOperatingOhmPerKm(f.cableCsaMm2) * pf + getCable(f.cableCsaMm2).xOhmPerKm * sin) / runsOf(f);
  const mvPerAm = (threePhase ? SQRT3 : 2) * z;
  const vdV = (mvPerAm * ib * f.lengthM) / 1000;
  const baseV = threePhase ? project.voltageV : project.voltageV / SQRT3;
  const vdPct = (vdV / baseV) * 100;
  const upstreamPct = upstreamVoltageDropPct(project, f.boardId);
  const totalPct = upstreamPct + vdPct;
  const limitPct = project.vdLimitPct;
  return {
    feeder: f,
    from,
    toBoard,
    toName: toBoard ? toBoard.id : f.name || f.id,
    toType: toBoard ? toBoard.kind ?? 'DB' : typeLabel(f),
    loadKw: f.feedsBoardId ? boardDemandKw(project, f.feedsBoardId) : f.loadKw * f.demandFactor,
    scheduleCircuits: f.feedsBoardId ? scheduleCircuits(project, f.feedsBoardId).length : 0,
    pf,
    ib,
    threePhase,
    mvPerAm,
    vdV,
    vdPct,
    upstreamPct,
    totalPct,
    limitPct,
    status: totalPct > limitPct ? 'bad' : totalPct > limitPct * 0.85 ? 'warn' : 'ok'
  };
}

/** Rows for the selected cables, in supply order. Ids that no longer exist
 * (or are now final circuits) are skipped. */
export function vdRows(project: Project, selected: Iterable<string>): VdRow[] {
  const ids = new Set(selected);
  return vdCandidates(project).filter((f) => ids.has(f.id)).map((f) => vdRow(project, f));
}

/** Rows grouped by the panel they're fed from, in supply order. */
export function groupByPanel(rows: VdRow[]): { board: Board; rows: VdRow[] }[] {
  const out: { board: Board; rows: VdRow[] }[] = [];
  for (const r of rows) {
    const g = out.find((x) => x.board.id === r.from.id);
    if (g) g.rows.push(r);
    else out.push({ board: r.from, rows: [r] });
  }
  return out;
}

export type VdEdit = Partial<Pick<Feeder, 'name' | 'loadKw' | 'powerFactor' | 'lengthM' | 'cableCsaMm2' | 'cores' | 'remarks'>>;

/** Applies an edit from the voltage drop table to the project, so the SLD,
 * schedules and every other study see the same values. A panel's load comes
 * from what's below it, so loadKw is ignored for panel feeders. */
export function editVdCable(project: Project, feederId: string, edit: VdEdit): Project {
  return {
    ...project,
    feeders: project.feeders.map((f) => {
      if (f.id !== feederId) return f;
      const e = f.feedsBoardId ? { ...edit, loadKw: undefined } : edit;
      const next = { ...f };
      for (const [k, v] of Object.entries(e)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
      if ('remarks' in edit && !edit.remarks) delete next.remarks;
      return next;
    })
  };
}

/** Adds an equipment cable (e.g. to an AHU or isolator) on a panel. */
export function addVdCable(project: Project, boardId: string): { project: Project; id: string } {
  let n = 1;
  while (project.feeders.some((f) => f.id === `${boardId}-EQ${n}`)) n++;
  const id = `${boardId}-EQ${n}`;
  const f: Feeder = {
    id, boardId, name: `Equipment ${n}`, loadKw: 10, demandFactor: 1, powerFactor: 0.85, lengthM: 20,
    cableCsaMm2: 6, cores: 4, breakerRatingA: 32, breakerIcuKa: 25, breakerType: 'C', loadType: 'general'
  };
  return { project: { ...project, feeders: [...project.feeders, f] }, id };
}
