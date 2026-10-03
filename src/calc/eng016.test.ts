import { describe, expect, it } from 'vitest';
import { powerFromCurrent, triangle, type Triangle } from './quick';

/** Independent identity check for a valid result: S² = P² + Q², PF = P / S, all magnitudes. */
function valid(t: Triangle) {
  expect(t.invalid).toBeUndefined();
  for (const v of [t.kw, t.kva, t.kvar, t.pf]) expect(Number.isFinite(v)).toBe(true);
  expect(t.kva ** 2).toBeCloseTo(t.kw ** 2 + t.kvar ** 2, 6);
  expect(t.pf).toBeCloseTo(t.kw / t.kva, 9);
  expect(t.pf).toBeLessThanOrEqual(1);
  expect(t.pf).toBeGreaterThanOrEqual(0);
}
const rejected = (t: Triangle, why: RegExp) => { expect(t.invalid).toMatch(why); expect(t.kva).toBeNaN(); expect(t.kw).toBeNaN(); };

describe('ENG-016 power triangle: inconsistent pairs are rejected', () => {
  it('review fixtures', () => {
    rejected(triangle({ kw: 20, kva: 10 }), /kW cannot be more than kVA/); // was Q 0, PF 2
    rejected(triangle({ kva: 10, kvar: 20 }), /kVAr cannot be more than kVA/); // was P 0, PF 0, Q 20
    const t = triangle({ kw: 80, kva: 100 });
    valid(t);
    expect(t.kvar).toBeCloseTo(60, 9);
    expect(t.pf).toBeCloseTo(0.8, 12);
  });

  it('all five input pairs give the same 80 / 100 / 60 triangle', () => {
    for (const t of [triangle({ kw: 80, pf: 0.8 }), triangle({ kva: 100, pf: 0.8 }), triangle({ kw: 80, kva: 100 }), triangle({ kw: 80, kvar: 60 }), triangle({ kva: 100, kvar: 60 })]) {
      valid(t);
      expect(t.kw).toBeCloseTo(80, 9); expect(t.kva).toBeCloseTo(100, 9); expect(t.kvar).toBeCloseTo(60, 9);
    }
  });

  it('boundaries: P = S, Q = S, round-off at equality, clearly excessive', () => {
    const unity = triangle({ kw: 50, kva: 50 }); valid(unity); expect(unity.pf).toBe(1); expect(unity.kvar).toBe(0);
    const reactive = triangle({ kva: 50, kvar: 50 }); valid(reactive); expect(reactive.kw).toBe(0); expect(reactive.pf).toBe(0);
    valid(triangle({ kw: 0.1 + 0.2, kva: 0.3 })); // 0.30000000000000004 > 0.3 by round-off only
    rejected(triangle({ kw: 100.01, kva: 100 }), /kW cannot be more/);
    rejected(triangle({ kva: 100, kvar: 100.5 }), /kVAr cannot be more/);
  });

  it('PF outside 0–1, non-finite, negative and ambiguous zeros', () => {
    rejected(triangle({ kw: 80, pf: 1.2 }), /above 1/);
    rejected(triangle({ kva: 80, pf: -0.1 }), /magnitudes/);
    rejected(triangle({ kw: NaN, pf: 0.8 }), /numbers/);
    rejected(triangle({ kw: Infinity, kva: 100 }), /numbers/);
    rejected(triangle({ kw: 80, pf: 0 }), /contradictory/);
    rejected(triangle({ kw: 0, pf: 0 }), /not defined/);
    rejected(triangle({ kw: 0, kvar: 0 }), /both 0/);
    rejected(triangle({ kva: 0, pf: 0.8 }), /kVA is 0/);
    rejected(triangle({ kw: 80 }), /two values/);
    const pureQ = triangle({ kva: 40, pf: 0 }); valid(pureQ); expect(pureQ.kvar).toBeCloseTo(40, 9);
  });

  it('power from current still works; an impossible PF is reported, not clamped', () => {
    const p = powerFromCurrent(100, 3, 400, 0.8);
    valid(p);
    expect(p.kva).toBeCloseTo(69.28, 2);
    expect(powerFromCurrent(0, 3, 400, 0.8)).toMatchObject({ kw: 0, kva: 0, kvar: 0 });
    expect(powerFromCurrent(100, 3, 400, 1.5).invalid).toMatch(/above 1/);
  });
});
