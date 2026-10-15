import { describe, expect, it } from 'vitest';
import { FORM4_COLUMNS, form4Selection, sizeForm4, stackSections, type Form4Counts } from './form4';
import { form4FromSld } from '../model/form4Count';
import { newProject, type Board, type Feeder, type Project } from '../types';

/** The worksheet's Y5 formula, written out as Excel has it (blank = 0), to check sizeForm4 against. */
function worksheet(c: Form4Counts): number {
  const v = (k: string) => c[k] ?? 0;
  const blank = (k: string) => !v(k);
  const counta = ['S', 'T', 'U', 'V', 'W', 'X'].some((k) => v(k) > 0);
  const noRiser = ['F', 'G', 'H', 'I', 'J', 'K'].every(blank);
  const stack = v('S') * 400 + v('T') * 300 + v('U') * 250 + v('V') * 200 + v('W') * 200 + v('X') * 200;
  return v('D') * 800 + v('E') * 800 + v('F') * 800 + v('G') * 800 + v('H') * 800 + v('I') * 800 + v('J') * 600 + v('K') * 600 + v('L') * 800 + v('P') * 800
    + v('M') * 500 + v('N') * 500 + v('O') * 500 + v('Q') * 500 + v('R') * 500
    + (noRiser ? 0 : 300)
    + (counta ? 600 : 0)
    + (counta && noRiser ? 300 : 0)
    + (stack > 1800 ? Math.floor((stack - 1801) / 1800 + 1) * 900 - (noRiser && counta ? 300 : 0) : 0);
}

describe('Form-4 MDB / SMDB enclosure sizing', () => {
  it('the mockup example: 2500 A incomer, 2 × 1250 A ACB risers, 630 A capacitor, 1000 A + 16 stacked → W5200', () => {
    const r = sizeForm4({ D: 1, I: 2, O: 1, Q: 1, T: 2, U: 4, V: 6, X: 4 });
    expect(r.stackMm).toBe(3600);
    expect(r.sections).toBe(2);
    expect(r.widthMm).toBe(5200);
    expect(r.dims).toEqual({ h: 2100, w: 5200, d: 800, plinth: 100 });
    expect(r.parts.reduce((s, p) => s + p.mm, 0)).toBe(r.widthMm);
  });

  it('an empty sheet gives W0, as the worksheet does', () => {
    expect(sizeForm4({}).widthMm).toBe(0);
  });

  it('stack boundaries: 1800 mm is one section, 1801 mm two, 3601 mm three', () => {
    expect(sizeForm4({ E: 1, X: 9 }).sections).toBe(1); // 1800
    expect(sizeForm4({ E: 1, X: 9 }).widthMm).toBe(800 + 600 + 300);
    expect(sizeForm4({ E: 1, X: 8, U: 1 }).sections).toBe(2); // 1850
    expect(sizeForm4({ E: 1, X: 18, S: 1 }).sections).toBe(3); // 4000
  });

  it('no riser and more than one section: the worksheet drops the first cable chamber (+300 − 300)', () => {
    const r = sizeForm4({ E: 1, X: 10 }); // 2000 mm stacked
    expect(r.widthMm).toBe(800 + 600 + 900);
    expect(r.parts.map((p) => p.label)).toEqual(['1 × 1600 A 4P ACB', 'Outgoing section 1', 'Outgoing section 2', 'Cable chamber']);
  });

  it('matches the worksheet formula for 2000 random boards', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let i = 0; i < 2000; i++) {
      const c: Form4Counts = {};
      for (const col of FORM4_COLUMNS) if (rnd(3) === 0) c[col.id] = rnd(col.group === 'stacked' ? 12 : 3);
      expect(sizeForm4(c).widthMm, JSON.stringify(c)).toBe(worksheet(c));
    }
  });

  it('stacks the devices into their sections without passing 1800 mm', () => {
    const counts = { S: 3, T: 4, U: 4, X: 6 }; // 1200 + 1200 + 1000 + 1200 = 4600 → 3 sections
    const r = sizeForm4(counts);
    const s = stackSections(counts, r.sections);
    expect(s).toHaveLength(3);
    expect(s.flat()).toHaveLength(17);
    for (const sec of s) expect(sec.reduce((h, c) => h + c.heightMm!, 0)).toBeLessThanOrEqual(1800);
  });

  it('saves a clean frozen copy', () => {
    const s = form4Selection({ D: 1, Q: 0, X: 2.7 }, 'manual');
    expect(s.counts).toEqual({ D: 1, X: 2 });
    expect(s.dims.w).toBe(800 + 600 + 300);
  });
});

describe('Form-4 quantities from the SLD', () => {
  const feeder = (id: string, boardId: string, breakerRatingA: number, extra: Partial<Feeder> = {}): Feeder =>
    ({ id, boardId, name: id, loadKw: 10, demandFactor: 1, powerFactor: 0.9, lengthM: 10, cableCsaMm2: 16, cores: 4, breakerRatingA, breakerIcuKa: 50, ...extra });
  const project = (feeders: Feeder[], boards: Board[]): Project => ({ ...newProject('T'), boards, feeders });

  it('sorts an MDB\'s breakers into the worksheet columns', () => {
    const p = project([
      feeder('R1', 'MDB', 1250, { device: 'ACB', feedsBoardId: 'SMDB1' }),
      feeder('R2', 'MDB', 800, { feedsBoardId: 'SMDB2' }),
      feeder('S3', 'MDB', 400, { feedsBoardId: 'SMDB3' }), // small board feeder: an outgoing
      feeder('CAP', 'MDB', 630, { loadType: 'capacitor' }),
      feeder('O1', 'MDB', 1000), feeder('O2', 'MDB', 500), feeder('O3', 'MDB', 320), feeder('O4', 'MDB', 200), feeder('O5', 'MDB', 125), feeder('O6', 'MDB', 63)
    ], [{ id: 'MDB', name: 'MDB', kind: 'MDB', supply: { ratingA: 2500 }, standby: { kva: 1000, changeover: 'ACB' } }]);
    const { counts, notes } = form4FromSld(p, 'MDB');
    expect(counts).toEqual({ D: 2, I: 1, K: 1, O: 1, Q: 1, S: 1, T: 2, U: 1, V: 1, X: 1 });
    expect(notes.join(' ')).toMatch(/bus bar risers/);
  });

  it('an SMDB takes its incomer rating from the feeder above', () => {
    const p = project([feeder('F', 'MDB', 1000, { feedsBoardId: 'SMDB' }), feeder('a', 'SMDB', 100)],
      [{ id: 'MDB', name: 'MDB', kind: 'MDB' }, { id: 'SMDB', name: 'SMDB', kind: 'SMDB', upstreamId: 'MDB' }]);
    const r = form4FromSld(p, 'SMDB');
    expect(r.counts).toEqual({ E: 1, X: 1 });
    expect(r.items[0].note).toMatch(/1000 A counted in the 1600 A/);
  });
});
