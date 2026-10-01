import { currentRevision } from '../model/revisions';
import type { DrawingInfo, Project } from '../types';
import { esc } from './report';
import { templateOf, templateSize, titleBlockHtml } from '../model/titleBlock';
import { fillParams } from '../model/params';
import { abbreviationsIn } from './sldNotes';

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
/** One sheet of a set: number, title, position and its own title block values. */
export interface SheetInfo { no: string; title: string; count: number; index: number; status?: string; rev?: string; date?: string; drawnBy?: string; checkedBy?: string; approvedBy?: string; scale?: string; history?: { id: string; date: string; description: string }[] }

export function buildSldSheetHtml(project: Project, svg: string, sheet: NonNullable<DrawingInfo['sheet']> = 'A3', one?: SheetInfo): string {
  const { w, h } = SHEET_MM[sheet];
  const t = titleBlockOf(project);
  if (one) {
    t.number = one.no; t.title = one.title;
    if (one.rev) t.revision = one.rev;
    if (one.date) t.date = one.date;
    if (one.drawnBy) t.drawnBy = one.drawnBy;
    if (one.checkedBy) t.checkedBy = one.checkedBy;
    if (one.approvedBy) t.approvedBy = one.approvedBy;
    if (one.scale) t.scale = one.scale;
    if (one.history?.length) t.history = one.history.slice(-4).reverse();
  }
  const status = one?.status ?? '';
  const extra: Record<string, string> = one
    ? { SheetNo: one.no, SheetTitle: one.title, SheetCount: String(one.count), SheetIndex: String(one.index), SheetSize: sheet, DrawingNo: one.no, DrawingTitle: one.title, Status: status, Scale: t.scale,
      ...(one.rev ? { Rev: one.rev } : {}), ...(one.date ? { RevDate: one.date } : {}), ...(one.drawnBy ? { DrawnBy: one.drawnBy } : {}), ...(one.checkedBy ? { CheckedBy: one.checkedBy } : {}), ...(one.approvedBy ? { ApprovedBy: one.approvedBy } : {}) }
    : { SheetNo: t.number, SheetTitle: t.title, SheetCount: '1', SheetIndex: '1', SheetSize: sheet, Status: '', Scale: t.scale };
  const custom = templateOf(project);
  const notes = project.drawing?.notes ?? [];
  const abbr = project.drawing?.abbreviations === false ? [] : abbreviationsIn(svg);
  const history = t.history.length
    ? t.history.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.description)}</td></tr>`).join('')
    : '<tr><td>—</td><td></td><td>Not issued</td></tr>';
  // Sheet furniture (title block, revision table, abbreviations, notes)
  // is sized to match the SLD text as printed on this paper.
  const k = furnitureScale(sheet, svg, custom ? templateSize(custom) : undefined);
  const mm = (v: number) => `${+(v * k).toFixed(2)}mm`;
  const px = (v: number) => `${+(v * k).toFixed(2)}px`;
  const tbW = custom ? templateSize(custom).w : 180;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.number || t.title)}</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${w}mm; height: ${h}mm; font: ${px(9)} Arial, sans-serif; color: #000; background: #fff; }
    .frame { position: absolute; inset: 10mm 10mm 10mm 20mm; border: 0.7mm solid #000; }
    .drawing { position: absolute; inset: 3mm 3mm 3mm 3mm; bottom: ${mm(44)}; display: flex; align-items: center; justify-content: center; }
    .drawing svg { width: 100%; height: 100%; }
    .tb { position: absolute; right: 0; bottom: 0; width: ${mm(180)}; border-top: ${mm(0.5)} solid #000; border-left: ${mm(0.5)} solid #000; border-collapse: collapse; }
    .tb td { border: ${mm(0.25)} solid #000; padding: ${mm(1)} ${mm(1.5)}; vertical-align: top; }
    .tb .k { display: block; font-size: ${px(6.5)}; color: #333; text-transform: uppercase; letter-spacing: .03em; }
    .tb .v { font-size: ${px(9.5)}; font-weight: 600; }
    .tb .title .v { font-size: ${px(13)}; }
    .tb .logo { float: right; max-height: ${mm(11)}; max-width: ${mm(45)}; margin-left: ${mm(2)}; }
    .revs { position: absolute; left: 0; bottom: 0; width: calc(100% - ${mm(tbW)}); height: ${mm(41)}; border-top: ${mm(0.5)} solid #000; font-size: ${px(8)}; }
    .revs table { width: 100%; border-collapse: collapse; }
    .revs th, .revs td { border-bottom: ${mm(0.2)} solid #999; padding: ${mm(0.8)} ${mm(1.5)}; text-align: left; }
    .revs th { font-size: ${px(7)}; text-transform: uppercase; }
    .tbx { position: absolute; right: 0; bottom: 0; }
    .notes { position: absolute; right: 0; font-size: ${px(8)}; border: ${mm(0.25)} solid #000; padding: ${mm(1)} ${mm(2)}; background: #fff; }
    .notes ol { margin: ${mm(0.5)} 0 0; padding-left: ${mm(4)}; }
    .abbr { position: absolute; left: 0; bottom: ${mm(44)}; font-size: ${px(7)}; border: ${mm(0.25)} solid #000; border-left: 0; padding: ${mm(1)} ${mm(2)}; background: #fff; column-count: ${abbr.length > 12 ? 2 : 1}; column-gap: ${mm(4)}; }
    .abbr b { display: block; column-span: all; font-size: ${px(8)}; margin-bottom: ${mm(0.5)}; }
    .abbr div { break-inside: avoid; white-space: nowrap; } .abbr span { display: inline-block; min-width: ${mm(9)}; font-weight: 600; }
    .gen { position: absolute; left: ${mm(1.5)}; bottom: ${mm(1)}; font-size: ${px(6.5)}; color: #555; }
  </style></head><body>
  <div class="frame">
    <div class="drawing">${svg}</div>
    <div class="revs">
      <table><thead><tr><th style="width:10%">Rev</th><th style="width:18%">Date</th><th>Description</th></tr></thead><tbody>${history}</tbody></table>
      <div class="gen">Generated by LV Design Studio</div>
    </div>
    ${custom ? `<div class="tbx" style="transform:scale(${k});transform-origin:100% 100%">${titleBlockHtml(custom, project, extra)}</div>` : `    <table class="tb">
      <tr><td colspan="3"><span class="k">Company / consultant</span>${t.logo ? `<img class="logo" src="${esc(t.logo)}" alt="">` : ''}<span class="v">${esc(t.company)}</span></td></tr>
      <tr><td colspan="2"><span class="k">Project</span><span class="v">${esc(t.project)}</span></td><td><span class="k">Owner</span><span class="v">${esc(t.owner)}</span></td></tr>
      <tr><td colspan="3" class="title"><span class="k">Drawing title${status ? ` — <b>${esc(status)}</b>` : ''}</span><span class="v">${esc(t.title)}</span></td></tr>
      <tr><td><span class="k">Drawing no.</span><span class="v">${esc(t.number)}</span></td><td><span class="k">Revision</span><span class="v">${esc(t.revision)}</span></td><td><span class="k">Date</span><span class="v">${esc(t.date)}</span></td></tr>
      <tr><td><span class="k">Drawn</span><span class="v">${esc(t.drawnBy)}</span></td><td><span class="k">Checked</span><span class="v">${esc(t.checkedBy)}</span></td><td><span class="k">Approved</span><span class="v">${esc(t.approvedBy)}</span></td></tr>
      <tr><td colspan="2"><span class="k">Sheet</span><span class="v">${one ? `${one.index} of ${one.count} · ` : ''}${sheet} · Scale ${esc(t.scale)}</span></td><td><span class="k">System</span><span class="v">${project.voltageV} V, 3Ph + N, ${project.frequencyHz} Hz</span></td></tr>
    </table>`}
    ${abbr.length ? `<div class="abbr"><b>ABBREVIATIONS</b>${abbr.map(([a, d]) => `<div><span>${esc(a)}</span>${esc(d)}</div>`).join('')}</div>` : ''}
    ${notes.length ? `<div class="notes" style="bottom:${mm((custom ? templateSize(custom).h : 44) + 3)};width:${mm(tbW)}"><b>NOTES</b><ol>${notes.map((n) => `<li>${esc(fillParams(n, project))}</li>`).join('')}</ol></div>` : ''}
  </div>
  </body></html>`;
}

