import ExcelJS from 'exceljs';
import type { Project } from '../types';
import type { BomItem } from '../calc/bom';
import { pricingBasis, type BomChange, type PriceList, type PricedBom, type PricedItem } from '../model/priceList';
import { revisionStamp } from '../model/revisions';
import { boqReview, SCOPE_CHECKS } from '../model/boqScope';

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

const templateLabel = (project: Project) => project.boq?.projectType === 'fit-out' ? 'Fit-out' : project.boq?.projectType === 'new-installation' ? 'New installation' : undefined;
const decisionLabels = { included: 'Included', 'by-others': 'By others', 'not-applicable': 'Not applicable', 'not-reviewed': 'Not reviewed' };
const scopeDecisions = (project: Project) => SCOPE_CHECKS.map((check) => {
  const applicable = project.boq?.projectType === 'fit-out' ? check.fitOut : check.newInstallation;
  const decision = project.boq?.scopeReview?.[check.id] ?? (applicable ? 'not-reviewed' : 'not-applicable');
  return { id: check.id, title: check.title, decision, label: decisionLabels[decision] };
});
const revisionComparisonNote = 'Design quantity changes at current rates; scope actions, responsibility, package inclusions and manual BOQ changes are not compared.';
const briefText = (value: string, limit = 200) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
const reviewCategories: Record<string, string> = {
  scope: 'Scope areas not reviewed', 'supply-rate': 'Supply quotes missing', 'install-rate': 'Installation quotes missing',
  'invalid-rate': 'Invalid rates', quantity: 'Quantities to confirm', 'manual-evidence': 'Manual quantity evidence missing',
  evidence: 'Allowances or product details to confirm', package: 'Package links to review', changed: 'Design quantities changed',
  'schedule-points': 'Schedule points to confirm', 'schedule-omitted': 'Omitted schedule point counts',
  'orphan-override': 'Saved BOQ overrides to review', 'legacy-wire-rate': 'Wire quotes require the new unit', 'legacy-panel-rate': 'Panel quotes require the current specification',
  wastage: 'Wastage allowances to review', markup: 'Markup to review', discount: 'Discount to review'
};
const legacyCriticalChecks = new Set(['orphan-override', 'legacy-wire-rate', 'legacy-panel-rate', 'package', 'schedule-omitted', 'schedule-points', 'quantity', 'invalid-rate', 'wastage', 'markup', 'discount', 'device-mismatch']);
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

function header(ws: ExcelJS.Worksheet, project: Project, title: string, cols: number) {
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = project.name;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = `${title} — ${revisionStamp(project)}${project.info?.owner ? ` — Owner: ${project.info.owner}` : ''}${project.info?.consultant ? ` — Consultant: ${project.info.consultant}` : ''}`;
  ws.getCell(2, 1).font = { color: { argb: 'FF404040' } };
}

