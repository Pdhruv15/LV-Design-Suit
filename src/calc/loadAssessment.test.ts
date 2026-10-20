import { describe, expect, it } from 'vitest';
import { assess, DEFAULT_TYPES, newAssessment, rowArea, setAreaMode, typeFromAssessment, type LoadAssessment } from './loadAssessment';

const lib = { types: [] };
const res = (patch: Partial<LoadAssessment> = {}) => ({ ...newAssessment(DEFAULT_TYPES[0], { gfaM2: 24000, floors: 20, parkingM2: 8000 }, lib), ...patch });

describe('load assessment', () => {
  it('area schedule × W/m² gives lighting, power and cooling', () => {
    const a = res();
    const r = assess(a);
    expect(r.pctTotal).toBeCloseTo(100);
    expect(r.areaM2).toBeCloseTo(24000);
    // Lighting: Σ area × W/m² + car park 8 000 m² × 3 W/m²
    const ltg = a.rows.reduce((x, row) => x + (rowArea(a, row) * row.ltg) / 1000, 0) + 24;
    expect(r.categories.find((c) => c.key === 'ltg')!.connectedKw).toBeCloseTo(ltg);
  });

  it('the cooling system changes the HVAC load', () => {
    const vrf = assess(res()).services.cool;
    const dc = assess(res({ services: { ...res().services, cool: 'dc' } })).services.cool;
    expect(dc).toBeLessThan(vrf / 3);
  });

  it('fire & life safety is on the generator only, not in the normal MD', () => {
    const r = assess(res());
    const life = r.categories.find((c) => c.key === 'life')!;
    expect(life.demandKw).toBe(0);
    const off = assess(res({ services: { ...res().services, fire: false } }));
    expect(off.mdKw).toBeCloseTo(r.mdKw);
    expect(off.generatorKw).toBeLessThan(r.generatorKw);
  });

  it('custom loads add to the MD and, when ticked, to the generator', () => {
    const base = assess(res());
    const r = assess(res({ custom: [{ id: 'c1', label: 'Cold room', qty: 2, kw: 10, diversity: 0.5, onGenerator: true }] }));
    expect(r.sumDemandKw - base.sumDemandKw).toBeCloseTo(10);
    expect(r.generatorKw - base.generatorKw).toBeCloseTo(10);
  });

  it('edited diversity, coincidence and spare change the MD', () => {
    const a = res();
    const r1 = assess(a);
    const r2 = assess({ ...a, diversity: { ...a.diversity, pwr: 1 }, supply: { ...a.supply, coincidence: 1, sparePct: 10 } });
    expect(r2.mdKw).toBeGreaterThan(r1.mdKw);
    expect(r2.mdKw).toBeCloseTo(r2.sumDemandKw * 1.1);
  });

  it('transformers stay under the loading limit, N+1 adds one', () => {
    const a = res();
    const r = assess(a);
    expect(r.tx!.kva * r.tx!.duty * 0.8).toBeGreaterThanOrEqual(r.mdKva);
    expect(r.tx!.kva).toBeLessThanOrEqual(1500);
    const n1 = assess({ ...a, supply: { ...a.supply, redundancy: 'N+1' } });
    expect(n1.tx!.count).toBe(r.tx!.count + 1);
    const own = assess({ ...a, supply: { ...a.supply, txSizes: [1000], maxTxKva: 1000 } });
    expect(own.tx!.kva).toBe(1000);
  });

  it('m² mode keeps the areas; saved types keep the mix as %', () => {
    const a = res();
    const m2 = setAreaMode(a, 'm2');
    expect(assess(m2).areaM2).toBeCloseTo(assess(a).areaM2, 0);
    const t = typeFromAssessment(m2, 'my1', 'My tower');
    expect(t.rows.reduce((x, r) => x + (r.pct ?? 0), 0)).toBeCloseTo(100, 0);
    expect(t.mine).toBe(true);
  });

  it('VA/m² is checked against the type band', () => {
    const r = assess(res({ vaBand: [1, 2] }));
    expect(r.inBand).toBe(false);
  });
});
