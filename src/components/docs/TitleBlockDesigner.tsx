import { useMemo, useRef, useState } from 'react';
import type { Project } from '../../types';
import {
  addCol, addRow, loadTemplateLibrary, mergeDown, mergeRight, removeCol, removeRow, saveTemplateLibrary, split, standardTemplate, titleBlockHtml, type TbCell, type TitleTemplate
} from '../../model/titleBlock';
import { fillParams, paramList } from '../../model/params';
import { saveText } from '../../util/files';
import { Page } from '../ui';

const PX = 3.2; // preview px per mm

/** Design title blocks: a grid of cells with text and {Parameters}, the
 * logo or the revision table; merge / split cells, add rows and columns,
 * set sizes. Save several templates, pick the one the SLD sheet uses, keep
 * them as your library or share them as a file. */
export default function TitleBlockDesigner({ project, onChange, onStatus, onParams }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void; onParams: () => void }) {
  const templates = project.titleTemplates ?? [];
  const [sel, setSel] = useState(templates[0]?.id ?? '');
  const t = templates.find((x) => x.id === sel) ?? templates[0];
  const [cellId, setCellId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const params = useMemo(() => paramList(project).map((x) => x.name), [project]);
  const active = project.drawing?.titleTemplateId;

  const setTemplates = (next: TitleTemplate[]) => onChange({ ...project, titleTemplates: next });
  const setT = (next: TitleTemplate) => setTemplates(templates.map((x) => (x.id === next.id ? next : x)));
  const create = (base: TitleTemplate, name: string) => {
    const nt = { ...structuredClone(base), id: `tb-${Date.now().toString(36)}`, name };
    setTemplates([...templates, nt]);
    setSel(nt.id);
  };
  const cell = t?.cells.find((x) => x.id === cellId);
  const setCell = (patch: Partial<TbCell>) => t && cell && setT({ ...t, cells: t.cells.map((x) => (x.id === cell.id ? { ...x, ...patch } : x)) });

  if (!t) {
    return (
      <Page title="Title block designer" intro="Make your own title blocks for the SLD sheet: your layout, logo, text and {Parameters} such as {DesignedBy} and {SubmissionDate}.">
        <div className="card">
          <p>No title block template in this project yet.</p>
          <button className="chip primary" onClick={() => create(standardTemplate(), 'My title block')}>Start from the standard block</button>
          {loadTemplateLibrary().map((x) => <button key={x.id} className="chip" onClick={() => create(x, x.name)}>From my library: {x.name}</button>)}
        </div>
      </Page>
    );
  }

  const W = t.cols.reduce((a, b) => a + b, 0), H = t.rows.reduce((a, b) => a + b, 0);
  const covered = new Set<string>();
  for (const c of t.cells) for (let r = c.r; r < c.r + (c.rs ?? 1); r++) for (let k = c.c; k < c.c + (c.cs ?? 1); k++) covered.add(`${r},${k}`);
  const list = paramList(project);

  return (
    <Page
      title="Title block designer"
      intro="Click a cell to edit it. Text can hold {Parameters} (Home → Parameters). The SLD sheet uses the template marked “Used on the SLD”."
      actions={<>
        <select className="chip" value={t.id} onChange={(e) => { setSel(e.target.value); setCellId(''); }}>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === active ? ' (used on the SLD)' : ''}</option>)}
        </select>
        <button className="chip" onClick={() => create(standardTemplate(), `Title block ${templates.length + 1}`)}>New</button>
        <button className="chip" onClick={() => create(t, `${t.name} (copy)`)}>Duplicate</button>
        <button className={`chip${t.id === active ? '' : ' primary'}`} onClick={() => onChange({ ...project, drawing: { ...project.drawing, titleTemplateId: t.id === active ? undefined : t.id } })}>
          {t.id === active ? 'Use the standard block instead' : 'Use on the SLD'}
        </button>
      </>}
    >
      <div className="tbd-grid">
        <div>
          <div className="tbd-preview-wrap">
            <div className="tbd-preview" style={{ width: W * PX, height: H * PX, gridTemplateColumns: t.cols.map((c) => `${c * PX}px`).join(' '), gridTemplateRows: t.rows.map((r) => `${r * PX}px`).join(' ') }}>
              {t.cells.map((c) => (
                <button key={c.id} className={`tbd-cell${c.id === cellId ? ' on' : ''}`} onClick={() => setCellId(c.id)}
                  style={{ gridRow: `${c.r + 1} / span ${c.rs ?? 1}`, gridColumn: `${c.c + 1} / span ${c.cs ?? 1}`, textAlign: c.align ?? 'left' }}>
                  {c.caption && <span className="tbd-cap">{c.caption}</span>}
                  <span style={{ fontSize: (c.size ?? 8) * 1.25, fontWeight: c.bold ? 700 : 400 }}>
                    {c.kind === 'logo' ? (project.drawing?.logo ? <img src={project.drawing.logo} alt="" style={{ maxWidth: '100%', maxHeight: (t.rows[c.r] * (c.rs ?? 1)) * PX - 6 }} /> : <i>logo</i>)
                      : c.kind === 'revisions' ? <i>revision table</i> : fillParams(c.text, project, {}, list) || <i className="m">empty</i>}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <p className="m">{W} × {H} mm · {t.cols.length} columns × {t.rows.length} rows</p>
          <div className="tbd-sizes">
            <span className="m">Column widths (mm):</span>
            {t.cols.map((w, i) => <input key={`c${i}-${w}`} className="bi-num" style={{ width: 52 }} defaultValue={w} onBlur={(e) => { const v = +e.target.value; if (v > 3) setT({ ...t, cols: t.cols.map((x, k) => (k === i ? v : x)) }); }} />)}
          </div>
          <div className="tbd-sizes">
            <span className="m">Row heights (mm):</span>
            {t.rows.map((h, i) => <input key={`r${i}-${h}`} className="bi-num" style={{ width: 52 }} defaultValue={h} onBlur={(e) => { const v = +e.target.value; if (v > 2) setT({ ...t, rows: t.rows.map((x, k) => (k === i ? v : x)) }); }} />)}
          </div>
          <div className="tbd-sizes">
            <span className="m">Name:</span>
            <input className="bi-text" style={{ width: 220 }} defaultValue={t.name} key={t.name} onBlur={(e) => e.target.value.trim() && setT({ ...t, name: e.target.value.trim() })} />
            <button className="chip" onClick={() => { const lib = loadTemplateLibrary().filter((x) => x.name !== t.name); onStatus(saveTemplateLibrary([...lib, t]) ? `Saved “${t.name}” to your library on this computer` : 'Could not save the library'); }}>Save to my library</button>
            <button className="chip" onClick={async () => { const m = await saveText(`${t.name}.titleblock.json`, JSON.stringify(t, null, 2), 'Title block', 'json'); if (m) onStatus(m); }}>Export</button>
            <button className="chip" onClick={() => fileRef.current?.click()}>Import</button>
            <input ref={fileRef} type="file" accept=".json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (!f) return;
              try { const x = JSON.parse(await f.text()) as TitleTemplate; if (!Array.isArray(x.cells) || !Array.isArray(x.cols)) throw new Error(); create(x, x.name || 'Imported'); onStatus(`Imported “${x.name}”`); } catch { onStatus('That file is not a title block'); }
            }} />
            <button className="linkish bad" onClick={() => { if (window.confirm(`Delete “${t.name}”?`)) { setTemplates(templates.filter((x) => x.id !== t.id)); if (active === t.id) onChange({ ...project, titleTemplates: templates.filter((x) => x.id !== t.id), drawing: { ...project.drawing, titleTemplateId: undefined } }); setSel(''); } }}>Delete</button>
          </div>
        </div>

        <section className="card tbd-side">
          {!cell ? <p className="m">Click a cell in the block to edit it.</p> : (
            <>
              <h4 style={{ margin: 0 }}>Cell (row {cell.r + 1}, column {cell.c + 1})</h4>
              <label>Holds
                <select value={cell.kind} onChange={(e) => setCell({ kind: e.target.value as TbCell['kind'] })}>
                  <option value="text">Text and parameters</option>
                  <option value="logo">Company logo</option>
                  <option value="revisions">Revision table (last 4)</option>
                </select>
              </label>
              <label>Caption (small, top left)<input value={cell.caption ?? ''} onChange={(e) => setCell({ caption: e.target.value || undefined })} placeholder="e.g. DESIGNED BY" /></label>
              {cell.kind === 'text' && (
                <>
                  <label>Text<textarea value={cell.text} onChange={(e) => setCell({ text: e.target.value })} rows={3} /></label>
                  <div className="tbd-params">
                    {params.slice(0, 40).map((n) => <button key={n} className="param-chip" onClick={() => setCell({ text: `${cell.text}{${n}}` })}>{`{${n}}`}</button>)}
                    <button className="linkish" onClick={onParams}>all parameters…</button>
                  </div>
                  <div className="tbd-row">
                    <label>Size (pt)<input type="number" min={5} max={24} value={cell.size ?? 8} onChange={(e) => setCell({ size: +e.target.value || 8 })} /></label>
                    <label className="row"><input type="checkbox" checked={!!cell.bold} onChange={(e) => setCell({ bold: e.target.checked || undefined })} /> Bold</label>
                    <label>Align
                      <select value={cell.align ?? 'left'} onChange={(e) => setCell({ align: e.target.value as TbCell['align'] })}>
                        <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
              <div className="tbd-row">
                <button className="chip" onClick={() => { const n = mergeRight(t, cell.id); if (n === t) onStatus('Can’t merge right: the cells there don’t line up with this one'); else setT(n); }}>Merge right</button>
                <button className="chip" onClick={() => { const n = mergeDown(t, cell.id); if (n === t) onStatus('Can’t merge down: the cells there don’t line up with this one'); else setT(n); }}>Merge down</button>
                {((cell.rs ?? 1) > 1 || (cell.cs ?? 1) > 1) && <button className="chip" onClick={() => setT(split(t, cell.id))}>Split</button>}
              </div>
              <div className="tbd-row">
                <button className="chip" onClick={() => setT(addRow(t, cell.r + (cell.rs ?? 1) - 1))}>+ Row below</button>
                <button className="chip" onClick={() => setT(addCol(t, cell.c + (cell.cs ?? 1) - 1))}>+ Column right</button>
              </div>
              <div className="tbd-row">
                <button className="chip" onClick={() => { setT(removeRow(t, cell.r)); setCellId(''); }}>Delete row</button>
                <button className="chip" onClick={() => { setT(removeCol(t, cell.c)); setCellId(''); }}>Delete column</button>
              </div>
            </>
          )}
          <details style={{ marginTop: 10 }}>
            <summary className="m">Printed version</summary>
            <div className="tbd-print" dangerouslySetInnerHTML={{ __html: titleBlockHtml(t, project) }} />
          </details>
        </section>
      </div>
      <p className="m">{covered.size === t.rows.length * t.cols.length ? '' : '⚠ Some grid positions are empty.'} The block sits at the bottom right of the SLD sheet, inside the frame, in PDF and DXF exports. DXF keeps the grid and text editable; raster logos are shown in the PDF.</p>
    </Page>
  );
}
