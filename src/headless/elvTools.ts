import { z } from 'zod';
import { ELV_SYSTEMS } from '../elv/defaults';
import { elvSettings, estimateElv, type ElvSettings } from '../elv/estimate';
import { placeElvLoads } from '../calc/elvPlace';
import { ELV_DEVICES } from '../elv/devices';
import { devicesOn, newElvDevice, placeDevices, removeDevices } from '../elv/placed';
import { elvSchedules } from '../elv/schedules';
import { buildingInfoOf } from '../calc/building';
import { findLevel } from './cadTools';
import { AUTHOR, edit } from './editTools';
import type { Project } from '../types';
import { readFile } from './exchangeTools';
import { openProject } from './project';
import type { Tool, ToolContext } from './tools';

/** The ELV estimate from the command line, MCP and the local API (read-only). The loads package for LV is
 * export_elv_loads_package (exportTools.ts); LV takes it in with exchange_review / exchange_apply. */

const project = z.string().describe('Project file name in the projects folder, as given by list_projects');
export const elvInput = {
  systems: z.array(z.enum(ELV_SYSTEMS)).min(1).optional().describe('Systems to estimate (default: the project setting, else all five)'),
  rules: z.string().optional().describe('JSON file with changes to the default rules and device data (same shape as project.elv); replaces the project setting')
};

/** The settings to use: a rules file, else the project's own; then the systems asked for. */
export function elvSettingsFor(p: Project, args: Record<string, unknown>, ctx: ToolContext): ElvSettings {
  let settings: ElvSettings | undefined = p.elv;
  if (typeof args.rules === 'string' && args.rules.trim()) {
    const { raw, name } = readFile(args.rules, ctx);
    const parsed = elvSettings.safeParse(raw);
    if (!parsed.success) throw new Error(`${name} is not a valid ELV rules file: ${parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'file'}: ${i.message}`).join('; ')}`);
    settings = parsed.data;
  } else if (settings) {
    const parsed = elvSettings.safeParse(settings);
    if (!parsed.success) throw new Error(`The project's ELV settings are not valid: ${parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return { ...settings, ...(Array.isArray(args.systems) ? { systems: args.systems as ElvSettings['systems'] } : {}) };
}

const atLevel = {
  building: z.string().describe('Building id or name'),
  level: z.string().describe('Level id or name')
};

