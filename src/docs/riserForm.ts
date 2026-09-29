import type { Feeder, MeterType, Project } from '../types';
import { sizeRiser } from '../calc/busbar';
import { STANDARD_ICU_KA } from '../calc/sizing';
import { subtree } from '../calc/pfc';
import { cpcOf } from '../calc/earthing';
import type { PhaseKw } from '../calc/loadSchedule';
import { connectedPhaseKw, deviceOf } from './mdSheet';

/** "Bus bar riser — details of connected load / max. demand" (DEWA): the
 * riser's incomer (feeding breaker, the busway), then one row per tap-off
 * (the SMDB / DB it feeds, its breaker and cable, connected load per phase,
 * TCL, D.F, MD and the kWh meters below it), totals and the TCL / MDL / DF box. */

export interface RiserFormRow {
  name: string;
  sptp: string;
  acb?: number;
  mccb?: number;
  faultKa?: number;
  cores?: string;
  type?: string;
  size?: string;
  ecc?: string | number;
  phases: PhaseKw;
  tcl: number;
  df?: number;
  md?: number;
  meters: Record<MeterType, number>;
  remarks?: string;
}

export interface RiserForm {
  ref: string;
  fedFrom: string;
  incomer: RiserFormRow & { busway: string };
  rows: RiserFormRow[];
  totals: { phases: PhaseKw; tcl: number; md: number; meters: Record<MeterType, number> };
  df: number;
}

const Z = (): Record<MeterType, number> => ({ '1-PH': 0, '3-PH': 0, CT: 0 });
const sum = (p: PhaseKw) => p.R + p.Y + p.B;

export function buildRiserForm(project: Project, riserId: string): RiserForm | null {
  const r = (project.busRisers ?? []).find((x) => x.id === riserId);
  if (!r) return null;
  const res = sizeRiser(project, r);
  const dfDefault = project.info?.mdDemandFactor ?? 0.8;
  const rows: RiserFormRow[] = [];
  for (const fl of res.floors) {
    const f = fl.floor;
    const count = Math.max(1, f.count ?? 1);
    const b = f.boardId ? project.boards.find((x) => x.id === f.boardId) : undefined;
    for (let k = 0; k < count; k++) {
      const name = count > 1 ? `${f.name} (${k + 1}/${count})` : f.name;
      if (b) {
        const inc: Feeder | undefined = project.feeders.find((x) => x.feedsBoardId === b.id);
        const phases = connectedPhaseKw(project, b.id);
        const meters = Z();
        for (const x of project.feeders) if (subtree(project, b.id).has(x.boardId) && x.kwhMeter) meters[x.kwhMeter]++;
        const df = b.mdDemandFactor ?? dfDefault;
        rows.push({
          name: b.id, sptp: 'TP', acb: inc && deviceOf(inc) === 'ACB' ? inc.breakerRatingA : undefined, mccb: inc && deviceOf(inc) !== 'ACB' ? inc.breakerRatingA : fl.tapOffA,
          faultKa: inc?.breakerIcuKa, cores: inc ? `${inc.cores}C` : undefined, type: inc?.cableType ?? (inc ? 'XLPE/SWA/PVC' : undefined), size: inc ? String(inc.cableCsaMm2) : undefined, ecc: inc ? cpcOf(inc) : undefined,
          phases, tcl: sum(phases), df, md: sum(phases) * df, meters, remarks: count > 1 ? `Typical ×${count}` : undefined
        });
      } else {
        const kw = fl.kw;
        const phases = { R: kw / 3, Y: kw / 3, B: kw / 3 };
        rows.push({ name, sptp: 'TP', mccb: fl.tapOffA, phases, tcl: kw, df: dfDefault, md: kw * dfDefault, meters: Z() });
      }
    }
  }
  const phases = rows.reduce((a, x) => ({ R: a.R + x.phases.R, Y: a.Y + x.phases.Y, B: a.B + x.phases.B }), { R: 0, Y: 0, B: 0 });
  const meters = Z();
  rows.forEach((x) => (Object.keys(meters) as MeterType[]).forEach((m) => (meters[m] += x.meters[m])));
  const tcl = sum(phases);
  const md = rows.reduce((a, x) => a + (x.md ?? 0), 0);
  const fault = res.faultKa !== undefined ? STANDARD_ICU_KA.find((k) => k >= res.faultKa! - 1e-6) : undefined;
  return {
    ref: r.name, fedFrom: r.sourceBoardId ?? '',
    incomer: {
      name: 'INCOMER', sptp: 'TP', acb: res.feederBreakerA, faultKa: fault, phases, tcl, meters: Z(),
      busway: res.type ? `${res.type.ratingA}A TPN+E DISTRIBUTED BUS RISER` : 'BUS RISER'
    },
    rows, totals: { phases, tcl, md, meters }, df: tcl > 0 ? md / tcl : dfDefault
  };
}
