import { useState } from 'react';
import { BOARD_KINDS, type Board, type BoardKind, type Feeder, type Project } from '../types';
import { cables } from '../calc/cableTable';

export default function BoardForm({
  project,
  parentBoardId,
  onSave,
  onClose
}: {
  project: Project;
  parentBoardId: string;
  onSave: (board: Board, incomer: Feeder) => void;
  onClose: () => void;
}) {
  const [boardId, setBoardId] = useState('');
  const [boardName, setBoardName] = useState('');
  const [upstreamId, setUpstreamId] = useState(parentBoardId);
  const [kind, setKind] = useState<BoardKind>('DB');
  const [ratedCurrentA, setRatedCurrentA] = useState(250);
  const [incomerId, setIncomerId] = useState('');
  const [lengthM, setLengthM] = useState(30);
  const [cableCsaMm2, setCableCsaMm2] = useState(95);
  const [cores, setCores] = useState<2 | 3 | 4>(4);
  const [breakerRatingA, setBreakerRatingA] = useState(250);
  const [breakerIcuKa, setBreakerIcuKa] = useState(36);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!boardId.trim() || !boardName.trim() || !incomerId.trim()) return;
    const board: Board = { id: boardId, name: boardName, upstreamId, kind, ratedCurrentA };
    const incomer: Feeder = {
      id: incomerId, boardId: upstreamId, name: `Incomer to ${boardName}`,
      loadKw: 0, demandFactor: 1, powerFactor: 0.85, lengthM, cableCsaMm2, cores,
      breakerRatingA, breakerIcuKa, feedsBoardId: boardId
    };
    onSave(board, incomer);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Add downstream board</h3>
        <p className="m">A new sub-board (SMDB/DB), fed from an existing board through an incomer feeder. Its demand and fault level flow through automatically.</p>
        <div className="grid2">
          <label>Board ID<input value={boardId} required onChange={(e) => setBoardId(e.target.value)} placeholder="e.g. SMDB-2" /></label>
          <label>Board name<input value={boardName} required onChange={(e) => setBoardName(e.target.value)} placeholder="e.g. Second floor SMDB" /></label>
          <label>Board type
            <select value={kind} onChange={(e) => setKind(e.target.value as BoardKind)}>
              {BOARD_KINDS.filter((k) => k.value !== 'MDB').map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          <label>Rated current (A)<input type="number" value={ratedCurrentA} onChange={(e) => setRatedCurrentA(+e.target.value)} /></label>
          <label>Fed from
            <select value={upstreamId} onChange={(e) => setUpstreamId(e.target.value)}>
              {project.boards.map((b) => (
                <option key={b.id} value={b.id}>{b.id} — {b.name}</option>
              ))}
            </select>
          </label>
          <label>Incomer circuit ID<input value={incomerId} required onChange={(e) => setIncomerId(e.target.value)} placeholder="e.g. RISER-2" /></label>
          <label>Cable length (m)<input type="number" value={lengthM} onChange={(e) => setLengthM(+e.target.value)} /></label>
          <label>Cores
            <select value={cores} onChange={(e) => setCores(+e.target.value as 2 | 3 | 4)}>
              <option value={4}>4 (3-phase)</option>
              <option value={3}>3</option>
              <option value={2}>2 (single-phase)</option>
            </select>
          </label>
          <label>Cable size (mm²)
            <select value={cableCsaMm2} onChange={(e) => setCableCsaMm2(+e.target.value)}>
              {cables().map((c) => (
                <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2} mm²</option>
              ))}
            </select>
          </label>
          <label>Breaker rating (A)<input type="number" value={breakerRatingA} onChange={(e) => setBreakerRatingA(+e.target.value)} /></label>
          <label>Breaker Icu (kA)<input type="number" step="0.5" value={breakerIcuKa} onChange={(e) => setBreakerIcuKa(+e.target.value)} /></label>
        </div>
        <div className="modal-actions">
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">Add board</button>
        </div>
      </form>
    </div>
  );
}
