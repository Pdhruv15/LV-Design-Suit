import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { planPaste, suggestRename, type Rename } from '../model/copyBoard';
import { boardAndDescendants } from '../model/edit';

/** Paste a copied board (with everything below it) onto a busbar, with a
 * find-and-replace rename for ids and names and a preview of the result. */
export default function PasteBoardDialog({ project, sourceId, targetId, onPaste, onClose }: {
  project: Project;
  sourceId: string;
  targetId: string;
  onPaste: (r: Rename) => void;
  onClose: () => void;
}) {
  const [r, setR] = useState<Rename>(() => suggestRename(project, sourceId));
  const plan = useMemo(() => planPaste(project, sourceId, targetId, r), [project, sourceId, targetId, r]);
  const tree = boardAndDescendants(project, sourceId);
  const circuits = project.feeders.filter((f) => tree.has(f.boardId) && f.phase && f.way).length;
  const feeders = project.feeders.filter((f) => tree.has(f.boardId)).length - circuits;
  const set = (k: keyof Rename) => (e: React.ChangeEvent<HTMLInputElement>) => setR({ ...r, [k]: e.target.value });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onPaste(r); }}>
        <h3>Paste {sourceId} on {targetId}</h3>
        <p className="m">
          Copies {tree.size} board{tree.size > 1 ? 's' : ''}, {feeders} feeder{feeders === 1 ? '' : 's'} and {circuits} load schedule circuit{circuits === 1 ? '' : 's'}.
          Rename them as you paste, e.g. ground floor → first floor. Leave the replacement empty to add “-2”.
        </p>
        <div className="grid2">
          <label>In ids, replace<input value={r.idFind} placeholder="e.g. GF" onChange={set('idFind')} /></label>
          <label>with<input value={r.idReplace} placeholder="e.g. FF" autoFocus onChange={set('idReplace')} /></label>
          <label>In names, replace<input value={r.nameFind} placeholder="e.g. Ground floor" onChange={set('nameFind')} /></label>
          <label>with<input value={r.nameReplace} placeholder="e.g. First floor" onChange={set('nameReplace')} /></label>
        </div>
        <p className="paste-preview">
          New boards: {[...plan.boards.entries()].map(([from, to]) => <span key={from}><s>{from}</s> → <b>{to}</b></span>)}
        </p>
        <div className="modal-actions">
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">Paste</button>
        </div>
      </form>
    </div>
  );
}
