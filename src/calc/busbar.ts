import type { Project } from '../types';
import { summarizeBuilding } from './building';
import { boardTotals } from './summary';
import { faultCurrentKA, impedanceToBoard, upstreamVoltageDropPct } from './electrical';
import { STANDARD_BREAKER_A } from './sizing';

/** Busbar trunking risers (busway) for high-rise buildings, instead of
 * cables: a riser from a main board up the building with a tap-off unit on
 * each floor. Sized from the tap-offs' demand with the diversity of IEC
 * 61439-6, derated for ambient; voltage drop floor by floor with the
 * distributed load; short-circuit withstand against the fault at the source;
 * dimensions, weight, lengths and fittings for the BOQ.
 *
 * The data per rating are typical values for sandwich-type busway — replace
 * them with the manufacturer's (e.g. RR) catalogue in the data table. */

export type BusMaterial = 'cu' | 'al';

export interface BusbarType {
  ratingA: number;
  csaMm2: number; // conductor area per phase
  rMohmPerM: number; // phase resistance at operating temperature, mΩ/m
  xMohmPerM: number; // phase reactance, mΩ/m
  icwKa: number; // rated short-time withstand, 1 s
  widthMm: number;
  heightMm: number;
  kgPerM: number;
}

export type BusbarData = Record<BusMaterial, BusbarType[]>;

/** Typical sandwich busway, 3P + N (100 %) + PE housing, 40 °C reference. */
export const TYPICAL_BUSBAR_DATA: BusbarData = {
  cu: [
    { ratingA: 630, csaMm2: 420, rMohmPerM: 0.110, xMohmPerM: 0.030, icwKa: 36, widthMm: 135, heightMm: 90, kgPerM: 13 },
    { ratingA: 800, csaMm2: 530, rMohmPerM: 0.085, xMohmPerM: 0.026, icwKa: 50, widthMm: 135, heightMm: 105, kgPerM: 15 },
    { ratingA: 1000, csaMm2: 670, rMohmPerM: 0.065, xMohmPerM: 0.022, icwKa: 50, widthMm: 135, heightMm: 120, kgPerM: 18 },
    { ratingA: 1250, csaMm2: 830, rMohmPerM: 0.052, xMohmPerM: 0.019, icwKa: 65, widthMm: 135, heightMm: 135, kgPerM: 21 },
    { ratingA: 1600, csaMm2: 1070, rMohmPerM: 0.040, xMohmPerM: 0.016, icwKa: 80, widthMm: 135, heightMm: 165, kgPerM: 26 },
    { ratingA: 2000, csaMm2: 1330, rMohmPerM: 0.031, xMohmPerM: 0.013, icwKa: 80, widthMm: 135, heightMm: 200, kgPerM: 32 },
    { ratingA: 2500, csaMm2: 1670, rMohmPerM: 0.025, xMohmPerM: 0.011, icwKa: 100, widthMm: 135, heightMm: 245, kgPerM: 39 },
    { ratingA: 3200, csaMm2: 2130, rMohmPerM: 0.019, xMohmPerM: 0.008, icwKa: 100, widthMm: 135, heightMm: 330, kgPerM: 52 },
    { ratingA: 4000, csaMm2: 2670, rMohmPerM: 0.015, xMohmPerM: 0.007, icwKa: 120, widthMm: 135, heightMm: 400, kgPerM: 64 },
    { ratingA: 5000, csaMm2: 3330, rMohmPerM: 0.012, xMohmPerM: 0.006, icwKa: 120, widthMm: 135, heightMm: 490, kgPerM: 78 }
  ],
  al: [
    { ratingA: 630, csaMm2: 630, rMohmPerM: 0.135, xMohmPerM: 0.030, icwKa: 36, widthMm: 135, heightMm: 120, kgPerM: 9 },
    { ratingA: 800, csaMm2: 800, rMohmPerM: 0.105, xMohmPerM: 0.026, icwKa: 50, widthMm: 135, heightMm: 135, kgPerM: 11 },
    { ratingA: 1000, csaMm2: 1000, rMohmPerM: 0.085, xMohmPerM: 0.023, icwKa: 50, widthMm: 135, heightMm: 165, kgPerM: 13 },
    { ratingA: 1250, csaMm2: 1250, rMohmPerM: 0.068, xMohmPerM: 0.019, icwKa: 65, widthMm: 135, heightMm: 200, kgPerM: 16 },
    { ratingA: 1600, csaMm2: 1600, rMohmPerM: 0.052, xMohmPerM: 0.016, icwKa: 65, widthMm: 135, heightMm: 245, kgPerM: 20 },
    { ratingA: 2000, csaMm2: 2000, rMohmPerM: 0.042, xMohmPerM: 0.013, icwKa: 80, widthMm: 135, heightMm: 330, kgPerM: 26 },
    { ratingA: 2500, csaMm2: 2500, rMohmPerM: 0.034, xMohmPerM: 0.011, icwKa: 80, widthMm: 135, heightMm: 400, kgPerM: 32 },
    { ratingA: 3200, csaMm2: 3200, rMohmPerM: 0.026, xMohmPerM: 0.008, icwKa: 100, widthMm: 135, heightMm: 490, kgPerM: 40 },
    { ratingA: 4000, csaMm2: 4000, rMohmPerM: 0.021, xMohmPerM: 0.007, icwKa: 100, widthMm: 270, heightMm: 400, kgPerM: 52 }
  ]
};

