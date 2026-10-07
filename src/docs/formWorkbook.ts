import ExcelJS from 'exceljs';
import { SCHEDULE_GROUPS, scheduleGroups } from '../model/scheduleGroups';
import { boardLocation } from '../model/levels';
import { scheduleCircuits } from '../calc/loadSchedule';
import type { Project } from '../types';
import { buildDbSheet } from './dbSheet';
import { buildMdSheet, hasMdSheet } from './mdSheet';
import { revisionStamp } from '../model/revisions';
import { acbText, buildTxSummary, rowCtText } from './txSummary';
import { buildRiserForm, type RiserFormRow } from './riserForm';

/** Page header and footer printed on every sheet: revision top right. */
function stamp(ws: ExcelJS.Worksheet, project: Project) {
  ws.headerFooter = {
    oddHeader: `&R&"Arial"&9${revisionStamp(project)}`,
    oddFooter: `&L&"Arial"&8${project.name.replace(/&/g, '&&')}&R&"Arial"&8Page &P of &N`
  };
}

/** The authority submission forms as a real Excel workbook, laid out like
 * the DEWA villa sample: the connected load & MD form (load summary, MDB,
 * SMDB, MCC) and the DB load distribution schedule — merged cells, borders,
 * rotated headings, A4 page setup. Values are the app's calculated ones. */

type Ws = ExcelJS.Worksheet;
type Val = string | number | null | undefined;

const FONT = 'Arial';
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
const medium: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF000000' } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

/** ExcelJS can share one style object between the cells of a column, so a
 * border set on one cell would change them all: always give the cell a new
 * style object. */
function restyle(cell: ExcelJS.Cell, patch: Partial<ExcelJS.Style>) {
  cell.style = { ...cell.style, ...patch };
}

function put(ws: Ws, r: number, c: number, v: Val, o: { bold?: boolean; size?: number; align?: 'left' | 'center' | 'right'; wrap?: boolean; rotate?: boolean; border?: boolean; fill?: string } = {}) {
  const cell = ws.getCell(r, c);
  cell.value = v === undefined || v === '' ? null : v;
  restyle(cell, {
    font: { name: FONT, size: o.size ?? 9, bold: !!o.bold },
    alignment: { horizontal: o.align ?? 'center', vertical: 'middle', wrapText: o.wrap ?? true, ...(o.rotate ? { textRotation: 90 } : {}) },
    ...(o.border ? { border: { ...BORDER } } : {}),
    ...(o.fill ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } } } : {})
  });
}

/** Merge a block and give every cell of it the same border. */
function merge(ws: Ws, r1: number, c1: number, r2: number, c2: number) {
  if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
}

function box(ws: Ws, r1: number, c1: number, r2: number, c2: number) {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) restyle(ws.getCell(r, c), { border: { ...BORDER } });
}

/** Heavy frame around the whole form, like the printed sheet. */
function frame(ws: Ws, r1: number, c1: number, r2: number, c2: number) {
  for (let r = r1; r <= r2; r++) {
    const a = ws.getCell(r, c1);
    restyle(a, { border: { ...a.border, left: medium } });
    const b = ws.getCell(r, c2);
    restyle(b, { border: { ...b.border, right: medium } });
  }
  for (let c = c1; c <= c2; c++) {
    const a = ws.getCell(r1, c);
    restyle(a, { border: { ...a.border, top: medium } });
    const b = ws.getCell(r2, c);
    restyle(b, { border: { ...b.border, bottom: medium } });
  }
}

const sheetName = (wb: ExcelJS.Workbook, name: string) => {
  const base = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
  let n = base;
  for (let i = 2; wb.getWorksheet(n); i++) n = `${base.slice(0, 28)} ${i}`;
  return n;
};

