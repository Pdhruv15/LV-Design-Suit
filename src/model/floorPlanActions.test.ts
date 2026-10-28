import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCadDrawing } from '../engines/cad/reader';
import { sampleProject } from '../data/sampleProject';
import { buildingInfoOf } from '../calc/building';
import { placeBoard, toggleCurve, withLinks } from './cadPlanLinks';
import { pickedRoom, planState, putBoards, putLengths, putRooms, putTrays, renameRoom } from './floorPlanActions';
import type { Project } from '../types';

const drawing = readCadDrawing(new Uint8Array(readFileSync(path.resolve(__dirname, '../../tests/fixtures/cad/plan-2018.dwg'))));
const ctx = { drawing, file: 'GF.dwg' };
const level = { building: 'V', level: 'GF' };
const villa: Project = {
  ...sampleProject, cadLayers: undefined, cadRoomTypes: undefined, cadPlanLinks: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: 40 }] }
};
const rooms = (p: Project) => buildingInfoOf(p).rooms;

describe('Floor plan page: picks change the model directly', () => {
  it('adds all found rooms, updating one by name and keeping its ID', () => {
    const s = planState(villa, ctx);
    const { project, ids } = putRooms(villa, s.rooms.rooms, level, s.roles);
    expect(rooms(project)).toHaveLength(s.rooms.rooms.length);
    expect(rooms(project).find((r) => r.id === 'R1')!.areaM2).not.toBe(40);
    expect(ids).toContain('R1');
    expect(project.cadLayers?.length).toBeGreaterThan(0);
  });

  it('adds a picked room as "Room n" when unnamed, then renames it', () => {
    const room = pickedRoom(villa, '', 12.345, 'GF.dwg', level);
    expect(room).toMatchObject({ name: 'Room 2', areaM2: 12.35 });
    const { project, ids } = putRooms(villa, [room], level, []);
    expect(rooms(renameRoom(project, ids[0], 'Store')).find((r) => r.id === ids[0])!.name).toBe('Store');
  });

  it('keeps the outline of a room clicked or traced on the plan, in metres', () => {
    const outline: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];
    const room = pickedRoom(villa, 'Store', 12, 'GF.dwg', level, outline);
    const { project, ids } = putRooms(villa, [room], level, []);
    expect(rooms(project).find((r) => r.id === ids[0])!.outline).toEqual(outline);
  });

  it('sets a feeder length from a route linked by clicking', () => {
    const route = drawing.entities.find((e) => e.l === 'E-CABLE')!.h;
    const linked = withLinks(villa, toggleCurve({ file: 'GF.dwg' }, 'routes', route, 'GF-LTG'));
    const s = planState(linked, ctx);
    const next = putLengths(linked, s.plan, s.roles, ['GF-LTG']);
    const before = villa.feeders.find((f) => f.id === 'GF-LTG')!.lengthM, after = next.feeders.find((f) => f.id === 'GF-LTG')!.lengthM;
    expect(after).not.toBe(before);
    expect(next.feeders.filter((f) => f.id !== 'GF-LTG')).toEqual(linked.feeders.filter((f) => f.id !== 'GF-LTG'));
  });

  it('adds tray route lengths from runs named by clicking', () => {
    const run = drawing.entities.find((e) => e.l === 'E-TRAY' && e.k === 'pline')!.h;
    const linked = withLinks(villa, toggleCurve({ file: 'GF.dwg' }, 'trays', run, 'Z'));
    const s = planState(linked, ctx);
    const next = putTrays(linked, s.linked, s.plan, s.roles, 'Z');
    expect(next.trays?.routes?.find((r) => r.name === 'Z')?.lengthM).toBeGreaterThan(0);
  });

  it('places boards found by their TAG, or placed by clicking', () => {
    const s = planState(villa, ctx);
    const next = putBoards(villa, s.plan, level);
    expect(next.boards.find((b) => b.id === 'DB-GF1')!.planPoint).toBeDefined();
    const placed = withLinks(villa, placeBoard({ file: 'GF.dwg' }, 'MDB-1', { x: 1000, y: 1000 }));
    const s2 = planState(placed, ctx);
    const one = putBoards(placed, s2.plan, level, ['MDB-1']);
    expect(one.boards.find((b) => b.id === 'MDB-1')!.planPoint).toBeDefined();
    expect(one.boards.find((b) => b.id === 'DB-GF1')).toEqual(placed.boards.find((b) => b.id === 'DB-GF1'));
  });
});
