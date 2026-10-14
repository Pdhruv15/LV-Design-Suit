import { afterEach, describe, expect, it } from 'vitest';
import { AMBIENT_RANGE_C, REFERENCE_CABLE_TABLE, ambientCheck, ambientCorrectionFactor, cableDataFindings, cableDataNotice, cableDataStatus, getCable, resolveCable, setCables, type CableSpec } from './cableTable';
import type { Feeder } from '../types';

const ref = (csa: number) => REFERENCE_CABLE_TABLE.find((c) => c.csaMm2 === csa)!;
const fd = (csa: number, cpc?: number) => ({ cableCsaMm2: csa, cpcMm2: cpc }) as Feeder;

afterEach(() => setCables(null));

describe('cable data source', () => {
  it('built-in table: every size is reference data', () => {
    expect(resolveCable(50)).toEqual({ spec: ref(50), source: 'reference' });
    expect(resolveCable(400)).toBeNull();
  });

  it('Cables.xlsx rows: manufacturer only with manufacturer + reference document; unchanged reference rows stay reference', () => {
    const rows: CableSpec[] = [
      { ...ref(16) }, // seeded and never edited
      { ...ref(25), ampacityA: 130 }, // edited, no source named
      { ...ref(35), manufacturer: 'Maker', referenceDoc: 'Datasheet DS-1 rev 2' },
      { ...ref(50), manufacturer: 'Maker' }, // no document, values unchanged: still reference
      { ...ref(70), ampacityA: 250, manufacturer: 'Maker' } // no document, values edited: user
    ];
    setCables(rows);
    expect(resolveCable(16)?.source).toBe('reference');
    expect(resolveCable(25)?.source).toBe('user');
    expect(resolveCable(35)?.source).toBe('manufacturer');
    expect(resolveCable(50)?.source).toBe('reference');
    expect(resolveCable(70)?.source).toBe('user');
  });

  it('a size missing from Cables.xlsx is reported as fallback, with the reference values', () => {
    setCables([{ ...ref(35), manufacturer: 'Maker', referenceDoc: 'DS-1' }]);
    expect(resolveCable(70)).toEqual({ spec: ref(70), source: 'fallback' });
    expect(getCable(70)).toEqual(ref(70)); // existing callers keep working
    expect(() => getCable(400)).toThrow('No cable data for 400 mm²');
  });

  it('project status covers phase and protective conductor sizes', () => {
    setCables([{ ...ref(35), manufacturer: 'Maker', referenceDoc: 'DS-1' }, { ...ref(16) }]);
    const s = cableDataStatus({ feeders: [fd(35, 16), fd(70), fd(400)] });
    expect(s.sizes).toEqual([{ csaMm2: 16, source: 'reference' }, { csaMm2: 35, source: 'manufacturer' }, { csaMm2: 70, source: 'fallback' }]);
    expect(s.missing).toEqual([400]);
  });

  it('report notice names unverified sizes; empty when all are manufacturer data', () => {
    setCables([{ ...ref(35), manufacturer: 'Maker', referenceDoc: 'DS-1' }]);
    expect(cableDataNotice({ feeders: [fd(35)] })).toBe('');
    const n = cableDataNotice({ feeders: [fd(35), fd(70)] });
    expect(n).toContain('70 mm²: not in Cables.xlsx');
    expect(n).not.toContain('35 mm²');
  });

  it('findings: fallback is a warning, a failure in strict mode; strict also fails reference / user rows', () => {
    setCables([{ ...ref(35), manufacturer: 'Maker', referenceDoc: 'DS-1' }, { ...ref(16) }]);
    const feeders = [fd(35, 16), fd(70)];
    expect(cableDataFindings({ feeders }).map((x) => x.status)).toEqual(['warn']);
    const strict = cableDataFindings({ feeders, strictCableData: true });
    expect(strict.map((x) => x.status)).toEqual(['bad', 'bad']);
    expect(strict[1].text).toContain('16 mm²');
    expect(cableDataFindings({ feeders: [fd(35)], strictCableData: true })).toEqual([]);
  });
});

describe('ambient temperature correction (XLPE, 30 °C reference)', () => {
  it('supported range is 25–70 °C', () => expect(AMBIENT_RANGE_C).toEqual({ min: 25, max: 70 }));
  it('table points and interpolation', () => {
    expect(ambientCorrectionFactor(25)).toBe(1.03);
    expect(ambientCorrectionFactor(30)).toBe(1);
    expect(ambientCorrectionFactor(70)).toBe(0.58);
    expect(ambientCorrectionFactor(42.5)).toBeCloseTo(0.89, 10); // halfway between 0.91 and 0.87
  });
  it('in range: ok', () => {
    for (const t of [25, 45, 70]) expect(ambientCheck(t).status).toBe('ok');
  });
  it('below range: held at the 25 °C factor (conservative) and flagged as a warning', () => {
    expect(ambientCorrectionFactor(10)).toBe(1.03);
    expect(ambientCheck(24.9).status).toBe('warn');
  });
  it('above range: not extrapolated, and flagged as a failure (the 70 °C factor would overstate the rating)', () => {
    expect(ambientCorrectionFactor(80)).toBe(0.58);
    expect(ambientCheck(70.1)).toMatchObject({ status: 'bad' });
  });
  it('not a number: NaN factor (fails every rating check), flagged as a failure', () => {
    expect(ambientCorrectionFactor(NaN)).toBeNaN();
    expect(ambientCorrectionFactor(undefined as unknown as number)).toBeNaN();
    expect(ambientCheck(Infinity).status).toBe('bad');
  });
});
