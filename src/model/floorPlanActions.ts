import { buildingInfoOf } from '../calc/building';
import { routeNames } from '../calc/cableTray';
import { autoRoutes, autoTrays } from './cadAutoLink';
import { planFromDrawing, traysFromDrawing, type CadDrawing } from './cadDrawing';
import { applyCadLengths, pullCadLengths, type CadRoute } from './cadLengths';
import { applyBoardPlaces, pullBoardPlaces, type CadPlan } from './cadPlaces';
import { linkedDrawing, linkedRoutes, linksFor, withLinks, withPointPlaces } from './cadPlanLinks';
import { applyRooms, layerMapFor, proposeRooms, roomsFromPlan, withLayerMap, type CadRoom } from './cadRooms';
import { applyCadTrays, pullCadTrays, type CadTrayPlan } from './cadTrays';
import type { LevelRef } from './levels';
import type { CadLayerMap, CadPlanLinks, Project } from '../types';

/** The Floor plan page changes the model directly: each pick on the plan is one change to the project (one undo
 * step), using the same reading as the reviewed CAD pulls. Links and layer roles are kept in the project. */

export interface PlanContext {
  drawing: CadDrawing;
  file: string;
}

/** The plan as the page sees it in this project: layer roles, links, the plan with the links and the route / tray
 * layer curves, and the rooms its outlines give. */
export function planState(project: Project, ctx: PlanContext) {
  const base = planFromDrawing(ctx.drawing, { file: ctx.file });
  const roles = layerMapFor(project, base.layers ?? []);
  const links = linksFor(project, ctx.file);
  const linked = linkedDrawing(ctx.drawing, links);
  const curveLayers = roles.filter((m) => m.role === 'route' || m.role === 'tray').map((m) => m.layer);
  const plan = withPointPlaces(planFromDrawing(linked, { file: ctx.file, curveLayers }), links);
  const rooms = roomsFromPlan(base, roles, project.cadLength);
  return { base, roles, links, linked, plan, rooms };
}

/** The project with the plan's layer roles and new links saved. */
export const withPlan = (project: Project, roles: CadLayerMap[], links: CadPlanLinks) => withLinks(withLayerMap(project, roles), links);

/** Adds (or updates, by name / outline) rooms on a level; returns the project and the IDs of those rooms. */
export function putRooms(project: Project, rooms: CadRoom[], level: LevelRef, roles: CadLayerMap[]): { project: Project; ids: string[] } {
  const { proposals } = proposeRooms(project, rooms, level.building, level.level);
  const next = applyRooms(project, proposals.filter((p) => p.status !== 'same'), level.building, level.level, roles, proposals.filter((p) => p.status === 'same'));
  const onLevel = buildingInfoOf(next).rooms.filter((r) => r.buildingId === level.building && r.levelId === level.level);
  const ids = proposals.map((p) => p.existingId ?? onLevel.find((r) => r.name.toLowerCase() === p.name.toLowerCase())?.id).filter((x): x is string => !!x);
  return { project: next, ids };
}

/** A room picked on the plan (outline from the walls, or traced), named by the text inside it or "Room n". */
/** A room clicked or traced on the plan; `outline` in metres, kept on the room (ELV devices find their room by it). */
export function pickedRoom(project: Project, name: string, areaM2: number, file: string, level: LevelRef, outline?: [number, number][]): CadRoom {
  const onLevel = buildingInfoOf(project).rooms.filter((r) => r.buildingId === level.building && r.levelId === level.level);
  let n = onLevel.length + 1;
  while (!name && onLevel.some((r) => r.name === `Room ${n}`)) n += 1;
  return { name: name || `Room ${n}`, areaM2: Math.round(areaM2 * 100) / 100, layer: '', named: !!name, file, ...(outline ? { outline } : {}) };
}

export function renameRoom(project: Project, roomId: string, name: string): Project {
  const info = buildingInfoOf(project);
  const n = name.trim();
  if (!n) return project;
  return { ...project, building: { ...info, rooms: info.rooms.map((r) => (r.id === roomId ? { ...r, name: n } : r)) } };
}

/** Cable routes of the plan: linked by hand, then those on the route layers that link themselves. */
export function planRoutes(project: Project, plan: CadPlan, roles: CadLayerMap[]): CadRoute[] {
  const hand = linkedRoutes(plan);
  const handIds = new Set(hand.map((r) => r.feederId));
  const auto = autoRoutes(project, plan, roles);
  return [...hand, ...auto.routes.filter((r) => !handIds.has(r.feederId)).map((r) => ({ feederId: r.feederId, length: r.length, pieces: r.pieces.length }))];
}

/** Feeder lengths from the plan (route + allowances): only `feederIds` when given, else every one that differs. */
export function putLengths(project: Project, plan: CadPlan, roles: CadLayerMap[], feederIds?: string[]): Project {
  const pull = pullCadLengths(project, planRoutes(project, plan, roles), plan.units);
  return applyCadLengths(project, pull.proposals.filter((p) => !feederIds || feederIds.includes(p.feederId)));
}

/** The tray plan: runs linked by hand and on the tray layers; cable routes linked by hand and on the route layers. */
export function trayPlan(project: Project, linked: CadDrawing, plan: CadPlan, roles: CadLayerMap[]): CadTrayPlan {
  const hand = traysFromDrawing(linked);
  const handRoutes = new Set(hand.routes.map((r) => r.feederId));
  return {
    units: plan.units,
    trays: [...hand.trays, ...autoTrays(project, plan, roles)],
    routes: [...hand.routes, ...autoRoutes(project, plan, roles).routes.filter((r) => !handRoutes.has(r.feederId)).flatMap((r) => r.pieces.map((points) => ({ feederId: r.feederId, points })))]
  };
}

/** Tray lengths and the trays each feeder runs on, from the plan: only what touches `tray` when given, else all. */
export function putTrays(project: Project, linked: CadDrawing, plan: CadPlan, roles: CadLayerMap[], tray?: string): Project {
  const pull = pullCadTrays(project, trayPlan(project, linked, plan, roles));
  const feeders = pull.feeders.filter((f) => !tray || f.runs.some((r) => r.name === tray) || routeNames(project.feeders.find((x) => x.id === f.feederId)?.trayRoute).includes(tray));
  const lengths = pull.lengths.filter((l) => !tray || l.name === tray);
  return applyCadTrays(project, feeders, lengths);
}

/** Board rooms, levels and positions from the plan: only `boardIds` when given, else every board found. */
export function putBoards(project: Project, plan: CadPlan, level: LevelRef | undefined, boardIds?: string[]): Project {
  const pull = pullBoardPlaces(project, plan, level);
  return applyBoardPlaces(project, pull.proposals.filter((p) => !boardIds || boardIds.includes(p.boardId)), level);
}
