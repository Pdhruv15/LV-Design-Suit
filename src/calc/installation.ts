import { ambientCorrectionFactor, INSTALL_METHODS, isBuried, methodOf, methodRating, type CableSource, type InstallMethod } from './cableTable';
import { bunchedFactor } from './cableTray';
import { buriedGroupFactor, GROUND_TEMP_RANGE_C, groundTempFactor, SOIL_RANGE_KMW, soilFactor } from './containment';
import type { Feeder, Project } from '../types';

/** A cable's current rating Iz for its installation method (IEC 60364-5-52):
 * the method's tabulated rating × the correction factors × parallel runs.
 *
 * - E (free air / tray): the cable data's rating; air ambient (Table B.52.14); grouping from the cable tray route
 *   when the cable is on one, else its own parallel runs (one layer on a tray).
 * - A1 / A2 / B1 / B2 / C: the method's rating; air ambient; parallel runs grouped as bunched / enclosed
 *   (Table B.52.17 item 1 — for method C, clipped side by side, this is on the safe side).
 * - D1 / D2 (buried): the method's rating; ground temperature (Table B.52.15, reference 20 °C) and soil thermal
 *   resistivity (Table B.52.16, reference 2.5 K·m/W) instead of air ambient; parallel runs grouped as one cable
 *   per duct (D1) or touching direct in the ground (D2). A cable tray route does not apply below ground.
 * No rating for the method (Cables.xlsx or the built-in reference): Iz is NaN and `missing` says why. */

/** IEC reference ground conditions, used when the project gives none. */
export const REFERENCE_GROUND_C = 20;
export const REFERENCE_SOIL_KMW = 2.5;

export interface RatingFactor { label: string; value: number }
export interface RatingBasis {
  method: InstallMethod;
  /** Tabulated rating for one cable before derating (A); undefined = none for this method. */
  baseA?: number;
  source?: CableSource;
  factors: RatingFactor[];
  runs: number;
  /** Derated rating of the whole circuit (all runs), A; NaN when there is no rating. */
  iz: number;
  missing?: string;
}

export const methodLabel = (m: InstallMethod) => INSTALL_METHODS.find((x) => x.id === m)!.label;

/** Iz of a cable size laid by `method`, with `runs` in parallel. `trayFactor`: grouping from a tray route (method E). */
export function ratingBasis(project: Pick<Project, 'ambientC' | 'groundTempC' | 'soilResistivityKmW'>, csaMm2: number, method: InstallMethod, runs: number, trayFactor?: number, defaultGroup?: (runs: number) => number): RatingBasis {
  const rating = methodRating(csaMm2, method);
  const factors: RatingFactor[] = [];
  if (isBuried(method)) {
    const ducts = method === 'D1';
    const t = project.groundTempC ?? REFERENCE_GROUND_C, rho = project.soilResistivityKmW ?? REFERENCE_SOIL_KMW;
    factors.push({ label: `ground ${t} °C`, value: groundTempFactor(t) }, { label: `soil ${rho} K·m/W`, value: soilFactor(rho, ducts) });
    factors.push({ label: `grouping, ${runs} ${ducts ? 'in ducts' : 'in the ground'}`, value: buriedGroupFactor(runs, ducts) });
  } else {
    factors.push({ label: `ambient ${project.ambientC} °C`, value: ambientCorrectionFactor(project.ambientC) });
    if (method === 'E') factors.push({ label: trayFactor !== undefined ? 'grouping on the tray route' : `grouping, ${runs} on a tray`, value: trayFactor ?? (defaultGroup ? defaultGroup(runs) : 1) });
    else factors.push({ label: `grouping, ${runs} bunched`, value: bunchedFactor(runs) });
  }
  if (!rating) return { method, factors, runs, iz: NaN, missing: `no ${method} rating for ${csaMm2} mm² (Cables.xlsx or reference)` };
  const iz = rating.a * factors.reduce((p, f) => p * f.value, 1) * runs;
  return { method, baseA: rating.a, source: rating.source, factors, runs, iz };
}

/** The circuit's rating basis at its own (or a candidate) size and runs. */
export function feederRatingBasis(project: Pick<Project, 'ambientC' | 'groundTempC' | 'soilResistivityKmW'>, f: Pick<Feeder, 'installMethod'>, csaMm2: number, runs: number, trayFactor: number | undefined, defaultGroup: (runs: number) => number): RatingBasis {
  const method = methodOf(f);
  return ratingBasis(project, csaMm2, method, runs, method === 'E' ? trayFactor : undefined, defaultGroup);
}

/** Text of the factors, e.g. "0.89 · 1.00 · 1.00". */
export const factorsText = (b: RatingBasis) => b.factors.map((f) => (Number.isFinite(f.value) ? f.value.toFixed(2) : '—')).join(' · ');

/** Ground conditions the buried circuits use: 'bad' when a value is not a number or outside the tables,
 * 'warn' when the IEC reference is used because the project gives none. */
export function groundChecks(project: Project): { status: 'warn' | 'bad'; text: string }[] {
  if (!project.feeders.some((f) => isBuried(methodOf(f)))) return [];
  const out: { status: 'warn' | 'bad'; text: string }[] = [];
  const check = (v: number | undefined, ref: number, name: string, unit: string, min: number, max: number) => {
    if (v === undefined) out.push({ status: 'warn', text: `Buried cables: ${name} not set — the IEC reference ${ref} ${unit} is used (Project settings)` });
    else if (!Number.isFinite(v)) out.push({ status: 'bad', text: `Buried cables: ${name} is not a number` });
    else if (v < min || v > max) out.push({ status: 'bad', text: `Buried cables: ${name} ${v} ${unit} is outside the ${min}–${max} ${unit} the derating table covers` });
  };
  check(project.groundTempC, REFERENCE_GROUND_C, 'ground temperature', '°C', GROUND_TEMP_RANGE_C.min, GROUND_TEMP_RANGE_C.max);
  check(project.soilResistivityKmW, REFERENCE_SOIL_KMW, 'soil thermal resistivity', 'K·m/W', SOIL_RANGE_KMW.min, SOIL_RANGE_KMW.max);
  return out;
}
