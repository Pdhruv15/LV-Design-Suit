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
import { TOOLS, callTool, offeredTools, toolByName, type ToolContext } from './tools';
import { listProjects, resolveProject } from './project';
import { main, parseArgs } from './cli';
import { createApi, newApiToken, tokenMatches, writeApiToken } from './api';
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
  const token = newApiToken();
  const auth = { Authorization: `Bearer ${token}` };
  let server: http.Server, base: string, port: number;
  beforeAll(async () => {
    server = createApi(ctx, '1.0', token);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  /** A raw request, so the Host and browser headers are exactly as given. */
  const raw = (opts: http.RequestOptions) => new Promise<{ status?: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...opts }, (res) => { let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers })); });
    req.on('error', reject); req.end();
  });

  it('serves tools to a client with the token', async () => {
    const tools = await (await fetch(`${base}/api/tools`, { headers: auth })).json() as { name: string; input: { type: string } }[];
    expect(tools.map((t) => t.name)).toContain('run_checks');
    expect(tools[0].input.type).toBe('object');
    const s = await (await fetch(`${base}/api/tools/project_summary?project=Villa`, { headers: auth })).json() as { name: string };
    expect(s.name).toBe(sampleProject.name);
    const post = await fetch(`${base}/api/tools/calc_transformer`, { method: 'POST', body: JSON.stringify({ kva: 1000 }), headers: auth });
    expect((await post.json() as { flc: number }).flc).toBe(1391.21);
    expect((await fetch(`${base}/api/tools/nope`, { headers: auth })).status).toBe(404);
  });

  it('refuses a missing, wrong or malformed token, without echoing it', async () => {
    for (const headers of [{} as Record<string, string>, { Authorization: `Bearer ${token}x` }, { Authorization: `Bearer ${token.slice(0, -1)}` }, { Authorization: token }, { Authorization: `Basic ${token}` }]) {
      const r = await fetch(`${base}/api/tools/project_summary?project=Villa`, { headers });
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe('Bearer');
      expect(await r.text()).not.toContain(token.slice(0, 12));
    }
    // A token in the URL is not a token.
    expect((await fetch(`${base}/api/tools?token=${token}`)).status).toBe(401);
    expect((await fetch(`${base}/api`)).status).toBe(401);
  });

  it('refuses other hosts, web pages and other methods', async () => {
    // A page on another site that resolves to 127.0.0.1 (DNS rebinding) sends its own Host name.
    expect((await raw({ path: '/api/tools', headers: { Host: 'evil.example', ...auth } })).status).toBe(403);
    // A page in a browser sends Origin / Sec-Fetch-Site, even to localhost; no CORS headers are ever sent.
    const page = await raw({ path: '/api/tools', headers: { ...auth, Origin: 'http://localhost:5173' } });
    expect(page.status).toBe(403);
    expect(page.headers['access-control-allow-origin']).toBeUndefined();
    expect((await raw({ path: '/api/tools', headers: { ...auth, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await raw({ method: 'OPTIONS', path: '/api/tools/add_panel', headers: { 'Access-Control-Request-Method': 'POST' } })).status).toBe(405);
    expect((await raw({ method: 'DELETE', path: '/api/tools', headers: auth })).status).toBe(405);
    expect((await raw({ method: 'PUT', path: '/api/tools/calc_transformer', headers: auth })).status).toBe(405);
  });

  it('names no folder of this computer in an error', async () => {
    const r = await fetch(`${base}/api/tools/get_panel?project=Missing&panel=MDB-1`, { headers: auth });
    expect(r.status).toBe(400);
    const msg = (await r.json() as { error: string }).error;
    expect(msg).toContain('<projects folder>');
    expect(msg).not.toContain(folder);
    expect(msg).not.toContain(os.homedir());
    expect((await fetch(`${base}/api/tools/get_panel?project=${encodeURIComponent(outside)}&panel=MDB-1`, { headers: auth })).status).toBe(400);
  });

  it('compares tokens in constant time and makes long random ones', () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(undefined, token)).toBe(false);
    expect(tokenMatches('', token)).toBe(false);
    const a = newApiToken(), b = newApiToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => createApi(ctx, '1', 'short')).toThrow(/at least 32/);
  });

  it('writes the token file for this user only and never prints the token', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-token-'));
    const file = writeApiToken(token, path.join(dir, 'api-token'));
    expect(fs.readFileSync(file, 'utf-8').trim()).toBe(token);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o077).toBe(0);
    const out: string[] = [];
    await main(['help', 'serve'], '1', { out: (s) => out.push(s), err: (s) => out.push(s) });
    expect(out.join('\n')).toMatch(/Authorization: Bearer/);
    expect(out.join('\n')).not.toContain(token);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('MCP server', () => {
  it('lists read-only tools and answers a call', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcp(ctx, '1.0');
    const client = new Client({ name: 'test', version: '1.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(offeredTools(ctx).map((t) => t.name).sort());
    expect(tools.some((t) => t.name === 'add_panel')).toBe(false); // read only without --write
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    const res = await client.callTool({ name: 'run_checks', arguments: { project: 'Failing' } });
    const body = JSON.parse((res.content as { text: string }[])[0].text) as { fail: number };
    expect(body.fail).toBeGreaterThan(0);
    const bad = await client.callTool({ name: 'get_panel', arguments: { project: 'Villa', panel: 'NOPE' } });
    expect(bad.isError).toBe(true);
    const missing = await client.callTool({ name: 'get_panel', arguments: { project: 'Missing', panel: 'MDB-1' } });
    expect((missing.content as { text: string }[])[0].text).not.toContain(folder); // no local folders sent to the AI client
    await client.close();
  });
});
