import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { OpenCadRestSession, curveLength, curvePoints } = require('../electron/openCadRest.cjs') as {
  curveLength: (entity: unknown) => number;
  curvePoints: (entity: unknown) => [number, number][] | undefined;
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

  it('reads the blocks of the floor plan with their attribute values, across pages', async () => {
    const pages = [
      { entities: [{ handle: '1', block: 'L1', attributes: { CCT: 'DB-GF1/R1' } }, { handle: '2', block: 'DOOR' }], next_offset: 2 },
      { entities: [{ handle: '3', block: 'SKT', attributes: { CCT: 'DB-GF1/Y2', NOTE: 7 } }, { handle: '4' }] }
    ];
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async ({ route }: { route: string }) => {
        if (route === '/ready') return { version: 'x' };
        const m = route.match(/^\/entities\?type=Insert&.*offset=(\d+)/);
        return m ? pages[Number(m[1]) / 2] : {};
      }
    }) as unknown as { open: (e: string, d: string[]) => Promise<unknown>; readBlocks: () => Promise<unknown> };
    await session.open('/x', ['/tmp/plan.dwg']);
    expect(await session.readBlocks()).toEqual([
      { block: 'L1', attributes: { CCT: 'DB-GF1/R1' } }, { block: 'DOOR', attributes: {} }, { block: 'SKT', attributes: { CCT: 'DB-GF1/Y2' } }
    ]);
  });

  it('measures lines, arcs and polylines with arc segments in drawing units', () => {
    const v = (x: number, y: number, bulge = 0) => ({ location: { x, y }, bulge });
    expect(curveLength({ type: 'Line', properties: { start: { x: 0, y: 0 }, end: { x: 3000, y: 4000 } } })).toBe(5000);
    expect(curveLength({ type: 'Arc', properties: { radius: 1000, start_angle: 0, end_angle: Math.PI / 2 } })).toBeCloseTo(1570.8, 1);
    expect(curveLength({ type: 'Arc', properties: { radius: 1000, start_angle: 3 * Math.PI / 2, end_angle: 0 } })).toBeCloseTo(1570.8, 1); // through 0°
    expect(curveLength({ type: 'Polyline2D', properties: { vertices: [v(0, 0), v(30000, 0), v(30000, 40000)] } })).toBe(70000);
    expect(curveLength({ type: 'Polyline', properties: { vertices: [v(0, 0, 1), v(2000, 0)] } })).toBeCloseTo(Math.PI * 1000, 1); // half circle
    expect(curveLength({ type: 'Polyline', properties: { is_closed: true, vertices: [v(0, 0), v(10, 0), v(10, 10)] } })).toBeCloseTo(20 + Math.hypot(10, 10));
    expect(curveLength({ type: 'Polyline2D', properties: { flags: { bits: 1 }, vertices: [v(0, 0), v(10, 0), v(10, 10)] } })).toBeCloseTo(20 + Math.hypot(10, 10));
    expect(curveLength({ type: 'Circle', properties: { radius: 5 } })).toBe(0);
  });

  it('sums the routes linked to each feeder and reports the drawing units', async () => {
    const route = (handle: string, tag: string | undefined, x: number) => ({
      handle, type: 'Line', properties: { start: { x: 0, y: 0 }, end: { x, y: 0 }, common: { extended_data: { records: tag ? [{ application_name: 'LVDS', values: [{ String: tag }] }] : [] } } }
    });
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async ({ route: r }: { route: string }) => {
        if (r === '/ready') return { version: 'x' };
        if (r.startsWith('/entities?detail=full')) return { entities: [route('1', 'route:F1', 1000), route('2', 'route:F1', 500), route('3', 'feeder:F1', 9), route('4', undefined, 7), route('5', 'route:F2', 250)] };
        if (r.startsWith('/sysvars')) return { result: { values: { insunits: 4 } } };
        return {};
      }
    }) as unknown as { open: (e: string, d: string[]) => Promise<unknown>; readRoutes: () => Promise<unknown> };
    await session.open('/x', ['/tmp/plan.dwg']);
    expect(await session.readRoutes()).toEqual({ units: 4, routes: [{ feederId: 'F1', length: 1500, pieces: 2 }, { feederId: 'F2', length: 250, pieces: 1 }] });
  });

  it('links only the selected curves to a feeder, and unlinks them', async () => {
    const calls: { route: string; method?: string; body?: unknown }[] = [];
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async (r: { route: string; method?: string; body?: unknown }) => {
        calls.push(r);
        if (r.route === '/ready') return { version: 'x' };
        if (r.route === '/get_selection') return { result: { entities: [{ handle: 'A', type: 'Polyline2D' }, { handle: 'B', type: 'Line' }, { handle: 'C', type: 'Text' }] } };
        return { ok: true };
      }
    }) as unknown as { open: (e: string, d: string[]) => Promise<unknown>; linkSelection: (id: string) => Promise<unknown> };
    await session.open('/x', ['/tmp/plan.dwg']);
    expect(await session.linkSelection('F1')).toEqual({ linked: 2, skipped: 1 });
    expect(calls.filter((c) => c.method === 'PUT').map((c) => [c.route, c.body])).toEqual([
      ['/entities/A/xdata/LVDS', [{ code: 1000, value: 'route:F1' }]], ['/entities/B/xdata/LVDS', [{ code: 1000, value: 'route:F1' }]]
    ]);
    expect(await session.linkSelection('')).toEqual({ linked: 2, skipped: 1 });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.route)).toEqual(['/entities/A/xdata/LVDS', '/entities/B/xdata/LVDS']);
    await expect(session.linkSelection('bad id')).rejects.toThrow('unusual characters');
  });

  it('reads board symbols, room outlines and texts from the floor plan', async () => {
    const common = (tag?: string) => ({ extended_data: { records: tag ? [{ application_name: 'LVDS', values: [{ String: tag }] }] : [] } });
    const v = (x: number, y: number) => ({ location: { x, y }, bulge: 0 });
    const entities = [
      { handle: '1', type: 'Block Reference', layer: 'E-BOARD', block: 'DB-PANEL', attributes: { Tag: 'DB-GF1' }, position: [22000, 1500, 0], properties: { common: common() } },
      { handle: '2', type: 'Block Reference', layer: 'E-LIGHT', block: 'L1', attributes: { CCT: 'DB-GF1/R1' }, position: [1, 1, 0], properties: { common: common() } },
      { handle: '3', type: 'Circle', layer: 'E-BOARD', bounds: { min: [10, 20, 0], max: [30, 40, 0] }, properties: { common: common('place:MDB-1') } },
      { handle: '4', type: 'Polyline2D', layer: 'A-ROOM', properties: { flags: { bits: 1 }, vertices: [v(0, 0), v(10, 0), v(10, 10)], common: common() } },
      { handle: '5', type: 'Polyline', layer: 'E-CABLE', properties: { is_closed: false, vertices: [v(0, 0), v(10, 0), v(10, 10)], common: common() } },
      { handle: '6', type: 'Text', layer: 'A-ROOM-NAME', position: [5, 5, 0], properties: { value: ' STORE ', common: common() } }
    ];
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async ({ route }: { route: string }) => {
        if (route === '/ready') return { version: 'x' };
        if (route.startsWith('/entities?detail=full')) return { entities };
        if (route.startsWith('/sysvars')) return { result: { values: { insunits: 6 } } };
        if (route === '/state') return { document_id: 1, documents: [{ id: 1 }] };
        return {};
      }
    }) as unknown as { open: (e: string, d: string[]) => Promise<unknown>; readPlan: (o?: { curveLayers?: string[] }) => Promise<unknown>; documentFile: (s: unknown) => string | undefined };
    await session.open('/x', ['/tmp/plan.dwg']);
    // Curves come back only for the layers asked for.
    expect(((await session.readPlan({ curveLayers: ['e-cable'] })) as { curves: unknown[] }).curves).toEqual([
      { layer: 'E-CABLE', points: [[0, 0], [10, 0], [10, 10]], length: 20 }
    ]);
    expect(await session.readPlan()).toEqual({
      units: 6,
      file: 'plan.dwg', // the one drawing opened, the only document open
      places: [{ boardId: 'MDB-1', x: 20, y: 30 }],
      symbols: [{ name: 'DB-GF1', x: 22000, y: 1500 }],
      outlines: [{ layer: 'A-ROOM', handle: '4', points: [[0, 0], [10, 0], [10, 10]] }],
      texts: [{ layer: 'A-ROOM-NAME', x: 5, y: 5, text: 'STORE' }],
      tags: [],
      curves: [], // none asked for, none linked by hand
      fixtures: [{ x: 1, y: 1, cct: 'DB-GF1/R1' }],
      layers: [
        { name: 'A-ROOM', outlines: 1, curves: 0, texts: 0, blocks: 0, hatches: 0 },
        { name: 'A-ROOM-NAME', outlines: 0, curves: 0, texts: 1, blocks: 0, hatches: 0 },
        { name: 'E-BOARD', outlines: 0, curves: 0, texts: 0, blocks: 1, hatches: 0 },
        { name: 'E-CABLE', outlines: 0, curves: 1, texts: 0, blocks: 0, hatches: 0 },
        { name: 'E-LIGHT', outlines: 0, curves: 0, texts: 0, blocks: 1, hatches: 0 }
      ]
    });
    // The drawing's name: from the document list when it has one; unknown when other documents are open too.
    expect(session.documentFile({ document_id: 3, documents: [{ id: 2 }, { id: 3, path: '/plans/GF plan.dwg' }] })).toBe('GF plan.dwg');
    expect(session.documentFile({ document_id: 3, documents: [{ id: 2 }, { id: 3 }] })).toBeUndefined();
  });

  it('marks the selection as a board symbol, and unlinks it', async () => {
    const calls: { route: string; method?: string; body?: unknown }[] = [];
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async (r: { route: string; method?: string; body?: unknown }) => {
        calls.push(r);
        if (r.route === '/ready') return { version: 'x' };
        if (r.route === '/get_selection') return { result: { entities: [{ handle: 'A', type: 'Block Reference' }] } };
        return { ok: true };
      }
    }) as unknown as { open: (e: string, d: string[]) => Promise<unknown>; placeSelection: (id: string) => Promise<unknown> };
    await session.open('/x', ['/tmp/plan.dwg']);
    expect(await session.placeSelection('DB-GF1')).toEqual({ linked: 1 });
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ route: '/entities/A/xdata/LVDS', body: [{ code: 1000, value: 'place:DB-GF1' }] });
    expect(await session.placeSelection('')).toEqual({ linked: 1 });
    expect(calls.some((c) => c.method === 'DELETE' && c.route === '/entities/A/xdata/LVDS')).toBe(true);
  });

  it('samples curves into paths, arcs bulging the right way', () => {
    const v = (x: number, y: number, bulge = 0) => ({ location: { x, y }, bulge });
    expect(curvePoints({ type: 'Line', properties: { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } } })).toEqual([[0, 0], [5, 0]]);
    const ccw = curvePoints({ type: 'Polyline', properties: { vertices: [v(0, 0, 1), v(2000, 0)] } })!;
    const cw = curvePoints({ type: 'Polyline', properties: { vertices: [v(0, 0, -1), v(2000, 0)] } })!;
    const round = (pt: [number, number]) => pt.map((n) => Math.round(n) + 0); // + 0 turns -0 into 0
    const mid = (pts: [number, number][]) => round(pts[Math.floor(pts.length / 2)]);
    expect(mid(ccw)).toEqual([1000, -1000]); // counter-clockwise from (0,0) to (2000,0) passes below
    expect(mid(cw)).toEqual([1000, 1000]);
    expect(round(ccw[ccw.length - 1])).toEqual([2000, 0]);
    const length = ccw.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - ccw[i][0], p[1] - ccw[i][1]), 0);
    expect(length).toBeCloseTo(Math.PI * 1000, -1);
    const arc = curvePoints({ type: 'Arc', properties: { center: { x: 0, y: 0 }, radius: 10, start_angle: 0, end_angle: Math.PI / 2 } })!;
    expect(round(arc[0])).toEqual([10, 0]);
    expect(round(arc[arc.length - 1])).toEqual([0, 10]);
    expect(curvePoints({ type: 'Circle', properties: {} })).toBeUndefined();
  });

  it('reads tray runs and cable routes as paths', async () => {
    const line = (handle: string, tag: string | undefined, x: number) => ({
      handle, type: 'Line', properties: { start: { x: 0, y: 0 }, end: { x, y: 0 }, common: { extended_data: { records: tag ? [{ application_name: 'LVDS', values: [{ String: tag }] }] : [] } } }
    });
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async ({ route }: { route: string }) => {
        if (route === '/ready') return { version: 'x' };
        if (route.startsWith('/entities?detail=full')) return { entities: [line('1', 'tray:A', 100), line('2', 'route:F1', 50), line('3', 'feeder:F1', 9), line('4', undefined, 7)] };
        if (route.startsWith('/sysvars')) return { result: { values: { insunits: 4 } } };
        return {};
      }
    }) as unknown as { open: (e: string, d: string[]) => Promise<unknown>; readTrays: () => Promise<unknown> };
    await session.open('/x', ['/tmp/plan.dwg']);
    expect(await session.readTrays()).toEqual({
      units: 4,
      trays: [{ name: 'A', points: [[0, 0], [100, 0]], length: 100 }],
      routes: [{ feederId: 'F1', points: [[0, 0], [50, 0]] }]
    });
  });

  it('links the selected curves to a tray route by name, in capitals', async () => {
    const calls: { route: string; method?: string; body?: unknown }[] = [];
    const session = new OpenCadRestSession({
      portFactory: async () => 1,
      spawn: () => new FakeChild(),
      request: async (r: { route: string; method?: string; body?: unknown }) => {
        calls.push(r);
        if (r.route === '/ready') return { version: 'x' };
        if (r.route === '/get_selection') return { result: { entities: [{ handle: 'A', type: 'Polyline2D' }, { handle: 'T', type: 'Text' }] } };
        return { ok: true };
      }
    }) as unknown as { open: (e: string, d: string[]) => Promise<unknown>; traySelection: (n: string) => Promise<unknown> };
    await session.open('/x', ['/tmp/plan.dwg']);
    expect(await session.traySelection(' b ')).toEqual({ linked: 1, skipped: 1 });
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ route: '/entities/A/xdata/LVDS', body: [{ code: 1000, value: 'tray:B' }] });
    await expect(session.traySelection('A B')).rejects.toThrow('without spaces');
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
