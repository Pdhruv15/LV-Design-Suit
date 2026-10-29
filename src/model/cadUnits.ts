import { buildingInfoOf } from '../calc/building';
import type { Project } from '../types';

/** The units a CAD floor plan is drawn in. What the drawing says (INSUNITS) is used unless the engineer chose
 * otherwise for that file; a drawing that says nothing waits for the engineer's choice. Areas, outlines, device
 * positions and lengths are all worked out from it. */

export type CadUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export const CAD_UNITS: { id: CadUnit; label: string; code: number; m: number }[] = [
  { id: 'mm', label: 'Millimetres', code: 4, m: 0.001 }, { id: 'cm', label: 'Centimetres', code: 5, m: 0.01 }, { id: 'm', label: 'Metres', code: 6, m: 1 },
  { id: 'in', label: 'Inches', code: 1, m: 0.0254 }, { id: 'ft', label: 'Feet', code: 2, m: 0.3048 }
];
const byCode = (code: number | undefined) => CAD_UNITS.find((u) => u.code === code);
const keyOf = (file: string) => file.trim().toLowerCase();

export interface PlanUnits {
  /** What the drawing says; undefined when it does not (INSUNITS 0 or a unit the app does not use). */
  declared?: CadUnit;
  /** The engineer's choice for this file, if any. */
  chosen?: CadUnit;
  /** The units in use: the choice, else the drawing's; undefined until one is known. */
  unit?: CadUnit;
  /** INSUNITS code to read the plan with; undefined leaves the drawing's own. */
  code?: number;
  needsChoice: boolean;
}

export function planUnits(p: Project, file: string | undefined, insunits: number | undefined): PlanUnits {
  const declared = byCode(insunits)?.id;
  const chosen = file ? p.cadPlanUnits?.[keyOf(file)] : undefined;
  const unit = chosen ?? declared;
  return { ...(declared ? { declared } : {}), ...(chosen ? { chosen } : {}), ...(unit ? { unit, code: CAD_UNITS.find((u) => u.id === unit)!.code } : {}), needsChoice: !unit };
}

/** Metres per drawing unit for a plan: the engineer's choice for the file, else what the drawing says, else millimetres
 * (`assumed`, as architects' plans usually are). */
export function planScale(p: Project, file: string | undefined, insunits: number | undefined): { unit: CadUnit; factor: number; label: string; assumed: boolean } {
  const u = planUnits(p, file, insunits).unit;
  const def = CAD_UNITS.find((x) => x.id === (u ?? 'mm'))!;
  return { unit: def.id, factor: def.m, label: def.id, assumed: !u };
}

/** Sets the units of a plan file. What was already taken from the plan in the old units is scaled to the new ones (one
 * undo step): the outlines and areas of the level's rooms that came from a plan, and the devices placed on the level
 * (ELV devices, LV points and boards placed in Design CAD), so they stay where they were on the drawing.
 * Cable and tray lengths are worked out from the plan again when applied. */
export function withPlanUnit(p: Project, file: string, insunits: number | undefined, unit: CadUnit, level?: { building: string; level: string }, assumed?: CadUnit): { project: Project; rooms: number; devices: number } {
  // `assumed`: the units the plan was being read in when it said none (Design CAD takes millimetres).
  const before = planUnits(p, file, insunits).unit ?? assumed;
  const units = { ...(p.cadPlanUnits ?? {}), [keyOf(file)]: unit };
  let next: Project = { ...p, cadPlanUnits: units };
  if (!before || before === unit || !level) return { project: next, rooms: 0, devices: 0 };
  const k = CAD_UNITS.find((u) => u.id === unit)!.m / CAD_UNITS.find((u) => u.id === before)!.m;
  const info = buildingInfoOf(next);
  const fromPlan = (r: (typeof info.rooms)[number]) => r.buildingId === level.building && r.levelId === level.level && !!r.outline?.length
    && (!r.source || (r.source.app === 'cad' && keyOf(r.source.file ?? file) === keyOf(file)));
  let rooms = 0;
  const scaled = info.rooms.map((r) => {
    if (!fromPlan(r)) return r;
    rooms += 1;
    return { ...r, areaM2: Math.round(r.areaM2 * k * k * 100) / 100, outline: r.outline!.map(([x, y]): [number, number] => [Math.round(x * k * 1000) / 1000, Math.round(y * k * 1000) / 1000]) };
  });
  let devices = 0;
  const elvDevices = p.elvDevices?.map((d) => {
    if (d.buildingId !== level.building || d.levelId !== level.level) return d;
    devices += 1;
    return { ...d, x: Math.round(d.x * k * 100) / 100, y: Math.round(d.y * k * 100) / 100 };
  });
  const onLevel = (r?: { building: string; level: string }) => r?.building === level.building && r?.level === level.level;
  const lvPoints = p.lvPoints?.map((d) => {
    if (d.buildingId !== level.building || d.levelId !== level.level) return d;
    devices += 1;
    return { ...d, x: Math.round(d.x * k * 1000) / 1000, y: Math.round(d.y * k * 1000) / 1000 };
  });
  const boards = p.boards.map((b) => {
    if (!b.planPoint || !onLevel(b.level)) return b;
    devices += 1;
    return { ...b, planPoint: { x: Math.round(b.planPoint.x * k * 1000) / 1000, y: Math.round(b.planPoint.y * k * 1000) / 1000 } };
  });
  next = { ...next, building: { ...info, rooms: scaled }, boards, ...(elvDevices ? { elvDevices } : {}), ...(lvPoints ? { lvPoints } : {}) };
  return { project: next, rooms, devices };
}
