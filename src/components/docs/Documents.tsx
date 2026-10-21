import { ask } from '../ConfirmDialog';
import { useMemo, useState } from 'react';
import { statusOfText } from '../../calc/statusText';
import type { Project } from '../../types';
import { cableSchedule, dbSchedule, equipmentSchedule, type Schedule } from '../../docs/schedules';
import { buildReportHtml, calcReportData } from '../../docs/calcReport';
import { issueCounts, validateReport } from '../../docs/reportValidation';
import { scheduleHtml } from '../../docs/sheetPdf';
import { saveCsv, savePdf, safeFileName } from '../../util/files';
import { FocusChip, Page } from '../ui';
import { subtree } from '../../calc/pfc';

function ScheduleTable({ schedule }: { schedule: Schedule }) {
  const cls = (v: string | number) => statusOfText(v);
  return (
    <div className="table-scroll">
      <table className="schedule">
        <thead>
          <tr>{schedule.headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {schedule.rows.map((r, i) => (
            <tr key={i} className={schedule.totalRows?.includes(i) ? 'total' : ''}>
              {r.map((c, j) => <td key={j} className={cls(c)}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Status = (msg: string) => void;

function ExportCsvButton({ name, schedule, onStatus, project }: { name: string; schedule: Schedule; onStatus: Status; project?: Project }) {
  return (
    <>
      <button className="chip" onClick={async () => { const m = await saveCsv(name, schedule.headers, schedule.rows); if (m) onStatus(m); }}>
        Export CSV (Excel)
      </button>
      {project && <button className="chip" onClick={async () => { const m = await savePdf(`${safeFileName(name)}.pdf`, scheduleHtml(project, schedule, name), { pageSize: 'A4', landscape: true, cssPages: true }); if (m) onStatus(m); }}>
        Export PDF
      </button>}
    </>
  );
}

export function DbScheduleView({ project, onStatus, board, onBoard }: { project: Project; onStatus: Status; /** Picked in the panel tree ('' = all). */ board?: string; onBoard?: (id: string) => void }) {
  const [own, setOwn] = useState('');
  const boardId = board ?? own;
  const setBoardId = onBoard ?? setOwn;
  const schedule = useMemo(() => dbSchedule(project, boardId ? [boardId] : undefined), [project, boardId]);
  return (
    <Page
      title="DB schedule"
      intro="Panel schedule per board: circuits, loads, protective devices, cables and a total for each board."
      actions={
        <>
          <select className="chip" value={boardId} onChange={(e) => setBoardId(e.target.value)} aria-label="Board">
            <option value="">All boards</option>
            {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
          <ExportCsvButton project={project} name={`${project.name} DB schedule${boardId ? ` ${boardId}` : ''}`} schedule={schedule} onStatus={onStatus} />
        </>
      }
    >
      <ScheduleTable schedule={schedule} />
    </Page>
  );
}

export function CableScheduleView({ project, onStatus, focus, onClearFocus }: { project: Project; onStatus: Status; focus?: string | null; onClearFocus?: () => void }) {
  const schedule = useMemo(() => {
    const s = cableSchedule(project);
    if (!focus) return s;
    const ids = subtree(project, focus);
    return { ...s, rows: s.rows.filter((r) => ids.has(String(r[1]))) };
  }, [project, focus]);
  return (
    <Page title="Cable schedule" actions={<><FocusChip id={focus} onClear={onClearFocus} /><ExportCsvButton project={project} name={`${project.name} cable schedule${focus ? ` ${focus}` : ''}`} schedule={schedule} onStatus={onStatus} /></>}>
      <ScheduleTable schedule={schedule} />
    </Page>
  );
}

export function EquipmentScheduleView({ project, onStatus }: { project: Project; onStatus: Status }) {
  const schedule = useMemo(() => equipmentSchedule(project), [project]);
  return (
    <Page
      title="Equipment schedule"
      intro="Transformers and boards. Edit board equipment data in the board's properties panel (select the board in the diagram)."
      actions={<ExportCsvButton project={project} name={`${project.name} equipment schedule`} schedule={schedule} onStatus={onStatus} />}
    >
      <ScheduleTable schedule={schedule} />
    </Page>
  );
}

export function ReportView({ project, onStatus, stale = false, docNo, onDocNo }: { project: Project; onStatus: Status; stale?: boolean; onRun?: () => void;
  /** The live document number (the report itself may show the last calculated project). */ docNo?: string; onDocNo?: (v: string) => void }) {
  const html = useMemo(() => buildReportHtml({ ...project, calcReportDocNo: docNo }), [project, docNo]);
  const [busy, setBusy] = useState(false);
  // The same pre-export check as the study reports. Its document-data warnings are left out:
  // this report has no cover, and blank prepared / checked / approved are left for signing.
  const issues = useMemo(() => {
    const { data, scope, sections } = calcReportData(project);
    const prm = project.params ?? {};
    return validateReport({ project, meta: { title: 'Calculation report', docNo, preparedBy: prm.designedBy, checkedBy: prm.checkedBy, approvedBy: prm.approvedBy }, scope, sections, data, stale: [], designBasis: false, resultsSummary: false })
      .filter((x) => x.area !== 'Project data');
  }, [project, docNo]);
  const ic = issueCounts(issues);
  async function exportPdf() {
    if (ic.error && !(await ask(`The pre-export check found ${ic.error} error(s) and ${ic.warning} warning(s) — listed above the preview.\n\nExport anyway?`))) return;
    setBusy(true);
    try {
      // Landscape and the document's own header / page numbers (CSS @page boxes), as the BOQ.
      const m = await savePdf(`${safeFileName(project.name)}-calculation-report.pdf`, html, { pageSize: 'A4', landscape: true, cssPages: true, selfNumbered: true });
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Calculation report"
      intro="Results summary and design basis, then load assessment, transformer and generator sizing, cable and breaker sizing, load flow and voltage drop, short circuit, earth fault loop, discrimination, power factor correction, DB and cable schedules, and assumptions — the same sections and figures as the study reports, A4 landscape, black and white. Prepared / checked / approved come from Parameters; blank ones are left for signing."
      actions={<>{onDocNo && <input className="chip" value={docNo ?? ''} placeholder="Doc no." aria-label="Document number" onChange={(e) => onDocNo(e.target.value)} />}<button className="chip primary" disabled={busy || stale} title={stale ? 'Run the calculations first (F5)' : undefined} onClick={exportPdf}>{busy ? 'Exporting…' : 'Export PDF'}</button></>}
    >
      <details className="card" open={ic.error > 0}>
        <summary>Pre-export check — {issues.length ? `${ic.error} error(s), ${ic.warning} warning(s), ${ic.info} note(s)` : 'no issues found'}</summary>
        {issues.length > 0 && <table className="schedule"><thead><tr><th>Level</th><th>Area</th><th>Issue</th></tr></thead><tbody>
          {issues.map((x, i) => <tr key={i}><td className={x.level === 'error' ? 'bad' : x.level === 'warning' ? 'warn' : 'm'}>{x.level.toUpperCase()}</td><td>{x.area}</td><td>{x.message}</td></tr>)}
        </tbody></table>}
      </details>
      <iframe className="report-preview" title="Report preview" srcDoc={html} sandbox="" />
    </Page>
  );
}
