import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { BomItem } from '../calc/bom';
import type { BoqCustom, PricedBom } from '../model/priceList';
import { newPriceList, priceBom } from '../model/priceList';
import { boqReview, SCOPE_CHECKS } from '../model/boqScope';
import { sampleProject } from '../data/sampleProject';
import { amountInWords, boqBookmarks, buildBoqHtml, buildBoqWorkbook, buildPriceTemplate, readPriceWorkbook } from './boqWorkbook';
import { EXPORT_NUMBERS } from '../../tests/fixtures/exportNumbers';
import { EMPTY_BYTES, MALFORMED_OFFICE_BYTES } from '../../tests/fixtures/importExport';

const item: BomItem = { key: 'test:cable', section: 'E', description: 'Measured cable', unit: 'm', qty: 2, where: ['DB-1'] };
const project = (boq?: BoqCustom) => ({ ...sampleProject, boq });
const itemRow = (wb: ExcelJS.Workbook) => {
  const sheet = wb.getWorksheet('BOQ')!;
  const rows: ExcelJS.Row[] = [];
  sheet.eachRow((row) => { if (/^[A-Z]\.\d+$/.test(String(row.getCell(1).value ?? ''))) rows.push(row); });
  return rows;
};
const bodyRow = (html: string, text: string) => html.split('<tr>').find((row) => row.includes(text))!;
const empty: PricedBom = { items: [], sections: [], subtotal: 0, markup: 0, discount: 0, total: 0, vat: 0, grandTotal: 0, missing: 0, changed: 0 };

