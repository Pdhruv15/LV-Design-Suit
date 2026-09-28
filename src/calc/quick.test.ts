import { describe, expect, it } from 'vitest';
import {
  awgToMm2, cableFor, currentFromPower, energy, faultAtCableEnd, faultFromTransformer, kcmilToMm2, mm2ToAwg, motor, nextBreaker, ohm, pfCorrection,
  powerFromCurrent, transformer, triangle, voltageDrop
} from './quick';

describe('quick calculators', () => {
  it('current from power: 3-phase, 1-phase, kVA, HP with efficiency', () => {
    expect(currentFromPower(100, 'kW', 3, 415, 0.85)).toBeCloseTo(163.7, 1);
    expect(currentFromPower(2.3, 'kW', 1, 230, 1)).toBeCloseTo(10, 6);
    expect(currentFromPower(100, 'kVA', 3, 415, 0.5)).toBeCloseTo(139.1, 1); // PF doesn't apply to kVA
    expect(currentFromPower(10, 'HP', 3, 415, 0.85, 0.9)).toBeCloseTo(7457 / (Math.sqrt(3) * 415 * 0.85 * 0.9), 6);
  });

  it('power from current and the power triangle', () => {
    const p = powerFromCurrent(100, 3, 400, 0.8);
    expect(p.kva).toBeCloseTo(69.28, 2);
    expect(p.kw).toBeCloseTo(55.43, 2);
    expect(triangle({ kw: 80, pf: 0.8 })).toMatchObject({ kva: 100, kvar: expect.closeTo(60, 6) });
    expect(triangle({ kw: 80, kvar: 60 })).toMatchObject({ kva: 100, pf: 0.8 });
    expect(triangle({ kva: 100, kvar: 60 }).kw).toBeCloseTo(80, 6);
  });

  it('voltage drop: √3·I·L·(R cosφ + X sinφ) at operating temperature', () => {
    const vd = voltageDrop(100, 100, 35, 3, 415, 0.85);
    expect(vd.volts).toBeCloseTo(Math.sqrt(3) * 100 * 0.1 * (0.524 * 1.2 * 0.85 + 0.08 * Math.sqrt(1 - 0.85 ** 2)), 6);
    expect(vd.pct).toBeCloseTo(2.41, 2);
    expect(voltageDrop(100, 100, 35, 3, 415, 0.85, 2).volts).toBeCloseTo(vd.volts / 2, 6);
  });

  it('breaker and cable for a current: Iz ≥ In ≥ Ib, voltage drop within the limit', () => {
    expect(nextBreaker(163.7)).toBe(200);
    expect(nextBreaker(63)).toBe(63);
    const c = cableFor(163.7, { lengthM: 80, phases: 3, voltageV: 415, pf: 0.85, ambientC: 45, groupFactor: 1, vdLimitPct: 4 });
    expect(c.breakerA).toBe(200);
    expect(c.sel).not.toBeNull();
    expect(c.iz).toBeGreaterThanOrEqual(200);
    expect(c.vd!.pct).toBeLessThanOrEqual(4);
    const grouped = cableFor(163.7, { lengthM: 80, phases: 3, voltageV: 415, pf: 0.85, ambientC: 45, groupFactor: 0.7, vdLimitPct: 4 });
    expect(grouped.sel!.csaMm2 * grouped.sel!.runs).toBeGreaterThan(c.sel!.csaMm2 * c.sel!.runs - 1e-9);
    const single = cableFor(30, { lengthM: 30, phases: 1, voltageV: 230, pf: 1, ambientC: 45, groupFactor: 1, vdLimitPct: 4 });
    expect(single.vd!.pct).toBeLessThanOrEqual(4);
  });

  it('transformer, motor, power factor correction', () => {
    const t = transformer(1000, 415, 5);
    expect(t.flc).toBeCloseTo(1391.2, 1);
    expect(t.faultKA).toBeCloseTo(27.82, 2);
    const m = motor(11, 415, 3, 0.85, 0.9, 'DOL');
    expect(m.flc).toBeCloseTo(11000 / (0.9 * 0.85 * Math.sqrt(3) * 415), 6);
    expect(m.startA).toBeCloseTo(m.flc * 6, 6);
    expect(motor(11, 415, 3, 0.85, 0.9, 'SD').startA).toBeCloseTo(m.flc * 2, 6);
    expect(pfCorrection(100, 0.8, 0.95).kvar).toBeCloseTo(100 * (0.75 - Math.tan(Math.acos(0.95))), 6);
  });

  it('fault level at the end of a cable', () => {
    expect(faultAtCableEnd(25, 415, 95, 0).endKA).toBeCloseTo(25, 6);
    const f = faultAtCableEnd(25, 415, 95, 50);
    expect(f.endKA).toBeLessThan(25);
    expect(f.endKA).toBeGreaterThan(5);
    const t = faultFromTransformer(1000, 5, 415, 240, 0);
    expect(t.endKA).toBeCloseTo(t.startKA, 6);
    expect(t.startKA).toBeCloseTo(27.82, 1);
  });

  it("Ohm's law, energy, wire gauges", () => {
    expect(ohm({ v: 230, i: 10 })).toEqual({ v: 230, i: 10, r: 23, p: 2300 });
    expect(ohm({ p: 2300, r: 23 }).i).toBeCloseTo(10, 6);
    expect(ohm({ i: 2, p: 100 })).toEqual({ v: 50, i: 2, r: 25, p: 100 });
    expect(energy(2, 8, 30, 0.3)).toEqual({ kwh: 480, cost: 144 });
    expect(awgToMm2(10)).toBeCloseTo(5.26, 2);
    expect(mm2ToAwg(5.26)).toBe(10);
    expect(mm2ToAwg(53.5)).toBe(0); // 1/0
    expect(kcmilToMm2(250)).toBeCloseTo(126.7, 1);
  });
});
