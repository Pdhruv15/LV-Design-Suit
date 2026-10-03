import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { sizeUps, UPS_DEFAULTS, type UpsSystem } from './ups';
import { buildUpsReportHtml } from '../docs/upsSolarReport';

const p = sampleProject;
const ups = (extra: Partial<UpsSystem> = {}): UpsSystem => ({
  ...UPS_DEFAULTS, id: 'T', name: 'T', loads: [{ id: 'L', name: 'Load', qty: 1, w: 10000, pf: 1 }], growthPct: 0, autonomyMin: 15, ...extra
});
/** Independent: energy = actual series V × installed Ah; end current = Pdc ÷ end voltage of that string. */
function consistent(r: ReturnType<typeof sizeUps>, s: UpsSystem) {
  const stringV = r.blocksPerString * s.blockV;
  expect(r.stringV).toBeCloseTo(stringV, 9);
  expect(r.energyKwh).toBeCloseTo((stringV * r.blockAh! * r.strings) / 1000, 9);
  const vEnd = s.chem === 'vrla' ? (stringV / 2) * (s.endCellV ?? 1.75) : stringV * (2.8 / 3.2);
  expect(r.dcCurrentMaxA).toBeCloseTo((r.dcKw * 1000) / vEnd, 9);
  expect(r.dcBreakerRequiredA).toBeCloseTo(1.25 * r.dcCurrentMaxA, 9);
}

describe('ENG-018 UPS: battery string voltage vs requested DC bus', () => {
  it('fixture: Li-ion 51.2 V modules on a 384 V bus is flagged; figures are for the 409.6 V string', () => {
    const s = ups({ chem: 'li-ion', dcVoltage: 384, blockV: 51.2, endCellV: undefined });
    const r = sizeUps(p, s);
    expect(r.blocksPerString).toBe(8);
    expect(r.stringV).toBeCloseTo(409.6, 9);
    expect(r.busMismatch).toMatch(/409\.6 V, not the 384 V DC bus/);
    expect(r.dcKw).toBeCloseTo(10.638298, 6);
    expect(r.blockAh).toBe(50);
    expect(r.energyKwh).toBeCloseTo(20.48, 9); // was 19.2
    expect(r.dcCurrentMaxA).toBeCloseTo(29.682751, 6); // was 31.661601
    consistent(r, s);
    const html = buildUpsReportHtml(p, [s]);
    expect(html).not.toContain('384 V = 8 × 51.2 V');
    expect(html).toContain('DC bus (requested)');
    expect(html).toContain('Not valid (DC bus mismatch)');
  });

  it('exact configurations unchanged: 384 V / 12 V = 32 blocks, 512 V / 51.2 V = 10 modules', () => {
    const a = ups(); const ra = sizeUps(p, a);
    expect([ra.blocksPerString, ra.busMismatch]).toEqual([32, undefined]);
    consistent(ra, a);
    const b = ups({ chem: 'li-ion', dcVoltage: 512, blockV: 51.2, endCellV: undefined }); const rb = sizeUps(p, b);
    expect([rb.blocksPerString, rb.busMismatch]).toEqual([10, undefined]);
    consistent(rb, b);
    const html = buildUpsReportHtml(p, [b]);
    expect(html).toContain('512 V = 10 × 51.2 V');
    expect(html).not.toContain('Not valid');
  });

  it('switching chemistry keeps the bus and flags it, never silently compatible', () => {
    // the UpsStudy chemistry handler: li-ion → blockV 51.2, dcVoltage unchanged (384)
    const switched = { ...ups(), chem: 'li-ion' as const, blockV: 51.2, endCellV: undefined };
    const r = sizeUps(p, switched);
    expect(r.busMismatch).toBeTruthy();
    expect(switched.dcVoltage).toBe(384);
    const back = sizeUps(p, { ...switched, chem: 'vrla', blockV: 12, endCellV: 1.75 });
    expect(back.busMismatch).toBeUndefined();
  });

  it('module above the bus, and near half-integer ratios', () => {
    const big = ups({ chem: 'li-ion', dcVoltage: 48, blockV: 51.2, endCellV: undefined });
    const rb = sizeUps(p, big);
    expect(rb.blocksPerString).toBe(1);
    expect(rb.busMismatch).toBeTruthy();
    consistent(rb, big);
    for (const bus of [126, 138]) { // 10.5 and 11.5 × 12 V
      const s = ups({ dcVoltage: bus }); const r = sizeUps(p, s);
      expect(r.busMismatch).toBeTruthy();
      consistent(r, s);
    }
    expect(sizeUps(p, ups({ dcVoltage: 384.0000001 })).busMismatch).toBeUndefined(); // round-off only
  });

  it('bus mismatch is separate from no-fit capacity and no-fit DC breaker', () => {
    const r = sizeUps(p, ups({ chem: 'li-ion', dcVoltage: 384, blockV: 51.2, endCellV: undefined }));
    expect(r.blockAh).toBeDefined();
    expect(r.dcBreakerNoFit).toBe(false);
    const huge = sizeUps(p, { ...ups(), loads: [{ id: 'L', name: 'L', qty: 1, w: 600000, pf: 1 }], autonomyMin: 5, outputPf: 0.8, maxLoadingPct: 100 });
    expect(huge.busMismatch).toBeUndefined();
    expect(huge.dcBreakerNoFit).toBe(true); // ENG-014 kept
  });
});
