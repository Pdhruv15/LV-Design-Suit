import { buildingInfoOf, floorsOf } from '../calc/building';
import type { Project } from '../types';
import { ELV_SYSTEMS, type ElvSystem } from './defaults';
import { ELV_DEVICES, type ElvDeviceType } from './devices';
import { elvBasis, estimateElv, type DeviceCounts, type ElvEstimate, type ElvSettings } from './estimate';
import { elvSchedules, type DeviceRef } from './schedules';

/** The ELV schedules as plain tables, for the ELV page, Excel and the PDF: devices per room and floor, fire alarm
 * loops and zones, switch ports / door controllers / PA zones, and the ELV BOQ. Devices come from the plans where
 * they are placed and from the room-area estimate elsewhere (estimate.ts); loops and ports come from the placed
 * devices (schedules.ts). Every row has a stable key, so a remark the engineer types stays with its row. */

export type TableId = 'devices' | 'loops' | 'zones' | 'ports' | 'boq';
export interface Column { label: string; title?: string; num?: boolean }
export interface Row { key: string; cells: (string | number)[]; kind?: 'group' | 'sum' }
export interface ScheduleTable { id: TableId; title: string; columns: Column[]; rows: Row[]; notes: string[] }

/** Remarks typed by the engineer: `${table}:${row key}` → text. */
export const remarkKey = (table: TableId, row: string) => `${table}:${row}`;
export const remarkOf = (p: Project, table: TableId, row: string) => p.elvRemarks?.[remarkKey(table, row)] ?? '';
export function withRemark(p: Project, table: TableId, row: string, text: string): Project {
  const { [remarkKey(table, row)]: _old, ...rest } = p.elvRemarks ?? {};
  const next = text.trim() ? { ...rest, [remarkKey(table, row)]: text.trim().slice(0, 500) } : rest;
  return { ...p, elvRemarks: Object.keys(next).length ? next : undefined };
}

/** Device columns of the device schedule, in this order; area-rule doors count as a reader and a lock each. */
const DEVICE_COLUMNS: { code: string; title: string; of: (d: DeviceCounts) => number }[] = [
  { code: 'SD', title: 'Smoke detector', of: (d) => d.smokeDetector ?? 0 },
  { code: 'HD', title: 'Heat detector', of: (d) => d.heatDetector ?? 0 },
  { code: 'MS', title: 'Multi-sensor detector', of: (d) => d.multiDetector ?? 0 },
  { code: 'CP', title: 'Manual call point', of: (d) => d.callPoint ?? 0 },
  { code: 'SND', title: 'Sounder', of: (d) => d.sounder ?? 0 },
  { code: 'SB', title: 'Sounder beacon', of: (d) => d.sounderBeacon ?? 0 },
  { code: 'IM', title: 'Interface module', of: (d) => d.interfaceModule ?? 0 },
  { code: 'CAM', title: 'CCTV camera', of: (d) => d.camera ?? 0 },
  { code: 'CR', title: 'Card reader', of: (d) => (d.cardReader ?? 0) + (d.door ?? 0) },
  { code: 'ML', title: 'Magnetic lock', of: (d) => (d.maglock ?? 0) + (d.door ?? 0) },
  { code: 'EX', title: 'Exit button', of: (d) => d.exitButton ?? 0 },
  { code: 'DO', title: 'Data outlet', of: (d) => d.dataPort ?? 0 },
  { code: 'AP', title: 'Wi-Fi access point', of: (d) => d.accessPoint ?? 0 },
  { code: 'SP', title: 'Ceiling speaker', of: (d) => d.ceilingSpeaker ?? 0 },
  { code: 'HS', title: 'Horn speaker', of: (d) => d.hornSpeaker ?? 0 }
];

/** "L05–L09" for consecutive floors, "L05, L07, L08" otherwise (by the number in the tag). */
export function floorRef(tags: string[]): string {
  if (tags.length <= 1) return tags[0] ?? '';
  const nums = tags.map((t) => Number(/(\d+)$/.exec(t)?.[1]));
  const consecutive = nums.every((n, i) => Number.isFinite(n) && (i === 0 || n === nums[i - 1] + 1)) && tags.every((t) => t.replace(/\d+$/, '') === tags[0].replace(/\d+$/, ''));
  return consecutive ? `${tags[0]}–${tags[tags.length - 1]}` : tags.join(', ');
}

