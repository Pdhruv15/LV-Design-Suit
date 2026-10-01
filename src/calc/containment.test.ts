import { describe, expect, it } from 'vitest';
import { calcContainment, CONTAINMENT_DEFAULT, containmentSvg } from './containment';

const cables = [{ name: 'a', cores: 4, csaMm2: 0, qty: 3, odMm: 20 }];
const base = { ...CONTAINMENT_DEFAULT, cables, sparePct: 0 };

describe('custom containment', () => {
  it('tray width: touching = sum of diameters, spaced = with one diameter between', () => {
    expect(calcContainment({ ...base, layout: 'touching' }).widthMm).toBe(75); // 60 → 75
    expect(calcContainment({ ...base, layout: 'spaced' }).widthMm).toBe(100); // 100
  });
  it('trunking at 45 % space factor', () => {
    const r = calcContainment({ ...base, type: 'trunking', fillPct: 45 });
    expect(r.widthMm * r.heightMm).toBeGreaterThanOrEqual((3 * Math.PI * 100) / 0.45);
    expect(r.fillPct).toBeLessThanOrEqual(45);
  });
  it('conduit: 40 % for three cables, one size up when needed', () => {
    const r = calcContainment({ ...base, type: 'conduit', cables: [{ name: 'w', cores: 1, csaMm2: 0, qty: 3, odMm: 6 }] });
    expect(r.size).toContain('Ø 20 mm');
    expect(r.fillPct).toBeLessThanOrEqual(40);
  });
  it('buried: soil, temperature and grouping factors', () => {
    const t = calcContainment({ ...base, type: 'trench', soilResistivity: 2.5, groundTempC: 20, spacing: 'touching' });
    expect(t.soil!.resistivity).toBeCloseTo(1, 6);
    expect(t.soil!.temp).toBeCloseTo(1, 6);
    expect(t.soil!.group).toBe(0.65);
    const d = calcContainment({ ...base, type: 'ducts' });
    expect(d.runs).toBe(4); // 3 + 1 spare (25 % → at least one)
    expect(containmentSvg(d, { ...base, type: 'ducts' })).toContain('<svg');
  });
  it('looks up diameters from the cable data', () => {
    const r = calcContainment({ ...CONTAINMENT_DEFAULT });
    expect(r.lines.every((l) => l.od > 0)).toBe(true);
  });
});
