import { diffSections, type SectionChange } from '../model/saveSafety';
import type { Project } from '../types';

function ChangeList({ changes }: { changes: SectionChange[] }) {
  if (!changes.length) return <p className="m">No differences in the design — only when or by whom it was saved.</p>;
  return (
    <table className="projects-table" style={{ marginTop: 8 }}>
      <thead><tr><th>Part of the project</th><th>Difference</th></tr></thead>
      <tbody>{changes.map((c) => <tr key={c.key}><td>{c.label}</td><td>{c.detail}</td></tr>)}</tbody>
    </table>
  );
}

/** The project's file was changed by someone else (another computer, a sync tool, another program) since
 * this one was opened or last saved: nothing was overwritten. */
export function ConflictDialog({ name, mine, disk, onOverwrite, onSaveCopy, onLoadDisk, onCancel }: {
  name: string; mine: Project; disk: Project | null;
  onOverwrite: () => void; onSaveCopy: () => void; onLoadDisk: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>“{name}” changed on disk</h3>
        <p>The file was changed by another computer, a sync tool or another program since you opened it, so it was <b>not</b> overwritten. Nothing is lost yet — choose what to keep.</p>
        {disk ? <ChangeList changes={diffSections(mine, disk)} /> : <p className="m">The file on disk could not be read to compare.</p>}
        <p className="m" style={{ marginTop: 8 }}>“Yours” is what you have open now; “the other” is the file on disk.</p>
        <div className="modal-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="chip" onClick={onCancel}>Cancel</button>
          <span className="sp" />
          <button className="chip" disabled={!disk} onClick={onLoadDisk} title="Open the version on disk. Your unsaved version is kept as recoverable work.">Use the version on disk</button>
          <button className="chip" onClick={onSaveCopy} title="Keep both: your version as a new project, the file on disk untouched">Save mine as a copy…</button>
          <button className="chip primary" onClick={onOverwrite} title="Replace the file on disk with yours. The other version is kept beside it as a .bak file.">Overwrite with mine</button>
        </div>
      </div>
    </div>
  );
}

/** Compare two project files (for example a sync tool's conflicted copy and the original). */
export function CompareDialog({ aName, bName, a, b, onClose }: { aName: string; bName: string; a: Project; b: Project; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>Compare two files</h3>
        <p className="m"><b>{aName}</b> (shown as “yours”) with <b>{bName}</b> (“the other”).</p>
        <ChangeList changes={diffSections(a, b)} />
        <div className="modal-actions"><span className="sp" /><button className="chip primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

/** Shown above the project when its file changed on disk while it is open. */
export function ExternalChangeBar({ kind, dirty, onReload, onReview, onDismiss }: {
  kind: 'changed' | 'missing'; dirty: boolean; onReload: () => void; onReview: () => void; onDismiss: () => void;
}) {
  return (
    <div className="recover-bar" role="alert">
      {kind === 'missing'
        ? <span>This project's file is no longer in the projects folder. Saving will create it again.</span>
        : <span>This project's file changed on disk (another computer, a sync or another program).{dirty ? ' You also have unsaved changes here.' : ''}</span>}
      {kind === 'changed' && (dirty
        ? <button className="chip primary" onClick={onReview}>Review differences</button>
        : <button className="chip primary" onClick={onReload}>Reload from disk</button>)}
      <button className="chip" onClick={onDismiss} title={kind === 'changed' ? 'Keep working; saving will ask what to do' : undefined}>Keep working</button>
    </div>
  );
}
