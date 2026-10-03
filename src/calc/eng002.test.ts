import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';
import { applyRecommendation, recommend } from './sizing';
import { designCurrentA, voltageDropPct } from './electrical';

/** ENG-002: cable selection uses the project's conductor temperature, like the displayed voltage drop. */
const feeder: Feeder = {
  id: 'F1', boardId: 'MDB', name: 'Test load', loadKw: 69.2820323, demandFactor: 1, powerFactor: 1,
  lengthM: 85, cableCsaMm2: 16, cores: 4, breakerRatingA: 125, breakerIcuKa: 50
};
const project = (vdTempC?: number): Project => ({
  ...sampleProject, voltageV: 400, ambientC: 30, vdLimitPct: 4, vdTempC,
  boards: [{ id: 'MDB', name: 'MDB', sourceKva: 1000 }], feeders: [feeder], ties: undefined, trays: undefined, busRisers: undefined
} as Project);

describe('ENG-002: automatic cable selection follows the conductor temperature', () => {
  it('the test load is 100 A', () => {
    expect(designCurrentA(feeder, project(90))).toBeCloseTo(100, 3);
  });
  for (const mode of ['fix', 'optimise'] as const) {
    it(`${mode}: at 90 °C picks 35 mm², which meets the 3.4 % budget at 90 °C`, () => {
      const p = project(90);
      const r = recommend(p, feeder, mode);
      expect(r.cableCsaMm2).toBe(35);
      const applied = applyRecommendation(feeder, r);
      const vd = voltageDropPct(applied, { ...p, feeders: [applied] });
      expect(vd).toBeCloseTo(2.459207, 4);
      expect(vd).toBeLessThanOrEqual(4 * 0.85);
    });
  }
  it('every recommendation meets the selection budget at its own temperature (blank / 70 / 90 °C)', () => {
    for (const t of [undefined, 70, 90]) {
      for (const mode of ['fix', 'optimise'] as const) {
        const p = project(t);
        const applied = applyRecommendation(feeder, recommend(p, feeder, mode));
        expect(voltageDropPct(applied, { ...p, feeders: [applied] })).toBeLessThanOrEqual(4 * 0.85 + 1e-9);
      }
    }
  });
  it('blank temperature keeps the previous selection (25 mm²)', () => {
    expect(recommend(project(undefined), feeder, 'fix').cableCsaMm2).toBe(25);
  });
});
