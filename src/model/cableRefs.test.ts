import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { cableRefOf, cableRefsUsed, STANDARD_CABLES, withCableRefs } from './cableRefs';

describe('cable reference numbers', () => {
  it('has a fixed standard list', () => {
    expect(STANDARD_CABLES[0]).toMatchObject({ ref: 1, text: '4C 300mm² Cu XLPE/SWA/PVC + 1C 150mm² Cu/PVC G/Y AS ECC' });
    expect(STANDARD_CABLES.find((c) => c.text.startsWith('2C 4mm²'))!.ref).toBe(26);
    expect(STANDARD_CABLES.find((c) => c.text === '4C 150mm² Cu XLPE/SWA/PVC + 1C 70mm² Cu/PVC G/Y AS ECC')!.ref).toBe(27);
    expect(STANDARD_CABLES.find((c) => c.text === '3C 50mm² Cu XLPE/SWA/PVC + 1C 25mm² Cu/PVC G/Y AS ECC')!.ref).toBe(16);
  });
  it('gives a new cable type the next free number and keeps it', () => {
    const f = { ...sampleProject.feeders[0], id: 'X1', cableType: 'XLPE/PVC', cableCsaMm2: 240, cores: 4 as const };
    const p = withCableRefs({ ...sampleProject, feeders: [...sampleProject.feeders, f] });
    const r = cableRefOf(p, f);
    expect(r.ref).toBeGreaterThan(STANDARD_CABLES.length);
    expect(r.text).toContain('XLPE/PVC');
    const again = withCableRefs({ ...p, feeders: [...p.feeders, { ...f, id: 'X2' }] });
    expect(again.cableRefs).toBe(p.cableRefs); // nothing new
  });
  it('fire-rated cable uses the number of the same size, marked *', () => {
    const f = { ...sampleProject.feeders[0], cableType: 'FR BS 8491' };
    const plain = { ...sampleProject.feeders[0], cableType: undefined, essential: false };
    expect(cableRefOf(sampleProject, f).ref).toBe(cableRefOf(sampleProject, plain).ref);
    expect(cableRefOf(sampleProject, f).fireRated).toBe(true);
    expect(cableRefsUsed(sampleProject).length).toBeGreaterThan(0);
  });
});

describe('cable schedule from the database', () => {
  it('reads CableSchedule.xlsx rows and uses them on the drawings', async () => {
    const { parseDatabase } = await import('../database/database');
    const { setCatalog, EMPTY_CATALOG } = await import('../database/catalog');
    const raw = { readAt: '', books: { cableSchedule: { file: 'CableSchedule.xlsx', rows: [
      { _row: 2, ref: 101, cores: '4C', size: 300, construction: 'XLPE/SWA/PVC', ecc: 150, description: 'My 300' },
      { _row: 3, ref: 102, cores: '2x1C', size: 16, construction: 'XLPE/SWA/PVC', ecc: 16 },
      { _row: 4, ref: 102, cores: '4C', size: 10 }
    ] } } };
    const db = parseDatabase(raw as never);
    expect(db.catalog!.cableRefs.map((r) => r.ref)).toEqual([101, 102]);
    expect(db.issues.some((i) => i.includes('duplicate Ref no. 102'))).toBe(true);
    setCatalog(db.catalog!);
    try {
      const inc = sampleProject.feeders.find((f) => f.cableCsaMm2 === 300 && f.cores === 4 && !f.cpcMm2)!;
      expect(cableRefOf(sampleProject, inc)).toMatchObject({ ref: 101, text: 'My 300' });
    } finally { setCatalog(EMPTY_CATALOG); }
  });
});
