import { useState } from 'react';
import type { Board, Project } from '../types';
import BoardFields, { BOARD_FIELD_GROUPS, type BoardFieldGroup } from './BoardFields';

type Tab = BoardFieldGroup | 'transformer';

/** Double-click edit dialog for a board (and, for a main board, its
 * transformer). Changes apply on Save. */
export default function BoardEditForm({
  project,
  board,
  onSave,
  onDelete,
  onEditIncomer,
  onClose
}: {
  project: Project;
  board: Board;
  onSave: (b: Board) => void;
  onDelete?: () => void;
  onEditIncomer?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Board>(board);
  const [tab, setTab] = useState<Tab>('board');
  const isMain = !board.upstreamId;
  const tabs: [Tab, string][] = [...BOARD_FIELD_GROUPS, ...(isMain ? [['transformer', 'Transformer'] as [Tab, string]] : [])];
  const subBoards = project.boards.filter((b) => b.upstreamId === board.id).length;
  const feeders = project.feeders.filter((f) => f.boardId === board.id).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) { setTab('board'); return; }
    onSave(draft);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Edit board: {board.id}</h3>
        <p className="m">{isMain ? 'Main board, supplied by the transformer.' : `Supplied from ${board.upstreamId}.`} {feeders} outgoing feeder(s).</p>
        <div className="tabs feeder-tabs" role="tablist">
          {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        <div className="board-tab-body">
          {tab === 'transformer'
            ? <BoardFields board={draft} onChange={setDraft} section="source" />
            : <BoardFields board={draft} onChange={setDraft} section="general" building={project.building} groups={[tab]} />}
        </div>
        <div className="modal-actions">
          {onDelete && (
            <button
              type="button"
              className="chip bad-btn"
              onClick={() => {
                const extra = subBoards ? ` and the ${subBoards} board(s) fed from it` : '';
                if (window.confirm(`Delete ${board.id}, its ${feeders} feeder(s)${extra}? This can't be undone.`)) onDelete();
              }}
            >
              Delete board
            </button>
          )}
          {onEditIncomer && <button type="button" className="chip" onClick={onEditIncomer}>Edit incomer cable…</button>}
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">Save changes</button>
        </div>
      </form>
    </div>
  );
}
