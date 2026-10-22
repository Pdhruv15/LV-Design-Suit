import type { Board, Feeder, Project } from '../types';
import { withNetwork } from './network';
import { boardPhasePQ } from './loadSchedule';
import { boardsInSupplyOrder } from './summary';
import { getCable } from './cableTable';
import { DEFAULT_TRANSFORMER_XR, feederRating, rOperatingOhmPerKm, runsOf, transformerImpedance, type Status } from './electrical';

/** Unbalanced (per-phase) load flow: a backward / forward sweep on the radial
 * network, phase by phase with the neutral conductor. Basis and limits:
 * - each board's demand per phase (boardPhasePQ: single-phase circuits on their
 *   phase, 3-phase loads spread evenly) taken at constant power at that
 *   board's own phase-to-neutral voltage; cable losses are not added upstream;
 * - source: the transformer (Dyn, Z0 ≈ Z1) as its own impedance in each phase,
 *   neutral earthed at the main board (TN-S), MV network infinite;
 * - each incomer: phase and neutral conductors with the cable's R at the
 *   voltage-drop temperature and X per km, neutral the same size as the phase,
 *   runs in parallel; mutual coupling between conductors neglected;
 * - voltage drop for the limit from the main busbar, as the balanced study:
 *   (|U main| − |U|) ÷ U0 per phase, the worst phase reported;
 * - voltage unbalance = negative ÷ positive sequence of the line voltages;
 * - fundamental only: triplen harmonics add to the neutral and are not included. */

export const VOLTAGE_UNBALANCE_LIMIT_PCT = 2; // IEC 61000-2-2 compatibility level

type C = { re: number; im: number };
const c = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
const sub = (a: C, b: C): C => c(a.re - b.re, a.im - b.im);
const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: C, b: C): C => { const m = b.re * b.re + b.im * b.im; return c((a.re * b.re + a.im * b.im) / m, (a.im * b.re - a.re * b.im) / m); };
const conj = (a: C): C => c(a.re, -a.im);
const abs = (a: C) => Math.hypot(a.re, a.im);
const polar = (m: number, ang: number): C => c(m * Math.cos(ang), m * Math.sin(ang));

const PHASES = ['R', 'Y', 'B'] as const;
type Ph = (typeof PHASES)[number];
type Three = Record<Ph, C>;
const ANGLE: Record<Ph, number> = { R: 0, Y: (-2 * Math.PI) / 3, B: (2 * Math.PI) / 3 };
const A = polar(1, (2 * Math.PI) / 3); // the operator a = 1∠120°

export interface UnbalancedBoard {
  boardId: string;
  /** Phase-to-neutral voltage at the busbar (V), transformer drop included. */
  voltageV: Record<Ph, number>;
  /** Drop from the main busbar per phase (%), negative where the neutral shift raises a phase. */
  vdPct: Record<Ph, number>;
  worstPhase: Ph;
  /** Current in the incomer's (or transformer's) neutral, A. */
  neutralA: number;
  /** Neutral-to-earth voltage at the busbar, V. */
  neutralShiftV: number;
  unbalancePct: number;
  /** Incomer neutral above the cable's rating (neutral the size of the phase). */
  neutralIz?: number;
  status: Status;
}

export interface UnbalancedCircuit {
  feeder: Feeder;
  phase: Ph | 'RYB';
  /** Lowest phase-to-neutral voltage at the far end, V. */
  endV: number;
  /** Worst-phase drop from the main busbar to the far end (%). */
  vdPct: number;
  status: Status;
}

export interface UnbalancedFlow {
  boards: UnbalancedBoard[];
  circuits: UnbalancedCircuit[];
  iterations: number;
  converged: boolean;
  /** Boards with no source data or incomer: not in the flow. */
  notEnergised: string[];
}

