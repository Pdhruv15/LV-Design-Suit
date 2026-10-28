import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { buildingInfoOf } from '../calc/building';
import { MAX_DRAWING_BYTES, readCadDrawing } from '../engines/cad/reader';
import { findBuilding } from '../model/buildingEdit';
import { planFromDrawing } from '../model/cadDrawing';
import { applyRooms, LAYER_ROLES, layerMapFor, proposeRooms, roomsFromPlan } from '../model/cadRooms';
import type { CadPlan } from '../model/cadPlaces';
import type { CadLayerMap, CadLayerRole, Project } from '../types';
import { edit } from './editTools';
import { openProject } from './project';
import { r, type Tool, type ToolContext } from './tools';

/** DWG / DXF floor plans read by the built-in reader (acadrust), without any CAD program: what a plan holds, and its
 * rooms and areas into Building information (preview, then apply) — the same reading and review as the app's
 * Rooms and areas from CAD floor plan. 2D plan only. */

const project = z.string().describe('Project file name in the projects folder, as given by list_projects');
const drawing = z.string().describe('Floor plan file (DWG R13–2018 or DXF): a path, or a file name in the projects folder');
const roles = z.record(z.string(), z.enum(LAYER_ROLES.map((x) => x.value) as [CadLayerRole, ...CadLayerRole[]])).optional()
  .describe('Layer roles that differ from the saved map / guesses, e.g. {"A-AREA": "room", "A-AREA-NAME": "room-name"}');
const mode = z.enum(['preview', 'apply']).default('preview').describe('preview = show what would change, nothing is written; apply = change the project file (a backup is kept; undo_change puts it back)');

