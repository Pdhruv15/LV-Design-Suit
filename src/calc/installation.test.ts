import { afterEach, describe, expect, it } from 'vitest';
import { REFERENCE_CABLE_TABLE, cableDataFindings, cableDataNotice, methodRating, setCables, type CableSpec } from './cableTable';
import { evaluateFeeder, feederRating, selectCableRuns, izEvaluator } from './electrical';
import { groundChecks, ratingBasis } from './installation';
import { buildDashboard } from './dashboard';
import { failReasons } from './quickFix';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';

/** Expected values are worked out by hand from the ratings set in each test and the IEC 60364-5-52 factor
 * tables the app holds (ambient B.52.14, ground B.52.15, soil B.52.16, grouping B.52.17 / in the ground). */

const ref = (csa: number) => REFERENCE_CABLE_TABLE.find((c) => c.csaMm2 === csa)!;
const maker = { manufacturer: 'Maker', referenceDoc: 'DS-1 rev 2' };
afterEach(() => setCables(null));

const project = (feeders: Feeder[], over: Partial<Project> = {}): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4,
  boards: [{ id: 'MDB', name: 'Main', sourceKva: 1000, sourceImpedancePct: 5 }], feeders, updatedAt: '', ...over
});
const feeder = (over: Partial<Feeder>): Feeder => ({
  id: 'F1', boardId: 'MDB', name: 'Feeder', loadKw: 100, demandFactor: 1, powerFactor: 0.85,
  lengthM: 50, cableCsaMm2: 95, cores: 4, breakerRatingA: 200, breakerIcuKa: 50, ...over
});

