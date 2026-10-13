import ExcelJS from 'exceljs';
import type { Project } from '../types';
import { additionsOf, lineAmount, netOf, omissionsOf, valueOf, variationsOf, variationTotals, VO_STATUS, type Variation } from '../model/variations';
import { amountInWords, printDoc } from './boqWorkbook';
import { reportDoc } from './reportFrame';
import { esc } from './report';

/** The variation account as print documents: the register (every variation with its status and
 * value, and the contract sum: contract BOQ + approved = revised, + submitted = anticipated final)
 * and one sheet per variation (lines added and omitted, net and approved value, sign-off). */

const m2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${m2(Math.abs(n))}`;
const qty = (n?: number) => (n === undefined || !Number.isFinite(n) || n === 0 ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
const day = (iso?: string) => {
  const d = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : iso ?? '';
};
const list = (vos: Variation[]) => vos.map((v) => v.id).join(', ');

export interface VariationDocOptions {
  /** The register page (default true). */
  register?: boolean;
  /** Variations printed as sheets (default: every one that is not a draft). */
  sheets?: string[];
  /** "As at" date (YYYY-MM-DD), default today. */
  date?: string;
}

export function buildVariationHtml(project: Project, o: VariationDocOptions = {}): string {
  const t = variationTotals(project);
  const vos = variationsOf(project);
  const cur = project.priceList?.currency ?? 'AED';
  const doc = project.boq?.document ?? {};
  const d = reportDoc(project, { title: 'Variation register', docNo: doc.docNo, preparedBy: doc.preparedBy, checkedBy: doc.checkedBy, approvedBy: doc.approvedBy });
  const asAt = day(o.date ?? new Date().toISOString().slice(0, 10));
  const contractLabel = t.contract ? `BOQ Rev ${t.contract.id}` : 'no contract BOQ marked';
  const footer = [d.docNo, `Contract: ${contractLabel}`, asAt].filter(Boolean).join(' · ');
  const sheets = vos.filter((v) => (o.sheets ? o.sheets.includes(v.id) : v.status !== 'draft'));
  const showRegister = o.register ?? true;

  const register = `<section>
    <h2>Variation register</h2>
    <p class="small sub">${esc([project.name, 'Electrical LV works', `Contract BOQ: ${t.contract ? [d.docNo, `Rev ${t.contract.id}`].filter(Boolean).join(' ') : 'not marked'}`, `Amounts in ${cur} excluding VAT`, `As at ${asAt}`].join(' · '))}</p>
    ${vos.length ? `<table class="b"><colgroup><col style="width:17mm"><col><col style="width:27mm"><col style="width:19mm"><col style="width:25mm"><col style="width:25mm"></colgroup>
      <thead><tr><th>VO no.</th><th>Description</th><th>Instructed by</th><th>Status</th><th>Value<br>(submitted)</th><th>Value<br>(approved)</th></tr></thead>
      <tbody>${vos.map((v) => {
        const when = v.decided ? `${VO_STATUS[v.status]} ${day(v.decided)}` : v.submitted ? `submitted ${day(v.submitted)}` : '';
        const approved = v.status === 'approved' ? signed(valueOf(v)) : v.status === 'rejected' || v.status === 'withdrawn' ? '<i>Nil</i>' : '—';
        const folded = v.foldedInto !== undefined ? `in BOQ Rev ${v.foldedInto}` : '';
        return `<tr><td>${esc(v.id)}</td><td>${esc(v.title)}<div class="ref">${esc([v.reference, when, folded].filter(Boolean).join(' · '))}</div></td><td>${esc(v.instructedBy ?? '')}</td><td>${VO_STATUS[v.status]}</td><td class="n">${v.status === 'draft' ? `<i>${signed(netOf(v))}</i>` : signed(netOf(v))}</td><td class="n">${approved}</td></tr>`;
      }).join('')}</tbody>
    </table>` : '<p>No variations recorded.</p>'}
    <h3>Contract sum</h3>
    <table class="b sum account"><colgroup><col><col style="width:34mm"></colgroup>
      <tbody><tr><td>Original contract sum — ${esc(contractLabel)} (excluding VAT)</td><td class="n">${t.contract ? m2(t.contractSum) : '—'}</td></tr>
        <tr><td>Approved variations${t.approved.length ? ` (${esc(list(t.approved))})` : ''}</td><td class="n">${signed(t.approvedSum) || '0.00'}</td></tr></tbody>
      <tbody class="tot"><tr><td>Revised contract sum</td><td class="n">${m2(t.revised)}</td></tr></tbody>
      <tbody><tr><td>Variations submitted, awaiting decision${t.pending.length ? ` (${esc(list(t.pending))})` : ''}</td><td class="n">${signed(t.pendingSum) || '0.00'}</td></tr></tbody>
      <tbody class="gt"><tr><td>ANTICIPATED FINAL CONTRACT SUM (excluding VAT)</td><td class="n">${m2(t.anticipated)}</td></tr></tbody>
      ${t.vatPct ? `<tbody><tr><td>VAT (${t.vatPct} %)</td><td class="n">${m2(t.anticipated * t.vatPct / 100)}</td></tr></tbody>
      <tbody class="tot"><tr><td>Anticipated final contract sum including VAT</td><td class="n">${m2(t.anticipated * (1 + t.vatPct / 100))}</td></tr></tbody>` : ''}
    </table>
    <p class="small">${esc([
      t.contract ? '' : 'Mark the BOQ revision that is the contract (BOM / Cost → Revisions) to state the original contract sum.',
      t.drafts.length ? `Draft variations (${list(t.drafts)}) are not included.` : '',
      t.closed.length ? `Rejected and withdrawn variations (${list(t.closed)}) are listed for the record at nil value.` : '',
      t.inContract.length ? `${list(t.inContract)} ${t.inContract.length > 1 ? 'are' : 'is'} included in the contract BOQ and not added again.` : '',
      'Approved values are as agreed; they may differ from the submitted value.'
    ].filter(Boolean).join(' '))}</p>
  </section>`;

  const sheet = (v: Variation, first: boolean) => {
    const value = valueOf(v);
    const rows: [string, string][] = [['Title', `<b>${esc(v.title)}</b>`], ['Reason', esc(v.reason ?? '')], ['Instructed by', esc(v.instructedBy ?? '')], ['Instruction reference', esc(v.reference ?? '')],
      ['Raised / submitted', esc(`${day(v.raised)}${v.submitted ? ` / ${day(v.submitted)}` : ''}`)],
      ['Status', `<b>${VO_STATUS[v.status]}</b>${esc(v.decided ? ` — ${day(v.decided)}${v.decisionRef ? `, ${v.decisionRef}` : ''}` : '')}${v.foldedInto !== undefined ? esc(` · brought into BOQ Rev ${v.foldedInto}`) : ''}`]];
    return `<section class="${first && !showRegister ? '' : 'page'}">
    <h2>Variation order ${esc(v.id)}</h2>
    <table class="kv" style="margin-bottom:4mm"><tbody>${rows.filter(([, x]) => x).map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join('')}</tbody></table>
    <table class="b"><colgroup><col style="width:18mm"><col><col style="width:10mm"><col style="width:13mm"><col style="width:13mm"><col style="width:21mm"><col style="width:24mm"></colgroup>
      <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Add<br>(+)</th><th>Omit<br>(−)</th><th>Rate</th><th>Amount<br>(${esc(cur)})</th></tr></thead>
      <tbody>${v.lines.length ? v.lines.map((l) => `<tr><td>${esc(l.no)}</td><td>${esc(l.description)}<div class="ref">${esc([l.basis ?? (l.key ? 'Contract rate' : 'New rate'), l.key ? `BOQ item ${l.no}` : ''].filter(Boolean).join(' · '))}</div></td><td class="c">${esc(l.unit)}</td><td class="n">${qty(l.add)}</td><td class="n">${qty(l.omit)}</td><td class="n">${m2(l.rate)}</td><td class="n">${signed(lineAmount(l)) || '0.00'}</td></tr>`).join('') : '<tr><td></td><td colspan="6"><i>No lines</i></td></tr>'}</tbody>
      <tbody class="tot"><tr><td></td><td colspan="5">Additions</td><td class="n">${m2(additionsOf(v))}</td></tr>
      <tr><td></td><td colspan="5">Omissions</td><td class="n">${signed(-omissionsOf(v)) || '0.00'}</td></tr></tbody>
      <tbody class="gt"><tr><td></td><td colspan="5">NET VALUE OF THIS VARIATION (excluding VAT)</td><td class="n">${signed(netOf(v)) || '0.00'}</td></tr></tbody>
      ${v.status === 'approved' && v.approvedValue !== undefined ? `<tbody class="tot"><tr><td></td><td colspan="5">Approved value</td><td class="n">${signed(value) || '0.00'}</td></tr></tbody>` : ''}
    </table>
    <div class="words"><b>${v.status === 'approved' ? 'Approved' : 'Net'} value in words:</b> ${esc(amountInWords(Math.abs(value), cur))}${value < 0 ? ' (omission)' : ''}.</div>
    <p class="small">${esc(`Contract rates are from ${contractLabel}. New items are numbered under the variation (${v.id}/1, /2 …) and carry agreed new rates.`)}</p>
    <table class="grid sign"><thead><tr><th style="width:32mm"></th><th>Name</th><th style="width:28mm">Date</th><th style="width:45mm">Signature</th></tr></thead>
      <tbody><tr><td>Prepared by</td><td>${esc(d.preparedBy ?? '')}</td><td>${esc(day(v.raised))}</td><td class="sig"></td></tr>
      <tr><td>Checked by</td><td>${esc(d.checkedBy ?? '')}</td><td></td><td class="sig"></td></tr>
      <tr><td>Approved by (client / consultant)</td><td></td><td>${esc(v.status === 'approved' ? day(v.decided) : '')}</td><td class="sig"></td></tr></tbody></table>
  </section>`;
  };

  const body = `${showRegister ? register : ''}${sheets.map((v, i) => sheet(v, i === 0)).join('')}`;
  const title = showRegister ? 'Variation register' : sheets.length === 1 ? `Variation order ${sheets[0].id}` : 'Variation orders';
  return printDoc(project, { title: `${project.name} — ${title}`, headRight: showRegister ? 'VARIATION REGISTER' : 'VARIATION ORDER', footer, body })
    .replace('</style>', '.account tbody:first-of-type tr:first-child td { border-top: 0.4pt solid #000; }</style>');
}

/** The variation account in Excel: the register with the contract sum, and every line. */
export function buildVariationWorkbook(project: Project): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const t = variationTotals(project);
  const vos = variationsOf(project);
  const cur = project.priceList?.currency ?? 'AED';
  const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const head = (r: ExcelJS.Row) => { r.font = { bold: true }; r.eachCell((c) => { c.border = box; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; }); };

  const ws = wb.addWorksheet('Variation register', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.getCell(1, 1).value = project.name;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `Variation register — contract ${t.contract ? `BOQ Rev ${t.contract.id}` : 'BOQ not marked'} — amounts in ${cur} excluding VAT`;
  ws.columns = [{ width: 10 }, { width: 48 }, { width: 22 }, { width: 30 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 10 }];
  ws.getRow(4).values = ['VO no.', 'Title', 'Instructed by', 'Reference', 'Status', 'Submitted', 'Decided', 'Value (submitted)', 'Value (approved)', 'In BOQ rev'];
  head(ws.getRow(4));
  let r = 5;
  for (const v of vos) {
    const row = ws.getRow(r++);
    row.values = [v.id, v.title, v.instructedBy ?? '', v.reference ?? '', VO_STATUS[v.status], v.submitted ?? '', v.decided ?? '', netOf(v), v.status === 'approved' ? valueOf(v) : v.status === 'rejected' || v.status === 'withdrawn' ? 0 : null, v.foldedInto ?? ''];
    row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= 10) c.border = box; });
  }
  r++;
  const line = (label: string, value: number, bold = false) => { const row = ws.getRow(r++); row.values = ['', label, '', '', '', '', '', '', value]; row.font = { bold }; };
  line(`Original contract sum${t.contract ? ` (BOQ Rev ${t.contract.id})` : ''}`, t.contractSum);
  line('Approved variations', t.approvedSum);
  line('Revised contract sum', t.revised, true);
  line('Submitted, awaiting decision', t.pendingSum);
  line('Anticipated final contract sum (excluding VAT)', t.anticipated, true);
  if (t.vatPct) { line(`VAT (${t.vatPct} %)`, t.anticipated * t.vatPct / 100); line('Anticipated final contract sum including VAT', t.anticipated * (1 + t.vatPct / 100), true); }
  for (const c of [8, 9]) ws.getColumn(c).numFmt = '#,##0.00';
  ws.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  const ls = wb.addWorksheet('Variation lines', { views: [{ state: 'frozen', ySplit: 1 }] });
  ls.columns = [{ header: 'VO no.', width: 10 }, { header: 'Status', width: 12 }, { header: 'Item', width: 12 }, { header: 'Description', width: 56 }, { header: 'Unit', width: 7 }, { header: 'Add', width: 9 }, { header: 'Omit', width: 9 }, { header: `Rate (${cur})`, width: 13 }, { header: `Amount (${cur})`, width: 14 }, { header: 'Rate basis', width: 22 }];
  head(ls.getRow(1));
  for (const v of vos) for (const l of v.lines) ls.addRow([v.id, VO_STATUS[v.status], l.no, l.description, l.unit, l.add ?? null, l.omit ?? null, l.rate, lineAmount(l), l.basis ?? (l.key ? 'Contract rate' : 'New rate')]);
  for (const c of [8, 9]) ls.getColumn(c).numFmt = '#,##0.00';
  return wb;
}