export function buildBoqWorkbook(project: Project, bom: PricedBom, list?: PriceList, changes?: { since: string; rows: BomChange[] }): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  wb.created = new Date();
  const cur = list?.currency ?? 'AED';
  const template = templateLabel(project);
  const review = exportReview(project, bom);

  // Summary
  const sum = wb.addWorksheet('Summary', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  header(sum, project, 'Bill of quantities — summary', 3);
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
  line('Total', bom.total, true);
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
  header(ws, project, 'Bill of quantities', 8);
  ws.columns = [{ width: 8 }, { width: 62 }, { width: 7 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 16 }, { width: 24 }];
  ws.getRow(4).values = ['Item', 'Description', 'Unit', 'Qty', `Supply rate (${cur})`, `Install rate (${cur})`, `Amount (${cur})`, 'Location'];
  head(ws.getRow(4));
  r = 5;
  for (const s of bom.sections) {
    const t = ws.getRow(r++);
    t.values = [s.section, s.title.toUpperCase()];
    t.font = { bold: true };
    t.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE7F7' } }; });
    s.items.forEach((it, i) => {
      const row = ws.getRow(r++);
      row.values = [`${s.section}.${i + 1}`, descriptionDetails(it), it.unit, validQuantity(it) ? it.qty : null, supplyCharge(it) && !it.supplyRateMissing ? it.rate ?? null : null, installCharge(it) && !it.installRateMissing ? it.labour : null, null, quantityDetails(it)];
      row.getCell(7).value = it.source === 'excluded' ? noChargeLabel(it) : !validQuantity(it) ? 0 : { formula: `D${row.number}*(E${row.number}+F${row.number})`, result: it.amount };
      row.getCell(2).alignment = { wrapText: true };
      row.getCell(8).alignment = { wrapText: true };
      row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= 8) c.border = box; });
      if (unpriced(it)) {
        for (const col of [it.supplyRateMissing ? 5 : 0, it.installRateMissing ? 6 : 0, 7].filter(Boolean)) row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      }
    });
    const st = ws.getRow(r++);
    st.values = ['', `Total section ${s.section} carried to summary`, '', '', '', '', s.amount];
    st.font = { bold: true };
    st.getCell(7).border = box;
    r++;
  }
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

  // Changes since a revision
  if (changes?.rows.length) {
    const cw = wb.addWorksheet(`Changes since ${changes.since}`.slice(0, 31));
    header(cw, project, `Changes since revision ${changes.since}`, 7);
    cw.columns = [{ width: 8 }, { width: 62 }, { width: 7 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 16 }];
    cw.getRow(4).values = ['Section', 'Description', 'Unit', `Rev ${changes.since}`, 'Now', 'Change', `Cost change (${cur})`];
    head(cw.getRow(4));
    changes.rows.forEach((c, i) => {
      const row = cw.getRow(5 + i);
      row.values = [c.section, c.description, c.unit, c.before, c.after, c.delta, c.cost];
      row.eachCell((x) => (x.border = box));
      row.getCell(6).font = { color: { argb: c.delta > 0 ? 'FF13803D' : 'FFC21F32' } };
    });
    const tot = cw.getRow(6 + changes.rows.length);
    tot.values = ['', 'Net change', '', '', '', '', changes.rows.reduce((a, c) => a + c.cost, 0)];
    tot.font = { bold: true };
    cw.getColumn(7).numFmt = MONEY;
    cw.mergeCells(tot.number + 2, 1, tot.number + 2, 7);
    cw.getCell(tot.number + 2, 1).value = revisionComparisonNote;
    cw.getCell(tot.number + 2, 1).alignment = { wrapText: true, vertical: 'top' };
    cw.getRow(tot.number + 2).height = 32;
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

function billRow(it: PricedItem, number: string): string {
  const rate = (charge: boolean, missing: boolean | undefined, value: number | undefined) => !charge ? '—' : missing || value === undefined ? '<span class="flag">NO RATE</span>' : m2(value);
  const amount = it.source === 'excluded' ? escH(noChargeLabel(it)) : `${m2(it.amount)}${!validQuantity(it) ? ' <span class="flag">INVALID QUANTITY</span>' : ''}${unpriced(it) ? ' <span class="flag">NO RATE — partial / incomplete</span>' : ''}`;
  const detail = [responsibilityDetails(it), quantityDetails(it)].filter(Boolean).map(escH).join('<br>');
  return `<tr><td>${escH(number)}</td><td>${escH(it.description)}${detail ? `<div class="m">${detail}</div>` : ''}${it.source === 'typical' ? ' <span class="flag">typical rate</span>' : ''}${it.designQty !== undefined ? ` <span class="flag">qty changed (design ${m2(it.designQty)})${it.changed ? ' — design moved, review' : ''}</span>` : ''}</td><td>${escH(it.unit)}</td><td class="n">${validQuantity(it) ? m2(it.qty) : '<span class="flag">INVALID</span>'}</td><td class="n">${rate(supplyCharge(it), it.supplyRateMissing, it.rate)}</td><td class="n">${rate(installCharge(it), it.installRateMissing, it.labour)}</td><td class="n">${amount}</td></tr>`;
}

/** The BOQ as a printable page (PDF): header with logo, summary, and — unless
 * summaryOnly — the full bill with section totals. */
export function buildBoqHtml(project: Project, bom: PricedBom, list?: PriceList, summaryOnly = false): string {
  const basis = pricingBasis(bom, list);
  const cur = list?.currency ?? 'AED';
  const template = templateLabel(project);
  const review = exportReview(project, bom);
  const logo = project.drawing?.logo?.startsWith('data:image/') ? `<img class="logo" src="${escH(project.drawing.logo)}" alt="">` : '';
  const summary = `<table class="t"><thead><tr><th>Section</th><th>Description</th><th class="n">Amount (${escH(cur)})</th></tr></thead><tbody>
    ${bom.sections.map((s) => `<tr><td>${escH(s.section)}</td><td>${escH(s.title)}</td><td class="n">${m2(s.amount)}</td></tr>`).join('')}
    <tr class="b"><td></td><td>Subtotal</td><td class="n">${m2(bom.subtotal)}</td></tr>
    ${list?.markupPct ? `<tr><td></td><td>Overheads and profit (${list.markupPct} %)</td><td class="n">${m2(bom.markup)}</td></tr>` : ''}
    ${bom.discount ? `<tr><td></td><td>Discount</td><td class="n">−${m2(bom.discount)}</td></tr>` : ''}
    <tr class="b"><td></td><td>Total</td><td class="n">${escH(cur)} ${m2(bom.total)}</td></tr></tbody></table>`;
  const bill = summaryOnly ? '' : `<h2>Bill of quantities</h2><table class="t"><thead><tr><th>Item</th><th>Description</th><th>Unit</th><th class="n">Qty</th><th class="n">Supply</th><th class="n">Install</th><th class="n">Amount</th></tr></thead><tbody>
    ${bom.sections.map((s) => `<tr class="sec"><td>${escH(s.section)}</td><td colspan="6">${escH(s.title.toUpperCase())}</td></tr>${s.items.map((it, i) => billRow(it, `${s.section}.${i + 1}`)).join('')}<tr class="b"><td></td><td colspan="5">Total section ${escH(s.section)} carried to summary</td><td class="n">${m2(s.amount)}</td></tr>`).join('')}
    </tbody></table>`;
  const decisions = template ? scopeDecisions(project) : [];
  const unreviewed = decisions.filter((check) => check.decision === 'not-reviewed').length;
  const categories = new Map<string, number>();
  for (const check of review) {
    const category = reviewCategories[check.id.split(':')[0]] ?? 'Other checks';
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const scopeBrief = template || review.length ? `<div class="basis scope-brief${review.length ? ' warn' : ''}"><b>${template ? `Scope template: ${escH(template)}` : 'BOQ data review'}</b>${review.length ? `<p>${review.length} ${template ? `scope check(s) need review; ${unreviewed} checklist area(s) not reviewed` : 'data check(s) need review'}.</p><ul>${[...categories].slice(0, 3).map(([category, count]) => `<li>${escH(category)}: ${count}</li>`).join('')}</ul>` : '<p>No pending checklist entries. Validate quantities, specification and contract documents before tender.</p>'}<p>${summaryOnly ? 'Full review details and complete exclusions are in the full BOQ appendix.' : 'Full review details follow the bill in the BOQ appendix.'}</p><p>This is a design-based estimate; checklist completion is not contract approval.</p></div>` : '';
  const appendix = (template || review.length || project.boq?.scopeNotes) && !summaryOnly ? `<section class="scope-appendix"><h2>${template ? `Scope review appendix — ${escH(template)}` : 'BOQ data review appendix'}</h2>
    ${template ? `<h2>Scope checklist decisions</h2><table class="t"><thead><tr><th>Scope area</th><th>Decision</th></tr></thead><tbody>${decisions.map((check) => `<tr><td>${escH(check.title)}</td><td>${escH(check.label)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${project.boq?.scopeNotes ? `<h2>Scope exclusions / assumptions</h2><p class="scope-notes">${escH(project.boq.scopeNotes)}</p>` : ''}
    <h2>Outstanding checks (${review.length})</h2>${review.length ? `<ul>${review.map((check) => `<li>${escH(check.message)}</li>`).join('')}</ul>` : '<p>No pending checklist entries.</p>'}
    <p>This is a design-based estimate; checklist completion is not contract approval.</p></section>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escH(project.name)} — BOQ</title><style>
    @page { size: A4; margin: 12mm; } body { font: 9.5px/1.35 Arial, sans-serif; color: #111; margin: 0; }
    header { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 8px; }
    header h1 { font-size: 15px; margin: 0; } .logo { max-height: 12mm; max-width: 45mm; } .sp { flex: 1; } .m { color: #555; }
    h2 { font-size: 12px; margin: 12px 0 4px; }
    .t { width: 100%; border-collapse: collapse; } .t th, .t td { border: 0.2mm solid #999; padding: 2px 4px; vertical-align: top; }
    .t th { background: #1d4f8f; color: #fff; text-align: left; } .n { text-align: right; white-space: nowrap; }
    .sec td { background: #dbe7f7; font-weight: 700; } .b td { font-weight: 700; } thead { display: table-header-group; } tr { break-inside: avoid; }
  .basis{border:1px solid #999;border-radius:4px;padding:5px 9px;margin:6px 0 10px;font-size:10px}.basis.warn{border-color:#b45309;background:#fef3c7}.basis ul{margin:3px 0 0 16px;padding:0}.basis p{margin:3px 0 0}
  .flag{font-size:8.5px;font-weight:600;color:#9a3412}
  .scope-appendix{break-before:page}.scope-appendix li{break-inside:avoid}.scope-notes{white-space:pre-wrap;overflow-wrap:anywhere}
  </style></head><body>
  <header>${logo}<div><h1>${escH(project.name)}</h1><div class="m">Bill of quantities · ${escH(revisionStamp(project))}${project.info?.owner ? ` · ${escH(project.info.owner)}` : ''}</div></div><span class="sp"></span><div class="m">Rates: ${list ? `${escH(list.name)}, ${escH(list.date)}${basis.typical ? ` + ${basis.typical} at typical rates` : ''}` : 'typical built-in rates (illustrative)'}</div></header>
  <div class="basis${basis.missing || basis.typical || basis.designMoved ? ' warn' : ''}"><b>Pricing basis</b><ul>${basis.lines.map((l) => `<li>${escH(l)}</li>`).join('')}</ul>${summaryOnly && (basis.missing || basis.typical) ? '<p>Items without a list rate are named in the full BOQ.</p>' : ''}</div>
  ${scopeBrief}
  ${project.boq?.scopeNotes ? `<div class="basis"><b>Scope exclusions / assumptions</b><p class="scope-notes">${escH(briefText(project.boq.scopeNotes))}</p>${project.boq.scopeNotes.length > 200 ? '<p>See the full BOQ appendix for complete notes.</p>' : ''}</div>` : ''}
  <h2>Summary</h2>${summary}${bill}${appendix}
  </body></html>`;
}
