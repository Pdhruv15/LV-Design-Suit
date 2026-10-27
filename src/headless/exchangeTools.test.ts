// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';
import { parseProject } from './project';
import { callTool, offeredTools, toolByName, type ToolContext } from './tools';
import { readLog } from './write';

let root: string, folder: string;
let ctx: ToolContext;
const villa: Project = {
  ...sampleProject, id: 'proj-villa',
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Kitchen', type: 'kitchen', areaM2: 25 }] }
};
const sample = path.resolve(__dirname, '../../tests/fixtures/exchange/villa-gf-rooms.ifc.json');
const project = () => parseProject(fs.readFileSync(path.join(folder, 'Villa.json'), 'utf-8'), 'Villa.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results are checked field by field
const run = async (name: string, args: Record<string, unknown>): Promise<Record<string, any>> => (await callTool(toolByName(name)!, args, ctx)) as Record<string, any>;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-exchange-'));
  process.env.LVDS_APP_DATA = path.join(root, 'app');
});
afterAll(() => { delete process.env.LVDS_APP_DATA; fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(root, 'projects-'));
  fs.writeFileSync(path.join(folder, 'Villa.json'), JSON.stringify(villa, null, 2));
  fs.copyFileSync(sample, path.join(folder, 'rooms.json'));
  ctx = { folder, anywhere: false, write: true };
});

describe('exchange tools', () => {
  it('checks a package, and reports the wrong rows of a bad one', async () => {
    expect(await run('exchange_check', { file: 'rooms.json' })).toMatchObject({ ok: true, kind: 'rooms', items: 3, source: { app: 'ifc', file: 'Villa-ARC.ifc' } });
    const bad = JSON.parse(fs.readFileSync(sample, 'utf-8'));
    bad.items[0].netAreaM2 = 0;
    fs.writeFileSync(path.join(folder, 'bad.json'), JSON.stringify(bad));
    expect(await run('exchange_check', { file: 'bad.json' })).toMatchObject({ ok: false, errors: [{ row: 1, field: 'netAreaM2' }] });
    await expect(run('exchange_review', { project: 'Villa', file: 'bad.json' })).rejects.toThrow(/bad\.json cannot be used: row 1 netAreaM2/);
  });

  it('reviews against the project without writing', async () => {
    const r = await run('exchange_review', { project: 'Villa', file: 'rooms.json' });
    expect(r.counts).toEqual({ added: 2, changed: 1, renamed: 0, removed: 0, same: 0 });
    expect(r.changes.map((c: { key: string }) => c.key)).toEqual(['room:2O2Fr$t4X7Zf8NOew3FLOH', 'room:1hqIFTRjfV6AWq_bMtnZwI', 'room:3cUkl32yn9qRSPvBJVyWYp']);
    expect(project().building!.rooms).toHaveLength(1);
  });

  it('previews, then applies only with the engineer’s name; the change can be undone', async () => {
    const preview = await run('exchange_apply', { project: 'Villa', file: 'rooms.json', accept: 'all' });
    expect(preview).toMatchObject({ mode: 'preview', written: false, summary: expect.stringMatching(/accepted \(1 changed, 2 added of 3 changes\), X-001/) });
    expect(project().building!.rooms).toHaveLength(1);
    await expect(run('exchange_apply', { project: 'Villa', file: 'rooms.json', accept: 'all', mode: 'apply' })).rejects.toThrow(/needs approvedBy/);
    const done = await run('exchange_apply', { project: 'Villa', file: 'rooms.json', accept: ['room:1hqIFTRjfV6AWq_bMtnZwI'], approvedBy: 'A. Engineer', mode: 'apply' });
    expect(done).toMatchObject({ mode: 'done', written: true });
    expect(project().building!.rooms.map((r) => r.name)).toEqual(['Kitchen', 'Majlis']);
    expect(project().exchange!.log).toEqual([expect.objectContaining({ id: 'X-001', decision: 'partly accepted', by: 'A. Engineer' })]);
    expect(readLog(folder).map((e) => e.tool)).toEqual(['exchange_apply']);
    await run('undo_change', { project: 'Villa', mode: 'apply' });
    expect(project().building!.rooms.map((r) => r.name)).toEqual(['Kitchen']);
  });

  it('reads package files only inside the projects folder on MCP and the local API', async () => {
    await expect(run('exchange_check', { file: sample })).rejects.toThrow(/inside the projects folder/);
    ctx = { ...ctx, anywhere: true };
    expect(await run('exchange_check', { file: sample })).toMatchObject({ ok: true });
  });

  it('exports the project rooms as a package after a preview', async () => {
    const preview = await run('export_rooms_package', { project: 'Villa', exportAnyway: true });
    expect(preview).toMatchObject({ mode: 'preview', written: false, files: [{ file: expect.stringMatching(/-rooms\.json$/), about: 'rooms package, 1 room' }] });
    const done = await run('export_rooms_package', { project: 'Villa', approvedBy: 'A. Engineer', exportAnyway: true, mode: 'export' });
    const written = JSON.parse(fs.readFileSync(done.files[0], 'utf-8'));
    expect(written).toMatchObject({ schema: 'lvds.exchange', version: 1, kind: 'rooms', source: { app: 'lvds' }, items: [{ sourceId: 'R1', name: 'Kitchen', netAreaM2: 25 }] });
    fs.copyFileSync(done.files[0], path.join(folder, 'back.json'));
    expect(await run('exchange_check', { file: 'back.json' })).toMatchObject({ ok: true, hash: written.sha256 });
  });

  it('offers only the read-only tools to servers without --write', () => {
    const ro = offeredTools({ folder: '.', anywhere: false }).map((t) => t.name);
    expect(ro).toEqual(expect.arrayContaining(['exchange_check', 'exchange_review']));
    expect(ro).not.toContain('exchange_apply');
    expect(ro).not.toContain('export_rooms_package');
  });
});
