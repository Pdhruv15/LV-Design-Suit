import { z } from 'zod';
import { LEVEL_KINDS } from '../calc/building';
import { addBuilding, addLevel } from '../model/buildingEdit';
import type { LevelKind } from '../types';
import { edit } from './editTools';
import type { Tool } from './tools';

/** Buildings and levels of Building information from the command line, MCP and the local API, so a rooms package
 * (exchange_review / exchange_apply) can be taken into a project that does not have its building yet. Structure
 * changes: a preview first, then the file is changed with a backup (undo_change puts it back). */

const project = z.string().describe('Project file name in the projects folder, as given by list_projects');
const mode = z.enum(['preview', 'apply']).default('preview').describe('preview = show what would change, nothing is written; apply = change the project file (a backup is kept; undo_change puts it back)');

export const BUILDING_TOOLS: Tool[] = [
  {
    name: 'add_building',
    title: 'Add a building',
    description: 'Adds a building to Building information, with no levels: add them with add_level. The name must match the building of a rooms package for exchange_review to place its rooms.',
    input: {
      project,
      name: z.string().min(1).describe('e.g. "Tower A"'),
      id: z.string().optional().describe('Building id (default: next free B<n>)'),
      use: z.string().optional().describe('e.g. "Residential tower"'),
      mode
    },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'add_building', a.mode === 'apply', (p) => {
      const { project: next, building: b } = addBuilding(p, { name: String(a.name), ...(a.id !== undefined ? { id: String(a.id) } : {}), ...(a.use !== undefined ? { use: String(a.use) } : {}) });
      return { next, summary: `Add building ${b.id} "${b.name}"${b.use ? ` (${b.use})` : ''}, no levels yet`, details: { building: b } };
    })
  },
  {
    name: 'add_level',
    title: 'Add a level to a building',
    description: 'Adds a level to a building of Building information. Without "above", a basement goes to the bottom, the ground above the basements, a roof on top and any other level below the roof. A typical level can stand for several identical floors (count).',
    input: {
      project,
      building: z.string().describe('Building id or name'),
      name: z.string().min(1).describe('e.g. "Ground", "B1", "L1–L10 (typical)"'),
      kind: z.enum(LEVEL_KINDS.map((k) => k.value) as [LevelKind, ...LevelKind[]]).describe(LEVEL_KINDS.map((k) => k.value).join(', ')),
      heightM: z.number().positive().max(50).optional().describe('Floor-to-floor height, m (default by kind: ground and podium 4.5, roof 3, others 3.6)'),
      count: z.number().int().min(1).max(200).optional().describe('Identical floors, typical levels only'),
      grossM2: z.number().positive().optional().describe('Gross floor area of one floor, m²'),
      above: z.string().optional().describe('Level id or name the new level goes directly above'),
      id: z.string().optional().describe('Level id (default: <building>-L<n>)'),
      mode
    },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'add_level', a.mode === 'apply', (p) => {
      const { project: next, building: b, level: l, index } = addLevel(p, String(a.building), {
        name: String(a.name), kind: a.kind as LevelKind,
        ...(a.id !== undefined ? { id: String(a.id) } : {}),
        ...(a.heightM !== undefined ? { heightM: Number(a.heightM) } : {}),
        ...(a.count !== undefined ? { count: Number(a.count) } : {}),
        ...(a.grossM2 !== undefined ? { grossM2: Number(a.grossM2) } : {}),
        ...(a.above !== undefined ? { above: String(a.above) } : {})
      });
      const below = b.levels[index - 1];
      return {
        next,
        summary: `Add level ${l.id} "${l.name}" (${l.kind}${l.count ? `, ${l.count} floors` : ''}, ${l.heightM} m) to ${b.name}, ${below ? `above ${below.name}` : 'at the bottom'}`,
        details: { building: b.id, level: l, levels: b.levels.map((x) => x.name) }
      };
    })
  }
];
