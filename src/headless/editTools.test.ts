// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from '../calc/electrical';
import { applyModification, transition } from '../model/designChanges';
import type { Project } from '../types';
import { callTool, offeredTools, toolByName, type ToolContext } from './tools';
import { parseProject } from './project';
import { readLog, writeBlocked } from './write';
import { createApi } from './api';
import { createMcp } from './mcp';
import { main } from './cli';

let root: string, folder: string, appData: string;
let ctx: ToolContext;
const failing: Project = { ...sampleProject, id: 'proj-failing', name: 'Failing copy', feeders: sampleProject.feeders.map((f) => (f.id === 'GF-SKT' ? { ...f, cableCsaMm2: 1.5 } : f)) };
const villa: Project = { ...sampleProject, id: 'proj-villa' };
const file = (n: string) => path.join(folder, `${n}.json`);
const read = (n: string) => fs.readFileSync(file(n), 'utf-8');
const load = (n: string) => parseProject(read(n), `${n}.json`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results are checked field by field
const run = (name: string, args: Record<string, unknown>): Record<string, any> => callTool(toolByName(name)!, args, ctx) as Record<string, any>;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-edit-'));
  appData = path.join(root, 'app');
  process.env.LVDS_APP_DATA = appData;
});
afterAll(() => { delete process.env.LVDS_APP_DATA; fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(root, 'projects-'));
  fs.writeFileSync(file('Villa'), JSON.stringify(villa, null, 2));
  fs.writeFileSync(file('Failing'), JSON.stringify(failing, null, 2));
  fs.rmSync(path.join(appData, 'recovery'), { recursive: true, force: true });
  ctx = { folder, anywhere: false, write: true };
});

describe('offered only with --write', () => {
  it('servers without --write offer read-only tools only', () => {
    expect(offeredTools({ folder: '.', anywhere: false }).some((t) => t.writes)).toBe(false);
    expect(offeredTools({ folder: '.', anywhere: false, write: true }).filter((t) => t.writes).map((t) => t.name)).toEqual(
      expect.arrayContaining(['propose_changes', 'size_circuits', 'add_panel', 'add_circuit', 'move_panel', 'rename_panels', 'copy_panel', 'undo_change']));
  });
  it('every tool that deletes or exports asks for the approving engineer', () => {
    const gated = offeredTools({ folder: '.', anywhere: false, write: true }).filter((t) => /delete|remove|export_/.test(t.name));
    expect(gated.length).toBeGreaterThan(0);
    for (const t of gated) expect(Object.keys(t.input)).toContain('approvedBy');
  });
});

describe('preview writes nothing', () => {
  it('every write tool previews by default', () => {
    const before = read('Villa');
    run('add_panel', { project: 'Villa', kind: 'SMDB', fedFrom: 'MDB-1' });
    run('add_circuit', { project: 'Villa', panel: 'SMDB-GF', name: 'Pump', loadKw: 11, lengthM: 20 });
    run('move_panel', { project: 'Villa', panel: 'DB-GF1', to: 'SMDB-FF' });
    run('rename_panels', { project: 'Villa', renames: [{ from: 'SMDB-FF', to: 'SMDB-L1' }] });
    run('copy_panel', { project: 'Villa', panel: 'SMDB-GF', to: 'MDB-1', idFind: 'GF', idReplace: 'L2' });
    run('size_circuits', { project: 'Failing' });
    expect(read('Villa')).toBe(before);
    expect(readLog(folder)).toEqual([]);
  });
});

