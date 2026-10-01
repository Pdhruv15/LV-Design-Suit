import { describe, expect, it } from 'vitest';
import { calcPfc, loadOf, PFC_CALC_DEFAULT, powerTriangleSvg, phasorSvg, stepsSvg } from './pfcCalc';

const base = { ...PFC_CALC_DEFAULT, mode: 'kw-pf' as const, kw: 400, pf: 0.8, targetPf: 0.95, stepKvar: 25, voltageV: 400 };

describe('standalone power factor correction', () => {
  it('textbook case: 400 kW at 0.80 to 0.95', () => {
    const r = calcPfc(base);
    expect(r.q1).toBeCloseTo(300, 6);
    expect(r.requiredKvar).toBeCloseTo(168.53, 1);
    expect(r.bankKvar).toBe(175);
    expect(r.steps).toBe(7);
    expect(r.pf2).toBeCloseTo(400 / Math.hypot(400, 125), 6);
    expect(r.i1).toBeCloseTo(500000 / (Math.sqrt(3) * 400), 3);
    expect(r.releasedKva).toBeCloseTo(500 - Math.hypot(400, 125), 6);
    expect(r.stepTable.length).toBe(8);
    expect(r.stepTable[r.stepTable.length - 1].pf).toBeGreaterThanOrEqual(0.95);
  });
  it('reads P and Q from kVA, V-I, a bill or a load list', () => {
    expect(loadOf({ ...base, mode: 'kva-pf', kva: 500 }).p).toBeCloseTo(400, 6);
    expect(loadOf({ ...base, mode: 'vi-pf', currentA: 721.7 }).p).toBeCloseTo(400, 0);
    const bill = loadOf({ ...base, mode: 'bill', kwh: 288000, kvarh: 216000, hours: 720 });
    expect(bill.p).toBeCloseTo(400, 6);
    expect(bill.q).toBeCloseTo(300, 6);
    expect(loadOf({ ...base, mode: 'loads', loads: [{ name: 'a', kw: 100, pf: 0.8, qty: 4 }] }).q).toBeCloseTo(300, 6);
  });
  it('detuning from harmonics, and already-good PF needs nothing', () => {
    expect(calcPfc({ ...base, harmonics: 'none' }).detunedPct).toBe(0);
    expect(calcPfc({ ...base, harmonics: 'some' }).detunedPct).toBe(7);
    expect(calcPfc({ ...base, thdIPct: 50 }).detunedPct).toBe(14);
    const ok = calcPfc({ ...base, pf: 0.97 });
    expect(ok.bankKvar).toBe(0);
    expect(ok.warnings.join(' ')).toContain('already');
  });
  it('draws the diagrams', () => {
    const r = calcPfc(base);
    expect(powerTriangleSvg(r)).toContain('Qc = 175 kvar');
    expect(phasorSvg(r, 400)).toContain('I1');
    expect(stepsSvg(r)).toContain('target 0.95');
  });
});

describe('power factor report', async () => {
  const { pfcReportHtml } = await import('../docs/pfcReport');
  const { sampleProject } = await import('../data/sampleProject');
  it('has the triangle, the bank and the before / after', () => {
    const html = pfcReportHtml(sampleProject, { ...base, title: 'MDB-1' });
    for (const t of ['Power triangle', '175 kvar', 'Before and after', 'Other targets', '<svg']) expect(html).toContain(t);
  });
});
