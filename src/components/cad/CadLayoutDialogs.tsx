import { useRef, useState } from 'react';
import { Modal } from '../ui';
import { PLAN_LABEL, PLAN_TYPES } from '../../docs/planLayout';
import { LAYOUT_PAPERS, paperName, type DrawingLayout } from '../../model/drawingLayouts';
import type { PlanType } from '../../model/drawingSet';
import { loadLayoutTemplates, parseLayoutTemplate, saveLayoutTemplates, withLayoutTemplate, type LayoutTemplate } from '../../model/layoutTemplates';
import { MORE_SCALES, VP_SCALES } from '../../model/planViewports';
import { safeFileName, saveText } from '../../util/files';

/** Design CAD → Output → Layout: the layout templates (save, new from one, import, export, delete), a layout's paper and
 * the project's scale list for viewports. */

const scalesText = (t: LayoutTemplate) => (t.viewports.length ? `${t.viewports.length} · ${t.viewports.map((v) => (v.scale ? `1:${v.scale}` : 'fit')).join(', ')}` : '0');

/** Layout templates: the library of layouts saved for new ones; a new layout of the drawing or a plan sheet of the level
 * is made from the one picked. */
export function LayoutTemplatesDialog({ current, canSheet, onNew, onStatus, onClose }: {
  /** The layout showing, to save as a template (none on the Model tab). */
  current?: { name: string; make: (name: string) => LayoutTemplate };
  /** A plan sheet of the level can be made (the drawing has a level). */
  canSheet: boolean;
  onNew: (t: LayoutTemplate, as: 'drawing' | PlanType) => void;
  onStatus: (m: string) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState(loadLayoutTemplates);
  const [picked, setPicked] = useState<string | undefined>(list[0]?.id);
  const [name, setName] = useState(current?.name ?? '');
  const [as, setAs] = useState<'drawing' | PlanType>('drawing');
  const file = useRef<HTMLInputElement>(null);
  const t = list.find((x) => x.id === picked);
  const keep = (next: LayoutTemplate[]) => { setList(next); saveLayoutTemplates(next); };
  const save = () => {
    if (!current || !name.trim()) return;
    const made = current.make(name.trim()), next = withLayoutTemplate(list, made);
    keep(next); setPicked(next.find((x) => x.name.toLowerCase() === made.name.toLowerCase())?.id);
    onStatus(`Layout template ${made.name} saved to your library`);
  };
  return (
    <Modal onClose={onClose} className="modal" style={{ maxWidth: 640 }} label="Layout templates">
      <h3>Layout templates <span className="m">your library</span></h3>
      <table className="sched" aria-label="Layout templates">
        <thead><tr><th>Name</th><th>Paper</th><th>Viewports</th><th>Tables</th></tr></thead>
        <tbody>{list.length ? list.map((x) => (
          <tr key={x.id} onClick={() => setPicked(x.id)} aria-selected={picked === x.id} style={{ cursor: 'pointer', fontWeight: picked === x.id ? 600 : undefined }}>
            <td>{x.name}</td><td>{paperName(x.paper)}</td><td>{scalesText(x)}</td><td>{x.tables?.length || '—'}</td>
          </tr>
        )) : <tr><td colSpan={4} className="m">No layout templates yet: open a layout and save it as one.</td></tr>}</tbody>
      </table>
      <div className="cad-devform">
        {current ? <>
          <label>Save this layout as<input aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="chip" disabled={!name.trim()} onClick={save}>Save as template</button>
        </> : <span className="m">Open a layout tab to save it as a template.</span>}
        {t && <label>New layout as
          <select aria-label="New layout as" value={as} onChange={(e) => setAs(e.target.value as 'drawing' | PlanType)}>
            <option value="drawing">Layout of this drawing</option>
            {PLAN_TYPES.map((p) => <option key={p} value={p} disabled={!canSheet}>{PLAN_LABEL[p]}</option>)}
          </select>
        </label>}
      </div>
      <div className="modal-actions">
        <button className="chip" onClick={onClose}>Close</button>
        <button className="chip" onClick={() => file.current?.click()}>Import…</button>
        <input ref={file} type="file" accept=".json" aria-label="Layout template file" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
          let v: LayoutTemplate | undefined;
          try { v = parseLayoutTemplate(JSON.parse(await f.text())); } catch { v = undefined; }
          if (!v) { onStatus('That file is not a layout template'); return; }
          const next = withLayoutTemplate(list, v);
          keep(next); setPicked(next.find((x) => x.name.toLowerCase() === v!.name.toLowerCase())?.id);
          onStatus(`Layout template ${v.name} imported`);
        }} />
        <button className="chip" disabled={!t} onClick={async () => { if (!t) return; const m = await saveText(`${safeFileName(t.name)}.layout.json`, JSON.stringify(t, null, 2), 'Layout template', 'json'); if (m) onStatus(m); }}>Export…</button>
        <button className="chip" disabled={!t} onClick={() => { if (!t) return; const next = list.filter((x) => x.id !== t.id); keep(next); setPicked(next[0]?.id); onStatus(`Layout template ${t.name} deleted`); }}>Delete</button>
        <span className="sp" />
        <button className="chip primary" disabled={!t} onClick={() => { if (!t) return; onNew(t, as); onClose(); }}>New layout</button>
      </div>
    </Modal>
  );
}

