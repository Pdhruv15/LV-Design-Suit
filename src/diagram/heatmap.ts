import type { FeederResult } from '../calc/electrical';
import type { BoardSummary } from '../calc/summary';
import type { EarthingResult } from '../calc/earthing';

/** Colouring the SLD by a result, as a share of its limit: 0.5 and below
 * green, amber around the 85 % warning level, red at the limit and above. */
export type ColorBy = 'none' | 'vd' | 'loading' | 'utilisation' | 'fault' | 'earth';

export const COLOR_BY: { value: ColorBy; label: string; legend: string }[] = [
  { value: 'none', label: 'None', legend: '' },
  { value: 'vd', label: 'Voltage drop', legend: 'Total voltage drop ÷ limit' },
  { value: 'loading', label: 'Breaker loading', legend: 'Design current ÷ breaker rating' },
  { value: 'utilisation', label: 'Cable utilisation', legend: 'Design current ÷ cable rating (Iz)' },
  { value: 'fault', label: 'Fault duty', legend: 'Fault at the breaker ÷ its breaking capacity' },
  { value: 'earth', label: 'Earth fault loop', legend: 'Zs ÷ largest Zs that still disconnects in time' }
];

/** Earth fault loop as a share of its limit, coloured by the check's own
 * result: disconnection in time stays green–amber, a 5 s circuit relying on
 * the thermal region is amber, too slow is red. */
export function earthRatio(e: EarthingResult): number {
  const r = e.maxZsOhm > 0 ? e.zsOhm / e.maxZsOhm : 2;
  if (e.status === 'bad') return Math.max(1, r);
  if (e.status === 'warn') return Math.min(Math.max(r, 0.86), 0.99);
  return Math.min(r, 0.84);
}

/** A feeder's value for the chosen colouring, as a fraction of its limit. */
export function feederRatio(r: FeederResult, by: ColorBy, vdLimitPct: number): number | undefined {
  switch (by) {
    case 'vd': return r.vdTotalPct / vdLimitPct;
    case 'loading': return r.ib / r.feeder.breakerRatingA;
    case 'utilisation': return r.ampacity > 0 ? r.ib / r.ampacity : undefined;
    case 'fault': return r.feeder.breakerIcuKa > 0 ? r.breakerFaultKA / r.feeder.breakerIcuKa : undefined;
    default: return undefined;
  }
}

/** A board's value: its busbar voltage drop, or its loading. */
export function boardRatio(s: BoardSummary, upstreamVdPct: number, by: ColorBy, vdLimitPct: number): number | undefined {
  if (by === 'vd') return upstreamVdPct / vdLimitPct;
  if (by === 'loading' || by === 'utilisation') return s.loadingPct !== undefined ? s.loadingPct / 100 : undefined;
  return undefined;
}

/** Colour for a ratio: hue 130 (green) at ≤ 0.5, 45 (amber) at 0.85, 0
 * (red) at ≥ 1. */
export function heatColor(ratio: number): string {
  const r = Math.max(0, ratio);
  const hue = r <= 0.5 ? 130 : r <= 0.85 ? 130 - ((r - 0.5) / 0.35) * 85 : r < 1 ? 45 - ((r - 0.85) / 0.15) * 45 : 0;
  return `hsl(${hue.toFixed(0)} 80% ${r >= 1 ? 58 : 52}%)`;
}
