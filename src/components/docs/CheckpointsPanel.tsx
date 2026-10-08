import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../types';
import { idbStore, MAX_CHECKPOINTS, newCheckpoint, restoredFrom, saveCheckpoint, type Checkpoint, type CheckpointStore } from '../../model/checkpoints';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Named safety copies of the working design. Not revisions: nothing issued is changed by creating or restoring one. */
export default function CheckpointsPanel({ project, onRestore, onStatus, store: given }: { project: Project; onRestore: (p: Project) => void; onStatus: (m: string) => void; store?: CheckpointStore }) {
  const store = useMemo(() => given ?? idbStore(), [given]);
  const [list, setList] = useState<Checkpoint[]>([]);
  const projectId = project.id;
  const refresh = useCallback(async () => { if (store && projectId) setList((await store.list(projectId)).sort((a, b) => b.at.localeCompare(a.at))); }, [store, projectId]);
  // The parent's status callback may change every render; the list is read again only for another project or store.
  const status = useRef(onStatus);
  status.current = onStatus;
  useEffect(() => { refresh().catch((e) => status.current(`Could not read checkpoints: ${e instanceof Error ? e.message : String(e)}`)); }, [refresh]);
  if (!store) return <p className="m">Checkpoints need browser storage, which is not available here.</p>;
  const fail = (what: string) => (e: unknown) => onStatus(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);

  async function create() {
    const label = window.prompt('Name this checkpoint, e.g. Before client comments', '');
    if (label === null) return;
    try { setList(await saveCheckpoint(store!, newCheckpoint(project, label))); onStatus(`Checkpoint saved (keeps the latest ${MAX_CHECKPOINTS}).`); } catch (e) { fail('Checkpoint')(e); }
  }
  async function restore(c: Checkpoint) {
    if (!window.confirm(`Restore “${c.label}” (${when(c.at)})? The design goes back to that point as an edit you can undo. Issued revisions are not changed. A checkpoint of the current state is saved first.`)) return;
    try {
      setList(await saveCheckpoint(store!, newCheckpoint(project, `Before restoring “${c.label}”`, { auto: true })));
      onRestore(restoredFrom(project, c)); onStatus(`Restored “${c.label}”. Undo (Ctrl+Z) goes back; save the project to keep it.`);
    } catch (e) { fail('Restore')(e); }
  }
  async function del(c: Checkpoint) {
    if (!window.confirm(`Delete checkpoint “${c.label}”?`)) return;
    try { await store!.remove(c.id); await refresh(); } catch (e) { fail('Delete')(e); }
  }

  return (
    <div className="card tool-panel" style={{ marginTop: 14 }}>
      <h4>Checkpoints</h4>
      <p className="m">Private safety copies of the working design on this computer, not issued revisions. The latest {MAX_CHECKPOINTS} are kept (copies the app makes before a restore go first). They are not part of the project file or its backup.</p>
      <button className="primary" disabled={!project.id} onClick={create}>Create checkpoint…</button>
      {!list.length ? <p className="m">None yet.</p> : (
        <table className="tbl"><tbody>{list.map((c) => (
          <tr key={c.id}><td>{when(c.at)}</td><td>{c.label}{c.auto ? <span className="m"> · automatic</span> : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}><button onClick={() => restore(c)}>Restore…</button> <button onClick={() => del(c)}>Delete</button></td></tr>
        ))}</tbody></table>
      )}
    </div>
  );
}
