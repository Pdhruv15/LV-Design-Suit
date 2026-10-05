import { useState } from 'react';
import type { Project } from '../../types';
import type { MainView } from '../../views';
import { Page } from '../ui';
import {
  allowedNext, CATEGORY_LABEL, CommentError, moveComment, needsReReview, newComment, refState, reviewSummary, SEVERITY_LABEL, STATUS_LABEL, withComment,
  type CommentCategory, type CommentSeverity, type CommentStatus, type RefKind, type ReviewComment
} from '../../model/reviewComments';

const ACTION: Record<CommentStatus, string> = { open: 'Reopen', responded: 'Record response', 'awaiting-evidence': 'Request evidence', closed: 'Close (reviewer)', withdrawn: 'Withdraw…' };
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const FILTERS = ['active', 'all', 'closed', 'withdrawn'] as const;

/** Design review comments: raised against equipment or a sheet, answered by the designer, and closed only by the reviewer.
 * A closed comment is flagged when the engineering values it was about change afterwards. Names are typed text. */
export default function ReviewView({ project, me = "", onChange, onStatus, onGo }: { project: Project; me?: string; onChange: (p: Project) => void; onStatus: (m: string) => void; onGo?: (v: MainView) => void }) {
  const list = project.reviewComments ?? [];
  const sum = reviewSummary(project);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('active');
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState({ category: 'calculation' as CommentCategory, severity: 'major' as CommentSeverity, finding: '', criterion: '', requiredAction: '', assignedTo: '', sheet: '', kind: '' as RefKind | '', refId: '' });
  const [text, setText] = useState('');
  const guard = (fn: () => void) => { try { fn(); } catch (e) { onStatus(e instanceof CommentError || e instanceof Error ? e.message : String(e)); } };
  const shown = list.filter((c) => filter === 'all' || (filter === 'active' ? c.status !== 'closed' && c.status !== 'withdrawn' || needsReReview(project, c) : c.status === filter));
  const rec = list.find((c) => c.id === sel);
  const ids = f.kind === 'feeder' ? project.feeders.map((x) => x.id) : f.kind === 'board' ? project.boards.map((x) => x.id) : f.kind === 'sheet' ? (project.drawingSet?.sheets ?? []).map((s) => s.id) : [];

  const raise = () => guard(() => {
    const c = newComment(project, { category: f.category, severity: f.severity, finding: f.finding, criterion: f.criterion, requiredAction: f.requiredAction, assignedTo: f.assignedTo, sheet: f.sheet, raisedBy: me,
      revisionId: project.revisions?.[project.revisions.length - 1]?.id, ref: f.kind && f.refId ? { kind: f.kind, id: f.refId } : undefined });
    onChange(withComment(project, c)); setSel(c.id); setF({ ...f, finding: '', criterion: '', requiredAction: '', refId: '' }); onStatus(`Raised ${c.id}.`);
  });
  const move = (c: ReviewComment, to: CommentStatus) => guard(() => {
    const needNote = to === 'withdrawn' || (to === 'open' && (c.status === 'closed' || c.status === 'withdrawn'));
    const note = needNote ? window.prompt(to === 'withdrawn' ? 'Why is it withdrawn?' : 'Why is it reopened?') ?? '' : undefined;
    if (needNote && !note?.trim()) return;
    const by = to === 'closed' && !me.trim() ? window.prompt('Reviewer name (typed text; recorded with the decision)') ?? '' : me;
    onChange(withComment(project, moveComment(project, c, to, { by, note, response: to === 'responded' ? text : undefined, evidence: to === 'awaiting-evidence' ? text : undefined })));
    setText('');
  });

  return (
    <Page title="Design review" intro="Review comments raised against the design: each has what was found, the rule it is judged against, what is required, who answers, and the reviewer's decision. A response does not close a comment — only the reviewer does. These are people's comments, separate from the app's own calculation checks, and no approval is implied.">
      <p><b>{sum.open} open</b>{sum.critical ? <> · <span className="bad">{sum.critical} critical</span></> : null}{sum.major ? ` · ${sum.major} major` : ''}{sum.awaiting ? ` · ${sum.awaiting} awaiting evidence` : ''}{sum.reReview ? <> · <span className="bad">{sum.reReview} closed to re-review</span></> : null}{sum.stale ? ` · ${sum.stale} about deleted items` : ''}</p>
      <div className="card">
        <h4>Raise a comment</h4>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as CommentCategory })}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as CommentSeverity })}>{Object.entries(SEVERITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as RefKind | '', refId: '' })}><option value="">About: general</option><option value="feeder">A circuit</option><option value="board">A panel</option><option value="sheet">A sheet</option></select>
          {f.kind && <select value={f.refId} onChange={(e) => setF({ ...f, refId: e.target.value })}><option value="">Choose…</option>{ids.map((id) => <option key={id}>{id}</option>)}</select>}
          <input placeholder="Assigned to" value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })} style={{ width: 130 }} />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <input placeholder="Finding (required)" value={f.finding} onChange={(e) => setF({ ...f, finding: e.target.value })} style={{ flex: 2, minWidth: 220 }} />
          <input placeholder="Criterion / reference" value={f.criterion} onChange={(e) => setF({ ...f, criterion: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
          <input placeholder="Required action" value={f.requiredAction} onChange={(e) => setF({ ...f, requiredAction: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
          <button className="primary" onClick={raise}>Raise</button>
        </div>
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0' }}>{FILTERS.map((x) => <button key={x} className={filter === x ? 'primary' : ''} onClick={() => setFilter(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>
      {!shown.length ? <p className="m">No comments here.</p> : (
        <table className="tbl"><thead><tr><th>ID</th><th>Severity</th><th>Finding</th><th>About</th><th>Assigned</th><th>Status</th></tr></thead><tbody>
          {shown.map((c) => {
            const rs = refState(project, c), flag = needsReReview(project, c);
            return (
              <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: 'pointer', fontWeight: sel === c.id ? 600 : undefined }}>
                <td>{c.id}</td><td className={c.severity === 'critical' ? 'bad' : ''}>{SEVERITY_LABEL[c.severity]}</td><td>{c.finding}</td>
                <td>{c.ref ? `${c.ref.id}${rs === 'missing' ? ' (deleted)' : ''}` : '—'}</td><td>{c.assignedTo ?? '—'}</td>
                <td>{STATUS_LABEL[c.status]}{flag ? <span className="bad"> · re-review: {rs === 'missing' ? 'item deleted' : 'design changed since closed'}</span> : rs === 'changed' && c.status !== 'withdrawn' ? <span className="m"> · item changed since raised</span> : ''}</td>
              </tr>
            );
          })}
        </tbody></table>
      )}
      {rec && (
        <div className="mod-detail">
          <h4>{rec.id} · {CATEGORY_LABEL[rec.category]} · {SEVERITY_LABEL[rec.severity]}</h4>
          <p>{rec.finding}</p>
          <p className="m">{rec.criterion ? `Criterion: ${rec.criterion}. ` : ''}{rec.requiredAction ? `Required: ${rec.requiredAction}. ` : ''}{rec.revisionId ? `Raised on Rev ${rec.revisionId}. ` : ''}Raised {when(rec.createdAt)}{rec.raisedBy ? ` by ${rec.raisedBy}` : ''}.</p>
          {rec.response && <p><b>Response:</b> {rec.response}</p>}
          {rec.evidence && <p><b>Evidence:</b> {rec.evidence}</p>}
          {rec.ref?.kind === 'sheet' && onGo && <button onClick={() => onGo('drawings')}>Open drawings</button>}
          {rec.ref && rec.ref.kind !== 'sheet' && onGo && <button onClick={() => onGo('design')}>Open design</button>}
          {allowedNext(rec).some((s) => s === 'responded' || s === 'awaiting-evidence') && <textarea placeholder="Response or evidence note" value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', marginTop: 6 }} rows={2} />}
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>{allowedNext(rec).map((s) => <button key={s} onClick={() => move(rec, s)}>{ACTION[s]}</button>)}</div>
          <p className="m" style={{ marginTop: 8 }}>{rec.history.map((h) => `${STATUS_LABEL[h.status]} ${when(h.at)}${h.by ? ` by ${h.by}` : ''}${h.note ? ` (${h.note})` : ''}`).join(' → ')}</p>
        </div>
      )}
    </Page>
  );
}
