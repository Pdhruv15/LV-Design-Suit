import { evaluateFeeder, type Status } from './electrical';
import { breakerTypeOf, instantaneousTripA } from './earthing';
import type { Feeder, Project } from '../types';

/** Lower edge of the magnetic band — the largest current at which the
 * breaker is guaranteed NOT to trip instantaneously: 3/5/10 In for MCB
 * types B/C/D (IEC 60898-1); Im − 20 % tolerance for MCCB/ACB. */
export function instantaneousNoTripA(f: Feeder): number {
  switch (breakerTypeOf(f)) {
    case 'B':
      return 3 * f.breakerRatingA;
    case 'C':
      return 5 * f.breakerRatingA;
    case 'D':
      return 10 * f.breakerRatingA;
    default:
      return 0.8 * (f.breakerImMultiple ?? 10) * f.breakerRatingA;
  }
}

/** Generic inverse-time characteristic for plotting: t = A / ((I/In)² − 1)
 * in the thermal region, stepping down to 20 ms at the magnetic threshold.
 * This is a representative shape (≈ 1.45 In in minutes, 3 In in about a
 * minute), NOT manufacturer data — use the device's published curves for
 * final coordination. Returns Infinity below 1.05 In (no trip). */
const THERMAL_A = 500;
export function genericTripTimeS(f: Feeder, currentA: number, magneticAt = instantaneousTripA(f)): number {
  const m = currentA / f.breakerRatingA;
  if (m <= 1.05) return Infinity;
  if (currentA >= magneticAt) return 0.02;
  return Math.min(THERMAL_A / (m * m - 1), 10000);
}

export interface SelectivityResult {
  upstream: Feeder;
  downstream: Feeder;
  ratio: number; // In upstream ÷ In downstream
  ratioOk: boolean; // ≥ 1.6 gives overload (time) selectivity
  faultKA: number; // maximum fault at the downstream breaker
  limitKA: number; // current selectivity limit = upstream magnetic no-trip threshold
  shortCircuit: 'total' | 'partial';
  status: Status;
}

/** Current-based selectivity between a sub-board's incoming breaker and
 * each outgoing breaker on that board:
 *  - overload region: In(up) / In(down) ≥ 1.6;
 *  - short-circuit region: total if the upstream breaker's magnetic
 *    no-trip threshold is above the maximum fault at the downstream breaker,
 *    otherwise partial up to that threshold (the manufacturer's selectivity
 *    tables may still show total selectivity through energy limitation). */
export function evaluateSelectivity(project: Project): SelectivityResult[] {
  const out: SelectivityResult[] = [];
  for (const up of project.feeders.filter((f) => f.feedsBoardId)) {
    for (const down of project.feeders.filter((f) => f.boardId === up.feedsBoardId)) {
      const ratio = up.breakerRatingA / down.breakerRatingA;
      const ratioOk = ratio >= 1.6;
      const faultKA = evaluateFeeder(project, down).breakerFaultKA;
      const limitKA = instantaneousNoTripA(up) / 1000;
      const shortCircuit = limitKA >= faultKA ? 'total' : 'partial';
      const status: Status = !ratioOk && up.breakerRatingA <= down.breakerRatingA ? 'bad' : ratioOk && shortCircuit === 'total' ? 'ok' : 'warn';
      out.push({ upstream: up, downstream: down, ratio, ratioOk, faultKA, limitKA, shortCircuit, status });
    }
  }
  return out;
}
