import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { evaluateFeeder } from '../calc/electrical';
import { feederRatio, heatColor } from './heatmap';

describe('SLD colour by result', () => {
  const r = evaluateFeeder(sampleProject, sampleProject.feeders.find((f) => f.id === 'MCC-WP')!);

  it('measures each colouring against its own limit', () => {
    expect(feederRatio(r, 'vd', 4)).toBeCloseTo(r.vdTotalPct / 4, 9);
    expect(feederRatio(r, 'loading', 4)).toBeCloseTo(r.ib / 160, 9);
    expect(feederRatio(r, 'utilisation', 4)).toBeCloseTo(r.ib / r.ampacity, 9);
    expect(feederRatio(r, 'fault', 4)).toBeCloseTo(r.breakerFaultKA / 25, 9);
    expect(feederRatio(r, 'none', 4)).toBeUndefined();
  });

  it('goes green → amber → red, and stays red above the limit', () => {
    expect(heatColor(0.2)).toBe('hsl(130 80% 52%)');
    expect(heatColor(0.5)).toBe('hsl(130 80% 52%)');
    expect(heatColor(0.85)).toBe('hsl(45 80% 52%)');
    expect(heatColor(1)).toBe('hsl(0 80% 58%)');
    expect(heatColor(3)).toBe('hsl(0 80% 58%)');
    const hue = (c: string) => Number(c.match(/hsl\((\d+)/)![1]);
    expect(hue(heatColor(0.7))).toBeLessThan(130);
    expect(hue(heatColor(0.7))).toBeGreaterThan(45);
  });
});

describe('earth fault loop colouring', () => {
  it('green–amber while disconnection is in time, amber for thermal 5 s, red when too slow', async () => {
    const { earthRatio } = await import('./heatmap');
    const { evaluateEarthingAll } = await import('../calc/earthing');
    const all = evaluateEarthingAll(sampleProject);
    for (const e of all) {
      const r = earthRatio(e);
      if (e.status === 'ok') expect(r).toBeLessThan(0.85);
      if (e.status === 'warn') expect(r).toBeGreaterThanOrEqual(0.86);
      if (e.status === 'bad') expect(r).toBeGreaterThanOrEqual(1);
    }
    const base = all[0];
    expect(earthRatio({ ...base, status: 'bad', zsOhm: 0.1, maxZsOhm: 1 })).toBe(1);
    expect(earthRatio({ ...base, status: 'ok', zsOhm: 0.5, maxZsOhm: 1 })).toBe(0.5);
  });
});
