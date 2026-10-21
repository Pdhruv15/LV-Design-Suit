import { copyProject } from '../../model/projectMigrate';
import { BACKUP_EXT, buildBackup, checkpointsFor, readBackup } from '../../model/projectBackup';
import { safeFileName, saveBinary } from '../../util/files';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../types';
import { autoCheckpoint, CHECKPOINTS_CHANGED, idbStore, MAX_AUTO_CHECKPOINTS, newCheckpoint, restoredFrom, saveCheckpoint, type Checkpoint, type CheckpointStore } from '../../model/checkpoints';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Named safety copies of the working design. Not revisions: nothing issued is changed by creating or restoring one. */
export default function CheckpointsPanel({ project, onRestore, onOpenCopy, onStatus, store: given }: {
  project: Project;
  onRestore: (p: Project) => void;
  /** Opens a project as a new, unsaved project (a backup opened as a copy). */
  onOpenCopy?: (p: Project, message: string) => void;
  onStatus: (m: string) => void;
  store?: CheckpointStore;
}) {
  const store = useMemo(() => given ?? idbStore(), [given]);
  const [list, setList] = useState<Checkpoint[]>([]);
  const projectId = project.id;
  const refresh = useCallback(async () => { if (store && projectId) setList((await store.list(projectId)).sort((a, b) => b.at.localeCompare(a.at))); }, [store, projectId]);
  // The parent's status callback may change every render; the list is read again only for another project or store.
  const status = useRef(onStatus);
  status.current = onStatus;
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { refresh().catch((e) => status.current(`Could not read checkpoints: ${e instanceof Error ? e.message : String(e)}`)); }, [refresh]);
  useEffect(() => {
    const changed = (e: Event) => { if ((e as CustomEvent<string>).detail === projectId) void refresh(); };
    window.addEventListener(CHECKPOINTS_CHANGED, changed);
    return () => window.removeEventListener(CHECKPOINTS_CHANGED, changed);
  }, [refresh, projectId]);
  if (!store) return <p className="m">Checkpoints need browser storage, which is not available here.</p>;
  const fail = (what: string) => (e: unknown) => onStatus(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);

  async function create() {
    const label = window.prompt('Name this checkpoint, e.g. Before client comments', '');
    if (label === null) return;
    try { setList(await saveCheckpoint(store!, newCheckpoint(project, label))); onStatus('Checkpoint saved — checkpoints you name are kept until you delete them.'); } catch (e) { fail('Checkpoint')(e); }
  }
  async function restore(c: Checkpoint) {
    if (!window.confirm(`Restore “${c.label}” (${when(c.at)})? The design goes back to that point as an edit you can undo. Issued revisions are not changed. A checkpoint of the current state is saved first.`)) return;
    try {
      setList(await saveCheckpoint(store!, newCheckpoint(project, `Before restoring “${c.label}”`, { auto: true })));
      onRestore(restoredFrom(project, c)); onStatus(`Restored “${c.label}”. Undo (Ctrl+Z) goes back; save the project to keep it.`);
    } catch (e) { fail('Restore')(e); }
  }
  async function exportBackup() {
    try {
      const all = store && projectId ? await store.list(projectId) : [];
      const bytes = await buildBackup(project, all, __APP_VERSION__);
      const where = await saveBinary(`${safeFileName(project.name)}.${BACKUP_EXT}`, bytes, 'LV Design Studio backup', BACKUP_EXT, 'application/zip');
      if (where !== null) onStatus(`Backup exported with ${all.length} checkpoint${all.length === 1 ? '' : 's'} — the project as it is now (save it first if you want the file to match)`);
    } catch (e) { fail('Export backup')(e); }
  }
  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const b = await readBackup(new Uint8Array(await file.arrayBuffer()));
      const made = new Date(b.manifest.exportedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      if (!window.confirm(`Import the backup of “${b.project.name}”?\n\nMade ${made} with LV Design Studio ${b.manifest.appVersion}, with ${b.checkpoints.length} checkpoint${b.checkpoints.length === 1 ? '' : 's'}. Every file in it passed its check.`)) return;
      const same = !!project.id && b.project.id === project.id;
      const replace = same && window.confirm('This backup is of the open project. Replace the open project with it?\n\nOK: replace it — the open design is kept as a checkpoint first, and the backup’s checkpoints are added.\nCancel: open the backup as a new project instead.');
      if (replace) {
        await autoCheckpoint(project, 'Before importing a backup', store, onStatus);
        const known = new Set((await store!.list(project.id!)).map((c) => c.id));
        for (const c of b.checkpoints) if (!known.has(c.id)) await store!.put(c);
        onRestore({ ...b.project, id: project.id, createdAt: project.createdAt ?? b.project.createdAt });
        await refresh();
        onStatus(`Backup of ${b.project.name} imported into the open project — save it to keep it`);
      } else {
        if (!onOpenCopy) { onStatus('Open the backup from the project it belongs to.'); return; }
        const copy = copyProject(b.project, 'save-as', b.project.name);
        for (const c of checkpointsFor(b.checkpoints, copy.id!)) await store?.put(c);
        onOpenCopy(copy, `Opened the backup of ${b.project.name} as a new project, with its ${b.checkpoints.length} checkpoint${b.checkpoints.length === 1 ? '' : 's'} — Save keeps it in the projects folder`);
      }
    } catch (e) { fail('Import backup')(e); }
  }

  async function del(c: Checkpoint) {
    if (!window.confirm(`Delete checkpoint “${c.label}”?`)) return;
    try { await store!.remove(c.id); await refresh(); } catch (e) { fail('Delete')(e); }
  }

  return (
    <div className="card tool-panel" style={{ marginTop: 14 }}>
      <h4>Checkpoints</h4>
      <p className="m">
        Private safety copies of the working design on this computer, not issued revisions. The app also takes one by itself before
        a big change — issuing, restoring a revision, a CAD pull, overwriting after a save conflict, importing a backup — and keeps the
        latest {MAX_AUTO_CHECKPOINTS} of those; checkpoints you name are kept until you delete them. To move a project with its checkpoints to
        another computer, or keep a copy elsewhere, export a backup.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" disabled={!project.id} onClick={create}>Create checkpoint…</button>
        <button disabled={!project.id} onClick={exportBackup} title="One .lvds-backup file: the project, its checkpoints and a check of every file">Export backup…</button>
        <button onClick={() => picker.current?.click()} title="Open a .lvds-backup file: it is checked before anything is opened">Import backup…</button>
        <input ref={picker} type="file" accept={`.${BACKUP_EXT},.zip`} style={{ display: 'none' }} onChange={(e) => { void importBackup(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {!list.length ? <p className="m">None yet.</p> : (
        <table className="tbl"><tbody>{list.map((c) => (
          <tr key={c.id}><td>{when(c.at)}</td><td>{c.label}{c.auto ? <span className="m"> · automatic</span> : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}><button onClick={() => restore(c)}>Restore…</button> <button onClick={() => del(c)}>Delete</button></td></tr>
        ))}</tbody></table>
      )}
    </div>
  );
}
