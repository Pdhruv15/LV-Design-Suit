import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { ambientFactor, busbarTypeFrom, iecDiversity, newRiser, sizeRiser, TYPICAL_BUSBAR_DATA, type BusRiser } from './busbar';
import { buildSection, scopeOf } from '../docs/studyReport';
import type { Project } from '../types';

const tower: BusRiser = { ...newRiser('BR-1', 'MDB-1'), floors: [{ id: 'T', name: 'Typical 1–20', kw: 45, pf: 0.9, count: 20 }] };

describe('busbar riser', () => {
  it('demand with IEC diversity, sized for the feeding breaker after ambient derating', () => {
    const r = sizeRiser(sampleProject, tower);
    expect(r.tapOffs).toBe(20);
    expect(r.diversity).toBe(0.6);
    expect(r.demandKw).toBeCloseTo(540);
    expect(r.designA).toBeCloseTo(834.7, 0);
    expect(r.feederBreakerA).toBe(1000);
    expect(r.type!.ratingA).toBe(1250); // 1000 A ÷ 0.95 → 1053 A
    expect(r.feederBreakerA!).toBeLessThanOrEqual(r.type!.ratingA * r.derate);
    expect(r.currentDensity).toBeCloseTo(r.designA / r.type!.csaMm2);
    expect([iecDiversity(1), iecDiversity(3), iecDiversity(5), iecDiversity(8), iecDiversity(12)]).toEqual([1, 0.9, 0.8, 0.7, 0.6]);
    expect(ambientFactor(40)).toBe(1);
    expect(ambientFactor(50)).toBeCloseTo(0.9);
  });

  it('aluminium: same rating, bigger area and section, lighter', () => {
    const cu = sizeRiser(sampleProject, tower);
    const al = sizeRiser(sampleProject, { ...tower, material: 'al' });
    expect(al.type!.ratingA).toBe(cu.type!.ratingA);
    expect(al.type!.csaMm2).toBeGreaterThan(cu.type!.csaMm2);
    expect(al.type!.heightMm).toBeGreaterThan(cu.type!.heightMm);
    expect(al.weightKg!).toBeLessThan(cu.weightKg!);
    expect(al.vdTopPct).toBeGreaterThan(cu.vdTopPct);
  });

  it('voltage drop grows up the riser; lengths, parts, withstand', () => {
    const r = sizeRiser(sampleProject, { ...tower, floors: [
      { id: 'a', name: 'L1', kw: 60 }, { id: 'b', name: 'L2', kw: 60 }, { id: 'c', name: 'L3', kw: 60, count: 3 }
    ], offsetFloors: 2 });
    const vds = r.floors.map((f) => f.vdPct);
    expect(vds[1]).toBeGreaterThan(vds[0]);
    expect(vds[2]).toBeGreaterThan(vds[1]);
    expect(r.floors[0].heightM).toBeCloseTo(2 * 3.6);
    expect(r.floors[2].heightM).toBeCloseTo(6 * 3.6); // last of the three repeated floors
    expect(r.lengthM).toBeCloseTo(10 + 6 * 3.6 + 1);
    expect(r.elements).toBe(Math.ceil(r.lengthM / 3));
    expect(r.faultKa).toBeGreaterThan(20);
    expect(r.icwOk).toBe(true);
  });

  it('a floor can take its board’s demand; too big for the data is flagged', () => {
    const r = sizeRiser(sampleProject, { ...tower, floors: [{ id: 'a', name: 'GF', boardId: 'SMDB-GF' }] });
    expect(r.floors[0].kw).toBeGreaterThan(100);
    const huge = sizeRiser(sampleProject, { ...tower, floors: [{ id: 'a', name: 'x', kw: 250, count: 30 }] });
    expect(huge.type).toBeUndefined();
    expect(huge.notes.join(' ')).toMatch(/largest/);
  });

  it('manufacturer data replaces the typical table; report section', () => {
    const own: Project = { ...sampleProject, busbarData: { ...TYPICAL_BUSBAR_DATA, cu: [{ ratingA: 1100, csaMm2: 700, rMohmPerM: 0.05, xMohmPerM: 0.02, icwKa: 65, widthMm: 140, heightMm: 130, kgPerM: 20 }, ...TYPICAL_BUSBAR_DATA.cu.filter((t) => t.ratingA > 1100)] } };
    expect(sizeRiser(own, tower).type!.ratingA).toBe(1100); // 1053 A needed: the catalogue's 1100 A fits
    expect(sizeRiser(sampleProject, tower).type!.ratingA).toBe(1250);
    expect(busbarTypeFrom(['1600 A', '1070', '0.04', '0.016', '80', '135', '165', '26'])!.ratingA).toBe(1600);
    expect(busbarTypeFrom(['x', '', ''])).toBeNull();
    const p: Project = { ...sampleProject, busRisers: [tower] };
    const s = buildSection('busbar', { project: p, results: [], earthing: [], selectivity: [] }, scopeOf(p, { boards: [], downstream: true }));
    expect(s.tables[0].rows).toHaveLength(1);
    expect(s.tables[1].title).toMatch(/tap-offs/);
  });
});