/** Connected load, maximum demand & kWh metering (landscape). */
export function addMdSheet(wb: ExcelJS.Workbook, project: Project, boardId: string, name?: string): Ws {
  const s = buildMdSheet(project, boardId);
  const f = s.form;
  const ws = wb.addWorksheet(sheetName(wb, name ?? boardId), {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }]
  });
  const n = s.keys.length; // 20 columns
  const widths = [26, 6, 6, 7, 6, 7, 9, 13, 7, 9, 9, 8, 8, 8, 11, 12, 6, 6, 7, 20];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const at = (k: string) => s.keys.indexOf(k as never) + 1;

  // Header block
  put(ws, 1, 1, 'PROJECT:', { align: 'left' }); put(ws, 1, 2, f.project, { align: 'left', bold: true }); merge(ws, 1, 2, 1, 5);
  put(ws, 1, 6, f.title, { bold: true, size: 11 }); merge(ws, 1, 6, 1, 16);
  put(ws, 1, 17, `AREA : ${f.area}`, { align: 'left' }); merge(ws, 1, 17, 1, n);
  put(ws, 2, 1, `PLANNED COMPLETION DATE: ${f.completion}`, { align: 'left' }); merge(ws, 2, 1, 2, 5);
  put(ws, 2, 6, `OWNER: ${f.owner}`); merge(ws, 2, 6, 2, 16);
  put(ws, 2, 17, `PLOT NO: ${f.plotNo}`, { align: 'left' }); merge(ws, 2, 17, 2, n);
  put(ws, 3, 1, f.boardLine, { align: 'left' }); merge(ws, 3, 1, 3, 5);
  put(ws, 3, 6, `CONSULTANT: ${f.consultant}`); merge(ws, 3, 6, 3, 16);
  put(ws, 3, 17, `LOCATION : ${f.location}`, { align: 'left' }); merge(ws, 3, 17, 3, n);
  [1, 2, 3].forEach((r) => (ws.getRow(r).height = 18));

  // Table heading: groups on row 4, column titles on row 5.
  const h1 = 4, h2 = 5;
  const single = ['name', 'sptp', 'fault', 'ecc', 'length', 'tcl', 'mdl', 'remarks'];
  const titles: Record<string, string> = {
    name: 'CIRCUIT/FEEDER\n\nSMDB/ DB NO.', sptp: 'SP/\nTP', fault: 'FAULT DUTY kA', ecc: 'ECC SIZE 1C mm2', length: 'LENGTH OF CABLE (Mtrs)',
    tcl: 'TOTAL CONNECTED /INSTALLED LOAD (TCL) Kw', mdl: 'MAXIMUM DEMAND/ OPERATIONAL LOAD (MDL) Kw', remarks: 'REMARKS',
    ACB: 'ACB', MCCB: 'MCCB', ISOL: 'ISOL', cores: 'NO. OF CORES: 1C/2C/4C', type: 'TYPE: XLPE/PVC/SWA', size: 'SIZE',
    R: 'R-PH kW', Y: 'Y-PH kW', B: 'B-PH kW', '1-PH': '1-PH (1)', '3-PH': '3-PH (2)', CT: 'LV/HV-CT (3)'
  };
  for (const k of single) { put(ws, h1, at(k), titles[k], { border: true }); merge(ws, h1, at(k), h2, at(k)); }
  const group = (from: string, to: string, title: string) => {
    put(ws, h1, at(from), title, { border: true });
    merge(ws, h1, at(from), h1, at(to));
    for (let c = at(from); c <= at(to); c++) put(ws, h2, c, titles[s.keys[c - 1]], { border: true });
  };
  group('ACB', 'ISOL', 'RATING (AMPS)');
  group('cores', 'size', 'CABLE SIZE, TYPE & No.OF CORES');
  group('R', 'B', 'CONNECTED LOAD kW');
  group('1-PH', 'CT', 'PROPOSED TYPE & No OF kWh METER');
  box(ws, h1, 1, h2, n);
  ws.getRow(h1).height = 30;
  ws.getRow(h2).height = 44;

  // Rows
  let r = h2 + 1;
  s.rows.forEach((row, y) => {
    const line = s.data[y];
    line.forEach((v, x) => put(ws, r, x + 1, v, { border: true, align: x === 0 || s.keys[x] === 'remarks' ? 'left' : 'center' }));
    if (row.type === 'label') merge(ws, r, 1, r, n);
    if (row.type === 'incomer' && !row.feeder) merge(ws, r, at('cores'), r, at('size'));
    ws.getRow(r).height = 20;
    r++;
  });

  // Totals
  put(ws, r, 1, f.connectedTo.join('\n'), { border: true }); merge(ws, r, 1, r, at('fault'));
  put(ws, r, at('cores'), 'TOTAL CONNECTED LOAD PER PHASE', { border: true }); merge(ws, r, at('cores'), r, at('length'));
  for (const k of ['R', 'Y', 'B', 'tcl', 'mdl', '1-PH', '3-PH', 'CT']) put(ws, r, at(k), s.totals[at(k) - 1], { bold: true, border: true });
  put(ws, r, at('remarks'), 'TOTAL', { bold: true, border: true, align: 'right' });
  box(ws, r, 1, r, n);
  ws.getRow(r).height = 30;
  r++;
  put(ws, r, 1, `DEMAND FACTOR :  ${f.demandFactor.toFixed(2)}`, { bold: true }); merge(ws, r, 1, r, 3);
  put(ws, r, 4, `MAX. DEMAND:  ${f.maxDemandKw.toFixed(2)}  KW`, { bold: true }); merge(ws, r, 4, r, 9);
  put(ws, r, 10, `TOTAL CONNECTED LOAD :  ${f.totalConnectedKw.toFixed(2)}  KW`, { bold: true }); merge(ws, r, 10, r, 15);
  put(ws, r, 16, `TOTAL BUILD UP AREA (Sq. mtr) : ${f.builtUpArea}`); merge(ws, r, 16, r, n);
  ws.getRow(r).height = 26;
  r++;
  put(ws, r, 1, `CONSULTANT/ CONTRACTOR: ${f.contractor}`, { align: 'left' }); merge(ws, r, 1, r, 7);
  put(ws, r, 8, `TEL: ${f.tel}`, { align: 'left' }); merge(ws, r, 8, r, 14);
  put(ws, r, 15, `FAX : ${f.fax}`, { align: 'left' }); merge(ws, r, 15, r, n);
  r++;
  put(ws, r, 1, 'Type of Meter (Rating of incomer) :  (1) Up to 60A (1 Phase)     (2) Up to 125A (3 Phase)     (3) LV CT / HV CT', { align: 'left' });
  merge(ws, r, 1, r, n);
  ws.getRow(r).height = 22;
  frame(ws, 1, 1, r, n);
  ws.pageSetup.printArea = `A1:${ws.getColumn(n).letter}${r}`;
  stamp(ws, project);
  return ws;
}

