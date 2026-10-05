import { useState } from 'react';
import type { Project } from '../../types';
import type { MainView } from '../../views';
import {
  addOp, allowedNext, applyModification, conflictsOf, currentValue, describeOp, impactOfProposal, ModificationError, newModification, PROPOSABLE, reconcile, recordFromDraft, removeOp,
  STATUS_LABEL, transition, withRecord, type ModificationRecord, type ModStatus, type ModTarget, type OpConflict
} from '../../model/designChanges';
import { pairText } from '../../model/datasetDiff';
import { ImpactPanel } from './ChangesView';

const ACTION: Record<ModStatus, string> = { draft: 'Draft', proposed: 'Propose', review: 'Start review', accepted: 'Accept…', rejected: 'Reject…', superseded: 'Supersede…' };
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Modification records: propose a design change with the reason and the exact values, preview what it touches, record a
 * decision, and apply it to the working design as one undoable step. Names are typed text, not verified identities. */
export default function ModificationsPanel({ project, me, onChange, onApply, onStatus, onGo }: {
  project: Project; me: string;
  /** A change to the records (one undo step). */
  onChange: (p: Project) => void;
  /** Applying to the working design (one undo step: design and record together). */
  onApply: (p: Project) => void;
  onStatus: (m: string) => void; onGo?: (v: MainView) => void;
}) {
  const records = project.modifications ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const rec = records.find((r) => r.id === sel);
  const [conflict, setConflict] = useState<OpConflict[] | null>(null);
  const [add, setAdd] = useState<{ target: ModTarget; id: string; field: string; value: string }>({ target: 'feeder', id: '', field: '', value: '' });

  const save = (r: ModificationRecord) => onChange(withRecord(project, r));
  const guard = (fn: () => void) => { try { fn(); } catch (e) { onStatus(e instanceof ModificationError || e instanceof Error ? e.message : String(e)); } };

  function create() {
    const title = window.prompt('Title of the modification, e.g. Upsize cooker circuit cable');
    if (!title?.trim()) return;
    const reason = window.prompt('Why? (the reason for the change)') ?? '';
    const origin = window.prompt('Where does it come from? (comment, query or request reference — optional)') ?? '';
    const r = newModification(project, { title, reason, origin, author: me });
    onChange(withRecord(project, r));
    setSel(r.id);
  }

  function fromDraft() {
    const title = window.prompt('Title for the changes already made in the working draft');
    if (!title?.trim()) return;
    const reason = window.prompt('Why were they made?') ?? '';
    const res = recordFromDraft(project, { title, reason, author: me });
    if (!res) { onStatus('No field changes to record: there is no baseline, or the draft matches it.'); return; }
    onChange(withRecord(project, res.record));
    setSel(res.record.id);
    onStatus(`Recorded ${res.record.ops.length} change${res.record.ops.length === 1 ? '' : 's'}${res.unsupported ? ` — ${res.unsupported} other difference${res.unsupported === 1 ? '' : 's'} (added or removed equipment, other fields) cannot be recorded this way` : ''}`);
  }

  function step(to: ModStatus) {
    if (!rec) return;
    const note = to === 'accepted' || to === 'rejected' || to === 'superseded' ? window.prompt(to === 'superseded' ? 'What supersedes it (e.g. MOD-004), or why?' : 'Decision note (optional)') : '';
    if (note === null) return;
    const t = transition(project, rec, to, { by: me, note: note || undefined, supersededBy: to === 'superseded' && /^MOD-\d+$/i.test(note ?? '') ? note!.toUpperCase() : undefined });
    if (!t.ok) { onStatus(t.error); if (t.conflicts) setConflict(t.conflicts); return; }
    setConflict(null);
    save(t.record);
  }

  function apply(mode: 'stop' | 'overwrite' | 'skip') {
    if (!rec) return;
    const r = applyModification(project, rec.id, { by: me, onConflict: mode });
    if (!r.ok) { onStatus(r.error); if (r.conflicts) setConflict(r.conflicts); return; }
    setConflict(null);
    onApply(r.project);
    onStatus(`Applied ${rec.id}: ${r.applied.length} change${r.applied.length === 1 ? '' : 's'}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}${r.overwritten.length ? `, ${r.overwritten.length} overwritten on purpose` : ''}. Run the studies listed again. Undo (Ctrl+Z) reverses it.`);
  }

  const items = (t: ModTarget): { id: string; label: string }[] =>
    t === 'feeder' ? project.feeders.map((f) => ({ id: f.id, label: `${f.id}${f.room || f.name ? ` — ${f.room || f.name}` : ''}` })) : t === 'board' ? project.boards.map((b) => ({ id: b.id, label: `${b.id} — ${b.name}` }))
      : t === 'ups' ? (project.upsSystems ?? []).map((u) => ({ id: u.id, label: u.name || u.id })) : [];
  const fieldDefs = PROPOSABLE[add.target];
  const def = fieldDefs.find((f) => f.key === add.field);
  const cur = def ? currentValue(project, { target: add.target, targetId: add.target === 'project' ? undefined : add.id, field: def.key }) : undefined;
  const editable = rec?.status === 'draft';
  const open = rec && !rec.applied && rec.status !== 'rejected' && rec.status !== 'superseded';
  const conflicts = rec && !rec.applied ? conflictsOf(project, rec) : [];

  function addChange() {
    if (!rec || !def) return;
    guard(() => {
      const raw = add.value.trim();
      const after = def.kind === 'number' ? (raw === '' ? Number.NaN : Number(raw)) : def.kind === 'bool' ? raw === 'yes' : raw;
      save(addOp(project, rec, add.target, add.target === 'project' ? undefined : add.id, def.key, after));
      setAdd({ ...add, value: '' });
    });
  }

  return (
    <section className="card mods">
      <h4>Modifications <span className="m">({records.length})</span>
        <span style={{ float: 'right', display: 'inline-flex', gap: 6 }}>
          <button className="chip primary" onClick={create}>New modification…</button>
          <button className="chip" onClick={fromDraft} title="Record the field changes already made in the working draft against its baseline, with the baseline's values as 'before'">Record the draft’s changes…</button>
        </span>
      </h4>
      <p className="m">Propose a change with its reason and the exact values, preview what it touches, record the decision, then apply it to the working design as one undoable step. {me ? <>Recorded as <b>{me}</b> (a typed name — the app does not verify identities).</> : 'Set your name in Profile & preferences to record who proposed and decided.'}</p>

      {records.length === 0 ? <p className="m">No modifications yet.</p> : (
        <table className="projects-table">
          <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Changes</th><th>Applied</th></tr></thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className={r.id === sel ? 'on' : ''}>
                <td><button className="linkish" onClick={() => { setSel(r.id); setConflict(null); }}>{r.id}</button></td>
                <td>{r.title}{r.origin && <span className="m"> · {r.origin}</span>}</td>
                <td><span className={`chip-lite mod-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td>{r.ops.length}</td>
                <td>{r.applied ? `${when(r.applied.at)}${r.applied.source === 'draft' ? ' (recorded)' : ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rec && (
        <div className="mod-detail">
          <h4>{rec.id} — {editable
            ? <input className="bi-text" value={rec.title} onChange={(e) => save({ ...rec, title: e.target.value })} />
            : rec.title}</h4>
          <p className="m">{editable ? <><label>Reason <input className="bi-text" value={rec.reason} onChange={(e) => save({ ...rec, reason: e.target.value })} /></label> <label>Origin <input className="bi-text" value={rec.origin ?? ''} placeholder="comment / query reference" onChange={(e) => save({ ...rec, origin: e.target.value || undefined })} /></label></> : <>Reason: {rec.reason || '—'}{rec.origin ? ` · Origin: ${rec.origin}` : ''}</>}
            {' '}· {rec.author ? `by ${rec.author}, ` : ''}{when(rec.createdAt)}{rec.baselineRevisionId ? ` · against Rev ${rec.baselineRevisionId}` : ''}</p>

          <table className="schedule">
            <thead><tr><th>Item</th><th>Before</th><th>After</th><th /></tr></thead>
            <tbody>
              {rec.ops.map((o) => { const d = describeOp(o); return (
                <tr key={o.id}><td>{d.item}</td><td>{d.from}</td><td><b>{d.to}</b></td><td>{editable && <button className="icon-btn" title="Remove this change" onClick={() => guard(() => save(removeOp(rec, o.id)))}>✕</button>}</td></tr>
              ); })}
              {rec.ops.length === 0 && <tr><td colSpan={4} className="m">No changes yet.</td></tr>}
            </tbody>
          </table>

          {editable && (
            <div className="row mod-add" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <select value={add.target} onChange={(e) => setAdd({ target: e.target.value as ModTarget, id: '', field: '', value: '' })}>
                <option value="feeder">Circuit</option><option value="board">Panel</option><option value="ups">UPS</option><option value="project">Project setting</option>
              </select>
              {add.target !== 'project' && <select value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })}><option value="">Choose…</option>{items(add.target).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select>}
              <select value={add.field} onChange={(e) => setAdd({ ...add, field: e.target.value })}><option value="">Field…</option>{fieldDefs.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
              {def?.kind === 'bool'
                ? <select value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })}><option value="">—</option><option value="yes">yes</option><option value="no">no</option></select>
                : <input className="bi-text" style={{ width: 120 }} type={def?.kind === 'number' ? 'number' : 'text'} step="any" placeholder={def ? 'New value' : ''} value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })} />}
              {cur?.exists && <span className="m">now {pairText(cur.value, undefined)[0]}</span>}
              <button className="chip" disabled={!def || (add.target !== 'project' && !add.id) || add.value === ''} onClick={addChange}>Add change</button>
            </div>
          )}

          {(conflicts.length > 0 || conflict) && open && (
            <div className="mod-conflicts" role="alert">
              <b>Changed since this was proposed</b>
              <ul>{(conflict ?? conflicts).map((c) => <li key={c.op.id}>{c.op.targetId ?? 'Project'} — {c.op.label}: {c.kind === 'missing' ? 'the item no longer exists' : <>proposed against {pairText(c.op.before, c.current)[0]}, now {pairText(c.op.before, c.current)[1]}</>}</li>)}</ul>
              {rec.status !== 'accepted' && <button className="chip" onClick={() => { save(reconcile(project, rec, me)); setConflict(null); }} title="Re-base the proposal on the values the design has now; recorded in its history">Reconcile on the current values</button>}
              {rec.status === 'accepted' && <>
                <button className="chip" onClick={() => apply('skip')} title="Apply the changes that still match; leave the edited values alone">Apply the rest, keep later edits</button>
                <button className="chip" onClick={() => { if (window.confirm('Overwrite the later edits with the proposed values?')) apply('overwrite'); }} title="Replace the values edited since with the proposed ones">Overwrite later edits…</button>
              </>}
            </div>
          )}

          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {allowedNext(rec).map((s) => <button key={s} className={`chip${s === 'accepted' ? ' primary' : ''}`} onClick={() => step(s)}>{ACTION[s]}</button>)}
            {rec.status === 'accepted' && !rec.applied && conflicts.length === 0 && <button className="chip primary" onClick={() => apply('stop')} title="Change the working design as proposed — one undo step">Apply to the working design</button>}
            {rec.applied && <span className="ok">✓ {rec.applied.source === 'draft' ? 'Recorded from the working draft' : 'Applied'} {when(rec.applied.at)}{rec.applied.skipped?.length ? ` — ${rec.applied.skipped.length} skipped` : ''}{rec.applied.overwritten?.length ? ` — ${rec.applied.overwritten.length} overwritten on purpose` : ''}</span>}
            {rec.decision && <span className="m">Decision: {rec.decision.outcome}{rec.decision.by ? ` by ${rec.decision.by}` : ''}{rec.decision.note ? ` — ${rec.decision.note}` : ''}</span>}
          </div>

          {open && rec.ops.length > 0 && (
            <>
              <h4 style={{ marginTop: 10 }}>What applying it would touch</h4>
              <ImpactPanel impact={impactOfProposal(project, rec)} onGo={onGo} />
            </>
          )}
          <details style={{ marginTop: 8 }}><summary>History ({rec.history.length})</summary>
            <ul>{rec.history.map((h, i) => <li key={i} className="m">{when(h.at)} — {STATUS_LABEL[h.status]}{h.by ? ` · ${h.by}` : ''}{h.note ? ` — ${h.note}` : ''}</li>)}</ul>
          </details>
        </div>
      )}
    </section>
  );
}
