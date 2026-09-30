import { useState } from 'react';
import { LAYER_LABELS, SHEET_LAYERS } from '../../diagram/annotations';
import { boardsInSupplyOrder } from '../../calc/summary';
import { autoSheets, sheetsByCount, renumber, setOf, SIZES, type DrawingSet, type DrawingSheet, type SheetSize } from '../../model/drawingSet';
import type { Project } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { exportDrawingSet, sheetHtml, SheetPreview } from './sheetRender';
import { Page } from '../ui';

/** Reports → Drawing set: the SLD as numbered sheets — which panels on
 * each, size chosen from what's drawn, DB circuit diagrams only when wanted,
 * exported as one PDF with a register or a PDF per sheet. */
export default function DrawingSetView({ project, run, onChange, onStatus }: { project: Project; run?: CalcRun; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const set = setOf(project);
  const save = (next: DrawingSet) => onChange({ ...project, drawingSet: next });
  const setSheet = (id: string, patch: Partial<DrawingSheet>) => save({ ...set, sheets: set.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const [dbSheets, setDbSheets] = useState(false);
  const [perSheet, setPerSheet] = useState(10);
  const dewa = project.drawing?.sldStyle !== 'standard';
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; html: string; size: SheetSize; fits: boolean } | null>(null);
  const [sizes, setSizes] = useState<Record<string, { size: SheetSize; fits: boolean }>>({});
  const [busy, setBusy] = useState('');
  const boards = boardsInSupplyOrder(project);
  const dbs = boards.filter((b) => (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')) === 'DB');

  const auto = (mode: 'perMdb' | 'perSmdb') => {
    if (set.sheets.length && !window.confirm('Replace the sheets with a new automatic set?')) return;
    save(autoSheets(project, mode, dbSheets, set.prefix));
    setSizes({});
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= set.sheets.length) return;
    const sheets = [...set.sheets];
    [sheets[i], sheets[j]] = [sheets[j], sheets[i]];
    save(renumber({ ...set, sheets }));
  };
  const add = (kind: DrawingSheet['kind'], boardId?: string) => save(renumber({ ...set, sheets: [...set.sheets, { id: `sh-${Date.now().toString(36)}`, number: '', title: kind === 'board' ? `${boardId} — circuit diagram` : `SLD — sheet ${set.sheets.length + 1}`, kind, boards: boardId ? [boardId] : [], size: 'auto' }] }));

  async function sizeOf(s: DrawingSheet) {
    const r = await sheetHtml(project, set, s, run);
    if (r) setSizes((x) => ({ ...x, [s.id]: { size: r.size, fits: r.fits } }));
    return r;
  }
  async function exportSet(each: boolean) {
    if (!set.sheets.length) return;
    setBusy(each ? 'each' : 'set');
    try { await exportDrawingSet(project, set, run, each, onStatus); } finally { setBusy(''); }
  }

  const editSheet = set.sheets.find((s) => s.id === editing);

  return (
    <Page
      title="Drawing set — SLD sheets"
      intro="The SLD as numbered sheets. Tick the panels for each sheet; the size is chosen from what’s drawn (the smallest of A4 → A1 that stays readable). DBs show as a box with their circuit count and kW — add a DB circuit diagram sheet only where you want one. Feeders to a panel on another sheet end in “to X — sheet N”."
      actions={<>
        <button className="chip" disabled={!!busy || !set.sheets.length} onClick={() => exportSet(true)}>{busy === 'each' ? 'Exporting…' : 'PDF per sheet'}</button>
        <button className="chip primary" disabled={!!busy || !set.sheets.length} onClick={() => exportSet(false)}>{busy === 'set' ? 'Building…' : 'Export set (one PDF)'}</button>
      </>}
    >
      <section className="card ds-tools">
        <span className="m">Automatic:</span>
        <button className="chip" onClick={() => auto('perMdb')}>One sheet per MDB</button>
        <button className="chip" onClick={() => auto('perSmdb')}>Overview + one per SMDB</button>
        <span className="sp" style={{ flex: 'none', width: 8 }} />
        <button className="chip" onClick={() => { if (set.sheets.length && !window.confirm('Replace the sheets with a new automatic set?')) return; save(sheetsByCount(project, perSheet, set.prefix)); setSizes({}); }}>Split by panels</button>
        <label className="row">max <input className="bi-text" style={{ width: 44 }} inputMode="numeric" value={perSheet} onChange={(e) => setPerSheet(Math.max(1, Number(e.target.value) || 1))} /> panels per sheet</label>
        <label className="row"><input type="checkbox" checked={dbSheets} onChange={(e) => setDbSheets(e.target.checked)} /> Also a circuit diagram for every DB</label>
        <span className="sp" />
        <label className="row">Numbers <input className="bi-text" style={{ width: 80 }} defaultValue={set.prefix} key={set.prefix} onBlur={(e) => save(renumber({ ...set, prefix: e.target.value || 'E-SLD-' }))} />001…</label>
        <label className="row" title="A frame around each panel with its summary box (LOC, TCL, DF, MDL), way numbers and DEWA wording"><input type="checkbox" checked={dewa} onChange={(e) => { onChange({ ...project, drawing: { ...project.drawing, sldStyle: e.target.checked ? undefined : 'standard' } }); setSizes({}); }} /> Panel frames and summary boxes (DEWA style)</label>
        <label className="row"><input type="checkbox" checked={!!set.register} onChange={(e) => save({ ...set, register: e.target.checked })} /> Drawing register first</label>
      </section>

      <section className="card ds-tools">
        <span className="m">Values printed on the sheets:</span>
        {LAYER_LABELS.map(([k, label]) => {
          const tags = set.tags ?? SHEET_LAYERS;
          return <label key={k} className="row"><input type="checkbox" checked={tags[k]} onChange={(e) => { save({ ...set, tags: { ...tags, [k]: e.target.checked } }); setSizes({}); }} /> {label}</label>;
        })}
        <span className="m">— failures print in red (e.g. breaker Icu below the fault level)</span>
      </section>

      <table className="ds-table">
        <thead><tr><th /><th>No.</th><th>Title</th><th>Panels on the sheet</th><th>Size</th><th /></tr></thead>
        <tbody>
          {set.sheets.map((s, i) => (
            <tr key={s.id}>
              <td className="bi-move">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button className="icon-btn" disabled={i === set.sheets.length - 1} onClick={() => move(i, 1)}>▼</button>
              </td>
              <td><b>{s.number}</b></td>
              <td><input className="bi-text" style={{ width: 260 }} defaultValue={s.title} key={s.title} onBlur={(e) => e.target.value !== s.title && setSheet(s.id, { title: e.target.value })} /></td>
              <td>
                {s.kind === 'board' ? <span>{s.boards[0]} <span className="m">— circuit diagram</span></span> : (
                  <button className="linkish ds-boards" onClick={() => setEditing(s.id)}>{s.boards.length ? s.boards.join(', ') : 'Tick panels…'}</button>
                )}
              </td>
              <td>
                <select className="bi-sel" value={s.size} onChange={(e) => setSheet(s.id, { size: e.target.value as DrawingSheet['size'] })}>
                  <option value="auto">Auto{sizes[s.id] && s.size === 'auto' ? ` (${sizes[s.id].size})` : ''}</option>
                  {SIZES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
                {sizes[s.id] && !sizes[s.id].fits && <span className="warn" title="Too much for A1 — split the sheet"> ⚠ crowded</span>}
              </td>
              <td className="acts">
                <button className="chip" disabled={!s.boards.length} onClick={async () => { const r = await sizeOf(s); if (r) setPreview({ id: s.id, ...r }); }}>Preview</button>
                <button className="icon-btn" title="Remove" onClick={() => save(renumber({ ...set, sheets: set.sheets.filter((x) => x.id !== s.id) }))}>✕</button>
              </td>
            </tr>
          ))}
          {!set.sheets.length && <tr><td colSpan={6} className="m">No sheets yet — use an automatic set above, or add sheets.</td></tr>}
        </tbody>
      </table>
      <div className="ds-tools" style={{ marginTop: 8 }}>
        <button className="chip" onClick={() => add('system')}>+ Sheet</button>
        <select className="chip" value="" onChange={(e) => e.target.value && add('board', e.target.value)}>
          <option value="">+ DB circuit diagram sheet…</option>
          {dbs.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
        </select>
        <span className="m">Title block: Home → Title block ({'{SheetNo}'}, {'{SheetTitle}'}, {'{SheetCount}'} fill in per sheet).</span>
      </div>

      {editSheet && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Panels on {editSheet.number}</h3>
            <p className="m">Several panels can share a sheet. Panels not ticked are drawn on their own sheet; feeders to them end in “to … — sheet N”.</p>
            <div className="ds-pick">
              {boards.map((b) => {
                let d = 0, x = b;
                while (x.upstreamId && d < 20) { d++; x = project.boards.find((y) => y.id === x.upstreamId) ?? x; if (!x.upstreamId) break; }
                const on = editSheet.boards.includes(b.id);
                return (
                  <label key={b.id} className="row" style={{ paddingLeft: d * 14 }}>
                    <input type="checkbox" checked={on} onChange={() => setSheet(editSheet.id, { boards: on ? editSheet.boards.filter((y) => y !== b.id) : boards.filter((y) => y.id === b.id || editSheet.boards.includes(y.id)).map((y) => y.id) })} />
                    {b.id} <span className="m">{b.kind}</span>
                  </label>
                );
              })}
            </div>
            <div className="modal-actions"><span className="sp" /><button className="chip primary" onClick={() => setEditing(null)}>Done</button></div>
          </div>
        </div>
      )}

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal ds-preview" onClick={(e) => e.stopPropagation()}>
            <h3>{set.sheets.find((s) => s.id === preview.id)?.number} — {preview.size}{!preview.fits && <span className="warn"> · crowded even on A1: split this sheet</span>}</h3>
            <SheetPreview html={preview.html} size={preview.size} />
            <div className="modal-actions"><span className="sp" /><button className="chip" onClick={() => setPreview(null)}>Close</button></div>
          </div>
        </div>
      )}
    </Page>
  );
}
