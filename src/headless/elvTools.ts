import { z } from 'zod';
import { ELV_SYSTEMS } from '../elv/defaults';
import { elvSettings, estimateElv, type ElvSettings } from '../elv/estimate';
import { placeElvLoads } from '../calc/elvPlace';
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
