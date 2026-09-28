import { DEFAULT_CABLE_TYPE, type Feeder, type Project } from '../types';
import { loadTypeOf } from '../calc/summary';

/** Cable constructions: what the SLD label, the schedules, the BOQ and the
 * tray schedule say about each cable. Fire-rated cable (BS 8491 / BS 6387
 * CWZ / IEC 60331) is drawn dashed and marked FR; it's the default for life
 * safety circuits, and a check flags them on any other cable. The
 * calculations use the copper cable data for every type. */

export interface CableTypeDef {
  value: string; // stored on the feeder (older projects' values kept)
  label: string;
  code: string; // on the SLD
  fireRated?: boolean;
  lszh?: boolean;
  armoured?: boolean;
}

export const CABLE_TYPE_DEFS: CableTypeDef[] = [
  { value: 'XLPE/PVC/SWA', label: 'Cu/XLPE/SWA/PVC (armoured)', code: 'XLPE/SWA', armoured: true },
  { value: 'XLPE/SWA/PVC', label: 'Cu/XLPE/SWA/PVC (armoured, alt. name)', code: 'XLPE/SWA', armoured: true },
  { value: 'XLPE/SWA/LSZH', label: 'Cu/XLPE/SWA/LSZH (armoured, low smoke zero halogen)', code: 'LSZH', lszh: true, armoured: true },
  { value: 'XLPE/LSF/SWA', label: 'Cu/XLPE/LSF/SWA (low smoke and fume)', code: 'LSF', lszh: true, armoured: true },
  { value: 'XLPE/PVC', label: 'Cu/XLPE/PVC (unarmoured)', code: 'XLPE' },
  { value: 'XLPE 1C', label: 'Cu/XLPE single-core', code: '1C XLPE' },
  { value: 'PVC/PVC', label: 'Cu/PVC/PVC (flexible / wiring)', code: 'PVC' },
  { value: 'FR BS 8491', label: 'Fire-rated, BS 8491 (120 min, large cables)', code: 'FR', fireRated: true, lszh: true, armoured: true },
  { value: 'FR BS 6387 CWZ', label: 'Fire-rated, BS 6387 CWZ', code: 'FR', fireRated: true, lszh: true },
  { value: 'FR IEC 60331', label: 'Fire-rated, IEC 60331', code: 'FR', fireRated: true, lszh: true },
  { value: 'MICC', label: 'Mineral insulated (MICC), fire-rated', code: 'MICC', fireRated: true },
  { value: 'H1Z2Z2-K', label: 'Solar DC cable H1Z2Z2-K', code: 'PV DC' }
];

export const FIRE_RATED_DEFAULT = 'FR BS 8491';
export const CABLE_TYPES_ALL = CABLE_TYPE_DEFS.map((d) => d.value);

export const cableTypeDef = (value: string | undefined): CableTypeDef =>
  CABLE_TYPE_DEFS.find((d) => d.value === value) ?? { value: value ?? DEFAULT_CABLE_TYPE, label: value ?? DEFAULT_CABLE_TYPE, code: value ?? 'XLPE/SWA' };

/** Life safety circuits: fire pumps, feeders from an emergency board (EMDB)
 * and loads on the standby generator. Civil Defence expects fire-rated
 * cable for them. */
export function needsFireRated(project: Project, f: Feeder): boolean {
  if (loadTypeOf(f) === 'fire-pump') return true;
  if (f.essential) return true;
  const board = project.boards.find((b) => b.id === f.boardId);
  if (board?.kind === 'EMDB') return true;
  const fed = f.feedsBoardId ? project.boards.find((b) => b.id === f.feedsBoardId) : undefined;
  return fed?.kind === 'EMDB';
}

/** The cable type a feeder uses: its own, else fire-rated for life safety
 * circuits, else the default. */
export function cableTypeOf(project: Project, f: Feeder): CableTypeDef {
  return cableTypeDef(f.cableType ?? (needsFireRated(project, f) ? FIRE_RATED_DEFAULT : DEFAULT_CABLE_TYPE));
}

/** Life safety circuits on a cable that isn't fire-rated (chosen by hand). */
export function fireRatingIssues(project: Project): Feeder[] {
  return project.feeders.filter((f) => needsFireRated(project, f) && !cableTypeOf(project, f).fireRated);
}

/** Shown in the SLD label: nothing for the drawing's default cable (the
 * legend notes it), else the type's code. */
export function labelCode(project: Project, f: Feeder): string {
  const d = cableTypeOf(project, f);
  const def = cableTypeDef(DEFAULT_CABLE_TYPE);
  return d.code === def.code ? '' : d.code;
}
