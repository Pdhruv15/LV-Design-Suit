import type { Feeder, LoadType } from '../types';
import { phaseTag } from './phases';

/** Where a board's single line diagram stops (UAE practice): the SLD shows a
 * board's incomer, every feeder to another board and every feeder to major
 * equipment; ordinary lighting and power final circuits are not drawn one by
 * one — they are one line referring to the DB load schedule. */

/** Single-phase circuits above this breaker rating stay on the SLD as dedicated equipment feeders. */
export const SLD_FINAL_CIRCUIT_MAX_A = 20;

const EQUIPMENT: LoadType[] = ['motor', 'fire-pump', 'ev', 'capacitor', 'pv'];

/** True when the outgoing way belongs on the SLD: it feeds a board, is 3-phase,
 * supplies major equipment (motor, fire pump, EV charger, capacitor bank,
 * PV / generation) or is rated above {@link SLD_FINAL_CIRCUIT_MAX_A} A. */
export function onSld(f: Feeder): boolean {
  return !!f.feedsBoardId
    || !!f.generation
    || EQUIPMENT.includes(f.loadType ?? 'general')
    || phaseTag(f) === 'RYB'
    || f.breakerRatingA > SLD_FINAL_CIRCUIT_MAX_A;
}

/** A board's outgoing ways split into those drawn on the SLD and the final circuits left to the DB schedule. */
export function splitSld<T>(items: T[], feederOf: (t: T) => Feeder): { drawn: T[]; final: T[] } {
  const drawn: T[] = [], final: T[] = [];
  for (const t of items) (onSld(feederOf(t)) ? drawn : final).push(t);
  return { drawn, final };
}
