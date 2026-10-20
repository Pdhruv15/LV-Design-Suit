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
    const cad = new FakeCad({ '/tmp/a.dxf': [['feeder:F2', 1], ['board:MDB-1', 2], ['feeder:F2', 3], [undefined, 4], ['sheet:1', 5], ['panel:X', 6]] }, 2);
    const session = cad.session();
    await session.open('/x', ['/tmp/a.dxf']);
    expect((await session.linkedEquipment()).map((e) => [e.tag, e.handles.length])).toEqual([['board:MDB-1', 1], ['feeder:F2', 2]]);
  });

  it('redraws only changed equipment and keeps untagged CAD work', async () => {
    const cad = new FakeCad({
      '/tmp/v1.dxf': [['board:MDB-1', 1], ['feeder:F1', 10], ['feeder:F2', 20], ['feeder:F3', 30], ['sheet:1', 99]],
      '/tmp/v2.dxf': [['board:MDB-1', 1], ['feeder:F1', 11], ['feeder:F2', 20], ['feeder:F4', 40], ['sheet:1', 99]]
    });
    const session = cad.session();
    await session.open('/x', ['/tmp/v1.dxf']);
    expect(await session.remember()).toBe(4);
    const drawing = cad.active;
    cad.add(drawing, undefined, 500); // the engineer's own note
    const plan = await session.update('/tmp/v2.dxf');
    expect(plan).toEqual({ changed: ['feeder:F1'], added: ['feeder:F4'], removed: ['feeder:F3'], unchanged: 3 });
    expect(cad.active).toBe(drawing);
    expect(cad.docs.size).toBe(1); // the temporary sheet was closed
    expect(cad.values(drawing)).toEqual([['board:MDB-1', 1], ['feeder:F1', 11], ['feeder:F2', 20], ['feeder:F4', 40], ['sheet:1', 99], [undefined, 500]]);
    // A second update with the same sheet changes nothing.
    expect(await session.update('/tmp/v2.dxf')).toEqual({ changed: [], added: [], removed: [], unchanged: 5 });
  });

  it('keeps a tagged object the engineer edited when its equipment did not change', async () => {
    const cad = new FakeCad({ '/tmp/v1.dxf': [['feeder:F1', 10], ['feeder:F2', 20]], '/tmp/v2.dxf': [['feeder:F1', 11], ['feeder:F2', 20]] });
    const session = cad.session();
    await session.open('/x', ['/tmp/v1.dxf']);
    await session.remember();
    cad.edit(cad.active, 'feeder:F2', 25); // moved in CAD
    expect(await session.update('/tmp/v2.dxf')).toEqual({ changed: ['feeder:F1'], added: [], removed: [], unchanged: 1 });
    expect(cad.values(cad.active)).toEqual([['feeder:F1', 11], ['feeder:F2', 25]]);
  });

  it('refuses a drawing that LV Design Studio did not produce', async () => {
    const cad = new FakeCad({ '/tmp/other.dxf': [[undefined, 1]], '/tmp/v2.dxf': [['feeder:F1', 1]] });
    const session = cad.session();
    await session.open('/x', ['/tmp/other.dxf']);
    await expect(session.update('/tmp/v2.dxf')).rejects.toThrow('no LV Design Studio boards or feeders');
    expect(cad.docs.size).toBe(1);
  });
});

type Spec = [string | undefined, number][];
/** In-memory OpenCADStudio REST API: documents of tagged entities whose only geometry is a number. */
class FakeCad {
  docs = new Map<number, Map<string, { tag?: string; value: number }>>();
  active = 0;
  private nextDoc = 1;
  private nextHandle = 0x100;
  constructor(private files: Record<string, Spec>, private pageSize = 1000) {}

  add(doc: number, tag: string | undefined, value: number) {
    const handle = (this.nextHandle++).toString(16).toUpperCase();
    this.docs.get(doc)!.set(handle, { tag, value });
    return handle;
  }
  edit(doc: number, tag: string, value: number) {
    for (const e of this.docs.get(doc)!.values()) if (e.tag === tag) e.value = value;
  }
  values(doc: number) {
    return [...this.docs.get(doc)!.values()].map((e) => [e.tag, e.value]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }
  private openFile(path: string) {
    const id = this.nextDoc++;
    this.docs.set(id, new Map());
    for (const [tag, value] of this.files[path]) this.add(id, tag, value);
    this.active = id;
  }
  private entity(handle: string, e: { tag?: string; value: number }) {
    const records = e.tag ? [{ application_name: 'LVDS', values: [{ String: e.tag }] }] : [];
    return { handle, type: 'Line', properties: { value: e.value, common: { handle: parseInt(handle, 16), extended_data: { records } } } };
  }
  async request({ route, method = 'GET', body }: { route: string; method?: string; body?: { path?: string; handles?: string[]; document_id?: number } }) {
    if (route === '/ready') return { version: 'fake' };
    if (route === '/state') return { document_id: this.active || null };
    if (route === '/documents' && method === 'POST') { this.openFile(body!.path!); return { ok: true }; }
    const close = route.match(/^\/documents\/(\d+)\?discard=true$/);
    if (close && method === 'DELETE') {
      this.docs.delete(Number(close[1]));
      this.active = [...this.docs.keys()].pop() ?? 0;
      return { result: { closed: true } };
    }
    const page = route.match(/^\/entities\?.*offset=(\d+)/);
    if (page) {
      const all = [...this.docs.get(this.active)!].map(([h, e]) => this.entity(h, e));
      const offset = Number(page[1]);
      const next = offset + this.pageSize < all.length ? { next_offset: offset + this.pageSize } : {};
      return { entities: all.slice(offset, offset + this.pageSize), ...next };
    }
    if (route === '/entities/copy-to') {
      const from = this.docs.get(this.active)!;
      return { result: { created: body!.handles!.map((h) => this.add(body!.document_id!, from.get(h)!.tag, from.get(h)!.value)) } };
    }
    if (route === '/entities' && method === 'DELETE') {
      for (const h of body!.handles!) this.docs.get(this.active)!.delete(h);
      return { result: { erased: body!.handles!.length } };
    }
    return { ok: true };
  }
  session() {
    return new OpenCadRestSession({ portFactory: async () => 1, spawn: (_command: string, args: string[]) => { this.openFile(args[0]); return new FakeChild(); }, request: (r: never) => this.request(r) }) as unknown as {
      open: (executable: string, drawings: string[]) => Promise<unknown>;
      remember: () => Promise<number>;
      update: (sheet: string) => Promise<{ changed: string[]; added: string[]; removed: string[]; unchanged: number }>;
      linkedEquipment: () => Promise<{ tag: string; handles: string[] }[]>;
    };
  }
}
