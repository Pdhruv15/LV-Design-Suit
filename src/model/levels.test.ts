import { describe, expect, it } from 'vitest';
import type { BuildingInfo, Project } from '../types';
import { sampleProject } from '../data/sampleProject';
import { boardLocation, boardsWithoutLevel, floorList, matchFloor } from './levels';
import { applyPlanEdits, buildPlanSheet } from '../docs/planSheet';

const info: BuildingInfo = {
  rooms: [],
  buildings: [{ id: 'A', name: 'Tower A', levels: [
    { id: 'b1', name: 'B1', kind: 'basement', heightM: 4 },
    { id: 'g', name: 'GF', kind: 'ground', heightM: 4.5 },
    { id: 't', name: 'Typical', kind: 'typical', heightM: 3.6, count: 3 },
    { id: 'r', name: 'Roof', kind: 'roof', heightM: 3 }
  ] }]
};

describe('one list of levels', () => {
  it('expands typical floors with elevations', () => {
    const f = floorList(info);
    expect(f.map((x) => x.tag)).toEqual(['B1', 'G', 'L01', 'L02', 'L03', 'R']);
    expect(f[1].elevationM).toBe(0);
  });
  it('panel location follows a renamed level', () => {
    const b = { ...sampleProject.boards[0], location: 'Elec. room', level: { building: 'A', level: 'g' } };
    const p = { ...sampleProject, building: info, boards: [b, ...sampleProject.boards.slice(1)] } as Project;
    expect(boardLocation(p, b)).toBe('GF · Elec. room');
    const renamed = { ...p, building: { ...info, buildings: [{ ...info.buildings[0], levels: info.buildings[0].levels.map((l) => (l.id === 'g' ? { ...l, name: 'Ground floor' } : l)) }] } };
    expect(boardLocation(renamed, b)).toBe('Ground floor · Elec. room');
    expect(boardsWithoutLevel(p).length).toBe(sampleProject.boards.length - 1);
  });
  it('space planning floors must be a level, and link to it', () => {
    expect(matchFloor(info, '', 'gf')?.ref).toEqual({ building: 'A', level: 'g' });
    const plan = { areas: [], panels: [], transformers: [] } as never;
    const sheet = buildPlanSheet(plan, info);
    const ok = applyPlanEdits(plan, sheet, [{ x: 0, y: 0, value: 'Tower A' }, { x: 1, y: 0, value: 'GF' }, { x: 2, y: 0, value: 'Lobby' }], info);
    expect(ok.plan.areas[0].level).toEqual({ building: 'A', level: 'g' });
    const bad = applyPlanEdits(plan, sheet, [{ x: 1, y: 0, value: 'Level 9' }], info);
    expect(bad.rejected[0]).toContain('not a level');
  });
});
