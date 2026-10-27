import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCadDrawing } from '../../src/engines/cad/reader';
import { blocksFromDrawing, planFromDrawing, traysFromDrawing } from '../../src/model/cadDrawing';
import { layerMapFor, roomsFromPlan } from '../../src/model/cadRooms';
import { sampleProject } from '../../src/data/sampleProject';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/cad/${name}`, import.meta.url)));

describe('built-in DWG / DXF reader', () => {
  const dxf = readCadDrawing(fixture('plan-tagged.dxf'));

  it('reads DWG 2018 and 2004 to the same plan as the DXF', () => {
    for (const name of ['plan-2018.dwg', 'plan-2004.dwg']) {
      const dwg = readCadDrawing(fixture(name));
      expect(dwg.format).toBe('DWG');
      expect(dwg.units).toBe(4); // millimetres
      expect(planFromDrawing(dwg)).toEqual(planFromDrawing(dxf));
    }
  });

  it('finds rooms, names and areas on the sample plan', () => {
    const plan = planFromDrawing(dxf, { file: 'plan-tagged.dxf' });
    const project = sampleProject;
    const read = roomsFromPlan(plan, layerMapFor(project, plan.layers ?? []), project.cadLength);
    expect(read.rooms.length).toBeGreaterThan(5);
    const majlis = read.rooms.find((r) => /majlis/i.test(r.name));
    expect(majlis?.areaM2).toBeGreaterThan(10);
    expect(majlis?.handle).toMatch(/^[0-9A-F]+$/);
    expect(plan.tags?.some((t) => t.name === 'Guest bedroom' && t.number === 'G.05')).toBe(true);
  });

  it('keeps LVDS tags: linked routes come back as curves and routes', () => {
    const plan = planFromDrawing(readCadDrawing(fixture('plan-2018.dwg')));
    expect(plan.curves).toEqual([expect.objectContaining({ layer: 'E-ROUTE', tag: 'route:F-03', length: 8000 })]);
    expect(traysFromDrawing(dxf).routes).toEqual([{ feederId: 'F-03', points: [[1000, 1000], [9000, 1000]] }]);
  });

  it('returns curves of the layers asked for only', () => {
    expect(planFromDrawing(dxf).curves).toHaveLength(1);
    expect(planFromDrawing(dxf, { curveLayers: ['e-route'] }).curves).toHaveLength(1);
  });

  it('lists blocks with their attributes', () => {
    const blocks = blocksFromDrawing(dxf);
    expect(blocks.length).toBe(48);
    expect(blocks).toContainEqual({ block: 'RM-TAG', attributes: { NAME: 'Guest bedroom', NO: 'G.05' } });
  });

  it('refuses an empty or broken file with a clear message', () => {
    expect(() => readCadDrawing(new Uint8Array())).toThrow(/empty/);
    expect(() => readCadDrawing(new TextEncoder().encode('AC1032 not really a drawing'))).toThrow(/could not be read/);
  });
});