describe('BOQ scope exports', () => {
  it('keeps the established worksheets for legacy projects and adds scope evidence only with a selected template', () => {
    expect(buildBoqWorkbook(project(), empty).worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'BOQ']);
    expect(buildBoqWorkbook(project({ projectType: 'fit-out' }), empty).worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'BOQ', 'Scope review']);
    expect(buildBoqHtml(project({ projectType: 'new-installation' }), empty, undefined, true)).toContain('Scope template: New installation');
  });

  it('charges only installation for client-supplied equipment in Excel and PDF', () => {
    const list = { ...newPriceList(), rates: { [item.key]: { rate: 100, labour: 15 } } };
    const custom: BoqCustom = { overrides: { [item.key]: { supplyBy: 'client', installBy: 'contractor', evidence: 'Site survey drawing E-101' } } };
    const bom = priceBom([item], list, custom);
    expect(bom.total).toBe(30);
    const row = itemRow(buildBoqWorkbook(project(custom), bom, list))[0];
    expect(row.getCell(5).value).toBeNull();
    expect(row.getCell(6).value).toBe(15);
    expect(row.getCell(7).value).toEqual({ formula: `D${row.number}*(E${row.number}+F${row.number})`, result: 30 });
    const html = bodyRow(buildBoqHtml(project(custom), bom, list), item.description);
    expect(html).toContain('Supply by client');
    expect(html).toContain('Site survey drawing E-101');
    expect(html).toContain('15.00');
    expect(html).not.toContain('100.00');
    expect(html).not.toContain('TBA');
  });

  it('keeps explicit zero quotes priced and flags only missing legs', () => {
    const custom: BoqCustom = { manual: [
      { id: 'zero', section: 'J', description: 'Quoted zero allowance', unit: 'LS', qty: 1, rate: 0, labour: 0 },
      { id: 'partial', section: 'J', description: 'Supply quote outstanding', unit: 'no', qty: 2, labour: 10 },
      { id: 'install', section: 'J', description: 'Installation quote outstanding', unit: 'no', qty: 2, supplyBy: 'client' }
    ] };
    const bom = priceBom([], undefined, custom);
    const html = buildBoqHtml(project(custom), bom);
    const zero = bodyRow(html, 'Quoted zero allowance');
    expect(zero).toContain('0.00');
    expect(zero).not.toContain('TBA');
    const partial = bodyRow(html, 'Supply quote outstanding');
    expect(partial).toContain('20.00');
    expect(partial).toContain('20.00<sup>*</sup>');
    expect(partial).toContain('<i>TBA</i>');
    expect(bodyRow(html, 'Installation quote outstanding')).toContain('Not priced');
    const rows = itemRow(buildBoqWorkbook(project(custom), bom));
    expect(rows[0].getCell(5).value).toBe(0);
    expect(rows[0].getCell(6).value).toBe(0);
    expect(rows[1].getCell(5).value).toBeNull();
    expect(rows[1].getCell(6).value).toBe(10);
    expect(rows[1].getCell(7).value).toMatchObject({ result: 20 });
  });

  it('exports retained assets and included package components without counting them twice', () => {
    const custom: BoqCustom = { projectType: 'fit-out', scopeNotes: 'Fire alarm by specialist', manual: [
      { id: 'assembly', section: 'A', description: 'Complete DB assembly', unit: 'no', qty: 1, rate: 1000, labour: 100, evidence: 'Supplier quote Q-10' },
      { id: 'component', section: 'B', description: 'DB internal breaker', unit: 'no', qty: 3, rate: 50, includedIn: 'manual:assembly', evidence: 'Included in Q-10' },
      { id: 'existing', section: 'J', description: 'Existing cable retained', unit: 'm', qty: 25, rate: 10, action: 'retain', evidence: 'Survey drawing E-001' }
    ] };
    const bom = priceBom([], undefined, custom);
    expect(bom.total).toBe(1100);
    const wb = buildBoqWorkbook(project(custom), bom);
    const rows = itemRow(wb);
    expect(rows[1].getCell(7).value).toBe('Included in package: manual:assembly');
    expect(rows[2].getCell(7).value).toBe('Retained — no charge');
    const evidence = wb.getWorksheet('Scope review')!;
    expect(evidence.getCell(6, 5).value).toBe('Included in Q-10');
    expect(evidence.getCell(6, 6).value).toBe('manual:assembly');
    const html = buildBoqHtml(project(custom), bom);
    expect(html).toContain('Included in package: manual:assembly');
    expect(html).toContain('Retained — no charge');
    expect(html).toContain('Fire alarm by specialist');
  });

  it('escapes project, scope and quantity evidence in printable HTML', () => {
    const attack = '<script>alert("test")</script>';
    const custom: BoqCustom = { projectType: 'fit-out', scopeNotes: attack, manual: [
      { id: 'x', section: 'J', description: attack, unit: attack, qty: 1, rate: 0, evidence: attack, note: attack }
    ] };
    const html = buildBoqHtml({ ...project(custom), name: attack }, priceBom([], undefined, custom));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;');
  });

  it.each([-1, Number.NaN])('keeps invalid quantities visible without putting invalid numeric values or formulas in Excel (%s)', async (qty) => {
    const custom: BoqCustom = { manual: [{ id: 'invalid', section: 'J', description: 'Quantity awaiting confirmation', unit: 'no', qty, rate: 5 }] };
    const bom = priceBom([], undefined, custom);
    const wb = buildBoqWorkbook(project(custom), bom);
    const row = itemRow(wb)[0];
    expect(row.getCell(4).value).toBeNull();
    expect(row.getCell(7).value).toBe(0);
    expect(row.getCell(2).value).toContain('INVALID QUANTITY');
    expect(buildBoqHtml(project(custom), bom)).toContain('Invalid quantity — omitted from the total');
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    expect(itemRow(back)[0].getCell(7).value).toBe(0);
  });

  it('bounds summary-only scope warnings while keeping unreviewed scope visible', () => {
    const custom: BoqCustom = { projectType: 'fit-out', scopeNotes: `Start of scope notes ${'x'.repeat(500)} detailed exclusions end marker`, manual: Array.from({ length: 60 }, (_, index) => ({
      id: String(index), section: 'J', description: `Unquoted scope item ${index}`, unit: 'no', qty: 1
    })) };
    const bom = priceBom([], undefined, custom);
    const checks = boqReview(project(custom), bom);
    expect(checks.length).toBeGreaterThan(130);
    const html = buildBoqHtml(project(custom), bom, undefined, true);
    const brief = html.match(/<div class="box scope-brief[\s\S]*?<\/div>/)![0];
    expect(brief.match(/<li>/g)?.length).toBeLessThanOrEqual(3);
    expect(brief).toContain(`${checks.length} scope check(s) need review`);
    expect(brief).toContain('checklist area(s) not reviewed');
    expect(brief).toContain('Scope areas not reviewed');
    expect(html).not.toContain('id="boq-appendix"');
    expect(html).not.toContain('Unquoted scope item 59:');
    expect(html).not.toContain('detailed exclusions end marker');
    expect(html).toContain('full BOQ appendix');
  });

  it('places every outstanding check after the full bill in a scope appendix', () => {
    const custom: BoqCustom = { projectType: 'fit-out', manual: [{ id: 'x', section: 'J', description: 'Unquoted luminaire', unit: 'no', qty: 1 }] };
    const bom = priceBom([], undefined, custom);
    const html = buildBoqHtml(project(custom), bom);
    const appendixStart = html.indexOf('<section id="boq-appendix"');
    expect(appendixStart).toBeGreaterThan(html.indexOf('Total Bill J carried to grand summary'));
    const appendix = html.slice(appendixStart);
    for (const check of boqReview(project(custom), bom)) expect(appendix).toContain(check.message);
    expect(html.slice(0, appendixStart)).not.toContain('Scope not reviewed: Emergency lighting and exit signs.');
  });

  it('exports all checklist decisions, including declared exclusions and unreviewed areas', () => {
    const custom: BoqCustom = { projectType: 'fit-out', scopeReview: { lighting: 'included', emergency: 'by-others', elv: 'not-applicable' } };
    const wb = buildBoqWorkbook(project(custom), empty);
    const decisions = new Map<string, unknown>();
    wb.getWorksheet('Scope review')!.eachRow((row) => { if (SCOPE_CHECKS.some((check) => check.id === row.getCell(1).value)) decisions.set(String(row.getCell(1).value), row.getCell(3).value); });
    expect(decisions.size).toBe(SCOPE_CHECKS.length);
    expect(decisions.get('lighting')).toBe('Included');
    expect(decisions.get('emergency')).toBe('By others');
    expect(decisions.get('elv')).toBe('Not applicable');
    expect(decisions.get('documentation')).toBe('Not reviewed');
    const html = buildBoqHtml(project(custom), empty);
    expect(html).toContain('<td>Emergency lighting and exit signs</td><td>By others</td>');
    expect(html).toContain('<td>Data, fire alarm, CCTV, access control and other ELV scope</td><td>Not applicable</td>');
  });


  it('discloses critical migration and data checks for legacy projects without adding a template checklist', () => {
    const custom: BoqCustom = { includeSchedulePoints: true, overrides: { 'panel:DB:100:-': { excluded: true } }, manual: [
      { id: 'package', section: 'J', description: 'Breaker with unconfirmed package', unit: 'no', qty: 1, rate: 5, includedIn: 'manual:missing' },
      { id: 'qty', section: 'J', description: 'Invalid measured quantity', unit: 'no', qty: -1, rate: 5 },
      { id: 'rate', section: 'J', description: 'Invalid supply quote', unit: 'no', qty: 1, rate: -5 }
    ] };
    const list = { ...newPriceList(), rates: { 'wire:2.5': { rate: 2 }, 'panel:DB:100:-': { rate: 100 } } };
    const p = { ...project(custom), priceList: list, feeders: [{ ...sampleProject.feeders[0], name: 'Omitted socket points', points: { s13: 2 }, phase: undefined, way: undefined }] };
    const bom = priceBom([{ ...item, key: 'wire-conductor:2.5' }, { ...item, key: 'panel:DB:100:-:copper:-:-', section: 'A' }], list, custom);
    const checks = boqReview(p, bom).filter((check) => /^(orphan-override|legacy-wire-rate|legacy-panel-rate|package|schedule-omitted|quantity|invalid-rate):/.test(check.id));
    expect(checks.map((check) => check.id.split(':')[0])).toEqual(expect.arrayContaining(['orphan-override', 'legacy-wire-rate', 'legacy-panel-rate', 'package', 'schedule-omitted', 'quantity', 'invalid-rate']));
    const wb = buildBoqWorkbook(p, bom, list);
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'BOQ']);
    const summaryNotes: string[] = [];
    wb.getWorksheet('Summary')!.eachRow((row) => { const text = row.getCell(2).value; if (typeof text === 'string') summaryNotes.push(text); });
    const html = buildBoqHtml(p, bom, list);
    const appendix = html.slice(html.indexOf('<section id="boq-appendix"'));
    for (const check of checks) {
      expect(summaryNotes).toContain(check.message);
      expect(appendix).toContain(check.message);
    }
    expect(html).not.toContain('Scope not reviewed:');
    expect(html).not.toContain('Scope checklist decisions');
    expect(buildBoqHtml(p, bom, list, true)).toContain('BOQ data review');
  });
});

