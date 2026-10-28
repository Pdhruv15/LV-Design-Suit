import { z } from 'zod';
import { buildingInfoOf } from '../calc/building';
import type { BuildingRoom, Project } from '../types';
import type { ElvSystem } from './defaults';
import { ELV_DEVICE_TYPES, ELV_DEVICES, type ElvDeviceType } from './devices';

/** ELV devices the engineer places on a level's floor plan (`project.elvDevices`), in metres on the plan, the same
 * coordinates as the room outlines read from CAD. Each device knows the room it sits in (the smallest outline around
 * it), found when it is placed or moved. Once any device of a system is placed on a level, that level is designed for
 * that system: the estimate counts the placed devices there instead of the room-area rules. */

export interface ElvDevice {
  id: string; // permanent: never reused for another device
  type: ElvDeviceType;
  buildingId: string;
  levelId: string;
  x: number; // metres on the level's plan
  y: number;
  rotationDeg?: number; // cameras, speakers: the direction they face (0 = +x, anticlockwise)
  roomId?: string; // absent: outside every room outline
}

const coord = z.number().finite().min(-1e6).max(1e6);
/** A device to place, as the headless tools take it. */
export const newElvDevice = z.object({
  type: z.enum(ELV_DEVICE_TYPES),
  x: coord.describe('Metres on the level plan'),
  y: coord.describe('Metres on the level plan'),
  rotationDeg: z.number().min(-360).max(360).optional().describe('Cameras and speakers: direction they face, degrees anticlockwise from +x')
}).strict();
export type NewElvDevice = z.infer<typeof newElvDevice>;

export const devicesOn = (p: Project, buildingId: string, levelId: string) =>
  (p.elvDevices ?? []).filter((d) => d.buildingId === buildingId && d.levelId === levelId);

function inside([x, y]: [number, number], pts: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The room a point is in: the smallest room outline on the level around it. */
export function roomAt(p: Project, buildingId: string, levelId: string, x: number, y: number): BuildingRoom | undefined {
  return buildingInfoOf(p).rooms
    .filter((r) => r.buildingId === buildingId && r.levelId === levelId && r.outline && r.outline.length >= 3 && inside([x, y], r.outline))
    .sort((a, b) => a.areaM2 - b.areaM2)[0];
}

function nextDeviceId(p: Project): number {
  return (p.elvDevices ?? []).reduce((m, d) => Math.max(m, Number(/^E(\d+)$/.exec(d.id)?.[1] ?? 0)), p.elvDeviceSeq ?? 0) + 1;
}

/** Adds devices on a level, each in the room found under it. */
export function placeDevices(p: Project, buildingId: string, levelId: string, items: NewElvDevice[]): { project: Project; ids: string[] } {
  const level = buildingInfoOf(p).buildings.find((b) => b.id === buildingId)?.levels.find((l) => l.id === levelId);
  if (!level) throw new Error(`No level ${levelId} in building ${buildingId}.`);
  let n = nextDeviceId(p);
  const added = items.map((d): ElvDevice => {
    const room = roomAt(p, buildingId, levelId, d.x, d.y);
    return { id: `E${n++}`, type: d.type, buildingId, levelId, x: d.x, y: d.y, ...(d.rotationDeg !== undefined ? { rotationDeg: d.rotationDeg } : {}), ...(room ? { roomId: room.id } : {}) };
  });
  return { project: { ...p, elvDevices: [...(p.elvDevices ?? []), ...added], elvDeviceSeq: n - 1 }, ids: added.map((d) => d.id) };
}

/** Moves a device (and finds its room again). */
export function moveDevice(p: Project, id: string, x: number, y: number, rotationDeg?: number): Project {
  const d = (p.elvDevices ?? []).find((e) => e.id === id);
  if (!d) throw new Error(`No ELV device ${id}.`);
  const room = roomAt(p, d.buildingId, d.levelId, x, y);
  const { roomId: _old, ...rest } = d;
  const moved: ElvDevice = { ...rest, x, y, ...(rotationDeg !== undefined ? { rotationDeg } : {}), ...(room ? { roomId: room.id } : {}) };
  return { ...p, elvDevices: (p.elvDevices ?? []).map((e) => (e.id === id ? moved : e)) };
}

/** Removes devices; their IDs are not given out again. */
export function removeDevices(p: Project, ids: string[]): Project {
  const gone = new Set(ids);
  const missing = ids.filter((id) => !(p.elvDevices ?? []).some((d) => d.id === id));
  if (missing.length) throw new Error(`No ELV device ${missing.join(', ')}.`);
  return { ...p, elvDevices: (p.elvDevices ?? []).filter((d) => !gone.has(d.id)), elvDeviceSeq: nextDeviceId(p) - 1 };
}

/** Placed devices on one level: which systems are designed there, devices per room, and devices outside every room. */
export interface PlacedOnLevel {
  systems: Set<ElvSystem>;
  byRoom: Map<string, Partial<Record<ElvDeviceType, number>>>;
  loose: Partial<Record<ElvDeviceType, number>>;
  looseCount: number;
}

export function placedOnLevel(p: Project, buildingId: string, levelId: string): PlacedOnLevel {
  const out: PlacedOnLevel = { systems: new Set(), byRoom: new Map(), loose: {}, looseCount: 0 };
  const rooms = new Set(buildingInfoOf(p).rooms.filter((r) => r.buildingId === buildingId && r.levelId === levelId).map((r) => r.id));
  for (const d of devicesOn(p, buildingId, levelId)) {
    out.systems.add(ELV_DEVICES[d.type].system);
    let into = out.loose;
    if (d.roomId && rooms.has(d.roomId)) {
      into = out.byRoom.get(d.roomId) ?? {};
      out.byRoom.set(d.roomId, into);
    } else out.looseCount += 1;
    into[d.type] = (into[d.type] ?? 0) + 1;
  }
  return out;
}
