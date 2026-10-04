import { describe, expect, it } from 'vitest';
import { applicableRules, BUILTIN_CATALOGUES, selectionFrom, sizeEnclosure, spareFromPct } from './enclosure';

const [MOD, FAB] = BUILTIN_CATALOGUES;

describe('enclosure sizing from the supplier chart', () => {
  it('chart data is internally consistent: usable = gross − the rule deduction, wherever stated', () => {
    for (const cat of BUILTIN_CATALOGUES) for (const c of cat.configs) for (const r of cat.rules) {
      const u = c.usable[r.id];
      if (u !== null && u !== undefined) expect(u, `${cat.range} ${c.ref} ${r.id}`).toBe(c.grossModules - r.deductModules);
    }
    for (const c of MOD.configs) expect(c.grossModules).toBe(c.rows! * c.modulesPerRow!);
  });

  it('the concept example: 64 + 8 spare, 10 ELCB → 5 × 16 (80 − 8 = 72), H905 × W445 × D115 surface', () => {
    const r = sizeEnclosure(MOD, { equipmentModules: 64, spareModules: 8, elcbCount: 10 }, 'surface');
    expect(r.required).toBe(72);
    expect(r.rules.map((x) => x.id)).toEqual(['elcb12']);
    const best = r.candidates[0];
    expect([best.config.ref, best.usable, best.result, best.spareAfter]).toEqual(['5 × 16', 72, 'fits', 0]);
    expect(best.dims).toEqual({ h: 905, w: 445, d: 115 });
    expect(sizeEnclosure(MOD, { equipmentModules: 64, spareModules: 8, elcbCount: 10 }, 'flush').candidates[0].dims).toEqual({ h: 925, w: 465, d: 115 });
    // several suitable candidates, not one: 6 × 16 (tall, narrow) and 4 × 24 (short, wide) both fit too
    expect(r.candidates.filter((c) => c.result === 'fits').map((c) => c.config.ref)).toEqual(['5 × 16', '6 × 16', '4 × 24', '5 × 24', '6 × 24']);
    // 4 × 16 (blank in the printed chart) is worked out as 64 − 8 = 56: too small here
    expect(r.candidates.find((c) => c.config.ref === '4 × 16')!.usable).toBe(56);
    // small DB: nearest size by rows — 20 modules → 2 × 16 (32 − 8 = 24)
    expect(sizeEnclosure(MOD, { equipmentModules: 20, spareModules: 0, elcbCount: 4 }).candidates[0].config.ref).toBe('2 × 16');
  });

  it('allowance is not deducted twice; one module over the capacity is too small', () => {
    expect(sizeEnclosure(MOD, { equipmentModules: 72, spareModules: 0, elcbCount: 12 }).candidates[0].config.ref).toBe('5 × 16');
    const over = sizeEnclosure(MOD, { equipmentModules: 73, spareModules: 0, elcbCount: 12 });
    expect(over.candidates.find((c) => c.config.ref === '5 × 16')!.result).toBe('too-small');
    expect(over.candidates[0].config.ref).toBe('6 × 16');
  });

  it('ELCB count chooses the case; modular 13–15 uses −12; beyond 15 the chart has no case', () => {
    const r = sizeEnclosure(MOD, { equipmentModules: 80, spareModules: 0, elcbCount: 14 });
    expect(r.rules.map((x) => x.id)).toEqual(['elcb15']);
    expect(r.candidates[0].config.ref).toBe('6 × 16'); // 96 − 12 = 84
    expect(r.candidates.find((c) => c.config.ref === '5 × 16')!.usable).toBe(68); // 80 − 12
    const none = sizeEnclosure(MOD, { equipmentModules: 10, spareModules: 0, elcbCount: 16 });
    expect(none.candidates).toHaveLength(0);
    expect(none.why).toMatch(/no case for 16 ELCB/);
  });

  it('fabricated: overlapping cases at 13–15 ELCB need supplier confirmation; > 15 ELCB follows the incomer', () => {
    expect(applicableRules(FAB, { equipmentModules: 0, spareModules: 0, elcbCount: 14, incomerA: 100 })).toMatchObject({ confirm: true });
    const r = sizeEnclosure(FAB, { equipmentModules: 60, spareModules: 0, elcbCount: 14, incomerA: 100 });
    expect(r.candidates.every((c) => c.result !== 'fits')).toBe(true); // nothing auto-selected
    expect(r.candidates.some((c) => c.result === 'confirm')).toBe(true);
    const big = sizeEnclosure(FAB, { equipmentModules: 90, spareModules: 10, elcbCount: 20, incomerA: 200 });
    expect(big.rules.map((x) => x.id)).toEqual(['gt12-250']);
    expect(big.candidates[0]).toMatchObject({ usable: 146, result: 'fits' }); // 1000 × 1000 × 200: 210 − 64
    expect(big.candidates[0].rule.extra).toMatch(/20×10/);
    expect(sizeEnclosure(FAB, { equipmentModules: 10, spareModules: 0, elcbCount: 20 }).why).toMatch(/incomer current/);
    expect(sizeEnclosure(FAB, { equipmentModules: 10, spareModules: 0, elcbCount: 20, incomerA: 140 }).candidates).toHaveLength(0); // 125–160 A gap
  });

  it('invalid input, and a selection keeps a frozen copy with the catalogue revision', () => {
    expect(sizeEnclosure(MOD, { equipmentModules: -1, spareModules: 0, elcbCount: 1 }).invalid).toBeTruthy();
    const input = { equipmentModules: 64, spareModules: 8, elcbCount: 10 };
    const r = sizeEnclosure(MOD, input, 'surface');
    const sel = selectionFrom(MOD, r.candidates[0], input, 'surface', r.required);
    expect(sel).toMatchObject({ supplier: 'Supplier chart', revision: '1', usable: 72, required: 72, mounting: 'surface', dims: { h: 905, w: 445, d: 115 } });
    sel.config.usable.elcb12 = 999; // the copy is independent of the library
    expect(MOD.configs.find((c) => c.ref === '5 × 16')!.usable.elcb12).toBe(72);
  });

  it('13–15 ELCB on the fabricated chart with no incomer entered: never a plain fit, asks for the incomer', () => {
    const fab = BUILTIN_CATALOGUES.find((c) => c.family === 'fabricated')!;
    const a = applicableRules(fab, { equipmentModules: 40, spareModules: 8, elcbCount: 14 });
    expect(a.confirm).toBe(true);
    expect(a.why).toMatch(/incomer/);
    expect(sizeEnclosure(fab, { equipmentModules: 40, spareModules: 8, elcbCount: 14 }).candidates.some((c) => c.result === 'fits')).toBe(false);
    // Up to 12 ELCB the incomer doesn't matter
    expect(applicableRules(fab, { equipmentModules: 40, spareModules: 8, elcbCount: 10 }).confirm).toBe(false);
  });

  it('spare as a percentage rounds up to whole modules', () => {
    expect(spareFromPct(64, 20)).toBe(13);
    expect(spareFromPct(60, 20)).toBe(12);
    expect(spareFromPct(0, 25)).toBe(0);
  });
});
