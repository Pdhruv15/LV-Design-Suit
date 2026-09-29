import { useState } from 'react';

/** Before opening or starting another project with unsaved changes. */
export function UnsavedDialog({ name, action, onSave, onDiscard, onCancel }: {
  name: string;
  action: string; // e.g. "opening another project"
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label="Unsaved changes">
        <h3>Save changes to “{name}”?</h3>
        <p className="m">The project has changes that aren’t saved. Save them before {action}?</p>
        <div className="modal-actions">
          <button type="button" className="chip" onClick={onDiscard}>Don’t save</button>
          <span className="sp" />
          <button type="button" className="chip" onClick={onCancel}>Cancel</button>
          <button type="button" className="chip primary" autoFocus onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

/** Save as / duplicate: the new project's name. */
export function NameDialog({ title, note, initial, okLabel, onOk, onCancel }: {
  title: string;
  note?: string;
  initial: string;
  okLabel: string;
  onOk: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (name.trim()) onOk(name.trim()); }}>
        <h3>{title}</h3>
        {note && <p className="m">{note}</p>}
        <label>Project name<input autoFocus value={name} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} /></label>
        <div className="modal-actions">
          <span className="sp" />
          <button type="button" className="chip" onClick={onCancel}>Cancel</button>
          <button type="submit" className="chip primary" disabled={!name.trim()}>{okLabel}</button>
        </div>
      </form>
    </div>
  );
}
