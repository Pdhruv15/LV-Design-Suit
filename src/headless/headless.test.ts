// @vitest-environment node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';
import { TOOLS, callTool, toolByName, type ToolContext } from './tools';
import { listProjects, resolveProject } from './project';
import { main, parseArgs } from './cli';
import { createApi } from './api';
import { createMcp } from './mcp';

let folder: string;
let ctx: ToolContext;
const outside = path.join(os.tmpdir(), `lvds-outside-${process.pid}.json`);

// The sample passes every check; the "failing" copy has an undersized sockets cable (4 → 1.5 mm²).
const failing: Project = { ...sampleProject, name: 'Failing copy', feeders: sampleProject.feeders.map((f) => (f.id === 'GF-SKT' ? { ...f, cableCsaMm2: 1.5 } : f)) };

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-headless-'));
  fs.writeFileSync(path.join(folder, 'Villa.json'), JSON.stringify(sampleProject));
  fs.writeFileSync(path.join(folder, 'Failing.json'), JSON.stringify(failing));
  fs.writeFileSync(path.join(folder, 'notes.json'), JSON.stringify({ hello: 'not a project' }));
  fs.writeFileSync(outside, JSON.stringify(sampleProject));
  ctx = { folder, anywhere: false };
});
afterAll(() => { fs.rmSync(folder, { recursive: true, force: true }); fs.rmSync(outside, { force: true }); });

const run = (name: string, args: Record<string, unknown> = {}) => callTool(toolByName(name)!, args, ctx) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- tool results are checked field by field below

describe('project files', () => {
  it('lists only project files', () => {
    const list = listProjects(folder);
    expect(list.map((p) => p.file).sort()).toEqual(['Failing.json', 'Villa.json']);
    expect(list.find((p) => p.file === 'Villa.json')).toMatchObject({ name: sampleProject.name, panels: sampleProject.boards.length, circuits: sampleProject.feeders.length });
  });
  it('opens by name with or without .json', () => {
    expect(resolveProject({ ref: 'Villa', folder, anywhere: false })).toBe(path.join(folder, 'Villa.json'));
    expect(resolveProject({ ref: 'Villa.json', folder, anywhere: false })).toBe(path.join(folder, 'Villa.json'));
  });
  it('MCP / API cannot open files outside the projects folder', () => {
    expect(() => resolveProject({ ref: outside, folder, anywhere: false })).toThrow(/inside the projects folder/);
    expect(() => resolveProject({ ref: '../x', folder, anywhere: false })).toThrow();
    expect(resolveProject({ ref: outside, folder, anywhere: true })).toBe(outside);
  });
});

describe('tools', () => {
  it('every tool is read only and has a description', () => {
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(20);
  });
  it('project summary matches the app summary figures', () => {
    const s = run('project_summary', { project: 'Villa' });
    expect(s.name).toBe(sampleProject.name);
    expect(s.panels).toBe(5);
    expect(s.demandKw).toBeGreaterThan(0);
    expect(s.todo.fail).toBe(0);
  });
  it('run_checks reports the undersized cable on the failing copy', () => {
    const c = run('run_checks', { project: 'Failing' });
    expect(c.fail).toBeGreaterThan(0);
    expect(c.items.some((i: { circuit?: string; text: string }) => i.circuit === 'GF-SKT' || i.text.includes('GF-SKT'))).toBe(true);
    const r = run('circuit_results', { project: 'Failing' });
    expect(r.circuits.map((x: { id: string }) => x.id)).toContain('GF-SKT');
    expect(c.circuits.find((x: { circuit: string }) => x.circuit === 'GF-SKT')?.issues.length).toBeGreaterThan(0);
  });
  it('get_panel lists the circuits of one panel', () => {
    const p = run('get_panel', { project: 'Villa', panel: 'smdb-gf' });
    expect(p.id).toBe('SMDB-GF');
    expect(p.circuits.every((c: { panel: string }) => c.panel === 'SMDB-GF')).toBe(true);
    expect(() => run('get_panel', { project: 'Villa', panel: 'NOPE' })).toThrow(/No panel "NOPE"/);
  });
  it('quick calcs give rounded results and reject bad input', () => {
    expect(run('calc_current', { power: 100, unit: 'kW', pf: 0.85 }).currentA).toBeCloseTo(163.68, 1);
    expect(run('calc_transformer', { kva: 1000 })).toMatchObject({ flc: 1391.21 });
    expect(run('calc_cable_size', { current: 100, length: 50 }).status).toBe('ok');
    expect(() => run('calc_voltage_drop', { current: 10 })).toThrow(/length/);
    expect(() => run('calc_current', { power: 1, nonsense: 2 })).toThrow();
  });
  it('never changes a project file', () => {
    const before = fs.readFileSync(path.join(folder, 'Failing.json'), 'utf-8');
    for (const t of TOOLS.filter((x) => x.usesProject)) {
      try { callTool(t, { project: 'Failing', ...(t.name === 'get_panel' ? { panel: 'MDB-1' } : {}) }, ctx); } catch { /* inputs only */ }
    }
    expect(fs.readFileSync(path.join(folder, 'Failing.json'), 'utf-8')).toBe(before);
  });
});

