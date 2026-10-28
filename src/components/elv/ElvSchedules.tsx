import { useMemo, useState } from 'react';
import type { ElvEstimate } from '../../elv/estimate';
import { ELV_SYSTEMS, type ElvSystem } from '../../elv/defaults';
import { elvBoq, elvTables, projectBoqCurrent, remarkOf, withProjectBoq, withRemark, type TableId } from '../../elv/outputs';
import { Modal } from '../ui';
import { SYSTEM_LABEL } from './elvLabels';
import type { Project } from '../../types';
import { renderPdf, safeFileName, saveBinary, savePdf, saveText } from '../../util/files';

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
  const [boqOpen, setBoqOpen] = useState(false);
  const inBoq = project.elvBoq;
  const boqCurrent = useMemo(() => projectBoqCurrent(project), [project]);
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
  /** One A3 sheet per level with devices placed, all in one PDF (the browser prints the first level only). */
  const exportSheets = async () => {
    try {
      const { planLevels, planSheetHtml } = await import('../../elv/planSheets');
      const levels = planLevels(project);
      if (!levels.length) { onStatus('No ELV devices placed on the floor plans yet: place them on the Floor plan page first.'); return; }
      const name = `${safeFileName(project.name)} - ELV plan sheets`;
      const parts: Uint8Array[] = [];
      for (const [i, lv] of levels.entries()) {
        const bytes = await renderPdf(planSheetHtml(project, lv, i, levels.length), { pageSize: 'A3', landscape: true }, lv.name);
        if (!bytes) break;
        parts.push(bytes);
      }
      let m: string | null;
      if (parts.length === levels.length) {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.create();
        for (const b of parts) { const src = await PDFDocument.load(b); for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg); }
        doc.setTitle(`${project.name} — ELV plan sheets`);
        m = await saveBinary(`${name}.pdf`, await doc.save(), 'PDF', 'pdf', 'application/pdf');
      } else {
        m = await savePdf(`${name}.pdf`, planSheetHtml(project, levels[0], 0, levels.length), { pageSize: 'A3', landscape: true });
        if (m && levels.length > 1) m += ' (first level only — the desktop app saves every level in one PDF)';
      }
      if (m) onStatus(m);
    } catch (e) { onStatus(e instanceof Error ? e.message : String(e)); }
  };
  /** The devices of each level as DXF for the CAD team (one file, or a ZIP of one per level). */
  const exportDxf = async () => {
    try {
      const { levelUnits, planDxf, planLevels } = await import('../../elv/planSheets');
      const levels = planLevels(project);
      if (!levels.length) { onStatus('No ELV devices placed on the floor plans yet: place them on the Floor plan page first.'); return; }
      const files = levels.map((lv) => ({ name: `${safeFileName(`${project.name} ELV ${lv.name}`)}.dxf`, data: planDxf(project, lv) }));
      let m: string | null;
      if (files.length === 1) m = await saveText(files[0].name, files[0].data, 'DXF drawing (AutoCAD R12)', 'dxf');
      else {
        const zip = new (await import('jszip')).default();
        files.forEach((f) => zip.file(f.name, f.data));
        m = await saveBinary(`${safeFileName(project.name)} - ELV DXF.zip`, await zip.generateAsync({ type: 'uint8array' }), 'ZIP', 'zip', 'application/zip');
      }
      const units = [...new Set(levels.map((lv) => levelUnits(project, lv)))].join(' / ');
      if (m) onStatus(`${m} — in ${units}, the plan's units, on its origin`);
    } catch (e) { onStatus(e instanceof Error ? e.message : String(e)); }
  };
  const placedAny = (project.elvDevices ?? []).length > 0;
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
      <div className="modal-actions"><span className="m">{inBoq
        ? <>In the project BOQ: {inBoq.systems.map((x) => SYSTEM_LABEL[x as ElvSystem] ?? x).join(', ')} (added {inBoq.addedAt}){boqCurrent ? '' : <b> · out of date: the design changed since</b>}</>
        : 'Remarks are kept with the project and printed on the schedules'}</span><span className="sp" />
        <button className="chip" onClick={() => setBoqOpen(true)} disabled={!tables.some((x) => x.id === 'boq' && x.rows.length)}>{inBoq ? 'Project BOQ…' : 'Add to project BOQ…'}</button>
        <button className="chip" onClick={exportPdf} disabled={!tables.some((x) => x.rows.length)}>Schedules PDF…</button>
        <button className="chip" onClick={exportExcel} disabled={!tables.some((x) => x.rows.length)}>Excel…</button>
        <button className="chip" onClick={exportSheets} disabled={!placedAny} title="One A3 sheet per level with ELV devices placed; a typical level names its floors">Plan sheets PDF…</button>
        <button className="chip" onClick={exportDxf} disabled={!placedAny} title="ELV devices as DXF for the CAD team, in the plan's units on its origin">DXF for CAD…</button>
      </div>
      {boqOpen && <ProjectBoqDialog project={project} onClose={() => setBoqOpen(false)} onChange={(next, message) => { onChange(next); onStatus(message); setBoqOpen(false); }} />}
    </div>
  );
}

/** Add to project BOQ: the ELV systems whose quantities go into section P. None is ticked unless already in the BOQ. */
function ProjectBoqDialog({ project, onClose, onChange }: { project: Project; onClose: () => void; onChange: (next: Project, message: string) => void }) {
  const lines = useMemo(() => elvBoq(project), [project]);
  const offered = ELV_SYSTEMS.filter((s) => lines.some((l) => l.system === s));
  const [chosen, setChosen] = useState<ElvSystem[]>(() => (project.elvBoq?.systems ?? []).filter((s): s is ElvSystem => offered.includes(s as ElvSystem)));
  const toggle = (s: ElvSystem, on: boolean) => setChosen((c) => (on ? [...c, s] : c.filter((x) => x !== s)));
  const n = chosen.length;
  return (
    <Modal onClose={onClose} label="Add ELV to the project BOQ" style={{ width: 'min(520px, 96vw)' }}>
      <h3>Add ELV to the project BOQ</h3>
      <p className="m">Not added unless you choose. The chosen systems' quantities go into section P (Optional ELV systems) of the project BOQ. Press again after changing the devices to update them. Emergency lighting and exit signs are LV: they are in section J already.</p>
      <div className="fp-form" style={{ gridTemplateColumns: '1fr' }}>
        {offered.map((s) => (
          <label key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => toggle(s, e.target.checked)} />
            {SYSTEM_LABEL[s]} <span className="m">({lines.filter((l) => l.system === s).length} lines)</span>
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="chip" onClick={onClose}>Cancel</button><span className="sp" />
        {project.elvBoq && <button type="button" className="chip" onClick={() => onChange(withProjectBoq(project, []), 'ELV removed from the project BOQ')}>Remove from BOQ</button>}
        <button type="button" className="chip primary" disabled={!n} onClick={() => onChange(withProjectBoq(project, chosen), `${n} ELV system${n === 1 ? '' : 's'} ${project.elvBoq ? 'updated in' : 'added to'} the project BOQ (section P)`)}>
          {project.elvBoq ? `Update ${n} system${n === 1 ? '' : 's'}` : `Add ${n} system${n === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
