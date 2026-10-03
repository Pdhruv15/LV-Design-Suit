import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';
import { newRiser, riserVd, sizeRiser, type BusRiser } from './busbar';
import { buildVdReportHtml } from '../docs/voltageDropReport';
import { buildSection, scopeOf } from '../docs/studyReport';

/** ENG-011: each riser section's drop from the P and Q it actually carries. */
const U = 400, R = 0.11e-3, X = 0.03e-3; // 630 A Cu typical
const drop = (m: number, p: number, q: number) => (100 * 1000 * m * (R * p + X * q)) / (U * U);
const riser = (floors: BusRiser['floors'], extra: Partial<BusRiser> = {}): BusRiser => ({
  ...newRiser('T'), material: 'cu', diversity: 1, feedM: 10, floorHeightM: 20, offsetFloors: 1, floors, ...extra
});
const project = (extra: Partial<Project> = {}): Project => ({ ...sampleProject, voltageV: U, ambientC: 40, busbarData: undefined, ...extra } as Project);
const A = { id: 'A', name: 'A', kw: 100, pf: 1 }, B = { id: 'B', name: 'B', kw: 100, pf: 0.6 };

describe('ENG-011: busbar riser voltage drop from each section’s P and Q', () => {
  it('fixture: 100 kW PF 1 below, 100 kW PF 0.6 above → 0.675 % (0.1625 + 0.325 + 0.1875)', () => {
    const p = project(), r = riser([A, B]);
    const s = sizeRiser(p, r);
    expect(s.type?.ratingA).toBe(630);
    expect(s.pf).toBeCloseTo(0.832050294, 8);
    expect(s.designA).toBeCloseTo(346.944333, 5);
    const [feed, toA, toB] = s.sections;
    expect([feed.p, feed.q]).toEqual([200, expect.closeTo(133.333333, 5)]);
    expect([toB.p, toB.q]).toEqual([100, expect.closeTo(133.333333, 5)]);
    expect(feed.vdPct).toBeCloseTo(drop(10, 200, 400 / 3), 9);
    expect(feed.vdPct).toBeCloseTo(0.1625, 9);
    expect(toA.vdPct).toBeCloseTo(0.325, 9);
    expect(toB.vdPct).toBeCloseTo(0.1875, 9);
    expect(s.vdTopPct).toBeCloseTo(0.675, 9);
    const v = riserVd(p, r);
    expect(v.upstreamPct).toBe(0);
    expect(v.exactTopPct).toBeCloseTo(0.675, 9);
    expect(v.segments.map((x) => x.vdPct)).toEqual(s.sections.map((x) => x.vdPct));
  });

  it('floors with the same PF keep the previous result', () => {
    const p = project(), r = riser([{ ...A, pf: 0.9 }, { ...B, pf: 0.9 }]);
    const s = sizeRiser(p, r);
    const q = 100 * Math.tan(Math.acos(0.9));
    expect(s.vdTopPct).toBeCloseTo(drop(10, 200, 2 * q) + drop(20, 200, 2 * q) + drop(20, 100, q), 9);
    // Same as the old single-PF formula √3·I·(R cosφ + X sinφ)·L ÷ U when every floor has PF 0.9.
    const I = (kva: number) => (kva * 1000) / (Math.sqrt(3) * U);
    const old = (amps: number, m: number) => (Math.sqrt(3) * amps * (R * 0.9 + X * Math.sin(Math.acos(0.9))) * m / U) * 100;
    expect(s.vdTopPct).toBeCloseTo(old(I(Math.hypot(200, 2 * q)), 30) + old(I(Math.hypot(100, q)), 20), 9);
  });

  it('reversing the floors keeps the design current but changes the top drop', () => {
    const p = project();
    const ab = sizeRiser(p, riser([A, B])), ba = sizeRiser(p, riser([B, A]));
    expect(ba.designA).toBeCloseTo(ab.designA, 9);
    expect(ba.vdTopPct).toBeCloseTo(drop(30, 200, 400 / 3) + drop(20, 100, 0), 9);
    expect(ba.vdTopPct).not.toBeCloseTo(ab.vdTopPct, 6);
  });

  it('repeated floors and diversity scale each section’s P and Q once', () => {
    const p = project(), r = riser([{ ...A, count: 2 }, B], { diversity: 0.8 });
    const s = sizeRiser(p, r);
    expect(s.sections).toHaveLength(4); // feed + 3 tap-offs
    expect(s.sections[0].p).toBeCloseTo(300 * 0.8, 9);
    expect(s.sections[2].p).toBeCloseTo(200 * 0.8, 9);
    expect(s.sections[3].q).toBeCloseTo((400 / 3) * 0.8, 9);
    expect(s.sections[3].vdPct).toBeCloseTo(drop(20, 80, (400 / 3) * 0.8), 9);
  });

  it('board-linked leading and mixed loads keep the sign of Q (no fictitious unity PF)', () => {
    const lead: Feeder = { id: 'C', boardId: 'DB2', name: 'C', loadKw: 0, demandFactor: 1, powerFactor: 1, kvar: 60, loadType: 'capacitor', lengthM: 5, cableCsaMm2: 16, cores: 4, breakerRatingA: 100, breakerIcuKa: 25 };
    const l: Feeder = { ...lead, id: 'L', kvar: undefined, loadType: undefined, loadKw: 40, powerFactor: 1 };
    const p = project({ boards: [{ id: 'MDB', name: 'MDB', sourceKva: 1000 }, { id: 'DB2', name: 'DB2', upstreamId: 'MDB' }], feeders: [l, lead] });
    const s = sizeRiser(p, riser([{ id: 'F', name: 'F', boardId: 'DB2' }, B]));
    expect(s.floors[0].kvar).toBeCloseTo(-60, 9); // fixed capacitor: leading kept
    expect(s.sections[0].q).toBeCloseTo(-60 + 400 / 3, 9); // mixed: lagging above, leading below
    expect(s.sections[1].vdPct).toBeCloseTo(drop(20, 140, -60 + 400 / 3), 9);
    const onlyLead = sizeRiser(p, riser([{ id: 'F', name: 'F', boardId: 'DB2' }]));
    expect(onlyLead.sections[0].q).toBeLessThan(0);
    expect(onlyLead.pf).toBeLessThan(1);
    expect(onlyLead.sections[0].vdPct).toBeCloseTo(drop(10, 40, -60), 9);
  });

  it('page / report parity, with zero and non-zero upstream drop and both materials', () => {
    for (const material of ['cu', 'al'] as const) {
      const p = project(), r = riser([A, B], { material });
      const v = riserVd(p, r);
      const html = buildVdReportHtml(p, [], 'All', [v]);
      expect(html).toContain(v.exactTopPct.toFixed(2));
      for (const g of v.segments) expect(html).toContain(g.vdPct.toFixed(3));
    }
    // With a feeding board below the main board, the upstream drop is added once, riser-only stays the same.
    const sp = sampleProject;
    const sub = sp.boards.find((b) => b.upstreamId)!;
    const r = riser([A, B], { sourceBoardId: sub.id });
    const v = riserVd(sp, r), s = sizeRiser(sp, r);
    expect(v.upstreamPct).toBeGreaterThan(0);
    expect(v.exactTopPct).toBeCloseTo(v.upstreamPct + s.vdTopPct, 9);
    const sec = buildSection('busbar', { project: { ...sp, busRisers: [r] }, results: [], earthing: [], selectivity: [] }, scopeOf({ ...sp, busRisers: [r] }, { boards: [], downstream: true }));
    expect(JSON.stringify(sec.tables)).toContain(s.vdTopPct.toFixed(2));
  });
});
