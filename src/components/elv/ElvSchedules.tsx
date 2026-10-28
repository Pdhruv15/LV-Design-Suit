import { useMemo, useState } from 'react';
import type { ElvEstimate } from '../../elv/estimate';
import { elvTables, remarkOf, withRemark, type TableId } from '../../elv/outputs';
import type { Project } from '../../types';
import { safeFileName, saveBinary, savePdf } from '../../util/files';

const TABS: { id: TableId; label: string }[] = [
  { id: 'devices', label: 'Devices' }, { id: 'loops', label: 'Fire alarm loops' }, { id: 'zones', label: 'Zones' }, { id: 'ports', label: 'Ports and zones' }, { id: 'boq', label: 'BOQ' }
];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The ELV schedules on the ELV page: devices per room and floor, fire alarm loops and zones, switch ports / doors /
 * PA zones, and the ELV BOQ, each with a Remarks column the engineer types in (kept with the project). Excel exports
 * every schedule, one sheet each. */
export default function ElvSchedules({ project, estimate, stamp, onChange, onStatus }: {
  project: Project;
  estimate: ElvEstimate;
  stamp?: string;
  onChange: (next: Project) => void;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<TableId>('devices');
  const tables = useMemo(() => elvTables(project, project.elv, estimate), [project, estimate]);
  const t = tables.find((x) => x.id === tab)!;
  const exportExcel = async () => {
    try {
      const { elvWorkbook } = await import('../../elv/workbook');
      const wb = await elvWorkbook(project, tables, stamp);
      const m = await saveBinary(`${safeFileName(project.name)} - ELV schedules.xlsx`, new Uint8Array(await wb.xlsx.writeBuffer()), 'Excel workbook', 'xlsx', XLSX);
      if (m) onStatus(m);
    } catch (e) { onStatus(e instanceof Error ? e.message : String(e)); }
  };
  const exportPdf = async () => {
    try {
      const { elvSchedulesHtml } = await import('../../elv/pdf');
      const m = await savePdf(`${safeFileName(project.name)} - ELV schedules.pdf`, elvSchedulesHtml(project, tables, stamp),
        { pageSize: 'A4', landscape: true, frame: { headerLeft: project.name, headerRight: stamp ?? '', footerLeft: 'ELV schedules' } });
      if (m) onStatus(m);
    } catch (e) { onStatus(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="card">
      <h4>Schedules <span className="m">from the devices placed on the floor plans; levels with nothing placed use the room-area estimate</span></h4>
      <div className="seg" role="tablist" aria-label="ELV schedules">
        {TABS.map((x) => <button key={x.id} role="tab" aria-selected={x.id === tab} className={x.id === tab ? 'on' : undefined} onClick={() => setTab(x.id)}>{x.label}</button>)}
      </div>
      {!t.rows.length ? <p className="m">{t.notes[t.notes.length - 1]}</p> : (
        <div className="elv-sched">
          <table className="tbl">
            <thead><tr>{t.columns.map((c) => <th key={c.label} className={c.num ? 'num' : undefined} title={c.title}>{c.label}</th>)}<th>Remarks</th></tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.key} className={r.kind}>
                  {r.cells.map((v, i) => <td key={i} className={t.columns[i]?.num ? 'num' : undefined}>{v}</td>)}
                  <td>{r.kind === 'sum' ? null : (
                    <input className="elv-remark" aria-label={`Remarks: ${r.cells[0]}`} defaultValue={remarkOf(project, t.id, r.key)} key={`${t.id}:${r.key}:${remarkOf(project, t.id, r.key)}`}
                      onBlur={(e) => { if (e.target.value.trim() !== remarkOf(project, t.id, r.key)) onChange(withRemark(project, t.id, r.key, e.target.value)); }} />
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {t.rows.length > 0 && t.notes.map((n) => <p key={n} className="m">{n}</p>)}
      <div className="modal-actions"><span className="m">Remarks are kept with the project and printed on the schedules</span><span className="sp" />
        <button className="chip" onClick={exportPdf} disabled={!tables.some((x) => x.rows.length)}>Schedules PDF…</button>
        <button className="chip" onClick={exportExcel} disabled={!tables.some((x) => x.rows.length)}>Excel…</button>
      </div>
    </div>
  );
}
