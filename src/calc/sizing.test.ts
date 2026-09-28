import { describe, expect, it } from 'vitest';
import { applyAllRecommendations, recommend, sizeGenerator, sizePfc, sizeTransformer } from './sizing';
import { evaluateProject } from './electrical';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';

function feeder(over: Partial<Feeder>): Feeder {
  return {
    id: 'F', boardId: 'MDB', name: 'F', loadKw: 100, demandFactor: 1, powerFactor: 0.8, lengthM: 30,
    cableCsaMm2: 95, cores: 4, breakerRatingA: 250, breakerIcuKa: 36, ...over
  };
}

const project = (feeders: Feeder[], extra: Partial<Project> = {}): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [{ id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 }],
  feeders,
  ...extra
});

describe('transformer sizing', () => {
  it('demand × (1 + growth) ÷ max loading → next standard size', () => {
    // 400 kW at pf 0.8 = 500 kVA → × 1.2 ÷ 0.8 = 750 kVA → 800 kVA
    const s = sizeTransformer(project([feeder({ loadKw: 400 })]));
    expect(s.demandKva).toBeCloseTo(500, 6);
    expect(s.designKva).toBeCloseTo(750, 6);
    expect(s.recommendedKva).toBe(800);
    expect(s.adequate).toBe(true); // 1000 kVA installed
  });
});

describe('power factor correction', () => {
  it('Qc = P (tan φ1 − tan φ2), rounded up to 25 kvar', () => {
    // 100 kW at 0.8 → 75 kvar; target 0.95 → 32.87 kvar remaining → 42.13 needed → 50 kvar bank
    const s = sizePfc(project([feeder({})]), 'MDB');
    expect(s.demandKvar).toBeCloseTo(75, 6);
    expect(s.requiredKvar).toBeCloseTo(75 - 100 * Math.tan(Math.acos(0.95)), 6);
    expect(s.bankKvar).toBe(50);
    expect(s.pfAfter).toBeCloseTo(100 / Math.hypot(100, 25), 9); // 0.970
    expect(s.currentAfterA).toBeLessThan(s.currentBeforeA);
  });

  it('needs nothing when already above target', () => {
    const s = sizePfc(project([feeder({ powerFactor: 0.98 })]), 'MDB');
    expect(s.bankKvar).toBe(0);
  });
});

describe('generator sizing', () => {
  it('sizes on essential loads; fire pumps are essential by default', () => {
    const p = project([
      feeder({ id: 'FP', loadKw: 55, powerFactor: 0.86, loadType: 'fire-pump' }),
      feeder({ id: 'LTG', loadKw: 20, powerFactor: 1, essential: true }),
      feeder({ id: 'HVAC', loadKw: 200 })
    ]);
    const g = sizeGenerator(p);
    expect(g.essential.map((f) => f.id)).toEqual(['FP', 'LTG']);
    const q = 55 * Math.tan(Math.acos(0.86));
    expect(g.demandKva).toBeCloseTo(Math.hypot(75, q), 6);
    expect(g.designKva).toBeCloseTo(g.demandKva / 0.8, 6);
    expect(g.recommendedKva).toBe(125);
    expect(g.largestMotor?.feeder.id).toBe('FP');
    expect(g.largestMotor?.startingKva).toBeCloseTo((6 * 55) / 0.86, 6); // direct on line by default
  });
});

describe('breaker and cable selection', () => {
  it('picks In ≥ Ib/0.85, Icu ≥ busbar fault, and a cable with Iz ≥ In', () => {
    const f = feeder({ loadKw: 100, powerFactor: 0.85, breakerRatingA: 100, breakerIcuKa: 10, cableCsaMm2: 16 });
    const r = recommend(project([f]), f);
    // Ib = 163.7 A → /0.85 = 192.6 → 200 A; busbar fault 27.8 kA → 36 kA
    expect(r.ib).toBeCloseTo(163.7, 1);
    expect(r.breakerRatingA).toBe(200);
    expect(r.breakerIcuKa).toBe(36);
    expect(r.breakerType).toBe('MCCB');
    expect(r.cableCsaMm2).toBe(70); // 70 mm²: 253 × 0.87 = 220 A ≥ 200 A
    expect(r.changed).toBe(true);
  });

  it('fix mode keeps adequate values; optimise downsizes them', () => {
    // 36 kA / 250 A / 185 mm² for a small load: all adequate, all oversized.
    const f = feeder({ loadKw: 20, powerFactor: 0.85, breakerRatingA: 250, breakerIcuKa: 50, cableCsaMm2: 185 });
    const fix = recommend(project([f]), f);
    expect([fix.breakerRatingA, fix.breakerIcuKa, fix.cableCsaMm2, fix.changed]).toEqual([250, 50, 185, false]);
    const opt = recommend(project([f]), f, 'optimise');
    expect(opt.breakerRatingA).toBe(40); // Ib 32.7 A / 0.85 = 38.5 → 40 A
    expect(opt.breakerIcuKa).toBe(36);
    expect(opt.breakerType).toBe('C');
    expect(opt.cableCsaMm2).toBeLessThan(185);
    expect(opt.changed).toBe(true);
  });

  it('the sample project needs no changes in fix mode', () => {
    expect(sampleProject.feeders.filter((f) => recommend(sampleProject, f).changed).map((f) => f.id)).toEqual([]);
  });

  it('applying every recommendation leaves no failing feeder', () => {
    const broken: Project = {
      ...sampleProject,
      feeders: sampleProject.feeders.map((f) => ({ ...f, cableCsaMm2: 4, breakerRatingA: 16, breakerIcuKa: 6 }))
    };
    expect(evaluateProject(broken).some((r) => r.status === 'bad')).toBe(true);
    const fixed = applyAllRecommendations(broken);
    expect(evaluateProject(fixed).filter((r) => r.status !== 'ok').map((r) => r.feeder.id)).toEqual([]);
  });
});
