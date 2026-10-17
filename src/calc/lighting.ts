/** Basic interior lighting check by the lumen method (CIBSE / IES average
 * illuminance). A first-pass count of luminaires for a rectangular room — not
 * a point-by-point study (use DIALux / Relux for uniformity and glare). */

/** Maintained illuminance Em (lux) for common spaces, after EN 12464-1:2021. */
export const LUX_TARGETS: { key: string; label: string; lux: number }[] = [
  { key: 'office', label: 'Office — writing, typing, reading', lux: 500 },
  { key: 'cad', label: 'Office — CAD / technical drawing', lux: 750 },
  { key: 'meeting', label: 'Meeting / conference room', lux: 500 },
  { key: 'reception', label: 'Reception desk', lux: 300 },
  { key: 'classroom', label: 'Classroom', lux: 500 },
  { key: 'retail', label: 'Retail sales area', lux: 300 },
  { key: 'kitchen', label: 'Commercial kitchen', lux: 500 },
  { key: 'restaurant', label: 'Restaurant / canteen', lux: 200 },
  { key: 'corridor', label: 'Corridor / circulation', lux: 100 },
  { key: 'stairs', label: 'Stairs / lift lobby', lux: 150 },
  { key: 'toilet', label: 'Toilets / washrooms', lux: 200 },
  { key: 'store', label: 'Store room', lux: 100 },
  { key: 'warehouse', label: 'Warehouse — picking', lux: 200 },
  { key: 'plant', label: 'Plant / electrical room', lux: 200 },
  { key: 'workshop', label: 'Workshop — general', lux: 300 },
  { key: 'carpark', label: 'Car park — parking area', lux: 75 },
  { key: 'living', label: 'Residential — living / bedroom', lux: 150 }
];

/** Ceiling / wall / floor reflectances with indicative utilisation factors for
 * a typical direct LED luminaire (recessed panel or downlight). */
export const REFLECTANCES: { key: string; label: string }[] = [
  { key: '753', label: '0.7 / 0.5 / 0.2 — light ceiling and walls' },
  { key: '733', label: '0.7 / 0.3 / 0.2 — light ceiling, mid walls' },
  { key: '533', label: '0.5 / 0.3 / 0.2 — typical' },
  { key: '512', label: '0.5 / 0.1 / 0.2 — dark walls' },
  { key: '311', label: '0.3 / 0.1 / 0.1 — dark room' },
  { key: '000', label: '0 / 0 / 0 — open area, no reflection' }
];

const K_POINTS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
const UF_TABLE: Record<string, number[]> = {
  753: [0.46, 0.55, 0.61, 0.66, 0.70, 0.75, 0.78, 0.81, 0.84, 0.86],
  733: [0.39, 0.48, 0.54, 0.60, 0.64, 0.70, 0.74, 0.77, 0.81, 0.83],
  533: [0.37, 0.46, 0.52, 0.57, 0.61, 0.66, 0.70, 0.73, 0.77, 0.79],
  512: [0.32, 0.40, 0.46, 0.51, 0.55, 0.61, 0.66, 0.69, 0.73, 0.76],
  311: [0.30, 0.37, 0.42, 0.47, 0.51, 0.57, 0.61, 0.64, 0.68, 0.71],
  '000': [0.26, 0.32, 0.36, 0.41, 0.45, 0.51, 0.55, 0.58, 0.62, 0.65]
};

/** Room index K = L·W ÷ (Hm·(L + W)), Hm = mounting height above the working plane. */
export const roomIndex = (lengthM: number, widthM: number, hmM: number) => (lengthM * widthM) / (hmM * (lengthM + widthM));

/** Indicative UF by linear interpolation in K (clamped to the table ends). */
export function estimateUf(k: number, reflectance: string): number {
  const row = UF_TABLE[reflectance] ?? UF_TABLE[533];
  if (k <= K_POINTS[0]) return row[0];
  for (let i = 1; i < K_POINTS.length; i++) {
    if (k <= K_POINTS[i]) {
      const t = (k - K_POINTS[i - 1]) / (K_POINTS[i] - K_POINTS[i - 1]);
      return row[i - 1] + t * (row[i] - row[i - 1]);
    }
  }
  return row[row.length - 1];
}

/** Rows × columns of at least n, with spacing as even as the room allows —
 * a few extra luminaires are accepted to avoid a long single row. */
export function gridLayout(n: number, lengthM: number, widthM: number): { rows: number; cols: number } {
  if (n <= 0) return { rows: 0, cols: 0 };
  let best = { rows: 1, cols: n, score: Infinity };
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    const ratio = (lengthM / cols) / (widthM / rows); // 1 = square spacing
    const score = Math.abs(Math.log(ratio)) + (1.5 * (rows * cols - n)) / n;
    if (score < best.score) best = { rows, cols, score };
  }
  return { rows: best.rows, cols: best.cols };
}

export interface LuxInput {
  lengthM: number; widthM: number; ceilingM: number; workPlaneM: number; suspensionM: number;
  targetLux: number; lumens: number; watts: number; mf: number;
  /** Reflectance key from REFLECTANCES, used when uf is not given. */
  reflectance: string;
  /** Manufacturer UF; leave undefined to estimate from the reflectance table. */
  uf?: number;
}

export interface LuxResult {
  invalid?: string;
  areaM2: number; hmM: number; k: number; uf: number; ufEstimated: boolean;
  required: number; rows: number; cols: number; count: number;
  achievedLux: number; spacingLM: number; spacingWM: number; shr: number;
  totalW: number; wPerM2: number; wPerM2Per100Lux: number;
}

/** N = E·A ÷ (Φ·UF·MF), rounded up and laid out as a regular grid. */
export function lumenMethod(x: LuxInput): LuxResult {
  const areaM2 = x.lengthM * x.widthM;
  const hmM = x.ceilingM - x.suspensionM - x.workPlaneM;
  const empty = { areaM2, hmM, k: NaN, uf: NaN, ufEstimated: false, required: NaN, rows: 0, cols: 0, count: 0, achievedLux: NaN, spacingLM: NaN, spacingWM: NaN, shr: NaN, totalW: NaN, wPerM2: NaN, wPerM2Per100Lux: NaN };
  if (hmM <= 0) return { ...empty, invalid: 'The luminaire must be above the working plane (ceiling − suspension − working plane > 0).' };
  const k = roomIndex(x.lengthM, x.widthM, hmM);
  const ufEstimated = x.uf === undefined;
  const uf = x.uf ?? estimateUf(k, x.reflectance);
  const required = (x.targetLux * areaM2) / (x.lumens * uf * x.mf);
  const n = Math.max(1, Math.ceil(required - 1e-9));
  const { rows, cols } = gridLayout(n, x.lengthM, x.widthM);
  const count = rows * cols;
  const achievedLux = (count * x.lumens * uf * x.mf) / areaM2;
  const spacingLM = x.lengthM / cols;
  const spacingWM = x.widthM / rows;
  const totalW = count * x.watts;
  const wPerM2 = totalW / areaM2;
  return {
    areaM2, hmM, k, uf, ufEstimated, required, rows, cols, count, achievedLux, spacingLM, spacingWM,
    shr: Math.max(spacingLM, spacingWM) / hmM,
    totalW, wPerM2, wPerM2Per100Lux: achievedLux > 0 ? (wPerM2 * 100) / achievedLux : NaN
  };
}