/** Floor tags per building and level ("L05"…), in order. */
function floorTags(p: Project): Map<string, string[]> {
  const info = buildingInfoOf(p);
  const out = new Map<string, string[]>();
  for (const b of info.buildings) for (const f of floorsOf(info, b)) {
    const k = `${b.id}\0${f.level.id}`;
    out.set(k, [...(out.get(k) ?? []), f.tag]);
  }
  return out;
}

export function elvTables(p: Project, settings: ElvSettings | undefined = p.elv, estimate: ElvEstimate = estimateElv(p, settings)): ScheduleTable[] {
  return [deviceTable(p, estimate), ...fireAlarmTables(p, settings, estimate), portsTable(p, settings), boqTable(p, settings, estimate)];
}

function deviceTable(p: Project, e: ElvEstimate): ScheduleTable {
  const info = buildingInfoOf(p);
  const tags = floorTags(p);
  const used = DEVICE_COLUMNS.filter((c) => e.rooms.some((r) => c.of(r.devices) > 0));
  const rows: Row[] = [];
  const total = used.map(() => 0);
  let totalM2 = 0;
  for (const b of info.buildings) {
    for (const l of b.levels) {
      const rs = e.rooms.filter((r) => info.rooms.some((x) => x.id === r.roomId && x.buildingId === b.id && x.levelId === l.id));
      if (!rs.length) continue;
      const floors = Math.max(1, Math.round(l.count ?? 1));
      const ref = floorRef(tags.get(`${b.id}\0${l.id}`) ?? []);
      const where = `${info.buildings.length > 1 ? `${b.name} · ` : ''}${l.name}${floors > 1 ? ` (${ref})` : ''}`;
      rows.push({ key: `${b.id}/${l.id}`, cells: [where, ...Array(used.length + 2).fill('')], kind: 'group' });
      const per = used.map(() => 0);
      let m2 = 0;
      for (const r of rs) {
        const each = Math.max(1, Math.round(r.count / floors));
        const v = used.map((c) => c.of(r.devices) * each);
        v.forEach((n, i) => { per[i] += n; });
        m2 += r.areaM2 * each;
        rows.push({ key: r.roomId, cells: [r.name + (each > 1 ? ` × ${each}` : ''), r.placed?.length ? 'plan' : 'estimate', Math.round(r.areaM2 * each), ...v.map((n) => n || '')] });
      }
      rows.push({ key: `${b.id}/${l.id}/sum`, cells: [floors > 1 ? `Per floor (× ${floors}: ${ref})` : 'Level total', '', Math.round(m2), ...per.map((n) => n || '')], kind: 'sum' });
      per.forEach((n, i) => { total[i] += n * floors; });
      totalM2 += m2 * floors;
    }
  }
  if (rows.length) rows.push({ key: 'total', cells: ['Building total', '', Math.round(totalM2), ...total.map((n) => n || '')], kind: 'sum' });
  return {
    id: 'devices', title: 'ELV device schedule',
    columns: [{ label: 'Room' }, { label: 'From', title: 'plan = devices placed on the floor plan; estimate = room type × area' }, { label: 'm²', num: true }, ...used.map((c) => ({ label: c.code, title: c.title, num: true }))],
    rows,
    notes: [used.map((c) => `${c.code} ${c.title}`).join(' · '), 'Quantities per floor; a typical level stands for every floor it names. Rooms marked "estimate" have no devices placed for that system yet.']
  };
}

/** Floor tag of a placed device's floor. */
const tagOf = (tags: Map<string, string[]>, buildingId: string, d: DeviceRef) => (tags.get(`${buildingId}\0${d.levelId}`) ?? [])[(d.floor ?? 1) - 1] ?? d.levelId;

