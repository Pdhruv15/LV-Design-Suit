import { ask } from '../ConfirmDialog';
import { useEffect, useState } from 'react';
import type { Project } from '../../types';
import {
  DEFAULT_DAYS, deleteSubmission, dueOf, isOpen, isOverdue, nextSubmissionId, PURPOSES, RECIPIENTS, recipientGroup, responseDays, resubmit, saveSubmission,
  submissionCounts, submissionsOf, SUB_KINDS, SUB_STATUS, timeText, type SubComment, type SubDoc, type SubKind, type Submission, type SubStatus
} from '../../model/submissions';
import { buildSubmissionRegisterHtml, buildSubmissionWorkbook, buildTransmittalHtml } from '../../docs/submissionReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { Page } from '../ui';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const today = () => new Date().toISOString().slice(0, 10);

/** Reports → Submissions: every document sent out — BOQ, drawings, reports, variations — with its
 * recipient, due date, response and comments; the register, transmittals and comments log. */
export default function SubmissionsView({ project, draft, me = '', onChange, onStatus }: { project: Project; /** A submission to start with (after an export). */ draft?: Submission; me?: string; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const [editing, setEditing] = useState<Submission | null>(draft ?? null);
  const [days, setDays] = useState(false);
  useEffect(() => { if (draft) setEditing(draft); }, [draft]);
  const now = today();
  const all = submissionsOf(project);
  const c = submissionCounts(project, now);
  const stored = new Set((project.submissions ?? []).map((s) => s.id));
  const base = safeFileName(project.name);

  async function registerPdf() {
    try { const m = await savePdf(`${base} - Submission register.pdf`, buildSubmissionRegisterHtml(project, now), { pageSize: 'A4', cssPages: true, selfNumbered: true }); if (m) onStatus(m); }
    catch (e) { onStatus(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function transmittal(s: Submission) {
    try { const m = await savePdf(`${base} - Transmittal ${s.id}.pdf`, buildTransmittalHtml(project, s), { pageSize: 'A4', cssPages: true, selfNumbered: true }); if (m) onStatus(m); }
    catch (e) { onStatus(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function excel() {
    const m = await saveBinary(`${base} - Submission register.xlsx`, await workbookBytes(buildSubmissionWorkbook(project, now)), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  }

  if (editing) return (
    <Page title={`Submission ${editing.id}`} intro="The documents sent, to whom and why, and — when it comes — the response and its comments.">
      <SubEditor key={editing.id} s={editing} project={project} me={me} isNew={!stored.has(editing.id)}
        onSave={(s) => { onChange(saveSubmission(project, s)); setEditing(null); onStatus(`${s.id} saved`); }}
        onDelete={() => { onChange(deleteSubmission(project, editing.id)); setEditing(null); onStatus(`${editing.id} deleted`); }}
        onClose={() => setEditing(null)} />
    </Page>
  );

  const strip: [string, number, boolean?][] = [['Submissions', c.total], ['Awaiting response', c.open], ['Overdue', c.overdue, c.overdue > 0], ['Approved', c.approved], ['Approved with comments', c.withComments], ['Revise and resubmit', c.resubmit, c.resubmit > 0], ['Rejected', c.rejected], ['Open comments', c.openComments, c.openComments > 0]];
  return (
    <Page title="Submissions" intro="Every document sent out for approval, review, tender or information, with its response. Drawing transmittals appear here by themselves; after a BOQ, variation or report PDF the app offers to record it.">
      <div className="tool-panel">
        <div className="sub-strip">{strip.map(([k, v, warn]) => <div key={k} className={warn ? 'warn' : undefined}><b>{v}</b><span>{k}</span></div>)}</div>
        <div className="row" style={{ gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
          <button className="chip" onClick={() => setEditing({ id: nextSubmissionId(project), kind: 'Other', title: '', docs: [], to: '', purpose: 'For approval', date: now, status: 'submitted', comments: [], sentBy: me || undefined })}>+ Submission</button>
          <button className="chip" onClick={() => setDays(!days)} aria-expanded={days}>Response times…</button>
          <span className="sp" />
          <button className="chip" onClick={excel}>Excel</button>
          <button className="chip primary" onClick={registerPdf}>Register PDF</button>
        </div>
        {days && <ResponseDays project={project} onChange={onChange} />}
        {!all.length ? <p className="m">No submissions yet. Record each document you send — for approval, review, tender or information — and the response when it comes.</p> : (
          <div className="tw">
            <table className="bom-table">
              <thead><tr><th>Ref.</th><th>Type</th><th>Title / documents</th><th>To</th><th>Purpose</th><th>Submitted</th><th>Due</th><th>Status / response</th><th>Time</th><th /></tr></thead>
              <tbody>{all.map((s) => {
                const late = isOverdue(project, s, now);
                const open = s.comments.filter((x) => !x.closed).length;
                return (
                  <tr key={s.id} className={late ? 'sub-late' : undefined}>
                    <td><b>{s.id}</b></td>
                    <td>{s.kind}</td>
                    <td>{s.title}{s.resubmissionOf && <span className="bom-tag">resubmits {s.resubmissionOf}</span>}{s.resubmittedAs && <span className="bom-tag">resubmitted as {s.resubmittedAs}</span>}{open > 0 && <span className="bom-tag warn">{open} open comment{open > 1 ? 's' : ''}</span>}
                      {s.docs.length > 0 && <div className="m">{s.docs.slice(0, 3).map((d) => `${d.number}${d.rev ? ` rev ${d.rev}` : ''}`).join(', ')}{s.docs.length > 3 ? ` +${s.docs.length - 3}` : ''}</div>}</td>
                    <td>{s.to}</td>
                    <td>{s.purpose}</td>
                    <td>{s.date}</td>
                    <td>{dueOf(project, s) ?? '—'}</td>
                    <td>{SUB_STATUS[s.status]}{s.responseDate && <div className="m">{s.responseDate}{s.responseRef ? ` · ${s.responseRef}` : ''}</div>}</td>
                    <td className={late ? 'warn' : undefined} style={{ whiteSpace: 'nowrap' }}>{timeText(project, s, now)}</td>
                    <td className="acts">
                      <button className="icon-btn" title={stored.has(s.id) ? 'Edit, record the response' : 'Record the response to this transmittal'} onClick={() => setEditing(s)}>✎</button>
                      <button className="icon-btn" title="Transmittal sheet (PDF)" onClick={() => transmittal(s)}>⎙</button>
                      {!s.resubmittedAs && (s.status === 'resubmit' || s.status === 'rejected' || isOpen(s)) && <button className="icon-btn" title="Resubmit: a new submission of the same documents, linked to this one"
                        onClick={() => { const r = resubmit(project, s, now); onChange(r.project); setEditing(r.next); onStatus(`${r.next.id} started as the resubmission of ${s.id} — update the revisions`); }}>↻</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </Page>
  );
}

function ResponseDays({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  return (
    <div className="card">
      <p className="m">Days a recipient has to respond, used when a submission has no due date of its own. Authorities (DEWA, ADDC…) are recognised by name.</p>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {Object.keys(DEFAULT_DAYS).map((k) => (
          <label key={k} className="row" style={{ gap: 6 }}>{k}
            <input className="bi-text" style={{ width: 54 }} inputMode="numeric" defaultValue={project.submissionDays?.[k] ?? DEFAULT_DAYS[k]}
              onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (!Number.isFinite(n) || n < 0) return; const d = { ...project.submissionDays, [k]: n }; if (n === DEFAULT_DAYS[k]) delete d[k]; onChange({ ...project, submissionDays: Object.keys(d).length ? d : undefined }); }} /> d
          </label>
        ))}
      </div>
    </div>
  );
}

function SubEditor({ s: start, project, me, isNew, onSave, onDelete, onClose }: { s: Submission; project: Project; me: string; isNew: boolean; onSave: (s: Submission) => void; onDelete: () => void; onClose: () => void }) {
  const [s, setS] = useState<Submission>({ ...start, sentBy: start.sentBy ?? (me || undefined) });
  const set = (patch: Partial<Submission>) => setS({ ...s, ...patch });
  const setDoc = (i: number, patch: Partial<SubDoc>) => set({ docs: s.docs.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
  const setComment = (id: string, patch: Partial<SubComment>) => set({ comments: s.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const answered = !isOpen(s) && s.status !== 'info' && s.status !== 'superseded';
  const changeStatus = (st: SubStatus) => setS({ ...s, status: st, responseDate: (st === 'approved' || st === 'approved-comments' || st === 'resubmit' || st === 'rejected') ? s.responseDate ?? today() : s.responseDate });
  const defaultDue = s.date && s.purpose !== 'For information' ? `${responseDays(project, s.to)} d (${recipientGroup(s.to || 'Other')})` : '';
  const ok = !!s.title.trim() && !!s.to.trim() && !!s.date && s.docs.every((d) => d.number.trim());
  return (
    <div className="tool-panel">
      <div className="form-kv">
        <label>Type <select className="chip" value={s.kind} onChange={(e) => set({ kind: e.target.value as SubKind })}>{SUB_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label>Title <input className="bi-text" autoFocus value={s.title} placeholder="e.g. Bill of quantities — addendum 1" onChange={(e) => set({ title: e.target.value })} /></label>
        <label>Submitted to <input className="bi-text" list="sub-to" value={s.to} placeholder="Client, Consultant, Authority (DEWA)…" onChange={(e) => set({ to: e.target.value })} /></label>
        <label>Attention <input className="bi-text" value={s.attention ?? ''} onChange={(e) => set({ attention: e.target.value || undefined })} /></label>
        <label>Address / department <input className="bi-text" value={s.address ?? ''} onChange={(e) => set({ address: e.target.value || undefined })} /></label>
        <label>Purpose <select className="chip" value={s.purpose} onChange={(e) => set({ purpose: e.target.value, status: e.target.value === 'For information' ? 'info' : s.status === 'info' ? 'submitted' : s.status })}>{[...new Set([...PURPOSES, s.purpose])].map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Submitted on <input className="bi-text" type="date" value={s.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label>Response due <input className="bi-text" type="date" value={s.due ?? ''} title={defaultDue ? `Empty: ${defaultDue} after submission` : undefined} onChange={(e) => set({ due: e.target.value || undefined })} /></label>
        <label>Your reference <input className="bi-text" value={s.yourRef ?? ''} placeholder="Their letter or comment sheet this answers" onChange={(e) => set({ yourRef: e.target.value || undefined })} /></label>
        <label>Sent by <input className="bi-text" value={s.sentBy ?? ''} onChange={(e) => set({ sentBy: e.target.value || undefined })} /></label>
        <label>Remarks <input className="bi-text" value={s.remarks ?? ''} onChange={(e) => set({ remarks: e.target.value || undefined })} /></label>
      </div>
      <datalist id="sub-to">{RECIPIENTS.map((r) => <option key={r} value={r} />)}</datalist>
      {!s.due && defaultDue && <p className="m">Response due: empty uses {defaultDue} after the submission date ({dueOf(project, s)}).</p>}

      <h4>Documents</h4>
      <table className="bom-table">
        <thead><tr><th>Document no.</th><th>Title</th><th>Rev</th><th>Format</th><th>Copies</th><th /></tr></thead>
        <tbody>{s.docs.map((d, i) => (
          <tr key={i}>
            <td><input className="bi-text" value={d.number} onChange={(e) => setDoc(i, { number: e.target.value })} /></td>
            <td><input className="bi-text" style={{ width: '100%' }} value={d.title} onChange={(e) => setDoc(i, { title: e.target.value })} /></td>
            <td><input className="bi-text" style={{ width: 50 }} value={d.rev} onChange={(e) => setDoc(i, { rev: e.target.value })} /></td>
            <td><input className="bi-text" style={{ width: 80 }} value={d.format ?? ''} placeholder="PDF" onChange={(e) => setDoc(i, { format: e.target.value || undefined })} /></td>
            <td><input className="bi-text" style={{ width: 44 }} inputMode="numeric" value={d.copies ?? ''} placeholder="1" onChange={(e) => { const n = Number(e.target.value); setDoc(i, { copies: e.target.value && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined }); }} /></td>
            <td className="acts"><button className="icon-btn" title="Remove" onClick={() => set({ docs: s.docs.filter((_, k) => k !== i) })}>✕</button></td>
          </tr>
        ))}</tbody>
      </table>
      <button className="chip" style={{ margin: '6px 0 12px' }} onClick={() => set({ docs: [...s.docs, { number: '', title: '', rev: '' }] })}>+ Document</button>

      <h4>Response</h4>
      <div className="form-kv">
        <label>Status <select className="chip" value={s.status} onChange={(e) => changeStatus(e.target.value as SubStatus)}>{(Object.keys(SUB_STATUS) as SubStatus[]).map((k) => <option key={k} value={k}>{SUB_STATUS[k]}</option>)}</select></label>
        {answered && <>
          <label>Response date <input className="bi-text" type="date" value={s.responseDate ?? ''} onChange={(e) => set({ responseDate: e.target.value || undefined })} /></label>
          <label>Response reference <input className="bi-text" value={s.responseRef ?? ''} placeholder="Letter, stamp or comment sheet" onChange={(e) => set({ responseRef: e.target.value || undefined })} /></label>
        </>}
      </div>
      <h4>Comments <span className="m">({s.comments.filter((c) => !c.closed).length} open)</span></h4>
      {s.comments.map((c, i) => (
        <div key={c.id} className="row sub-comment" style={{ gap: 6, alignItems: 'flex-start', marginBottom: 6 }}>
          <span className="m" style={{ minWidth: 18 }}>{i + 1}</span>
          <input className="bi-text" style={{ width: 110 }} value={c.from ?? ''} placeholder={s.to || 'From'} onChange={(e) => setComment(c.id, { from: e.target.value || undefined })} />
          <input className="bi-text" style={{ flex: 2 }} value={c.text} placeholder="Comment received" onChange={(e) => setComment(c.id, { text: e.target.value })} />
          <input className="bi-text" style={{ flex: 2 }} value={c.action ?? ''} placeholder="Action taken / response" onChange={(e) => setComment(c.id, { action: e.target.value || undefined })} />
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!c.closed} onChange={(e) => setComment(c.id, { closed: e.target.checked ? today() : undefined })} /> closed</label>
          <button className="icon-btn" title="Remove" onClick={() => set({ comments: s.comments.filter((x) => x.id !== c.id) })}>✕</button>
        </div>
      ))}
      <button className="chip" onClick={() => set({ comments: [...s.comments, { id: String(Math.max(0, ...s.comments.map((x) => Number(x.id) || 0)) + 1), text: '' }] })}>+ Comment</button>

      <div className="modal-actions" style={{ marginTop: 12 }}>
        {!isNew && <button className="chip" onClick={async () => { if (await ask(`Delete ${s.id}?`)) onDelete(); }}>Delete</button>}
        <span className="sp" />
        <button className="chip" onClick={onClose}>Cancel</button>
        <button className="chip primary" disabled={!ok} onClick={() => onSave({ ...s, title: s.title.trim(), to: s.to.trim(), comments: s.comments.filter((c) => c.text.trim()) })}>Save</button>
      </div>
    </div>
  );
}
