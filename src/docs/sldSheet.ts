import { currentRevision } from '../model/revisions';
import type { DrawingInfo, Project } from '../types';
import { esc } from './report';
import { templateOf, templateSize, titleBlockHtml } from '../model/titleBlock';
import { fillParams } from '../model/params';

/** The SLD as a drawing sheet: frame, the diagram scaled to fit, and a
 * title block (company, project, owner, consultant, title, drawing no.,
 * revision, date, scale, drawn / checked / approved, revision history). */

export const SHEET_MM: Record<NonNullable<DrawingInfo['sheet']>, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 }
};

export const DEFAULT_DRAWING_TITLE = 'SINGLE LINE DIAGRAM';

export interface TitleBlock {
  company: string;
  project: string;
  owner: string;
  consultant: string;
  title: string;
  number: string;
  revision: string;
  date: string;
  scale: string;
  drawnBy: string;
  checkedBy: string;
  approvedBy: string;
  logo?: string; // data: URL
  history: { id: string; date: string; description: string }[];
}

export function titleBlockOf(project: Project, date = new Date().toISOString().slice(0, 10)): TitleBlock {
  const d = project.drawing ?? {};
  const rev = currentRevision(project);
  return {
    company: d.company ?? project.info?.consultant ?? '',
    project: project.name,
    owner: project.info?.owner ?? '',
    consultant: project.info?.consultant ?? '',
    title: d.title || DEFAULT_DRAWING_TITLE,
    number: d.number ?? '',
    revision: rev?.id ?? '—',
    date: rev?.date ?? date,
    scale: 'NTS',
    drawnBy: d.drawnBy ?? '',
    checkedBy: d.checkedBy ?? '',
    approvedBy: d.approvedBy ?? '',
    logo: d.logo?.startsWith('data:image/') ? d.logo : undefined,
    history: (project.revisions ?? []).slice(-4).reverse().map((r) => ({ id: r.id, date: r.date, description: r.description }))
  };
}

/** Print-ready HTML for one sheet (the PDF export renders it). svg is the
 * diagram as standalone SVG markup. */
export function buildSldSheetHtml(project: Project, svg: string, sheet: NonNullable<DrawingInfo['sheet']> = 'A3', one?: { no: string; title: string; count: number; index: number }): string {
  const { w, h } = SHEET_MM[sheet];
  const t = titleBlockOf(project);
  if (one) { t.number = one.no; t.title = one.title; }
  const extra: Record<string, string> = one ? { SheetNo: one.no, SheetTitle: one.title, SheetCount: String(one.count), SheetIndex: String(one.index), SheetSize: sheet, DrawingNo: one.no, DrawingTitle: one.title } : { SheetNo: t.number, SheetTitle: t.title, SheetCount: '1', SheetIndex: '1', SheetSize: sheet };
  const custom = templateOf(project);
  const notes = project.drawing?.notes ?? [];
  const history = t.history.length
    ? t.history.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.description)}</td></tr>`).join('')
    : '<tr><td>—</td><td></td><td>Not issued</td></tr>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.number || t.title)}</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${w}mm; height: ${h}mm; font: 9px Arial, sans-serif; color: #000; background: #fff; }
    .frame { position: absolute; inset: 10mm 10mm 10mm 20mm; border: 0.7mm solid #000; }
    .drawing { position: absolute; inset: 3mm 3mm 3mm 3mm; bottom: 44mm; display: flex; align-items: center; justify-content: center; }
    .drawing svg { width: 100%; height: 100%; }
    .tb { position: absolute; right: 0; bottom: 0; width: 180mm; border-top: 0.5mm solid #000; border-left: 0.5mm solid #000; border-collapse: collapse; }
    .tb td { border: 0.25mm solid #000; padding: 1mm 1.5mm; vertical-align: top; }
    .tb .k { display: block; font-size: 6.5px; color: #333; text-transform: uppercase; letter-spacing: .03em; }
    .tb .v { font-size: 9.5px; font-weight: 600; }
    .tb .title .v { font-size: 13px; }
    .tb .logo { float: right; max-height: 11mm; max-width: 45mm; margin-left: 2mm; }
    .revs { position: absolute; left: 0; bottom: 0; width: calc(100% - 180mm); height: 41mm; border-top: 0.5mm solid #000; font-size: 8px; }
    .revs table { width: 100%; border-collapse: collapse; }
    .revs th, .revs td { border-bottom: 0.2mm solid #999; padding: 0.8mm 1.5mm; text-align: left; }
    .revs th { font-size: 7px; text-transform: uppercase; }
    .tbx { position: absolute; right: 0; bottom: 0; }
    .notes { position: absolute; right: 0; font-size: 8px; border: 0.25mm solid #000; padding: 1mm 2mm; background: #fff; }
    .notes ol { margin: 0.5mm 0 0; padding-left: 4mm; }
    .gen { position: absolute; left: 1.5mm; bottom: 1mm; font-size: 6.5px; color: #555; }
  </style></head><body>
  <div class="frame">
    <div class="drawing">${svg}</div>
    <div class="revs">
      <table><thead><tr><th style="width:10%">Rev</th><th style="width:18%">Date</th><th>Description</th></tr></thead><tbody>${history}</tbody></table>
      <div class="gen">Generated by LV Design Studio</div>
    </div>
    ${custom ? `<div class="tbx">${titleBlockHtml(custom, project, extra)}</div>` : `    <table class="tb">
      <tr><td colspan="3"><span class="k">Company / consultant</span>${t.logo ? `<img class="logo" src="${esc(t.logo)}" alt="">` : ''}<span class="v">${esc(t.company)}</span></td></tr>
      <tr><td colspan="2"><span class="k">Project</span><span class="v">${esc(t.project)}</span></td><td><span class="k">Owner</span><span class="v">${esc(t.owner)}</span></td></tr>
      <tr><td colspan="3" class="title"><span class="k">Drawing title</span><span class="v">${esc(t.title)}</span></td></tr>
      <tr><td><span class="k">Drawing no.</span><span class="v">${esc(t.number)}</span></td><td><span class="k">Revision</span><span class="v">${esc(t.revision)}</span></td><td><span class="k">Date</span><span class="v">${esc(t.date)}</span></td></tr>
      <tr><td><span class="k">Drawn</span><span class="v">${esc(t.drawnBy)}</span></td><td><span class="k">Checked</span><span class="v">${esc(t.checkedBy)}</span></td><td><span class="k">Approved</span><span class="v">${esc(t.approvedBy)}</span></td></tr>
      <tr><td colspan="2"><span class="k">Sheet</span><span class="v">${sheet} · Scale ${t.scale}</span></td><td><span class="k">System</span><span class="v">${project.voltageV} V, 3Ph + N, ${project.frequencyHz} Hz</span></td></tr>
    </table>`}
    ${notes.length ? `<div class="notes" style="bottom:${(custom ? templateSize(custom).h : 44) + 3}mm;width:${custom ? templateSize(custom).w : 180}mm"><b>NOTES</b><ol>${notes.map((n) => `<li>${esc(fillParams(n, project))}</li>`).join('')}</ol></div>` : ''}
  </div>
  </body></html>`;
}
