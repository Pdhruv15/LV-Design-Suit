import { useEffect, useState } from 'react';
import type { Project } from '../../types';
import type { MainView } from '../../views';
import {
  addOp, allowedNext, applyModification, conflictsOf, currentValue, impactOfProposal, ModificationError, newModification, PROPOSABLE, reconcile, recordFromDraft, removeOp,
  STATUS_LABEL, transition, withRecord, type ModificationRecord, type ModStatus, type ModTarget, type OpConflict
} from '../../model/designChanges';
import { pairText } from '../../model/datasetDiff';
import { filterRegister, opView, type RegisterFilter } from '../../model/proposalRegister';
import { followUp } from '../../model/designChanges';
import { baselineMessage, baselineStatus } from '../../model/proposalRules';
import { ImpactPanel } from './ChangesView';
import type { CalcRun } from '../../calc/runs';
import { appliedFollowUp } from '../../model/designChanges';
import ProposalPreviewPanel from './ProposalPreviewPanel';

const ACTION: Record<ModStatus, string> = { draft: 'Return to draft…', proposed: 'Propose', review: 'Start review', accepted: 'Accept…', rejected: 'Reject…', superseded: 'Supersede…' };
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Modification records: propose a design change with the reason and the exact values, preview what it touches, record a
 * decision, and apply it to the working design as one undoable step. Names are typed text, not verified identities. */