export const MATERIAL_LABEL: Record<BusMaterial, string> = { cu: 'Copper', al: 'Aluminium' };
export const TAPOFF_A = [32, 63, 100, 125, 160, 250, 315, 400, 630];

export interface RiserFloor {
  id: string;
  name: string; // e.g. "Level 5"
  /** Board on this floor (its demand is used), or a load entered here. */
  boardId?: string;
  kw?: number;
  pf?: number;
  /** Floors with the same load: the tap-off repeats (e.g. typical floors 3–20). */
  count?: number;
}

export interface BusRiser {
  id: string;
  name: string;
  sourceBoardId?: string; // where it starts (fault level and feeding breaker)
  material: BusMaterial;
  /** Horizontal run from the board to the riser foot (m). */
  feedM: number;
  floorHeightM: number;
  /** Floors below the first tap-off (e.g. basements the riser passes). */
  offsetFloors: number;
  /** Diversity; empty = IEC 61439-6 by the number of tap-offs. */
  diversity?: number;
  ambientC?: number; // default: the project's
  elementM: number; // standard straight length (m)
  elbows: number;
  floors: RiserFloor[];
}

export const newRiser = (id: string, sourceBoardId?: string): BusRiser => ({
  id, name: `Busbar riser ${id}`, sourceBoardId, material: 'cu', feedM: 10, floorHeightM: 3.6, offsetFloors: 1, elementM: 3, elbows: 2,
  floors: Array.from({ length: 6 }, (_, i) => ({ id: `F${i + 1}`, name: `Level ${i + 1}`, kw: 60, pf: 0.9 }))
});

/** Rated diversity factor for a number of circuits (IEC 61439-6 / 61439-1 Table 101). */
export const iecDiversity = (circuits: number) => (circuits <= 1 ? 1 : circuits <= 3 ? 0.9 : circuits <= 5 ? 0.8 : circuits <= 9 ? 0.7 : 0.6);

/** Ambient derating, 40 °C reference (typical busway: ≈ 1 % per °C above 40 °C). */
export const ambientFactor = (ambientC: number) => Math.min(1.1, Math.max(0.6, 1 - Math.max(-10, ambientC - 40) * 0.01));

const SQRT3 = Math.sqrt(3);
const nextStd = (list: number[], v: number) => list.find((x) => x >= v - 1e-9);

export interface RiserFloorResult {
  floor: RiserFloor;
  kw: number; // each
  kva: number;
  currentA: number; // each tap-off
  tapOffA?: number;
  heightM: number; // riser length from its foot to this tap-off
  vdPct: number; // from the source board to this tap-off (riser only)
}