/** Summary of the TCL at transformer level (landscape): one row per
 * transformer, grouped by substation, then totals, diversity, maximum
 * demand, TCL and TCL (duty). */
export function addTxSheet(wb: ExcelJS.Workbook, project: Project, name = 'TCL SUMMARY'): Ws {
  const s = buildTxSummary(project);
  const h = s.header;
  const ws = wb.addWorksheet(sheetName(wb, name), {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }]
  });
  const n = 19;
  [22, 7, 14, 10, 9, 16, 9, 9, 10, 9, 9, 9, 10, 7, 10, 7, 7, 7, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const u = (v: string) => ({ align: 'left' as const, bold: true, v });
  const head = (r: number, c1: number, c2: number, x: { v: string; align: 'left'; bold: boolean }) => { put(ws, r, c1, x.v, { align: x.align, bold: x.bold }); merge(ws, r, c1, r, c2); };
  head(1, 1, 5, u(`PROJECT :  ${h.project}`));
  put(ws, 1, 6, 'DETAILS OF CONNECTED LOAD, MAX DEMAND & kWh METERING', { bold: true, size: 11, border: true }); merge(ws, 1, 6, 1, 13);
  head(1, 16, n, u(`AREA :  ${h.area}`));
  head(2, 1, 5, u(`PLANNED COMPLETION DATE :  ${h.completion}`));
  head(2, 6, 13, u(`OWNER :  ${h.owner}`));
  head(2, 16, n, u(`PLOT No:  ${h.plotNo}`));
  head(3, 1, 5, u('SUMMARY OF THE TCL AT TRANSFORMER LEVEL'));
  head(3, 6, 13, u(`CONSULTANT :  ${h.consultant}`));
  head(3, 16, n, u(`LOC: ${h.location.toUpperCase()}`));
  [1, 2, 3].forEach((r) => (ws.getRow(r).height = 20));

  const h1 = 5, h2 = 6;
  const single: [number, string][] = [[1, 'TRANSFORMER REFERENCE'], [2, 'SP/TP'], [5, 'FAULT DUTY kA'], [9, 'ECC SIZE 1C, mm2'], [13, 'TCL (kW)'], [14, 'D.F'], [15, 'MDL (kW)'], [19, 'Remarks']];
  for (const [c, t] of single) { put(ws, h1, c, t, { bold: true, border: true }); merge(ws, h1, c, h2, c); }
  const group = (c1: number, c2: number, t: string, subs: string[]) => {
    put(ws, h1, c1, t, { bold: true, border: true }); merge(ws, h1, c1, h1, c2);
    subs.forEach((x, i) => put(ws, h2, c1 + i, x, { bold: true, border: true }));
  };
  group(3, 4, 'RATING - AMPS', ['ACB', 'MCCB']);
  group(6, 8, 'CABLE SIZE', ['PVC/XLPE/SWA/ PVC', '2/4X1C MM2', '2/3/4C MM2']);
  group(10, 12, 'CONNECTION LOAD - kW', ['R-PHASE kW', 'Y-PHASE kW', 'B-PHASE kW']);
  group(16, 18, 'kWH METER', ['1 - 0 (1)', '3 - 0 (2)', 'CT (3)']);
  box(ws, h1, 1, h2, n);
  ws.getRow(h1).height = 22;
  ws.getRow(h2).height = 34;

  let r = h2 + 1;
  const k = (v: number) => Number(v.toFixed(2));
  for (const g of s.groups) {
    put(ws, r, 1, g.name, { bold: true, align: 'left' }); merge(ws, r, 1, r, n); ws.getRow(r).height = 22; r++;
    for (const x of g.rows) {
      const vals: Val[] = [x.board.txRef ?? x.board.id, x.poles, x.device === 'ACB' ? acbText(x) : '', x.device === 'MCCB' ? acbText(x) : '', x.faultKa ?? '', x.cable, '', '', x.ecc,
        k(x.phases.R), k(x.phases.Y), k(x.phases.B), k(x.tclKw), x.df, k(x.mdlKw), x.meters['1-PH'] || '', x.meters['3-PH'] || '', x.meters.CT || '', rowCtText(x)];
      vals.forEach((v, i) => put(ws, r, i + 1, v, { border: true, align: i === 0 ? 'left' : 'center' }));
      merge(ws, r, 6, r, 8);
      ws.getRow(r).height = 22;
      r++;
    }
  }
  put(ws, r, 3, 'TOTAL CONNECTED - LOAD PER PHASE', { bold: true, align: 'left' }); merge(ws, r, 3, r, 9);
  [s.phases.R, s.phases.Y, s.phases.B, s.tclKw].forEach((v, i) => put(ws, r, 10 + i, k(v), { bold: true, border: true }));
  put(ws, r, 15, k(s.mdlKw), { bold: true, border: true });
  put(ws, r, 16, s.meters['1-PH'] || '', { bold: true, border: true });
  put(ws, r, 17, s.meters['3-PH'] || '', { bold: true, border: true });
  put(ws, r, 18, s.meters.CT || '', { bold: true, border: true });
  put(ws, r, 19, s.ctText, { border: true, size: 8 });
  ws.getRow(r).height = 30;
  r++;
  put(ws, r, 3, 'DIVERSITY FACTOR', { bold: true, align: 'left' }); merge(ws, r, 3, r, 5);
  put(ws, r, 6, Number(s.diversity.toFixed(2)), { bold: true, border: true });
  put(ws, r, 7, 'TOTAL', { bold: true, align: 'left' });
  r += 2;
  put(ws, r, 3, 'MAX. DEMAND - 3 PHASE', { bold: true, align: 'left' }); merge(ws, r, 3, r, 5);
  put(ws, r, 6, Number(s.mdlKw.toFixed(1)), { bold: true, border: true });
  put(ws, r, 7, 'kW', { align: 'left' });
  put(ws, r, 9, 'TCL =', { align: 'right' });
  put(ws, r, 10, Number(s.tclKw.toFixed(1)), { bold: true, border: true });
  put(ws, r, 11, 'kW', { align: 'left' });
  r++;
  put(ws, r, 8, 'TCL (DUTY)=', { align: 'right' }); merge(ws, r, 8, r, 9);
  put(ws, r, 10, Number(s.tclDutyKw.toFixed(1)), { bold: true, border: true });
  put(ws, r, 11, 'kW', { align: 'left' });
  frame(ws, 1, 1, r, n);
  ws.pageSetup.printArea = `A1:${ws.getColumn(n).letter}${r}`;
  stamp(ws, project);
  return ws;
}