function fireAlarmTables(p: Project, settings: ElvSettings | undefined, e: ElvEstimate): ScheduleTable[] {
  const s = elvSchedules(p, settings);
  const tags = floorTags(p);
  const info = buildingInfoOf(p);
  const multi = info.buildings.length > 1;
  const codes: [string, ElvDeviceType[]][] = [['SD', ['smoke-detector']], ['HD', ['heat-detector']], ['MS', ['multi-detector']], ['CP', ['call-point']], ['SND', ['sounder']], ['SB', ['sounder-beacon']], ['IM', ['interface-module']]];
  const loops: Row[] = [], zones: Row[] = [];
  for (const b of s.buildings) {
    const name = info.buildings.find((x) => x.id === b.buildingId)?.name ?? b.buildingId;
    if (multi && b.loops.length) loops.push({ key: b.buildingId, cells: [name, ...Array(codes.length + 7).fill('')], kind: 'group' });
    for (const l of b.loops) {
      const fl = [...new Set(l.devices.map((d) => tagOf(tags, b.buildingId, d)))];
      const zs = [...new Set(l.devices.map((d) => d.zone))];
      loops.push({
        key: `${b.buildingId}/${l.id}`,
        cells: [l.id, floorRef(fl), zs.length > 2 ? `${zs[0]}–${zs[zs.length - 1]}` : zs.join(', '), `1–${l.devices.length}`,
          ...codes.map(([, t]) => l.devices.filter((d) => t.includes(d.type)).length || ''), l.devices.length, l.quiescentMa.toFixed(1), l.alarmMa.toFixed(1), l.isolators]
      });
    }
    for (const z of b.zones) {
      const tag = (tags.get(`${b.buildingId}\0${z.levelId}`) ?? [])[(z.floor ?? 1) - 1] ?? z.levelId;
      const lv = info.buildings.find((x) => x.id === b.buildingId)?.levels.find((x) => x.id === z.levelId);
      zones.push({ key: `${b.buildingId}/${z.id}`, cells: [z.id, `${multi ? `${name} · ` : ''}${lv?.name ?? z.levelId}${z.floor ? ` (${tag})` : ''}`, z.areaM2, z.rooms.map((id) => info.rooms.find((r) => r.id === id)?.name ?? id).join(', ')] });
    }
  }
  const panels = e.supplies.filter((x) => x.system === 'fire-alarm');
  const { catalogue: c } = elvBasis(settings);
  const notes = [
    `Loop limits: ${c.fireAlarm.devicesPerLoop} devices and ${c.fireAlarm.loopMaxMa} mA, each used to ${Math.round((1 - c.fireAlarm.loopSpare) * 100)} %. Alarm current: all devices quiescent + all sounders, beacons and modules + ${c.fireAlarm.inputsInAlarm} detectors or call points in alarm. Isolators: no more than ${c.fireAlarm.isolatorMaxDevices} devices between two (EN 54-2).`,
    ...panels.map((x) => `${x.equipment}: ${x.backup ?? ''} (BS 5839-1 Annex E).`),
    ...(loops.length ? [] : ['No fire alarm devices placed on the plans yet: loops and addresses follow once they are.'])
  ];
  return [
    {
      id: 'loops', title: 'Fire alarm loop schedule',
      columns: [{ label: 'Loop' }, { label: 'Floors' }, { label: 'Zones' }, { label: 'Addresses' }, ...codes.map(([k]) => ({ label: k, num: true })), { label: 'Devices', num: true }, { label: 'Iq mA', title: 'Quiescent current', num: true }, { label: 'Ia mA', title: 'Current in alarm', num: true }, { label: 'Isolators', num: true }],
      rows: loops, notes
    },
    {
      id: 'zones', title: 'Fire detection zones',
      columns: [{ label: 'Zone' }, { label: 'Level / floor' }, { label: 'm²', num: true }, { label: 'Rooms' }],
      rows: zones, notes: [`Zones: one floor each, at most ${c.fireAlarm.zoneMaxM2.toLocaleString('en')} m² (BS 5839-1).`]
    }
  ];
}