describe('installation-only price sheet quotes', () => {
  it('preserves zero, blank supply and nonzero installation rates after an Excel round trip', async () => {
    const items = [item, { ...item, key: 'test:install', description: 'Installation only' }, { ...item, key: 'test:blank', description: 'Unquoted' }];
    const template = buildPriceTemplate(items);
    const sheet = template.getWorksheet('Rates')!;
    sheet.getCell(2, 4).value = 0;
    sheet.getCell(2, 5).value = 0;
    sheet.getCell(3, 5).value = 45;
    const bytes = await template.xlsx.writeBuffer();
    const read = await readPriceWorkbook(bytes as ArrayBuffer, items);
    expect(read.read).toBe(2);
    expect(read.rates[item.key]).toMatchObject({ rate: 0, labour: 0 });
    expect(read.rates['test:install']).toMatchObject({ labour: 45 });
    expect(read.rates['test:install'].rate).toBeUndefined();
    expect(read.rates['test:blank']).toBeUndefined();
  });

  it('rejects empty, malformed and structurally incomplete price workbooks', async () => {
    await expect(readPriceWorkbook(EMPTY_BYTES.buffer, [item])).rejects.toThrow('workbook is empty');
    await expect(readPriceWorkbook(MALFORMED_OFFICE_BYTES.buffer, [item])).rejects.toThrow('not a valid .xlsx');
    await expect(readPriceWorkbook((await buildPriceTemplate([item]).xlsx.writeBuffer()) as ArrayBuffer, [item])).rejects.toThrow('contains no rates');
    const missing = new ExcelJS.Workbook(); missing.addWorksheet('Rates').addRow(['Description']);
    await expect(readPriceWorkbook((await missing.xlsx.writeBuffer()) as ArrayBuffer, [item])).rejects.toThrow('needs a Supply rate or Install rate');
  });

  it('reports the Excel row for malformed or negative rates', async () => {
    const wb = buildPriceTemplate([item]);
    wb.getWorksheet('Rates')!.getCell(2, 4).value = 'not a number';
    await expect(readPriceWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer, [item])).rejects.toThrow('row 2 has an invalid supply rate');
    wb.getWorksheet('Rates')!.getCell(2, 4).value = -1;
    await expect(readPriceWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer, [item])).rejects.toThrow('row 2 has an invalid supply rate');
  });
});

