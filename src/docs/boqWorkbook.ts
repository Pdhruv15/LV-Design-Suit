import ExcelJS from 'exceljs';
import type { Project } from '../types';
import type { BomItem } from '../calc/bom';
import type { BomChange, PriceList, PricedBom } from '../model/priceList';
import { revisionStamp } from '../model/revisions';

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
  line('Total', bom.total, true);
  sum.getColumn(3).numFmt = MONEY;
  r++;
  sum.getCell(r++, 2).value = `Rates: ${list ? `${list.name}, ${list.date}` : 'typical built-in rates (cables and breakers only)'}`;
  if (bom.missing) sum.getCell(r++, 2).value = `${bom.missing} item(s) have no rate yet — shown with an empty rate on the bill.`;
  sum.getCell(r++, 2).value = 'Quantities from the design as it is; to be checked before tender.';

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
      row.values = [`${s.section}.${i + 1}`, it.description, it.unit, it.qty, it.rate ?? null, it.labour || null, null, it.where.slice(0, 6).join(', ') + (it.where.length > 6 ? '…' : '')];
      row.getCell(7).value = { formula: `D${row.number}*(E${row.number}+F${row.number})`, result: it.amount };
      row.getCell(2).alignment = { wrapText: true };
      row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= 8) c.border = box; });
      if (it.source === 'missing') row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    });
    const st = ws.getRow(r++);
    st.values = ['', `Total section ${s.section} carried to summary`, '', '', '', '', s.amount];
    st.font = { bold: true };
    st.getCell(7).border = box;
    r++;
  }
  for (const c of [5, 6, 7]) ws.getColumn(c).numFmt = MONEY;

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

/** Reads rates from a workbook: a sheet with Key (or Description) and Rate
 * columns; Install / Labour optional. Rows without a number are skipped. */
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
  if (cRate < 0 || (cKey < 0 && cDesc < 0)) return { rates, read, unmatched };
  const num = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'object' && v && 'result' in v ? Number((v as { result: unknown }).result) : Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; };
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const rate = num(row.getCell(cRate).value);
    if (rate === undefined || String(row.getCell(cRate).value ?? '') === '') return;
    const desc = cDesc >= 0 ? String(row.getCell(cDesc).value ?? '').trim() : '';
    const key = (cKey >= 0 ? String(row.getCell(cKey).value ?? '').trim() : '') || byDesc.get(desc.toLowerCase());
    if (!key) { unmatched++; return; }
    const labour = cLab >= 0 ? num(row.getCell(cLab).value) : undefined;
    rates[key] = { rate, ...(labour ? { labour } : {}), ...(desc ? { description: desc } : {}) };
    read++;
  });
  return { rates, read, unmatched };
}
