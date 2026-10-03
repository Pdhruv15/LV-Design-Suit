import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { sizeUps, UPS_DEFAULTS, type UpsSystem } from './ups';
import { buildUpsReportHtml } from '../docs/upsSolarReport';

/** ENG-013: UPS loading against both its kVA and its kW limit. */
export const ups = (w: number, extra: Partial<UpsSystem> = {}, pf = 1): UpsSystem => ({
  ...UPS_DEFAULTS, id: 'T', name: 'T', loads: [{ id: 'L', name: 'Load', qty: 1, w, pf }], growthPct: 0, maxLoadingPct: 100, outputPf: 0.8, autonomyMin: 5, ...extra
});
const p = sampleProject;

describe('ENG-013: UPS loading by kVA and by kW', () => {
  it('96 kW at PF 1 on 120 kVA / 96 kW: 80 % of kVA, 100 % of kW → 100 %, governed by kW', () => {
    const r = sizeUps(p, ups(96000));
    expect([r.loadKva, r.loadKw]).toEqual([96, 96]);
    expect([r.upsKva, r.upsKw]).toEqual([120, 96]);
    expect(r.loadingKvaPct).toBeCloseTo(80, 9);
    expect(r.loadingKwPct).toBeCloseTo(100, 9);
    expect(r.loadingPct).toBeCloseTo(100, 9);
    expect(r.loadingBy).toBe('kW');
    const html = buildUpsReportHtml(p, [ups(96000)]);
    expect(html).toMatch(/Loading today<\/th><td><b>100 %<\/b> — governed by kW \(80 % of 120 kVA · 100 % of 96 kW\)/);
    expect(html).not.toMatch(/Loading today<\/th><td>80 %/);
  });

  it('600 kW: 800 kVA / 640 kW → 75 % of kVA, 93.75 % of kW', () => {
    const r = sizeUps(p, ups(600000));
    expect([r.upsKva, r.upsKw]).toEqual([800, 640]);
    expect(r.loadingKvaPct).toBeCloseTo(75, 9);
    expect(r.loadingKwPct).toBeCloseTo(93.75, 9);
    expect(r.loadingPct).toBeCloseTo(93.75, 9);
    expect(r.loadingBy).toBe('kW');
  });

  it('kVA-governed: 96 kVA at PF 0.6 on 100 kVA / 80 kW → 96 % of kVA, 72 % of kW', () => {
    const r = sizeUps(p, ups(57600, {}, 0.6)); // 57.6 kW ÷ 0.6 = 96 kVA
    expect(r.loadKva).toBeCloseTo(96, 9);
    expect([r.upsKva, r.upsKw]).toEqual([100, 80]);
    expect(r.loadingKvaPct).toBeCloseTo(96, 9);
    expect(r.loadingKwPct).toBeCloseTo(72, 9);
    expect(r.loadingBy).toBe('kVA');
    expect(r.loadingPct).toBeCloseTo(96, 9);
  });

  it('output PF 1 and a unity-PF load: both ratios equal', () => {
    const r = sizeUps(p, ups(96000, { outputPf: 1 }));
    expect(r.loadingKvaPct).toBeCloseTo(r.loadingKwPct!, 9);
  });

  it('growth changes the selection; today’s loading still uses the actual load', () => {
    const r = sizeUps(p, ups(96000, { growthPct: 25 }));
    expect(r.designKw).toBeCloseTo(120, 9);
    expect(r.upsKva).toBe(160); // 120 kW ÷ 0.8
    expect(r.loadingKwPct).toBeCloseTo((96 / 128) * 100, 9); // actual 96 kW, not 120
    const lim = sizeUps(p, ups(96000, { maxLoadingPct: 80 }));
    expect(lim.loadingKwPct).toBeCloseTo((96 / lim.upsKw!) * 100, 9); // not divided by the 80 % design loading
  });

  it('no UPS large enough: no loading figure, no success; the existing message stays', () => {
    const r = sizeUps(p, ups(5_000_000));
    expect(r.upsKva).toBeUndefined();
    expect(r.loadingPct).toBeUndefined();
    expect(r.loadingKvaPct).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/use UPS modules in parallel/);
    expect(buildUpsReportHtml(p, [ups(5_000_000)])).toMatch(/Loading today<\/th><td>—/);
  });
});
