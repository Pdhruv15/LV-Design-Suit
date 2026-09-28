import ExcelJS from 'exceljs';
import { routeSettings, SPACING_LABEL, trayQuantities, type TrayResult, odsSource } from '../calc/cableTray';
import { revisionStamp } from '../model/revisions';
import type { Project, TrayPlan } from '../types';
import { lineNumbers } from './traySection';

/** Cable tray schedule workbook: one sheet with every route and its
 * cables (from → to), and a summary sheet with the tray sizes and the
 * tray quantities. */

const FONT = 'Arial';
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const GREY = 'FFE9EDF3';
const r1 = (v: number) => Math.round(v * 10) / 10;

function row(ws: ExcelJS.Worksheet, values: (string | number | null)[], o: { bold?: boolean; fill?: string; border?: boolean } = {}) {
  const r = ws.addRow(values);
  r.eachCell({ includeEmpty: true }, (c, i) => {
    if (i > values.length) return;
    c.style = {
      font: { name: FONT, size: 9, bold: !!o.bold },
      alignment: { vertical: 'middle', horizontal: typeof c.value === 'number' ? 'center' : 'left', wrapText: true },
      ...(o.border === false ? {} : { border: { ...BORDER } }),
      ...(o.fill ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } } } : {})
    };
  });
  return r;
}

function title(ws: ExcelJS.Worksheet, project: Project, text: string, cols: number) {
  const t = ws.addRow([`${project.name} — ${text}`]);
  t.getCell(1).font = { name: FONT, size: 12, bold: true };
  ws.mergeCells(t.number, 1, t.number, cols);
  ws.headerFooter = {
    oddHeader: `&R&"Arial"&9${revisionStamp(project)}`,
    oddFooter: `&L&"Arial"&8${project.name.replace(/&/g, '&&')}&R&"Arial"&8Page &P of &N`
  };
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

const trayText = (r: TrayResult) => `${r.tiers > 1 ? `${r.tiers} × ` : ''}${r.widthMm} × ${r.depthMm}`;

export function buildTrayWorkbook(project: Project, plan: TrayPlan, results: TrayResult[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const s = { ...plan.settings };

  // Schedule: each route, its cables, its tray.
  const ws = wb.addWorksheet('Tray schedule');
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 24 }, { width: 26 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }];
  title(ws, project, `Cable tray schedule (${s.trayType})`, 9);
  for (const r of results) {
    const e = routeSettings(plan, r.route);
    ws.addRow([]);
    const h = row(ws, [`ROUTE ${r.route.name}`, `From: ${r.route.from ?? '—'}`, `To: ${r.route.to ?? '—'}`, `Length: ${r.route.lengthM ?? '—'} m`, '', '', '', '', ''], { bold: true, fill: GREY });
    ws.mergeCells(h.number, 4, h.number, 9);
    row(ws, ['No.', 'From (panel)', 'To', 'Cable', 'Path', 'No. of cables', 'OD (mm)', 'kg/m', 'Σ D (mm)'], { bold: true, fill: GREY });
    const nums = lineNumbers(r.lines);
    for (const l of r.lines) {
      row(ws, [nums.get(l.id) ?? '', l.from, l.to, `${l.description}${l.feederId && !l.ecc ? ` (${l.feederId})` : ''}${l.missing ? ` — ${l.missing}` : ''}`, l.ecc ? '' : l.path ?? `${r.route.name} only`, l.qty, r1(l.odMm), r1(l.kgPerM), r1(l.qty * l.odMm)]);
    }
    const basis = e.method === 'spacing'
      ? `Single layer, spacing ${SPACING_LABEL[e.spacing]}${e.spacing === 'mm' ? ` ${e.spacingMm} mm` : ''}: Σ D ${r1(r.sumOdMm)} + spacing ${r1(r.clearanceMm)} = ${r1(r.occupiedMm)} mm`
      : `Fill ${e.fillPct} % of ${e.depthMm} mm depth: cable area ${Math.round(r.cableAreaMm2)} mm² → ${r1(r.occupiedMm)} mm`;
    const b = row(ws, ['', `${basis}; + ${e.sparePct} % spare → required ${r1(r.requiredMm)} mm`, '', '', '', '', '', '', ''], { border: false });
    ws.mergeCells(b.number, 2, b.number, 9);
    const t = row(ws, ['', `SELECTED TRAY: ${trayText(r)} mm${r.manual ? ' (chosen)' : ''} — spare ${Math.round(r.sparePctActual)} %, cable weight ${r1(r.kgPerM)} kg/m, grouping factor ${r.groupFactor.toFixed(2)}, bend radius ≥ ${r.bendMm} mm${r.notes.length ? ` — ${r.notes.join('; ')}` : ''}`, '', '', '', '', '', '', ''], { bold: true, border: false });
    ws.mergeCells(t.number, 2, t.number, 9);
  }

  // Summary and quantities.
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 8 }, { width: 20 }, { width: 20 }, { width: 22 }, { width: 8 }, { width: 12 }, { width: 16 }, { width: 9 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }];
  title(sum, project, 'Cable tray summary', 12);
  sum.addRow([]);
  row(sum, ['Route', 'From', 'To', 'Panels (cables from)', 'Cables', 'Required width (mm)', 'Tray W × D (mm)', 'Spare %', 'Grouping', 'Weight (kg/m)', 'Length (m)', 'Status'], { bold: true, fill: GREY });
  for (const r of results) {
    row(sum, [r.route.name, r.route.from ?? '', r.route.to ?? '', r.panels.join(', '), r.cableCount, Math.round(r.requiredMm), r.cableCount ? trayText(r) : '—', Math.round(r.sparePctActual), Math.round(r.groupFactor * 100) / 100, r1(r.kgPerM), r.route.lengthM ?? null, r.status === 'ok' ? 'OK' : r.status === 'warn' ? 'Check' : 'Too small']);
  }
  sum.addRow([]);
  row(sum, ['', `Tray BOQ — ${s.trayType}`], { bold: true, border: false });
  row(sum, ['', 'Size W × D (mm)', 'Tray (m, all tiers)', 'Bends', 'Tees', 'Reducers', 'Risers', 'Supports', 'Coupler sets', ...(s.covers ? ['Cover (m)'] : []), 'Bend radius ≥ (mm)', 'Routes'], { bold: true, fill: GREY });
  for (const q of trayQuantities(results, s)) row(sum, ['', q.size, Math.round(q.lengthM), q.bends, q.tees, q.reducers, q.risers, q.supports, q.couplers, ...(s.covers ? [Math.round(q.coverM)] : []), q.bendRadiusMm || '—', q.routes.join(', ')]);
  sum.addRow([]);
  const note = sum.addRow(['', `Basis: default spare ${s.sparePct} %, ${s.method === 'spacing' ? `single layer, spacing ${SPACING_LABEL[s.spacing]}` : `fill ${s.fillPct} %`}, depth ${s.depthMm} mm, max width ${s.maxWidthMm} mm${s.includeEcc ? ', separate 1C ECC with each feeder' : ''}. Cable diameters: ${odsSource(plan)}.`]);
  note.getCell(2).font = { name: FONT, size: 8, italic: true };
  sum.mergeCells(note.number, 2, note.number, 12);
  return wb;
}
