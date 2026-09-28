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

/** Selectivity between two breakers in series (up feeds down). */
export function selectivityPair(project: Project, up: Feeder, down: Feeder): SelectivityResult {
  const ratio = up.breakerRatingA / down.breakerRatingA;
  const ratioOk = ratio >= 1.6;
  const faultKA = evaluateFeeder(project, down).breakerFaultKA;
  const limitKA = instantaneousNoTripA(up) / 1000;
  const shortCircuit = limitKA >= faultKA ? 'total' : 'partial';
  const status: Status = !ratioOk && up.breakerRatingA <= down.breakerRatingA ? 'bad' : ratioOk && shortCircuit === 'total' ? 'ok' : 'warn';
  return { upstream: up, downstream: down, ratio, ratioOk, faultKA, limitKA, shortCircuit, status };
}

/** The breakers a feeder's supply passes through, nearest first: the
 * incomer of its board, then that board's incomer, up to the main board. */
export function upstreamBreakers(project: Project, f: Feeder): Feeder[] {
  const out: Feeder[] = [];
  const seen = new Set<string>();
  for (let boardId = f.boardId; !seen.has(boardId); ) {
    seen.add(boardId);
    const inc = project.feeders.find((x) => x.feedsBoardId === boardId && project.boards.find((b) => b.id === boardId)?.upstreamId === x.boardId);
    if (!inc) break;
    out.push(inc);
    boardId = inc.boardId;
  }
  return out;
}

/** Discrimination along a feeder's supply: each breaker with the one
 * above it, from the feeder up to the main board. */
export function discriminationChain(project: Project, f: Feeder): SelectivityResult[] {
  const chain = [f, ...upstreamBreakers(project, f)];
  return chain.slice(0, -1).map((down, i) => selectivityPair(project, chain[i + 1], down));
}

/** Current-based selectivity between a sub-board's incoming breaker and
 * each outgoing breaker on that board (see selectivityPair):
 *  - overload region: In(up) / In(down) ≥ 1.6;
 *  - short-circuit region: total if the upstream breaker's magnetic
 *    no-trip threshold is above the maximum fault at the downstream breaker,
 *    otherwise partial up to that threshold (the manufacturer's selectivity
 *    tables may still show total selectivity through energy limitation). */
export function evaluateSelectivity(project: Project): SelectivityResult[] {
  const out: SelectivityResult[] = [];
  for (const up of project.feeders.filter((f) => f.feedsBoardId)) {
    for (const down of project.feeders.filter((f) => f.boardId === up.feedsBoardId)) out.push(selectivityPair(project, up, down));
  }
  return out;
}
