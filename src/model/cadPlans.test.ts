import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { levelOfPlan, plansOf, replacePlan, withLevelPlan, withoutLevelPlan } from './cadPlans';

const project = (): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First', kind: 'typical', heightM: 4 }] }], rooms: [] }
});
const GF = { building: 'V', level: 'GF' }, FF = { building: 'V', level: 'FF' };

describe('plans of each level', () => {
  it('lists every level, with its plan once one is set', () => {
    expect(plansOf(project()).map((x) => [x.label, x.file])).toEqual([['Ground', undefined], ['First', undefined]]);
    const p = withLevelPlan(project(), 'A-101.dwg', GF);
    expect(plansOf(p).map((x) => x.file)).toEqual(['A-101.dwg', undefined]);
    expect(levelOfPlan(p, 'a-101.DWG')?.ref).toEqual(GF);
    expect(levelOfPlan(p, 'A-102.dwg')).toBeUndefined();
  });

  it('keeps one plan per level and one level per plan', () => {
    let p = withLevelPlan(project(), 'A-101.dwg', GF);
    p = withLevelPlan(p, 'A-101 rev B.dwg', GF); // a revised plan replaces the level's plan
    expect(p.cadPlans).toEqual([{ ...GF, file: 'A-101 rev B.dwg' }]);
    p = withLevelPlan(p, 'A-101 rev B.dwg', FF); // the file moved to another level
    expect(p.cadPlans).toEqual([{ ...FF, file: 'A-101 rev B.dwg' }]);
    expect(withoutLevelPlan(p, FF).cadPlans).toBeUndefined();
  });

  it('moves what was drawn to the revised plan when a level\'s plan is replaced', () => {
    const items = [{ id: 'S1', kind: 'line' as const, layer: 'LV-SKETCH', pts: [[0, 0], [1, 1]] as [number, number][] }];
    const p = { ...withLevelPlan(project(), 'A-101.dwg', GF), cadSketch: [{ file: 'A-101.dwg', items }] };
    const r = replacePlan(p, 'A-101 rev B.dwg', GF);
    expect(r.replaced).toBe('A-101.dwg');
    expect(r.project.cadPlans).toEqual([{ ...GF, file: 'A-101 rev B.dwg' }]);
    expect(r.project.cadSketch).toEqual([{ file: 'A-101 rev B.dwg', items }]);
    expect(replacePlan(p, 'A-101.dwg', GF).replaced).toBeUndefined(); // the same file: nothing replaced
    expect(replacePlan(project(), 'A-102.dwg', FF)).toEqual({ project: withLevelPlan(project(), 'A-102.dwg', FF) });
  });
});
