import { describe, expect, it } from 'vitest';
import type { BomItem } from '../calc/bom';
import { sampleProject } from '../data/sampleProject';
import { buildVariationHtml, buildVariationWorkbook } from '../docs/variationReport';
import type { Project } from '../types';
import { issueBoqRevision, numberBom } from './boqRevisions';
import { newPriceList, priceBom } from './priceList';
import { contractRate, foldVariations, netOf, nextVariationId, saveVariation, setContractRevision, valueOf, variationTotals, type Variation } from './variations';

const items: BomItem[] = [
  { key: 'a', section: 'E', description: 'Cable A', unit: 'm', qty: 100, where: [] },
  { key: 'b', section: 'B', description: 'MCB 20 A', unit: 'no', qty: 4, where: [] }
];
const list = { ...newPriceList(), rates: { a: { rate: 10, labour: 2 }, b: { rate: 180 } } };
const base: Project = { ...sampleProject, priceList: list, boq: { vatPct: 5 }, boqRevisions: undefined, variations: undefined };
const bomOf = (p: Project) => numberBom(priceBom(items, p.priceList, p.boq), p.boqRevisions);
const contracted = (): Project => setContractRevision(issueBoqRevision(base, bomOf(base), { description: 'Contract', date: '2026-09-01' }, 'AED'), '0');
const vo = (id: string, status: Variation['status'], lines: Variation['lines'], extra: Partial<Variation> = {}): Variation => ({ id, title: `Change ${id}`, raised: '2026-10-01', status, lines, ...extra });

describe('variation account', () => {
  it('adds approved variations to the contract BOQ revision, and submitted ones to the anticipated final sum', () => {
    let p = contracted();
    expect(variationTotals(p).contractSum).toBe(100 * 12 + 4 * 180);
    p = saveVariation(p, vo('VO-001', 'approved', [{ id: '1', key: 'b', no: 'B.1', description: 'MCB 20 A', unit: 'no', add: 2, rate: 180 }], { approvedValue: 350 }));
    p = saveVariation(p, vo('VO-002', 'submitted', [{ id: '1', key: 'a', no: 'E.1', description: 'Cable A', unit: 'm', omit: 20, rate: 12 }]));
    p = saveVariation(p, vo('VO-003', 'draft', [{ id: '1', no: 'VO-003/1', description: 'EV charger point', unit: 'no', add: 1, rate: 2400 }]));
    p = saveVariation(p, vo('VO-004', 'rejected', [{ id: '1', no: 'VO-004/1', description: 'Alternative', unit: 'no', add: 1, rate: 99 }]));
    const t = variationTotals(p);
    expect([t.approvedSum, t.revised, t.pendingSum, t.anticipated]).toEqual([350, 1920 + 350, -240, 1920 + 350 - 240]);
    expect(t.drafts.map((v) => v.id)).toEqual(['VO-003']);
    expect(t.closed.map((v) => v.id)).toEqual(['VO-004']);
    expect(nextVariationId(p)).toBe('VO-005');
    expect(netOf(p.variations![0])).toBe(360);
    expect(valueOf(p.variations![0])).toBe(350);
  });

  it('prices BOQ items at the contract rate, not the current one', () => {
    const p = contracted();
    const later = { ...p, priceList: { ...list, rates: { ...list.rates, b: { rate: 200 } } } };
    expect(contractRate(later, bomOf(later), 'b')).toBe(180);
  });

  it('brings approved variations into the working BOQ without counting them twice once that revision is the contract', () => {
    let p = contracted();
    p = saveVariation(p, vo('VO-001', 'approved', [
      { id: '1', key: 'b', no: 'B.1', description: 'MCB 20 A', unit: 'no', add: 2, rate: 180 },
      { id: '2', no: 'VO-001/1', description: 'Twin socket outlet', unit: 'no', add: 6, rate: 250, section: 'V' }
    ]));
    p = foldVariations(p, items, bomOf(p), ['VO-001']);
    expect(p.variations![0].foldedInto).toBe('1');
    const bom = bomOf(p);
    expect(bom.items.find((x) => x.key === 'b')?.qty).toBe(6);
    expect(bom.items.find((x) => x.description === 'Twin socket outlet')).toMatchObject({ qty: 6, section: 'V', amount: 1500 });
    expect(variationTotals(p).approvedSum).toBe(360 + 1500);
    // Re-issued as Rev 1 and marked as the contract: VO-001 is now inside the contract sum.
    p = setContractRevision(issueBoqRevision(p, bom, { description: 'Contract with VO-001', date: '2026-10-10' }, 'AED'), '1');
    const t = variationTotals(p);
    expect(t.approvedSum).toBe(0);
    expect(t.inContract.map((v) => v.id)).toEqual(['VO-001']);
    expect(t.contractSum).toBe(1920 + 360 + 1500);
  });

  it('prints the register with the contract sum and one sheet per variation, drafts left out', () => {
    let p = contracted();
    p = saveVariation(p, vo('VO-001', 'approved', [{ id: '1', key: 'b', no: 'B.1', description: 'MCB 20 A', unit: 'no', add: 2, rate: 180 }], { reference: 'SI-012', decided: '2026-10-08' }));
    p = saveVariation(p, vo('VO-002', 'draft', [{ id: '1', no: 'VO-002/1', description: 'EV <charger>', unit: 'no', add: 1, rate: 2400 }]));
    const html = buildVariationHtml(p, { date: '2026-10-13' });
    expect(html).toContain('Original contract sum — BOQ Rev 0 (excluding VAT)');
    expect(html).toContain('Revised contract sum</td><td class="n">2,280.00');
    expect(html).toContain('Variation order VO-001');
    expect(html).not.toContain('Variation order VO-002');
    expect(html).toContain('Draft variations (VO-002) are not included.');
    expect(html).toContain('VAT (5 %)');
    const one = buildVariationHtml(p, { register: false, sheets: ['VO-002'] });
    expect(one).toContain('Variation order VO-002');
    expect(one).toContain('EV &lt;charger&gt;');
    expect(one).not.toContain('<charger>');
    expect(one).not.toContain('<h2>Variation register</h2>');
    const wb = buildVariationWorkbook(p);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Variation register', 'Variation lines']);
    expect(wb.getWorksheet('Variation register')!.getRow(5).getCell(1).value).toBe('VO-001');
  });

  it('keeps the variation account out of design revision snapshots', async () => {
    const { snapshotOf } = await import('./revisions');
    expect('variations' in snapshotOf(saveVariation(base, vo('VO-001', 'draft', [])))).toBe(false);
  });
});
