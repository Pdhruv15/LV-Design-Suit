// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { INK, openDrawing, SNAP, type CadView } from './cadEngine';

const root = path.resolve(__dirname, '../../..');
const bytes = (rel: string) => new Uint8Array(readFileSync(path.join(root, rel)));
let gf: CadView;

beforeAll(async () => {
  // The desktop app hands the engine over; the same bytes the web version fetches.
  (window as { lvds?: unknown }).lvds = { cadFile: { engine: async () => bytes('electron/cad/lvds_cad_reader_bg.wasm') } };
  gf = await openDrawing('sample-villa-gf.dxf', bytes('electron/samples/sample-villa-gf.dxf'));
});

describe('CAD engine (Rust, WebAssembly)', () => {
  it('opens a DXF with its layers, colours and full extents', () => {
    expect(gf.info.format).toBe('DXF');
    expect(gf.info.units).toBe(4);
    const wall = gf.info.layers.find((l) => l.name === 'A-WALL')!;
    expect(wall.rgb).toBe(0x808080); // colour 8
    expect(gf.info.layers.find((l) => l.name === 'A-ROOM-NAME')!.rgb).toBe(INK); // colour 7
    expect(gf.info.extents.map(Math.round)).toEqual([-100, -1800, 16100, 12100]);
    expect(gf.segs.length).toBe(gf.info.segments * 4);
  });

  it('draws blocks as drawn: lights, sockets and boards expanded, attributes as texts', () => {
    const light = gf.info.layers.findIndex((l) => l.name === 'E-LIGHT');
    expect(gf.segLayers.filter((l) => l === light).length).toBeGreaterThan(1000);
    expect(gf.info.texts.some((t) => t.s === 'SMDB-GF')).toBe(true);
    expect(gf.info.texts.some((t) => t.s === 'MAJLIS' && t.h === 300)).toBe(true);
  });

  it('snaps to endpoints, midpoints, centres and intersections, on shown layers only', () => {
    const on = new Uint8Array(gf.info.layers.length).fill(1);
    expect(Array.from(gf.snap(110, 90, 50, SNAP.endpoint, on))).toEqual([100, 100, SNAP.endpoint]);
    // The inside face of the front wall runs 0–6200 mm (the entrance is at 6200): its midpoint is at 3100.
    expect(Array.from(gf.snap(3120, 120, 60, SNAP.midpoint, on))).toEqual([3100, 100, SNAP.midpoint]);
    // The first living room light (a block) has its circle's centre at 6687.5, 7375.
    expect(Array.from(gf.snap(6700, 7390, 100, SNAP.center, on))).toEqual([6687.5, 7375, SNAP.center]);
    const x = gf.snap(5000 - 50, 4450, 30, SNAP.intersection, on);
    expect(x[2]).toBe(SNAP.intersection);
    const off = on.slice();
    off[gf.info.layers.findIndex((l) => l.name === 'A-WALL')] = 0;
    expect(Array.from(gf.snap(-10, -90, 50, SNAP.endpoint, on))).toEqual([0, -100, SNAP.endpoint]);
    expect(Array.from(gf.snap(-10, -90, 50, SNAP.endpoint, off))).toEqual([]); // the outside face of the wall: only on A-WALL
  });

  it('opens a DWG and refuses a broken file with a clear message', async () => {
    const dwg = await openDrawing('plan.dwg', bytes('tests/fixtures/cad/plan-2018.dwg'));
    expect(dwg.info.format).toBe('DWG');
    expect(dwg.info.segments).toBeGreaterThan(100);
    await expect(openDrawing('x.dwg', new TextEncoder().encode('AC1032 broken'))).rejects.toThrow(/could not be read/);
    await expect(openDrawing('x.txt', new Uint8Array([1]))).rejects.toThrow(/not a DWG or DXF/);
  });

  it('lists the blocks inserted with their attributes, for Loads from CAD', () => {
    const blocks = gf.blocks();
    expect(blocks.filter((b) => b.block === 'L1' && b.attributes.CCT === 'DB-GF1/R1')).toHaveLength(8);
    expect(blocks.find((b) => b.block === 'DB-PANEL' && b.attributes.TAG === 'DB-GF1')).toMatchObject({ layer: 'E-BOARD' });
  });

  it('reads linetypes (with LTSCALE) and hatches: solid ones filled, pattern ones with their lines', async () => {
    const d = await openDrawing('linetypes-hatches.dxf', bytes('tests/fixtures/cad/linetypes-hatches.dxf'));
    expect(d.info.linetypes).toEqual([[], [20, -10]]);
    expect([...d.segLinetypes.slice(0, 2)]).toEqual([1, 0]); // the dashed line, then the plain one
    expect(d.segLinetypes.length).toBe(d.segLayers.length);
    expect(d.info.fills.map((f) => [f.solid, f.loops.length, f.lines.length])).toEqual([[true, 1, 0], [false, 1, 1]]);
    expect(d.info.fills[1].lines[0].angle).toBeCloseTo(Math.PI / 4);
    expect(gf.info.fills).toEqual([]); // the sample villa has none
  });
});

