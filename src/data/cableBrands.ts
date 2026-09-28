import type { CableOd } from '../types';

/** Cable outer diameters (and minimum bending radii) by brand, for cable
 * tray sizing. DUCAB is the default; the generic set is typical catalogue
 * values. A project can also keep its own edited table. */

export interface CableBrand {
  id: string;
  name: string;
  note: string;
  ods: CableOd[];
}

// Typical catalogue weights (kg/m) of Cu XLPE/SWA/PVC cable, by size — used
// where a brand's data gives diameters only.
const SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 630];
const KG4 = [0.4, 0.5, 0.65, 0.8, 1.1, 1.4, 2.0, 2.5, 3.0, 4.1, 5.4, 6.6, 8.1, 10.0, 12.9, 15.9, 20.1, 31.5];
const KG1 = [0.02, 0.03, 0.05, 0.07, 0.11, 0.17, 0.26, 0.36, 0.49, 0.69, 0.94, 1.18, 1.46, 1.83, 2.37, 2.96, 3.9, 6.3];
const r1 = (v: number) => Math.round(v * 10) / 10;
/** Typical weight of cores × size (2C ≈ 62 %, 3C ≈ 80 % of 4C). */
export function typicalKgPerM(cores: number, csaMm2: number): number {
  const i = SIZES.indexOf(csaMm2);
  if (i < 0) return 0;
  return cores === 1 ? KG1[i] : r1(KG4[i] * (cores === 2 ? 0.62 : cores === 3 ? 0.8 : 1));
}

// ---- DUCAB ----------------------------------------------------------------
// 0.6/1 kV Cu XLPE/SWA/PVC (multicore) and 1C: overall diameter (mm) and
// minimum bending radius (mm), from DUCAB's data.
type Row = [csa: number, d1: number | null, d2: number | null, d3: number | null, d4: number | null, b2: number | null, b3: number | null, b4: number | null];
const DUCAB_ROWS: Row[] = [
  [630, 42.5, null, null, null, null, null, null],
  [400, 34.3, 59.0, 66.6, 75.5, 480, 540, null],
  [300, 30.6, 53.3, 60.2, 68.8, 430, 490, 560],
  [240, 27.5, 49.0, 55.1, 63.0, 400, 450, 510],
  [185, 24.1, 44.7, 49.8, 56.6, 360, 400, 460],
  [150, 21.6, 39.3, 45.5, 51.4, 320, 370, 420],
  [120, 19.4, 36.1, 40.4, 47.1, 290, 330, 380],
  [95, 17.6, 33.1, 37.0, 41.7, 270, 300, 340],
  [70, 15.1, 29.0, 32.2, 37.7, 240, 260, 310],
  [50, 13.2, 25.8, 28.5, 32.0, 210, 230, 260],
  [35, 11.3, 27.9, 29.6, 32.1, 170, 180, 200],
  [25, 10.1, 24.1, 26.7, 28.9, 150, 170, 180],
  [16, 8.0, 20.0, 21.2, 22.9, 120, 130, 140],
  [10, 7.0, 18.0, 19.5, 21.1, 110, 120, 130],
  [6, 5.4, 15.9, 16.6, 18.7, 100, 100, 120],
  [4, 4.7, 14.7, 15.3, 16.4, 90, 100, 100]
];

export const DUCAB_ODS: CableOd[] = DUCAB_ROWS.flatMap(([csa, d1, d2, d3, d4, b2, b3, b4]) => {
  const out: CableOd[] = [];
  const add = (cores: number, od: number | null, bend: number | null) => {
    if (od === null) return;
    out.push({ cores, csaMm2: csa, odMm: od, kgPerM: typicalKgPerM(cores, csa), ...(bend !== null ? { bendMm: bend } : {}) });
  };
  add(1, d1, null);
  add(2, d2, b2);
  add(3, d3, b3);
  add(4, d4, b4);
  return out;
}).sort((a, b) => a.cores - b.cores || a.csaMm2 - b.csaMm2);

// ---- Generic ----------------------------------------------------------------
// Rough overall diameters of 0.6/1 kV Cu XLPE/PVC/SWA/PVC multicore cable
// (BS 5467 type, typical catalogue figures), and 1C PVC earth cable.
const G_SIZES = SIZES.slice(0, 17);
const OD4 = [13.0, 14.4, 16.5, 17.9, 20.6, 22.8, 26.9, 29.4, 32.0, 36.5, 41.5, 45.3, 50.1, 55.8, 62.9, 68.8, 77.6];
const OD1 = [3.3, 3.9, 4.4, 5.0, 6.3, 7.3, 9.0, 10.2, 11.9, 13.7, 15.8, 17.5, 19.5, 21.8, 24.8, 27.6, 31.4];
export const GENERIC_ODS: CableOd[] = [
  ...G_SIZES.map((csaMm2, i) => ({ cores: 1, csaMm2, odMm: OD1[i], kgPerM: KG1[i] })),
  ...G_SIZES.map((csaMm2, i) => ({ cores: 2, csaMm2, odMm: r1(OD4[i] * 0.86), kgPerM: typicalKgPerM(2, csaMm2) })),
  ...G_SIZES.map((csaMm2, i) => ({ cores: 3, csaMm2, odMm: r1(OD4[i] * 0.93), kgPerM: typicalKgPerM(3, csaMm2) })),
  ...G_SIZES.map((csaMm2, i) => ({ cores: 4, csaMm2, odMm: OD4[i], kgPerM: KG4[i] }))
];

export const CABLE_BRANDS: CableBrand[] = [
  { id: 'ducab', name: 'DUCAB', note: 'DUCAB 0.6/1 kV Cu XLPE/SWA/PVC — diameters and bending radii from DUCAB; weights typical', ods: DUCAB_ODS },
  { id: 'generic', name: 'Generic (typical values)', note: 'Typical catalogue values — confirm with the manufacturer', ods: GENERIC_ODS }
];

export const DEFAULT_CABLE_BRAND = 'ducab';
export const brandOf = (id: string | undefined) => CABLE_BRANDS.find((b) => b.id === id) ?? CABLE_BRANDS.find((b) => b.id === DEFAULT_CABLE_BRAND)!;
