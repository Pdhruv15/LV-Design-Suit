import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCadDrawing } from '../../src/engines/cad/reader';
import { planFromDrawing } from '../../src/model/cadDrawing';
import { roomBoundaryAt, wallSegments } from '../../src/model/cadBoundary';
import { layerMapFor, roomsFromPlan } from '../../src/model/cadRooms';
import { sampleProject } from '../../src/data/sampleProject';

const read = (name: string) => readCadDrawing(new Uint8Array(readFileSync(path.resolve(__dirname, '../../electron/samples', name))));
const project = { ...sampleProject, cadLayers: undefined };

describe('sample G+1 villa plans (electron/samples)', () => {
  for (const [file, outlined, picked, boards] of [
    ['sample-villa-gf.dxf', ['MAJLIS', 'LIVING', 'DINING', 'KITCHEN', 'MAID ROOM', 'ELECTRICAL ROOM'], [[10500, 2250], [14250, 3350], [6500, 5250]], ['SMDB-GF', 'DB-GF1']],
    ['sample-villa-ff.dxf', ['MASTER BATH', 'BEDROOM 1', 'BATH 2'], [[3500, 9000], [6250, 2250], [10000, 2250], [12750, 9000], [6500, 5250]], ['SMDB-FF']]
  ] as const) {
    it(`${file}: outlined rooms are found and named, the others are found by a click inside`, () => {
      const d = read(file);
      const plan = planFromDrawing(d);
      const roles = layerMapFor(project, plan.layers ?? []);
      expect(roles.find((r) => r.layer === 'A-WALL')?.role).toBe('wall');
      expect(roles.find((r) => r.layer === 'A-DOOR')?.role).toBe('ignore');
      const found = roomsFromPlan(plan, roles, undefined).rooms;
      expect(found.map((r) => r.name.toUpperCase()).sort()).toEqual([...outlined].sort());
      expect(found.every((r) => r.areaM2 > 4)).toBe(true);
      const walls = wallSegments(d, new Set(roles.filter((r) => r.role === 'wall' || r.role === 'room').map((r) => r.layer.toLowerCase())));
      for (const at of picked) {
        const room = roomBoundaryAt(walls, at as [number, number], { gap: 1200, reach: 25000 });
        expect(room, `room around ${at}`).toBeDefined();
        expect(room!.area / 1e6).toBeGreaterThan(5);
        expect(room!.area / 1e6).toBeLessThan(45);
      }
      expect(plan.symbols.map((s) => s.name).sort()).toEqual([...boards].sort());
    });
  }
});
