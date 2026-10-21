import { afterAll, describe, expect, it, vi } from 'vitest';
import { inLibrary, withStandardLoads } from './standardLoads';
import { STANDARD_LOADS, STANDARD_NOTE } from '../data/standardLoads';
import { parseDatabase } from './database';
import { POINT_TYPES } from '../types';

const mine = [
  { _row: 2, name: '13A single socket-outlet', reference: 'SS1', column: '13A S/O', watts: 200, manufacturer: 'Mine' },
  { _row: 3, name: 'Kitchen hood', reference: 'l1', column: 'OTHER', watts: 250 } // my own L1, under another name
];

describe('standard load library', () => {
  it('covers every load schedule column except the spare and isolator columns, with unique references and names', () => {
    const cols = new Set(STANDARD_LOADS.map((l) => l.column));
    expect(POINT_TYPES.map((p) => p.value).filter((c) => !cols.has(c))).toEqual(['spare1', 'spare2', 'isol']);
    expect(new Set(STANDARD_LOADS.map((l) => l.reference.toLowerCase())).size).toBe(STANDARD_LOADS.length);
    expect(new Set(STANDARD_LOADS.map((l) => l.name.toLowerCase())).size).toBe(STANDARD_LOADS.length);
    expect(STANDARD_LOADS.every((l) => l.watts > 0 && (l.pf === undefined || (l.pf > 0 && l.pf <= 1)))).toBe(true);
  });

  it('keeps your rows unchanged and skips items you already have by reference or name', () => {
    expect(inLibrary(mine, { reference: 'L1', name: 'LED downlight' })).toBe(true); // reference, any case
    expect(inLibrary(mine, { reference: 'X9', name: 'kitchen HOOD' })).toBe(true); // name, any case
    const r = withStandardLoads(mine, STANDARD_LOADS);
    expect(r.rows.slice(0, 2)).toEqual([
      { name: '13A single socket-outlet', reference: 'SS1', column: '13A S/O', watts: 200, manufacturer: 'Mine' },
      { name: 'Kitchen hood', reference: 'l1', column: 'OTHER', watts: 250 }
    ]);
    expect(r.skipped.map((s) => s.reference)).toEqual(['L1', 'SS1']);
    expect(r.added).toHaveLength(STANDARD_LOADS.length - 2);
    expect(r.rows[2]).toEqual({ name: 'LED panel 600 × 600', reference: 'L2', category: 'Lighting', column: 'LTG', watts: 36, pf: 0.9, notes: STANDARD_NOTE });
  });

  it('writes rows the library reads back as the same items, in their schedule columns', () => {
    const { rows } = withStandardLoads([], STANDARD_LOADS);
    const db = parseDatabase({ folder: '/db', readAt: 0, books: { loads: { file: 'Loads.xlsx', rows: rows.map((r, i) => ({ _row: i + 2, ...r })) as never } } });
    expect(db.issues).toEqual([]);
    expect(db.loads.map((l) => [l.reference, l.column, l.watts])).toEqual(STANDARD_LOADS.map((l) => [l.reference, l.column, l.watts]));
  });
});

describe('standard loads dialog', () => {
  afterAll(() => vi.unstubAllGlobals());
  it('lists every standard item, greys out the ones already in the library, and counts the rest', async () => {
    vi.stubGlobal('window', { lvds: { database: { write: async () => ({ file: 'Loads.xlsx' }) } } });
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { default: StandardLoadsDialog } = await import('../components/docs/StandardLoadsDialog');
    const html = renderToStaticMarkup(createElement(StandardLoadsDialog, { rows: mine, onDone: () => {}, onClose: () => {} }));
    for (const l of STANDARD_LOADS) expect(html).toContain(`>${l.reference}<`);
    expect(html.match(/in your library \(kept\)/g)).toHaveLength(2); // L1 (my own L1) and SS1
    expect(html).toContain(`Add ${STANDARD_LOADS.length - 2} to Loads.xlsx`);
    expect(html).toContain('typical draft values');
  });
});
