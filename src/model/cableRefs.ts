import { DEFAULT_CABLE_TYPE, type Feeder, type Project } from '../types';
import { cableTypeDef, cableTypeOf } from './cableTypes';
import { defaultCpcMm2, cpcOf } from '../calc/cableTable';
import { runsOf } from '../calc/electrical';

/** Cable reference numbers: one standard list of cable build-ups (IEC
 * sizes, copper XLPE/SWA/PVC with its G/Y earth conductor) with fixed
 * numbers, so "34" means the same cable on every project. A cable that
 * isn't in the list (another construction, other earth size, parallel
 * runs) gets the next free number in the project and keeps it. Fire-rated
 * cables use the number of the same size and are marked " * " on the SLD
 * (note: all cables marked * shall be fire rated). */

export interface CableRef { ref: number; key: string; text: string; standard?: boolean }
export interface CableBuild { runs: number; cores: number; csa: number; type: string; ecc?: number }

const MULTI_4C = [300, 240, 185, 150, 120, 95, 70, 50, 35, 25, 16, 10, 6, 4, 2.5];
const MULTI_3C = [50, 35, 25, 16, 10];
const MULTI_2C = [35, 25, 16, 10, 6, 4];
const SWA = 'XLPE/SWA/PVC';

/** Key of a cable build-up (fire rating left out: it's the " * " mark). */
export const cableKey = (c: CableBuild) => `${c.runs}x${c.cores}C|${c.csa}|${c.type}|${c.ecc ?? 0}`;

/** Description as on the cable schedule, e.g.
 * "4C 300mm² Cu XLPE/SWA/PVC + 1C 150mm² Cu/PVC G/Y AS ECC". */
export function cableBuildText(c: CableBuild): string {
  const d = cableTypeDef(c.type);
  const ins = c.type === 'XLPE/PVC/SWA' || c.type === 'XLPE/SWA/PVC' ? SWA : d.value;
  const main = `${c.runs > 1 ? `${c.runs}x` : ''}${c.cores}C ${c.csa}mm² Cu ${ins}`;
  return c.ecc ? `${main} + 1C ${c.ecc}mm² Cu/PVC G/Y AS ECC` : main;
}

/** The standard list: 4C 300 … 2.5, 3C 50 … 10, 2C 35 … 4 (each with its
 * IEC 60364-5-54 earth conductor). Numbers start at 1 and never change. */
export const STANDARD_CABLES: CableRef[] = [
  ...MULTI_4C.map((csa) => ({ runs: 1, cores: 4, csa, type: SWA, ecc: defaultCpcMm2(csa) })),
  ...MULTI_3C.map((csa) => ({ runs: 1, cores: 3, csa, type: SWA, ecc: defaultCpcMm2(csa) })),
  ...MULTI_2C.map((csa) => ({ runs: 1, cores: 2, csa, type: SWA, ecc: defaultCpcMm2(csa) }))
].map((c, i) => ({ ref: i + 1, key: cableKey(c), text: cableBuildText(c), standard: true }));

/** A feeder's cable as a build-up: fire-rated and the default armoured
 * types count as the standard construction. */
export function feederBuild(project: Project, f: Feeder): CableBuild {
  const d = cableTypeOf(project, f);
  const type = d.fireRated || d.code === cableTypeDef(DEFAULT_CABLE_TYPE).code ? SWA : d.value;
  const armoured = d.fireRated || d.armoured;
  return { runs: runsOf(f), cores: f.cores, csa: f.cableCsaMm2, type, ecc: armoured ? cpcOf(f) : undefined };
}

/** Every reference: the standard list, then the project's own (persisted). */
export const allCableRefs = (p: Project): CableRef[] => [...STANDARD_CABLES, ...(p.cableRefs ?? [])];

/** Cable types used in the project that have no number yet, numbered from
 * the next free number. Returns the project unchanged when all have one. */
export function withCableRefs(p: Project): Project {
  const known = new Set(allCableRefs(p).map((r) => r.key));
  const extra: CableRef[] = [];
  let next = Math.max(0, ...allCableRefs(p).map((r) => r.ref)) + 1;
  for (const f of p.feeders) {
    const b = feederBuild(p, f);
    const key = cableKey(b);
    if (known.has(key)) continue;
    known.add(key);
    extra.push({ ref: next++, key, text: cableBuildText(b) });
  }
  return extra.length ? { ...p, cableRefs: [...(p.cableRefs ?? []), ...extra] } : p;
}

/** Number of a feeder's cable (assigning on the fly if not stored yet). */
export function cableRefOf(p: Project, f: Feeder): { ref: number; fireRated: boolean; text: string } {
  const key = cableKey(feederBuild(p, f));
  const fireRated = !!cableTypeOf(p, f).fireRated;
  const all = allCableRefs(withCableRefs(p));
  const r = all.find((x) => x.key === key)!;
  return { ref: r.ref, fireRated, text: r.text };
}

/** References used by these feeders, in number order, with "*" when any of
 * them is fire-rated. */
export function cableRefsUsed(p: Project, feeders: Feeder[] = p.feeders): (CableRef & { fireRated: boolean })[] {
  const q = withCableRefs(p);
  const all = allCableRefs(q);
  const used = new Map<number, boolean>();
  for (const f of feeders) { const k = cableKey(feederBuild(q, f)); const r = all.find((x) => x.key === k); if (r) used.set(r.ref, (used.get(r.ref) ?? false) || !!cableTypeOf(q, f).fireRated); }
  return all.filter((r) => used.has(r.ref)).sort((a, b) => a.ref - b.ref).map((r) => ({ ...r, fireRated: used.get(r.ref)! }));
}

export const FIRE_NOTE = 'All cables marked “ * ” on the schematic diagram shall be fire rated (FP400 or equal approved) of the size given in the above schedule.';
