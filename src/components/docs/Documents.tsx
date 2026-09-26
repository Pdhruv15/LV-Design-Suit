import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { cableSchedule, dbSchedule, equipmentSchedule, type Schedule } from '../../docs/schedules';
import { buildReportHtml } from '../../docs/report';
import { saveCsv, savePdf, safeFileName } from '../../util/files';
import { Page } from '../ui';

function ScheduleTable({ schedule }: { schedule: Schedule }) {
  const cls = (v: string | number) => (v === 'Pass' ? 'ok' : v === 'Check' ? 'warn' : v === 'Fail' ? 'bad' : undefined);
  return (
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
  );
}

type Status = (msg: string) => void;

function ExportCsvButton({ name, schedule, onStatus }: { name: string; schedule: Schedule; onStatus: Status }) {
  return (
    <button className="chip" onClick={async () => { const m = await saveCsv(name, schedule.headers, schedule.rows); if (m) onStatus(m); }}>
      Export CSV (Excel)
    </button>
  );
}

export function DbScheduleView({ project, onStatus }: { project: Project; onStatus: Status }) {
  const [boardId, setBoardId] = useState('');
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
          <ExportCsvButton name={`${project.name} DB schedule${boardId ? ` ${boardId}` : ''}`} schedule={schedule} onStatus={onStatus} />
        </>
      }
    >
      <ScheduleTable schedule={schedule} />
    </Page>
  );
}

export function CableScheduleView({ project, onStatus }: { project: Project; onStatus: Status }) {
  const schedule = useMemo(() => cableSchedule(project), [project]);
  return (
    <Page title="Cable schedule" actions={<ExportCsvButton name={`${project.name} cable schedule`} schedule={schedule} onStatus={onStatus} />}>
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
      actions={<ExportCsvButton name={`${project.name} equipment schedule`} schedule={schedule} onStatus={onStatus} />}
    >
      <ScheduleTable schedule={schedule} />
    </Page>
  );
}

export function ReportView({ project, onStatus }: { project: Project; onStatus: Status }) {
  const html = useMemo(() => buildReportHtml(project), [project]);
  const [busy, setBusy] = useState(false);
  async function exportPdf() {
    setBusy(true);
    try {
      const m = await savePdf(`${safeFileName(project.name)}-calculation-report.pdf`, html);
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Calculation report"
      intro="Design basis, system summary, sizing, feeder, earthing and coordination results, DB and cable schedules, and assumptions — A4 landscape."
      actions={<button className="chip primary" disabled={busy} onClick={exportPdf}>{busy ? 'Exporting…' : 'Export PDF'}</button>}
    >
      <iframe className="report-preview" title="Report preview" srcDoc={html} sandbox="" />
    </Page>
  );
}
