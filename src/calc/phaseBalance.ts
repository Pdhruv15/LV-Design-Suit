import type { Feeder, Project } from '../types';
import { boardPhasePQ } from './loadSchedule';
import { subtree } from './pfc';
import type { Status } from './electrical';

/** Phase balance of each board from the demand allocated to R / Y / B — a
 * step before an unbalanced load flow, not one. Basis and limits:
 * - demand P and Q per phase from boardPhasePQ (single-phase circuits on their
 *   labelled phase, 3-phase loads spread evenly, downstream boards included);
 * - phase current I = S_phase ÷ U0 at nominal voltage (no voltage drop, no
 *   voltage unbalance — that needs a load flow);
 * - neutral current = phasor sum of the three phase currents, phases 120° apart
 *   at nominal balanced voltage, each at its own power factor angle;
 *   fundamental only — triplen harmonics add to the neutral and are not included;
 * - current unbalance = largest deviation from the average phase current ÷ the
 *   average (the NEMA MG 1 form of the definition, applied to current);
 * - single-phase circuits with no phase set are spread evenly, which hides
 *   their unbalance: they are counted and flagged. */

export const PHASE_UNBALANCE_CHECK_PCT = 10; // app default for flagging, not a standard's limit

export interface PhaseBalance {
  boardId: string;
  currentA: Record<'R' | 'Y' | 'B', number>;
  kw: Record<'R' | 'Y' | 'B', number>;
  neutralA: number;
  averageA: number;
  unbalancePct: number;
  unassigned: Feeder[]; // single-phase (2-core) circuits with no R / Y / B, in this board's subtree
  status: Status; // ok; warn: unbalance above the check value or circuits without a phase
}

const ANGLE = { R: 0, Y: (-2 * Math.PI) / 3, B: (2 * Math.PI) / 3 } as const;

export function phaseBalance(project: Project, boardId: string): PhaseBalance {
  const pq = boardPhasePQ(project, boardId);
  const u0 = project.voltageV / Math.sqrt(3);
  const phases = ['R', 'Y', 'B'] as const;
  const currentA = { R: 0, Y: 0, B: 0 }, kw = { R: 0, Y: 0, B: 0 };
  let nx = 0, ny = 0;
  for (const ph of phases) {
    const { p, q } = pq[ph];
    const i = (Math.hypot(p, q) * 1000) / u0;
    currentA[ph] = i;
    kw[ph] = p;
    const a = ANGLE[ph] - Math.atan2(q, p); // current lags its voltage by the load angle
    nx += i * Math.cos(a); ny += i * Math.sin(a);
  }
  const averageA = (currentA.R + currentA.Y + currentA.B) / 3;
  const unbalancePct = averageA > 0 ? (Math.max(...phases.map((ph) => Math.abs(currentA[ph] - averageA))) / averageA) * 100 : 0;
  const ids = subtree(project, boardId);
  const unassigned = project.feeders.filter((f) => ids.has(f.boardId) && !f.feedsBoardId && f.cores === 2 && (!f.phase || f.phase === 'RYB'));
  const status: Status = unbalancePct > PHASE_UNBALANCE_CHECK_PCT + 1e-9 || unassigned.length ? 'warn' : 'ok';
  return { boardId, currentA, kw, neutralA: Math.hypot(nx, ny), averageA, unbalancePct, unassigned, status };
}
