import { describe, it, expect } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { sizeUps, UPS_DEFAULTS, type UpsSystem, type BatteryPowerTable } from './ups';
import { buildUpsReportHtml } from '../docs/upsSolarReport';
const system = (patch: Partial<UpsSystem> = {}): UpsSystem => ({ ...UPS_DEFAULTS, id: 'test', name: 'Test UPS', loads: [{ id: 'load', name: 'Load', qty: 1, w: 10000, pf: 1 }], ...patch });
// Synthetic values exercise the algorithm; this is not a manufacturer's product catalogue.
const table: BatteryPowerTable = { model: 'Synthetic <model>', source: 'Test & revision', blockAh: 100, blockV: 12, endCellV: 1.75, temperatureC: 20, points: [{ minutes: 10, wattsPerBlock: 700 }, { minutes: 20, wattsPerBlock: 300 }, { minutes: 30, wattsPerBlock: 200 }] };
describe('manufacturer battery data, lithium limits and recharge', () => {
  it('selects strings using absolute model power and conservatively bounds runtime', () => {
    const r = sizeUps(sampleProject, system({ powerTable: table }));
    expect(r.tableMinutes).toBe(20);
    expect(r.tableWattsPerBlock).toBe(300);
    expect(r.blockAh).toBe(100);
    expect(r.strings).toBe(2);
    expect(r.runtimeMin).toBe(20);
    expect(r.batteryBasis).toBe('manufacturer table');
    expect(sizeUps(sampleProject, system({ powerTable: table, blockAhOptions: [7] })).blockAh).toBe(100);
  });
  it('rejects extrapolation, incompatible voltage, missing source and malformed rows without fallback', () => {
    for (const patch of [{ autonomyMin: 40 }, { blockV: 6 }, { powerTable: { ...table, source: '' } }, { powerTable: { ...table, points: [...table.points].reverse() } }, { powerTable: { ...table, points: [{ minutes: 10, wattsPerBlock: NaN }, ...table.points.slice(1)] } }]) {
      const r = sizeUps(sampleProject, system({ powerTable: table, ...patch }));
      expect(r.batteryIssue).toBeTruthy();
      expect(r.blockAh).toBeUndefined();
      expect(r.runtimeMin).toBeUndefined();
    }
  });
  it('applies SOC reserve once and adds parallel strings for the continuous BMS limit', () => {
    const base = system({ chem: 'li-ion', blockV: 51.2, dcVoltage: 512 });
    const full = sizeUps(sampleProject, base);
    const limited = sizeUps(sampleProject, { ...base, startSocPct: 90, minSocPct: 30, bmsDischargeA: 10 });
    expect(limited.requiredAh).toBeCloseTo(full.requiredAh / 0.6);
    expect(limited.usableEnergyKwh).toBeCloseTo(limited.energyKwh * 0.6);
    expect(limited.strings).toBe(3);
    expect(limited.stringCurrentA).toBeLessThanOrEqual(10);
    expect(limited.bmsOk).toBe(true);
    expect(limited.runtimeMin!).toBeGreaterThanOrEqual(base.autonomyMin);
    for (const p of [{ startSocPct: 20, minSocPct: 30 }, { startSocPct: 110 }, { bmsDischargeA: 0 }, { endModuleV: 60 }]) expect(sizeUps(sampleProject, { ...base, ...p }).blockAh).toBeUndefined();
  });
  it('subtracts concurrent charger load and includes efficiency and absorption allowance', () => {
    const s = system({ chargerCurrentA: 20, rechargeLoadA: 5, rechargeFromSocPct: 20, rechargeToSocPct: 90, chargeEfficiencyPct: 90, absorptionHours: 2 });
    const r = sizeUps(sampleProject, s);
    expect(r.rechargeNetA).toBe(15);
    expect(r.rechargeHours).toBeCloseTo(r.blockAh! * r.strings * 0.7 / (15 * 0.9) + 2);
    for (const p of [{ rechargeLoadA: 20 }, { rechargeFromSocPct: 100 }, { chargeEfficiencyPct: 0 }]) {
      const invalid = sizeUps(sampleProject, { ...s, ...p });
      expect(invalid.rechargeHours).toBeUndefined();
      expect(invalid.rechargeIssue).toBeTruthy();
    }
  });
  it('exports the entered basis, escaped manufacturer source and recharge assumptions', () => {
    const html = buildUpsReportHtml(sampleProject, [system({ powerTable: table, chargerCurrentA: 20 })]);
    expect(html).toContain('Synthetic &lt;model&gt;');
    expect(html).toContain('Test &amp; revision');
    expect(html).toContain('manufacturer table');
    expect(html).toContain('Bulk + absorption estimate');
  });
});