const cableZ = (project: Project, f: Feeder): C =>
  c((rOperatingOhmPerKm(f.cableCsaMm2, project.vdTempC) * f.lengthM) / 1000 / runsOf(f), (getCable(f.cableCsaMm2).xOhmPerKm * f.lengthM) / 1000 / runsOf(f));

const vdStatus = (pct: number, limit: number): Status => (pct > limit + 1e-9 ? 'bad' : pct > limit * 0.85 ? 'warn' : 'ok');

export function unbalancedFlow(project: Project, maxIterations = 50): UnbalancedFlow {
  return withNetwork(project, () => flow(project, maxIterations));
}

function flow(project: Project, maxIterations: number): UnbalancedFlow {
  const u0 = project.voltageV / Math.sqrt(3);
  const e0: Three = { R: polar(u0, ANGLE.R), Y: polar(u0, ANGLE.Y), B: polar(u0, ANGLE.B) };
  const order = boardsInSupplyOrder(project);
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const incomer = new Map<string, Feeder>();
  for (const f of project.feeders) if (f.feedsBoardId && byId.get(f.feedsBoardId)?.upstreamId === f.boardId && !incomer.has(f.feedsBoardId)) incomer.set(f.feedsBoardId, f);

  // Demand per phase (VA) of everything on and below each board.
  const demand = new Map<string, Three>();
  for (const b of order) { const pq = boardPhasePQ(project, b.id); demand.set(b.id, { R: c(pq.R.p * 1000, pq.R.q * 1000), Y: c(pq.Y.p * 1000, pq.Y.q * 1000), B: c(pq.B.p * 1000, pq.B.q * 1000) }); }

  // Which boards the flow reaches, each with its root (main board).
  const root = new Map<string, Board>();
  for (const b of order) {
    if (!b.upstreamId) { if (b.sourceKva && b.sourceImpedancePct) root.set(b.id, b); continue; }
    const r = root.get(b.upstreamId);
    if (r && incomer.has(b.id)) root.set(b.id, r);
  }
  const live = order.filter((b) => root.has(b.id));

  const ep = new Map<string, Three>(); // phase potentials to earth
  const en = new Map<string, C>(); // neutral potential to earth
  const v = new Map<string, Three>(); // phase-to-neutral
  const cur = new Map<string, Three>(); // incomer (or transformer) phase currents
  for (const b of live) { v.set(b.id, { ...e0 }); }

  let iterations = 0, converged = false;
  while (iterations < maxIterations && !converged) {
    iterations++;
    let change = 0;
    for (const b of live) {
      const s = demand.get(b.id)!, vb = v.get(b.id)!;
      const i: Three = { R: conj(div(s.R, vb.R)), Y: conj(div(s.Y, vb.Y)), B: conj(div(s.B, vb.B)) };
      let p: Three, n: C;
      if (!b.upstreamId) {
        const zt = transformerImpedance(b.sourceKva!, b.sourceImpedancePct!, project.voltageV, b.sourceXr ?? DEFAULT_TRANSFORMER_XR);
        const z = c(zt.r, zt.x);
        p = { R: sub(e0.R, mul(z, i.R)), Y: sub(e0.Y, mul(z, i.Y)), B: sub(e0.B, mul(z, i.B)) };
        n = c(0);
      } else {
        const z = cableZ(project, incomer.get(b.id)!);
        const up = ep.get(b.upstreamId)!;
        p = { R: sub(up.R, mul(z, i.R)), Y: sub(up.Y, mul(z, i.Y)), B: sub(up.B, mul(z, i.B)) };
        n = add(en.get(b.upstreamId)!, mul(z, add(add(i.R, i.Y), i.B))); // neutral return current raises the star point
      }
      const next: Three = { R: sub(p.R, n), Y: sub(p.Y, n), B: sub(p.B, n) };
      for (const ph of PHASES) change = Math.max(change, abs(sub(next[ph], vb[ph])));
      ep.set(b.id, p); en.set(b.id, n); v.set(b.id, next); cur.set(b.id, i);
    }
    converged = change < u0 * 1e-7;
  }

  const limit = project.vdLimitPct;
  const boards = live.map((b): UnbalancedBoard => {
    const vb = v.get(b.id)!, vm = v.get(root.get(b.id)!.id)!, i = cur.get(b.id)!, p = ep.get(b.id)!;
    const voltageV = { R: abs(vb.R), Y: abs(vb.Y), B: abs(vb.B) };
    const vdPct = { R: 0, Y: 0, B: 0 };
    for (const ph of PHASES) vdPct[ph] = ((abs(vm[ph]) - voltageV[ph]) / u0) * 100;
    const worstPhase = PHASES.reduce((w, ph) => (vdPct[ph] > vdPct[w] ? ph : w), 'R' as Ph);
    const neutralA = abs(add(add(i.R, i.Y), i.B));
    // Sequence components of the phase potentials (the zero sequence drops out of the line voltages).
    const a2 = mul(A, A);
    const v1 = abs(add(add(p.R, mul(A, p.Y)), mul(a2, p.B)));
    const v2 = abs(add(add(p.R, mul(a2, p.Y)), mul(A, p.B)));
    const unbalancePct = v1 > 0 ? (v2 / v1) * 100 : 0;
    const inc = incomer.get(b.id);
    const iz = inc ? feederRating(project, inc).iz : undefined;
    const neutralIz = iz !== undefined && Number.isFinite(iz) && neutralA > iz + 1e-9 ? iz : undefined;
    const statuses: Status[] = [vdStatus(vdPct[worstPhase], limit), unbalancePct > VOLTAGE_UNBALANCE_LIMIT_PCT + 1e-9 ? 'warn' : 'ok', neutralIz !== undefined ? 'bad' : 'ok'];
    return {
      boardId: b.id, voltageV, vdPct, worstPhase, neutralA, neutralShiftV: abs(en.get(b.id)!), unbalancePct, neutralIz,
      status: statuses.includes('bad') ? 'bad' : statuses.includes('warn') ? 'warn' : 'ok'
    };
  });

  const circuits: UnbalancedCircuit[] = [];
  for (const f of project.feeders) {
    if (f.feedsBoardId || f.kvar || f.generation || !root.has(f.boardId)) continue;
    const vb = v.get(f.boardId)!, vm = v.get(root.get(f.boardId)!.id)!;
    const z = cableZ(project, f);
    const kw = f.loadKw * f.demandFactor;
    const pf = Math.min(Math.max(f.powerFactor, 0.01), 1);
    const s = c(kw * 1000, kw * 1000 * Math.tan(Math.acos(pf)));
    const ends: { ph: Ph; u: number }[] = [];
    let phase: Ph | 'RYB' = 'RYB';
    if (f.cores === 2) {
      // Phase + neutral loop. No phase set: taken on the lowest phase (the worst case).
      const on = f.phase && f.phase !== 'RYB' ? [f.phase] : PHASES;
      if (on.length === 1) phase = on[0];
      for (const ph of on) { const i = conj(div(s, vb[ph])); ends.push({ ph, u: abs(sub(vb[ph], mul(c(2 * z.re, 2 * z.im), i))) }); }
    } else {
      const third = c(s.re / 3, s.im / 3);
      for (const ph of PHASES) { const i = conj(div(third, vb[ph])); ends.push({ ph, u: abs(sub(vb[ph], mul(z, i))) }); }
    }
    const worst = ends.reduce((w, e) => ((abs(vm[e.ph]) - e.u) > (abs(vm[w.ph]) - w.u) ? e : w));
    const vdPct = ((abs(vm[worst.ph]) - worst.u) / u0) * 100;
    circuits.push({ feeder: f, phase, endV: Math.min(...ends.map((e) => e.u)), vdPct, status: vdStatus(vdPct, limit) });
  }

  return { boards, circuits, iterations, converged, notEnergised: order.filter((b) => !root.has(b.id)).map((b) => b.id) };
}
