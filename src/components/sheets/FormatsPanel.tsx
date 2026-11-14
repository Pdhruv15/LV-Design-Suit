import { useState } from 'react';
import { X } from 'lucide-react';
import { linkBoards, sheetFromFormat } from '../../docs/sheetLink';
import { formatNameError, loadFormats, removeFormat, renameFormat, saveFormats, type ScheduleFormat } from '../../model/scheduleFormats';
import type { Sheet } from '../../model/sheets';
import type { Project } from '../../types';
import { fmtDate } from '../../util/format';
import { ask } from '../ConfirmDialog';
import { PANEL_CSS } from './panelCss';

/** The My formats panel of the Sheets page: the layouts saved from Link columns, added as a sheet for a board or for every DB without one. */
export default function FormatsPanel({ project, sheets, onAddSheets, onStatus, onClose }: { project: Project; sheets: Sheet[]; onAddSheets: (made: Sheet[]) => void; onStatus?: (m: string) => void; onClose: () => void }) {
  const [list, setList] = useState<ScheduleFormat[]>(() => loadFormats());
  const [boardOf, setBoardOf] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const boards = linkBoards(project), without = boards.filter((b) => !sheets.some((s) => s.link?.boardId === b.id));
  const store = (next: ScheduleFormat[]) => { saveFormats(next); setList(next); };
  const addFor = (f: ScheduleFormat) => {
    const made = sheetFromFormat(f.sheet, sheets, boardOf[f.id]);
    onAddSheets([made]);
    onStatus?.(`Sheet ${made.name} added from "${f.name}".`);
  };
  const addAll = (f: ScheduleFormat) => {
    const all = [...sheets], made: Sheet[] = [];
    for (const b of without) { const s = sheetFromFormat(f.sheet, all, b.id); all.push(s); made.push(s); }
    onAddSheets(made);
    onStatus?.(`${made.length} ${made.length === 1 ? 'sheet' : 'sheets'} added from "${f.name}".`);
  };
  const rename = (f: ScheduleFormat, text: string) => {
    const bad = formatNameError(text, list, f.id);
    if (bad) { onStatus?.(bad); return; }
    store(renameFormat(list, f.id, text));
    setRenaming(null);
  };
  const remove = async (f: ScheduleFormat) => { if (await ask(`Delete the format "${f.name}"? Sheets already made from it stay.`)) store(removeFormat(list, f.id)); };
  return (
    <aside className="shl" aria-label="My formats">
      <style>{PANEL_CSS}</style>
      <div className="shl-head"><h4>My formats</h4><button type="button" className="shl-btn shl-x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button></div>
      {!list.length && <p>No formats yet. Link a sheet to a board, then press Save as my format in Link columns.</p>}
      {list.map((f) => (
        <div className="shl-needs" key={f.id}>
          {renaming === f.id
            ? <div className="shl-row">
                <input aria-label={`New name for ${f.name}`} autoFocus defaultValue={f.name} style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') rename(f, e.currentTarget.value); else if (e.key === 'Escape') setRenaming(null); }} />
                <button type="button" className="shl-btn" onClick={(e) => rename(f, (e.currentTarget.parentElement!.querySelector('input') as HTMLInputElement).value)}>Save</button>
                <button type="button" className="shl-btn" onClick={() => setRenaming(null)}>Cancel</button>
              </div>
            : <span style={{ fontWeight: 500 }}>{f.name}</span>}
          <span className="shl-mut">DB schedule · saved {fmtDate(f.updatedAt)}</span>
          <div className="shl-row">
            <select aria-label={`Board for ${f.name}`} value={boardOf[f.id] ?? ''} onChange={(e) => setBoardOf({ ...boardOf, [f.id]: e.target.value })}>
              <option value="">Choose a board</option>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
            </select>
            <button type="button" className="shl-btn" disabled={!boardOf[f.id]} onClick={() => addFor(f)}>Add sheet</button>
          </div>
          <button type="button" className="shl-btn shl-go" disabled={!without.length} onClick={() => addAll(f)}>Add a sheet for every DB without one ({without.length})</button>
          <div className="shl-row">
            <button type="button" className="shl-btn" onClick={() => setRenaming(f.id)}>Rename</button>
            <button type="button" className="shl-btn" onClick={() => void remove(f)}>Delete</button>
          </div>
        </div>
      ))}
      <p className="shl-note">Formats are kept with your office library, not with one project.</p>
    </aside>
  );
}
