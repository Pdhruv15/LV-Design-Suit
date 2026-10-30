import { ELV_DEVICES } from '../../elv/devices';
import { symbolSvg } from '../../elv/planSheets';
import { devicesOn } from '../../elv/placed';
import type { Project } from '../../types';

/** The ELV devices of a level for the LV plan sheets (src/docs/planLayout.ts): where each is, its legend name and its
 * plan symbol as SVG at a paper position and radius (mm), the same symbols as the ELV plan sheets. */
export interface ElvPlanSymbol { x: number; y: number; key: string; label: string; svg: (x: number, y: number, r: number) => string }

export const elvPlanSymbols = (p: Project, buildingId: string, levelId: string): ElvPlanSymbol[] =>
  devicesOn(p, buildingId, levelId).map((d) => {
    const spec = ELV_DEVICES[d.type];
    return { x: d.x, y: d.y, key: `elv:${d.type}`, label: spec.label, svg: (x, y, r) => symbolSvg(spec.symbol, x, y, r, d.rotationDeg ?? 0) };
  });
