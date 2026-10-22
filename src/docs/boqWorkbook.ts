import ExcelJS from 'exceljs';
import type { Project } from '../types';
import type { BomItem } from '../calc/bom';
import { pricingBasis, validVat, type PriceList, type PricedBom, type PricedItem } from '../model/priceList';
import { revisionStamp } from '../model/revisions';
import { reportDoc } from './reportFrame';
import { printDoc } from './printDoc';

export { printDoc };
import { boqRevisionsOf, boqRevisionState, changeNote, CHANGE_LABEL, type BoqLine, type BoqLineChange } from '../model/boqRevisions';
import { boqReview, SCOPE_CHECKS } from '../model/boqScope';
import { isRasterDataUrl } from '../util/escape';

/** The BOQ as an Excel workbook in tender format: a summary sheet, the
 * bill (item no., description, unit, qty, rate, amount, section subtotals)
 * and, when given, the changes since an earlier revision. */

const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const head = (row: ExcelJS.Row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4F8F' } }; c.border = box; c.alignment = { vertical: 'middle', wrapText: true }; });
};
const MONEY = '#,##0.00';
const QUANTITY = '#,##0.##';

const templateLabel = (project: Project) => project.boq?.projectType === 'fit-out' ? 'Fit-out' : project.boq?.projectType === 'new-installation' ? 'New installation' : undefined;
const decisionLabels = { included: 'Included', 'by-others': 'By others', 'not-applicable': 'Not applicable', 'not-reviewed': 'Not reviewed' };
const scopeDecisions = (project: Project) => SCOPE_CHECKS.map((check) => {
  const applicable = project.boq?.projectType === 'fit-out' ? check.fitOut : check.newInstallation;
  const decision = project.boq?.scopeReview?.[check.id] ?? (applicable ? 'not-reviewed' : 'not-applicable');
  return { id: check.id, title: check.title, decision, label: decisionLabels[decision] };
});
const briefText = (value: string, limit = 200) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
const reviewCategories: Record<string, string> = {
  scope: 'Scope areas not reviewed', 'supply-rate': 'Supply quotes missing', 'install-rate': 'Installation quotes missing',
  'invalid-rate': 'Invalid rates', quantity: 'Quantities to confirm', 'manual-evidence': 'Manual quantity evidence missing',
  evidence: 'Allowances or product details to confirm', package: 'Package links to review', changed: 'Design quantities changed',
  'schedule-points': 'Schedule points to confirm', 'schedule-omitted': 'Omitted schedule point counts',
  'orphan-override': 'Saved BOQ overrides to review', 'legacy-wire-rate': 'Wire quotes require the new unit', 'legacy-panel-rate': 'Panel quotes require the current specification',
  wastage: 'Wastage allowances to review', markup: 'Markup to review', discount: 'Discount to review', vat: 'VAT to review'
};
const legacyCriticalChecks = new Set(['orphan-override', 'legacy-wire-rate', 'legacy-panel-rate', 'package', 'schedule-omitted', 'schedule-points', 'quantity', 'invalid-rate', 'wastage', 'markup', 'discount', 'vat', 'device-mismatch']);
/** New templates disclose the whole scope review; older projects must still
 * disclose migration and data issues without acquiring a template checklist. */
const exportReview = (project: Project, bom: PricedBom) => boqReview(project, bom).filter((check) => templateLabel(project) || legacyCriticalChecks.has(check.id.split(':')[0]));
/** Keep excluded costs out of the formula, including client-supplied equipment
 * whose installation is still in the contractor's scope. */
const supplyCharge = (it: PricedItem) => it.supplyCharge ?? it.source !== 'excluded';
const installCharge = (it: PricedItem) => it.installCharge ?? it.source !== 'excluded';
const unpriced = (it: PricedItem) => it.missingRate ?? (it.source === 'missing' || (it.source === 'manual' && it.rate === undefined && !it.labour));
const noChargeLabel = (it: PricedItem) => it.includedIn ? `Included in package: ${it.includedIn}` : it.action === 'retain' ? 'Retained — no charge' : 'By others';
const validQuantity = (it: PricedItem) => Number.isFinite(it.qty) && it.qty >= 0;
const responsibilityDetails = (it: PricedItem) => `${it.action ?? 'new'} · supply: ${it.supplyBy ?? 'contractor'} · installation: ${it.installBy ?? 'contractor'}`;
const quantityDetails = (it: PricedItem) => [
  it.quantitySource ? `Quantity source: ${it.quantitySource}` : undefined,
  it.evidence ? `Evidence: ${it.evidence}` : undefined,
  it.includedIn ? `Package: ${it.includedIn}` : undefined,
  it.note,
  it.where.slice(0, 6).join(', ') + (it.where.length > 6 ? '…' : '')
].filter(Boolean).join(' · ');
const descriptionDetails = (it: PricedItem) => [
  it.description,
  responsibilityDetails(it),
  it.designQty !== undefined ? `Quantity changed from design ${it.designQty}${it.changed ? '; design moved — review' : ''}` : undefined,
  !validQuantity(it) ? 'INVALID QUANTITY — omitted from priced total' : undefined,
  unpriced(it) ? 'NO RATE — charged scope is not fully priced' : undefined
].filter(Boolean).join(' · ');

function header(ws: ExcelJS.Worksheet, project: Project, title: string, cols: number, stamp = revisionStamp(project)) {
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = project.name;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = `${title} — ${stamp}${project.info?.owner ? ` — Owner: ${project.info.owner}` : ''}${project.info?.consultant ? ` — Consultant: ${project.info.consultant}` : ''}`;
  ws.getCell(2, 1).font = { color: { argb: 'FF404040' } };
}

