import { useState } from 'react';
import type { Project } from '../../types';
import { Page } from '../ui';
import { addDoc, baselineDoc, DISCIPLINE_LABEL, docIssues, DocError, docsOf, isSuperseded, removeDoc, setBaselineDoc, updateDoc, type DocDiscipline } from '../../model/receivedDocs';

/** Register of documents received from others. It records number, revision and where the file is; it does not read the
 * file or turn it into design data, and marking a baseline records provenance, not approval. */
export default function ReceivedDocsView({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const docs = docsOf(project);
  const base = baselineDoc(project);
  const [showOld, setShowOld] = useState(false);
  const [f, setF] = useState({ title: '', number: '', revision: '', dateReceived: new Date().toISOString().slice(0, 10), originator: '', purpose: '', discipline: 'electrical' as DocDiscipline, link: '' });
  const guard = (fn: () => void) => { try { fn(); } catch (e) { onStatus(e instanceof DocError ? e.message : e instanceof Error ? e.message : String(e)); } };
  const shown = docs.filter((d) => showOld || !isSuperseded(d));

  const add = () => guard(() => {
    const r = addDoc(project, { ...f, use: 'reference' });
    onChange(r.project); setF({ ...f, title: '', number: '', revision: '', link: '' }); onStatus(`Registered ${r.doc.id}: ${r.doc.number} rev ${r.doc.revision}.`);
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Page title="Received documents" intro="Documents received from others — drawings, specifications, datasheets, authority comments — with their number and revision. This records what you were given and where it is kept; the app does not read these files or treat them as the electrical design. Choosing a baseline records where your work started from, not that it is approved.">
      {docIssues(project).map((m, i) => <p key={i} className="warn">⚠ {m}</p>)}
      {base && <p><b>Baseline:</b> {base.title} · {base.number} rev {base.revision}</p>}
      <div className="card">
        <h4>Register a document</h4>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Title (required)" value={f.title} onChange={set('title')} style={{ flex: 2, minWidth: 180 }} />
          <input placeholder="Number (required)" value={f.number} onChange={set('number')} style={{ width: 130 }} />
          <input placeholder="Rev (required)" value={f.revision} onChange={set('revision')} style={{ width: 70 }} />
          <input type="date" value={f.dateReceived} onChange={set('dateReceived')} />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <input placeholder="Originator" value={f.originator} onChange={set('originator')} style={{ width: 150 }} />
          <input placeholder="Purpose (e.g. for tender)" value={f.purpose} onChange={set('purpose')} style={{ width: 170 }} />
          <select value={f.discipline} onChange={set('discipline')}>{Object.entries(DISCIPLINE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input placeholder="Link or file path (optional)" value={f.link} onChange={set('link')} style={{ flex: 1, minWidth: 200 }} />
          <button className="primary" onClick={add}>Register</button>
        </div>
        <p className="m">The link is only a note of where the file is kept; it is not checked and is not part of a project backup.</p>
      </div>
      <p className="m" style={{ marginTop: 10 }}>{docs.length} registered · <label><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> show superseded</label></p>
      {!shown.length ? <p className="m">Nothing registered yet.</p> : (
        <table className="tbl"><thead><tr><th>ID</th><th>Title</th><th>Number</th><th>Rev</th><th>Received</th><th>Originator</th><th>Discipline</th><th>Use</th><th>Link</th><th></th></tr></thead><tbody>
          {shown.map((d) => (
            <tr key={d.id} className={isSuperseded(d) ? 'm' : ''}>
              <td>{d.id}</td><td>{d.title}{d.purpose ? <span className="m"> · {d.purpose}</span> : ''}</td><td>{d.number}</td><td>{d.revision}{isSuperseded(d) ? ` (superseded by ${d.supersededBy})` : ''}</td>
              <td>{d.dateReceived ?? '—'}</td><td>{d.originator ?? '—'}</td><td>{DISCIPLINE_LABEL[d.discipline]}</td>
              <td>{d.use === 'baseline' ? <b>Baseline</b> : 'Reference only'}</td><td>{d.link ?? '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {!isSuperseded(d) && (d.use === 'baseline' ? <button onClick={() => guard(() => onChange(setBaselineDoc(project, undefined)))}>Not baseline</button> : <button onClick={() => guard(() => onChange(setBaselineDoc(project, d.id)))}>Use as baseline</button>)}
                <button onClick={() => { const l = window.prompt('Link or file path', d.link ?? ''); if (l !== null) guard(() => onChange(updateDoc(project, d.id, { link: l.trim() || undefined }))); }}>Link…</button>
                <button onClick={() => { if (window.confirm(`Remove ${d.id} from the register? The file itself is not touched.`)) guard(() => onChange(removeDoc(project, d.id))); }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
    </Page>
  );
}
