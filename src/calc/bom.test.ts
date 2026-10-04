import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sampleProject } from '../data/sampleProject';
import { buildBom } from './bom';
import { compareBom, newPriceList, priceBom } from '../model/priceList';
import { buildBoqWorkbook, buildPriceTemplate, readPriceWorkbook } from '../docs/boqWorkbook';
import { workbookBytes } from '../docs/formWorkbook';
import { runsOf } from './electrical';
import { BUILTIN_CATALOGUES, selectionFrom, sizeEnclosure } from './enclosure';
import type { Board, Feeder, Project } from '../types';

const p = sampleProject;

describe('bill of materials', () => {
  const bom = buildBom(p);
  it.each([['ACB', 'MCCB'], ['MCCB', 'C']] as const)('uses the selected %s device even when calculation type is %s', (device, breakerType) => {
    const f = { ...p.feeders[0], device, breakerType };
    const rows = buildBom({ ...p, boards: [], feeders: [f] });
    expect(rows.filter((x) => /^(acb|mccb|mcb):/.test(x.key))).toHaveLength(1);
    expect(rows.find((x) => x.key.startsWith(`${device.toLowerCase()}:`))?.qty).toBe(1);
  });
  it('has a panel per board and a breaker per feeder', () => {
    expect(bom.filter((x) => x.section === 'A').reduce((a, x) => a + x.qty, 0)).toBe(p.boards.length);
    const breakers = bom.filter((x) => /^(mcb|mccb|acb):/.test(x.key)).reduce((a, x) => a + x.qty, 0);
    expect(breakers).toBe(p.feeders.length);
  });
  it('rolls up sub-main cable metres including parallel runs', () => {
    const cableM = bom.filter((x) => x.key.startsWith('cable:')).reduce((a, x) => a + x.qty, 0);
    const expected = p.feeders.filter((f) => !f.phase).reduce((a, f) => a + f.lengthM * runsOf(f), 0);
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

describe('contractor takeoff corrections', () => {
  const root: Board = { id: 'MDB', name: 'Main board', kind: 'MDB', ratedCurrentA: 400, instruments: false, earthing: { show: false } };
  const db: Board = { id: 'DB', name: 'Test DB', kind: 'DB', upstreamId: root.id, ratedCurrentA: 63, elcbGroupSize: 6, elcbRatingA: 63, elcbSensitivityMa: 30 };
  const circuit = (patch: Partial<Feeder> = {}): Feeder => ({
    id: 'R1', boardId: db.id, name: 'Final circuit', phase: 'R', way: 1, cores: 2,
    lengthM: 10, cableCsaMm2: 2.5, cpcMm2: 1.5, breakerRatingA: 16, breakerIcuKa: 10,
    loadKw: 1, demandFactor: 1, powerFactor: 1, ...patch
  });
  const project = (feeders: Feeder[], boards = [root, db]): Project => ({ ...p, boards, feeders });
  const six = [1, 2].flatMap((way) => (['R', 'Y', 'B'] as const).map((phase) => circuit({ id: `${phase}${way}`, phase, way })));

  it('includes four grouped ELCBs from the existing 21-circuit sample DB', () => {
    const rccbs = buildBom(p).filter((x) => x.key.startsWith('rccb:'));
    expect(rccbs.reduce((s, x) => s + x.qty, 0)).toBe(4);
    expect(rccbs.every((x) => x.description.includes('TP+N'))).toBe(true);
  });

  it('counts one RCCB per six circuits or per three circuits without per-circuit duplicates', () => {
    const withRcd = six.map((f) => ({ ...f, rcdMa: 30 }));
    const grouped = buildBom(project(withRcd));
    expect(grouped.filter((x) => x.key.startsWith('rccb:'))).toEqual([
      expect.objectContaining({ key: 'rccb:30:TP+N:63', qty: 1, quantitySource: 'Load schedule ELCB groups' })
    ]);
    expect(grouped.some((x) => x.key.startsWith('rcd:'))).toBe(false);
    const three = buildBom(project(withRcd, [root, { ...db, elcbGroupSize: 3 }]));
    expect(three.find((x) => x.key === 'rccb:30:TP+N:63')?.qty).toBe(2);
    const individual = buildBom(project(withRcd, [root, { ...db, elcbGroupSize: 0 }]));
    expect(individual.some((x) => x.key.startsWith('rccb:'))).toBe(false);
    expect(individual.filter((x) => x.key.startsWith('rcd:')).reduce((s, x) => s + x.qty, 0)).toBe(6);
  });

  it('retains independent feeder RCDs and uses two poles for a single-phase DB group', () => {
    const items = buildBom(project([
      circuit(),
      circuit({ id: 'MDB-OUT', boardId: root.id, phase: undefined, way: undefined, rcdMa: 300, cores: 4 })
    ]));
    expect(items.find((x) => x.key === 'rccb:30:SP+N:63')?.qty).toBe(1);
    expect(items.find((x) => x.key === 'rcd:300:TP+N:16')?.qty).toBe(1);
  });

  it('measures a 10 m two-wire circuit as 20 m of L/N and 10 m of its separate CPC', () => {
    const items = buildBom(project([circuit()]));
    expect(items.find((x) => x.key === 'wire-conductor:2.5')).toMatchObject({ unit: 'm', qty: 20 });
    expect(items.find((x) => x.key === 'cpc:1.5')).toMatchObject({ unit: 'm', qty: 10 });
    expect(items.some((x) => x.key.startsWith('wire:'))).toBe(false);
    expect(items.some((x) => /conduit/.test(x.key))).toBe(false);
  });

  it('measures three-phase parallel wiring and rounds only after adding matching conductor lengths', () => {
    const items = buildBom(project([
      circuit({ id: 'TP', phase: 'RYB', cores: 4, parallel: 2, lengthM: 10.1 }),
      circuit({ id: 'R2', way: 2, lengthM: 0.1 })
    ]));
    // 4 × 2 × 10.1 + 2 × 0.1 = 81 conductor metres; CPC = 20.3, rounded to 21.
    expect(items.find((x) => x.key === 'wire-conductor:2.5')?.qty).toBe(81);
    expect(items.find((x) => x.key === 'cpc:1.5')?.qty).toBe(21);
  });

  it('does not reuse legacy complete-circuit wire rates for conductor metres', () => {
    const priced = priceBom(buildBom(project([circuit()])), { ...newPriceList(), rates: { 'wire:2.5': { rate: 999 } } });
    expect(priced.items.find((x) => x.key === 'wire-conductor:2.5')).toMatchObject({ source: 'missing', rate: undefined });
  });

  it('separates panels by busbar material, manufacturer and model while merging identical specifications', () => {
    const boards: Board[] = [
      { ...db, id: 'CU1', busbarMaterial: 'copper', manufacturer: 'Brand A', model: 'Range 1' },
      { ...db, id: 'CU2', busbarMaterial: 'copper', manufacturer: 'Brand A', model: 'Range 1' },
      { ...db, id: 'AL', busbarMaterial: 'aluminium', manufacturer: 'Brand A', model: 'Range 1' },
      { ...db, id: 'BRAND', busbarMaterial: 'copper', manufacturer: 'Brand B', model: 'Range 1' },
      { ...db, id: 'MODEL', busbarMaterial: 'copper', manufacturer: 'Brand A', model: 'Range 2' }
    ];
    const panels = buildBom(project([], boards)).filter((x) => x.key.startsWith('panel:'));
    expect(panels).toHaveLength(4);
    expect(panels.find((x) => x.where.includes('CU1'))).toMatchObject({ qty: 2, where: ['CU1', 'CU2'] });
    expect(panels.find((x) => x.where.includes('AL'))?.description).toContain('Al busbar');
  });

  it('takes an authority incomer and meter from supply settings, independently of the busbar rating', () => {
    const authority = { ...root, ratedCurrentA: undefined, supply: { device: 'MCCB' as const, ratingA: 250, meter: 'CT' as const } };
    const items = buildBom(project([], [authority]));
    expect(items.find((x) => x.key === 'incomer:MCCB:250')?.qty).toBe(1);
    expect(items.find((x) => x.key === 'kwh:CT')?.qty).toBe(1);
    const largerBus = buildBom(project([], [{ ...authority, ratedCurrentA: 400 }]));
    expect(largerBus.find((x) => x.key.startsWith('panel:'))?.description).toContain('400 A');
    expect(largerBus.find((x) => x.key === 'incomer:MCCB:250')?.qty).toBe(1);
  });

  it('separates saved surface, flush, revised and resized enclosures while merging identical specifications', () => {
    const catalogue = BUILTIN_CATALOGUES[0];
    const input = { equipmentModules: 64, spareModules: 8, elcbCount: 10 };
    const enclosure = (mounting: 'surface' | 'flush') => {
      const result = sizeEnclosure(catalogue, input, mounting);
      return selectionFrom(catalogue, result.candidates[0], input, mounting, result.required);
    };
    const surface = enclosure('surface');
    const flush = enclosure('flush');
    const boards = [
      { ...db, id: 'S1', enclosure: surface }, { ...db, id: 'S2', enclosure: structuredClone(surface) },
      { ...db, id: 'F', enclosure: flush }, { ...db, id: 'REV', enclosure: { ...surface, revision: 'revised' } },
      { ...db, id: 'SIZE', enclosure: { ...surface, dims: { ...surface.dims!, h: surface.dims!.h + 10 } } }
    ];
    const panels = buildBom(project([], boards)).filter((x) => x.key.startsWith('panel:'));
    expect(panels).toHaveLength(4);
    expect(panels.find((x) => x.where.includes('S1'))).toMatchObject({ qty: 2, where: ['S1', 'S2'] });
    expect(panels.find((x) => x.where.includes('F'))?.description).toContain('flush mounted');
    expect(panels.find((x) => x.where.includes('F'))?.description).toContain(`H${flush.dims!.h}`);
    expect(panels.find((x) => x.where.includes('REV'))?.description).toContain('rev. revised');
  });

  it('takes an explicit feeder isolator instead of inventing an MCCB', () => {
    const items = buildBom(project([circuit({ device: 'ISOL', breakerType: 'MCCB' })]));
    expect(items.find((x) => x.key === 'switch-isol:16:SP')?.qty).toBe(1);
    expect(items.some((x) => x.key.startsWith('mccb:'))).toBe(false);
  });

  it('keeps schedule points opt-in and flags plant supply as client responsibility', () => {
    const q = project([circuit({ points: { ltg: 4, s13: 3, pump: 1, sac: 2, exfan: 1 } })]);
    expect(buildBom(q).some((x) => x.section === 'J')).toBe(false);
    const points = buildBom({ ...q, boq: { includeSchedulePoints: true } }).filter((x) => x.section === 'J');
    expect(points.reduce((s, x) => s + x.qty, 0)).toBe(11);
    expect(points.find((x) => x.key.startsWith('point:ltg:'))).toMatchObject({ qty: 4, supplyBy: 'contractor', quantitySource: 'Load schedule point counts' });
    expect(points.find((x) => x.key.startsWith('point:s13:'))).toMatchObject({ qty: 3, supplyBy: 'contractor' });
    for (const type of ['pump', 'sac', 'exfan']) expect(points.find((x) => x.key.startsWith(`point:${type}:`))?.supplyBy).toBe('client');
  });

  it('keeps selected point products and custom spare descriptions distinct across DBs', () => {
    const second: Board = { ...db, id: 'DB2', pointItems: { ltg: 'Panel light' }, spareNames: { spare1: 'IT rack' } };
    const q = project([
      circuit({ points: { ltg: 4, spare1: 1 } }),
      circuit({ id: 'DB2-R1', boardId: second.id, points: { ltg: 2, spare1: 2 } })
    ], [root, { ...db, pointItems: { ltg: 'Downlight' }, spareNames: { spare1: 'Coffee machine' } }, second]);
    const points = buildBom({ ...q, boq: { includeSchedulePoints: true } }).filter((x) => x.section === 'J');
    expect(points).toHaveLength(4);
    expect(points.find((x) => x.key === 'point:ltg:Downlight')?.qty).toBe(4);
    expect(points.find((x) => x.key === 'point:ltg:Panel%20light')?.qty).toBe(2);
    expect(points.find((x) => x.key === 'point:spare1:IT%20rack')).toMatchObject({ qty: 2, supplyBy: 'client' });
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

describe('instruments and earthing', () => {
  it('main boards get instruments and earth pits by default; the panel can switch them off', () => {
    const keys = buildBom(p).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['ammeter-ss', 'voltmeter-ss', 'lamps-ryb', 'earth-pit:3']));
    expect(buildBom(p).find((x) => x.key === 'earth-pit:3')!.qty).toBe(p.boards.filter((b) => !b.upstreamId).length * 2);
    const off = { ...p, boards: p.boards.map((b) => ({ ...b, instruments: false, earthing: { show: false } })) };
    expect(buildBom(off).some((x) => x.key === 'ammeter-ss' || x.key.startsWith('earth-pit'))).toBe(false);
  });
});
