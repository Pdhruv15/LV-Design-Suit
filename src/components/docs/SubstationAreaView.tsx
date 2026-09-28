import { useState } from 'react';
import type { DmSubstationRoom, Project } from '../../types';
import { dmSubstationAreas, DM_TITLE, DM_TYPES, dmType, substationsFromProject, type DmSubstationType } from '../../calc/dmSubstation';
import { buildDmFormHtml } from '../../docs/dmForm';
import { safeFileName, savePdf } from '../../util/files';
import { Page } from '../ui';

const m = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
let seq = 0;
const newId = () => `ss-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Dubai Municipality DM-D-013: minimum area of the substation (transformer
 * room), RMU room and LV room for each substation of the project, by type
 * and number of transformers, with the form's notes — in English — and the
 * form as a PDF. */
export default function SubstationAreaView({ project, onChange, onStatus }: {
  project: Project;
  onChange: (p: Project, step?: boolean) => void;
  onStatus: (m: string) => void;
}) {
  const list = project.substations ?? [];
  const set = (next: DmSubstationRoom[], step = false) => onChange({ ...project, substations: next }, step);
  const patch = (id: string, p: Partial<DmSubstationRoom>, step = false) => set(list.map((s) => (s.id === id ? { ...s, ...p } : s)), step);
  const [busy, setBusy] = useState(false);
  const results = list.map((s) => ({ s, r: dmSubstationAreas(s.type, s.transformers) }));
  const total = results.reduce((a, x) => a + x.r.totalAreaM2, 0);

  function fill() {
    const { rooms, source } = substationsFromProject(project);
    if (!rooms.length) return onStatus('No transformers in the space plan or on the SLD yet — add substations by hand');
    if (list.length && !window.confirm(`Replace the ${list.length} substation${list.length === 1 ? '' : 's'} here with ${rooms.length} from the ${source}?`)) return;
    set(rooms, true);
    onStatus(`${rooms.length} substation${rooms.length === 1 ? '' : 's'} from the ${source} (one per RMU)`);
  }
  function add() {
    let n = list.length + 1;
    while (list.some((s) => s.name === `SS-${n}`)) n++;
    set([...list, { id: newId(), name: `SS-${n}`, type: 'conventional', transformers: 1 }], true);
  }
  async function exportPdf(which: DmSubstationRoom[]) {
    setBusy(true);
    try {
      const msg = await savePdf(`${safeFileName(project.name)} - DM-D-013 substation areas${which.length === 1 ? ` ${safeFileName(which[0].name)}` : ''}.pdf`, buildDmFormHtml(project, which), { pageSize: 'A4', landscape: false });
      if (msg) onStatus(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Substation & LV room areas (DM-D-013)"
      intro={`${DM_TITLE} — Dubai Municipality form, in English. Choose the substation type and the number of transformers; the form gives the minimum length × width of each room and the conditions that apply. One substation per RMU.`}
      actions={
        <>
          <button className="chip" onClick={fill} title="One substation per RMU, from the space plan (or the SLD's transformers)">Fill from project</button>
          <button className="chip" onClick={add}>+ Substation</button>
          <button className="chip primary" disabled={busy || !list.length} onClick={() => exportPdf(list)}>{busy ? 'Exporting…' : 'Export DM form (PDF)'}</button>
        </>
      }
    >
      {list.length > 0 && (
        <div className="plan-cards">
          <div><span>Substations</span><b>{list.length}</b></div>
          <div><span>Transformers</span><b>{list.reduce((a, s) => a + s.transformers, 0)}</b></div>
          <div><span>Total minimum area</span><b>{m(total)} m²</b><small>all rooms</small></div>
          <div><span>Problems</span><b className={results.some((x) => x.r.error) ? 'bad' : 'ok'}>{results.filter((x) => x.r.error).length || 'None'}</b></div>
        </div>
      )}

      {results.map(({ s, r }) => (
        <section key={s.id} className="dm-card">
          <div className="dm-head">
            <label>Substation<input key={`n-${s.name}`} defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && patch(s.id, { name: e.target.value.trim() }, true)} /></label>
            <label>Type
              <select value={s.type} onChange={(e) => patch(s.id, { type: e.target.value as DmSubstationType }, true)}>
                {DM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}{t.maxTransformers < 15 ? ` (max ${t.maxTransformers})` : ''}</option>)}
              </select>
            </label>
            <label>Transformers
              <select value={s.transformers} onChange={(e) => patch(s.id, { transformers: +e.target.value }, true)}>
                {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => <option key={n} value={n} disabled={n > dmType(s.type).maxTransformers}>{n}</option>)}
              </select>
            </label>
            <label>kVA each<input key={`k-${s.kva ?? ''}`} inputMode="numeric" defaultValue={s.kva ?? ''} placeholder="—" style={{ width: 70 }} onBlur={(e) => { const v = e.target.value.trim() ? +e.target.value : undefined; if (v !== s.kva && (v === undefined || v > 0)) patch(s.id, { kva: v }); }} /></label>
            <label>Building / location<input key={`b-${s.building ?? ''}`} defaultValue={s.building ?? ''} onBlur={(e) => e.target.value !== (s.building ?? '') && patch(s.id, { building: e.target.value || undefined })} /></label>
            <span className="sp" />
            <button className="chip" disabled={busy} onClick={() => exportPdf([s])}>PDF</button>
            <button className="icon-btn" title={`Remove ${s.name}`} onClick={() => window.confirm(`Remove ${s.name}?`) && set(list.filter((x) => x.id !== s.id), true)}>✕</button>
          </div>

          {r.error ? <p className="bad dm-err">{r.error}</p> : (
            <table className="schedule dm-rooms">
              <thead><tr><th className="l">Room</th><th>Length (m)</th><th>Width (m)</th><th>Height (m)</th><th>Area (m²)</th><th className="l">Condition</th></tr></thead>
              <tbody>
                {r.rooms.map((x) => (
                  <tr key={x.key}>
                    <td className="l"><b>{x.label}</b></td>
                    <td>{m(x.lengthM)}</td><td>{m(x.widthM)}</td><td>{x.heightM ? m(x.heightM) : '—'}</td>
                    <td><b>{m(x.areaM2)}</b></td>
                    <td className="l m">{x.widthNote}</td>
                  </tr>
                ))}
                {r.rooms.length > 1 && <tr className="dm-total"><td className="l">Total</td><td /><td /><td /><td><b>{m(r.totalAreaM2)}</b></td><td /></tr>}
              </tbody>
            </table>
          )}

          <details className="dm-notes">
            <summary>Notes and conditions ({r.notes.length}) · remarks</summary>
            <ol>{r.notes.map((n) => <li key={n}>{n}</li>)}</ol>
            <label className="dm-remarks">Consultant / contractor remarks (printed on the form)
              <textarea key={`r-${s.remarks ?? ''}`} defaultValue={s.remarks ?? ''} rows={3} onBlur={(e) => e.target.value !== (s.remarks ?? '') && patch(s.id, { remarks: e.target.value || undefined })} />
            </label>
          </details>
        </section>
      ))}

      {!list.length && (
        <div className="tray-empty">
          <p className="m">No substations yet. <b>Fill from project</b> makes one per RMU from the space plan or the SLD, or add one by hand.</p>
          <button className="chip primary" onClick={fill}>Fill from project</button> <button className="chip" onClick={add}>+ Substation</button>
        </div>
      )}

      <details className="dm-table">
        <summary>The DM table (all types, 1–15 transformers)</summary>
        <DmReferenceTable />
      </details>
    </Page>
  );
}

/** The whole DM table, for reference. */
function DmReferenceTable() {
  const [type, setType] = useState<DmSubstationType>('conventional');
  const rows = Array.from({ length: dmType(type).maxTransformers }, (_, i) => dmSubstationAreas(type, i + 1));
  const heads = rows[0]?.rooms.map((x) => x.label) ?? [];
  return (
    <>
      <div className="sr-quick" style={{ margin: '6px 0' }}>
        {DM_TYPES.map((t) => <button key={t.value} className={`chip${t.value === type ? ' primary' : ''}`} onClick={() => setType(t.value)}>{t.label}</button>)}
      </div>
      <table className="schedule dm-rooms">
        <thead><tr><th>Transformers</th>{heads.map((h) => <th key={h}>{h} — L × W (m) = m²</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.transformers}>
              <td><b>{r.transformers}</b></td>
              {r.rooms.map((x) => <td key={x.key}>{m(x.lengthM)} × {m(x.widthM)} = <b>{m(x.areaM2)}</b></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