describe('tender-format PDF BOQ', () => {
  const list = { ...newPriceList(), rates: { [item.key]: { rate: 100, labour: 15 } } };

  it('adds VAT after markup and discount, in the PDF, Excel and the totals', () => {
    const custom: BoqCustom = { discountPct: 10, vatPct: 5 };
    const bom = priceBom([item], { ...list, markupPct: 20 }, custom);
    expect(bom.total).toBeCloseTo(230 * 1.2 * 0.9);
    expect(bom.vat).toBeCloseTo(bom.total * 0.05);
    expect(bom.grandTotal).toBeCloseTo(bom.total * 1.05);
    const html = buildBoqHtml(project(custom), bom, list);
    expect(html).toContain('VAT (5 %)');
    expect(html).toContain('GRAND TOTAL (AED, including VAT)');
    const labels: unknown[] = [];
    buildBoqWorkbook(project(custom), bom, list).getWorksheet('Summary')!.eachRow((row) => labels.push(row.getCell(2).value));
    expect(labels).toEqual(expect.arrayContaining(['Total (excluding VAT)', 'VAT (5 %)', 'Grand total (including VAT)']));
    expect(priceBom([item], list, { vatPct: 150 }).vat).toBe(0);
  });

  it('uses the PDF quantity precision and units in Excel without changing calculation values', () => {
    const measured = { ...item, qty: EXPORT_NUMBERS.quantity };
    const bom = priceBom([measured], { ...list, rates: { [item.key]: { rate: 1, labour: 0 } } });
    const wb = buildBoqWorkbook(project(), bom);
    const row = itemRow(wb)[0];
    expect(row.getCell(3).value).toBe('m');
    expect(row.getCell(4).value).toBe(EXPORT_NUMBERS.quantity);
    expect(wb.getWorksheet('BOQ')!.getColumn(4).numFmt).toBe('#,##0.##');
    expect(buildBoqHtml(project(), bom)).toContain('<td class="n">1,234.57</td>');
    const template = buildPriceTemplate([measured]);
    expect(template.getWorksheet('Rates')!.getColumn(4).numFmt).toBe('#,##0.00');
    expect(template.getWorksheet('Rates')!.getColumn(5).numFmt).toBe('#,##0.00');
  });

  it('writes the grand total in words', () => {
    expect(amountInWords(202787, 'AED')).toBe('UAE Dirhams Two hundred and two thousand seven hundred and eighty-seven only');
    expect(amountInWords(1250.5, 'USD')).toBe('US Dollars One thousand two hundred and fifty and 50/100 only');
    expect(amountInWords(0, 'XYZ')).toBe('XYZ Zero only');
  });

  it('puts the document number, status and sign-off names on the cover and footer', () => {
    const custom: BoqCustom = { document: { docNo: 'VC-ELE-BOQ-001', status: 'Issued for tender', preparedBy: 'P. Engineer', checkedBy: 'C. Lead', approvedBy: 'A. Director' } };
    const html = buildBoqHtml(project(custom), priceBom([item], list, custom), list);
    expect(html).toContain('<tr><td>Document no.</td><td>VC-ELE-BOQ-001</td></tr>');
    expect(html).toContain('<tr><td>Status</td><td>Issued for tender</td></tr>');
    for (const name of ['P. Engineer', 'C. Lead', 'A. Director']) expect(html).toContain(name);
    expect(html).toMatch(/@bottom-left \{ content: "VC-ELE-BOQ-001 · Draft · \d{2} \w{3} \d{4}"/);
    expect(html).toContain('Tenderer’s name');
    expect(buildBoqHtml(project({ document: { status: 'Cost estimate' } }), priceBom([item], list), list)).not.toContain('Tenderer’s name');
  });

  it('heads every page after the cover with the company logo', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const html = buildBoqHtml({ ...project(), drawing: { ...sampleProject.drawing, logo } }, priceBom([item], list), list);
    expect(html).toContain(`@top-left { content: ""; width: 45mm; background: url("${logo}")`);
    expect(html).toContain('@page cover');
    expect(html).toContain(`<img class="logo" src="${logo}"`);
    const unsafe = buildBoqHtml({ ...project(), drawing: { ...sampleProject.drawing, logo: 'data:image/png;base64,x");}body{color:red' } }, priceBom([item], list), list);
    expect(unsafe.slice(unsafe.indexOf('<style>'), unsafe.indexOf('</style>'))).not.toContain('color:red');
  });

  it('keeps project text inside the stylesheet strings', () => {
    const html = buildBoqHtml({ ...project(), name: 'A "quoted" \\ name </style><script>x</script>' }, priceBom([item], list), list);
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(style).toContain('"A \\"quoted\\" \\\\ name \\3c /style>\\3c script>x\\3c /script>   ·   BILL OF QUANTITIES"');
    expect(html).not.toContain('<script>');
  });

  it('shows the page of each bill in the summary and contents, and bookmarks them', () => {
    const bom = priceBom([item], list);
    const html = buildBoqHtml(project(), bom, list, false, { 'bill-E': 4, 'boq-summary': 3, 'boq-notes': 2 });
    expect(html).toContain('<a href="#bill-E">Cables</a></td><td class="c">4</td>');
    expect(html).toContain('<tbody class="sec" id="bill-E">');
    expect(boqBookmarks(bom)({ 'bill-E': 4, 'boq-summary': 3, 'boq-notes': 2 })).toEqual([
      { title: 'Cover', page: 0 }, { title: 'General notes', page: 1 }, { title: 'Grand summary', page: 2 }, { title: 'Bill E — Cables', page: 3 }
    ]);
  });
});
