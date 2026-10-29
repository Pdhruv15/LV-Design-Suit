import { chooseDrawing, reopenDrawing, sampleDrawing, type CadView } from '../../engines/cad/cadEngine';
import { levelOfPlan, plansOf, replacePlan, withLevelPlan } from '../../model/cadPlans';
import { CAD_UNITS, planScale, withPlanUnit, type CadUnit } from '../../model/cadUnits';
import { floorLabel, type Floor } from '../../model/levels';
import { isSample } from '../floorPlanState';
import { pathOfPlan, type CadState } from './cadState';
import type { Project } from '../../types';

type Apply = (next: Project, message: string) => void;
type MenuItem = { label: string; title: string; onClick: () => void; sep?: boolean };

/** The level a drawing is the plan of, and what the CAD page works on: that level, else the first level (not set yet). */
export function planLevel(p: Project, file: string | undefined): { floor?: Floor; set: boolean } {
  const here = file ? levelOfPlan(p, file) : undefined;
  return here ? { floor: here, set: true } : { floor: plansOf(p)[0]?.floor, set: false };
}

/** Makes `file` the plan of a level (Level in the ribbon, or the device panel). */
export function setPlanLevel(p: Project, file: string, f: Floor, apply: Apply, units?: number) {
  const label = floorLabel(p.building, f);
  const before = plansOf(p).find((x) => x.floor.key === f.key)?.file;
  apply(withLevelPlan(p, file, f.ref, units), `${file} is the plan of ${label}${before && before.toLowerCase() !== file.toLowerCase() ? ` (was ${before})` : ''} · ⌘Z to undo`);
}

/** Design CAD's File group: Plans (each level's drawing: open it, or open one for a level without), Level, Units. */
export function cadFileMenu(p: Project, cad: CadState, apply: Apply, status: (m: string) => void) {
  const view = cad.view;
  const plans = plansOf(p);
  const { floor, set } = planLevel(p, view?.file);
  const scale = view ? planScale(p, view.file, view.info.units) : undefined;

  async function openFor(f: Floor, file: string | undefined, replace: boolean) {
    const path = file ? pathOfPlan(p.id, file) : undefined;
    let v: CadView | null;
    try {
      v = !replace && file && isSample(file) ? await sampleDrawing(file)
        : !replace && path && window.lvds?.cadFile?.readBytes ? await reopenDrawing(path)
        : await chooseDrawing();
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); cad.say(msg); status(msg); return; }
    if (!v) return;
    cad.open(v);
    status(`${v.file} opened`);
    if (levelOfPlan(p, v.file)?.key === f.key) return;
    const r = replacePlan(p, v.file, f.ref, v.info.units);
    apply(r.project, `${v.file} is the plan of ${floorLabel(p.building, f)}${r.replaced ? ` in place of ${r.replaced} (what you drew moved to it)` : ''} · ⌘Z to undo`);
  }

  const plansMenu: MenuItem[] = plans.map((x) => ({
    label: `${x.label} · ${x.file ?? 'no plan — open…'}`,
    title: x.file ? `Open ${x.file}, the plan of ${x.label}` : `Open a drawing as the plan of ${x.label}`,
    onClick: () => void openFor(x.floor, x.file, false)
  }));
  if (view && set && floor) {
    plansMenu.push({ label: `Replace ${floorLabel(p.building, floor)}'s plan…`, title: 'Open the architect\'s next revision for this level: what you drew moves to it, devices stay', onClick: () => void openFor(floor, view.file, true), sep: true });
  }
  const unitsMenu: MenuItem[] = CAD_UNITS.map((u) => ({
    label: `${u.label}${scale?.unit === u.id && !scale.assumed ? ' ✓' : ''}`,
    title: `The drawing is in ${u.label.toLowerCase()}`,
    onClick: () => {
      if (!view) return;
      const r = withPlanUnit(p, view.file, view.info.units, u.id as CadUnit, floor?.ref, 'mm');
      const moved = r.rooms + r.devices ? ` — ${[r.rooms && `${r.rooms} room${r.rooms === 1 ? '' : 's'}`, r.devices && `${r.devices} device${r.devices === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} scaled with it` : '';
      apply(r.project, `${view.file}: units ${u.id}${moved} · ⌘Z to undo`);
    }
  }));

  return {
    plans: plansMenu,
    plansSub: plans.length ? `${plans.filter((x) => x.file).length} of ${plans.length} levels` : undefined,
    level: floor && set ? floor.name : 'Level?',
    levelTitle: !view ? 'The level the drawing is the plan of' : set && floor ? `${view.file} is the plan of ${floorLabel(p.building, floor)}: rooms and devices go to it` : `Which level is ${view.file}? Choose it so rooms and devices go to that level`,
    levels: view ? plans.map((x) => ({ label: x.label, title: `${view.file} is the plan of ${x.label}`, onClick: () => setPlanLevel(p, view.file, x.floor, apply, view.info.units) })) : [],
    unit: scale ? `${scale.label}${scale.assumed ? '?' : ''}` : 'Units',
    unitTitle: !scale ? 'The units the drawing is in' : scale.assumed ? 'The drawing does not say its units: taken as millimetres. Choose them if not.' : `The drawing is in ${scale.label}`,
    units: view ? unitsMenu : []
  };
}
