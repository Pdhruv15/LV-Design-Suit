import ExcelJS from 'exceljs';
import type { Project } from '../types';
import { sheetRev, type DrawingIssue, type DrawingSet } from '../model/drawingSet';
import { currentRevision } from '../model/revisions';

/** The drawing register as a submission-ready Excel workbook: a heading
 * block (project, client, consultant, plot), the sheet table with borders,
 * filters and frozen headings, set up to print on A4 landscape, plus the
 * issue history; and a transmittal workbook for one issue. */

const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const headFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFDCE6F1' } };
const keyFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF2F5F9' } };

function heading(ws: ExcelJS.Worksheet, title: string, span: number, company: string, rows: [string, string][]) {
  let r = 1;
  if (company) { ws.mergeCells(r, 1, r, span); ws.getCell(r, 1).value = company; ws.getCell(r, 1).font = { bold: true, size: 12 }; r++; }
  ws.mergeCells(r, 1, r, span);
  ws.getCell(r, 1).value = title;
  ws.getCell(r, 1).font = { bold: true, size: 15 };
  r += 2;
  for (const [k, v] of rows) {
    ws.mergeCells(r, 1, r, 2); ws.mergeCells(r, 3, r, span);
    const kc = ws.getCell(r, 1), vc = ws.getCell(r, 3);
    kc.value = k; kc.font = { bold: true }; kc.fill = keyFill;
    vc.value = v;
    for (let c = 1; c <= span; c++) ws.getCell(r, c).border = border;
    r++;
  }
  return r + 1;
}

function table(ws: ExcelJS.Worksheet, start: number, head: string[], body: (string | number)[][]) {
  const h = ws.getRow(start);
  head.forEach((t, i) => { const c = h.getCell(i + 1); c.value = t; c.font = { bold: true }; c.fill = headFill; c.border = border; c.alignment = { vertical: 'middle', wrapText: true }; });
  body.forEach((vals, j) => {
    const row = ws.getRow(start + 1 + j);
    vals.forEach((v, i) => { const c = row.getCell(i + 1); c.value = v; c.border = border; c.alignment = { vertical: 'top', wrapText: true }; });
  });
  return start + body.length;
}

function print(ws: ExcelJS.Worksheet, landscape: boolean, titleRow: number) {
  ws.pageSetup = { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }, printTitlesRow: `${titleRow}:${titleRow}` };
  ws.headerFooter = { oddFooter: '&L&8&F&R&8Page &P of &N' };
}

const infoRows = (p: Project): [string, string][] => [
  ['Project', p.name],
  ['Owner / client', p.info?.owner ?? ''],
  ['Consultant', p.info?.consultant ?? ''],
  ['Plot no. / area', [p.info?.plotNo, p.info?.area].filter(Boolean).join(' · ')]
];

export function buildRegisterWorkbook(p: Project, set: DrawingSet): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const d = p.drawing ?? {};
  const rev = currentRevision(p);
  const company = d.company ?? p.info?.consultant ?? '';
  const ws = wb.addWorksheet('Drawing register');
  const head = ['#', 'Drawing no.', 'Title', 'Size', 'Rev', 'Date', 'Status', 'Drawn', 'Checked', 'Approved', 'Scale', 'Remarks'];
  const start = heading(ws, 'DRAWING REGISTER — SINGLE LINE DIAGRAMS', head.length, company, [...infoRows(p), ['Sheets', String(set.sheets.length)]]);
  const body = set.sheets.map((s, i) => [
    i + 1, s.number, s.title, s.size === 'auto' ? 'Auto' : s.size, sheetRev(s, rev?.id), s.date || s.history?.[s.history.length - 1]?.date || rev?.date || '',
    s.status || set.status || '', s.drawnBy || d.drawnBy || '', s.checkedBy || d.checkedBy || '', s.approvedBy || d.approvedBy || '', s.scale || 'NTS', s.remarks ?? ''
  ]);
  const end = table(ws, start, head, body);
  ws.columns.forEach((c, i) => { c.width = [5, 18, 46, 7, 6, 12, 24, 14, 14, 14, 8, 30][i]; });
  if (body.length) ws.autoFilter = { from: { row: start, column: 1 }, to: { row: end, column: head.length } };
  ws.views = [{ state: 'frozen', ySplit: start, xSplit: 0 }];
  print(ws, true, start);

  const issues = set.issues ?? [];
  if (issues.length) {
    const hs = wb.addWorksheet('Issue history');
    const hHead = ['Issue', 'Date', 'Purpose', 'Description', 'To', 'Drawing no.', 'Title', 'Rev'];
    const hStart = heading(hs, 'ISSUE HISTORY', hHead.length, company, infoRows(p));
    const rows: (string | number)[][] = [];
    for (const x of issues) x.sheets.forEach((s, k) => rows.push(k === 0 ? [x.id, x.date, x.purpose, x.description, x.to ?? '', s.number, s.title, s.rev] : ['', '', '', '', '', s.number, s.title, s.rev]));
    const hEnd = table(hs, hStart, hHead, rows);
    hs.columns.forEach((c, i) => { c.width = [9, 12, 22, 34, 14, 18, 40, 6][i]; });
    if (rows.length) hs.autoFilter = { from: { row: hStart, column: 1 }, to: { row: hEnd, column: hHead.length } };
    hs.views = [{ state: 'frozen', ySplit: hStart, xSplit: 0 }];
    print(hs, true, hStart);
  }
  return wb;
}

export function buildTransmittalWorkbook(p: Project, issue: DrawingIssue): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const ws = wb.addWorksheet(issue.id);
  const company = p.drawing?.company ?? p.info?.consultant ?? '';
  const head = ['#', 'Drawing no.', 'Title', 'Rev', 'Copies'];
  const start = heading(ws, `DRAWING TRANSMITTAL ${issue.id}`, head.length, company, [
    ...infoRows(p), ['To', issue.to ?? ''], ['Date', issue.date], ['Purpose of issue', issue.purpose], ['Description', issue.description]
  ]);
  const end = table(ws, start, head, issue.sheets.map((s, i) => [i + 1, s.number, s.title, s.rev, '1 (PDF)']));
  ws.getCell(end + 3, 1).value = 'Issued by:';
  ws.getCell(end + 3, 3).value = 'Received by (name, signature, date):';
  ws.columns.forEach((c, i) => { c.width = [5, 20, 50, 7, 10][i]; });
  print(ws, false, start);
  return wb;
}
