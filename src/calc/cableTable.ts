import type { Feeder } from '../types';

// Reference data for copper, XLPE-insulated, steel-wire-armoured (SWA) cable,
// 4-core, laid in free air at 30°C ambient — a common LV distribution cable
// construction. R values (ohm/km at 20°C DC) are IEC 60228 standard values.
// X and ampacity are typical published figures for this cable type and are
// approximations: for a real project, replace with the manufacturer's
// datasheet or the exact IEC 60364-5-52 table for your installation method.
export interface CableSpec {
  csaMm2: number;
  rOhmPerKm20C: number; // DC resistance at 20°C, ohm/km (IEC 60228)
  xOhmPerKm: number; // reactance, ohm/km (typical, multicore)
  ampacityA: number; // current rating in free air, 30°C ambient, XLPE 90°C
  ratePerM?: number; // supply + install rate for the BOQ (from Cables.xlsx)
}

/** Built-in reference data; replaced by Cables.xlsx when that has rows. */
export const REFERENCE_CABLE_TABLE: CableSpec[] = [
  { csaMm2: 1.5, rOhmPerKm20C: 12.1, xOhmPerKm: 0.1, ampacityA: 26 },
  { csaMm2: 2.5, rOhmPerKm20C: 7.41, xOhmPerKm: 0.1, ampacityA: 36 },
  { csaMm2: 4, rOhmPerKm20C: 4.61, xOhmPerKm: 0.09, ampacityA: 47 },
  { csaMm2: 6, rOhmPerKm20C: 3.08, xOhmPerKm: 0.09, ampacityA: 60 },
  { csaMm2: 10, rOhmPerKm20C: 1.83, xOhmPerKm: 0.09, ampacityA: 80 },
  { csaMm2: 16, rOhmPerKm20C: 1.15, xOhmPerKm: 0.085, ampacityA: 105 },
  { csaMm2: 25, rOhmPerKm20C: 0.727, xOhmPerKm: 0.085, ampacityA: 138 },
  { csaMm2: 35, rOhmPerKm20C: 0.524, xOhmPerKm: 0.08, ampacityA: 168 },
  { csaMm2: 50, rOhmPerKm20C: 0.387, xOhmPerKm: 0.08, ampacityA: 200 },
  { csaMm2: 70, rOhmPerKm20C: 0.268, xOhmPerKm: 0.08, ampacityA: 253 },
  { csaMm2: 95, rOhmPerKm20C: 0.193, xOhmPerKm: 0.075, ampacityA: 306 },
  { csaMm2: 120, rOhmPerKm20C: 0.153, xOhmPerKm: 0.075, ampacityA: 354 },
  { csaMm2: 150, rOhmPerKm20C: 0.124, xOhmPerKm: 0.075, ampacityA: 393 },
  { csaMm2: 185, rOhmPerKm20C: 0.0991, xOhmPerKm: 0.07, ampacityA: 448 },
  { csaMm2: 240, rOhmPerKm20C: 0.0754, xOhmPerKm: 0.07, ampacityA: 528 },
  { csaMm2: 300, rOhmPerKm20C: 0.0601, xOhmPerKm: 0.07, ampacityA: 603 }
];

// Ambient temperature correction factors for 90°C (XLPE) cable, relative to
// 30°C ambient — typical values from IEC 60364-5-52 Table B.52.14.
const AMBIENT_POINTS: [number, number][] = [
  [25, 1.03], [30, 1.0], [35, 0.96], [40, 0.91], [45, 0.87],
  [50, 0.82], [55, 0.76], [60, 0.71], [65, 0.65], [70, 0.58]
];

export function ambientCorrectionFactor(ambientC: number): number {
  const pts = AMBIENT_POINTS;
  if (ambientC <= pts[0][0]) return pts[0][1];
  if (ambientC >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t1, f1] = pts[i];
    const [t2, f2] = pts[i + 1];
    if (ambientC >= t1 && ambientC <= t2) {
      const frac = (ambientC - t1) / (t2 - t1);
      return f1 + frac * (f2 - f1);
    }
  }
  return 1;
}

let active: CableSpec[] = REFERENCE_CABLE_TABLE;

/** Cable data in use: the database's Cables.xlsx when it has valid rows,
 * otherwise the built-in reference table. Sorted by size. */
export function cables(): CableSpec[] {
  return active;
}

/** Sets the cable data (null = back to the built-in reference). */
export function setCables(rows: CableSpec[] | null): void {
  active = rows && rows.length ? [...rows].sort((a, b) => a.csaMm2 - b.csaMm2) : REFERENCE_CABLE_TABLE;
}

export function getCable(csaMm2: number): CableSpec {
  // A project may use a size the database doesn't list; fall back to the
  // reference data for it rather than failing the whole calculation.
  const c = active.find((c) => c.csaMm2 === csaMm2) ?? REFERENCE_CABLE_TABLE.find((c) => c.csaMm2 === csaMm2);
  if (!c) throw new Error(`No cable data for ${csaMm2} mm²`);
  return c;
}

/** Protective conductor size from IEC 60364-5-54 Table 54.2 (same material
 * as the line conductor): S ≤ 16 → S; 16 < S ≤ 35 → 16; S > 35 → S/2,
 * rounded up to the next standard size. */
export function defaultCpcMm2(phaseMm2: number): number {
  if (phaseMm2 <= 16) return phaseMm2;
  if (phaseMm2 <= 35) return 16;
  return cables().find((c) => c.csaMm2 >= phaseMm2 / 2)?.csaMm2 ?? phaseMm2;
}

export const cpcOf = (f: Feeder) => f.cpcMm2 ?? defaultCpcMm2(f.cableCsaMm2);
