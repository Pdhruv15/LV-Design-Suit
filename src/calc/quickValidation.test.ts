import { afterEach, describe, expect, it } from 'vitest';
import {
  awgToMm2, cableFor, currentFromPower, energy, faultAtCableEnd, faultFromTransformer,
  kcmilToMm2, mm2ToAwg, motor, nextBreaker, ohm, powerFromCurrent, transformer,
  triangle, voltageDrop, type Phases
} from './quick';
import { setBreakerLists } from './sizing';

const cableOptions = {
  lengthM: 10, phases: 3 as const, voltageV: 415, pf: 0.85,
  ambientC: 30, groupFactor: 1, vdLimitPct: 4
};

afterEach(() => setBreakerLists(null, null));

describe('quick calculator input and selection regressions', () => {
  it('does not report a 0 A breaker or a cable-only fit as a combined selection', () => {
    // Eight 300 mm² runs can carry 4500 A in the reference data, but the
    // breaker catalogue stops at 4000 A. A cable fit alone is insufficient.
    const result = cableFor(4500, cableOptions);
    expect(result.status).toBe('no-breaker');
    expect(result.breakerA).toBeUndefined();
    expect(result.sel).toBeNull();
    expect(result.vd).toBeNull();
    expect(result.message).toMatch(/breaker rating/);
  });

  it('honours the active breaker catalogue and its highest available rating', () => {
    setBreakerLists([63, 100, 250], null);
    expect(cableFor(250, cableOptions)).toMatchObject({ status: 'ok', breakerA: 250 });
    expect(cableFor(251, cableOptions)).toMatchObject({ status: 'no-breaker', sel: null });
    expect(nextBreaker(251)).toBeUndefined();
  });

  it('distinguishes a missing cable fit from a missing breaker', () => {
    const result = cableFor(100, { ...cableOptions, lengthM: 50_000, vdLimitPct: 1 });
    expect(result).toMatchObject({ status: 'no-cable', breakerA: 100, sel: null, vd: null });
    expect(result.message).toMatch(/voltage drop/);
  });

  it('rejects invalid cable inputs and an explicit breaker below the load current', () => {
    for (const options of [
      { ...cableOptions, groupFactor: 0 },
      { ...cableOptions, groupFactor: 1.1 },
      { ...cableOptions, ambientC: 71 },
      { ...cableOptions, ambientC: NaN },
      { ...cableOptions, voltageV: 0 },
      { ...cableOptions, pf: -0.8 },
      { ...cableOptions, lengthM: -1 },
      { ...cableOptions, vdLimitPct: 0 },
      { ...cableOptions, breakerA: 63 },
      { ...cableOptions, breakerA: Infinity }
    ]) {
      const result = cableFor(100, options);
      expect(result.status).toBe('invalid');
      expect(result.sel).toBeNull();
      expect(result.breakerA).toBeUndefined();
      expect(result.message).toBeTruthy();
    }
    expect(cableFor(0, cableOptions).status).toBe('invalid');
    expect(cableFor(Infinity, cableOptions).status).toBe('invalid');
  });

  it('keeps a valid cable selection within breaker ampacity and drop limits', () => {
    const result = cableFor(163.7, { ...cableOptions, lengthM: 80, ambientC: 45, groupFactor: 0.7 });
    expect(result.status).toBe('ok');
    expect(result.breakerA).toBe(200);
    expect(result.sel).not.toBeNull();
    expect(result.iz).toBeGreaterThanOrEqual(200);
    expect(result.vd!.pct).toBeLessThanOrEqual(4);
  });

  it('rejects PF or efficiency outside their physical range rather than clamping', () => {
    for (const pf of [-0.8, 0, 1.2, NaN, Infinity]) {
      expect(currentFromPower(100, 'kW', 3, 415, pf, 1)).toBeNaN();
      expect(motor(11, 415, 3, pf, 0.9, 'DOL').invalid).toBeTruthy();
    }
    for (const efficiency of [-1, 0, 1.2, NaN, Infinity]) {
      expect(currentFromPower(100, 'kW', 3, 415, 0.85, efficiency)).toBeNaN();
      expect(motor(11, 415, 3, 0.85, efficiency, 'DOL').flc).toBeNaN();
    }
  });

  it('requires finite power, positive voltage and supported phases', () => {
    expect(currentFromPower(Infinity, 'kW', 3, 415)).toBeNaN();
    expect(currentFromPower(-1, 'kW', 3, 415)).toBeNaN();
    expect(currentFromPower(10, 'kW', 3, Infinity)).toBeNaN();
    expect(currentFromPower(10, 'kW', 3, 0)).toBeNaN();
    expect(currentFromPower(10, 'kW', 2 as Phases, 415)).toBeNaN();
    expect(nextBreaker(-1)).toBeUndefined();
    expect(nextBreaker(Infinity)).toBeUndefined();
  });

  it('retains valid zero load and ignores PF/efficiency for apparent power', () => {
    expect(currentFromPower(0, 'kW', 3, 415, 1, 1)).toBe(0);
    expect(currentFromPower(100, 'kVA', 3, 415, 0, 0)).toBeCloseTo(100_000 / (Math.sqrt(3) * 415), 8);
    expect(motor(0, 415, 3, 1, 1, 'DOL')).toMatchObject({ flc: 0, inputKw: 0, inputKva: 0, startA: 0 });
  });

  it('rejects negative current and nonpositive voltage in reverse power calculations', () => {
    expect(powerFromCurrent(-10, 3, 415, 0.8).invalid).toBeTruthy();
    expect(powerFromCurrent(-10, 3, -415, 0.8).kw).toBeNaN(); // two negatives cannot produce a valid result
    expect(powerFromCurrent(10, 3, 0, 0.8).invalid).toBeTruthy();
    expect(powerFromCurrent(10, 3, Infinity, 0.8).kva).toBeNaN();
    expect(powerFromCurrent(10, 3, 415, 1.5).invalid).toMatch(/above 1/);
  });

  it('permits PF zero where no division by PF is used', () => {
    expect(powerFromCurrent(0, 3, 415, 0)).toMatchObject({ kw: 0, kva: 0, kvar: 0, pf: 0 });
    const power = powerFromCurrent(100, 3, 415, 0);
    expect(power.kw).toBe(0);
    expect(power.kvar).toBeCloseTo(power.kva, 8);
    expect(triangle({ kva: 100, pf: 0 })).toMatchObject({ kw: 0, kva: 100, kvar: 100, pf: 0 });
    expect(voltageDrop(100, 100, 35, 3, 415, 0).volts).toBeGreaterThan(0);
  });

  it('cannot return a negative drop or a pass-like number for invalid PF or runs', () => {
    for (const pf of [-0.8, 1.1, NaN]) {
      const result = voltageDrop(100, 100, 35, 3, 415, pf);
      expect(result.pct).toBeNaN();
      expect(result.invalid).toBeTruthy();
    }
    for (const runs of [0, -1, 1.5, Infinity]) {
      expect(voltageDrop(100, 100, 35, 3, 415, 0.85, runs).invalid).toBeTruthy();
    }
    expect(voltageDrop(100, 100, 35, 3, 0).volts).toBeNaN();
    expect(voltageDrop(100, -1, 35, 3, 415).volts).toBeNaN();
  });

  it('handles a stale or unknown cable selection without throwing', () => {
    expect(voltageDrop(100, 100, 999, 3, 415).invalid).toMatch(/cable size/);
    expect(faultAtCableEnd(25, 415, 999, 50).invalid).toBeTruthy();
    expect(faultFromTransformer(1000, 5, 415, 999, 50).invalid).toBeTruthy();
  });

  it('retains zero-length drop and the correct parallel-run relationship', () => {
    expect(voltageDrop(100, 0, 35, 3, 415).pct).toBe(0);
    expect(voltageDrop(0, 100, 35, 3, 415).volts).toBe(0);
    const single = voltageDrop(100, 100, 35, 3, 415);
    const two = voltageDrop(100, 100, 35, 3, 415, 0.85, 2);
    expect(two.volts).toBeCloseTo(single.volts / 2, 10);
    expect(two.mvPerAm).toBeCloseTo(single.mvPerAm / 2, 10);
  });

  it('rejects derived overflow so an undefined drop cannot appear to pass its limit', () => {
    // The inputs are individually finite; √3 × current overflows before
    // multiplication by zero length, while a normal length overflows too.
    for (const lengthM of [0, 100]) {
      const result = voltageDrop(1.7e308, lengthM, 35, 3, 415, 0.85);
      expect(result.invalid).toMatch(/finite voltage drop/);
      expect(result.volts).toBeNaN();
      expect(result.pct).toBeNaN();
      expect(result.mvPerAm).toBeNaN();
    }
    expect(voltageDrop(100, 100, 35, 3, Number.MIN_VALUE, 0.85).invalid).toMatch(/finite voltage drop/);
  });

  it('rejects transformer and fault inputs that would yield infinite or invalid results', () => {
    expect(transformer(1000, 415, 0).faultKA).toBeNaN();
    expect(transformer(0, 415, 5).invalid).toBeTruthy();
    expect(transformer(1000, Infinity, 5).invalid).toBeTruthy();
    expect(faultAtCableEnd(0, 415, 95, 50).invalid).toBeTruthy();
    expect(faultAtCableEnd(25, 415, 95, 50, 1.5).invalid).toBeTruthy();
    expect(faultAtCableEnd(25, 415, 95, 50, 1, -5).invalid).toBeTruthy();
    expect(faultFromTransformer(1000, 0, 415, 240, 50).invalid).toBeTruthy();
    expect(faultFromTransformer(1000, 5, 415, 240, -1).invalid).toBeTruthy();
  });

  it('retains source fault current at zero cable length', () => {
    expect(faultAtCableEnd(25, 415, 95, 0).endKA).toBeCloseTo(25, 10);
    const result = faultFromTransformer(1000, 5, 415, 240, 0);
    expect(result.endKA).toBeCloseTo(result.startKA, 10);
  });

  it('rejects invalid or ambiguous Ohm inputs while allowing a known unloaded resistor', () => {
    expect(ohm({ v: -230, i: 10 }).invalid).toBeTruthy();
    expect(ohm({ v: 230, i: Infinity }).invalid).toBeTruthy();
    expect(ohm({ v: 230, r: 0 }).invalid).toBeTruthy();
    expect(ohm({ v: 230, i: 10, r: 23 }).invalid).toBeTruthy();
    expect(ohm({ v: 0, i: 0 }).invalid).toBeTruthy();
    expect(ohm({ v: 230, p: 0 }).invalid).toBeTruthy();
    expect(ohm({ i: 2, p: 0 }).invalid).toBeTruthy();
    expect(ohm({ i: 0, r: 23 })).toEqual({ v: 0, i: 0, r: 23, p: 0 });
    expect(ohm({ p: 0, r: 23 })).toEqual({ v: 0, i: 0, r: 23, p: 0 });
  });

  it('rejects impossible daily hours and preserves valid zero usage or tariff', () => {
    expect(energy(2, 25, 30, 0.3).invalid).toBeTruthy();
    expect(energy(2, 8, 30, -0.3).invalid).toBeTruthy();
    expect(energy(Infinity, 8, 30, 0.3).kwh).toBeNaN();
    expect(energy(2, 24, 30, 0.3)).toEqual({ kwh: 1440, cost: 432 });
    expect(energy(0, 24, 30, 0.3)).toEqual({ kwh: 0, cost: 0 });
    expect(energy(2, 8, 30, 0)).toEqual({ kwh: 480, cost: 0 });
  });

  it('rejects invalid wire magnitudes without converting them into 1/0 AWG', () => {
    expect(mm2ToAwg(0)).toBeNaN();
    expect(mm2ToAwg(-10)).toBeNaN();
    expect(mm2ToAwg(Infinity)).toBeNaN();
    expect(awgToMm2(10.5)).toBeNaN();
    expect(awgToMm2(-4)).toBeNaN();
    expect(kcmilToMm2(-1)).toBeNaN();
    expect(kcmilToMm2(0)).toBe(0);
    expect(mm2ToAwg(53.5)).toBe(0);
  });
});