/** Text height of the SLD as printed: diagram text is ≈ 10 px; the title
 * block's main text is 9.5 CSS px (≈ 2.5 mm) at scale 1. */
const DIAGRAM_TEXT_PX = 10;
const TB_TEXT_MM = 9.5 * 0.2646;
const FRAME_W = 30, FRAME_H = 20, BAND = 44;

/** One scale for everything around the drawing, so the title block,
 * revision table, abbreviations and notes read at the same size as the SLD
 * text on any paper: big on A1 when the drawing is blown up, smaller on A4.
 * Kept within limits so the title block never takes more than ≈ 60 % of
 * the sheet width (A4) and never shrinks below readable. */
export function furnitureScale(sheet: NonNullable<DrawingInfo['sheet']>, svg: string, tb?: { w: number; h: number }): number {
  const { w, h } = SHEET_MM[sheet];
  const tbW = tb?.w ?? 180, tbH = tb?.h ?? BAND;
  const kMax = Math.min(2.6, ((w - FRAME_W) * 0.6) / tbW, ((h - FRAME_H) * 0.3) / tbH);
  const kMin = Math.min(0.62, kMax);
  const vb = svg.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/);
  if (!vb) return Math.max(kMin, Math.min(kMax, w / 420)); // no size: by paper (A3 = 1)
  const vw = Number(vb[1]), vh = Number(vb[2]);
  let k = 1;
  for (let i = 0; i < 3; i++) { // the band height depends on k, the drawing scale on the band
    const s = Math.min((w - FRAME_W - 6) / vw, (h - FRAME_H - 6 - BAND * k) / vh);
    k = Math.max(kMin, Math.min(kMax, (DIAGRAM_TEXT_PX * s) / TB_TEXT_MM));
  }
  return +k.toFixed(3);
}
