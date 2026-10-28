import { buildingInfoOf } from '../calc/building';
import type { BuildingLevel, Project } from '../types';
import type { Catalogue } from './defaults';
import { ELV_DEVICES, type ElvDeviceType } from './devices';
import { elvBasis, loopAlarmMa, loopDevices, loopMa, type ElvSettings } from './estimate';
import { devicesOn, type ElvDevice } from './placed';

/** The placed ELV devices grouped the way they are wired, worked out again on every change (nothing to keep in step):
 * fire alarm detection zones, loops with addresses in route order and their isolators; CCTV and ICT switch ports;
 * door controllers; PA zones and amplifiers. A typical level is a floor of its own for every copy, so a device on it
 * appears once per floor. Capacities are the project's ELV catalogue rules (defaults.ts). */

export interface DeviceRef { deviceId: string; type: ElvDeviceType; levelId: string; floor?: number; roomId?: string }
export interface LoopDevice extends DeviceRef { address: number; zone: string; quiescentMa: number; alarmMa: number }
export interface FireZone { id: string; levelId: string; floor?: number; rooms: string[]; areaM2: number }
export interface FireLoop { id: string; panel: number; loop: number; devices: LoopDevice[]; quiescentMa: number; alarmMa: number; isolators: number }
export interface SwitchGroup { id: string; system: 'cctv' | 'ict'; levelId: string; floor?: number; ports: number; poeW: number; devices: DeviceRef[] }
export interface DoorController { id: string; levelId: string; floor?: number; doors: number; devices: DeviceRef[] }
export interface PaZone { id: string; levelId: string; floor?: number; speakers: number; watts: number; amplifier: string; devices: DeviceRef[] }
export interface Amplifier { id: string; ratedW: number; loadW: number; zones: string[] }

export interface BuildingSchedules {
  buildingId: string;
  zones: FireZone[];
  loops: FireLoop[];
  switches: SwitchGroup[];
  controllers: DoorController[];
  paZones: PaZone[];
  amplifiers: Amplifier[];
}
export interface ElvSchedules { buildings: BuildingSchedules[]; warnings: string[] }

type Floor = { level: BuildingLevel; floor?: number; devices: ElvDevice[] };
const tag = (f: Floor) => `${f.level.id}${f.floor ? `-F${f.floor}` : ''}`;
const ref = (d: ElvDevice, f: Floor): DeviceRef => ({ deviceId: d.id, type: d.type, levelId: f.level.id, ...(f.floor ? { floor: f.floor } : {}), ...(d.roomId ? { roomId: d.roomId } : {}) });

/** Route order on one floor: start at the device nearest the plan origin's corner, then always the nearest next. */
export function routeOrder<T extends { x: number; y: number }>(items: T[]): T[] {
  const left = [...items];
  const out: T[] = [];
  let at = left.reduce((best, d) => (d.x + d.y < best.x + best.y ? d : best), left[0]);
  while (left.length) {
    const i = left.reduce((bi, d, j) => (Math.hypot(d.x - at.x, d.y - at.y) < Math.hypot(left[bi].x - at.x, left[bi].y - at.y) ? j : bi), 0);
    at = left.splice(i, 1)[0];
    out.push(at);
  }
  return out;
}

/** Fills groups in order: a new group when the next item would pass any limit. */
function fill<T>(items: T[], fits: (group: T[], next: T) => boolean): T[][] {
  const groups: T[][] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && fits(g, it)) g.push(it);
    else groups.push([it]);
  }
  return groups;
}