export interface RiserResult {
  riser: BusRiser;
  tapOffs: number;
  connectedKw: number;
  diversity: number;
  demandKw: number;
  demandKva: number;
  pf: number;
  designA: number;
  ambientC: number;
  derate: number;
  requiredA: number; // design ÷ derating
  type?: BusbarType; // selected
  /** The other material's size, for comparison. */
  alternative?: { material: BusMaterial; type?: BusbarType };
  currentDensity?: number; // A/mm² at the design current
  feederBreakerA?: number;
  faultKa?: number;
  icwOk?: boolean;
  floors: RiserFloorResult[];
  vdTopPct: number;
  lengthM: number; // feed + vertical
  elements: number;
  weightKg?: number;
  notes: string[];
}

const pfOf = (pf?: number) => Math.min(Math.max(pf ?? 0.9, 0.3), 1);

export function sizeRiser(project: Project, r: BusRiser, data: BusbarData = project.busbarData ?? TYPICAL_BUSBAR_DATA): RiserResult {
  const ambientC = r.ambientC ?? project.ambientC;
  // Each floor's load: the board's demand, or the kW entered.
  const floors = r.floors.map((f) => {
    const count = Math.max(1, Math.round(f.count ?? 1));
    let kw = f.kw ?? 0, kvar = kw * Math.tan(Math.acos(pfOf(f.pf)));
    if (f.boardId && project.boards.some((b) => b.id === f.boardId)) {
      const t = boardTotals(project, f.boardId);
      kw = t.demandKw; kvar = Math.max(0, t.demandKvar);
    }
    return { f, count, kw, kvar };
  });
  const tapOffs = floors.reduce((s, x) => s + x.count, 0);
  const diversity = r.diversity ?? iecDiversity(tapOffs);
  const P = floors.reduce((s, x) => s + x.kw * x.count, 0);
  const Q = floors.reduce((s, x) => s + x.kvar * x.count, 0);
  const connectedKva = Math.hypot(P, Q);
  const pf = connectedKva > 0 ? P / connectedKva : 1;
  const demandKw = P * diversity;
  const demandKva = connectedKva * diversity;
  const I = (kva: number) => (kva * 1000) / (SQRT3 * project.voltageV);
  const designA = I(demandKva);
  const derate = ambientFactor(ambientC);
  // Ib ≤ In ≤ busway rating × derating (IEC 60364-4-43): size for the feeding breaker.
  const inA = nextStd(STANDARD_BREAKER_A, designA) ?? designA;
  const requiredA = inA / derate;
  const pick = (m: BusMaterial) => data[m].find((t) => t.ratingA >= requiredA - 1e-9);
  const type = pick(r.material);
  const other: BusMaterial = r.material === 'cu' ? 'al' : 'cu';
  const faultKa = r.sourceBoardId && project.boards.some((b) => b.id === r.sourceBoardId)
    ? faultCurrentKA(impedanceToBoard(project, r.sourceBoardId), project.voltageV)
    : undefined;
  const fault = faultKa !== undefined && Number.isFinite(faultKa) ? faultKa : undefined;

  // Voltage drop, floor by floor: each riser section carries the (diversified)
  // current of the tap-offs above it.
  const sinφ = Math.sin(Math.acos(pf));
  const zPerM = type ? (type.rMohmPerM * pf + type.xMohmPerM * sinφ) / 1000 : 0; // Ω/m
  const vd = (amps: number, m: number) => (SQRT3 * amps * zPerM * m / project.voltageV) * 100;
  const levels: { x: typeof floors[number]; level: number }[] = [];
  let level = r.offsetFloors;
  for (const x of floors) for (let k = 0; k < x.count; k++) levels.push({ x, level: level++ });
  const heights = levels.map((l) => l.level * r.floorHeightM);
  let vdAcc = vd(designA, r.feedM); // horizontal feed carries it all
  let prevH = 0;
  const vdAt: number[] = [];
  levels.forEach((l, i) => {
    const above = levels.slice(i).reduce((s, y) => s + Math.hypot(y.x.kw, y.x.kvar), 0) * diversity;
    vdAcc += vd(I(above), heights[i] - prevH);
    prevH = heights[i];
    vdAt.push(vdAcc);
  });
  const floorResults: RiserFloorResult[] = floors.map((x) => {
    const idx = levels.findIndex((l) => l.x === x);
    const lastIdx = idx + x.count - 1;
    const kva = Math.hypot(x.kw, x.kvar);
    const a = I(kva);
    return {
      floor: x.f, kw: x.kw, kva, currentA: a, tapOffA: nextStd(TAPOFF_A, a / 0.85),
      heightM: heights[lastIdx] ?? 0, vdPct: vdAt[lastIdx] ?? 0
    };
  });
  const vertical = heights.length ? heights[heights.length - 1] + 1 : 0; // + 1 m above the top tap-off
  const lengthM = r.feedM + vertical;
  const notes: string[] = [];
  if (!type) notes.push(`Above the largest ${MATERIAL_LABEL[r.material].toLowerCase()} rating in the data — two risers, or split the floors`);
  if (fault !== undefined && type && type.icwKa < fault) notes.push(`Fault at ${r.sourceBoardId} is ${fault.toFixed(1)} kA — above the busway's Icw ${type.icwKa} kA; take the next rating or a current-limiting breaker`);
  if (r.diversity === undefined) notes.push(`Diversity ${diversity} for ${tapOffs} tap-offs (IEC 61439-6)`);
  if (derate < 1) notes.push(`Ambient ${ambientC} °C: rating × ${derate.toFixed(2)}`);
  return {
    riser: r, tapOffs, connectedKw: P, diversity, demandKw, demandKva, pf, designA, ambientC, derate, requiredA,
    type, alternative: { material: other, type: pick(other) },
    currentDensity: type ? designA / type.csaMm2 : undefined,
    feederBreakerA: inA,
    faultKa: fault, icwOk: fault !== undefined && type ? type.icwKa >= fault : undefined,
    floors: floorResults, vdTopPct: vdAt[vdAt.length - 1] ?? 0,
    lengthM, elements: Math.ceil(lengthM / Math.max(0.5, r.elementM)), weightKg: type ? type.kgPerM * lengthM : undefined,
    notes
  };
}