/** Bus bar riser — details of connected load / max. demand (landscape). */
export function addRiserSheet(wb: ExcelJS.Workbook, project: Project, riserId: string): Ws | undefined {
  const f = buildRiserForm(project, riserId);
  if (!f) return undefined;
  const ws = wb.addWorksheet(sheetName(wb, `${f.ref} RISER`), {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }]
  });
  const n = 19;
  [22, 6, 9, 9, 8, 10, 14, 8, 9, 9, 9, 9, 9, 7, 9, 7, 7, 7, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  put(ws, 1, 1, 'BUS BAR RISER', { bold: true, align: 'left' }); merge(ws, 1, 1, 1, 5);
  put(ws, 2, 1, 'DETAILS OF CONNECTED LOAD / MAX. DEMAND', { bold: true, size: 11 }); merge(ws, 2, 1, 2, n);
  put(ws, 3, 1, `PROJECT :  ${project.name}`, { bold: true, align: 'left' }); merge(ws, 3, 1, 3, 10);
  put(ws, 4, 1, `BUS BAR RISER REF:  ${f.ref}`, { bold: true, align: 'left' }); merge(ws, 4, 1, 4, 10);
  put(ws, 5, 1, `FED FROM  ${f.fedFrom}`, { bold: true, align: 'left' }); merge(ws, 5, 1, 5, 10);
  const h1 = 6, h2 = 7;
  const single: [number, string][] = [[1, 'CIRCUIT FEEDER / SMDB /DB NO.'], [2, 'SP/TP'], [5, 'FAULT DUTY (kA)'], [9, 'ECC SIZE 1C mm2'], [13, 'TCL (kW)'], [14, 'D.F'], [15, 'MD (Kw)'], [19, 'REMARKS']];
  for (const [c, t] of single) { put(ws, h1, c, t, { bold: true, border: true }); merge(ws, h1, c, h2, c); }
  const group = (c1: number, c2: number, t: string, subs: string[]) => {
    put(ws, h1, c1, t, { bold: true, border: true }); merge(ws, h1, c1, h1, c2);
    subs.forEach((x, i) => put(ws, h2, c1 + i, x, { bold: true, border: true }));
  };
  group(3, 4, 'RATING - AMPS', ['ACB', 'MCCB']);
  group(6, 8, 'CABLE SIZE, TYPE & No.OF CORES', ['NO. OF CORES: 1C/2C/4C', 'TYPE: XLPE/PVC/SWA', 'SIZE']);
  group(10, 12, 'CONNECTION LOAD - KW', ['R-PH kW', 'Y-PH kW', 'B-PH kW']);
  group(16, 18, 'PROPOSED TYPE & No OF kWh METER', ['1-PH (1)', '3-PH (2)', 'LV/HV-CT (3)']);
  box(ws, h1, 1, h2, n);
  ws.getRow(h2).height = 40;
  const k = (v: number) => Number(v.toFixed(2));
  let r = h2 + 1;
  const i = f.incomer;
  [i.name, 'TP', i.acb ?? '', '', i.faultKa ?? '', i.busway, '', '', '', k(i.phases.R), k(i.phases.Y), k(i.phases.B), k(i.tcl), '', '', '', '', '', ''].forEach((v, x) => put(ws, r, x + 1, v, { border: true }));
  merge(ws, r, 6, r, 9); r++;
  put(ws, r, 1, 'OUTGOINGS', { border: true }); box(ws, r, 1, r, n); r++;
  const line = (x: RiserFormRow) => [x.name, x.sptp, x.acb ?? '', x.mccb ?? '', x.faultKa ?? '', x.cores ?? '', x.type ?? '', x.size ?? '', x.ecc ?? '', k(x.phases.R), k(x.phases.Y), k(x.phases.B), k(x.tcl), x.df ?? '', k(x.md ?? 0), x.meters['1-PH'], x.meters['3-PH'], x.meters.CT, x.remarks ?? ''];
  for (const x of f.rows) { line(x).forEach((v, c) => put(ws, r, c + 1, v, { border: true, align: c === 0 ? 'left' : 'center' })); r++; }
  put(ws, r, 5, 'TOTAL CONNECTED - LOAD PER PHASE', { bold: true, border: true }); merge(ws, r, 5, r, 9);
  [f.totals.phases.R, f.totals.phases.Y, f.totals.phases.B, f.totals.tcl].forEach((v, c) => put(ws, r, 10 + c, k(v), { bold: true, border: true }));
  put(ws, r, 14, '', { border: true });
  put(ws, r, 15, k(f.totals.md), { bold: true, border: true });
  (['1-PH', '3-PH', 'CT'] as const).forEach((m, c) => put(ws, r, 16 + c, f.totals.meters[m], { bold: true, border: true }));
  r += 2;
  for (const [l, v] of [['TCL (kw)', k(f.totals.tcl)], ['MDL (kw)', k(f.totals.md)], ['DF', Number(f.df.toFixed(2))]] as [string, number][]) {
    put(ws, r, 9, l, { bold: true, border: true }); put(ws, r, 10, v, { bold: true, border: true }); r++;
  }
  frame(ws, 1, 1, r - 1, n);
  ws.pageSetup.printArea = `A1:${ws.getColumn(n).letter}${r - 1}`;
  stamp(ws, project);
  return ws;
}

