import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import type { MainView } from '../../views';
import { bulkResult, introducedIssues, previewBulkEdit, searchEquipment, type BulkMode, type EquipmentQuery } from '../../model/bulkEdit';
import { applyModification, PROPOSABLE, transition, withRecord } from '../../model/designChanges';
import { pairText } from '../../model/datasetDiff';
import { impactBetween } from '../../model/designImpact';
import { ImpactPanel } from './ChangesView';

/** Find equipment, tick the items to change, set one field on exactly those, and see before and after (and the impact)
 * before anything happens. "Save as draft" keeps it as a modification record for review; "Apply now" records it as accepted
 * and applies it as one undo step. Unticked items are never touched. */
export default function BulkEditPanel({ project, me, onChange, onApply, onStatus, onGo }: {
  project: Project; me: string; onChange: (p: Project) => void; onApply: (p: Project) => void; onStatus: (m: string) => void; onGo?: (v: MainView) => void;
}) {
  const [q, setQ] = useState<EquipmentQuery>({ type: 'feeder' });
  const [picked, setPicked] = useState<string[]>([]);
  const [field, setField] = useState('');
  const [mode, setMode] = useState<BulkMode>('set');
  const [value, setValue] = useState('');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [show, setShow] = useState(false);
  const target = q.type === 'board' ? 'board' : 'feeder';
  const hits = useMemo(() => searchEquipment(project, q), [project, q]);
  const fields = PROPOSABLE[target];
  const def = fields.find((f) => f.key === field);
  const ids = picked.filter((id) => hits.some((h) => h.id === id)); // only what is both ticked and still listed
  const num = def?.kind === 'number';
  const parsed: number | string | boolean = def?.kind === 'bool' ? value === 'true' : num ? Number(value) : value;
  const preview = useMemo(() => (show && def && value !== '' ? previewBulkEdit(project, ids, { target, field, mode: num ? mode : 'set', value: parsed }, { title: title || `Bulk edit: ${def.label}`, reason, author: me }) : undefined), [show, project, ids.join('|'), field, mode, value, title, reason]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = preview && !preview.error ? bulkResult(project, preview) : undefined;
  const introduced = after ? introducedIssues(project, after) : [];
  const impact = useMemo(() => (after && preview?.changed ? impactBetween(project, after) : undefined), [after, preview?.changed]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const reset = () => { setShow(false); setPicked([]); setValue(''); setTitle(''); setReason(''); };

  function save(applyNow: boolean) {
    if (!preview || preview.error || !preview.changed) return;
    if (!reason.trim()) { onStatus('Say why: a bulk edit needs a reason.'); return; }
    let p = withRecord(project, preview.record);
    if (!applyNow) { onChange(p); onStatus(`Saved ${preview.record.id} as a draft (${preview.changed} change${preview.changed === 1 ? '' : 's'}).`); reset(); return; }
    const by = me.trim() || window.prompt('Your name, recorded with the decision (typed text)')?.trim() || '';
    if (!by) { onStatus('A name is needed to record the decision.'); return; }
    for (const s of ['proposed', 'accepted'] as const) {
      const t = transition(p, p.modifications!.find((m) => m.id === preview.record.id)!, s, { by, note: 'Bulk edit applied directly' });
      if (!t.ok) { onStatus(t.error); return; }
      p = withRecord(p, t.record);
    }
    const r = applyModification(p, preview.record.id, { by });
    if (!r.ok) { onStatus(r.error); return; }
    onApply(r.project); onStatus(`Applied ${preview.record.id}: ${r.applied.length} change${r.applied.length === 1 ? '' : 's'} (one undo step).`); reset();
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h4>Bulk edit</h4>
      <p className="m">Search, tick the items to change, then set one field on exactly those. Nothing changes until you save or apply.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select value={target} onChange={(e) => { setQ({ ...q, type: e.target.value as 'feeder' | 'board' }); setPicked([]); setField(''); setShow(false); }}><option value="feeder">Circuits</option><option value="board">Panels</option></select>
        <input placeholder="Search name, id, room…" value={q.text ?? ''} onChange={(e) => setQ({ ...q, text: e.target.value })} />
        <select value={q.boardId ?? ''} onChange={(e) => setQ({ ...q, boardId: e.target.value || undefined })}><option value="">Any panel</option>{project.boards.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select>
        <input placeholder="Level…" value={q.level ?? ''} onChange={(e) => setQ({ ...q, level: e.target.value })} style={{ width: 90 }} />
        {target === 'feeder' && <label><input type="checkbox" checked={!!q.manualOnly} onChange={(e) => setQ({ ...q, manualOnly: e.target.checked })} /> Manual sizes</label>}
        {target === 'feeder' && <label><input type="checkbox" checked={!!q.essentialOnly} onChange={(e) => setQ({ ...q, essentialOnly: e.target.checked })} /> Essential</label>}
      </div>
      <p className="m">{hits.length} found · <b>{ids.length} selected</b> · <button className="link" onClick={() => setPicked(hits.map((h) => h.id))}>select all listed</button> · <button className="link" onClick={() => setPicked([])}>clear</button></p>
      <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
        {hits.slice(0, 300).map((h) => (
          <label key={h.id} style={{ display: 'flex', gap: 8, padding: '2px 8px' }}><input type="checkbox" checked={picked.includes(h.id)} onChange={() => { toggle(h.id); setShow(false); }} /> <b>{h.id}</b> <span>{h.label !== h.id ? h.label : ''}</span> <span className="m">{h.where}{h.manual ? ' · manual size' : ''}</span></label>
        ))}
        {hits.length > 300 && <p className="m" style={{ padding: 6 }}>Showing the first 300; narrow the search to see the rest.</p>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <select value={field} onChange={(e) => { setField(e.target.value); setValue(''); setShow(false); }}><option value="">Field to change…</option>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
        {num && <select value={mode} onChange={(e) => { setMode(e.target.value as BulkMode); setShow(false); }}><option value="set">set to</option><option value="scale">multiply by</option><option value="add">add</option></select>}
        {def?.kind === 'bool' ? <select value={value} onChange={(e) => { setValue(e.target.value); setShow(false); }}><option value="">…</option><option value="true">yes</option><option value="false">no</option></select>
          : <input placeholder="value" value={value} onChange={(e) => { setValue(e.target.value); setShow(false); }} style={{ width: 110 }} />}
        <button disabled={!def || value === '' || !ids.length} onClick={() => setShow(true)}>Preview</button>
      </div>
      {preview?.error && <p className="bad">{preview.error}</p>}
      {preview && !preview.error && (
        <div className="mod-detail">
          <table className="tbl"><thead><tr><th>Item</th><th>Before</th><th>After</th><th></th></tr></thead><tbody>
            {preview.rows.map((r) => (
              <tr key={r.id} className={r.skipped ? 'm' : ''}><td>{r.id} {r.label !== r.id ? <span className="m">{r.label}</span> : null}</td><td>{pairText(r.before, r.after)[0]}</td><td>{r.skipped ? '—' : pairText(r.before, r.after)[1]}</td><td>{r.skipped ? `not changed: ${r.skipped}` : r.warning ?? ''}</td></tr>
            ))}
          </tbody></table>
          <p className="m">{preview.changed} will change, {preview.skipped} unchanged. {ids.length < picked.length ? 'Ticked items hidden by the search are not included.' : ''}</p>
          {introduced.length > 0 && <div className="mod-conflicts"><b>This edit would introduce:</b><ul>{introduced.map((i, k) => <li key={k}>{i.where}: {i.problem}</li>)}</ul></div>}
          {impact && <ImpactPanel impact={impact} onGo={onGo} />}
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button disabled={!preview.changed} onClick={() => save(false)}>Save as draft</button>
            <button className="primary" disabled={!preview.changed || introduced.length > 0} onClick={() => save(true)} title={introduced.length ? 'Resolve the problems above first' : ''}>Apply now</button>
            <button onClick={() => setShow(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
