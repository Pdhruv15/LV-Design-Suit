import type { Board, Project } from '../types';
import { breakerRatings, icuSteps } from '../calc/sizing';
import { faultCurrentKA, impedanceToBoard } from '../calc/electrical';

/** Emergency supply changeover of a board with a standby generator (an EMDB).
 *
 * ATS: one 4P automatic transfer switch with a switched neutral.
 * Interlocked: two incomers into the busbar — mains and generator — each with
 * its own 4P breaker (ACB from 630 A, MCCB below, ACBs draw-out), kept apart
 * by an electro-mechanical interlock, one closed at a time. Each incomer has
 * its own instruments, PMU and SPD, as on DEWA submission drawings. */

export const ACB_FROM_A = 630;

export const isInterlocked = (b: Board) => b.standby?.changeover === 'ACB';

/** Incomers that carry instruments, PMU and SPD: two on an interlocked changeover. */
export const incomersOf = (b: Board) => (isInterlocked(b) ? 2 : 1);

/** The board's rating as the BOQ reads it: rated current, else the supply or the incoming breaker. */
export function boardRatingA(project: Project, b: Board): number | undefined {
  return b.ratedCurrentA ?? (!b.upstreamId ? b.supply?.ratingA : undefined) ?? project.feeders.find((f) => f.feedsBoardId === b.id)?.breakerRatingA;
}

const next = (list: number[], v: number) => list.find((x) => x >= v - 1e-9) ?? list[list.length - 1];

/** Generator full-load current (A) at the project voltage. */
export const generatorFlcA = (kva: number, voltageV: number) => (kva * 1000) / (Math.sqrt(3) * voltageV);

export interface IncomerBreaker { ratingA?: number; device: 'ACB' | 'MCCB'; drawOut: boolean; icuKa?: number; irSetting?: number }

const breaker = (ratingA: number | undefined, icuKa: number | undefined, irSetting?: number): IncomerBreaker => {
  const device = (ratingA ?? 0) >= ACB_FROM_A ? 'ACB' : 'MCCB';
  return { ratingA, device, drawOut: device === 'ACB', icuKa, irSetting };
};

/** Breaking capacity for both incomers: the incoming breaker's Icu, else the next standard step above the board's fault level. */
function icuOf(project: Project, b: Board): number | undefined {
  const inc = project.feeders.find((f) => f.feedsBoardId === b.id);
  if (inc?.breakerIcuKa) return inc.breakerIcuKa;
  if (b.supply?.faultKa) return b.supply.faultKa;
  const isc = faultCurrentKA(impedanceToBoard(project, b.id), project.voltageV);
  return Number.isFinite(isc) && isc > 0 ? next(icuSteps(), isc) : undefined;
}

/** Mains and generator incomer breakers of an interlocked changeover. */
export function changeoverBreakers(project: Project, b: Board): { mains: IncomerBreaker; generator: IncomerBreaker } | undefined {
  if (!b.standby || !isInterlocked(b)) return undefined;
  const icu = icuOf(project, b);
  const ir = b.protection?.irSetting ?? b.supply?.irSetting;
  return {
    mains: breaker(boardRatingA(project, b), icu, ir),
    generator: breaker(next(breakerRatings(), generatorFlcA(b.standby.kva, project.voltageV)), icu)
  };
}

export interface AtsDetail { ratingA?: number; transition: 'open' | 'closed'; category: 'AC-31B' | 'AC-33B' }

/** The ATS as written on the SLD and in the BOQ: rating, transition and category (always 4P, switched neutral). */
export function atsOf(project: Project, b: Board): AtsDetail | undefined {
  if (!b.standby || isInterlocked(b)) return undefined;
  return { ratingA: b.standby.atsRatingA ?? boardRatingA(project, b), transition: b.standby.transition ?? 'open', category: b.standby.category ?? 'AC-33B' };
}

/** "ATS 250 A 4P", then the detail lines under it. */
export const atsLines = (a: AtsDetail) => [`ATS${a.ratingA ? ` ${a.ratingA} A` : ''} 4P`, 'SWITCHED NEUTRAL', `${a.transition === 'closed' ? 'CLOSED' : 'OPEN'} TRANSITION`, a.category];

/** "800A" / "4P, 50KA, SET@0.85" / "ACB (DOT)" as on DEWA drawings. */
export function breakerLines(k: IncomerBreaker): string[] {
  return [
    k.ratingA ? `${k.ratingA}A` : '—',
    ['4P', k.icuKa ? `${k.icuKa}KA` : '', k.irSetting ? `SET@${k.irSetting}` : ''].filter(Boolean).join(', '),
    `${k.device}${k.drawOut ? ' (DOT)' : ''}`
  ];
}