describe('command line', () => {
  const cli = async (...argv: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = await main([...argv, '--folder', folder], '1.0', { out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  it('parses flags, numbers and positional arguments', () => {
    expect(parseArgs(['panel', 'Villa', 'MDB-1', '--limit', '5', '--json', '--status=all'])).toMatchObject({ command: 'panel', positional: ['Villa', 'MDB-1'], json: true, flags: { limit: 5, status: 'all' } });
  });
  it('check exits 0 when everything passes and 1 on failures', async () => {
    expect((await cli('check', 'Villa')).code).toBe(0);
    const f = await cli('check', 'Failing');
    expect(f.code).toBe(1);
    expect(f.out).toContain('GF-SKT');
  });
  it('prints JSON with --json, and errors with exit code 2', async () => {
    const r = await cli('vd', '--current', '100', '--length', '50', '--csa', '35', '--json');
    expect(JSON.parse(r.out).pct).toBeGreaterThan(0);
    expect((await cli('summary', 'Missing')).code).toBe(2);
    expect((await cli('frobnicate')).code).toBe(2);
  });
});

describe('local API', () => {
  it('serves tools on localhost and refuses other hosts', async () => {
    const server = createApi(ctx, '1.0');
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const tools = await (await fetch(`${base}/api/tools`)).json() as { name: string; input: { type: string } }[];
      expect(tools.map((t) => t.name)).toContain('run_checks');
      expect(tools[0].input.type).toBe('object');
      const s = await (await fetch(`${base}/api/tools/project_summary?project=Villa`)).json() as { name: string };
      expect(s.name).toBe(sampleProject.name);
      const post = await fetch(`${base}/api/tools/calc_transformer`, { method: 'POST', body: JSON.stringify({ kva: 1000 }) });
      expect((await post.json() as { flc: number }).flc).toBe(1391.21);
      expect((await fetch(`${base}/api/tools/get_panel?project=${encodeURIComponent(outside)}&panel=MDB-1`)).status).toBe(400);
      expect((await fetch(`${base}/api/tools/nope`)).status).toBe(404);
      // A page on another site that resolves to 127.0.0.1 (DNS rebinding) sends its own Host name.
      const port = (server.address() as AddressInfo).port;
      const status = await new Promise<number | undefined>((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/api/tools', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
      });
      expect(status).toBe(403);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('MCP server', () => {
  it('lists read-only tools and answers a call', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcp(ctx, '1.0');
    const client = new Client({ name: 'test', version: '1.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    const res = await client.callTool({ name: 'run_checks', arguments: { project: 'Failing' } });
    const body = JSON.parse((res.content as { text: string }[])[0].text) as { fail: number };
    expect(body.fail).toBeGreaterThan(0);
    const bad = await client.callTool({ name: 'get_panel', arguments: { project: 'Villa', panel: 'NOPE' } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
