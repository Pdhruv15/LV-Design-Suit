import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';
import { addBuilding, addLevel, findBuilding } from './buildingEdit';

const empty: Project = { ...sampleProject, building: undefined };
const names = (p: Project, b = 'B1') => findBuilding(p, b).levels.map((l) => l.name);

describe('adding buildings and levels', () => {
  it('adds a building with the next free id and no levels; refuses a repeated name or id', () => {
    const { project: p, building } = addBuilding(empty, { name: 'Tower A', use: 'Offices' });
    expect(building).toEqual({ id: 'B1', name: 'Tower A', use: 'Offices', levels: [] });
    expect(addBuilding(p, { name: 'Tower B' }).building.id).toBe('B2');
    expect(() => addBuilding(p, { name: 'tower a' })).toThrow(/already exists/);
    expect(() => addBuilding(p, { name: 'Podium', id: 'B1' })).toThrow(/B1 already exists/);
    expect(() => addBuilding(p, { name: '  ' })).toThrow(/name is empty/);
    expect(findBuilding(p, 'TOWER A').id).toBe('B1');
    expect(() => findBuilding(empty, 'X')).toThrow(/no buildings yet/);
  });

  it('keeps levels bottom to top: basements at the bottom, ground above them, roof on top, others below the roof', () => {
    let p = addBuilding(empty, { name: 'Tower A' }).project;
    for (const [name, kind] of [['Roof', 'roof'], ['Ground', 'ground'], ['B1', 'basement'], ['B2', 'basement'], ['Podium', 'podium'], ['L1–L10', 'typical']] as const) p = addLevel(p, 'Tower A', { name, kind }).project;
    expect(names(p)).toEqual(['B2', 'B1', 'Ground', 'Podium', 'L1–L10', 'Roof']);
    p = addLevel(p, 'B1', { name: 'Mezzanine', kind: 'other', above: 'ground' }).project;
    expect(names(p)).toEqual(['B2', 'B1', 'Ground', 'Mezzanine', 'Podium', 'L1–L10', 'Roof']);
    const levels = findBuilding(p, 'B1').levels;
    expect(levels.find((l) => l.name === 'Ground')).toMatchObject({ id: 'B1-L2', heightM: 4.5 });
    expect(levels.find((l) => l.name === 'Roof')).toMatchObject({ id: 'B1-L1', heightM: 3 });
  });

  it('a typical level can repeat; checks names, ids and the level it goes above', () => {
    const p = addLevel(addBuilding(empty, { name: 'Tower A' }).project, 'B1', { name: 'Ground', kind: 'ground' }).project;
    expect(addLevel(p, 'B1', { name: 'Typical', kind: 'typical', count: 10, heightM: 3.4, grossM2: 900 }).level).toEqual({ id: 'B1-L2', name: 'Typical', kind: 'typical', heightM: 3.4, grossM2: 900, count: 10 });
    expect(() => addLevel(p, 'B1', { name: 'L1', kind: 'other', count: 3 })).toThrow(/Only a typical level/);
    expect(() => addLevel(p, 'B1', { name: 'ground', kind: 'ground' })).toThrow(/already has a level/);
    expect(() => addLevel(p, 'B1', { name: 'L1', kind: 'typical', id: 'B1-L1' })).toThrow(/B1-L1 already exists/);
    expect(() => addLevel(p, 'B1', { name: 'L1', kind: 'typical', above: 'Roof' })).toThrow(/No level "Roof"/);
  });
});
