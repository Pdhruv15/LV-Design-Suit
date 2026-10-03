import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { sizeUps } from './ups';
import { buildUpsReportHtml } from '../docs/upsSolarReport';
import { ups } from './eng013.test';

/** ENG-014: the UPS battery-bus DC breaker is never clamped to the largest listed rating. */
const p = sampleProject;

describe('ENG-014: no suitable UPS DC breaker is reported, not clamped', () => {
  it('600 kW: 1,899.70 A needs 2,374.62 A — no suitable breaker (not 1,600 A), shown on the report', () => {
    const r = sizeUps(p, ups(600000));
    expect([r.upsKva, r.upsKw]).toEqual([800, 640]);
    expect([r.strings, r.blocksPerString, r.blockAh]).toEqual([4, 32, 200]);
    expect(r.dcKw).toBeCloseTo(638.297872, 5);
    expect(r.dcCurrentMaxA).toBeCloseTo(1899.696049, 5);
    expect(r.dcBreakerRequiredA).toBeCloseTo(2374.620061, 5);
    expect(r.dcBreakerA).toBeUndefined();
    expect(r.dcBreakerNoFit).toBe(true);
    expect(r.notes.join(' ')).toMatch(/No suitable DC breaker in the list for the battery bus: 2375 A needed .* largest listed 1600 A/);
    const html = buildUpsReportHtml(p, [ups(600000)]);
    expect(html).toMatch(/No suitable DC breaker in the list — 2,?375 A needed \(1\.25 × I\), largest listed 1600 A/);
    expect(html).not.toMatch(/\/ 1600 A|undefined A/);
  });

  it('a requirement equal to the largest rating fits; just above does not clamp', () => {
    // I = 1,280 A → 1.25 × I = 1,600 A exactly: DC power 1,280 × 336 V = 430.08 kW = load × ÷ 0.94.
    const exact = sizeUps(p, ups(430.08 * 0.94 * 1000));
    expect(exact.dcBreakerRequiredA).toBeCloseTo(1600, 6);
    expect(exact.dcBreakerA).toBe(1600);
    const above = sizeUps(p, ups(430.2 * 0.94 * 1000));
    expect(above.dcBreakerRequiredA).toBeGreaterThan(1600);
    expect(above.dcBreakerA).toBeUndefined();
    expect(above.dcBreakerNoFit).toBe(true);
  });

  it('96 kW (ENG-013 fixture): 303.95 A → 379.94 A → 400 A', () => {
    const r = sizeUps(p, ups(96000));
    expect(r.dcCurrentMaxA).toBeCloseTo(303.951368, 5);
    expect(r.dcBreakerRequiredA).toBeCloseTo(379.93921, 5);
    expect(r.dcBreakerA).toBe(400);
    expect(r.dcBreakerNoFit).toBe(false);
  });

  it('VRLA and Li-ion: the breaker follows each one’s end-of-discharge current', () => {
    const vrla = sizeUps(p, ups(96000, { chem: 'vrla', endCellV: 1.8 }));
    expect(vrla.dcCurrentMaxA).toBeCloseTo((96 / 0.94) * 1000 / ((384 / 2) * 1.8), 6);
    const li = sizeUps(p, ups(96000, { chem: 'li-ion' }));
    expect(li.dcCurrentMaxA).toBeCloseTo((96 / 0.94) * 1000 / (384 * 2.8 / 3.2), 6);
    for (const r of [vrla, li]) expect(r.dcBreakerA!).toBeGreaterThanOrEqual(r.dcBreakerRequiredA - 1e-9);
  });

  it('no-fit UPS, no-fit battery and no-fit DC protection are reported separately', () => {
    const r = sizeUps(p, ups(5_000_000));
    const notes = r.notes.join(' | ');
    expect(r.upsKva).toBeUndefined();
    expect(notes).toMatch(/use UPS modules in parallel/);
    expect(notes).toMatch(/More than 8 strings/);
    expect(notes).toMatch(/No suitable DC breaker in the list/);
  });
});