/** Reads a drawing file: on MCP and the local API, only from inside the projects folder. */
function readPlan(ref: string, ctx: ToolContext): CadPlan {
  const name = ref.trim();
  if (!name) throw new Error('Give the floor plan file (DWG or DXF).');
  const candidates = path.isAbsolute(name) ? [name] : [path.resolve(ctx.folder, name), ...(ctx.anywhere ? [path.resolve(name)] : [])];
  const full = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!full) throw new Error(`No file "${name}"${ctx.anywhere ? '' : ` in ${ctx.folder}`}.`);
  if (!ctx.anywhere) {
    const rel = path.relative(path.resolve(ctx.folder), path.resolve(full));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Only files inside the projects folder (${ctx.folder}) can be read here.`);
  }
  if (!/\.(dwg|dxf)$/i.test(full)) throw new Error(`${path.basename(full)} is not a DWG or DXF file.`);
  if (fs.statSync(full).size > MAX_DRAWING_BYTES) throw new Error(`${path.basename(full)} is larger than ${MAX_DRAWING_BYTES / 1024 / 1024} MB.`);
  const d = readCadDrawing(new Uint8Array(fs.readFileSync(full)));
  return { ...planFromDrawing(d), file: path.basename(full) };
}

/** The saved / guessed layer map of the plan, with the roles given in the call on top. */
function layerMap(p: Project, plan: CadPlan, given: unknown): CadLayerMap[] {
  const over = (given ?? {}) as Record<string, CadLayerRole>;
  const known = new Map((plan.layers ?? []).map((l) => [l.name.toLowerCase(), l.name]));
  for (const layer of Object.keys(over)) if (!known.has(layer.toLowerCase())) throw new Error(`The plan has no layer "${layer}". Layers: ${[...known.values()].join(', ')}`);
  return layerMapFor(p, plan.layers ?? []).map((m) => {
    const key = Object.keys(over).find((k) => k.toLowerCase() === m.layer.toLowerCase());
    return key ? { ...m, role: over[key] } : m;
  });
}

/** A level of a building by ID, else by name (case does not matter). */
export function findLevel(p: Project, buildingRef: string, levelRef: string): { building: string; level: string; name: string } {
  const b = findBuilding(p, buildingRef);
  const lower = levelRef.trim().toLowerCase();
  const l = b.levels.find((x) => x.id === levelRef) ?? b.levels.find((x) => x.name.trim().toLowerCase() === lower || x.id.toLowerCase() === lower);
  if (!l) throw new Error(b.levels.length ? `No level "${levelRef}" in ${b.name}. Levels: ${b.levels.map((x) => `${x.id} (${x.name})`).join(', ')}` : `${b.name} has no levels yet. Add one with add_level.`);
  return { building: b.id, level: l.id, name: l.name };
}

export const CAD_TOOLS: Tool[] = [
  {
    name: 'cad_plan',
    title: 'Read a DWG / DXF floor plan',
    description: 'Reads a floor plan with the built-in reader (no CAD program needed): drawing format and units, each layer with what it holds and its role (saved map or guess), and the rooms its room-outline layers give. Nothing is written.',
    input: { project, drawing, roles },
    usesProject: true,
    run: (a, ctx) => {
      const { project: p } = openProject({ ref: String(a.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
      const plan = readPlan(String(a.drawing), ctx);
      const map = layerMap(p, plan, a.roles);
      const read = roomsFromPlan(plan, map, p.cadLength);
      return {
        file: plan.file, units: read.units,
        layers: (plan.layers ?? []).map((l) => ({ ...l, role: map.find((m) => m.layer === l.name)?.role })),
        rooms: read.rooms.length, zonesLeftOut: read.zones,
        totalAreaM2: r(read.rooms.reduce((s, x) => s + x.areaM2, 0), 1),
        unnamed: read.rooms.filter((x) => !x.named).length,
        next: read.rooms.length ? 'rooms_from_cad takes them into Building information for a level.' : 'No rooms: give the layer with the room outlines the role "room" (roles).'
      };
    }
  },
  {
    name: 'rooms_from_cad',
    title: 'Rooms and areas from a DWG / DXF floor plan',
    description: 'Rooms of a floor plan into Building information on one level, as the app\'s Rooms and areas from CAD floor plan does: closed outlines / hatches on room layers, areas measured, names from room tags or texts, room types guessed. A room found by its outline (same drawing) keeps its ID; else the same name updates the area; else a new room. Building information rooms feed the Load assessment. Preview first.',
    input: {
      project, drawing, roles,
      building: z.string().describe('Building id or name'),
      level: z.string().describe('Level id or name the plan shows'),
      mode
    },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'rooms_from_cad', a.mode === 'apply', (p) => {
      const plan = readPlan(String(a.drawing), ctx);
      const map = layerMap(p, plan, a.roles);
      const at = findLevel(p, String(a.building), String(a.level));
      const read = roomsFromPlan(plan, map, p.cadLength);
      if (!read.rooms.length) throw new Error('The plan gives no rooms: give the layer with the room outlines the role "room" (roles). See cad_plan.');
      const { proposals, notOnPlan } = proposeRooms(p, read.rooms, at.building, at.level);
      const changing = proposals.filter((x) => x.status !== 'same');
      const next = applyRooms(p, changing, at.building, at.level, map, proposals.filter((x) => x.status === 'same'));
      const types = new Map((buildingInfoOf(p).roomTypes ?? []).map((t) => [t.id, t.label]));
      return {
        next,
        summary: `Rooms from ${plan.file} on ${at.name}: ${changing.filter((x) => x.status === 'new').length} new, ${changing.filter((x) => x.status === 'changed').length} updated, ${proposals.length - changing.length} already match`,
        details: {
          units: read.units,
          rooms: changing.map((x) => ({ name: x.name, ...(x.number ? { number: x.number } : {}), areaM2: r(x.areaM2, 1), ...(x.currentAreaM2 !== undefined ? { nowM2: r(x.currentAreaM2, 1) } : {}), type: x.type ? types.get(x.type) ?? x.type : undefined, status: x.status })),
          ...(notOnPlan.length ? { notOnPlanKept: notOnPlan.map((x) => x.name) } : {})
        },
        warnings: [
          ...(read.rooms.some((x) => !x.named) ? [`${read.rooms.filter((x) => !x.named).length} rooms have no name on the plan (named "Room n"): check the room-name layer.`] : []),
          ...(changing.some((x) => !x.type) ? ['Some rooms have no room type guessed: they get the first room type; set them in Building information.'] : [])
        ]
      };
    })
  }
];