/** Load distribution schedule of one DB (portrait). Columns that exist only
 * in the app (length, checks) are left off. */
export function addDbSheet(wb: ExcelJS.Workbook, project: Project, boardId: string, name?: string): Ws {
  const s = buildDbSheet(project, boardId);
  const ws = wb.addWorksheet(sheetName(wb, name ?? boardId), {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }]
  });
  const cols = s.sheetCols.filter((c) => !c.appOnly);
  const n = cols.length;
  const at = (k: string) => cols.findIndex((c) => c.key === k) + 1;
  const pointCols = cols.filter((c) => c.key.startsWith('pt:'));
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.key === 'room' ? 26 : c.key === 'remarks' ? 16 : c.key === 'wpu' ? 9 : c.key === 'incomer' || c.key === 'elcb' ? 6 : c.key.startsWith('pt:') ? 5.2 : 6.5;
  });

  // Header block
  const b = s.board;
  put(ws, 1, 1, `PROJECT: ${project.name}`, { align: 'left' }); merge(ws, 1, 1, 1, at('room'));
  put(ws, 1, at('wpu'), `LOCATION OF DB:  ${boardLocation(project, b)}`, { align: 'right' }); merge(ws, 1, at('wpu'), 1, n);
  put(ws, 2, 1, `DB NO : ${b.id}`, { align: 'left' }); merge(ws, 2, 1, 2, at('room') - 1);
  put(ws, 2, at('room'), 'LOAD DISTRIBUTION SCHEDULE', { bold: true, size: 10 }); merge(ws, 2, at('room'), 2, at('wpu') - 1);
  put(ws, 3, 1, `FED FROM : ${b.upstreamId ?? project.boards.find((x) => !x.upstreamId)?.supply?.fedFrom ?? 'DEWA'}`, { align: 'left' }); merge(ws, 3, 1, 3, at('room') - 1);
  put(ws, 3, at('room'), '(3 PHASE)', { size: 8 }); merge(ws, 3, at('room'), 3, at('wpu') - 1);

  // Heading rows
  const h1 = 4, h2 = 5;
  const tall = ['incomer', 'elcb', 'sl', 'ref', 'mcb', 'wire', 'ecc', 'room', 'wpu', 'remarks'];
  const title: Record<string, string> = {
    incomer: 'RATING OF INCOMER', elcb: 'RATING OF ELCB', sl: 'SL NO.', ref: 'CIR NO.', mcb: 'MCB RAT. IN AMPS', wire: 'CCT WIRE SIZE (mm2)',
    ecc: 'ECC WIRE SIZE (mm2)', room: 'ROOM/ AREA', wpu: 'WATTS/ UNIT', remarks: 'REMARKS'
  };
  for (const k of tall) {
    put(ws, h1, at(k), title[k], { border: true, size: 8, rotate: k === 'incomer' || k === 'elcb' });
    merge(ws, h1, at(k), h2, at(k));
  }
  if (pointCols.length) {
    put(ws, h1, at(pointCols[0].key), 'CONNECTED LOAD/ POINTS', { border: true, size: 8 });
    merge(ws, h1, at(pointCols[0].key), h1, at(pointCols[pointCols.length - 1].key));
    for (const c of pointCols) put(ws, h2, at(c.key), c.title, { border: true, size: 7 });
  }
  put(ws, h1, at('R'), 'LOAD/CIRCUIT (WATTS)', { border: true, size: 8 }); merge(ws, h1, at('R'), h1, at('B'));
  for (const p of ['R', 'Y', 'B']) put(ws, h2, at(p), p, { border: true, size: 8 });
  box(ws, h1, 1, h2, n);
  ws.getRow(h1).height = 22;
  ws.getRow(h2).height = 40;

  // Circuit rows (the WATT / UNIT input row is the app's; the form shows watts per unit on each row)
  const first = h2 + 1;
  let r = first;
  const rowOf = new Map<number, number>();
  s.rows.forEach((row, y) => {
    if (row.type === 'watts') return;
    rowOf.set(y, r);
    cols.forEach((c, i) => {
      const x = s.sheetCols.indexOf(c);
      const v = c.key === 'incomer' || c.key === 'elcb' ? null : s.data[y][x];
      put(ws, r, i + 1, v === '' ? null : v, { border: true, size: 8, align: c.key === 'room' || c.key === 'remarks' ? 'left' : 'center', wrap: false });
    });
    ws.getRow(r).height = 15;
    r++;
  });
  const last = r - 1;
  if (last >= first) {
    put(ws, first, at('incomer'), s.incomerText, { border: true, size: 8, rotate: true });
    merge(ws, first, at('incomer'), last, at('incomer'));
    // ELCB sections, as in the grid
    for (const [cell, [, span]] of Object.entries(s.merges)) {
      const colLetter = cell.match(/^[A-Z]+/)![0];
      const y = Number(cell.slice(colLetter.length)) - 1;
      if (s.sheetCols[ws.getColumn(colLetter).number - 1]?.key !== 'elcb') continue;
      const r1 = rowOf.get(y);
      if (r1 === undefined) continue;
      put(ws, r1, at('elcb'), s.data[y][s.sheetCols.findIndex((c) => c.key === 'elcb')], { border: true, size: 7, rotate: true });
      merge(ws, r1, at('elcb'), r1 + span - 1, at('elcb'));
    }
    // Rows of a single-row ELCB section (no merge) still need their label.
    s.rows.forEach((_, y) => {
      const v = s.data[y][s.sheetCols.findIndex((c) => c.key === 'elcb')];
      const r1 = rowOf.get(y);
      if (v && r1 !== undefined && !ws.getCell(r1, at('elcb')).isMerged) put(ws, r1, at('elcb'), v, { border: true, size: 7, rotate: true });
    });
  }

  // TOTAL (kW)
  put(ws, r, 1, null, { border: true }); merge(ws, r, 1, r, at('wpu') - 1);
  put(ws, r, at('wpu'), 'TOTAL (kW)', { bold: true, border: true, size: 8 });
  for (const p of ['R', 'Y', 'B']) put(ws, r, at(p), s.totals[s.sheetCols.findIndex((c) => c.key === p)], { bold: true, border: true, size: 8 });
  put(ws, r, at('remarks'), s.totals[s.sheetCols.findIndex((c) => c.key === 'remarks')], { bold: true, border: true, size: 8 });
  box(ws, r, 1, r, n);
  r++;
  put(ws, r, 1, s.cableText, { align: 'left', size: 8 }); merge(ws, r, 1, r, at('room'));
  const legend = pointCols.map((c) => c.title).join(', ');
  put(ws, r, at('room') + 1, `Columns: ${legend}.  C. FAN = Ceiling fan, EX. FAN = Exhaust fan, W/H = Water heater, SH. S/O = Shaver socket-outlet, S = Split type`, { align: 'left', size: 7 });
  merge(ws, r, at('room') + 1, r, n);
  ws.getRow(r).height = 30;
  frame(ws, 1, 1, r, n);
  ws.pageSetup.printArea = `A1:${ws.getColumn(n).letter}${r}`;
  stamp(ws, project);
  return ws;
}

