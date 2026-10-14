import type { Status } from '../calc/electrical';
import type { Project } from '../types';
import { currentRevision } from '../model/revisions';
import { PRINT, PRINT_BASE_CSS, STATUS_CSS } from './printStyles';

/** Shared pieces of the plain print documents: escaping, status tallies, the black-and-white
 * additions and the page-1 document block. The calculation report itself is in calcReport.ts. */

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const tally = (statuses: Status[]) => {
  const n = (s: Status) => statuses.filter((x) => x === s).length;
  return { ok: n('ok'), warn: n('warn'), bad: n('bad') };
};

/** Black-and-white additions to the plain print document (calculation and voltage drop
 * reports): status in words (fails bold), tables that repeat their header on each page,
 * and the page-1 document block. */
export const PLAIN_CSS = `<style>
html, body { background: #fff; color-scheme: light; }
@media screen { body { padding: 21mm 14mm 16mm 16mm; } } /* on-screen preview: the printed page's margins */
table.grid { margin: 1mm 0 3mm; font-size: ${PRINT.table}; } table.grid thead { display: table-header-group; } table.grid tr { break-inside: avoid; }
table.grid tr.total td { font-weight: 700; background: #f2f2f2; } h2 { margin: 5mm 0 2mm; break-after: avoid; }
.m, .note { color: #444; }${STATUS_CSS}
.head { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; margin-bottom: 2mm; }
.head h1 { font-size: 18pt; margin: 0.5mm 0 1mm; } table.doc { width: 95mm; margin: 0; font-size: 8pt; } table.doc th { width: 20mm; }
.sum { display: grid; grid-template-columns: 70mm 1fr; gap: 4mm; align-items: start; } .sum .box { margin: 1mm 0 3mm; }
.sum .box table td { padding: 0.6mm 2mm 0.6mm 0; vertical-align: top; }
</style>`;

/** How many failing / warning items page 1 lists before pointing to the tables. */
export const ATTENTION_MAX = 10;

/** Page-1 heading of a plain report: title and project on the left, the document block on
 * the right (doc no., rev from the current revision, date, prepared / checked / approved
 * from Parameters). Blank cells are left for signing by hand. */
export function reportHead(project: Project, title: string, docNo?: string, extra = ''): string {
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const rev = currentRevision(project);
  const prm = project.params ?? {};
  const cell = (v?: string, span = 1) => `<td${span > 1 ? ` colspan="${span}"` : ''}${v?.trim() ? '' : ' class="sig"'}>${esc(v?.trim() ?? '')}</td>`;
  const place = [project.info?.plotNo && `Plot ${project.info.plotNo}`, project.info?.area].filter(Boolean).join(', ');
  return `<div class="head"><div><div class="k">LV electrical</div><h1>${esc(title)}</h1><p>${esc(project.name)}${place ? ` · ${esc(place)}` : ''}${extra ? ` · ${esc(extra)}` : ''}</p></div>
<table class="grid doc">
    <tr><th>Doc no.</th>${cell(docNo)}<th>Rev</th>${cell(rev?.id)}</tr>
    <tr><th>Date</th>${cell(date, 3)}</tr>
    <tr><th>Prepared</th>${cell(prm.designedBy)}<th>Checked</th>${cell(prm.checkedBy)}</tr>
    <tr><th>Approved</th>${cell(prm.approvedBy, 3)}</tr></table></div>`;
}

/** Print styles shared by the PDF reports (A4 landscape): the shared black-and-white print tokens. */
export const REPORT_CSS = `
    @page { size: A4 landscape; margin: 14mm 12mm; }
    ${PRINT_BASE_CSS}`;