function portsTable(p: Project, settings: ElvSettings | undefined): ScheduleTable {
  const s = elvSchedules(p, settings);
  const tags = floorTags(p);
  const { catalogue: c } = elvBasis(settings);
  const rows: Row[] = [];
  const floor = (buildingId: string, levelId: string, f?: number) => (tags.get(`${buildingId}\0${levelId}`) ?? [])[(f ?? 1) - 1] ?? levelId;
  for (const b of s.buildings) {
    const add = (title: string, list: Row[]) => { if (list.length) rows.push({ key: `${b.buildingId}/${title}`, cells: [title, '', '', ''], kind: 'group' }, ...list); };
    for (const sys of ['cctv', 'ict'] as const) {
      const k = sys === 'cctv' ? c.cctv : c.ict;
      add(sys === 'cctv' ? 'CCTV switches' : 'Data and Wi-Fi switches', b.switches.filter((x) => x.system === sys).map((x) => ({
        key: `${b.buildingId}/${x.id}`, cells: [x.id, floor(b.buildingId, x.levelId, x.floor), `${x.ports} of ${k.switchPorts} ports`, `${x.poeW.toFixed(1)} of ${k.switchBudgetW} W PoE`]
      })));
    }
    add('Door controllers', b.controllers.map((x) => ({ key: `${b.buildingId}/${x.id}`, cells: [x.id, floor(b.buildingId, x.levelId, x.floor), `${x.doors} of ${c.access.doorsPerController} doors`, ''] })));
    add('PA zones', b.paZones.map((z) => ({ key: `${b.buildingId}/${z.id}`, cells: [z.id, floor(b.buildingId, z.levelId, z.floor), `${z.speakers} speakers`, `${z.watts.toFixed(0)} W → ${z.amplifier}`] })));
    add('PA amplifiers', b.amplifiers.map((a) => ({ key: `${b.buildingId}/${a.id}`, cells: [a.id, '', `${a.loadW.toFixed(0)} of ${a.ratedW} W`, a.zones.join(', ')] })));
  }
  return {
    id: 'ports', title: 'ELV network, doors and PA zones',
    columns: [{ label: 'Group' }, { label: 'Floor' }, { label: 'Use' }, { label: 'Detail' }],
    rows, notes: rows.length ? [`PA amplifiers loaded to ${c.pa.amplifierW} W ÷ ${c.pa.headroom} headroom.`] : ['No CCTV, data, access control or PA devices placed on the plans yet.']
  };
}

const STD_AH = [7, 12, 17, 24, 38, 65, 100];
export interface BoqLine { key: string; system: ElvSystem; description: string; unit: 'no.'; qty: number }

/** The ELV BOQ: device totals (placed or estimated) and the equipment that serves them, per system. Equipment, not
 * cables or containment. */
