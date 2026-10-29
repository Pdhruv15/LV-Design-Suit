import { floorLabel, floorList, type Floor, type LevelRef } from './levels';
import type { CadPlan, Project } from '../types';

/** The plans of a project in Design CAD: which drawing file is each level's plan. One file per level, and a file is the
 * plan of one level, so opening it shows that level (rooms and devices go to it). The file's path stays on this computer
 * (src/components/cad/cadState.ts); the project keeps only the file name. */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const onLevel = (x: CadPlan, l: LevelRef) => x.building === l.building && x.level === l.level;

/** Levels a plan can be for (a typical group's first floor stands for the group). */
export const planFloors = (p: Project): Floor[] => floorList(p.building).filter((f) => !f.ref.index);

/** Every level with its plan file, if it has one. */
export function plansOf(p: Project): { floor: Floor; label: string; file?: string }[] {
  return planFloors(p).map((floor) => ({ floor, label: floorLabel(p.building, floor), file: p.cadPlans?.find((x) => onLevel(x, floor.ref))?.file }));
}

/** The level a file is the plan of. */
export function levelOfPlan(p: Project, file: string): Floor | undefined {
  const plan = p.cadPlans?.find((x) => same(x.file, file));
  return plan ? planFloors(p).find((f) => onLevel(plan, f.ref)) : undefined;
}

/** The project with `file` as the plan of `level`: it replaces that level's earlier plan, and stops being another
 * level's plan. */
export function withLevelPlan(p: Project, file: string, level: LevelRef, units?: number): Project {
  const rest = (p.cadPlans ?? []).filter((x) => !same(x.file, file) && !onLevel(x, level));
  return { ...p, cadPlans: [...rest, { building: level.building, level: level.level, file, ...(units !== undefined ? { units } : {}) }] };
}

/** The project with `file` as the plan of `level` in place of its earlier plan (the architect's next revision): what
 * was drawn over the earlier plan moves to the new one. Devices are kept per level, so they stay as they are. */
export function replacePlan(p: Project, file: string, level: LevelRef, units?: number): { project: Project; replaced?: string } {
  const before = p.cadPlans?.find((x) => onLevel(x, level))?.file;
  const next = withLevelPlan(p, file, level, units);
  if (!before || same(before, file)) return { project: next };
  const old = next.cadSketch?.find((x) => same(x.file, before));
  if (!old || next.cadSketch?.some((x) => same(x.file, file))) return { project: next, replaced: before };
  return { project: { ...next, cadSketch: next.cadSketch!.map((x) => (x === old ? { ...x, file } : x)) }, replaced: before };
}

/** The project without a plan for `level`. */
export function withoutLevelPlan(p: Project, level: LevelRef): Project {
  const rest = (p.cadPlans ?? []).filter((x) => !onLevel(x, level));
  const { cadPlans: _old, ...base } = p;
  return rest.length ? { ...base, cadPlans: rest } : base;
}
