import { getCable } from '../calc/cableTable';

// Illustrative unit rates for a first-pass cost estimate. These are NOT
// real market prices — replace with your supplier's actual rates. Cable
// rates are AED per metre (4-core Cu/XLPE/SWA, supply+install); breaker
// rates are AED per unit (MCCB, supply+install) banded by frame size.
export const CABLE_RATE_PER_M: Record<number, number> = {
  1.5: 12, 2.5: 15, 4: 19, 6: 24, 10: 34, 16: 46,
  25: 66, 35: 88, 50: 118, 70: 158, 95: 205,
  120: 252, 150: 305, 185: 368, 240: 462, 300: 560
};

let breakerPrices: { ratingA: number; price: number }[] = [];

/** Breaker prices from Breakers.xlsx (rating → price); empty = illustrative bands. */
export function setBreakerPrices(rows: { ratingA: number; price: number }[]): void {
  breakerPrices = [...rows].sort((a, b) => a.ratingA - b.ratingA);
}

/** Cable rate from Cables.xlsx when given there, else the illustrative rate. */
export function cableRatePerM(csaMm2: number): number {
  return getCable(csaMm2).ratePerM ?? CABLE_RATE_PER_M[csaMm2] ?? 0;
}

export function breakerRateAed(ratingA: number): number {
  const priced = breakerPrices.find((b) => b.ratingA >= ratingA);
  if (priced) return priced.price;
  if (ratingA <= 63) return 180;
  if (ratingA <= 160) return 420;
  if (ratingA <= 250) return 780;
  if (ratingA <= 400) return 1350;
  if (ratingA <= 630) return 2200;
  return 3400;
}

export const CURRENCY = 'AED';