export const ELV_TOOLS: Tool[] = [
  {
    name: 'elv_devices',
    title: 'ELV devices placed on a level',
    description: 'The ELV devices placed on a level\'s floor plan (metres on the plan, the room each is in), and the count per type. Once any device of a system is placed on a level, the ELV estimate counts placed devices there instead of the room-area rules.',
    input: { project, ...atLevel },
    usesProject: true,
    run: (a, ctx) => {
      const { project: p } = openProject({ ref: String(a.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
      return listDevices(p, String(a.building), String(a.level));
    }
  },
  {
    name: 'elv_schedules',
    title: 'ELV loops, ports, controllers and PA zones',
    description: 'The placed ELV devices grouped as they are wired, by the project\'s ELV rules: fire alarm detection zones (one floor, at most 2,000 m²), loops with addresses in route order (devices and alarm current within the loop limit less spare) and isolators (≤ 32 devices between two); CCTV and ICT switch ports and PoE budget; door controllers; PA zones per floor and amplifiers. Read-only; worked out again on every call.',
    input: {
      project,
      detail: z.enum(['summary', 'groups', 'devices']).default('groups').describe('summary = counts; groups = every loop / switch / controller / zone; devices = also every device with its address')
    },
    usesProject: true,
    run: (a, ctx) => {
      const { project: p } = openProject({ ref: String(a.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
      const s = elvSchedules(p, elvSettingsFor(p, {}, ctx));
      const strip = a.detail !== 'devices';
      return {
        buildings: s.buildings.map((b) => ({
          building: b.buildingId,
          summary: { zones: b.zones.length, loops: b.loops.length, panels: new Set(b.loops.map((l) => l.panel)).size, loopDevices: b.loops.reduce((t, l) => t + l.devices.length, 0), isolators: b.loops.reduce((t, l) => t + l.isolators, 0), cctvSwitches: b.switches.filter((x) => x.system === 'cctv').length, ictSwitches: b.switches.filter((x) => x.system === 'ict').length, controllers: b.controllers.length, paZones: b.paZones.length, amplifiers: b.amplifiers.length },
          ...(a.detail === 'summary' ? {} : {
            zones: b.zones,
            loops: b.loops.map(({ devices, ...l }) => ({ ...l, devices: devices.length, ...(strip ? {} : { list: devices }) })),
            switches: b.switches.map(({ devices, ...x }) => ({ ...x, ...(strip ? {} : { list: devices }) })),
            controllers: b.controllers.map(({ devices, ...x }) => ({ ...x, ...(strip ? {} : { list: devices }) })),
            paZones: b.paZones.map(({ devices, ...x }) => ({ ...x, ...(strip ? {} : { list: devices }) })),
            amplifiers: b.amplifiers
          })
        })),
        ...(s.warnings.length ? { warnings: s.warnings } : {}),
        ...(s.buildings.length ? {} : { note: 'No ELV devices placed yet: place them with elv_place_devices.' })
      };
    }
  },
  {
    name: 'elv_place_devices',
    title: 'Place or remove ELV devices on a level',
    description: 'Adds ELV devices at points on a level\'s floor plan (metres, the coordinates of the room outlines read from CAD) and removes devices by ID. Each device is put in the room whose outline is around it. Types: ' + Object.values(ELV_DEVICES).map((d) => `${d.type} (${d.label})`).join(', ') + '. Preview first.',
    input: {
      project, ...atLevel,
      add: z.array(newElvDevice).max(5000).optional().describe('Devices to add'),
      remove: z.array(z.string()).max(5000).optional().describe('Device IDs to remove (E1, E2, …)'),
      mode: z.enum(['preview', 'apply']).default('preview').describe('preview = show what would change, nothing is written; apply = change the project file (a backup is kept; undo_change puts it back)')
    },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'elv_place_devices', a.mode === 'apply', (p) => {
      const at = findLevel(p, String(a.building), String(a.level));
      const remove = (a.remove as string[] | undefined) ?? [];
      const add = (a.add as z.infer<typeof newElvDevice>[] | undefined) ?? [];
      if (!remove.length && !add.length) throw new Error('Nothing to do: give add and/or remove.');
      const onLevel = new Set(devicesOn(p, at.building, at.level).map((d) => d.id));
      const elsewhere = remove.filter((id) => !onLevel.has(id));
      if (elsewhere.length) throw new Error(`Not on ${at.name}: ${elsewhere.join(', ')}.`);
      const { project: next, ids } = placeDevices(remove.length ? removeDevices(p, remove) : p, at.building, at.level, add);
      const added = (next.elvDevices ?? []).filter((d) => ids.includes(d.id));
      const outside = added.filter((d) => !d.roomId).length;
      const rooms = new Map(buildingInfoOf(p).rooms.map((r) => [r.id, r.name]));
      return {
        next,
        summary: `${at.name}: ${ids.length} ELV device${ids.length === 1 ? '' : 's'} added, ${remove.length} removed`,
        details: { added: added.map((d) => ({ id: d.id, type: d.type, x: d.x, y: d.y, room: d.roomId ? rooms.get(d.roomId) ?? d.roomId : undefined })), ...(remove.length ? { removed: remove } : {}) },
        ...(outside ? { warnings: [`${outside} device${outside === 1 ? ' is' : 's are'} outside every room outline: take the rooms from the CAD plan (rooms_from_cad) or check the coordinates.`] } : {})
      };
    })
  },
  {
    name: 'elv_estimate',
    title: 'ELV estimate',
    description: 'ELV devices and upstream loads from the rooms of Building information (room type × area): fire alarm, CCTV, access control, ICT and public address. Per supply (fire alarm panel, PoE switches, door controllers, floor rack, amplifiers): devices, units and the AC kW an LV circuit feeds, with how it was worked out. Typical rules marked to verify; an estimate, not a layout.',
    input: {
      project, ...elvInput,
      detail: z.enum(['summary', 'supplies', 'rooms']).default('supplies').describe('summary = kW per system; supplies = also every supply; rooms = also the devices in every room'),
      limit: z.number().int().min(1).max(5000).default(200).describe('Most supplies / rooms to list')
    },
    usesProject: true,
    run: (a, ctx) => {
      const { project: p } = openProject({ ref: String(a.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
      const e = estimateElv(p, elvSettingsFor(p, a, ctx));
      const n = Number(a.limit);
      const kW = Math.round(e.supplies.reduce((t, s) => t + s.kW, 0) * 1000) / 1000;
      return {
        systems: e.systems, kW, totals: e.totals,
        ...(a.detail !== 'summary' ? { supplies: e.supplies.slice(0, n).map(({ buildingId: _b, levelId: _l, rooms, ...s }) => ({ ...s, rooms: rooms.length })) } : {}),
        ...(a.detail === 'rooms' ? { rooms: e.rooms.slice(0, n) } : {}),
        ...(e.warnings.length ? { warnings: e.warnings } : {}),
        assumptions: e.assumptions,
        note: 'Typical values to verify; an estimate for loads, not a device layout. Export the loads with export_elv_loads_package and accept them in LV with exchange_review / exchange_apply.'
      };
    }
  },
  {
    name: 'elv_place_loads',
    title: 'Place accepted ELV loads on LV boards',
    description: 'Each ELV load accepted in the review inbox (exchange_apply) becomes a circuit: a floor supply on the DB of its floor (the one serving most of its rooms), a building supply on the main board, an essential load on the essential (generator) side where there is one. Circuits are sized with the app\'s own recommendation and linked to their load. For loads already placed, a changed kW is proposed as a modification record (Reports → Changes) for the engineer to accept; circuits of removed loads and the "ELV / BMS / security" placeholder are listed, not deleted. Preview first; applying needs approvedBy.',
    input: {
      project,
      boards: z.record(z.string(), z.string()).optional().describe('Board for a load, by load ID, instead of the rule, e.g. {"FA-T": "EMDB-GF"}'),
      approvedBy: z.string().trim().min(2).optional().describe('Name of the engineer who approved the placement (required to apply)'),
      mode: z.enum(['preview', 'apply']).default('preview').describe('preview = show what would change, nothing is written; apply = add the circuits and the kW proposal (a backup is kept; undo_change puts it back)')
    },
    usesProject: true, writes: true,
    run: (a, ctx) => {
      const by = typeof a.approvedBy === 'string' ? a.approvedBy.trim() : '';
      if (a.mode === 'apply' && by.length < 2) throw new Error('Applying needs approvedBy: the name of the engineer who approved the placement.');
      return edit(a, ctx, 'elv_place_loads', a.mode === 'apply', (p) => {
        const { project: next, plan, added, proposal: mod } = placeElvLoads(p, (a.boards as Record<string, string> | undefined) ?? {}, AUTHOR, by || undefined);
        const warnings = [
          ...plan.notices,
          ...plan.unplaced.map((u) => `${u.load.id} not placed: ${u.why}. Give its board with boards.`),
          ...plan.removed.map((r) => `${r.feederId} (${r.name}) feeds a load no longer in the accepted package: delete it in the app if it is not needed.`),
          ...plan.placeholders.map((r) => `${r.feederId} is the "${r.name}" placeholder: delete it now that the ELV loads are placed.`)
        ];
        return {
          next,
          summary: `${added.length} ELV circuit${added.length === 1 ? '' : 's'} added${mod ? `; ${mod} proposes ${plan.kwChanges.length} kW change${plan.kwChanges.length === 1 ? '' : 's'}` : ''}${plan.same.length ? `; ${plan.same.length} already up to date` : ''}${by ? ` (approved by ${by})` : ''}`,
          details: {
            added: plan.add.map((c, i) => ({ circuit: added[i], board: c.boardId, load: c.load.id, kW: c.load.kW, supply: c.load.supply, why: c.why })),
            ...(plan.kwChanges.length ? { kwChanges: plan.kwChanges.map((c) => ({ circuit: c.feederId, from: c.fromKw, to: c.toKw })) } : {}),
            ...(plan.unplaced.length ? { unplaced: plan.unplaced.map((u) => ({ load: u.load.id, why: u.why })) } : {})
          },
          ...(warnings.length ? { warnings } : {})
        };
      });
    }
  }
];

function listDevices(p: Project, buildingRef: string, levelRef: string) {
  const at = findLevel(p, buildingRef, levelRef);
  const rooms = new Map(buildingInfoOf(p).rooms.map((r) => [r.id, r.name]));
  const list = devicesOn(p, at.building, at.level);
  const perType: Record<string, number> = {};
  for (const d of list) perType[d.type] = (perType[d.type] ?? 0) + 1;
  return {
    level: at.name, devices: list.length, perType,
    list: list.map((d) => ({ id: d.id, type: d.type, x: d.x, y: d.y, ...(d.rotationDeg !== undefined ? { rotationDeg: d.rotationDeg } : {}), room: d.roomId ? rooms.get(d.roomId) ?? d.roomId : undefined }))
  };
}