describe('installation method ratings', () => {
  it('method E (default) is unchanged: rating × ambient × grouping × runs', () => {
    // 95 mm²: 306 A × 0.87 (45 °C) = 266.22 A
    const f = feeder({});
    expect(feederRating(project([f]), f).iz).toBeCloseTo(266.22, 2);
    expect(feederRating(project([f]), f).method).toBe('E');
  });

  it('D2 direct in the ground: Cables.xlsx rating × ground × soil × grouping', () => {
    setCables([...REFERENCE_CABLE_TABLE.filter((c) => c.csaMm2 !== 95), { ...ref(95), ...maker, methodRatings: { D2: 245 } }]);
    // 245 A × 0.89 (ground 35 °C) × 1.00 (soil 2.5 K·m/W) × 1.00 (one circuit) = 218.05 A
    const f = feeder({ installMethod: 'D2' });
    const r = feederRating(project([f], { groundTempC: 35, soilResistivityKmW: 2.5 }), f);
    expect(r.baseA).toBe(245);
    expect(r.source).toBe('manufacturer');
    expect(r.factors.map((x) => x.value)).toEqual([0.89, 1, 1]);
    expect(r.iz).toBeCloseTo(218.05, 2);
    expect(evaluateFeeder(project([f], { groundTempC: 35, soilResistivityKmW: 2.5 }), f).protectionStatus).toBe('ok'); // 200 A ≤ 218 A
  });

  it('D1 in ducts, two runs: ground 30 °C, soil 1.5 K·m/W, two ducts', () => {
    setCables([...REFERENCE_CABLE_TABLE.filter((c) => c.csaMm2 !== 70), { ...ref(70), ...maker, methodRatings: { D1: 200 } }]);
    // 200 × 0.93 × 1.10 × 0.85 × 2 runs = 347.82 A
    const f = feeder({ installMethod: 'D1', cableCsaMm2: 70, parallel: 2 });
    expect(feederRating(project([f], { groundTempC: 30, soilResistivityKmW: 1.5 }), f).iz).toBeCloseTo(347.82, 2);
  });

  it('C clipped direct, two runs: air ambient and bunched grouping (B.52.17 item 1)', () => {
    setCables([...REFERENCE_CABLE_TABLE.filter((c) => c.csaMm2 !== 50), { ...ref(50), ...maker, methodRatings: { C: 180 } }]);
    // 180 × 0.87 (45 °C) × 0.80 (2 bunched) × 2 runs = 250.56 A
    const f = feeder({ installMethod: 'C', cableCsaMm2: 50, parallel: 2 });
    expect(feederRating(project([f]), f).iz).toBeCloseTo(250.56, 2);
  });

  it('a tray route counts only for method E', () => {
    const r = ratingBasis({ ambientC: 30 }, 95, 'E', 1, 0.7);
    expect(r.iz).toBeCloseTo(306 * 0.7, 6);
    setCables([...REFERENCE_CABLE_TABLE.filter((c) => c.csaMm2 !== 95), { ...ref(95), ...maker, methodRatings: { C: 280 } }]);
    const f = feeder({ installMethod: 'C' });
    const p: Project = { ...project([f], { ambientC: 30 }), trays: undefined };
    expect(feederRating(p, f).iz).toBe(280); // no tray factor for C, one circuit
  });

  it('no rating for the method: DATA REQUIRED — Iz NaN, every rating check fails, never substituted', () => {
    // Built-in reference has no D2 ratings (until verified IEC tables are added).
    const f = feeder({ installMethod: 'D2' });
    const p = project([f]);
    expect(methodRating(95, 'D2')).toBeNull();
    const r = evaluateFeeder(p, f);
    expect(r.ampacity).toBeNaN();
    expect(r.rating.missing).toBe('no D2 rating for 95 mm² (Cables.xlsx or reference)');
    expect([r.ampacityStatus, r.protectionStatus, r.status]).toEqual(['bad', 'bad', 'bad']);
    expect(failReasons(p, r)[0]).toBe('Cable data required: no D2 rating for 95 mm² (Cables.xlsx or reference)');
    expect(cableDataFindings(p)).toContainEqual({ status: 'bad', text: 'Cable data required: no current rating for 95 mm² D2 — add the installation-method rating in Cables.xlsx' });
    expect(cableDataNotice(p)).toContain('95 (D2) mm²: no rating for the installation method');
  });

  it('a Cables.xlsx row without its own method rating: none is invented', () => {
    setCables([{ ...ref(95), ...maker }]);
    expect(methodRating(95, 'D2')).toBeNull();
    expect(methodRating(95, 'E')).toEqual({ a: 306, source: 'manufacturer' });
  });

  it('cable selection uses the method: sizes without a rating are skipped', () => {
    const rows: CableSpec[] = REFERENCE_CABLE_TABLE.map((c) => ({ ...c, ...maker, methodRatings: c.csaMm2 >= 120 ? { D2: c.ampacityA * 0.8 } : undefined }));
    setCables(rows);
    const f = feeder({ installMethod: 'D2', loadKw: 60 }); // Ib ≈ 98 A
    const p = project([f], { groundTempC: 20, soilResistivityKmW: 2.5 });
    // Only 120 mm² and up have D2 ratings, so 120 mm² is the smallest choice whatever the current.
    const sel = selectCableRuns(98, 50, 415, 4, 0.85, 45, 10, 100, 4, undefined, undefined, undefined, izEvaluator(f, p));
    expect(sel).toEqual({ csaMm2: 120, runs: 1 });
  });
});

describe('ground conditions for buried cables', () => {
  const buried = [feeder({ installMethod: 'D1' })];
  it('not set: the IEC reference is used and flagged; only when a circuit is buried', () => {
    expect(groundChecks(project(buried)).map((x) => x.status)).toEqual(['warn', 'warn']);
    expect(groundChecks(project([feeder({})]))).toEqual([]);
  });
  it('outside the tables or not a number: failure', () => {
    expect(groundChecks(project(buried, { groundTempC: 55, soilResistivityKmW: 2 }))[0]).toMatchObject({ status: 'bad' });
    expect(groundChecks(project(buried, { groundTempC: 30, soilResistivityKmW: NaN }))[0]).toMatchObject({ status: 'bad', text: 'Buried cables: soil thermal resistivity is not a number' });
    expect(groundChecks(project(buried, { groundTempC: 30, soilResistivityKmW: 1.2 }))).toEqual([]);
  });
  it('the dashboard lists them; the sample project (all method E) has none', () => {
    expect(buildDashboard(project(buried)).todo.some((t) => /ground temperature not set/.test(t.text))).toBe(true);
    expect(buildDashboard(sampleProject).todo.some((t) => /Buried cables|Cable data required/.test(t.text))).toBe(false);
  });
});
