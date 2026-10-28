import { z } from 'zod';
import { buildingInfoOf } from '../calc/building';
import type { BuildingLevel, BuildingRoom, Project, ProjectBuilding } from '../types';
import { DEFAULT_ASSUMPTIONS, DEFAULT_CATALOGUE, DEFAULT_RULES, ELV_SYSTEMS, type Catalogue, type Density, type ElvSystem, type RoomRule } from './defaults';
import { ELV_DEVICES, type ElvDeviceType } from './devices';
import { placedOnLevel } from './placed';

/** ELV estimate from Building information: room type × area → field devices per room → the equipment that powers
 * them (fire alarm panels, PoE switches, door controllers, amplifiers), sized by capacity → upstream AC load per
 * supply, the load an LV circuit feeds. Floor supplies (switches, door controllers, floor racks) are one per floor;
 * building supplies (fire alarm panels, NVRs, PA amplifiers, core rack) one per building. The defaults are typical
 * values to verify (defaults.ts); a project overrides them in `project.elv`. An estimate, not a layout. */

const density = z.object({ m2: z.number().min(0).max(100000), min: z.number().int().min(0).max(1000) }).strict();
const ruleOverride = z.object({
  detector: z.enum(['smoke', 'heat', 'none']), detectorM2: density, sounder: density, camera: density, door: density,
  dataPort: density, accessPoint: density, speaker: density, speakerKind: z.enum(['ceiling', 'horn'])
}).partial().strict();
const pos = z.number().positive().max(1e6);
const frac = z.number().gt(0).max(1);
const catalogueOverride = z.object({
  fireAlarm: z.object({
    detectorQuiescentMa: z.number().min(0).max(1000), detectorAlarmMa: z.number().min(0).max(1000), sounderQuiescentMa: z.number().min(0).max(1000), sounderAlarmMa: z.number().min(0).max(1000),
    callPointQuiescentMa: z.number().min(0).max(1000), callPointAlarmMa: z.number().min(0).max(1000), moduleQuiescentMa: z.number().min(0).max(1000), moduleAlarmMa: z.number().min(0).max(1000), beaconAlarmMa: z.number().min(0).max(1000),
    devicesPerLoop: z.number().int().min(1).max(1000), loopsPerPanel: z.number().int().min(1).max(64), panelQuiescentMa: z.number().min(0).max(1e5), panelAlarmMa: z.number().min(0).max(1e5),
    standbyH: z.number().min(0).max(168), alarmH: z.number().min(0).max(24), batteryFactor: z.number().min(1).max(3), rechargeH: z.number().min(1).max(168), chargerV: pos, efficiency: frac, pf: frac
  }).partial().strict(),
  cctv: z.object({ cameraW: pos, switchPorts: z.number().int().min(1).max(512), switchBudgetW: pos, switchSelfW: z.number().min(0).max(1e4), nvrChannels: z.number().int().min(1).max(4096), nvrW: z.number().min(0).max(1e4), upsEfficiency: frac, spare: z.number().min(1).max(3), pf: frac }).partial().strict(),
  access: z.object({ readerW: z.number().min(0).max(1e3), lockW: z.number().min(0).max(1e3), doorsPerController: z.number().int().min(1).max(256), controllerW: z.number().min(0).max(1e3), psuEfficiency: frac, chargeAllowance: z.number().min(1).max(3), spare: z.number().min(1).max(3), pf: frac }).partial().strict(),
  ict: z.object({ accessPointW: z.number().min(0).max(1e3), switchPorts: z.number().int().min(1).max(512), switchBudgetW: z.number().min(0).max(1e5), switchSelfW: z.number().min(0).max(1e4), floorRackW: z.number().min(0).max(1e5), coreRackW: z.number().min(0).max(1e6), upsEfficiency: frac, spare: z.number().min(1).max(3), pf: frac }).partial().strict(),
  pa: z.object({ ceilingTapW: z.number().min(0).max(1e3), hornTapW: z.number().min(0).max(1e3), headroom: z.number().min(1).max(3), amplifierW: pos, amplifierIdleW: z.number().min(0).max(1e4), efficiency: frac, rackW: z.number().min(0).max(1e5), pf: frac }).partial().strict()
}).partial().strict();

/** What a project (or a rules file) changes from the defaults. */
export const elvSettings = z.object({
  systems: z.array(z.enum(ELV_SYSTEMS)).optional().describe('Systems to estimate (default all)'),
  rules: z.record(z.string().min(1).max(60), ruleOverride).optional().describe('Per room type ID (or "default"): rule fields to change'),
  catalogue: catalogueOverride.optional()
}).strict();
export type ElvSettings = z.infer<typeof elvSettings>;