export function elvSchedules(project: Project, settings: ElvSettings | undefined = project.elv): ElvSchedules {
  const { catalogue: c } = elvBasis(settings);
  const info = buildingInfoOf(project);
  const warnings: string[] = [];
  const buildings: BuildingSchedules[] = [];
  for (const b of info.buildings) {
    const floors: Floor[] = [];
    for (const l of b.levels) {
      const devices = devicesOn(project, b.id, l.id);
      if (!devices.length) continue;
      const n = Math.max(1, Math.round(l.count ?? 1));
      for (let f = 1; f <= n; f++) floors.push({ level: l, ...(n > 1 ? { floor: f } : {}), devices });
    }
    if (!floors.length) continue;
    const out: BuildingSchedules = { buildingId: b.id, zones: [], loops: [], switches: [], controllers: [], paZones: [], amplifiers: [] };
    fireAlarm(project, b.name, floors, c, out, warnings);
    for (const f of floors) {
      switches(f, 'cctv', c, out);
      switches(f, 'ict', c, out);
      controllers(f, c, out);
    }
    publicAddress(b.name, floors, c, out, warnings);
    buildings.push(out);
  }
  return { buildings, warnings };
}

function fireAlarm(project: Project, building: string, floors: Floor[], c: Catalogue, out: BuildingSchedules, warnings: string[]) {
  const k = c.fireAlarm;
  const rooms = buildingInfoOf(project).rooms;
  const zoneOf = new Map<string, string>(); // `${floor tag}:${room id or ''}` → zone
  const ordered: { d: ElvDevice; f: Floor }[] = [];
  for (const f of floors) {
    const onFloor = f.devices.filter((d) => ELV_DEVICES[d.type].system === 'fire-alarm');
    if (!onFloor.length) continue;
    // Zones: the floor's rooms in order, at most zoneMaxM2 each (BS 5839-1: a zone is on one floor).
    const floorRooms = rooms.filter((r) => r.buildingId === out.buildingId && r.levelId === f.level.id);
    const groups = fill(floorRooms, (g, r) => g.reduce((t, x) => t + x.areaM2, 0) + r.areaM2 <= k.zoneMaxM2);
    if (!groups.length) groups.push([]);
    for (const g of groups) {
      const zone: FireZone = { id: `Z${out.zones.length + 1}`, levelId: f.level.id, ...(f.floor ? { floor: f.floor } : {}), rooms: g.map((r) => r.id), areaM2: Math.round(g.reduce((t, r) => t + r.areaM2, 0) * 10) / 10 };
      out.zones.push(zone);
      for (const r of g) {
        zoneOf.set(`${tag(f)}:${r.id}`, zone.id);
        if (r.areaM2 > k.zoneMaxM2) warnings.push(`${building}, ${f.level.name}: ${r.name} (${Math.round(r.areaM2)} m²) is larger than a ${k.zoneMaxM2} m² detection zone: split it into zones.`);
      }
    }
    zoneOf.set(`${tag(f)}:`, out.zones[out.zones.length - groups.length].id); // devices outside every room: the floor's first zone
    for (const d of routeOrder(onFloor)) ordered.push({ d, f });
  }
  if (!ordered.length) return;
  const maxDevices = loopDevices(c), maxMa = loopMa(c);
  const loads = ordered.map(({ d, f }) => ({ d, f, load: ELV_DEVICES[d.type].load(c) }));
  const alarmOf = (g: typeof loads) => loopAlarmMa(g.map((y) => ({ n: 1, load: y.load })), c);
  const loops = fill(loads, (g, x) => g.length + 1 <= maxDevices && alarmOf([...g, x]) <= maxMa);
  loops.forEach((g, i) => {
    const panel = Math.floor(i / k.loopsPerPanel) + 1, loop = (i % k.loopsPerPanel) + 1;
    const devices = g.map(({ d, f, load }, a): LoopDevice => ({
      ...ref(d, f), address: a + 1, zone: zoneOf.get(`${tag(f)}:${d.roomId ?? ''}`) ?? zoneOf.get(`${tag(f)}:`)!,
      quiescentMa: load.quiescentMa ?? 0, alarmMa: load.alarmMa ?? 0
    }));
    const r2 = (x: number) => Math.round(x * 100) / 100;
    out.loops.push({ id: `P${panel}-L${loop}`, panel, loop, devices, quiescentMa: r2(devices.reduce((t, x) => t + x.quiescentMa, 0)), alarmMa: r2(alarmOf(g)), isolators: Math.ceil(devices.length / k.isolatorMaxDevices) });
    if (g.length === 1 && alarmOf(g) > maxMa) warnings.push(`${building}: ${g[0].d.id} alone draws more than a loop's ${maxMa} mA in alarm.`);
  });
}

