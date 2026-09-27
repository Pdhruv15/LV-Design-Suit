import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyDrop, canDrop } from '../model/sldEdit';
import { generatorScenario } from './scenario';
import { sizeGenerator } from './sizing';
import { isMotor, motorStartDipPct, runningKva, startingKva, starterOf } from './motor';
import type { Project, StarterType } from '../types';

const pump = sampleProject.feeders.find((f) => f.id === 'MCC-WP')!; // 75 kW, PF 0.86
const withStarter = (s: StarterType): Project => ({
  ...sampleProject,
  boards: sampleProject.boards.map((b) => (b.id === 'MCC-1' ? { ...b, standby: { kva: 200 } } : b)),
  // The fire pump on a VFD, so the water pump is the largest start.
  feeders: sampleProject.feeders.map((f) => (f.id === 'MCC-WP' ? { ...f, starter: s } : f.id === 'MCC-FP' ? { ...f, starter: 'VFD' as const } : f))
});

describe('motor starters', () => {
  it('direct on line by default; starting kVA by starter', () => {
    expect(starterOf(pump)).toBe('DOL');
    expect(startingKva(pump)).toBeCloseTo(6 * runningKva(pump), 9);
    expect(startingKva({ ...pump, starter: 'SD' })).toBeCloseTo(2 * runningKva(pump), 9);
    expect(startingKva({ ...pump, starter: 'SS' })).toBeCloseTo(3 * runningKva(pump), 9);
    expect(startingKva({ ...pump, starter: 'VFD' })).toBeCloseTo(1.2 * runningKva(pump), 9);
    expect(isMotor(pump)).toBe(true);
    expect(isMotor(sampleProject.feeders.find((f) => f.id === 'GF-LTG')!)).toBe(false);
  });

  it('on a 200 kVA set: DOL ≈ 40 %, star-delta ≈ 18 %, soft starter ≈ 25 %, only a VFD is within 15 %', () => {
    const dip = (s: StarterType) => generatorScenario(withStarter(s)).generators[0].largestMotor!.dipPct;
    expect(dip('DOL')).toBeCloseTo(39.5, 0);
    expect(dip('SD')).toBeCloseTo(17.9, 0);
    expect(dip('SS')).toBeCloseTo(24.6, 0);
    expect(dip('VFD')).toBeLessThan(15);
    expect(dip('VFD')).toBeCloseTo(motorStartDipPct(1.2 * runningKva(pump), 200), 9);
  });

  it('the largest start is by starting kVA, not size: a DOL fire pump beats a soft-started bigger pump', () => {
    const p: Project = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.id === 'MCC-WP' ? { ...f, starter: 'SS' as const } : f)) };
    const withGen = { ...p, boards: p.boards.map((b) => (b.id === 'MCC-1' ? { ...b, standby: { kva: 200 } } : b)) };
    expect(sizeGenerator(withGen).largestMotor!.feeder.id).toBe('MCC-FP');
  });

  it('generator sizing reports the largest starting motor and its dip on the recommended set', () => {
    const g = sizeGenerator(withStarter('SS'));
    expect(g.largestMotor!.feeder.id).toBe('MCC-WP');
    expect(g.largestMotor!.startingKva).toBeCloseTo(3 * runningKva(pump), 9);
    expect(g.largestMotor!.dipPct).toBeCloseTo(motorStartDipPct(g.largestMotor!.startingKva, g.recommendedKva!), 9);
  });

  it('a starter from the library goes on a motor only', () => {
    const fd = (feederId: string) => ({ type: 'feeder' as const, feederId });
    expect(canDrop(sampleProject, { kind: 'starter', starter: 'VFD' }, fd('MCC-WP'))).toBe(true);
    expect(canDrop(sampleProject, { kind: 'starter', starter: 'VFD' }, fd('GF-LTG'))).toBe(false);
    const r = applyDrop(sampleProject, { kind: 'starter', starter: 'SD' }, fd('MCC-WP'));
    expect(r.project.feeders.find((f) => f.id === 'MCC-WP')!.starter).toBe('SD');
    expect(r.message).toMatch(/star-delta — starting ≈ 2 × running current/);
  });
});