export type DeviceCounts = Partial<Record<'smokeDetector' | 'heatDetector' | 'multiDetector' | 'callPoint' | 'sounder' | 'sounderBeacon' | 'interfaceModule' | 'camera' | 'door' | 'cardReader' | 'maglock' | 'exitButton' | 'dataPort' | 'accessPoint' | 'ceilingSpeaker' | 'hornSpeaker', number>>;

/** The count each placed device type adds to. */
const COUNT_OF: Record<ElvDeviceType, keyof DeviceCounts> = {
  'smoke-detector': 'smokeDetector', 'heat-detector': 'heatDetector', 'multi-detector': 'multiDetector', 'call-point': 'callPoint', sounder: 'sounder',
  'sounder-beacon': 'sounderBeacon', 'interface-module': 'interfaceModule', camera: 'camera', 'card-reader': 'cardReader', maglock: 'maglock',
  'exit-button': 'exitButton', 'data-outlet': 'dataPort', 'access-point': 'accessPoint', 'ceiling-speaker': 'ceilingSpeaker', 'horn-speaker': 'hornSpeaker'
};
/** Fire alarm loop devices behind each count (the area rules give smoke and heat detectors and sounders). */
const LOOP_DEVICES: [keyof DeviceCounts, ElvDeviceType][] = [
  ['smokeDetector', 'smoke-detector'], ['heatDetector', 'heat-detector'], ['multiDetector', 'multi-detector'], ['callPoint', 'call-point'],
  ['sounder', 'sounder'], ['sounderBeacon', 'sounder-beacon'], ['interfaceModule', 'interface-module']
];

export interface ElvRoomRow {
  roomId: string; building: string; level: string; name: string; type: string; areaM2: number;
  count: number; // identical rooms × identical floors
  devices: DeviceCounts; // in one room
  placed?: ElvSystem[]; // systems counted from devices placed on the plan instead of the area rules
}

export type EquipmentType = 'panel' | 'psu' | 'poe-switch' | 'ups' | 'rack' | 'amplifier' | 'other';

export interface ElvSupply {
  id: string;
  system: ElvSystem;
  equipment: string;
  equipmentType: EquipmentType;
  buildingId: string;
  levelId?: string; // floor supplies
  floor?: number; // which floor of a typical level (1…n)
  rooms: string[];
  devices: DeviceCounts;
  units: number; // panels, switches, controllers, amplifiers
  kW: number; // upstream AC input
  pf: number;
  supply: 'normal' | 'essential';
  demandBasis: string;
  backup?: string;
}

export interface ElvEstimate {
  systems: ElvSystem[];
  rooms: ElvRoomRow[];
  supplies: ElvSupply[];
  totals: Partial<Record<ElvSystem, { kW: number; supplies: number }>>;
  assumptions: string[];
  warnings: string[];
}

/** The defaults with a project's (or a rules file's) changes. */
export function elvBasis(settings?: ElvSettings): { systems: ElvSystem[]; rules: Record<string, RoomRule>; catalogue: Catalogue } {
  const rules: Record<string, RoomRule> = { ...DEFAULT_RULES };
  for (const [type, r] of Object.entries(settings?.rules ?? {})) rules[type] = { ...(rules[type] ?? DEFAULT_RULES.default), ...r };
  const c = settings?.catalogue ?? {};
  const catalogue: Catalogue = {
    fireAlarm: { ...DEFAULT_CATALOGUE.fireAlarm, ...c.fireAlarm }, cctv: { ...DEFAULT_CATALOGUE.cctv, ...c.cctv },
    access: { ...DEFAULT_CATALOGUE.access, ...c.access }, ict: { ...DEFAULT_CATALOGUE.ict, ...c.ict }, pa: { ...DEFAULT_CATALOGUE.pa, ...c.pa }
  };
  return { systems: settings?.systems?.length ? [...new Set(settings.systems)] : [...ELV_SYSTEMS], rules, catalogue };
}

