import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { capacityAtRate, sizeUps, UPS_DEFAULTS, upsLoad, type UpsSystem } from './ups';
import { PV_DEFAULTS, sizePv } from './solar';
import { boardTotals } from './summary';

const ups = (patch: Partial<UpsSystem> = {}): UpsSystem => ({
  ...UPS_DEFAULTS, id: 'u', name: 'UPS-1',
  loads: [{ id: 'a', name: 'Servers', qty: 10, w: 1000, pf: 0.9 }],
  ...patch
});

describe('UPS and battery sizing', () => {
  it('UPS: load with growth at the design loading, covering both kVA and kW', () => {
    const r = sizeUps(sampleProject, ups());
    expect(r.loadKw).toBeCloseTo(10, 6);
    expect(r.loadKva).toBeCloseTo(11.11, 2);
    expect(r.designKva).toBeCloseTo(16.67, 2); // × 1.2 ÷ 0.8
    expect(r.upsKva).toBe(20);
    expect(r.upsKw).toBe(18);
    // A load near unity PF is sized by kW: 30 kW → 45 design kW → 60 kVA × 0.9 = 54 kW (a 40 kVA UPS has 36 kW).
    expect(sizeUps(sampleProject, ups({ loads: [{ id: 'b', name: 'x', qty: 1, w: 24000, pf: 1 }] })).upsKva).toBe(40);
    expect(sizeUps(sampleProject, ups({ loads: [{ id: 'b', name: 'x', qty: 1, w: 25000, pf: 1 }] })).upsKva).toBe(60);
  });

  it('battery: constant power over the backup time, derated for the rate, ageing and margin', () => {
    const r = sizeUps(sampleProject, ups());
    expect(r.dcKw).toBeCloseTo(12 / 0.94, 6);
    expect(r.blocksPerString).toBe(32); // 384 V ÷ 12 V
    expect(r.rate).toBeCloseTo(0.4, 6); // VRLA, 15 min
    const ah = ((12000 / 0.94) * 0.25) / 384 / 0.4 * 1.25 * 1 * 1.1;
    expect(r.requiredAh).toBeCloseTo(ah, 6);
    expect([r.blockAh, r.strings, r.totalBlocks]).toEqual([33, 1, 32]);
    expect(r.energyKwh).toBeCloseTo((33 * 384) / 1000, 6);
    expect(r.dcCurrentMaxA).toBeCloseTo((12000 / 0.94) / (192 * 1.75), 6);
    expect(r.dcBreakerA).toBe(50);
    expect(r.runtimeMin!).toBeGreaterThanOrEqual(15);
    expect(r.runtimeMin!).toBeLessThan(20);
  });

  it('longer backup needs more capacity; Li-ion needs less for short backup; strings in parallel', () => {
    expect(sizeUps(sampleProject, ups({ autonomyMin: 60 })).requiredAh).toBeGreaterThan(sizeUps(sampleProject, ups()).requiredAh);
    expect(capacityAtRate('li-ion', 15)).toBeGreaterThan(capacityAtRate('vrla', 15));
    expect(capacityAtRate('vrla', 45)).toBeCloseTo(0.55, 6);
    const big = sizeUps(sampleProject, ups({ loads: [{ id: 'c', name: 'x', qty: 1, w: 120000, pf: 0.9 }], autonomyMin: 30 }));
    expect(big.strings).toBeGreaterThan(1);
    expect(big.blockAh! * big.strings).toBeGreaterThanOrEqual(big.requiredAh);
  });

  it('a UPS board on the SLD supplies its own demand', () => {
    const b = sampleProject.boards.find((x) => x.upstreamId)!;
    const t = boardTotals(sampleProject, b.id);
    expect(upsLoad(sampleProject, ups({ boardId: b.id })).kw).toBeCloseTo(t.demandKw, 6);
  });
});