/** The BOQ in Excel. Item numbers, revision marks and the revision summary sheet follow the
 * project's BOQ revisions exactly as the PDF does (see boqRevisionState). */
export function buildBoqWorkbook(project: Project, bom: PricedBom, list?: PriceList): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  wb.created = new Date();
  const cur = list?.currency ?? 'AED';
  const template = templateLabel(project);
  const review = exportReview(project, bom);
  const state = boqRevisionState(project, bom);
  const revLabel = state.rev === undefined ? 'Draft' : `Rev ${state.rev}${state.draft ? ' (draft)' : ''}`;
  const stamp = `BOQ ${revLabel}${state.date ? ` · ${state.date}` : ''}`;

  // Summary
  const sum = wb.addWorksheet('Summary', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  header(sum, project, 'Bill of quantities — summary', 3, stamp);
  sum.columns = [{ width: 8 }, { width: 50 }, { width: 20 }];
  head(sum.getRow(4));
  sum.getRow(4).values = ['Section', 'Description', `Amount (${cur})`];
  head(sum.getRow(4));
  let r = 5;
  for (const s of bom.sections) {
    sum.getRow(r).values = [s.section, s.title, s.amount];
    sum.getRow(r).eachCell((c) => (c.border = box));
    r++;
  }
  const line = (label: string, v: number, bold = false) => {
    sum.getRow(r).values = ['', label, v];
    sum.getRow(r).font = { bold };
    sum.getRow(r).eachCell((c) => (c.border = box));
    r++;
  };
  line('Subtotal', bom.subtotal, true);
  if (list?.markupPct) line(`Overheads and profit (${list.markupPct} %)`, bom.markup);
  if (bom.discount) line('Discount', -bom.discount);
  const vatPct = validVat(project.boq?.vatPct);
  if (vatPct) {
    line('Total (excluding VAT)', bom.total, true);
    line(`VAT (${vatPct} %)`, bom.vat);
    line('Grand total (including VAT)', bom.grandTotal, true);
  } else line('Total', bom.total, true);
  sum.getColumn(3).numFmt = MONEY;
  r++;
  sum.getCell(r++, 2).value = 'Pricing basis';
  sum.getCell(r - 1, 2).font = { bold: true };
  for (const l of pricingBasis(bom, list).lines) sum.getCell(r++, 2).value = l;
  if (template) {
    sum.getCell(r++, 2).value = `Scope template: ${template}`;
    sum.getCell(r++, 2).value = `${review.length} scope check(s) need review; see Scope review sheet.`;
  } else if (review.length) {
    sum.getCell(r++, 2).value = `${review.length} BOQ data check(s) need review.`;
    for (const check of review) {
      sum.mergeCells(r, 2, r, 3);
      sum.getCell(r++, 2).value = check.message;
    }
  }
  if (project.boq?.scopeNotes) sum.getCell(r++, 2).value = `Scope exclusions / assumptions: ${project.boq.scopeNotes}`;
  sum.getCell(r++, 2).value = 'Quantities from the design as it is; to be checked before tender.';
  sum.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  // Bill
  const ws = wb.addWorksheet('BOQ', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' } });
  const marker = state.rev !== undefined && state.changes.length ? state.rev : undefined;
  const marks = new Map(marker ? state.changes.map((c) => [c.key, c]) : []);
  const grey = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8E8E8' } };
  header(ws, project, 'Bill of quantities', marker ? 9 : 8, stamp);
  ws.columns = [{ width: 8 }, { width: 62 }, { width: 7 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 16 }, { width: 24 }, ...(marker ? [{ width: 30 }] : [])];
  ws.getRow(4).values = ['Item', 'Description', 'Unit', 'Qty', `Supply rate (${cur})`, `Install rate (${cur})`, `Amount (${cur})`, 'Location', ...(marker ? [`Revision (${revLabel})`] : [])];
  head(ws.getRow(4));
  r = 5;
  for (const s of bom.sections) {
    const t = ws.getRow(r++);
    t.values = [s.section, s.title.toUpperCase()];
    t.font = { bold: true };
    t.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE7F7' } }; });
    s.items.forEach((it, i) => {
      const row = ws.getRow(r++);
      row.values = [it.no ?? `${s.section}.${i + 1}`, descriptionDetails(it), it.unit, validQuantity(it) ? it.qty : null, supplyCharge(it) && !it.supplyRateMissing ? it.rate ?? null : null, installCharge(it) && !it.installRateMissing ? it.labour : null, null, quantityDetails(it)];
      row.getCell(7).value = it.source === 'excluded' ? noChargeLabel(it) : !validQuantity(it) ? 0 : { formula: `D${row.number}*(E${row.number}+F${row.number})`, result: it.amount };
      row.getCell(2).alignment = { wrapText: true };
      row.getCell(8).alignment = { wrapText: true };
      row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= 8) c.border = box; });
      const mark = marks.get(it.key);
      if (mark) {
        row.getCell(9).value = `△${marker} ${changeNote(mark, (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), qtyH)}`;
        row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= 9) { c.fill = grey; c.border = box; } });
      }
      if (unpriced(it)) {
        for (const col of [it.supplyRateMissing ? 5 : 0, it.installRateMissing ? 6 : 0, 7].filter(Boolean)) row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      }
    });
    for (const c of state.changes.filter((x) => marker && x.kinds.includes('omitted') && x.section === s.section)) {
      const row = ws.getRow(r++);
      row.values = [c.no, c.description, c.unit, null, null, null, 'Omitted', '', `△${marker} ${changeNote(c, (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), qtyH)}`];
      row.getCell(2).font = { strike: true };
      row.eachCell({ includeEmpty: true }, (cell, n) => { if (n <= 9) { cell.fill = grey; cell.border = box; } });
    }
    const st = ws.getRow(r++);
    st.values = ['', `Total section ${s.section} carried to summary`, '', '', '', '', s.amount];
    st.font = { bold: true };
    st.getCell(7).border = box;
    r++;
  }
  ws.getColumn(4).numFmt = QUANTITY;
  for (const c of [5, 6, 7]) ws.getColumn(c).numFmt = MONEY;

  // Existing projects retain their two-sheet export until a scope template is
  // selected. The separate sheet keeps the established BOQ columns readable.
  if (template) {
    const scope = wb.addWorksheet('Scope review', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' } });
    header(scope, project, `BOQ scope and quantity evidence — ${template}`, 7);
    scope.columns = [{ width: 28 }, { width: 50 }, { width: 28 }, { width: 28 }, { width: 35 }, { width: 45 }, { width: 30 }];
    scope.getRow(4).values = ['Item key', 'Description', 'Action / responsibility', 'Quantity source', 'Evidence', 'Package', 'Location'];
    head(scope.getRow(4));
    let scopeRow = 5;
    for (const it of bom.items) {
      const row = scope.getRow(scopeRow++);
      row.values = [it.key, it.description, responsibilityDetails(it), it.quantitySource ?? '', it.evidence ?? '', it.includedIn ?? '', it.where.join(', ')];
      row.eachCell({ includeEmpty: true }, (c) => { c.border = box; c.alignment = { wrapText: true, vertical: 'top' }; });
    }
    scopeRow++;
    scope.getCell(scopeRow++, 2).value = 'Scope checklist decisions';
    scope.getRow(scopeRow).values = ['Check', 'Contractor scope area', 'Decision'];
    head(scope.getRow(scopeRow++));
    for (const check of scopeDecisions(project)) {
      const row = scope.getRow(scopeRow++);
      row.values = [check.id, check.title, check.label];
      row.eachCell((cell) => { cell.border = box; cell.alignment = { wrapText: true, vertical: 'top' }; });
    }
    scopeRow++;
    scope.getCell(scopeRow++, 2).value = 'Scope checks requiring review';
    if (review.length) for (const check of review) {
      scope.mergeCells(scopeRow, 2, scopeRow, 7);
      scope.getRow(scopeRow).values = [check.id, check.message];
      scope.getCell(scopeRow++, 2).alignment = { wrapText: true, vertical: 'top' };
    }
    else scope.getCell(scopeRow++, 2).value = 'No pending checklist entries. Validate quantities, specification and contract documents before tender.';
    scope.getCell(scopeRow, 2).value = 'This is a design-based estimate; checklist completion is not contract approval.';
    if (project.boq?.scopeNotes) scope.getCell(scopeRow + 2, 2).value = `Scope exclusions / assumptions: ${project.boq.scopeNotes}`;
  }

  // Revision summary: the changes since the previous issue, as on the PDF's summary page.
  if (state.previous) {
    const prev = state.previous;
    const cw = wb.addWorksheet('Revision summary');
    header(cw, project, `Revision summary — changes from BOQ Rev ${prev.id} (${prev.date})`, 9, stamp);
    cw.columns = [{ width: 8 }, { width: 62 }, { width: 7 }, { width: 18 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 16 }];
    cw.getRow(4).values = ['Item', 'Description', 'Unit', 'Change', `Qty Rev ${prev.id}`, `Qty Rev ${state.rev}`, `Rate Rev ${prev.id}`, `Rate Rev ${state.rev}`, `Amount change (${cur})`];
    head(cw.getRow(4));
    const rateOf = (l?: BoqLine) => (l && (l.rate !== undefined || l.labour !== undefined) ? (l.rate ?? 0) + (l.labour ?? 0) : null);
    let cr = 5;
    for (const c of state.changes) {
      const row = cw.getRow(cr++);
      row.values = [c.no, c.description, c.unit, c.kinds.map((k) => CHANGE_LABEL[k]).join(', '), c.before?.qty ?? null, c.after?.qty ?? null, rateOf(c.before), rateOf(c.after), c.delta];
      if (c.kinds.includes('omitted')) row.getCell(2).font = { strike: true };
      row.eachCell({ includeEmpty: true }, (x, n) => { if (n <= 9) x.border = box; });
    }
    const line = (label: string, a: number, b: number) => {
      const row = cw.getRow(cr++);
      row.values = ['', label, '', '', '', '', a, b, b - a];
      row.font = { bold: true };
    };
    cr++;
    line(`Total excluding VAT (Rev ${prev.id} → Rev ${state.rev})`, prev.total, bom.total);
    if (prev.vat || bom.vat) line('Grand total including VAT', prev.grandTotal, bom.grandTotal);
    for (const c of [5, 6]) cw.getColumn(c).numFmt = QUANTITY;
    for (const c of [7, 8, 9]) cw.getColumn(c).numFmt = MONEY;
    cw.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  }
  return wb;
}