export function elvBoq(p: Project, settings: ElvSettings | undefined = p.elv, e: ElvEstimate = estimateElv(p, settings)): BoqLine[] {
  const tot: DeviceCounts = {};
  for (const r of e.rooms) for (const [k, n] of Object.entries(r.devices) as [keyof DeviceCounts, number][]) tot[k] = (tot[k] ?? 0) + n * r.count;
  const units = (pred: (id: string) => boolean) => e.supplies.filter((x) => pred(x.id)).reduce((t, x) => t + x.units, 0);
  const count = (pred: (id: string) => boolean) => e.supplies.filter((x) => pred(x.id)).length;
  const s = elvSchedules(p, settings);
  const placedLoops = s.buildings.flatMap((b) => b.loops);
  const loopDevices = (['smokeDetector', 'heatDetector', 'multiDetector', 'callPoint', 'sounder', 'sounderBeacon', 'interfaceModule'] as const).reduce((t, k) => t + (tot[k] ?? 0), 0);
  const fa = e.supplies.filter((x) => x.system === 'fire-alarm');
  const lines: BoqLine[] = [];
  const add = (system: ElvSystem, key: string, description: string, qty: number) => { if (qty > 0) lines.push({ key, system, description, unit: 'no.', qty }); };
  const label = (t: ElvDeviceType) => ELV_DEVICES[t].label;
  add('fire-alarm', 'smoke', `Addressable ${label('smoke-detector').toLowerCase()}`, tot.smokeDetector ?? 0);
  add('fire-alarm', 'heat', `Addressable ${label('heat-detector').toLowerCase()}`, tot.heatDetector ?? 0);
  add('fire-alarm', 'multi', `Addressable ${label('multi-detector').toLowerCase()}`, tot.multiDetector ?? 0);
  add('fire-alarm', 'call-point', label('call-point'), tot.callPoint ?? 0);
  add('fire-alarm', 'sounder', label('sounder'), tot.sounder ?? 0);
  add('fire-alarm', 'sounder-beacon', label('sounder-beacon'), tot.sounderBeacon ?? 0);
  add('fire-alarm', 'module', label('interface-module'), tot.interfaceModule ?? 0);
  const { catalogue: c } = elvBasis(settings);
  add('fire-alarm', 'isolator', 'Short-circuit isolator', placedLoops.length ? placedLoops.reduce((t, l) => t + l.isolators, 0) : Math.ceil(loopDevices / c.fireAlarm.isolatorMaxDevices));
  for (const x of fa) {
    const loops = Number(/(\d+) loops?/.exec(x.equipment)?.[1] ?? 0);
    add('fire-alarm', `panel-${x.id}`, `Fire alarm control panel, ${c.fireAlarm.loopsPerPanel} loops${loops ? ` (${loops} used)` : ''}${fa.length > 1 ? `, ${x.equipment.split(', ').slice(1).join(', ').replace(/ \(.*$/, '')}` : ''}`, x.units);
    const ah = Number(/^(\d+) Ah/.exec(x.backup ?? '')?.[1] ?? 0) / x.units;
    if (ah) add('fire-alarm', `battery-${x.id}`, `Standby battery 12 V ${STD_AH.find((s2) => s2 >= ah) ?? Math.ceil(ah)} Ah (pair per panel)`, 2 * x.units);
  }
  add('cctv', 'camera', `IP camera, PoE`, tot.camera ?? 0);
  add('cctv', 'switch', `PoE switch for cameras (${c.cctv.switchPorts} ports used)`, units((id) => id.startsWith('CCTV-') && !id.startsWith('CCTV-NVR-')));
  add('cctv', 'nvr', `Network video recorder, ${c.cctv.nvrChannels} channels`, units((id) => id.startsWith('CCTV-NVR-')));
  add('cctv', 'ups', 'UPS for CCTV', count((id) => id.startsWith('CCTV-NVR-')));
  add('access-control', 'reader', label('card-reader'), (tot.cardReader ?? 0) + (tot.door ?? 0));
  add('access-control', 'maglock', label('maglock'), (tot.maglock ?? 0) + (tot.door ?? 0));
  add('access-control', 'exit', label('exit-button'), tot.exitButton ?? 0);
  add('access-control', 'controller', `Door controller with PSU, ${c.access.doorsPerController} doors`, units((id) => id.startsWith('ACS-')));
  add('ict', 'outlet', label('data-outlet'), tot.dataPort ?? 0);
  add('ict', 'ap', `${label('access-point')}, PoE+`, tot.accessPoint ?? 0);
  add('ict', 'switch', `Access switch, PoE+ (${c.ict.switchPorts} ports used)`, units((id) => id.startsWith('ICT-') && !id.startsWith('ICT-CORE-')));
  add('ict', 'floor-rack', 'Floor rack', count((id) => id.startsWith('ICT-') && !id.startsWith('ICT-CORE-')));
  add('ict', 'core-rack', 'Core rack', count((id) => id.startsWith('ICT-CORE-')));
  add('public-address', 'ceiling', `${label('ceiling-speaker')}, ${c.pa.ceilingTapW} W`, tot.ceilingSpeaker ?? 0);
  add('public-address', 'horn', `${label('horn-speaker')}, ${c.pa.hornTapW} W`, tot.hornSpeaker ?? 0);
  add('public-address', 'amplifier', `Amplifier, ${c.pa.amplifierW} W`, units((id) => id.startsWith('PA-')));
  add('public-address', 'rack', 'PA rack', count((id) => id.startsWith('PA-')));
  return lines;
}

const SYSTEM_TITLE: Record<ElvSystem, string> = { 'fire-alarm': 'Fire alarm', cctv: 'CCTV', 'access-control': 'Access control', ict: 'Data and Wi-Fi', 'public-address': 'Public address' };

function boqTable(p: Project, settings: ElvSettings | undefined, e: ElvEstimate): ScheduleTable {
  const lines = elvBoq(p, settings, e);
  const rows: Row[] = [];
  ELV_SYSTEMS.forEach((sys, si) => {
    const list = lines.filter((l) => l.system === sys);
    if (!list.length) return;
    rows.push({ key: sys, cells: [`${si + 1}`, SYSTEM_TITLE[sys], '', ''], kind: 'group' });
    list.forEach((l, i) => rows.push({ key: `${sys}/${l.key}`, cells: [`${si + 1}.${i + 1}`, l.description, l.unit, l.qty] }));
  });
  return {
    id: 'boq', title: 'ELV bill of quantities',
    columns: [{ label: 'Item' }, { label: 'Description' }, { label: 'Unit' }, { label: 'Qty', num: true }],
    rows, notes: ['Equipment from the devices placed on the plans (the room-area estimate where none are placed); cables and containment are not included. Rates are left for pricing.']
  };
}