describe('proposals: the engineer applies them', () => {
  it('size_circuits proposes the fix; the design is unchanged until accepted and applied in the app', () => {
    const p = run('size_circuits', { project: 'Failing', mode: 'propose' });
    expect(p.written).toBe(true);
    expect(p.checks.fixed).toContain('GF-SKT');
    const saved = load('Failing');
    const rec = saved.modifications!.find((m) => m.id === p.details.proposal)!;
    expect(rec).toMatchObject({ status: 'proposed', author: 'AI assistant (lvds)' });
    expect(rec.decision).toBeUndefined();
    expect(saved.feeders.find((f) => f.id === 'GF-SKT')!.cableCsaMm2).toBe(1.5); // not applied
    // The engineer's steps in the app: accept with their name, then apply (one undo step).
    const acc = transition(saved, rec, 'accepted', { by: 'Engineer' });
    if (!acc.ok) throw new Error(acc.error);
    const applied = applyModification({ ...saved, modifications: [acc.record] }, rec.id);
    if (!applied.ok) throw new Error(applied.error);
    expect(evaluateProject(applied.project).find((r) => r.feeder.id === 'GF-SKT')!.status).toBe('ok');
  });
  it('propose_changes checks fields and values with the app rules', () => {
    expect(() => run('propose_changes', { project: 'Villa', title: 'Bad', reason: 'test', changes: [{ target: 'feeder', id: 'GF-SKT', field: 'name', value: 'x' }] })).toThrow(/cannot be proposed/);
    expect(() => run('propose_changes', { project: 'Villa', title: 'Bad', reason: 'test', changes: [{ target: 'feeder', id: 'NOPE', field: 'lengthM', value: 10 }] })).toThrow(/does not exist/);
    const ok = run('propose_changes', { project: 'Villa', title: 'Longer run', reason: 'Route changed', changes: [{ target: 'feeder', id: 'GF-SKT', field: 'lengthM', value: 120 }] });
    expect(ok.details.changes[0]).toMatchObject({ item: 'GF-SKT', from: 35, to: 120 });
    expect(ok.checks.newlyFailing).toContain('GF-SKT'); // the preview shows the consequence
  });
  it('says so when nothing needs sizing', () => {
    expect(() => run('size_circuits', { project: 'Villa' })).toThrow(/No circuits in scope|already pass/);
  });
});

describe('structure changes', () => {
  it('add_panel and add_circuit size what they add and pass the checks', () => {
    const a = run('add_panel', { project: 'Villa', kind: 'SMDB', id: 'SMDB-L2', fedFrom: 'MDB-1', lengthM: 60, mode: 'apply' });
    expect(a.written).toBe(true);
    const c = run('add_circuit', { project: 'Villa', panel: 'SMDB-L2', name: 'Chiller 1', loadKw: 90, loadType: 'hvac', lengthM: 45, mode: 'apply' });
    expect(c.details).toMatchObject({ circuit: 'SMDB-L2-C1', status: 'ok' });
    expect(c.checks.after.fail).toBe(0);
    const p = load('Villa');
    expect(p.boards.find((b) => b.id === 'SMDB-L2')!.upstreamId).toBe('MDB-1');
    expect(p.feeders.find((f) => f.id === 'INC-SMDB-L2')!.feedsBoardId).toBe('SMDB-L2');
    expect(() => run('add_panel', { project: 'Villa', kind: 'DB', id: 'SMDB-L2', fedFrom: 'MDB-1' })).toThrow(/already exists/);
  });
  it('move, rename and copy use the app rules', () => {
    expect(() => run('move_panel', { project: 'Villa', panel: 'SMDB-GF', to: 'DB-GF1' })).toThrow(/loop/);
    expect(() => run('rename_panels', { project: 'Villa', renames: [{ from: 'SMDB-FF', to: 'SMDB-GF' }] })).toThrow(/already exists/);
    run('rename_panels', { project: 'Villa', renames: [{ from: 'SMDB-FF', to: 'SMDB-L1' }], mode: 'apply' });
    const p = load('Villa');
    expect(p.boards.some((b) => b.id === 'SMDB-L1')).toBe(true);
    expect(p.feeders.find((f) => f.feedsBoardId === 'SMDB-L1')).toBeDefined();
    const cp = run('copy_panel', { project: 'Villa', panel: 'SMDB-GF', to: 'MDB-1', idFind: 'GF', idReplace: 'L2', mode: 'apply' });
    expect(cp.details.panels).toEqual(expect.arrayContaining(['SMDB-L2', 'DB-L21']));
  });
});