describe('Solar PV sizing', () => {
  const r = sizePv(PV_DEFAULTS);

  it('string length from the temperature-corrected panel voltages', () => {
    const tMax = 48 + (25 / 800) * 1000;
    expect(r.tCellMaxC).toBeCloseTo(tMax, 6);
    expect(r.vocColdV).toBeCloseTo(49.6 * (1 - 0.0027 * (10 - 25)), 6);
    // Vmp has its own coefficient (ENG-007); the generic panel has none, so the estimate is used and flagged.
    expect(r.vmpBasis).toBe('estimated');
    expect(r.vmpHotV).toBeCloseTo(41.7 * (1 - 0.004 * (tMax - 25)), 6);
    expect(r.maxPerString).toBe(21); // min(1100 ÷ 51.6, 1000 ÷ 44.2)
    expect(r.minPerString).toBe(7); // 200 ÷ 32.65
    expect(r.perString * r.vocColdV).toBeLessThanOrEqual(1100);
  });

  it('50 kWp target: whole strings, one 50 kW inverter, MPPT current checked', () => {
    expect(r.panels).toBe(91); // 50 kWp ÷ 550 W = 90.9 → 91 = 7 × 13
    expect([r.strings, r.perString]).toEqual([7, 13]);
    expect(r.kwp).toBeCloseTo(50.05, 6);
    expect(r.inverters).toBe(1);
    expect(r.stringsPerMppt).toBe(2);
    expect(r.mpptCurrentA).toBeCloseTo(2 * 14 * 1.25, 6);
    // No datasheet Vmp coefficient: flagged as not verified (ENG-007); with one, nothing to flag.
    expect(r.status).toBe('warn');
    expect(r.notes.join(' ')).toMatch(/MPPT window not verified/);
    expect(sizePv({ ...PV_DEFAULTS, panel: { ...PV_DEFAULTS.panel, betaVmpPct: -0.4 } }).status).toBe('ok');
  });

  it('yield: kWp × peak sun hours × performance ratio', () => {
    const tempLoss = 0.0035 * (35 + 25 - 25);
    const pr = (1 - tempLoss) * 0.95 * 0.98 * 0.985 * 0.99 * 0.982;
    expect(r.prPct).toBeCloseTo(pr * 100, 6);
    expect(r.dailyKwh).toBeCloseTo(50.05 * 5.8 * pr, 6);
    expect(r.annualKwh).toBeCloseTo(r.dailyKwh * 365, 6);
    expect(r.co2Tonnes).toBeCloseTo((r.annualKwh * 0.4) / 1000, 6);
    expect(r.acBreakerA).toBe(100); // 50 kW → 72 A × 1.25 = 90 → 100 A
  });

  it('by roof area rounds down to whole strings; by energy rounds up', () => {
    const area = sizePv({ ...PV_DEFAULTS, mode: 'area', roofAreaM2: 400 });
    expect(area.arrayAreaM2).toBeLessThanOrEqual(400 * 0.6);
    expect(area.panels % area.perString).toBe(0);
    const energy = sizePv({ ...PV_DEFAULTS, mode: 'energy', dailyKwh: 200 });
    expect(energy.dailyKwh).toBeGreaterThanOrEqual(200);
    expect(sizePv({ ...PV_DEFAULTS, inverter: { ...PV_DEFAULTS.inverter, mpptMinV: 900 } }).status).toBe('bad');
  });
});

describe('UPS and PV reports', () => {
  it('print the selections and checks', async () => {
    const { buildUpsReportHtml, buildPvReportHtml } = await import('../docs/upsSolarReport');
    const u = buildUpsReportHtml(sampleProject, [ups()]);
    expect(u).toContain('20 kVA / 18 kW');
    expect(u).toContain('32 × 12 V 33 Ah');
    const p = buildPvReportHtml(sampleProject, PV_DEFAULTS, sizePv(PV_DEFAULTS));
    expect(p).toContain('91 panels = 50.05 kWp');
    expect(p).toContain('7 strings of 13');
    expect(p).not.toContain('class="bad"');
  });
});
