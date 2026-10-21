import { Modal } from './ui';
import { useState } from 'react';
import { applyBoardPlaces, pullBoardPlaces, type CadPlan } from '../model/cadPlaces';
import { floorLabel, floorList } from '../model/levels';
import type { Project } from '../types';

/** Board locations from a CAD floor plan: each board's symbol (found by its TAG attribute, or linked by hand) gives
 * the room it sits in, the plan's level and its position; shown beside the design and applied on accept. */
export default function CadPlacesDialog({ project, onApply, onClose }: {
  project: Project;
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const cad = window.lvds?.openCadStudio;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [boardId, setBoardId] = useState('');
  const [plan, setPlan] = useState<CadPlan | null>(null);
  const [levelKeyChosen, setLevelKeyChosen] = useState('');
  const [roomLayer, setRoomLayer] = useState(project.cadRoomLayer ?? '');
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const floors = floorList(project.building);
  const level = floors.find((f) => f.key === levelKeyChosen)?.ref;
  const working = { ...project, cadRoomLayer: roomLayer.trim() || undefined };
  const pull = plan ? pullBoardPlaces(working, plan, level) : null;

  async function act(kind: string, run: () => Promise<void>) {
    setBusy(kind);
    setNote('');
    try { await run(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const openPlan = () => act('open', async () => {
    const r = await cad!.openPlan!();
    if (r) { setNote(`Opened ${r.file} in OpenCADStudio. Choose the level this plan shows, then pull locations.`); setPlan(null); }
  });
  const link = (id: string) => act(id ? 'link' : 'unlink', async () => {
    const r = await cad!.placeSelection!(id);
    setNote(id ? `Marked ${r.linked} object${r.linked === 1 ? '' : 's'} as ${id}.` : `Unlinked ${r.linked} object${r.linked === 1 ? '' : 's'}.`);
    if (plan) setPlan(await cad!.plan!());
  });
  const read = () => act('pull', async () => { setPlan(await cad!.plan!()); setSkip(new Set()); });

  function apply() {
    if (!pull) return;
    const accepted = pull.proposals.filter((x) => !skip.has(x.boardId));
    const next = { ...applyBoardPlaces(project, accepted, level), cadRoomLayer: roomLayer.trim() || undefined };
    onApply(next, accepted.length ? `Board locations from CAD: ${accepted.length} board${accepted.length === 1 ? '' : 's'} updated` : 'Board locations from CAD: nothing changed');
  }

  if (!cad?.plan || !cad.placeSelection || !cad.openPlan) {
    return (
      <Modal onClose={onClose} className="modal">
        <h3>Board locations from CAD floor plan</h3>
        <p className="m">Reading a floor plan needs the LV Design Studio desktop app and OpenCADStudio.</p>
        <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} className="modal cad-places">
      <h3>Board locations from CAD floor plan</h3>
      <p className="m">
        A board symbol is found by its TAG (or BOARD / PANEL) attribute, e.g. <b>DB-GF1</b>; otherwise select it in
        OpenCADStudio, choose the board here and press Link selection. Its room is the closed room outline around it,
        named by the text inside. Nothing changes until you apply.
      </p>
      <div className="modal-actions">
        <button className="chip" disabled={!!busy} onClick={openPlan}>{busy === 'open' ? 'Opening…' : 'Open floor plan…'}</button>
        <span className="sp" />
        <select aria-label="Board to link" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
          <option value="">Choose a board…</option>
          {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
        </select>
        <button className="chip" disabled={!!busy || !boardId} onClick={() => link(boardId)}>{busy === 'link' ? 'Linking…' : 'Link selection'}</button>
        <button className="chip" disabled={!!busy} onClick={() => link('')} title="Remove the board link from the objects selected in OpenCADStudio">Unlink selection</button>
      </div>

      <div className="ce-grid">
        <label>This plan shows
          <select aria-label="Level of this plan" value={levelKeyChosen} onChange={(e) => setLevelKeyChosen(e.target.value)}>
            <option value="">Keep levels</option>
            {floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}
          </select>
        </label>
        <label>Room outline layer<input value={roomLayer} placeholder="ROOM, SPACE or AREA" title="Layer name, or part of it, of the room outlines. Blank: any layer whose name has ROOM, SPACE or AREA" onChange={(e) => setRoomLayer(e.target.value)} /></label>
      </div>
      {!floors.length && <p className="m">No levels yet (Building information), so boards keep their level; rooms and positions still update.</p>}

      <div className="modal-actions">
        <span className="sp" />
        <button className="chip primary" disabled={!!busy} onClick={read}>{busy === 'pull' ? 'Reading…' : plan ? 'Pull again' : 'Pull locations'}</button>
      </div>
      {note && <p className="m">{note}</p>}

      {pull && (
        <>
          <p className="m">{pull.rooms} room outline{pull.rooms === 1 ? '' : 's'} · {pull.units} · {pull.proposals.length} board{pull.proposals.length === 1 ? '' : 's'} to update · {pull.matching} already match</p>
          {pull.proposals.length > 0 && (
            <table className="bi-table compact">
              <thead><tr><th /><th>Board</th><th>Location now</th><th>From CAD</th><th>Level</th><th>Position (m)</th></tr></thead>
              <tbody>
                {pull.proposals.map((x) => (
                  <tr key={x.boardId}>
                    <td><input type="checkbox" aria-label={`Accept ${x.boardId}`} checked={!skip.has(x.boardId)} onChange={(e) => setSkip((k) => { const n = new Set(k); if (e.target.checked) n.delete(x.boardId); else n.add(x.boardId); return n; })} /></td>
                    <td title={x.how === 'linked' ? 'Linked by hand' : 'Found by its TAG attribute'}>{x.boardId}</td>
                    <td>{x.currentLocation || '—'}</td>
                    <td>{x.room ?? <i>not in a room outline</i>}</td>
                    <td>{x.currentLevel === x.newLevel ? x.currentLevel : `${x.currentLevel} → ${x.newLevel}`}</td>
                    <td>{x.x}, {x.y}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pull.unknown.length > 0 && <p className="m">Symbols naming boards not in the design (ignored): {pull.unknown.join(', ')}</p>}
          {pull.noRoom.length > 0 && <p className="m">Outside every room outline (location kept): {pull.noRoom.join(', ')}</p>}
        </>
      )}

      <div className="modal-actions">
        <span className="sp" />
        <button className="chip" onClick={onClose}>Cancel</button>
        <button className="chip primary" disabled={!pull || !!busy} onClick={apply}>
          Apply {pull ? pull.proposals.filter((x) => !skip.has(x.boardId)).length : 0} boards
        </button>
      </div>
    </Modal>
  );
}

