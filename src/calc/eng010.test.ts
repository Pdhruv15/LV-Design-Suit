import { describe, expect, it } from 'vitest';
import { PFC_CALC_DEFAULT, calcPfc, phasorSvg, powerTriangleSvg, type PfcCalcInput } from './pfcCalc';
import { pfcReportHtml } from '../docs/pfcReport';
import { sampleProject } from '../data/sampleProject';

/** ENG-010: a leading load keeps its signed Q when no correction is applied. */
const bill = (kwh: number, kvarh: number, extra: Partial<PfcCalcInput> = {}): PfcCalcInput => ({ ...PFC_CALC_DEFAULT, mode: 'bill', kwh, kvarh, hours: 720, voltageV: 400, targetPf: 0.95, ...extra });

describe('ENG-010: leading reactive power is kept when nothing is applied', () => {
  it('72,000 kWh, −54,000 kvarh, 720 h: 100 kW, −75 kvar — no bank, nothing changes, leading shown', () => {
    const i = bill(72000, -54000);
    const r = calcPfc(i);
    expect(r.p).toBeCloseTo(100, 9);
    expect(r.q1).toBeCloseTo(-75, 9);
    expect([r.bankKvar, r.activeKvar]).toEqual([0, 0]);
    expect(r.q2).toBeCloseTo(-75, 9);
    expect(r.s2).toBeCloseTo(125, 9);
    expect(r.pf1).toBeCloseTo(0.8, 9);
    expect(r.pf2).toBeCloseTo(0.8, 9);
    expect([r.leading1, r.leading2]).toEqual([true, true]);
    expect(r.i1).toBeCloseTo(180.421959, 5);
    expect(r.i2).toBeCloseTo(180.421959, 5);
    expect(r.releasedKva).toBeCloseTo(0, 12);
    expect(r.lossReductionPct).toBeCloseTo(0, 12);
    expect(r.phi1Deg).toBeCloseTo(-36.869898, 5);
    expect(r.phi2Deg).toBeCloseTo(-36.869898, 5);
    const w = r.warnings.join(' ');
    expect(w).toMatch(/net leading .* Capacitors add leading kvar, so none is selected and nothing changes/);
    expect(w).toMatch(/averages over the period/);
    expect(w).not.toMatch(/keep it from going leading|bank .* more than the load/);
    const html = pfcReportHtml(sampleProject, i, r);
    expect(html).toMatch(/not applicable — the load is leading \(PF 0\.800 leading\)/);
    expect(html).toMatch(/0\.800 leading<\/td><td class="n">0\.800 leading/);
    expect(html).not.toMatch(/→ 1\.000/);
    expect(powerTriangleSvg(r)).toMatch(/leading \(capacitive\)/);
    expect(phasorSvg(r, 400)).toMatch(/I leads V/);
  });

  it('zero bank changes nothing for an already-good lagging load and for unity', () => {
    for (const r of [calcPfc({ ...PFC_CALC_DEFAULT, mode: 'kw-pf', kw: 100, pf: 0.97, targetPf: 0.95 }), calcPfc(bill(72000, 0))]) {
      expect(r.bankKvar).toBe(0);
      expect(r.q2).toBeCloseTo(r.q1, 12);
      expect(r.pf2).toBeCloseTo(r.pf1, 12);
      expect(r.i2).toBeCloseTo(r.i1, 12);
      expect(r.releasedKva).toBeCloseTo(0, 12);
      expect(r.leading2).toBe(false);
    }
  });

  it('a lagging bill still sizes a bank in whole steps (ENG-009)', () => {
    const r = calcPfc(bill(72000, 54000, { stepKvar: 25 })); // 100 kW + 75 kvar lagging
    expect(r.leading1).toBe(false);
    expect([r.bankKvar, r.activeKvar, r.targetReached]).toEqual([50, 50, true]);
    expect(r.q2).toBeCloseTo(25, 9);
    expect(r.phi1Deg).toBeCloseTo(36.869898, 5);
    expect(pfcReportHtml(sampleProject, bill(72000, 54000, { stepKvar: 25 }), r)).toMatch(/PF 0\.80 lagging → 0\.970 lagging/);
  });
});