const many = (x: Density, areaM2: number) => Math.max(x.min, x.m2 > 0 ? Math.ceil(areaM2 / x.m2 - 1e-9) : 0);
const kw = (w: number) => Math.round(w) / 1000;
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : /(s|sh|ch|x|z)$/.test(s) ? 'es' : 's'}`;

function roomDevices(r: BuildingRoom, rule: RoomRule): DeviceCounts {
  const a = r.areaM2 > 0 ? r.areaM2 : 0;
  const det = rule.detector === 'none' ? 0 : many(rule.detectorM2, a);
  const spk = many(rule.speaker, a);
  const out: DeviceCounts = {
    ...(det ? { [rule.detector === 'heat' ? 'heatDetector' : 'smokeDetector']: det } : {}),
    sounder: many(rule.sounder, a), camera: many(rule.camera, a), door: many(rule.door, a), dataPort: many(rule.dataPort, a), accessPoint: many(rule.accessPoint, a),
    ...(spk ? { [rule.speakerKind === 'horn' ? 'hornSpeaker' : 'ceilingSpeaker']: spk } : {})
  };
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n! > 0)) as DeviceCounts;
}

function add(into: DeviceCounts, d: DeviceCounts, times: number) {
  for (const [k, n] of Object.entries(d) as [keyof DeviceCounts, number][]) into[k] = (into[k] ?? 0) + n * times;
}

const SYSTEM_DEVICES: Record<ElvSystem, (keyof DeviceCounts)[]> = {
  'fire-alarm': LOOP_DEVICES.map(([k]) => k), cctv: ['camera'], 'access-control': ['door', 'cardReader', 'maglock', 'exitButton'],
  ict: ['dataPort', 'accessPoint'], 'public-address': ['ceilingSpeaker', 'hornSpeaker']
};
const only = (d: DeviceCounts, s: ElvSystem): DeviceCounts => Object.fromEntries(SYSTEM_DEVICES[s].filter((k) => d[k]).map((k) => [k, d[k]]));

function countsOf(placed: Partial<Record<ElvDeviceType, number>> | undefined): DeviceCounts {
  const out: DeviceCounts = {};
  for (const [t, n] of Object.entries(placed ?? {}) as [ElvDeviceType, number][]) out[COUNT_OF[t]] = (out[COUNT_OF[t]] ?? 0) + n;
  return out;
}

/** A room's area-rule devices, with the designed systems' counts replaced by the devices placed in it. */
function withPlaced(area: DeviceCounts, placed: DeviceCounts, systems: Set<ElvSystem>): DeviceCounts {
  if (!systems.size) return area;
  const out: DeviceCounts = {};
  for (const s of ELV_SYSTEMS) Object.assign(out, only(systems.has(s) ? placed : area, s));
  return out;
}

export function estimateElv(project: Project, settings: ElvSettings | undefined = project.elv): ElvEstimate {
  const { systems, rules, catalogue: c } = elvBasis(settings);
  const on = new Set(systems);
  const info = buildingInfoOf(project);
  const rows: ElvRoomRow[] = [];
  const supplies: ElvSupply[] = [];
  const warnings: string[] = [];
  const unknownTypes = new Set<string>();
  for (const b of info.buildings) {
    const building: DeviceCounts = {};
    const buildingRooms: string[] = [];
    const roomsIn = (l: BuildingLevel) => info.rooms.filter((r) => r.buildingId === b.id && r.levelId === l.id);
    for (const l of b.levels) {
      const floors = Math.max(1, Math.round(l.count ?? 1));
      const level: DeviceCounts = {};
      const ids: string[] = [];
      const placed = placedOnLevel(project, b.id, l.id);
      const designed = [...placed.systems].filter((s) => on.has(s));
      for (const r of roomsIn(l)) {
        if (!rules[r.type]) unknownTypes.add(r.type);
        const devices = withPlaced(roomDevices(r, rules[r.type] ?? rules.default), countsOf(placed.byRoom.get(r.id)), placed.systems);
        const each = Math.max(1, Math.round(r.count ?? 1));
        rows.push({ roomId: r.id, building: b.name, level: l.name, name: r.name, type: r.type, areaM2: r.areaM2, count: each * floors, devices, ...(designed.length ? { placed: designed } : {}) });
        add(level, devices, each);
        ids.push(r.id);
      }
      if (placed.looseCount) {
        add(level, countsOf(placed.loose), 1);
        warnings.push(`${b.name}, ${l.name}: ${plural(placed.looseCount, 'placed ELV device')} outside every room outline, counted on the level.`);
      }
      if (!ids.length && !placed.looseCount) continue;
      add(building, level, floors);
      buildingRooms.push(...ids);
      for (let f = 1; f <= floors; f++) supplies.push(...floorSupplies(b, l, floors > 1 ? f : undefined, level, ids, on, c));
    }
    if (buildingRooms.length) supplies.push(...buildingSupplies(b, building, buildingRooms, on, c, warnings));
  }
  if (!rows.length) warnings.push('No rooms in Building information: add buildings, levels and rooms (or import them) first.');
  if (unknownTypes.size) warnings.push(`No ELV rule for room type ${[...unknownTypes].sort().join(', ')}: the default rule is used.`);
  const totals: ElvEstimate['totals'] = {};
  for (const s of systems) {
    const list = supplies.filter((x) => x.system === s);
    totals[s] = { kW: Math.round(list.reduce((t, x) => t + x.kW, 0) * 1000) / 1000, supplies: list.length };
  }
  return { systems, rooms: rows, supplies, totals, assumptions: systems.flatMap((s) => DEFAULT_ASSUMPTIONS[s]), warnings };
}

function floorSupplies(b: ProjectBuilding, l: BuildingLevel, floor: number | undefined, d: DeviceCounts, rooms: string[], on: Set<ElvSystem>, c: Catalogue): ElvSupply[] {
  const out: ElvSupply[] = [];
  const at = `${l.name}${floor ? ` (floor ${floor})` : ''}`;
  const id = (sys: string) => `${sys}-${b.id}-${l.id}${floor ? `-F${floor}` : ''}`;
  const base = { buildingId: b.id, levelId: l.id, ...(floor ? { floor } : {}), rooms };
  const cams = d.camera ?? 0;
  if (on.has('cctv') && cams) {
    const k = c.cctv;
    const units = Math.max(Math.ceil(cams / k.switchPorts), Math.ceil((cams * k.cameraW) / k.switchBudgetW));
    out.push({
      ...base, id: id('CCTV'), system: 'cctv', equipment: `CCTV PoE switches, ${at} (${plural(units, 'switch')}, ${plural(cams, 'camera')})`, equipmentType: 'poe-switch',
      devices: only(d, 'cctv'), units, kW: kw(((cams * k.cameraW + units * k.switchSelfW) * k.spare) / k.upsEfficiency), pf: k.pf, supply: 'normal',
      demandBasis: `${cams} × ${k.cameraW} W PoE + ${units} × ${k.switchSelfW} W switch, × ${k.spare} spare, ÷ ${k.upsEfficiency} UPS`, backup: 'UPS'
    });
  }
  // Area rules give doors (a reader and a lock each); placed devices give readers and locks, a door per lock (or reader).
  const ruleDoors = d.door ?? 0, readers = d.cardReader ?? 0, locks = d.maglock ?? 0;
  const doors = ruleDoors + Math.max(readers, locks);
  if (on.has('access-control') && doors) {
    const k = c.access;
    const units = Math.ceil(doors / k.doorsPerController);
    const devicesW = readers + locks ? (ruleDoors + readers) * k.readerW + (ruleDoors + locks) * k.lockW : doors * (k.readerW + k.lockW);
    const basis = readers + locks
      ? `${ruleDoors + readers} × ${k.readerW} W reader + ${ruleDoors + locks} × ${k.lockW} W lock`
      : `${doors} × (${k.readerW} W reader + ${k.lockW} W lock)`;
    out.push({
      ...base, id: id('ACS'), system: 'access-control', equipment: `Access control door controllers and PSUs, ${at} (${plural(units, 'controller')}, ${plural(doors, 'door')})`, equipmentType: 'psu',
      devices: only(d, 'access-control'), units, kW: kw(((devicesW + units * k.controllerW) / k.psuEfficiency) * k.chargeAllowance * k.spare), pf: k.pf, supply: 'essential',
      demandBasis: `${basis} + ${units} × ${k.controllerW} W, ÷ ${k.psuEfficiency} PSU, × ${k.chargeAllowance} charging, × ${k.spare} spare`, backup: 'PSU batteries (fail-safe locks release on mains failure)'
    });
  }
  const ports = d.dataPort ?? 0, aps = d.accessPoint ?? 0;
  if (on.has('ict') && ports + aps) {
    const k = c.ict;
    const units = Math.max(Math.ceil((ports + aps) / k.switchPorts), k.switchBudgetW > 0 ? Math.ceil((aps * k.accessPointW) / k.switchBudgetW) : 0);
    out.push({
      ...base, id: id('ICT'), system: 'ict', equipment: `Floor rack and access switches, ${at} (${plural(units, 'switch')}, ${plural(ports, 'data port')}, ${plural(aps, 'access point')})`, equipmentType: 'rack',
      devices: only(d, 'ict'), units, kW: kw(((aps * k.accessPointW + units * k.switchSelfW + k.floorRackW) * k.spare) / k.upsEfficiency), pf: k.pf, supply: 'normal',
      demandBasis: `${aps} × ${k.accessPointW} W PoE + ${units} × ${k.switchSelfW} W switch + ${k.floorRackW} W rack, × ${k.spare} spare, ÷ ${k.upsEfficiency} UPS`, backup: 'UPS'
    });
  }
  return out;
}

function buildingSupplies(b: ProjectBuilding, d: DeviceCounts, rooms: string[], on: Set<ElvSystem>, c: Catalogue, warnings: string[]): ElvSupply[] {
  const out: ElvSupply[] = [];
  const base = { buildingId: b.id, rooms };
  const loop = LOOP_DEVICES.map(([key, type]) => ({ n: d[key] ?? 0, load: ELV_DEVICES[type].load(c) })).filter((x) => x.n);
  const onLoops = loop.reduce((t, x) => t + x.n, 0);
  if (on.has('fire-alarm') && onLoops) {
    const k = c.fireAlarm;
    const loops = Math.ceil(onLoops / k.devicesPerLoop), units = Math.ceil(loops / k.loopsPerPanel);
    const quiescentA = (units * k.panelQuiescentMa + loop.reduce((t, x) => t + x.n * (x.load.quiescentMa ?? 0), 0)) / 1000;
    const alarmA = (units * k.panelAlarmMa + loop.reduce((t, x) => t + x.n * (x.load.alarmMa ?? 0), 0)) / 1000;
    const ah = k.batteryFactor * (quiescentA * k.standbyH + alarmA * k.alarmH);
    const chargeA = (0.8 * ah) / k.rechargeH;
    if (units > 1) warnings.push(`${b.name}: ${loops} fire alarm loops need ${units} networked panels; the load is shown as one supply.`);
    out.push({
      ...base, id: `FA-${b.id}`, system: 'fire-alarm', equipment: `Fire alarm control panel${units > 1 ? 's' : ''}, ${b.name} (${plural(units, 'panel')}, ${plural(loops, 'loop')}, ${onLoops} devices)`, equipmentType: 'panel',
      devices: only(d, 'fire-alarm'), units, kW: kw((alarmA * 24 + chargeA * k.chargerV) / k.efficiency), pf: k.pf, supply: 'essential',
      demandBasis: `alarm ${alarmA.toFixed(2)} A at 24 V + charging ${chargeA.toFixed(2)} A at ${k.chargerV} V, ÷ ${k.efficiency}`,
      backup: `${Math.ceil(ah)} Ah batteries: ${k.standbyH} h standby + ${k.alarmH * 60} min alarm`
    });
  }
  const cams = d.camera ?? 0;
  if (on.has('cctv') && cams) {
    const k = c.cctv;
    const units = Math.ceil(cams / k.nvrChannels);
    out.push({
      ...base, id: `CCTV-NVR-${b.id}`, system: 'cctv', equipment: `CCTV recorders, ${b.name} (${plural(units, 'NVR')}, ${plural(cams, 'camera')})`, equipmentType: 'other',
      devices: only(d, 'cctv'), units, kW: kw((units * k.nvrW * k.spare) / k.upsEfficiency), pf: k.pf, supply: 'normal',
      demandBasis: `${units} × ${k.nvrW} W NVR, × ${k.spare} spare, ÷ ${k.upsEfficiency} UPS`, backup: 'UPS'
    });
  }
  if (on.has('ict') && (d.dataPort ?? 0) + (d.accessPoint ?? 0)) {
    const k = c.ict;
    out.push({
      ...base, id: `ICT-CORE-${b.id}`, system: 'ict', equipment: `Main ICT rack, ${b.name}`, equipmentType: 'rack', devices: {}, units: 1,
      kW: kw((k.coreRackW * k.spare) / k.upsEfficiency), pf: k.pf, supply: 'normal', demandBasis: `${k.coreRackW} W core rack, × ${k.spare} spare, ÷ ${k.upsEfficiency} UPS (no servers)`, backup: 'UPS'
    });
  }
  const ceiling = d.ceilingSpeaker ?? 0, horn = d.hornSpeaker ?? 0;
  if (on.has('public-address') && ceiling + horn) {
    const k = c.pa;
    const taps = ceiling * k.ceilingTapW + horn * k.hornTapW;
    const units = Math.ceil((taps * k.headroom) / k.amplifierW);
    out.push({
      ...base, id: `PA-${b.id}`, system: 'public-address', equipment: `Public address amplifiers, ${b.name} (${units} × ${k.amplifierW} W, ${ceiling + horn} speakers)`, equipmentType: 'amplifier',
      devices: only(d, 'public-address'), units, kW: kw(taps / k.efficiency + units * k.amplifierIdleW + k.rackW), pf: k.pf, supply: 'essential',
      demandBasis: `${taps} W of taps at full output (evacuation) ÷ ${k.efficiency} + ${units} × ${k.amplifierIdleW} W idle + ${k.rackW} W rack`, backup: 'Voice alarm batteries or essential supply'
    });
  }
  return out;
}
