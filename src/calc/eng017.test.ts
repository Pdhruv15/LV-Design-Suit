import { describe, expect, it } from 'vitest';
import { pfCorrection } from './quick';

describe('ENG-017 quick PFC: no correction means nothing changes', () => {
  it('already above target: 0 kvar, kVA unchanged, 0 % reduction', () => {
    const r = pfCorrection(100, 0.98, 0.95);
    expect(r).toMatchObject({ kvar: 0, needed: false, reductionPct: 0, pfAchieved: 0.98 });
    expect(r.kvaBefore).toBeCloseTo(102.040816, 6);
    expect(r.kvaAfter).toBe(r.kvaBefore); // was 105.263158, −3.16 %
  });
  it('equal PFs and PF 1 with a lower target', () => {
    expect(pfCorrection(100, 0.95, 0.95)).toMatchObject({ kvar: 0, needed: false, reductionPct: 0 });
    expect(pfCorrection(100, 1, 0.9)).toMatchObject({ kvar: 0, kvaBefore: 100, kvaAfter: 100, pfAchieved: 1 });
  });
  it('valid improvement 0.8 → 0.95', () => {
    const r = pfCorrection(100, 0.8, 0.95);
    expect(r.needed).toBe(true);
    expect(r.kvar).toBeCloseTo(42.131589, 6);
    expect(r.kvaBefore).toBeCloseTo(125, 9);
    expect(r.kvaAfter).toBeCloseTo(105.263158, 6);
    expect(r.reductionPct).toBeCloseTo(15.789474, 6);
    // independent: Q after = Q before − kvar, S after = √(P² + Q²)
    expect(Math.hypot(100, 75 - r.kvar)).toBeCloseTo(r.kvaAfter, 6);
  });
  it('zero power, PF out of range, non-finite → invalid, no numbers', () => {
    for (const [kw, a, b] of [[0, 0.8, 0.95], [100, 1.2, 0.95], [100, 0.8, 1.05], [100, 0, 0.95], [100, -0.8, 0.95], [NaN, 0.8, 0.95], [100, 0.8, Infinity]]) {
      const r = pfCorrection(kw, a, b);
      expect(r.invalid).toBeTruthy();
      expect(r.kvar).toBeNaN();
    }
  });
});
