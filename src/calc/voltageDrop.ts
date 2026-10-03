import { cables, getCable } from './cableTable';
import { rule } from '../database/catalog';
import { boardDemandKw, designCurrentA, incomerBasis, rOperatingOhmPerKm, runsOf, upstreamVoltageDropPct, type Status } from './electrical';
import { isScheduleCircuit, scheduleCircuits } from './loadSchedule';
import { boardsInSupplyOrder, loadTypeOf } from './summary';
import { isMotor, starterInfo, starterOf } from './motor';
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
  rOhmPerKm: number; // at the conductor temperature, one run
  xOhmPerKm: number;
  /** Final circuit on a DB's load schedule (the DB's worst one). */
  finalCircuit?: boolean;
  /** Incomers: what the drop is derived from — the governing phase's current and PF (signed sin φ), which can
   * differ from the phase that sets Ib (currentPhase). */
  vdBasis?: { currentPhase: 'R' | 'Y' | 'B'; phase: 'R' | 'Y' | 'B'; a: number; pf: number; sin: number; leading: boolean };
  /** Motors: total drop while starting (running drop × starting current multiple). */
  startPct?: number;
}

/** Drop allowed while a motor starts (source to motor terminals). */
export const motorStartVdLimit = () => rule('motorStartVdLimitPct');

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
  // Incomers: P and Q of everything downstream (not the stored PF). The current and the drop can be
  // governed by different phases; the drop is derived from its own phase's current and PF.
  const inc = f.feedsBoardId ? incomerBasis(f, project) : undefined;
  const pf = inc ? inc.current.pf : f.powerFactor;
  const vdA = inc ? inc.vd.a : ib;
  const vdPf = inc ? inc.vd.pf : pf;
  const sin = inc ? inc.vd.sin : Math.sqrt(Math.max(0, 1 - pf * pf));
  const threePhase = f.cores >= 3;
  // Ω/km equals mV per A per m; 3-phase: √3·Z against the line voltage,
  // single-phase: phase + neutral (2·Z) against the phase voltage.
  const rOhmPerKm = rOperatingOhmPerKm(f.cableCsaMm2, project.vdTempC);
  const xOhmPerKm = getCable(f.cableCsaMm2).xOhmPerKm;
  const z = (rOhmPerKm * vdPf + xOhmPerKm * sin) / runsOf(f);
  const mvPerAm = (threePhase ? SQRT3 : 2) * z;
  const vdV = (mvPerAm * vdA * f.lengthM) / 1000;
  const baseV = threePhase ? project.voltageV : project.voltageV / SQRT3;
  const vdPct = (vdV / baseV) * 100;
  const upstreamPct = upstreamVoltageDropPct(project, f.boardId);
  const totalPct = upstreamPct + vdPct;
  const limitPct = project.vdLimitPct;
  const startPct = isMotor(f) ? upstreamPct + vdPct * starterInfo(starterOf(f)).multiple : undefined;
  return {
    feeder: f,
    from,
    toBoard,
    toName: toBoard ? toBoard.id : f.name || f.id,
    toType: toBoard ? toBoard.kind ?? 'DB' : isMotor(f) ? `${typeLabel(f)} (${starterInfo(starterOf(f)).short})` : typeLabel(f),
    loadKw: f.feedsBoardId ? boardDemandKw(project, f.feedsBoardId) : f.loadKw * f.demandFactor,
    scheduleCircuits: f.feedsBoardId ? scheduleCircuits(project, f.feedsBoardId).length : 0,
    pf,
    ib,
    vdBasis: inc ? { currentPhase: inc.current.phase, phase: inc.vd.phase, a: vdA, pf: vdPf, sin, leading: sin < -1e-9 } : undefined,
    threePhase,
    mvPerAm,
    vdV,
    vdPct,
    upstreamPct,
    totalPct,
    limitPct,
    // A motor whose drop while starting exceeds its limit fails, even when the running drop is fine.
    status: totalPct > limitPct || (startPct !== undefined && startPct > motorStartVdLimit()) ? 'bad' : totalPct > limitPct * 0.85 ? 'warn' : 'ok',
    rOhmPerKm,
    xOhmPerKm,
    finalCircuit: isScheduleCircuit(f) || undefined,
    startPct
  };
}

/** The supply path to a cable: every incomer from the main board down,
 * then the cable itself — for the voltage drop profile. */
export function vdPath(project: Project, f: Feeder): VdRow[] {
  const chain: Feeder[] = [f];
  let b = project.boards.find((x) => x.id === f.boardId);
  const seen = new Set<string>();
  while (b?.upstreamId && !seen.has(b.id)) {
    seen.add(b.id);
    const inc = project.feeders.find((x) => x.boardId === b!.upstreamId && x.feedsBoardId === b!.id);
    if (!inc) break;
    chain.unshift(inc);
    b = project.boards.find((x) => x.id === b!.upstreamId);
  }
  return chain.map((x) => vdRow(project, x));
}

/** Smallest cable size (same runs) that brings the total drop within the
 * limit, never smaller than now; undefined when none does. */
export function suggestCable(project: Project, f: Feeder): { csaMm2: number; totalPct: number } | undefined {
  for (const c of cables()) {
    if (c.csaMm2 <= f.cableCsaMm2) continue;
    const r = vdRow(project, { ...f, cableCsaMm2: c.csaMm2 });
    if (r.totalPct <= r.limitPct) return { csaMm2: c.csaMm2, totalPct: r.totalPct };
  }
  return undefined;
}

/** Each DB's worst final circuit (highest source-to-end drop). */
export function worstFinalCircuits(project: Project): VdRow[] {
  return boardsInSupplyOrder(project).flatMap((b) => {
    const rows = scheduleCircuits(project, b.id).filter((f) => f.lengthM > 0 && f.loadKw > 0).map((f) => vdRow(project, f));
    const w = rows.reduce<VdRow | undefined>((m, r) => (!m || r.totalPct > m.totalPct ? r : m), undefined);
    return w ? [w] : [];
  });
}

/** The row's calculation written out, for the page and the report. */
export function vdFormula(project: Project, r: VdRow): string {
  const runs = runsOf(r.feeder);
  const b = r.vdBasis;
  const a = b ? b.a : r.ib, pf = b ? b.pf : r.pf, sin = b ? b.sin : Math.sqrt(Math.max(0, 1 - r.pf * r.pf));
  const k = r.threePhase ? '√3' : '2';
  const base = r.threePhase ? project.voltageV : project.voltageV / SQRT3;
  const basis = b
    ? `Incomer, from the downstream P and Q: drop on phase ${b.phase} (${a.toFixed(1)} A, PF ${pf.toFixed(3)}${b.leading ? ' leading' : ''})${b.phase !== b.currentPhase ? `; the current ${r.ib.toFixed(1)} A is on phase ${b.currentPhase}` : ''}. `
    : '';
  return `${basis}ΔV = ${k} × I × L × (R cosφ + X sinφ)${runs > 1 ? ` ÷ ${runs} runs` : ''} = ${k} × ${a.toFixed(1)} A × ${(r.feeder.lengthM / 1000).toFixed(3)} km × (${r.rOhmPerKm.toFixed(3)} × ${pf.toFixed(3)} + ${r.xOhmPerKm.toFixed(3)} × ${sin.toFixed(3)}) Ω/km = ${r.vdV.toFixed(2)} V = ${r.vdPct.toFixed(2)} % of ${base.toFixed(0)} V; + ${r.upstreamPct.toFixed(2)} % upstream = ${r.totalPct.toFixed(2)} %`;
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
