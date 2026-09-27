import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { cableImpedance, cableSizeText, deratedAmpacityA, evaluateFeeder, groupFactor, selectCableRuns, voltageDropPct } from './electrical';
import { applyRecommendation, recommend } from './sizing';
import { evaluateEarthing } from './earthing';
import { buildMdSheet, applyMdEdits } from '../docs/mdSheet';
import { exportDss } from '../engines/opendss/exportDss';
import type { Feeder, Project } from '../types';

const incGF = sampleProject.feeders.find((f) => f.id === 'INC-GF')!;
const withFeeder = (f: Feeder): Project => ({ ...sampleProject, feeders: sampleProject.feeders.map((x) => (x.id === f.id ? f : x)) });

describe('parallel cables', () => {
  it('two runs: half the impedance and voltage drop, twice the rating less grouping', () => {
    const one = cableImpedance(240, 100);
    const two = cableImpedance(240, 100, 2);
    expect(two.r).toBeCloseTo(one.r / 2, 12);
    expect(two.x).toBeCloseTo(one.x / 2, 12);
    expect(deratedAmpacityA(240, 45, 2)).toBeCloseTo(deratedAmpacityA(240, 45) * 2 * 0.88, 9);
    expect(groupFactor(1)).toBe(1);
    const f2 = { ...incGF, parallel: 2 };
    expect(voltageDropPct(f2, withFeeder(f2))).toBeCloseTo(voltageDropPct(incGF, sampleProject) / 2, 9);
    expect(evaluateFeeder(withFeeder(f2), f2).endFaultKA).toBeGreaterThan(evaluateFeeder(sampleProject, incGF).endFaultKA);
  });

  it('earth fault loop: each run has its own protective conductor', () => {
    const f2 = { ...incGF, parallel: 2 };
    const z1 = evaluateEarthing(sampleProject, incGF).zsOhm;
    const z2 = evaluateEarthing(withFeeder(f2), f2).zsOhm;
    expect(z2).toBeLessThan(z1);
  });

  it('selection goes to parallel runs when one cable is not enough', () => {
    expect(selectCableRuns(150, 30, 415, 4, 0.9, 45, 3, 160)).toEqual({ csaMm2: expect.any(Number), runs: 1 });
    const big = selectCableRuns(900, 60, 415, 4, 0.9, 45, 2, 1000)!;
    expect(big.runs).toBeGreaterThan(1);
    expect(big.csaMm2).toBeGreaterThanOrEqual(50);
    expect(deratedAmpacityA(big.csaMm2, 45, big.runs)).toBeGreaterThanOrEqual(1000);
    expect(selectCableRuns(9000, 60, 415, 4, 0.9, 45, 2, 10000)).toBeNull();
  });

  it('a 1000 A feeder is sized with parallel cables and passes', () => {
    const f: Feeder = { ...incGF, id: 'BIG', feedsBoardId: undefined, name: 'Chiller plant', loadKw: 550, powerFactor: 0.9, demandFactor: 1, lengthM: 50, cableCsaMm2: 240, breakerRatingA: 400 };
    const p = { ...sampleProject, feeders: [...sampleProject.feeders, f] };
    const r = recommend(p, f, 'optimise');
    expect(r.parallel).toBeGreaterThan(1);
    expect(r.note).toMatch(/cables in parallel/);
    const sized = applyRecommendation(f, r);
    const p2 = { ...p, feeders: p.feeders.map((x) => (x.id === 'BIG' ? sized : x)) };
    const e = evaluateFeeder(p2, sized);
    expect([e.ampacityStatus, e.protectionStatus]).toEqual(['ok', 'ok']);
    expect(cableSizeText(sized)).toMatch(new RegExp(`^${sized.parallel} × 4C × ${sized.cableCsaMm2} mm²$`));
  });

  it('shows and takes "2x240" in the connected load form, and exports runs to OpenDSS', () => {
    const s = buildMdSheet(sampleProject, 'MDB-1');
    const y = s.rows.findIndex((r) => r.type === 'feeder' && r.feeder.id === 'INC-GF');
    const { project } = applyMdEdits(sampleProject, s, [{ y, x: s.keys.indexOf('size'), value: '2x240' }]);
    const f = project.feeders.find((x) => x.id === 'INC-GF')!;
    expect([f.parallel, f.cableCsaMm2]).toEqual([2, 240]);
    expect(buildMdSheet(project, 'MDB-1').data[y][s.keys.indexOf('size')]).toBe('2x240');
    const dss = exportDss(project).script;
    expect(dss).toContain('LineCode.cu240_3ph_x2');
  });
});