export default function ModificationsPanel({ project, me, run, onChange, onApply, onStatus, onGo }: {
  project: Project; me: string; run?: CalcRun;
  /** A change to the records (one undo step). */
  onChange: (p: Project) => void;
  /** Applying to the working design (one undo step: design and record together). */
  onApply: (p: Project) => void;
  onStatus: (m: string) => void; onGo?: (v: MainView) => void;
}) {
  const records = project.modifications ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const stored = records.find((r) => r.id === sel);
  /** The editor's own copy of a draft: nothing reaches the project until Save, and Cancel throws it away. */
  const [buf, setBuf] = useState<ModificationRecord | undefined>();
  useEffect(() => { setBuf(undefined); }, [sel, stored]);
  const rec = buf ?? stored;
  const dirty = !!buf;
  const followUpInfo = rec ? appliedFollowUp(project, rec, run) : undefined;
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { setReviewing(false); }, [sel, stored]);
  const [flt, setFlt] = useState<RegisterFilter>({ status: 'all' });
  const rows = filterRegister(project, records, flt);
  const [conflict, setConflict] = useState<OpConflict[] | null>(null);
  const [add, setAdd] = useState<{ target: ModTarget; id: string; field: string; value: string }>({ target: 'feeder', id: '', field: '', value: '' });

  const save = (r: ModificationRecord) => onChange(withRecord(project, r));
  const edit = (r: ModificationRecord) => (r.status === 'draft' ? setBuf(r) : save(r));
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
    const decision = to === 'accepted' || to === 'rejected';
    const by = decision && !me.trim() ? window.prompt('Who is making this decision? (a typed name — the app does not verify identities)')?.trim() || '' : me;
    if (decision && !by) { onStatus('A name is needed to record the decision.'); return; }
    const note = decision || to === 'superseded' ? window.prompt(to === 'superseded' ? 'What supersedes it (e.g. MOD-004), or why?' : to === 'rejected' ? 'Reason for rejecting it (required)' : 'Reason for accepting it') : '';
    if (note === null) return;
    if (to === 'draft' && !window.confirm(rec.decision ? 'Return it to a draft to edit it? The earlier decision stops applying, and it needs a new decision after you change it.' : 'Return it to a draft to edit it?')) return;
    const evidenceRef = to === 'accepted' || to === 'rejected' ? window.prompt('Where is the evidence for this decision kept? (optional)') ?? undefined : undefined;
    const t = transition(project, rec, to, { by, evidenceRef, note: note || undefined, supersededBy: to === 'superseded' && /^MOD-\d+$/i.test(note ?? '') ? note!.toUpperCase() : undefined });
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
      edit(addOp(project, rec, add.target, add.target === 'project' ? undefined : add.id, def.key, after));
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

      {records.length > 0 && (
        <div className="row my">
          <select value={flt.status ?? 'all'} onChange={(e) => setFlt({ ...flt, status: e.target.value as RegisterFilter['status'] })}>
            <option value="all">All statuses</option><option value="open">Not yet decided or applied</option>
            {(Object.keys(STATUS_LABEL) as ModStatus[]).map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
          </select>
          <input placeholder="Equipment, e.g. DB-GF1-R3" value={flt.equipment ?? ''} onChange={(e) => setFlt({ ...flt, equipment: e.target.value })} style={{ width: 190 }} />
          <input placeholder="Search title or reason" value={flt.text ?? ''} onChange={(e) => setFlt({ ...flt, text: e.target.value })} style={{ width: 170 }} />
        </div>
      )}
      {records.length === 0 ? <p className="m">No modifications yet.</p> : !rows.length ? <p className="m">None match this filter.</p> : (
        <table className="projects-table">
          <thead><tr><th>ID</th><th>Title</th><th>Baseline</th><th>Equipment</th><th>By / date</th><th>Status</th><th>Applied</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === sel ? 'on' : ''}>
                <td><button className="linkish" onClick={() => { setSel(r.id); setConflict(null); }}>{r.id}</button></td>
                <td>{r.title}{r.follows && <span className="m"> · follows {r.follows}</span>}</td>
                <td className={r.baselineState === 'unavailable' || r.baselineState === 'changed' ? 'bad' : ''}>{r.baseline}</td>
                <td>{r.equipment.slice(0, 3).join(', ')}{r.equipment.length > 3 ? ` +${r.equipment.length - 3}` : ''} <span className="m">({r.changes})</span></td>
                <td>{r.author ? `${r.author}, ` : ''}{when(r.date)}</td>
                <td><span className={`chip-lite mod-${r.status}`}>{r.statusLabel}</span></td>
                <td>{r.applied ? when(r.applied) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rec && (
        <div className="mod-detail">
          <h4>{rec.id} — {editable
            ? <input className="bi-text" value={rec.title} onChange={(e) => edit({ ...rec, title: e.target.value })} />
            : rec.title}</h4>
          <p className="m">{editable ? <><label>Reason <input className="bi-text" value={rec.reason} onChange={(e) => edit({ ...rec, reason: e.target.value })} /></label> <label>Origin <input className="bi-text" value={rec.origin ?? ''} placeholder="comment / query reference" onChange={(e) => edit({ ...rec, origin: e.target.value || undefined })} /></label></> : <>Reason: {rec.reason || '—'}{rec.origin ? ` · Origin: ${rec.origin}` : ''}</>}
            {' '}· {rec.author ? `by ${rec.author}, ` : ''}{when(rec.createdAt)}{rec.baselineRevisionId ? ` · against Rev ${rec.baselineRevisionId}` : ''}</p>

          {baselineMessage(baselineStatus(project, rec), rec) && <p className="bad" role="alert">{baselineMessage(baselineStatus(project, rec), rec)} It cannot be accepted or applied.</p>}
          {rec.follows && <p className="m">Follows {rec.follows} (that record and its decision are unchanged).</p>}
          <div className="m">
            Evidence and references{editable ? '' : rec.evidence?.length ? '' : ': none'}
            {(rec.evidence ?? []).map((e, i) => (
              <div key={i}>• {e.ref}{e.note ? ` — ${e.note}` : ''} {editable && <button className="icon-btn" title="Remove" onClick={() => edit({ ...rec, evidence: (rec.evidence ?? []).filter((_, j) => j !== i) })}>✕</button>}</div>
            ))}
            {editable && <button className="chip" onClick={() => { const ref = window.prompt('Reference (e.g. DEWA comment 12, markup SLD-03, document RD-002)')?.trim(); if (!ref) return; const note = window.prompt('Note (optional)')?.trim(); edit({ ...rec, evidence: [...(rec.evidence ?? []), { ref, note: note || undefined }] }); }}>Add reference…</button>}
            <span> — references are notes; a received PDF or DXF is evidence only, never the editable baseline.</span>
          </div>
          <table className="schedule">
            <thead><tr><th>Item</th><th>Current design</th><th>Expected before</th><th>Proposed</th><th /></tr></thead>
            <tbody>
              {rec.ops.map((o) => { const d = opView(project, o); return (
                <tr key={o.id} className={d.state !== 'matches' && !rec.applied ? 'warn' : ''}><td>{d.item}</td><td>{d.current}{d.state === 'changed' && !rec.applied ? ' ⚠' : ''}</td><td>{d.expectedBefore}</td><td><b>{d.proposed}</b></td><td>{editable && <button className="icon-btn" title="Remove this change" onClick={() => guard(() => edit(removeOp(rec, o.id)))}>✕</button>}</td></tr>
              ); })}
              {rec.ops.length === 0 && <tr><td colSpan={5} className="m">No changes yet.</td></tr>}
            </tbody>
          </table>

          {editable && (
            <div className="row mod-add mt">
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

          {dirty && (
            <div className="row mt" role="status">
              <span className="m">Unsaved edits to this draft — the working design is not affected.</span>
              <button className="chip primary" onClick={() => { save(buf!); setBuf(undefined); onStatus(`Saved ${rec.id}.`); }}>Save draft</button>
              <button className="chip" onClick={() => { setBuf(undefined); onStatus('Discarded the unsaved edits.'); }}>Cancel</button>
            </div>
          )}

          {(conflicts.length > 0 || conflict) && open && (
            <div className="mod-conflicts" role="alert">
              <b>Changed since this was proposed</b>
              <ul>{(conflict ?? conflicts).map((c) => <li key={c.op.id}>{c.op.targetId ?? 'Project'} — {c.op.label}: {c.kind === 'missing' ? 'the item no longer exists' : <>proposed against {pairText(c.op.before, c.current)[0]}, now {pairText(c.op.before, c.current)[1]}</>}</li>)}</ul>
              {rec.status !== 'accepted' && <button className="chip" onClick={() => { edit(reconcile(project, rec, me)); setConflict(null); }} title="Re-base the proposal on the values the design has now; recorded in its history">Reconcile on the current values</button>}
              {rec.status === 'accepted' && <>
                <button className="chip" onClick={() => apply('skip')} title="Apply the changes that still match; leave the edited values alone">Apply the rest, keep later edits</button>
                <button className="chip" onClick={() => { if (window.confirm('Overwrite the later edits with the proposed values?')) apply('overwrite'); }} title="Replace the values edited since with the proposed ones">Overwrite later edits…</button>
              </>}
            </div>
          )}

          <div className="row mt">
            {allowedNext(rec).map((s) => <button key={s} className={`chip${s === 'accepted' ? ' primary' : ''}`} onClick={() => step(s)}>{ACTION[s]}</button>)}
            {rec.status === 'accepted' && !rec.applied && conflicts.length === 0 && !dirty && <button className="chip primary" onClick={() => setReviewing(true)} title="Review exactly what will change, then apply it as one undo step">Apply to the working design…</button>}
            {rec.applied && <span className="ok">✓ {rec.applied.source === 'draft' ? 'Recorded from the working draft' : 'Applied'} {when(rec.applied.at)}{rec.applied.skipped?.length ? ` — ${rec.applied.skipped.length} skipped` : ''}{rec.applied.overwritten?.length ? ` — ${rec.applied.overwritten.length} overwritten on purpose` : ''}</span>}
            <button className="chip" disabled={dirty} onClick={() => { const r = followUp(project, rec, me); onChange(withRecord(project, r.record)); setSel(r.record.id); onStatus(`Started ${r.record.id} as a new draft following ${rec.id}${r.dropped ? ` — ${r.dropped} change${r.dropped === 1 ? '' : 's'} left out (item no longer exists)` : ''}.`); }} title="A new draft with the same intended changes, re-based on the working design. This record is not changed.">Duplicate as new draft</button>
            {rec.decision && <span className="m">Decision: {rec.decision.outcome}{rec.decision.by ? ` by ${rec.decision.by}` : ''}{rec.decision.note ? ` — ${rec.decision.note}` : ''}{rec.decision.evidenceRef ? ` · evidence: ${rec.decision.evidenceRef}` : ''}</span>}
          </div>

          {reviewing && rec.status === 'accepted' && !rec.applied && (
            <div className="mod-conflicts" role="dialog" aria-label="Confirm apply">
              <b>Apply {rec.id} to the working design</b>
              <p className="m">{rec.ops.length} change{rec.ops.length === 1 ? '' : 's'}, all or none, as one undo step. {conflicts.length ? <span className="bad">{conflicts.length} no longer match the design — it will not apply.</span> : 'Every current value matches what was proposed against; nothing else is touched.'} Issued revisions are not changed.</p>
              <table className="schedule"><thead><tr><th>Item</th><th>Current</th><th>Becomes</th><th>Status</th></tr></thead><tbody>
                {rec.ops.map((o) => { const v = opView(project, o); return <tr key={o.id}><td>{v.item}</td><td>{v.current}</td><td><b>{v.proposed}</b></td><td className={v.state === 'matches' ? 'ok' : 'bad'}>{v.state === 'matches' ? 'matches' : v.state === 'missing' ? 'item missing' : 'changed since'}</td></tr>; })}
              </tbody></table>
              <button className="chip primary" disabled={conflicts.length > 0} onClick={() => { setReviewing(false); apply('stop'); }}>Confirm and apply</button>
              <button className="chip" onClick={() => setReviewing(false)}>Cancel</button>
            </div>
          )}
          {followUpInfo && <p className={followUpInfo.studies === 'current' && !followUpInfo.designChangedSince ? 'ok' : 'warn'}>
            After applying: {followUpInfo.studies === 'current' ? 'studies have been run on the applied design and are current' : followUpInfo.studies === 'not run' ? 'the studies have not been run yet — run them and review the results' : 'the study results are out of date — run them again'}{followUpInfo.designChangedSince ? '; the design has changed again since' : ''}. Accepting or applying is not a statement that the results pass.
          </p>}

          {open && rec.ops.length > 0 && (
            <>
              <h4 style={{ marginTop: 10 }}>What applying it would touch</h4>
              <ImpactPanel impact={impactOfProposal(project, rec)} onGo={onGo} />
              <ProposalPreviewPanel project={project} rec={rec} onGo={onGo} />
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
