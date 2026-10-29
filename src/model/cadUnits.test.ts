import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { planScale, planUnits, withPlanUnit } from './cadUnits';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const project = (): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: {
    buildings: [{ id: 'B', name: 'B', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'L1', name: 'L1', kind: 'typical', heightM: 4 }] }],
    rooms: [
      { id: 'R1', buildingId: 'B', levelId: 'GF', name: 'Hall', type: 'lobby', areaM2: 0.0002, outline: box(0, 0, 0.02, 0.01), source: { app: 'cad', file: 'GF.dwg', sourceId: '2A' } }, // read as mm, drawn in m
      { id: 'R2', buildingId: 'B', levelId: 'GF', name: 'Store', type: 'store', areaM2: 0.00001, outline: box(0, 0, 0.004, 0.0025) }, // picked on the plan (no source)
      { id: 'R3', buildingId: 'B', levelId: 'GF', name: 'Typed', type: 'store', areaM2: 12 }, // typed: no outline
      { id: 'R4', buildingId: 'B', levelId: 'GF', name: 'Other', type: 'store', areaM2: 9, outline: box(0, 0, 3, 3), source: { app: 'cad', file: 'other.dwg' } },
      { id: 'R5', buildingId: 'B', levelId: 'L1', name: 'Office', type: 'office', areaM2: 0.0002, outline: box(0, 0, 0.02, 0.01) }
    ]
  },
  elvDevices: [{ id: 'E1', type: 'smoke-detector', buildingId: 'B', levelId: 'GF', x: 0.005, y: 0.005 }, { id: 'E2', type: 'smoke-detector', buildingId: 'B', levelId: 'L1', x: 0.005, y: 0.005 }]
});

describe('CAD plan units', () => {
  it('uses what the drawing says, a choice over it, and asks when the drawing says nothing', () => {
    expect(planUnits(project(), 'GF.dwg', 4)).toEqual({ declared: 'mm', unit: 'mm', code: 4, needsChoice: false });
    expect(planUnits(project(), 'GF.dwg', 0)).toEqual({ needsChoice: true });
    const chosen = { ...project(), cadPlanUnits: { 'gf.dwg': 'm' as const } };
    expect(planUnits(chosen, 'GF.DWG', 4)).toEqual({ declared: 'mm', chosen: 'm', unit: 'm', code: 6, needsChoice: false });
    expect(planUnits(chosen, 'GF.dwg', 0)).toMatchObject({ unit: 'm', needsChoice: false });
  });

  it('rescales what came from the plan on that level when the units change: outlines, areas and ELV devices', () => {
    const r = withPlanUnit(project(), 'GF.dwg', 4, 'm', { building: 'B', level: 'GF' });
    expect([r.rooms, r.devices]).toEqual([2, 1]);
    const rooms = r.project.building!.rooms;
    expect(rooms.find((x) => x.id === 'R1')).toMatchObject({ areaM2: 200, outline: box(0, 0, 20, 10) });
    expect(rooms.find((x) => x.id === 'R2')!.areaM2).toBe(10);
    expect(rooms.find((x) => x.id === 'R3')!.areaM2).toBe(12); // typed in: not from the plan
    expect(rooms.find((x) => x.id === 'R4')!.areaM2).toBe(9); // from another drawing
    expect(rooms.find((x) => x.id === 'R5')!.areaM2).toBe(0.0002); // another level
    expect(r.project.elvDevices!.map((d) => [d.x, d.y])).toEqual([[5, 5], [0.005, 0.005]]);
    expect(r.project.cadPlanUnits).toEqual({ 'gf.dwg': 'm' });
  });

  it('moves LV points and boards placed on that level with the drawing, not those on other levels', () => {
    const p: Project = {
      ...project(), elvDevices: undefined,
      lvPoints: [{ id: 'P1', type: 'ltg', feederId: 'F1', buildingId: 'B', levelId: 'GF', x: 0.003, y: 0.004 }, { id: 'P2', type: 'ltg', feederId: 'F1', buildingId: 'B', levelId: 'L1', x: 0.003, y: 0.004 }],
      boards: [{ id: 'DB1', name: 'DB1', kind: 'DB', planPoint: { x: 0.002, y: 0.001 }, level: { building: 'B', level: 'GF' } } as Project['boards'][number]]
    };
    const r = withPlanUnit(p, 'GF.dwg', 4, 'm', { building: 'B', level: 'GF' });
    expect(r.devices).toBe(2);
    expect(r.project.lvPoints!.map((d) => [d.x, d.y])).toEqual([[3, 4], [0.003, 0.004]]);
    expect(r.project.boards[0].planPoint).toEqual({ x: 2, y: 1 });
  });

  it('gives the scale to measure with: the choice, the drawing, else millimetres (assumed)', () => {
    expect(planScale(project(), 'GF.dwg', 6)).toEqual({ unit: 'm', factor: 1, label: 'm', assumed: false });
    expect(planScale({ ...project(), cadPlanUnits: { 'gf.dwg': 'cm' } }, 'GF.dwg', 6)).toMatchObject({ unit: 'cm', factor: 0.01, assumed: false });
    expect(planScale(project(), 'GF.dwg', 0)).toEqual({ unit: 'mm', factor: 0.001, label: 'mm', assumed: true });
  });

  it('only records the choice when the units were not known before, or did not change', () => {
    const first = withPlanUnit(project(), 'GF.dwg', 0, 'mm', { building: 'B', level: 'GF' });
    expect([first.rooms, first.devices]).toEqual([0, 0]);
    expect(first.project.building!.rooms.find((x) => x.id === 'R1')!.areaM2).toBe(0.0002); // nothing scaled
    expect(first.project.cadPlanUnits).toEqual({ 'gf.dwg': 'mm' });
    expect(withPlanUnit(project(), 'GF.dwg', 4, 'mm', { building: 'B', level: 'GF' }).rooms).toBe(0);
    // Read as millimetres (assumed) while the drawing said nothing: what was placed is scaled.
    expect(withPlanUnit(project(), 'GF.dwg', 0, 'm', { building: 'B', level: 'GF' }, 'mm').devices).toBe(1);
  });
});
