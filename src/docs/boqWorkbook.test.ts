import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { BomItem } from '../calc/bom';
import type { BoqCustom, PricedBom } from '../model/priceList';
import { newPriceList, priceBom } from '../model/priceList';
import { boqReview, SCOPE_CHECKS } from '../model/boqScope';
import { sampleProject } from '../data/sampleProject';
import { buildBoqHtml, buildBoqWorkbook, buildPriceTemplate, readPriceWorkbook } from './boqWorkbook';

const item: BomItem = { key: 'test:cable', section: 'E', description: 'Measured cable', unit: 'm', qty: 2, where: ['DB-1'] };
const project = (boq?: BoqCustom) => ({ ...sampleProject, boq });
const itemRow = (wb: ExcelJS.Workbook) => {
  const sheet = wb.getWorksheet('BOQ')!;
  const rows: ExcelJS.Row[] = [];
  sheet.eachRow((row) => { if (/^[A-Z]\.\d+$/.test(String(row.getCell(1).value ?? ''))) rows.push(row); });
  return rows;
};
const bodyRow = (html: string, text: string) => html.split('<tr>').find((row) => row.includes(text))!;
const empty: PricedBom = { items: [], sections: [], subtotal: 0, markup: 0, discount: 0, total: 0, missing: 0, changed: 0 };

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
    expect(html).toContain('supply: client');
    expect(html).toContain('Site survey drawing E-101');
    expect(html).toContain('15.00');
    expect(html).not.toContain('100.00');
    expect(html).not.toContain('NO RATE');
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
    expect(zero).not.toContain('NO RATE');
    const partial = bodyRow(html, 'Supply quote outstanding');
    expect(partial).toContain('20.00');
    expect(partial).toContain('NO RATE — partial / incomplete');
    expect(bodyRow(html, 'Installation quote outstanding')).toContain('NO RATE');
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
    expect(buildBoqHtml(project(custom), bom)).toContain('INVALID QUANTITY');
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
    const brief = html.match(/<div class="basis scope-brief[\s\S]*?<\/div>/)![0];
    expect(brief.match(/<li>/g)?.length).toBeLessThanOrEqual(3);
    expect(brief).toContain(`${checks.length} scope check(s) need review`);
    expect(brief).toContain('checklist area(s) not reviewed');
    expect(brief).toContain('Scope areas not reviewed');
    expect(html).not.toContain('<section class="scope-appendix">');
    expect(html).not.toContain('Unquoted scope item 59:');
    expect(html).not.toContain('detailed exclusions end marker');
    expect(html).toContain('full BOQ appendix');
  });

  it('places every outstanding check after the full bill in a scope appendix', () => {
    const custom: BoqCustom = { projectType: 'fit-out', manual: [{ id: 'x', section: 'J', description: 'Unquoted luminaire', unit: 'no', qty: 1 }] };
    const bom = priceBom([], undefined, custom);
    const html = buildBoqHtml(project(custom), bom);
    const appendixStart = html.indexOf('<section class="scope-appendix">');
    expect(appendixStart).toBeGreaterThan(html.indexOf('Total section J carried to summary'));
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

  it('states the limits of revision quantity comparisons in the workbook', () => {
    const wb = buildBoqWorkbook(project(), empty, undefined, { since: 'A', rows: [{ ...item, before: 1, after: 2, delta: 1, cost: 100 }] });
    const notes: string[] = [];
    wb.getWorksheet('Changes since A')!.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === 'string') notes.push(cell.value); }));
    expect(notes).toContain('Design quantity changes at current rates; scope actions, responsibility, package inclusions and manual BOQ changes are not compared.');
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
    const appendix = html.slice(html.indexOf('<section class="scope-appendix">'));
    for (const check of checks) {
      expect(summaryNotes).toContain(check.message);
      expect(appendix).toContain(check.message);
    }
    expect(html).not.toContain('Scope not reviewed:');
    expect(html).not.toContain('<h2>Scope checklist decisions</h2>');
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
});
