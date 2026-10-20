import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { OpenCadRestSession } = require('../electron/openCadRest.cjs') as {
  OpenCadRestSession: new (options: Record<string, unknown>) => {
    open: (executable: string, drawings: string[]) => Promise<{ connected: boolean; version?: string; state: unknown }>;
    linkedEquipment: () => Promise<{ tag: string; handles: string[] }[]>;
  };
};

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  kill() { this.exitCode = 0; this.emit('exit', 0); }
}

describe('OpenCADStudio live REST session', () => {
  it('starts a protected editor session and reuses it for later drawings', async () => {
    const spawns: { command: string; args: string[]; options: { env: Record<string, string> } }[] = [];
    const requests: { route: string; method?: string; body?: unknown; token: string }[] = [];
    const child = new FakeChild();
    const session = new OpenCadRestSession({
      portFactory: async () => 48123,
      spawn: (command: string, args: string[], options: { env: Record<string, string> }) => {
        spawns.push({ command, args, options });
        return child;
      },
      request: async (request: { route: string; method?: string; body?: unknown; token: string }) => {
        requests.push(request);
        if (request.route === '/ready') return { version: '2026.42' };
        if (request.route === '/state') return { document_id: 2, documents: [{ id: 2 }] };
        return { ok: true };
      }
    });

    const first = await session.open('/Applications/OpenCADStudio.app/Contents/MacOS/OpenCADStudio-App', ['/tmp/first.dxf']);
    expect(first.connected).toBe(true);
    expect(first.version).toBe('2026.42');
    expect(spawns).toHaveLength(1);
    expect(spawns[0].args).toEqual(['/tmp/first.dxf', '--http', '48123']);
    expect(spawns[0].options.env.OCS_API_TOKEN).toMatch(/^[a-f0-9]{64}$/);

    await session.open('/ignored', ['/tmp/second.dxf']);
    expect(spawns).toHaveLength(1);
    expect(requests.some((request) => request.route === '/documents' && request.method === 'POST' &&
      (request.body as { path: string }).path === '/tmp/second.dxf')).toBe(true);
    expect(new Set(requests.map((request) => request.token)).size).toBe(1);
  });

  it('lists the boards and feeders tagged in the open drawing, across pages', async () => {
    const xdata: Record<string, unknown> = {
      '1A': { LVDS: ['feeder:F2'] }, '1B': { LVDS: ['board:MDB-1'] }, '1C': { LVDS: ['feeder:F2'] },
      '1D': {}, '1E': { LVDS: ['panel:X'] }, '1F': { OTHER: ['feeder:F9'] }
    };
    const handles = Object.keys(xdata);
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async (request: { route: string; body?: { handles: string[] } }) => {
        if (request.route === '/ready') return { version: '2026.42' };
        if (request.route === '/state') return {};
        const page = request.route.match(/^\/entities\?.*offset=(\d+)/);
        if (page) {
          // Two entities per page, to prove paging follows next_offset.
          const offset = Number(page[1]);
          const next = offset + 2 < handles.length ? { next_offset: offset + 2 } : {};
          return { entities: handles.slice(offset, offset + 2).map((handle) => ({ handle })), ...next };
        }
        if (request.route === '/xdata_get') return { items: request.body!.handles.map((handle) => ({ handle, xdata: xdata[handle] })) };
        return { ok: true };
      }
    });
    await session.open('/x', ['/tmp/a.dxf']);
    expect(await session.linkedEquipment()).toEqual([
      { tag: 'board:MDB-1', handles: ['1B'] },
      { tag: 'feeder:F2', handles: ['1A', '1C'] }
    ]);
  });
});
