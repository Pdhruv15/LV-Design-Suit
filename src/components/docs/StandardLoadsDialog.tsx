import { useState } from 'react';
import { STANDARD_LOADS, type StandardLoad } from '../../data/standardLoads';
import { inLibrary, withStandardLoads } from '../../database/standardLoads';
import { POINT_TYPES } from '../../types';

type Row = Record<string, unknown>;
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : undefined; };

/** Adds the standard set of regular loads to Loads.xlsx. The watts are typical draft values: the engineer reviews and
 * changes them here first, and each row is written marked "typical value, verify". Items already in the library (same
 * reference or name) are kept as they are. */
export default function StandardLoadsDialog({ rows, onDone, onClose }: {
  rows: Row[]; // the library's Loads.xlsx rows now
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<StandardLoad[]>(STANDARD_LOADS);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const have = (l: StandardLoad) => inLibrary(rows, l);
  const chosen = items.filter((l) => !have(l) && !off.has(l.reference));
  const edit = (ref: string, patch: Partial<StandardLoad>) => setItems((xs) => xs.map((x) => (x.reference === ref ? { ...x, ...patch } : x)));
  const write = window.lvds?.database.write;

  async function add() {
    if (!write || !chosen.length) return;
    if (chosen.some((l) => !(l.watts > 0))) { setNote('Every item to add needs its power in watts.'); return; }
    setBusy(true);
    try {
      const r = withStandardLoads(rows, chosen);
      await write('loads', r.rows as Record<string, string | number>[]);
      onDone(`Added ${r.added.length} standard load${r.added.length === 1 ? '' : 's'} to Loads.xlsx (backup kept) — marked "typical value, verify"`);
    } catch (e) {
      setNote(`Could not write Loads.xlsx: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal standard-loads" onClick={(e) => e.stopPropagation()}>
        <h3>Add standard loads</h3>
        <p className="m">
          A starting set of regular loads for <b>Loads.xlsx</b>, one or more per load schedule column. <b>The watts are
          typical draft values</b> — check each one and change it to your own figure before adding. Added rows are marked
          “Standard set — typical value, verify” in the Notes column. Items you already have (same reference or name) are
          kept as they are; nothing in your file is changed.
        </p>
        <table className="bi-table compact">
          <thead><tr><th /><th>Ref.</th><th>Name</th><th>Column</th><th>Power (W)</th><th>PF</th></tr></thead>
          <tbody>
            {items.map((l) => {
              const exists = have(l);
              return (
                <tr key={l.reference} className={exists ? 'm' : undefined}>
                  <td><input type="checkbox" aria-label={`Add ${l.reference}`} disabled={exists} checked={!exists && !off.has(l.reference)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(l.reference); else n.add(l.reference); return n; })} /></td>
                  <td>{l.reference}</td>
                  <td>{l.name}{exists && <i> — in your library (kept)</i>}</td>
                  <td>{POINT_TYPES.find((p) => p.value === l.column)?.label}</td>
                  <td><input aria-label={`Power of ${l.reference} (W)`} inputMode="decimal" style={{ width: '5.5em' }} disabled={exists} value={l.watts} onChange={(e) => edit(l.reference, { watts: num(e.target.value) ?? 0 })} /></td>
                  <td><input aria-label={`Power factor of ${l.reference}`} inputMode="decimal" style={{ width: '4em' }} disabled={exists} value={l.pf ?? ''} placeholder="—" onChange={(e) => { const v = num(e.target.value); edit(l.reference, { pf: v !== undefined && v > 0 && v <= 1 ? v : undefined }); }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!write && <p className="m">Adding to Loads.xlsx needs the LV Design Studio desktop app.</p>}
        {note && <p className="m">{note}</p>}
        <div className="modal-actions">
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!write || busy || !chosen.length} onClick={add}>{busy ? 'Adding…' : `Add ${chosen.length} to Loads.xlsx`}</button>
        </div>
      </div>
    </div>
  );
}