/** A layout's paper: the size and orientation; its viewports keep their place and scale. */
export function LayoutPaperDialog({ layout, onSave, onClose }: { layout: DrawingLayout; onSave: (paper: [number, number]) => void; onClose: () => void }) {
  const [w, h] = layout.paper;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const hit = LAYOUT_PAPERS.find((p) => (near(w, p.mm[0]) && near(h, p.mm[1])) || (near(w, p.mm[1]) && near(h, p.mm[0])));
  const [id, setId] = useState(hit?.id ?? 'custom');
  const [portrait, setPortrait] = useState(h > w);
  const mm = LAYOUT_PAPERS.find((p) => p.id === id)?.mm;
  const [long, short] = mm ?? [Math.max(w, h), Math.min(w, h)]; // a paper not in the list turns with the orientation too
  const paper: [number, number] = portrait ? [short, long] : [long, short];
  const n = layout.viewports.length;
  return (
    <Modal onClose={onClose} className="modal" style={{ maxWidth: 420 }} label="Page setup">
      <h3>Page setup <span className="m">{layout.name}</span></h3>
      <div className="cad-devform">
        <label>Paper
          <select aria-label="Paper" value={id} onChange={(e) => setId(e.target.value)}>
            {!hit && <option value="custom">{paperName(layout.paper)}</option>}
            {LAYOUT_PAPERS.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Orientation">
          <button className={portrait ? undefined : 'on'} aria-pressed={!portrait} onClick={() => setPortrait(false)}>Landscape</button>
          <button className={portrait ? 'on' : undefined} aria-pressed={portrait} onClick={() => setPortrait(true)}>Portrait</button>
        </div>
        <span className="m">{n === 1 ? 'Its viewport keeps its place and scale.' : `Its ${n} viewports keep their place and scale.`}</span>
      </div>
      <div className="modal-actions">
        <button className="chip" onClick={onClose}>Cancel</button>
        <span className="sp" />
        <button className="chip primary" onClick={() => { onSave(paper); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

/** The scale list: the scales offered for viewports in this project (SCALELISTEDIT). */
export function ScaleListDialog({ scales, onSave, onClose }: { scales: number[]; onSave: (list: number[]) => void; onClose: () => void }) {
  const [ticked, setTicked] = useState(() => new Set(scales));
  const [extra, setExtra] = useState<number[]>([]);
  const [add, setAdd] = useState('');
  const all = [...new Set([...VP_SCALES, ...MORE_SCALES, ...scales, ...extra])].sort((a, b) => a - b);
  const flip = (k: number, on: boolean) => { const n = new Set(ticked); if (on) n.add(k); else n.delete(k); setTicked(n); };
  const addOne = () => {
    const k = Math.round(Number(add));
    if (!(k > 0) || all.includes(k)) { setAdd(''); return; }
    setExtra([...extra, k]); flip(k, true); setAdd('');
  };
  return (
    <Modal onClose={onClose} className="modal" style={{ maxWidth: 420 }} label="Scale list">
      <h3>Scale list <span className="m">viewport scales of this project</span></h3>
      <div className="pub-list" role="group" aria-label="Scales">
        {all.map((k) => <label key={k}><input type="checkbox" checked={ticked.has(k)} onChange={(e) => flip(k, e.target.checked)} /> 1:{k}</label>)}
      </div>
      <div className="cad-devform">
        <label>Add 1:<input aria-label="New scale" inputMode="numeric" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } }} /></label>
        <button className="chip" onClick={addOne}>Add</button>
      </div>
      <div className="modal-actions">
        <button className="chip" onClick={onClose}>Cancel</button>
        <button className="chip" onClick={() => setTicked(new Set(VP_SCALES))}>Standard list</button>
        <span className="sp" />
        <button className="chip primary" disabled={!ticked.size} onClick={() => { onSave(all.filter((k) => ticked.has(k))); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}
