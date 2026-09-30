import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sampleProject } from '../data/sampleProject';
import { buildBom } from './bom';
import { compareBom, newPriceList, priceBom } from '../model/priceList';
import { buildBoqWorkbook, buildPriceTemplate, readPriceWorkbook } from '../docs/boqWorkbook';
import { workbookBytes } from '../docs/formWorkbook';
import { runsOf } from './electrical';

const p = sampleProject;

describe('bill of materials', () => {
  const bom = buildBom(p);
  it('has a panel per board and a breaker per feeder', () => {
    expect(bom.filter((x) => x.section === 'A').reduce((a, x) => a + x.qty, 0)).toBe(p.boards.length);
    const breakers = bom.filter((x) => /^(mcb|mccb|acb):/.test(x.key)).reduce((a, x) => a + x.qty, 0);
    expect(breakers).toBe(p.feeders.length);
  });
  it('rolls up cable metres including parallel runs', () => {
    const cableM = bom.filter((x) => x.key.startsWith('cable:') || x.key.startsWith('wire:')).reduce((a, x) => a + x.qty, 0);
    const expected = p.feeders.reduce((a, f) => a + f.lengthM * runsOf(f), 0);
    expect(cableM).toBeGreaterThanOrEqual(Math.floor(expected));
    expect(cableM).toBeLessThanOrEqual(Math.ceil(expected) + bom.length);
  });
  it('adds glands at both ends of sub-main cables', () => {
    const glands = bom.filter((x) => x.key.startsWith('gland:')).reduce((a, x) => a + x.qty, 0);
    expect(glands).toBe(p.feeders.filter((f) => !f.phase).reduce((a, f) => a + 2 * runsOf(f), 0));
  });
  it('adds the transformer, generator and protection from the boards', () => {
    const q = { ...p, boards: p.boards.map((b, i) => (i === 0 ? { ...b, standby: { kva: 500, changeover: 'ACB' as const }, protection: { ctRatio: '1600/5A', relays: ['ELR' as const] } } : b)) };
    const keys = buildBom(q).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['gen:500', 'ct:1600/5A', 'relay:ELR']));
    expect(keys.some((k) => k.startsWith('acb-il:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('tx:'))).toBe(true);
  });
});

describe('pricing', () => {
  const items = buildBom(p);
  it('uses the list first, then typical rates, and adds markup', () => {
    const k = items.find((x) => x.key.startsWith('panel:'))!.key;
    const l = { ...newPriceList(), markupPct: 10, rates: { [k]: { rate: 1000, labour: 200 } } };
    const b = priceBom(items, l);
    const it = b.items.find((x) => x.key === k)!;
    expect(it.source).toBe('list');
    expect(it.amount).toBe(it.qty * 1200);
    expect(b.items.some((x) => x.source === 'typical')).toBe(true);
    expect(b.missing).toBeGreaterThan(0);
    expect(b.total).toBeCloseTo(b.subtotal * 1.1);
  });
  it('compares with an earlier design', () => {
    const later = { ...p, feeders: p.feeders.map((f, i) => (i === 0 ? { ...f, lengthM: f.lengthM + 50 } : f)) };
    const ch = compareBom(items, buildBom(later));
    expect(ch.some((c) => c.key.startsWith('cable:') && c.delta === 50 * runsOf(p.feeders[0]))).toBe(true);
  });
  it('writes the Excel BOQ and reads rates back from the template', async () => {
    const wb = buildBoqWorkbook(p, priceBom(items));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'BOQ']);
    const t = buildPriceTemplate(items);
    t.worksheets[0].getCell(2, 4).value = 123;
    t.worksheets[0].getCell(3, 4).value = 45;
    t.worksheets[0].getCell(3, 5).value = 5;
    const back = new ExcelJS.Workbook();
    const bytes = await workbookBytes(t);
    await back.xlsx.load(bytes.buffer as ArrayBuffer);
    const r = await readPriceWorkbook(bytes.buffer as ArrayBuffer, items);
    expect(r.read).toBe(2);
    expect(r.rates[items[0].key].rate).toBe(123);
    expect(r.rates[items[1].key]).toMatchObject({ rate: 45, labour: 5 });
  });
});

describe('your own BOQ lines and adjustments', () => {
  const items = buildBom(p);
  const cable = items.find((x) => x.key.startsWith('cable:'))!;
  it('adds manual items in your own section', () => {
    const b = priceBom(items, undefined, { sections: [{ id: 'K', title: 'Testing' }], manual: [{ id: 'x', section: 'K', description: 'T&C', unit: 'LS', qty: 1, rate: 5000, labour: 500 }] });
    const k = b.sections.find((s) => s.section === 'K')!;
    expect(k.title).toBe('Testing');
    expect(k.amount).toBe(5500);
    expect(k.items[0].source).toBe('manual');
  });
  it('applies wastage, your quantity and by-others', () => {
    const w = priceBom(items, undefined, { wastage: { E: 10 } }).items.find((x) => x.key === cable.key)!;
    expect(w.qty).toBe(Math.ceil(cable.qty * 1.1));
    const o = priceBom(items, undefined, { overrides: { [cable.key]: { qty: 999, designQty: cable.qty } } }).items.find((x) => x.key === cable.key)!;
    expect(o.qty).toBe(999);
    expect(o.designQty).toBe(cable.qty);
    expect(o.changed).toBe(false);
    const ex = priceBom(items, undefined, { overrides: { [cable.key]: { excluded: true } } }).items.find((x) => x.key === cable.key)!;
    expect(ex.amount).toBe(0);
    expect(ex.source).toBe('excluded');
  });
  it('flags a line when the design quantity moved after you adjusted it', () => {
    const o = priceBom(items, undefined, { overrides: { [cable.key]: { qty: 5, designQty: cable.qty - 1 } } });
    expect(o.changed).toBe(1);
  });
  it('takes the discount off the total with markup', () => {
    const b = priceBom(items, { ...newPriceList(), markupPct: 10 }, { discountPct: 5 });
    expect(b.total).toBeCloseTo(b.subtotal * 1.1 * 0.95);
  });
});
