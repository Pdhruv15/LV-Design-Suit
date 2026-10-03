import { describe, expect, it } from 'vitest';
import { PFC_CALC_DEFAULT, calcPfc, powerTriangleSvg, type PfcCalcInput } from './pfcCalc';
import { pfcReportHtml } from '../docs/pfcReport';
import { sampleProject } from '../data/sampleProject';

/** ENG-009: the after-values come from a real switching state of whole steps. */
const run = (kw: number, pf: number, extra: Partial<PfcCalcInput> = {}) => calcPfc({ ...PFC_CALC_DEFAULT, mode: 'kw-pf', kw, pf, targetPf: 0.95, stepKvar: 25, voltageV: 400, ...extra });
const I = (kva: number) => (kva * 1000) / (Math.sqrt(3) * 400);
/** The headline state must be a row of the step table. */
const onTable = (r: ReturnType<typeof calcPfc>) => r.stepTable.find((x) => x.steps === r.activeSteps)!;

describe('ENG-009: achievable compensation from whole switched steps', () => {
  it('10 kW at PF 0.8, 25 kvar steps: the step stays off — nothing changes, target not achievable', () => {
    const r = run(10, 0.8);
    expect(r.q1).toBeCloseTo(7.5, 9);
    expect(r.requiredKvar).toBeCloseTo(4.213159, 5);
    expect([r.bankKvar, r.steps]).toEqual([25, 1]);
    expect([r.activeSteps, r.activeKvar]).toEqual([0, 0]);
    expect(r.targetReached).toBe(false);
    expect(r.q2).toBeCloseTo(7.5, 9);
    expect(r.pf2).toBeCloseTo(0.8, 9);
    expect(r.i2).toBeCloseTo(18.042196, 5);
    expect(r.i2).toBeCloseTo(r.i1, 12);
    expect(r.releasedKva).toBeCloseTo(0, 12);
    expect(r.lossReductionPct).toBeCloseTo(0, 12);
    expect(r.stepTable[1].pf).toBeCloseTo(-0.496139, 5); // the on-state would be leading
    expect(r.stepTable[1].a).toBeCloseTo(29.092167, 5);
    expect(r.warnings.join(' ')).toMatch(/Target 0\.95 not achievable with 25 kvar steps .* stays off/);
    // The suggestion is a smaller step that does reach the target without leading (here 7.5 kvar: Q2 = 0).
    const sug = run(10, 0.8, { stepKvar: r.suggestedStepKvar! });
    expect(r.suggestedStepKvar!).toBeLessThan(25);
    expect(sug.targetReached).toBe(true);
    expect(sug.q2).toBeGreaterThanOrEqual(-1e-9);
    expect(onTable(r).pf).toBeCloseTo(r.pf2, 12);
    const html = pfcReportHtml(sampleProject, { ...PFC_CALC_DEFAULT, mode: 'kw-pf', kw: 10, pf: 0.8, targetPf: 0.95, stepKvar: 25, voltageV: 400 }, r);
    expect(html).toMatch(/0 steps \(0 kvar\) switched in: PF 0\.80 → 0\.800/);
    expect(html).toMatch(/Target 0\.95 not achievable with 25 kvar steps/);
    expect(html).not.toMatch(/→ 1\.000/);
  });

  it('100 kW at PF 0.8: two of two steps give 25 kvar and PF 0.9701425', () => {
    const r = run(100, 0.8);
    expect(r.q1).toBeCloseTo(75, 9);
    expect([r.activeSteps, r.activeKvar, r.targetReached]).toEqual([2, 50, true]);
    expect(r.q2).toBeCloseTo(25, 9);
    expect(r.pf2).toBeCloseTo(0.9701425, 6);
    expect(onTable(r).kva).toBeCloseTo(r.s2, 12);
    expect(powerTriangleSvg(r)).toMatch(/Qc = 50 kvar \(2 × 25\)/);
  });

  it('Q exactly a whole number of steps: unity is reachable', () => {
    const r = run(100, 0.8, { stepKvar: 25, targetPf: 1 });
    expect(r.activeKvar).toBe(75);
    expect(r.q2).toBeCloseTo(0, 9);
    expect(r.pf2).toBeCloseTo(1, 12);
    expect(r.targetReached).toBe(true);
  });

  it('a step larger than Q, and a target that needs leading even with a smaller step', () => {
    const big = run(10, 0.8, { stepKvar: 50 });
    expect(big.activeSteps).toBe(0);
    expect(big.pf2).toBeCloseTo(0.8, 9);
    // Unity needs exactly 7.5 kvar; 5 kvar steps give 2.5 kvar lagging (1 step) or 2.5 kvar leading (2 steps).
    const r = run(10, 0.8, { stepKvar: 5, targetPf: 1 });
    expect(r.targetReached).toBe(false);
    expect(r.activeSteps).toBe(1);
    expect(r.q2).toBeCloseTo(2.5, 9);
    expect(r.pf2).toBeLessThan(1);
    expect(r.q2).toBeGreaterThanOrEqual(0);
  });

  it('400 kW, PF 0.8, target 0.95, 25 kvar steps: 175 kvar switched, 125 kvar left, PF 0.954480', () => {
    const r = run(400, 0.8);
    expect([r.bankKvar, r.activeKvar, r.targetReached]).toEqual([175, 175, true]);
    expect(r.q2).toBeCloseTo(125, 9);
    expect(r.pf2).toBeCloseTo(0.95448, 5);
    expect(r.i2).toBeCloseTo(I(r.s2), 12);
    expect(onTable(r).pf).toBeCloseTo(r.pf2, 12);
  });

  it('other targets show what the configured steps achieve', () => {
    const r = run(10, 0.8);
    const c95 = r.compare.find((c) => c.pf === 0.95)!;
    expect(c95.reached).toBe(false);
    expect(c95.achievedPf).toBeCloseTo(0.8, 9);
  });
});