function switches(f: Floor, system: 'cctv' | 'ict', c: Catalogue, out: BuildingSchedules) {
  const k = system === 'cctv' ? c.cctv : c.ict;
  const items = routeOrder(f.devices.filter((d) => ELV_DEVICES[d.type].system === system && ELV_DEVICES[d.type].load(c).port))
    .map((d) => ({ d, w: ELV_DEVICES[d.type].load(c).watts ?? 0 }));
  const groups = fill(items, (g, x) => g.length + 1 <= k.switchPorts && g.reduce((t, y) => t + y.w, 0) + x.w <= k.switchBudgetW);
  groups.forEach((g, i) => out.switches.push({
    id: `${system === 'cctv' ? 'CCTV' : 'ICT'}-SW-${tag(f)}-${i + 1}`, system, levelId: f.level.id, ...(f.floor ? { floor: f.floor } : {}),
    ports: g.length, poeW: Math.round(g.reduce((t, y) => t + y.w, 0) * 100) / 100, devices: g.map((y) => ref(y.d, f))
  }));
}

/** Doors per room: a door per lock (in and out readers on one door are two readers and one lock), or a door per
 * reader where no locks are drawn. */
function controllers(f: Floor, c: Catalogue, out: BuildingSchedules) {
  const acs = f.devices.filter((d) => ELV_DEVICES[d.type].system === 'access-control');
  const byRoom = new Map<string, ElvDevice[]>();
  for (const d of acs) byRoom.set(d.roomId ?? '', [...(byRoom.get(d.roomId ?? '') ?? []), d]);
  const doors = [...byRoom.values()].map((list) => ({
    n: list.filter((d) => d.type === 'maglock').length || list.filter((d) => d.type === 'card-reader').length,
    list, x: list[0].x, y: list[0].y
  })).filter((g) => g.n);
  const groups = fill(routeOrder(doors), (g, x) => g.reduce((t, y) => t + y.n, 0) + x.n <= c.access.doorsPerController);
  groups.forEach((g, i) => out.controllers.push({
    id: `ACS-${tag(f)}-${i + 1}`, levelId: f.level.id, ...(f.floor ? { floor: f.floor } : {}), doors: g.reduce((t, y) => t + y.n, 0), devices: g.flatMap((y) => y.list.map((d) => ref(d, f)))
  }));
}

/** PA: a zone per floor (voice alarm zones follow floors and fire compartments); zones on amplifiers first-fit,
 * largest first, within amplifierW ÷ headroom. */
function publicAddress(building: string, floors: Floor[], c: Catalogue, out: BuildingSchedules, warnings: string[]) {
  const k = c.pa;
  const usable = k.amplifierW / k.headroom;
  const zones: PaZone[] = [];
  for (const f of floors) {
    const spk = f.devices.filter((d) => ELV_DEVICES[d.type].system === 'public-address');
    if (!spk.length) continue;
    const watts = Math.round(spk.reduce((t, d) => t + (ELV_DEVICES[d.type].load(c).watts ?? 0), 0) * 100) / 100;
    zones.push({ id: `PA-${tag(f)}`, levelId: f.level.id, ...(f.floor ? { floor: f.floor } : {}), speakers: spk.length, watts, amplifier: '', devices: spk.map((d) => ref(d, f)) });
  }
  for (const z of [...zones].sort((a, b) => b.watts - a.watts)) {
    if (z.watts > usable) warnings.push(`${building}: PA zone ${z.id} (${z.watts} W) needs more than one ${k.amplifierW} W amplifier: split it into zones.`);
    let amp = out.amplifiers.find((a) => a.loadW + z.watts <= usable);
    if (!amp) {
      amp = { id: `AMP-${out.amplifiers.length + 1}`, ratedW: k.amplifierW, loadW: 0, zones: [] };
      out.amplifiers.push(amp);
    }
    amp.loadW = Math.round((amp.loadW + z.watts) * 100) / 100;
    amp.zones.push(z.id);
    z.amplifier = amp.id;
  }
  out.paZones.push(...zones);
}
