import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { boardDemandKw } from '../../calc/electrical';
import { isScheduleCircuit } from '../../calc/loadSchedule';
import { currentRevision, diffProjects, issueRevision, nextRevisionId, restoreRevision, snapshotOf, type Change, type Snapshot } from '../../model/revisions';
import { saveCsv } from '../../util/files';
import { Page } from '../ui';

const CURRENT = 'current';
const KIND: Record<Change['kind'], string> = { added: 'Added', removed: 'Removed', changed: 'Changed' };

const demandOf = (s: Snapshot) => s.boards.filter((b) => !b.upstreamId).reduce((sum, b) => sum + boardDemandKw(s as Project, b.id), 0);

/** Issue revisions (A, B, C…), see what changed since any of them, and go
 * back to one. Revisions are saved inside the project file. */
export default function RevisionsView({ project, me = '', onChange, onStatus }: { project: Project; /** The user's initials (profile), the default "by". */ me?: string; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const revisions = project.revisions ?? [];
  const latest = currentRevision(project);
  const [description, setDescription] = useState('');
  const [by, setBy] = useState(me);
  const [from, setFrom] = useState<string>(latest?.id ?? '');
  const [to, setTo] = useState<string>(CURRENT);
  const fromId = revisions.some((r) => r.id === from) ? from : latest?.id ?? '';

  const snap = (id: string): Snapshot | undefined => (id === CURRENT ? snapshotOf(project) : revisions.find((r) => r.id === id)?.snapshot);
  const diff = useMemo(() => {
    const a = snap(fromId);
    const b = snap(to);
    return a && b ? diffProjects(a, b) : undefined;
  }, [project, fromId, to]);
  const sinceLatest = useMemo(() => (latest ? diffProjects(latest.snapshot, project).changes.length : 0), [project, latest]);

  const groups = useMemo(() => {
    const out = new Map<string, Change[]>();
    for (const c of diff?.changes ?? []) {
      const k = c.boardId ?? 'Project';
      out.set(k, [...(out.get(k) ?? []), c]);
    }
    return [...out.entries()];
  }, [diff]);
  const count = (k: Change['kind']) => diff?.changes.filter((c) => c.kind === k).length ?? 0;
  const label = (id: string) => (id === CURRENT ? 'current design' : `Rev ${id}`);

  function issue() {
    if (!description.trim()) {
      onStatus('Enter a description for the revision (e.g. "Issued for DEWA approval")');
      return;
    }
    const next = issueRevision(project, { description, by });
    onChange(next);
    setDescription('');
    setFrom(currentRevision(next)!.id);
    setTo(CURRENT);
    onStatus(`Issued Rev ${currentRevision(next)!.id} — save the project to keep it`);
  }

  async function exportChanges() {
    if (!diff) return;
    const rows = diff.changes.flatMap((c) =>
      c.fields.length ? c.fields.map((f) => [c.boardId ?? '', KIND[c.kind], c.label, f.field, f.from, f.to]) : [[c.boardId ?? '', KIND[c.kind], c.label, '', '', '']]
    );
    const m = await saveCsv(`${project.name} changes ${label(fromId)} to ${label(to)}`, ['Board', 'Change', 'Item', 'Field', 'From', 'To'], rows);
    if (m) onStatus(m);
  }

  return (
    <Page
      title="Revisions"
      intro="Issue a revision each time the design is submitted (Rev A, B, C…). The app keeps a copy of the design as it was, so you can see exactly what changed since — for DEWA resubmissions and transmittals — or go back to it. Revisions are saved inside the project file."
    >
      <div className="rev-issue">
        <b>Issue Rev {nextRevisionId(project)}</b>
        <input value={description} placeholder="Description, e.g. Issued for DEWA approval" onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && issue()} />
        <input value={by} placeholder="By (initials)" className="rev-by" onChange={(e) => setBy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && issue()} />
        <button className="chip primary" onClick={issue}>Issue revision</button>
        <span className="m">
          {latest ? (sinceLatest ? `${sinceLatest} change${sinceLatest === 1 ? '' : 's'} since Rev ${latest.id}` : `No changes since Rev ${latest.id}`) : 'No revision issued yet'}
        </span>
      </div>

      {revisions.length > 0 && (
        <table className="schedule rev-table">
          <thead>
            <tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th><th>Circuits</th><th>Max. demand (kW)</th><th /></tr>
          </thead>
          <tbody>
            {[...revisions].reverse().map((r) => (
              <tr key={r.id}>
                <td><b>{r.id}</b></td>
                <td>{r.date}</td>
                <td>{r.description}</td>
                <td>{r.by ?? ''}</td>
                <td>{r.snapshot.feeders.filter(isScheduleCircuit).length}</td>
                <td>{demandOf(r.snapshot).toFixed(1)}</td>
                <td className="rev-actions">
                  <button className="chip" onClick={() => { setFrom(r.id); setTo(CURRENT); }}>Compare with current</button>
                  <button className="chip" onClick={() => {
                    if (!window.confirm(`Replace the current design with Rev ${r.id}? Changes since the latest revision are lost unless you issue a revision first.`)) return;
                    onChange(restoreRevision(project, r.id));
                    onStatus(`Restored Rev ${r.id} — save the project to keep it`);
                  }}>Restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revisions.length > 0 && diff && (
        <section className="rev-diff">
          <div className="rev-diff-head">
            <span>Compare</span>
            <select className="chip" value={fromId} onChange={(e) => setFrom(e.target.value)} aria-label="From">
              {revisions.map((r) => <option key={r.id} value={r.id}>Rev {r.id}</option>)}
            </select>
            <span>→</span>
            <select className="chip" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
              <option value={CURRENT}>Current design</option>
              {revisions.map((r) => <option key={r.id} value={r.id}>Rev {r.id}</option>)}
            </select>
            <span className="m">
              <b className="ok">{count('added')} added</b> · <b className="bad">{count('removed')} removed</b> · <b className="warn">{count('changed')} changed</b>
            </span>
            <button className="chip" disabled={!diff.changes.length} onClick={exportChanges}>Export changes (CSV)</button>
          </div>

          {diff.changes.length === 0 ? (
            <p className="m">No differences between {label(fromId)} and {label(to)}.</p>
          ) : (
            <>
              <table className="schedule rev-kw">
                <thead><tr><th>Board</th><th>Demand {label(fromId)} (kW)</th><th>Demand {label(to)} (kW)</th><th>Change</th></tr></thead>
                <tbody>
                  {diff.boardKw.filter((b) => Math.abs(b.to - b.from) > 1e-6).map((b) => (
                    <tr key={b.boardId}>
                      <td>{b.boardId}</td><td>{b.from.toFixed(2)}</td><td>{b.to.toFixed(2)}</td>
                      <td className={b.to > b.from ? 'warn' : 'ok'}>{b.to > b.from ? '+' : ''}{(b.to - b.from).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {groups.map(([board, cs]) => (
                <div key={board} className="rev-group">
                  <h4>{board}</h4>
                  <ul>
                    {cs.map((c) => (
                      <li key={`${c.kind}-${c.id}`}>
                        <span className={`rev-kind ${c.kind}`}>{KIND[c.kind]}</span> <b>{c.label}</b>
                        {c.fields.length > 0 && (
                          <span className="rev-fields">
                            {c.fields.map((f) => <span key={f.field}>{f.field}: <s>{f.from}</s> → {f.to}</span>)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </Page>
  );
}
