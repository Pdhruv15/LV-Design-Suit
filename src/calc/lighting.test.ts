import { describe, expect, it } from 'vitest';
import { estimateUf, gridLayout, lumenMethod, roomIndex } from './lighting';

describe('lighting — lumen method', () => {
  it('room index K = L·W ÷ (Hm·(L + W))', () => {
    expect(roomIndex(10, 8, 2.15)).toBeCloseTo(80 / (2.15 * 18), 6);
  });

  it('UF interpolates in K and clamps at the table ends', () => {
    expect(estimateUf(1.5, '533')).toBeCloseTo(0.61, 6);
    expect(estimateUf(1.75, '533')).toBeCloseTo(0.635, 6);
    expect(estimateUf(0.2, '533')).toBeCloseTo(0.37, 6);
    expect(estimateUf(9, '533')).toBeCloseTo(0.79, 6);
  });

  it('grid layout covers n with near-square spacing', () => {
    expect(gridLayout(12, 10, 8)).toEqual({ rows: 3, cols: 4 });
    expect(gridLayout(19, 10, 8)).toEqual({ rows: 4, cols: 5 }); // not 1 × 19
    expect(gridLayout(1, 3, 3)).toEqual({ rows: 1, cols: 1 });
    const g = gridLayout(7, 20, 3);
    expect(g.rows * g.cols).toBeGreaterThanOrEqual(7);
  });

  it('office 10 × 8 m at 500 lx with 3600 lm panels', () => {
    const r = lumenMethod({ lengthM: 10, widthM: 8, ceilingM: 3, workPlaneM: 0.85, suspensionM: 0, targetLux: 500, lumens: 3600, watts: 36, mf: 0.8, reflectance: '753', uf: 0.6 });
    expect(r.required).toBeCloseTo((500 * 80) / (3600 * 0.6 * 0.8), 6); // 23.1
    expect(r.count).toBeGreaterThanOrEqual(24);
    expect(r.achievedLux).toBeGreaterThanOrEqual(500);
    expect(r.wPerM2).toBeCloseTo((r.count * 36) / 80, 6);
    expect(r.ufEstimated).toBe(false);
  });

  it('rejects a luminaire at or below the working plane', () => {
    expect(lumenMethod({ lengthM: 5, widthM: 5, ceilingM: 1, workPlaneM: 0.85, suspensionM: 0.2, targetLux: 300, lumens: 1000, watts: 10, mf: 0.8, reflectance: '533' }).invalid).toBeTruthy();
  });
});