export interface WorkbookScope {
  /** Boards to include; default: all. */
  boardIds?: string[];
  /** Which forms: default both. */
  forms?: ('tx' | 'riser' | 'md' | 'db')[];
}

/** Every form of the project in submission order: the TCL summary, then the
 * main LV panels, the busbar risers, SMDBs, DBs, the emergency system (EMDB,
 * ESMDB, EDB), MCCs and any other panels — each panel's connected load & MD
 * sheet and / or its DB load schedule, in supply order within each group. */
export function buildFormWorkbook(project: Project, scope: WorkbookScope = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  wb.created = new Date();
  const forms = scope.forms ?? ['tx', 'riser', 'md', 'db'];
  if (forms.includes('tx') && !scope.boardIds && project.boards.some((b) => !b.upstreamId)) addTxSheet(wb, project);
  const groups = scheduleGroups(project);
  const inScope = (b: { id: string }) => !scope.boardIds || scope.boardIds.includes(b.id);
  for (const { key } of SCHEDULE_GROUPS) {
    for (const b of groups[key].filter(inScope)) {
      if (forms.includes('md') && hasMdSheet(project, b.id)) addMdSheet(wb, project, b.id, b.upstreamId ? `${b.id} MD` : `${b.id} LOAD SUMMARY`);
      if (forms.includes('db') && scheduleCircuits(project, b.id).length) addDbSheet(wb, project, b.id, `${b.id} SCHEDULE`);
    }
    // Busbar risers follow the main LV panels.
    if (key === 'mdb' && forms.includes('riser') && !scope.boardIds) for (const r of project.busRisers ?? []) addRiserSheet(wb, project, r.id);
  }
  if (!wb.worksheets.length) wb.addWorksheet('Empty').getCell(1, 1).value = 'No forms to export.';
  return wb;
}

export async function workbookBytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
