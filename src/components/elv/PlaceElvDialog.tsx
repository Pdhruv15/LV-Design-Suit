import { useState } from 'react';
import { placeElvLoads, type ElvPlaced } from '../../elv/place';
import type { Project } from '../../types';
import { Modal } from '../ui';

/** Places the accepted ELV loads on boards: a preview with the board chosen for each load and why (the engineer can
 * pick another), the kW changes that become a proposal, and what is only listed. Nothing changes until Apply. */
export default function PlaceElvDialog({ project, me, onApply, onClose }: {
  project: Project;
  me: string;
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const [boards, setBoards] = useState<Record<string, string>>({});
  const [by, setBy] = useState(me);
  let preview: ElvPlaced | undefined, error = '';
  try { preview = placeElvLoads(project, boards, by.trim() || 'Engineer', by.trim() || undefined); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const rows = preview ? [...preview.plan.add, ...preview.plan.unplaced] : [];
  const circuit = (loadId: string) => {
    const i = preview!.plan.add.findIndex((c) => c.load.id === loadId);
    const f = i < 0 ? undefined : preview!.project.feeders.find((x) => x.id === preview!.added[i]);
    if (!f) return '—';
    return `${f.cores === 2 ? `1-ph, ${f.phase ?? ''}` : '3-ph'} · ${f.cableCsaMm2} mm² · ${f.breakerRatingA} A`;
  };
  const pick = (loadId: string, boardId: string) => {
    const { [loadId]: _old, ...rest } = boards;
    setBoards(boardId ? { ...rest, [loadId]: boardId } : rest);
  };
  const apply = () => {
    if (!preview) return;
    const n = preview.added.length, k = preview.plan.kwChanges.length;
    onApply(preview.project, `${n} ELV circuit${n === 1 ? '' : 's'} added${preview.proposal ? `; ${preview.proposal} proposes ${k} kW change${k === 1 ? '' : 's'} (Changes)` : ''}${preview.plan.unplaced.length ? `; ${preview.plan.unplaced.length} not placed` : ''} · approved by ${by.trim()}.`);
  };

  return (
    <Modal onClose={onClose} className="modal" label="Place ELV loads on boards" style={{ width: 'min(980px, 96vw)' }}>
      <h3>Place ELV loads on boards <span className="m">Preview · nothing changes until Apply</span></h3>
      {error && <p className="warn">⚠ {error}</p>}
      {preview && (
        <div className="tool-panel" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {!rows.length ? <p className="m">No new loads to place{preview.plan.same.length ? `: ${preview.plan.same.length} circuit${preview.plan.same.length === 1 ? ' is' : 's are'} already up to date` : ''}.</p> : (
            <table className="tbl"><thead><tr><th>Load</th><th>Equipment</th><th className="num">kW</th><th>Board</th><th>Why</th><th>Circuit</th></tr></thead><tbody>
              {rows.map((c) => (
                <tr key={c.link}>
                  <td>{c.load.id}</td><td>{c.load.equipment}{c.load.supply === 'essential' ? <b> · essential</b> : ''}</td><td className="num">{c.load.kW.toFixed(2)}</td>
                  <td>
                    <select value={c.boardId ?? ''} onChange={(e) => pick(c.load.id, e.target.value)} aria-label={`Board for ${c.load.id}`}>
                      {!c.boardId && <option value="">— choose —</option>}
                      {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id}{b.kind ? ` (${b.kind})` : ''}</option>)}
                    </select>
                  </td>
                  <td className={c.boardId ? 'm' : 'warn'}>{c.boardId ? c.why : `No board found: ${c.why}`}</td>
                  <td>{c.boardId ? circuit(c.load.id) : '—'}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          {preview.plan.kwChanges.map((c) => <p key={c.feederId} className="warn">⚠ {c.feederId}: {c.fromKw.toFixed(2)} → {c.toKw.toFixed(2)} kW goes to Changes as a proposal. The circuit is not changed here.</p>)}
          {preview.plan.removed.map((r) => <p key={r.feederId} className="warn">⚠ {r.feederId} ({r.name}) is no longer in the package. It is kept; delete it by hand if it is not needed.</p>)}
          {preview.plan.placeholders.map((r) => <p key={r.feederId} className="warn">⚠ Placeholder “{r.name}” ({r.feederId}) can now be deleted.</p>)}
        </div>
      )}
      <div className="modal-actions">
        {preview && <span className="m">{preview.added.length} circuit{preview.added.length === 1 ? '' : 's'} to add{preview.plan.kwChanges.length ? ` · 1 proposal` : ''}{preview.plan.unplaced.length ? ` · ${preview.plan.unplaced.length} not placed` : ''}</span>}
        <span className="sp" />
        <label className="m">Applied by <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" style={{ width: 170 }} /></label>
        <button className="chip" onClick={onClose}>Cancel</button>
        <button className="chip primary" onClick={apply} disabled={!preview || by.trim().length < 2 || (!preview.added.length && !preview.proposal)}>Apply ({preview?.added.length ?? 0})</button>
      </div>
    </Modal>
  );
}
