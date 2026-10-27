import ExcelJS from 'exceljs';
import type { ReportStatus } from '../calc/statusText';
import { currentRevision } from '../model/revisions';
import type { Project } from '../types';
import type { ReportMeta } from './reportFrame';
import { scopeText, studyInfo, type Scope, type Section } from './studyReport';

// Kept apart from studyReport.ts so ExcelJS loads only when a workbook is exported, not at start-up.
/** The report's tables as an Excel workbook: a cover sheet and one sheet per study. */
export function buildStudyWorkbook(project: Project, scope: Scope, sections: Section[], meta: ReportMeta): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const FILL: Record<ReportStatus, string> = { ok: 'FF13803D', warn: 'FFA86500', bad: 'FFC21F32', nc: 'FF5B6B82', data: 'FFA86500' };
  const cover = wb.addWorksheet('Cover');
  cover.columns = [{ width: 22 }, { width: 90 }];
  cover.addRow([meta.title]).font = { bold: true, size: 14 };
  cover.addRow([]);
  for (const [k, v] of [['Project', project.name], ['Scope', scopeText(project, scope)], ['Studies', sections.map((s) => s.title).join('; ')], ['Document no.', meta.docNo ?? ''], ['Revision', currentRevision(project)?.id ?? '—'], ['Prepared by', meta.preparedBy ?? ''], ['Checked by', meta.checkedBy ?? '']]) {
    const r = cover.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  for (const s of sections) {
    const name = studyInfo(s.key).label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(name);
    ws.addRow([s.title]).font = { bold: true, size: 13 };
    ws.addRow([`Scope: ${scopeText(project, scope)}`]);
    for (const k of s.summary) ws.addRow([k.label, k.value]);
    for (const t of s.tables) {
      ws.addRow([]);
      if (t.title) ws.addRow([t.title]).font = { bold: true };
      const h = ws.addRow(t.headers);
      h.font = { bold: true };
      h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } }; });
      for (const r of t.rows) {
        const row = ws.addRow(r.map((c) => (typeof c === 'object' ? c.v : c)));
        r.forEach((c, i) => { if (typeof c === 'object') row.getCell(i + 1).font = { color: { argb: FILL[c.s] }, bold: c.s === 'bad' }; });
      }
    }
    ws.columns.forEach((c) => { c.width = 16; });
    ws.getColumn(1).width = 24;
  }
  return wb;
}
