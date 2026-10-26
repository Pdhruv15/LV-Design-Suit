// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';
import { parseProject } from './project';
import { callTool, offeredTools, toolByName, type ToolContext } from './tools';

let root: string, folder: string;
let ctx: ToolContext;
const villa: Project = {
  ...sampleProject, id: 'proj-villa',
  building: {
    buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }],
    rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: 40 }, { id: 'R2', buildingId: 'V', levelId: 'GF', name: 'Office', type: 'office', areaM2: 24 }]
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results are checked field by field
const run = async (name: string, args: Record<string, unknown>): Promise<Record<string, any>> => (await callTool(toolByName(name)!, args, ctx)) as Record<string, any>;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-elv-'));
  process.env.LVDS_APP_DATA = path.join(root, 'app');
});
afterAll(() => { delete process.env.LVDS_APP_DATA; fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(root, 'projects-'));
  fs.writeFileSync(path.join(folder, 'Villa.json'), JSON.stringify(villa, null, 2));
  ctx = { folder, anywhere: false, write: true };
});

describe('ELV tools', () => {
  it('estimates the supplies and kW of the project, and lists the assumptions', async () => {
    const r = await run('elv_estimate', { project: 'Villa' });
    expect(r.systems).toEqual(['fire-alarm', 'cctv', 'access-control', 'ict', 'public-address']);
    expect(r.supplies.map((s: { id: string }) => s.id)).toEqual(['ACS-V-GF', 'ICT-V-GF', 'FA-V', 'ICT-CORE-V', 'PA-V']);
    expect(r.kW).toBeCloseTo(r.supplies.reduce((t: number, s: { kW: number }) => t + s.kW, 0), 6);
    expect(r.assumptions.join(' ')).toMatch(/verify/);
    expect((await run('elv_estimate', { project: 'Villa', detail: 'summary', systems: ['ict'] }))).not.toHaveProperty('supplies');
  });

  it('takes a rules file, and says what is wrong with a bad one', async () => {
    fs.writeFileSync(path.join(folder, 'rules.json'), JSON.stringify({ rules: { office: { door: { m2: 0, min: 3 } } } }));
    const r = await run('elv_estimate', { project: 'Villa', rules: 'rules.json', detail: 'rooms' });
    expect(r.rooms.find((x: { roomId: string }) => x.roomId === 'R2').devices.door).toBe(3);
    fs.writeFileSync(path.join(folder, 'bad.json'), JSON.stringify({ rules: { office: { door: { m2: -1, min: 0 } } } }));
    await expect(run('elv_estimate', { project: 'Villa', rules: 'bad.json' })).rejects.toThrow(/bad\.json is not a valid ELV rules file: rules\.office\.door\.m2/);
  });

  it('exports the loads package, which LV then reviews and accepts', async () => {
    const done = await run('export_elv_loads_package', { project: 'Villa', approvedBy: 'A. Engineer', exportAnyway: true, mode: 'export' });
    fs.copyFileSync(done.files[0], path.join(folder, 'elv.json'));
    expect(await run('exchange_check', { file: 'elv.json' })).toMatchObject({ ok: true, kind: 'loads', items: 5, source: { app: 'elv' } });
    expect((await run('exchange_review', { project: 'Villa', file: 'elv.json' })).counts.added).toBe(5);
    await run('exchange_apply', { project: 'Villa', file: 'elv.json', accept: 'all', approvedBy: 'A. Engineer', mode: 'apply' });
    expect(parseProject(fs.readFileSync(path.join(folder, 'Villa.json'), 'utf-8'), 'Villa.json').exchange!.packages[0].loads).toHaveLength(5);
  });

  it('offers the estimate read-only, and the export only with --write', () => {
    const ro = offeredTools({ folder: '.', anywhere: false }).map((t) => t.name);
    expect(ro).toContain('elv_estimate');
    expect(ro).not.toContain('export_elv_loads_package');
  });
});