/** A price list as a sheet to fill in: every item of this BOM with its key. */
export function buildPriceTemplate(items: BomItem[], list?: PriceList): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rates');
  ws.columns = [{ header: 'Key', width: 34 }, { header: 'Description', width: 62 }, { header: 'Unit', width: 7 }, { header: 'Supply rate', width: 13 }, { header: 'Install rate', width: 13 }];
  head(ws.getRow(1));
  const keys = new Set(items.map((x) => x.key));
  const rows = [...items.map((x) => ({ key: x.key, description: x.description, unit: x.unit })),
    ...Object.entries(list?.rates ?? {}).filter(([k]) => !keys.has(k)).map(([k, e]) => ({ key: k, description: e.description ?? '', unit: '' }))];
  for (const x of rows) {
    const e = list?.rates[x.key];
    ws.addRow([x.key, x.description, x.unit, e?.rate ?? null, e?.labour ?? null]);
  }
  ws.getColumn(4).numFmt = MONEY;
  ws.getColumn(5).numFmt = MONEY;
  ws.getColumn(1).font = { color: { argb: 'FF808080' } };
  return wb;
}

/** Reads supplier and/or installation quotes. A blank quote stays missing;
 * a numeric zero is an explicit quote and must survive a round trip. */
export async function readPriceWorkbook(bytes: ArrayBuffer, items: BomItem[]): Promise<{ rates: PriceList['rates']; read: number; unmatched: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.worksheets[0];
  const byDesc = new Map(items.map((x) => [x.description.toLowerCase(), x.key]));
  const rates: PriceList['rates'] = {};
  let read = 0, unmatched = 0;
  if (!ws) return { rates, read, unmatched };
  const heads = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? '').toLowerCase());
  const col = (re: RegExp) => heads.findIndex((h) => re.test(h));
  const cKey = col(/^key/), cDesc = col(/desc/), cRate = col(/supply|^rate|price/), cLab = col(/install|labou?r/);
  if ((cRate < 0 && cLab < 0) || (cKey < 0 && cDesc < 0)) return { rates, read, unmatched };
  const num = (v: unknown) => {
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return undefined;
    const n = typeof v === 'number' ? v : typeof v === 'object' && v && 'result' in v ? Number((v as { result: unknown }).result) : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const rate = cRate >= 0 ? num(row.getCell(cRate).value) : undefined;
    const labour = cLab >= 0 ? num(row.getCell(cLab).value) : undefined;
    if (rate === undefined && labour === undefined) return;
    const desc = cDesc >= 0 ? String(row.getCell(cDesc).value ?? '').trim() : '';
    const key = (cKey >= 0 ? String(row.getCell(cKey).value ?? '').trim() : '') || byDesc.get(desc.toLowerCase());
    if (!key) { unmatched++; return; }
    rates[key] = { ...(rate !== undefined ? { rate } : {}), ...(labour !== undefined ? { labour } : {}), ...(desc ? { description: desc } : {}) };
    read++;
  });
  return { rates, read, unmatched };
}

