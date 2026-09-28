import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../calc/spacePlan';
import { applyPlanEdits, buildPlanSheet } from './planSheet';

describe('space plan areas sheet', () => {
  it('pasting a block into blank rows adds areas; use types match by name', () => {
    const plan = emptyPlan();
    const sheet = buildPlanSheet(plan);
    const cells = [
      ['Building A', 'GF–5', 'Apartments', 'Residential (apartments)', '9000'],
      ['Building B', 'B1', 'Car park', 'car park', '6000']
    ];
    const edits = cells.flatMap((row, y) => row.map((value, x) => ({ y, x, value })));
    const { plan: p, rejected } = applyPlanEdits(plan, sheet, edits);
    expect(rejected).toEqual([]);
    expect(p.areas).toEqual([
      { id: 'A1', building: 'Building A', floor: 'GF–5', name: 'Apartments', use: 'residential', areaM2: 9000 },
      { id: 'A2', building: 'Building B', floor: 'B1', name: 'Car park', use: 'parking', areaM2: 6000 }
    ]);
    const again = buildPlanSheet(p);
    expect(again.data[0].slice(-2)).toEqual(['720.0', '504.0']);
    expect(again.totals![again.keys.indexOf('demand')]).toBe((504 + 54).toFixed(1));
  });

  it('rejects values that do not fit and clears overrides with a blank', () => {
    const plan = { ...emptyPlan(), areas: [{ id: 'A1', building: 'B', name: 'X', use: 'office', areaM2: 100, wPerM2: 50 }] };
    const sheet = buildPlanSheet(plan);
    const col = (k: string) => sheet.keys.indexOf(k as never);
    const { plan: p, rejected } = applyPlanEdits(plan, sheet, [
      { y: 0, x: col('df'), value: '1.4' },
      { y: 0, x: col('use'), value: 'Stadium' },
      { y: 0, x: col('areaM2'), value: 'big' },
      { y: 0, x: col('wPerM2'), value: '' },
      { y: 0, x: col('connected'), value: '999' }
    ]);
    expect(rejected).toHaveLength(3);
    expect(p.areas[0]).toEqual({ id: 'A1', building: 'B', name: 'X', use: 'office', areaM2: 100 });
  });
});