/** Parses the busbar data table pasted or typed on the page (one row per rating). */
export function busbarTypeFrom(row: (string | number)[]): BusbarType | null {
  const n = row.map((v) => Number(String(v).replace(/[^0-9.]/g, '')));
  const [ratingA, csaMm2, rMohmPerM, xMohmPerM, icwKa, widthMm, heightMm, kgPerM] = n;
  if (!(ratingA > 0) || !(csaMm2 > 0) || !(rMohmPerM > 0)) return null;
  return { ratingA, csaMm2, rMohmPerM, xMohmPerM: xMohmPerM || 0, icwKa: icwKa || 0, widthMm: widthMm || 0, heightMm: heightMm || 0, kgPerM: kgPerM || 0 };
}

/** A riser's floors from a building's levels: each level with rooms is a
 * tap-off (its demand per floor, typical floors repeated), the typical
 * floor height, and the levels below the first one skipped. */
export function riserFromBuilding(project: Project, buildingId: string): Pick<BusRiser, 'floors' | 'floorHeightM' | 'offsetFloors'> | null {
  const info = project.building;
  const b = info?.buildings.find((x) => x.id === buildingId);
  if (!info || !b) return null;
  const s = summarizeBuilding(info, b);
  const byHeight = [...s.levels].sort((x, y) => x.elevationM - y.elevationM);
  const served = byHeight.filter((l) => l.demandKw > 0);
  if (!served.length) return null;
  const typical = s.levels.find((l) => l.level.kind === 'typical') ?? served[0];
  const firstIdx = byHeight.indexOf(served[0]);
  return {
    floors: served.map((l) => ({ id: l.level.id, name: l.level.name, kw: Math.round(l.perFloorDemandKw * 10) / 10, pf: 0.9, count: l.count > 1 ? l.count : undefined })),
    floorHeightM: typical.level.heightM,
    offsetFloors: byHeight.slice(0, firstIdx).reduce((n, l) => n + l.count, 0)
  };
}

