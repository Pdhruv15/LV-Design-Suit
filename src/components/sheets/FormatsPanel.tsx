import { useState } from 'react';
import { X } from 'lucide-react';
import { linkBoards, linkLabel, sheetFromFormat } from '../../docs/sheetLink';
import { formatNameError, loadFormats, PANEL_CATEGORIES, projectFormat, projectFormatStale, removeFormat, renameFormat, saveFormats, withProjectFormat, type ScheduleFormat } from '../../model/scheduleFormats';
import type { Sheet } from '../../model/sheets';
import type { Project } from '../../types';
import { fmtDate } from '../../util/format';
import { ask } from '../ConfirmDialog';
import { PANEL_CSS } from './panelCss';

/** The My formats panel of the Sheets page: the layouts saved from Link columns, added as a sheet for a board or for every DB without one. */
export default function FormatsPanel({ project, sheets, onAddSheets, onProject, onStatus, onClose }: { project: Project; sheets: Sheet[]; onAddSheets: (made: Sheet[]) => void; onProject: (next: Project) => void; onStatus?: (m: string) => void; onClose: () => void }) {
  const [list, setList] = useState<ScheduleFormat[]>(() => loadFormats());
  const [boardOf, setBoardOf] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const boardsOf = (f: ScheduleFormat) => linkBoards(project, f.category), withoutOf = (f: ScheduleFormat) => boardsOf(f).filter((b) => !sheets.some((s) => s.link?.boardId === b.id));
  const general = (c: (typeof PANEL_CATEGORIES)[number]) => { onProject(withProjectFormat(project, c.key, undefined)); onStatus?.(`${c.plural} of this project use the app's own table.`); };
  const store = (next: ScheduleFormat[]) => { saveFormats(next); setList(next); };
  const addFor = (f: ScheduleFormat) => {
    const made = sheetFromFormat(f.sheet, sheets, boardOf[f.id]);
    onAddSheets([made]);
    onStatus?.(`Sheet ${made.name} added from "${f.name}".`);
  };
  const addAll = (f: ScheduleFormat) => {
    const all = [...sheets], made: Sheet[] = [];
    for (const b of withoutOf(f)) { const s = sheetFromFormat(f.sheet, all, b.id); all.push(s); made.push(s); }
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
      <div className="shl-needs">
        <span>This project's schedules use</span>
        {PANEL_CATEGORIES.map((c) => {
          const used = projectFormat(project, c.key), fresh = used && projectFormatStale(project, c.key, list) ? list.find((f) => f.id === used.id) : undefined;
          return (
            <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="shl-row">
                <span>{c.plural}</span>
                {used ? <span style={{ fontWeight: 500, flex: 1 }}>{used.name}</span> : <span className="shl-mut" style={{ flex: 1 }}>General</span>}
                {used && <button type="button" className="shl-btn shl-x" aria-label={`Use General for ${c.plural}`} onClick={() => general(c)}><X size={14} aria-hidden /></button>}
              </div>
              {fresh && <span className="shl-mut">Changed in My formats since this project took its copy.</span>}
              {fresh && <button type="button" className="shl-btn" aria-label={`Update the project's copy for ${c.plural}`} onClick={() => { onProject(withProjectFormat(project, c.key, fresh)); onStatus?.(`This project's copy of "${fresh.name}" is updated.`); }}>Update</button>}
            </div>
          );
        })}
      </div>
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
          <span className="shl-mut">{linkLabel(f.category)} · saved {fmtDate(f.updatedAt)}</span>
          <div className="shl-row">
            <select aria-label={`Board for ${f.name}`} value={boardOf[f.id] ?? ''} onChange={(e) => setBoardOf({ ...boardOf, [f.id]: e.target.value })}>
              <option value="">Choose a board</option>
              {boardsOf(f).map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
            </select>
            <button type="button" className="shl-btn" disabled={!boardOf[f.id]} onClick={() => addFor(f)}>Add sheet</button>
          </div>
          <button type="button" className="shl-btn shl-go" disabled={!withoutOf(f).length} onClick={() => addAll(f)}>Add a sheet for every {f.category === 'md' ? 'panel' : 'DB'} without one ({withoutOf(f).length})</button>
          <div className="shl-row" style={{ flexWrap: 'wrap' }}>
            <span className="shl-mut" style={{ width: 'auto' }}>Use for this project's</span>
            {PANEL_CATEGORIES.filter((c) => c.kind === f.category).map((c) => {
              const on = projectFormat(project, c.key)?.id === f.id;
              return <button type="button" key={c.key} className="shl-btn" aria-pressed={on} style={on ? { background: 'var(--acc)', color: 'var(--on-acc)', borderColor: 'var(--acc)' } : undefined}
                onClick={() => { if (on) general(c); else { onProject(withProjectFormat(project, c.key, f)); onStatus?.(`${c.plural} of this project use "${f.name}".`); } }}>{c.plural}</button>;
            })}
          </div>
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