describe('backup, log and undo', () => {
  it('undo puts back the exact file, newest change first', () => {
    const original = read('Villa');
    run('add_panel', { project: 'Villa', kind: 'DB', id: 'DB-X', fedFrom: 'SMDB-GF', mode: 'apply' });
    const afterFirst = read('Villa');
    run('add_circuit', { project: 'Villa', panel: 'DB-X', name: 'Load', loadKw: 3, lengthM: 15, phases: 1, mode: 'apply' });
    expect(readLog(folder)).toHaveLength(2);
    expect(run('undo_change', { project: 'Villa' }).mode).toBe('preview');
    run('undo_change', { project: 'Villa', mode: 'apply' });
    expect(read('Villa')).toBe(afterFirst);
    run('undo_change', { project: 'Villa', mode: 'apply' });
    expect(read('Villa')).toBe(original);
    expect(() => run('undo_change', { project: 'Villa', mode: 'apply' })).toThrow(/No change to undo/);
    expect(run('list_changes', { project: 'Villa' }).filter((e: { undone?: boolean }) => e.undone)).toHaveLength(2);
  });
  it('undo refuses when the file changed since, and says where the backup is', () => {
    const a = run('add_panel', { project: 'Villa', kind: 'DB', id: 'DB-Y', fedFrom: 'SMDB-GF', mode: 'apply' });
    fs.writeFileSync(file('Villa'), read('Villa').replace('"Villa Complex', '"Edited Villa Complex')); // saved from the app
    expect(() => run('undo_change', { project: 'Villa', change: a.change, mode: 'apply' })).toThrow(/has changed since.*\.lvds-agent/);
  });
});

describe('never over unsaved work', () => {
  it('refuses while the app has unsaved changes for the project', () => {
    fs.mkdirSync(path.join(appData, 'recovery'), { recursive: true });
    fs.writeFileSync(path.join(appData, 'recovery', 'proj-villa.json'), '{}');
    const before = read('Villa');
    expect(() => run('add_panel', { project: 'Villa', kind: 'DB', fedFrom: 'SMDB-GF', mode: 'apply' })).toThrow(/unsaved changes/);
    expect(read('Villa')).toBe(before);
    expect(() => run('add_panel', { project: 'Failing', kind: 'DB', fedFrom: 'SMDB-GF', mode: 'apply' })).not.toThrow(); // other projects are fine
  });
  it('refuses when the file changed after it was read', () => {
    const text = read('Villa');
    fs.writeFileSync(file('Villa'), text + '\n');
    expect(writeBlocked(load('Villa'), file('Villa'), text)).toMatch(/changed while/);
  });
});

describe('servers', () => {
  it('MCP: write tools only with --write, marked not read-only', async () => {
    const list = async (write: boolean) => {
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 't', version: '1' });
      await Promise.all([createMcp({ folder, anywhere: false, write }, '1').connect(a), client.connect(b)]);
      const { tools } = await client.listTools();
      await client.close();
      return tools;
    };
    expect((await list(false)).some((t) => t.name === 'add_panel')).toBe(false);
    const w = await list(true);
    expect(w.find((t) => t.name === 'add_panel')!.annotations?.readOnlyHint).toBe(false);
  });
  it('API: a change needs POST with JSON', async () => {
    const server = createApi(ctx, '1');
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tools`;
    try {
      expect((await fetch(`${base}/add_panel?project=Villa&kind=DB&fedFrom=SMDB-GF&mode=apply`)).status).toBe(405);
      expect((await fetch(`${base}/add_panel`, { method: 'POST', body: JSON.stringify({ project: 'Villa', kind: 'DB', fedFrom: 'SMDB-GF', mode: 'apply' }), headers: { 'Content-Type': 'text/plain' } })).status).toBe(405);
      const ok = await fetch(`${base}/add_panel`, { method: 'POST', body: JSON.stringify({ project: 'Villa', kind: 'DB', fedFrom: 'SMDB-GF', mode: 'apply' }), headers: { 'Content-Type': 'application/json' } });
      expect((await ok.json() as { written: boolean }).written).toBe(true);
    } finally { await new Promise((r) => server.close(r)); }
  });
  it('CLI: --apply writes, without it a preview', async () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) };
    const before = read('Villa');
    expect(await main(['add-panel', 'Villa', '--kind', 'DB', '--fedFrom', 'SMDB-GF', '--folder', folder], '1', io)).toBe(0);
    expect(read('Villa')).toBe(before);
    expect(await main(['add-panel', 'Villa', '--kind', 'DB', '--fedFrom', 'SMDB-GF', '--apply', '--folder', folder], '1', io)).toBe(0);
    expect(read('Villa')).not.toBe(before);
    expect(await main(['rename', 'Villa', '--renames', '[{"from":"SMDB-FF","to":"SMDB-L1"}]', '--apply', '--folder', folder], '1', io)).toBe(0);
    expect(load('Villa').boards.some((b) => b.id === 'SMDB-L1')).toBe(true);
    expect(await main(['check', 'Villa', '--apply', '--folder', folder], '1', io)).toBe(2);
  });
});
