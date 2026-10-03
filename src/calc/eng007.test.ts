import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { PV_DEFAULTS, sizePv, type PvSystem } from './solar';
import { buildPvReportHtml } from '../docs/upsSolarReport';
import type { Project } from '../types';

/** ENG-007: Voc and Vmp each have their own temperature coefficient. */
const pv = (panel: Partial<PvSystem['panel']> = {}, inv: Partial<PvSystem['inverter']> = {}, extra: Partial<PvSystem> = {}): PvSystem => ({
  ...PV_DEFAULTS, mode: 'kwp', targetKwp: 3.3,
  panel: { ...PV_DEFAULTS.panel, ...panel }, inverter: { ...PV_DEFAULTS.inverter, acKw: 3, mpptMinV: 210, ...inv }, ...extra
});
const project = { ...sampleProject, voltageV: 400 } as Project;

describe('ENG-007: separate Voc and Vmp temperature coefficients', () => {
  it('fixture with a supplied Vmp coefficient of −0.40 %/°C', () => {
    const r = sizePv(pv({ betaVmpPct: -0.4 }), 400);
    expect(r.tCellMaxC).toBeCloseTo(79.25, 9);
    expect(r.vmpBasis).toBe('datasheet');
    expect(r.vmpHotV).toBeCloseTo(32.6511, 4);
    expect(6 * r.vmpHotV).toBeCloseTo(195.9066, 4); // six panels: below 210 V
    expect(r.minPerString).toBe(7);
    expect(r.perString).toBe(7);
    expect(r.strings).toBe(1);
    expect(7 * r.vmpHotV).toBeCloseTo(228.5577, 4);
    expect(r.kwp).toBeCloseTo(3.85, 9);
    expect(r.vmpColdV).toBeCloseTo(44.202, 3);
    expect(r.vocColdV).toBeCloseTo(51.6088, 4); // Voc keeps its own −0.27 %/°C
    expect(r.status).not.toBe('bad');
    expect(r.notes.join(' ')).not.toMatch(/not verified/); // the datasheet value is used (the warning here is the fixture's DC/AC ratio)
  });

  it('changing only the Vmp coefficient moves the MPPT results, never the cold Voc', () => {
    const a = sizePv(pv({ betaVmpPct: -0.2 }), 400), b = sizePv(pv({ betaVmpPct: -0.6 }), 400);
    expect(a.vocColdV).toBe(b.vocColdV);
    expect(a.maxPerString).toBe(b.maxPerString); // set by Voc here
    expect(a.vmpHotV).toBeGreaterThan(b.vmpHotV);
    expect(a.minPerString).toBeLessThan(b.minPerString);
  });

  it('cold MPPT maximum, hot MPPT minimum and no length that fits', () => {
    // A tight MPPT maximum: the cold Vmp sets the longest string (not the Voc limit).
    const cold = sizePv(pv({ betaVmpPct: -0.4 }, { mpptMaxV: 300 }), 400);
    expect(cold.maxPerString).toBe(Math.floor(300 / cold.vmpColdV)); // 6 < 1100 ÷ 51.6
    // Hot minimum and cold maximum leave no whole string: the design fails.
    const none = sizePv(pv({ betaVmpPct: -0.4 }, { mpptMinV: 230, mpptMaxV: 300 }), 400);
    expect(none.minPerString).toBeGreaterThan(none.maxPerString);
    expect(none.status).toBe('bad');
    expect(none.notes.join(' ')).toMatch(/No string length fits/);
  });

  it('legacy project without a Vmp coefficient: estimated and visible, not upgraded by defaults', () => {
    const legacy = { ...pv(), panel: { ...PV_DEFAULTS.panel } };
    delete (legacy.panel as { betaVmpPct?: number }).betaVmpPct;
    // As the Solar page merges saved data with the defaults:
    const merged: PvSystem = { ...PV_DEFAULTS, ...legacy, panel: { ...PV_DEFAULTS.panel, ...legacy.panel } };
    expect(merged.panel.betaVmpPct).toBeUndefined();
    const r = sizePv(merged, 400);
    expect(r.vmpBasis).toBe('estimated');
    expect(r.status).not.toBe('ok');
    const html = buildPvReportHtml(project, merged, r);
    expect(html).toMatch(/ESTIMATED: no datasheet Vmp coefficient/);
    expect(html).toMatch(/OK \(estimated\)|Fail \(estimated\)/);
  });

  it('a saved coefficient survives a save / reload and the report uses the same basis', () => {
    const saved = JSON.parse(JSON.stringify(pv({ betaVmpPct: -0.42 }))) as PvSystem;
    const merged: PvSystem = { ...PV_DEFAULTS, ...saved, panel: { ...PV_DEFAULTS.panel, ...saved.panel } };
    expect(merged.panel.betaVmpPct).toBe(-0.42);
    const r = sizePv(merged, 400);
    expect(r.vmpCoeffPct).toBe(-0.42);
    const html = buildPvReportHtml(project, merged, r);
    expect(html).toMatch(/Voc -0.27 %\/°C .* Vmp -0.42 %\/°C \(MPPT window\) \(datasheet\)/);
    expect(r.vmpHotV).toBeCloseTo(41.7 * (1 - 0.0042 * (79.25 - 25)), 9);
    expect(html).toMatch(new RegExp(`${r.perString} × 32\\.2`));
  });
});