const escH = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const m2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qtyH = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const billId = (section: string) => `bill-${section.replace(/[^A-Za-z0-9_-]/g, '_')}`;
const shortDate = (iso?: string) => {
  const d = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : iso ?? '';
};

const CURRENCY_NAMES: Record<string, string> = {
  AED: 'UAE Dirhams', SAR: 'Saudi Riyals', QAR: 'Qatari Riyals', OMR: 'Omani Rials', KWD: 'Kuwaiti Dinars', BHD: 'Bahraini Dinars',
  USD: 'US Dollars', EUR: 'Euros', GBP: 'Pounds Sterling', INR: 'Indian Rupees'
};
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function below1000(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${below1000(n % 100)}` : ''}`;
}
/** "UAE Dirhams Two hundred and two thousand … and 50/100 only" — the amount in words of the grand summary. */
export function amountInWords(amount: number, currency: string): string {
  const cents = Math.round(Math.abs(amount) * 100);
  let whole = Math.floor(cents / 100);
  const parts: string[] = [];
  for (const [size, name] of [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']] as const) {
    if (whole >= size) { parts.push(`${below1000(Math.floor(whole / size))}${name ? ` ${name}` : ''}`); whole %= size; }
  }
  const text = `${amount < 0 ? 'minus ' : ''}${parts.join(' ') || 'zero'}${cents % 100 ? ` and ${cents % 100}/100` : ''}`;
  return `${CURRENCY_NAMES[currency.toUpperCase()] ?? currency} ${text.charAt(0).toUpperCase()}${text.slice(1)} only`;
}

const ACTIONS: Record<string, string> = { retain: 'Existing — retain', relocate: 'Existing — relocate', remove: 'Existing — remove', replace: 'Replace existing' };
/** The small grey line under a description: what a tenderer needs (where, by whom, evidence), not the takeoff trail. */
function itemNotes(it: PricedItem): string {
  return [
    ACTIONS[it.action ?? 'new'],
    (it.supplyBy ?? 'contractor') !== 'contractor' ? `Supply by ${it.supplyBy}` : undefined,
    (it.installBy ?? 'contractor') !== 'contractor' ? `Installation by ${it.installBy}` : undefined,
    it.where.length ? `Ref: ${it.where.slice(0, 6).join(', ')}${it.where.length > 6 ? ' …' : ''}` : undefined,
    it.evidence ? `Evidence: ${it.evidence}` : undefined,
    it.note,
    it.designQty !== undefined ? `Qty adjusted (design ${qtyH(it.designQty)})${it.changed ? ' — design changed, review' : ''}` : undefined,
    !validQuantity(it) ? 'Invalid quantity — omitted from the total' : undefined
  ].filter(Boolean).map((x) => escH(x!)).join(' · ');
}

/** The revision mark: the revision number in a small triangle (△1), like a drawing's revision cloud. */
const tri = (rev: string) => `<svg class="tri" viewBox="0 0 20 18" width="15" height="13" aria-label="Revision ${escH(rev)}"><path d="M10 1.2 L18.8 16.8 L1.2 16.8 Z" fill="none" stroke="#000" stroke-width="1.4"/><text x="10" y="15" text-anchor="middle" font-size="10.5" font-family="Arial, Helvetica, sans-serif" font-weight="700">${escH(rev)}</text></svg>`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${m2(Math.abs(n))}`;
const lineRate = (l?: BoqLine) => (l && (l.rate !== undefined || l.labour !== undefined) ? m2((l.rate ?? 0) + (l.labour ?? 0)) : '—');
type Mark = { rev: string; change: BoqLineChange };

function billRow(it: PricedItem, number: string, mark?: Mark): string {
  const rate = (charge: boolean, missing: boolean | undefined, value: number | undefined) => !charge ? '—' : missing || value === undefined ? '<i>TBA</i>' : m2(value);
  const valid = validQuantity(it);
  const amount = it.source === 'excluded' ? `<i>${escH(noChargeLabel(it))}</i>`
    : !valid ? '<i>Omitted</i>'
    : unpriced(it) ? (it.amount ? `${m2(it.amount)}<sup>*</sup>` : '<i>Not priced</i>')
    : m2(it.amount);
  const notes = [mark ? escH(`Rev ${mark.rev}: ${changeNote(mark.change, m2, qtyH)}`) : '', itemNotes(it)].filter(Boolean).join(' · ');
  return `<tr${mark ? ' class="chg"' : ''}><td>${mark ? `${tri(mark.rev)} ` : ''}${escH(number)}</td><td>${escH(it.description)}${it.source === 'typical' ? '<sup>†</sup>' : ''}${notes ? `<div class="ref">${notes}</div>` : ''}</td><td class="c">${escH(it.unit)}</td><td class="n">${valid ? qtyH(it.qty) : '<i>Invalid</i>'}</td><td class="n">${rate(supplyCharge(it), it.supplyRateMissing, it.rate)}</td><td class="n">${rate(installCharge(it), it.installRateMissing, it.labour)}</td><td class="n">${amount}</td></tr>`;
}

/** An item omitted in the revision shown: struck through, kept under its number. */
const omittedRow = (m: Mark) => `<tr class="chg"><td>${tri(m.rev)} ${escH(m.change.no)}</td><td><s>${escH(m.change.description)}</s><div class="ref">${escH(`Rev ${m.rev}: ${changeNote(m.change, m2, qtyH)}`)}</div></td><td class="c">${escH(m.change.unit)}</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n"><i>Omitted</i></td></tr>`;

/** Outline of the PDF BOQ (bookmarks), from the pages its anchors landed on. */
export const boqBookmarks = (bom: PricedBom) => (pages: Record<string, number>): { title: string; page: number }[] => [
  { title: 'Cover', page: 0 },
  ...(pages['boq-notes'] ? [{ title: 'General notes', page: pages['boq-notes'] - 1 }] : []),
  ...(pages['boq-revisions'] ? [{ title: 'Revision summary', page: pages['boq-revisions'] - 1 }] : []),
  ...(pages['boq-summary'] ? [{ title: 'Grand summary', page: pages['boq-summary'] - 1 }] : []),
  ...bom.sections.filter((s) => pages[billId(s.section)]).map((s) => ({ title: `Bill ${s.section} — ${s.title}`, page: pages[billId(s.section)] - 1 })),
  ...(pages['boq-appendix'] ? [{ title: 'Scope review appendix', page: pages['boq-appendix'] - 1 }] : [])
];

/** The BOQ as a printable document (PDF, A4 portrait), plain black and white:
 * cover with document control, general notes and pricing basis, grand summary
 * (page of each bill, VAT, amount in words), the bills, and the scope review
 * appendix. The company logo heads every page after the cover. `summaryOnly`
 * prints the grand summary on its own. `pages` are the pages of the anchors
 * from a first print, for the page column of the summary and contents. */
export function buildBoqHtml(project: Project, bom: PricedBom, list?: PriceList, summaryOnly = false, pages: Record<string, number> = {}): string {
  const basis = pricingBasis(bom, list);
  const cur = list?.currency ?? 'AED';
  const vatPct = validVat(project.boq?.vatPct);
  const doc = project.boq?.document ?? {};
  const d = reportDoc(project, { title: 'Bill of quantities', docNo: doc.docNo, preparedBy: doc.preparedBy, checkedBy: doc.checkedBy, approvedBy: doc.approvedBy });
  const today = new Date().toISOString().slice(0, 10);
  const state = boqRevisionState(project, bom);
  const revLabel = state.rev === undefined ? undefined : `Rev ${state.rev}${state.draft ? ' (draft)' : ''}`;
  const date = shortDate(state.date ?? today);
  const marker = state.rev !== undefined && state.changes.length ? state.rev : undefined;
  const marks = new Map(marker ? state.changes.map((change) => [change.key, { rev: marker, change }]) : []);
  const company = project.drawing?.company?.trim() || d.consultant || '';
  const status = doc.status?.trim();
  const template = templateLabel(project);
  const review = exportReview(project, bom);
  const pg = (id: string) => (pages[id] ? String(pages[id]) : '');
  const footer = [d.docNo, revLabel ?? 'Draft', date].filter(Boolean).join(' · ');
  const prev = state.previous;
  const prevLabel = prev ? `Rev ${prev.id}` : '';

  const totals = `
    <tbody class="tot"><tr><td></td><td colspan="${summaryOnly ? 1 : 2}">Subtotal</td><td class="n">${m2(bom.subtotal)}</td></tr></tbody>
    <tbody>${list?.markupPct ? `<tr><td></td><td colspan="${summaryOnly ? 1 : 2}">Overheads and profit (${list.markupPct} %)</td><td class="n">${m2(bom.markup)}</td></tr>` : ''}
    ${bom.discount ? `<tr><td></td><td colspan="${summaryOnly ? 1 : 2}">Discount (${project.boq?.discountPct} %)</td><td class="n">−${m2(bom.discount)}</td></tr>` : ''}</tbody>
    ${vatPct ? `<tbody class="tot"><tr><td></td><td colspan="${summaryOnly ? 1 : 2}">Total excluding VAT</td><td class="n">${m2(bom.total)}</td></tr></tbody>
    <tbody><tr><td></td><td colspan="${summaryOnly ? 1 : 2}">VAT (${vatPct} %)</td><td class="n">${m2(bom.vat)}</td></tr></tbody>` : ''}
    <tbody class="gt"><tr><td></td><td colspan="${summaryOnly ? 1 : 2}">GRAND TOTAL (${escH(cur)}, ${vatPct ? 'including' : 'excluding'} VAT)</td><td class="n">${m2(bom.grandTotal)}</td></tr></tbody>`;
  const summary = `<section id="boq-summary" class="${summaryOnly ? '' : 'page'}">
    <h2>${summaryOnly ? 'Bill of quantities — summary' : 'Grand summary'}</h2>
    <table class="b sum"><colgroup><col style="width:14mm"><col>${summaryOnly ? '' : '<col style="width:14mm">'}<col style="width:34mm"></colgroup>
      <thead><tr><th>Bill</th><th>Description</th>${summaryOnly ? '' : '<th>Page</th>'}<th>Amount (${escH(cur)})</th></tr></thead>
      <tbody>${bom.sections.map((s) => `<tr><td class="c">${escH(s.section)}</td><td>${summaryOnly ? escH(s.title) : `<a href="#${billId(s.section)}">${escH(s.title)}</a>`}</td>${summaryOnly ? '' : `<td class="c">${pg(billId(s.section))}</td>`}<td class="n">${m2(s.amount)}</td></tr>`).join('')}</tbody>
      ${totals}
    </table>
    <div class="words"><b>Amount in words:</b> ${escH(amountInWords(bom.grandTotal, cur))}.</div>
    ${bom.missing ? `<p class="small">${bom.missing} item(s) have a rate to be advised (TBA); their unpriced part is not included in the total.</p>` : ''}
    ${summaryOnly && prev ? `<p class="small">${escH(`${revLabel}: net change from ${prevLabel} ${signed(bom.total - prev.total)} ${cur} excluding VAT; changed items are listed in the full BOQ.`)}</p>` : ''}
    ${status && /tender/i.test(status) ? '<table class="grid sign"><tbody><tr><td style="width:42mm">Tenderer’s name</td><td></td></tr><tr><td>Signature and stamp</td><td class="sig"></td></tr><tr><td>Date</td><td></td></tr></tbody></table>' : ''}
  </section>`;

  const decisions = template ? scopeDecisions(project) : [];
  const unreviewed = decisions.filter((check) => check.decision === 'not-reviewed').length;
  const categories = new Map<string, number>();
  for (const check of review) {
    const category = reviewCategories[check.id.split(':')[0]] ?? 'Other checks';
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const scopeBrief = template || review.length ? `<div class="box scope-brief"><b>${template ? `Scope template: ${escH(template)}` : 'BOQ data review'}</b>${review.length ? `<p>${review.length} ${template ? `scope check(s) need review; ${unreviewed} checklist area(s) not reviewed` : 'data check(s) need review'}.</p><ul>${[...categories].slice(0, 3).map(([category, count]) => `<li>${escH(category)}: ${count}</li>`).join('')}</ul>` : '<p>No pending checklist entries. Validate quantities, specification and contract documents before tender.</p>'}<p>${summaryOnly ? 'Full review details and complete exclusions are in the full BOQ appendix.' : 'Full review details are in the appendix.'} This is a design-based estimate; checklist completion is not contract approval.</p></div>` : '';
  const scopeNotes = project.boq?.scopeNotes ? `<div class="box"><b>Scope exclusions / assumptions</b><p class="pre">${escH(summaryOnly ? briefText(project.boq.scopeNotes) : project.boq.scopeNotes)}</p>${summaryOnly && project.boq.scopeNotes.length > 200 ? '<p>See the full BOQ appendix for complete notes.</p>' : ''}</div>` : '';
  const legend = `<table class="legend"><tbody>
    <tr><td>†</td><td>Priced at a built-in typical rate — illustrative; replace with a quoted rate.</td></tr>
    <tr><td><i>TBA</i></td><td>Rate to be advised; not included in the total.</td></tr>
    <tr><td>*</td><td>Amount incomplete: a charge marked TBA is not included.</td></tr>
    <tr><td>—</td><td>No charge under this item (by others, retained or included elsewhere).</td></tr>
    <tr><td>Ref:</td><td>Boards and locations the quantity is taken from.</td></tr>
    ${marker ? `<tr><td>${tri(marker)}</td><td>Added or changed in ${escH(revLabel!)} (shaded); omitted items stay listed under their number, struck through.</td></tr>` : ''}</tbody></table>`;
  const basisList = `<ol class="notes">
      <li>This bill of quantities shall be read with the drawings, specification and conditions of contract. Quantities are taken from the design model and are approximate; the tenderer shall verify them before pricing.</li>
      <li>Rates include supply, delivery, installation, termination, testing and commissioning, and all labour, plant and sundries needed to complete the work, unless stated otherwise.</li>
      <li>Amount = quantity × (supply rate + installation rate). Amounts are in ${escH(cur)}${vatPct ? `; VAT at ${vatPct} % is added in the grand summary` : ' and exclude VAT'}.</li>
      ${basis.lines.map((l) => `<li>${escH(l)}</li>`).join('')}
    </ol>`;

  if (summaryOnly) return page(`
    ${summary.replace('</h2>', `</h2><p class="small sub">${escH([d.client ? `Client: ${d.client}` : '', footer].filter(Boolean).join(' · '))}</p>`)}
    <h3>Pricing basis</h3>${basisList}
    ${summaryOnly && (basis.missing || basis.typical) ? '<p class="small">Items without a list rate are named in the full BOQ.</p>' : ''}
    ${scopeBrief}${scopeNotes}`);

  const issued = boqRevisionsOf(project);
  const revisions: { id: string; date: string; description: string; by?: string }[] = [...issued.slice(state.draft ? -4 : -5), ...(state.draft ? [{ id: state.rev ?? '—', date: today, description: `${status ?? 'Draft'} — not issued` }] : [])];
  const cover = `<section class="cover">
    <div class="top">${isRasterDataUrl(d.logo) ? `<img class="logo" src="${escH(d.logo)}" alt="">` : '<span></span>'}<div class="co">${escH(company)}</div></div>
    <div class="mid">
      <div class="k">ELECTRICAL LV WORKS</div>
      <h1>BILL OF QUANTITIES</h1>
      <div class="pn">${escH(project.name)}</div>
      <table class="kv"><tbody>
        ${([['Client', d.client], ['Location', d.location], ['Consultant', d.consultant], ['Contractor', d.contractor], ['Document no.', d.docNo], ['Revision', revLabel ? `${revLabel} — ${date}${state.designRev ? ` (design Rev ${state.designRev})` : ''}` : 'Draft — not issued'],
          ['Currency', `${CURRENCY_NAMES[cur.toUpperCase()] ? `${CURRENCY_NAMES[cur.toUpperCase()]} (${cur})` : cur}, ${vatPct ? `VAT ${vatPct} % added in the grand summary` : 'excluding VAT'}`], ['Status', status]] as [string, string | undefined][])
          .filter(([, v]) => v).map(([k, v]) => `<tr><td>${k}</td><td>${escH(v!)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <table class="grid"><thead><tr><th style="width:12mm">Rev</th><th style="width:24mm">Date</th><th>Description</th><th style="width:25mm">Prepared</th><th style="width:25mm">Checked</th><th style="width:25mm">Approved</th></tr></thead>
      <tbody>${revisions.map((r, i) => {
        const last = i === revisions.length - 1;
        return `<tr><td>${escH(r.id)}</td><td>${escH(shortDate(r.date))}</td><td>${escH(r.description)}</td><td class="sig">${escH((last ? d.preparedBy : undefined) ?? r.by ?? '')}</td><td>${escH(last ? d.checkedBy ?? '' : '')}</td><td>${escH(last ? d.approvedBy ?? '' : '')}</td></tr>`;
      }).join('')}</tbody></table>
  </section>`;

  const contents = `<table class="contents"><tbody>
    ${prev ? `<tr><td><a href="#boq-revisions">Revision summary — ${escH(revLabel!)}</a></td><td class="n">${pg('boq-revisions')}</td></tr>` : ''}
    <tr><td><a href="#boq-summary">Grand summary</a></td><td class="n">${pg('boq-summary')}</td></tr>
    ${bom.sections.map((s) => `<tr><td><a href="#${billId(s.section)}">Bill ${escH(s.section)} — ${escH(s.title)}</a></td><td class="n">${pg(billId(s.section))}</td></tr>`).join('')}
    ${template || review.length || project.boq?.scopeNotes ? `<tr><td><a href="#boq-appendix">Scope review appendix</a></td><td class="n">${pg('boq-appendix')}</td></tr>` : ''}
  </tbody></table>`;
  const notes = `<section id="boq-notes" class="page"><a class="dest" href="#boq-notes"></a>
    <h2>General notes and pricing basis</h2>${basisList}
    <h3>Legend</h3>${legend}
    ${scopeBrief}${scopeNotes}
    <h3>Contents</h3>${contents}
  </section>`;

  // The bills, with the items omitted in this revision kept under their numbers (a bill
  // whose items were all omitted still prints, with its title from the previous issue).
  const omitted = [...marks.values()].filter((m) => m.change.kinds.includes('omitted'));
  const billSections = [
    ...bom.sections.map((s) => ({ section: s.section, title: s.title, amount: s.amount, items: s.items, omitted: omitted.filter((m) => m.change.section === s.section) })),
    ...[...new Set(omitted.map((m) => m.change.section))].filter((id) => !bom.sections.some((s) => s.section === id))
      .map((id) => ({ section: id, title: prev?.sections.find((x) => x.section === id)?.title ?? id, amount: 0, items: [] as PricedItem[], omitted: omitted.filter((m) => m.change.section === id) }))
  ];

  // Revision summary: what changed since the previous issue, bill totals before and after, and the history.
  const allSections = [...new Set([...(prev?.sections ?? []).map((x) => x.section), ...bom.sections.map((x) => x.section)])].sort();
  const titleOf = (id: string) => bom.sections.find((x) => x.section === id)?.title ?? prev?.sections.find((x) => x.section === id)?.title ?? id;
  const was = (id: string) => prev?.sections.find((x) => x.section === id);
  const now = (id: string) => bom.sections.find((x) => x.section === id);
  const history = [...issued.map((r) => ({ id: r.id, date: shortDate(r.date), description: r.description, designRev: r.designRev, total: r.total, by: r.by })),
    ...(state.draft ? [{ id: state.rev ?? '—', date: shortDate(today), description: 'Draft — not issued', designRev: state.designRev, total: bom.total, by: undefined }] : [])];
  const revisionSummary = prev ? `<section id="boq-revisions" class="page">
    <h2>Revision summary — ${escH(revLabel!)}</h2>
    <p class="small sub">${escH(`Changes from BOQ ${prevLabel} (${shortDate(prev.date)}) to ${revLabel}${state.draft ? '' : ` (${date})`}.${state.designRev ? ` Priced from design Rev ${state.designRev}.` : ''}`)} Changed items are shaded and marked ${tri(marker ?? state.rev!)} in the bills.</p>
    <h3>Changed items</h3>
    ${state.changes.length ? `<table class="b"><colgroup><col style="width:13mm"><col><col style="width:20mm"><col style="width:22mm"><col style="width:36mm"><col style="width:24mm"></colgroup>
      <thead><tr><th>Item</th><th>Description</th><th>Change</th><th>Qty<br>was → now</th><th>Rate<br>was → now</th><th>Amount<br>change</th></tr></thead>
      <tbody>${state.changes.map((c) => `<tr><td>${escH(c.no)}</td><td>${c.kinds.includes('omitted') ? `<s>${escH(c.description)}</s>` : escH(c.description)}</td><td>${escH(c.kinds.map((k) => CHANGE_LABEL[k]).join(', '))}</td><td class="n">${c.before ? qtyH(c.before.qty) : '—'} → ${c.after ? qtyH(c.after.qty) : '—'}</td><td class="n">${lineRate(c.before)} → ${lineRate(c.after)}</td><td class="n">${c.delta ? signed(c.delta) : '—'}</td></tr>`).join('')}</tbody>
      <tbody class="tot"><tr><td></td><td colspan="4">Net change of the items</td><td class="n">${signed(state.changes.reduce((a, c) => a + c.delta, 0))}</td></tr></tbody></table>` : '<p>No item changed; only markup, discount or VAT differ — see the totals below.</p>'}
    <h3>Bill totals</h3>
    <table class="b"><colgroup><col style="width:13mm"><col><col style="width:30mm"><col style="width:30mm"><col style="width:26mm"></colgroup>
      <thead><tr><th>Bill</th><th>Description</th><th>${escH(prevLabel)}</th><th>${escH(`Rev ${state.rev}`)}</th><th>Change</th></tr></thead>
      <tbody>${allSections.map((id) => { const a = was(id)?.amount, b = now(id)?.amount; return `<tr><td class="c">${escH(id)}</td><td>${escH(titleOf(id))}</td><td class="n">${a === undefined ? '—' : m2(a)}</td><td class="n">${b === undefined ? '—' : m2(b)}</td><td class="n">${Math.abs((b ?? 0) - (a ?? 0)) >= 0.005 ? signed((b ?? 0) - (a ?? 0)) : ''}</td></tr>`; }).join('')}</tbody>
      <tbody class="tot"><tr><td></td><td>Total excluding VAT</td><td class="n">${m2(prev.total)}</td><td class="n">${m2(bom.total)}</td><td class="n">${signed(bom.total - prev.total)}</td></tr></tbody>
      ${prev.vat || bom.vat ? `<tbody class="gt"><tr><td></td><td>Grand total including VAT</td><td class="n">${m2(prev.grandTotal)}</td><td class="n">${m2(bom.grandTotal)}</td><td class="n">${signed(bom.grandTotal - prev.grandTotal)}</td></tr></tbody>` : ''}</table>
    <h3>BOQ revision history</h3>
    <table class="grid hist"><thead><tr><th style="width:11mm">Rev</th><th style="width:24mm">Date</th><th>Description</th><th style="width:19mm">Design rev</th><th style="width:30mm">Total excl. VAT</th><th style="width:14mm">By</th></tr></thead>
      <tbody>${history.map((r) => `<tr><td>${escH(r.id)}</td><td>${escH(r.date)}</td><td>${escH(r.description)}</td><td>${escH(r.designRev ?? '—')}</td><td class="n">${m2(r.total)}</td><td>${escH(r.by ?? '')}</td></tr>`).join('')}</tbody></table>
  </section>` : '';

  const bills = `<section class="page"><table class="b bill"><colgroup><col style="width:16mm"><col><col style="width:11mm"><col style="width:15mm"><col style="width:20mm"><col style="width:20mm"><col style="width:25mm"></colgroup>
    <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Qty</th><th>Supply<br>rate</th><th>Install<br>rate</th><th>Amount<br>(${escH(cur)})</th></tr></thead>
    ${billSections.map((s) => `
      <tbody class="sec" id="${billId(s.section)}"><tr><td>${escH(s.section)}</td><td colspan="6">BILL ${escH(s.section)} — ${escH(s.title.toUpperCase())}</td></tr></tbody>
      <tbody>${s.items.length || s.omitted.length ? [...s.items.map((it, i) => billRow(it, it.no ?? `${s.section}.${i + 1}`, marks.get(it.key))), ...s.omitted.map(omittedRow)].join('') : '<tr><td></td><td colspan="6"><i>No items</i></td></tr>'}</tbody>
      <tbody class="tot"><tr><td></td><td colspan="5">Total Bill ${escH(s.section)} carried to grand summary</td><td class="n">${m2(s.amount)}</td></tr></tbody>`).join('')}
  </table></section>`;

  const appendix = template || review.length || project.boq?.scopeNotes ? `<section id="boq-appendix" class="page"><h2>${template ? `Scope review appendix — ${escH(template)}` : 'BOQ data review appendix'}</h2>
    ${template ? `<h3>Scope checklist decisions</h3><table class="b"><thead><tr><th>Scope area</th><th style="width:40mm">Decision</th></tr></thead><tbody>${decisions.map((check) => `<tr><td>${escH(check.title)}</td><td>${escH(check.label)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${project.boq?.scopeNotes ? `<h3>Scope exclusions / assumptions</h3><p class="pre">${escH(project.boq.scopeNotes)}</p>` : ''}
    <h3>Outstanding checks (${review.length})</h3>${review.length ? `<ul>${review.map((check) => `<li>${escH(check.message)}</li>`).join('')}</ul>` : '<p>No pending checklist entries.</p>'}
    <p class="small">This is a design-based estimate; checklist completion is not contract approval.</p></section>` : '';

  return page(`${cover}${notes}${revisionSummary}${summary}${bills}${appendix}`);

  function page(body: string): string {
    return printDoc(project, { title: `${project.name} — ${summaryOnly ? 'BOQ summary' : 'Bill of quantities'}`, headRight: summaryOnly ? 'BOQ SUMMARY' : 'BILL OF QUANTITIES', footer, body });
  }
}