/** One section of a riser in the voltage drop breakdown. */
export interface RiserVdSegment {
  label: string; // "Feed (board → riser foot)", "Riser foot → L1", "L1 → L2"…
  kind: 'concentrated' | 'distributed';
  lengthM: number;
  currentA: number; // current in this section
  vdPct: number;
  cumPct: number; // source to the end of this section (incl. upstream)
  floor?: string; // tap-off at the end of the section
}
export interface RiserVd {
  riser: BusRiser;
  upstreamPct: number; // source to the feeding board
  designA: number;
  zOhmPerM: number;
  concentratedM: number; // full current: feed + riser up to the first tap-off
  distributedM: number; // first to last tap-off
  segments: RiserVdSegment[];
  exactTopPct: number; // floor by floor, source to the top tap-off
  uniformTopPct: number; // uniformly distributed load: full current over L/2
  limitPct: number;
  status: 'ok' | 'warn' | 'bad';
}

/** Riser voltage drop split into its concentrated length (the feed and the
 * riser up to the first tap-off carry the full current) and distributed
 * length (the current falls at each tap-off). Exact: section by section;
 * quick check: ΔV = √3 · I · z · (Lc + Ld/2) for a uniformly distributed load. */
export function riserVd(project: Project, r: BusRiser): RiserVd {
  const s = sizeRiser(project, r);
  const upstreamPct = r.sourceBoardId ? upstreamVoltageDropPct(project, r.sourceBoardId) : 0;
  const sinφ = Math.sin(Math.acos(s.pf));
  const z = s.type ? (s.type.rMohmPerM * s.pf + s.type.xMohmPerM * sinφ) / 1000 : 0;
  const vd = (a: number, m: number) => (SQRT3 * a * z * m / project.voltageV) * 100;
  const I = (kva: number) => (kva * 1000) / (SQRT3 * project.voltageV);
  // Tap-offs from the bottom up, with each one's (diversified) load.
  const taps: { name: string; h: number; kva: number }[] = [];
  let level = r.offsetFloors;
  for (const fr of s.floors) {
    const count = Math.max(1, Math.round(fr.floor.count ?? 1));
    for (let k = 0; k < count; k++) taps.push({ name: count > 1 ? `${fr.floor.name} (${k + 1})` : fr.floor.name, h: level++ * r.floorHeightM, kva: fr.kva * s.diversity });
  }
  const segments: RiserVdSegment[] = [];
  let cum = upstreamPct;
  const push = (label: string, kind: RiserVdSegment['kind'], lengthM: number, currentA: number, floor?: string) => {
    const v = vd(currentA, lengthM);
    cum += v;
    segments.push({ label, kind, lengthM, currentA, vdPct: v, cumPct: cum, floor });
  };
  push(`Feed: ${r.sourceBoardId ?? 'board'} → riser foot`, 'concentrated', r.feedM, s.designA);
  let prevH = 0, prevName = 'riser foot';
  taps.forEach((t, i) => {
    const above = taps.slice(i).reduce((a, x) => a + x.kva, 0);
    push(`${prevName} → ${t.name}`, i === 0 ? 'concentrated' : 'distributed', t.h - prevH, i === 0 ? s.designA : I(above), t.name);
    prevH = t.h; prevName = t.name;
  });
  const first = taps[0]?.h ?? 0, last = taps[taps.length - 1]?.h ?? 0;
  const concentratedM = r.feedM + first, distributedM = last - first;
  const uniformTopPct = upstreamPct + vd(s.designA, concentratedM) + vd(s.designA, distributedM / 2);
  const limitPct = project.vdLimitPct;
  return {
    riser: r, upstreamPct, designA: s.designA, zOhmPerM: z, concentratedM, distributedM, segments,
    exactTopPct: cum, uniformTopPct, limitPct,
    status: cum > limitPct ? 'bad' : cum > limitPct * 0.85 ? 'warn' : 'ok'
  };
}
