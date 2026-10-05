import { describe, expect, it } from 'vitest';
import { isEmpty, leafChanges, show } from './datasetDiff';

describe('comparing nested design data', () => {
  it('treats missing, blank, empty lists and empty objects as the same, but not 0 or false', () => {
    expect(isEmpty(undefined) && isEmpty('') && isEmpty([]) && isEmpty({}) && isEmpty({ a: undefined, b: [] })).toBe(true);
    expect(isEmpty(0) || isEmpty(false)).toBe(false);
    expect(leafChanges({ a: [] }, undefined)).toEqual([]);
    expect(leafChanges({ x: 0 }, {})).toEqual([{ field: 'X', from: '0', to: '—' }]);
  });

  it('names fields readably, with units, and rounds numbers', () => {
    expect(leafChanges({ autonomyMin: 30, startSocPct: 100 }, { autonomyMin: 45, startSocPct: 90.12345 })).toEqual([
      { field: 'Backup time (min)', from: '30', to: '45' }, { field: 'Start SOC (%)', from: '100', to: '90.123' }
    ]);
    expect(leafChanges({ someNewThing: 1 }, { someNewThing: 2 })).toEqual([{ field: 'Some new thing', from: '1', to: '2' }]);
    expect(leafChanges({ pits: { 'lv:MDB-1': 2 } }, { pits: { 'lv:MDB-1': 3 } })).toEqual([{ field: 'Pits › lv:MDB-1', from: '2', to: '3' }]); // data keys are not respelled
  });

  it('matches items of a list by id: added and removed are one line, changed shows only the changed fields', () => {
    const a = { sheets: [{ id: 's1', number: 'E-1', title: 'A', size: 'A3' }, { id: 's2', number: 'E-2', title: 'B' }] };
    const b = { sheets: [{ id: 's1', number: 'E-1', title: 'A', size: 'A2' }, { id: 's3', number: 'E-3', title: 'C' }] };
    expect(leafChanges(a, b)).toEqual([
      { field: 'Sheets › [E-1 A] › Paper', from: 'A3', to: 'A2' },
      { field: 'Sheets [E-2 B]', from: 'present', to: 'removed' },
      { field: 'Sheets [E-3 C]', from: '—', to: 'added' }
    ]);
  });

  it('compares plain lists as a whole, skips the keys it is told to, and caps long results', () => {
    expect(leafChanges({ blockAhOptions: [100, 150] }, { blockAhOptions: [100, 200] })).toEqual([{ field: 'Block sizes (Ah)', from: '100, 150', to: '100, 200' }]);
    expect(leafChanges({ issuedHash: 'a', x: 1 }, { issuedHash: 'b', x: 1 }, { skip: ['issuedHash'] })).toEqual([]);
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, n]));
    const r = leafChanges({}, many(50), { max: 10 });
    expect(r).toHaveLength(11);
    expect(r[10]).toEqual({ field: '…', from: '', to: 'and 40 more' });
  });

  it('shows values for people', () => {
    expect(show({ a: 1, b: undefined, autonomyMin: 30 })).toBe('A 1, Backup time (min) 30');
    expect(show(true)).toBe('yes');
    expect(show(undefined)).toBe('—');
  });
});
