import { z } from 'zod';
import { ELV_SYSTEMS } from '../elv/defaults';
import { elvSettings, estimateElv, type ElvSettings } from '../elv/estimate';
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

export const ELV_TOOLS: Tool[] = [
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
  }
];
