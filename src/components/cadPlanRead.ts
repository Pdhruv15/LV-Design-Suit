import { layerMapFor } from '../model/cadRooms';
import type { CadPlan } from '../model/cadPlaces';
import type { CadLayerMap, Project } from '../types';

type Cad = NonNullable<NonNullable<Window['lvds']>['openCadStudio']>;

/** Reads the floor plan with the curves of its route and tray layers: the layer roles given (as the engineer set
 * them in the dialog), else the project's saved roles and guesses for the plan's layers. */
export async function readPlanWithCurves(cad: Cad, project: Project, roles?: CadLayerMap[]): Promise<{ plan: CadPlan; roles: CadLayerMap[] }> {
  const first = roles?.length ? undefined : await cad.plan!();
  const map = roles?.length ? roles : layerMapFor(project, first?.layers ?? []);
  const curveLayers = map.filter((m) => m.role === 'route' || m.role === 'tray').map((m) => m.layer);
  const plan = curveLayers.length || !first ? await cad.plan!({ curveLayers }) : first;
  return { plan, roles: roles?.length ? roles : layerMapFor(project, plan.layers ?? []).map((m) => map.find((x) => x.layer === m.layer) ?? m) };
}
