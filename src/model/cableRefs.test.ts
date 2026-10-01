import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { cableRefOf, cableRefsUsed, STANDARD_CABLES, withCableRefs } from './cableRefs';

describe('cable reference numbers', () => {
  it('has a fixed standard list', () => {
    expect(STANDARD_CABLES[0]).toMatchObject({ ref: 1, text: '4C 300mm² Cu XLPE/SWA/PVC + 1C 150mm² Cu/PVC G/Y AS ECC' });
    expect(STANDARD_CABLES.find((c) => c.text.startsWith('2C 4mm²'))!.ref).toBe(STANDARD_CABLES.length);
  });
  it('gives a new cable type the next free number and keeps it', () => {
    const f = { ...sampleProject.feeders[0], id: 'X1', cableType: 'XLPE/PVC', cableCsaMm2: 240, cores: 4 };
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
