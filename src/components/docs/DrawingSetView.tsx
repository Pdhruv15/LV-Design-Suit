import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Project } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { evaluateProject } from '../../calc/electrical';
import { buildAnnotations } from '../../diagram/annotations';
import { printableSvg } from '../../diagram/exportSvg';
import { boardsInSupplyOrder } from '../../calc/summary';
import { autoSheets, autoSize, registerHtml, renumber, setOf, sheetProject, SIZES, type DrawingSet, type DrawingSheet, type SheetSize } from '../../model/drawingSet';
import { buildSldSheetHtml } from '../../docs/sldSheet';
import { mergePdfs } from '../../docs/mergePdf';
import { currentRevision, revisionStamp } from '../../model/revisions';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import SystemDiagram from '../SystemDiagram';
import SingleLineDiagram from '../SingleLineDiagram';
import { Page } from '../ui';

const noop = () => {};

/** Draws one sheet off-screen and returns printable SVG with its size in px. */
async function renderSheet(project: Project, set: DrawingSet, s: DrawingSheet, run?: CalcRun): Promise<{ svg: string; w: number; h: number } | undefined> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:2400px;height:1400px;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    if (s.kind === 'board') {
      const b = project.boards.find((x) => x.id === s.boards[0]);
      if (!b) return undefined;
      const results = (run?.results ?? evaluateProject(project)).filter((r) => r.feeder.boardId === b.id);
      flushSync(() => root.render(<div className="sld-print"><SingleLineDiagram board={b} voltageV={project.voltageV} results={results} selected={null} onSelect={noop} /></div>));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const svg = host.querySelector<SVGSVGElement>('svg');
      if (!svg) return undefined;
      const [, , w, h] = (svg.getAttribute('viewBox') ?? '0 0 1000 345').split(' ').map(Number);
      return { svg: printableSvg(svg, w, h), w, h };
    }
    const drawing = sheetProject(project, set, s);
    const results = evaluateProject(drawing);
    flushSync(() => root.render(
      <SystemDiagram project={drawing} calcProject={drawing} results={results} annotations={buildAnnotations(drawing, results)}
        selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} />
    ));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const svg = host.querySelector<SVGSVGElement>('.sysdiag svg');
    if (!svg) return undefined;
    const w = Number(svg.dataset.w), h = Number(svg.dataset.h);
    return { svg: printableSvg(svg, w, h), w, h };
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Reports → Drawing set: the SLD as numbered sheets — which panels on
 * each, size chosen from what's drawn, DB circuit diagrams only when wanted,
 * exported as one PDF with a register or a PDF per sheet. */
export default function DrawingSetView({ project, run, onChange, onStatus }: { project: Project; run?: CalcRun; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const set = setOf(project);
  const save = (next: DrawingSet) => onChange({ ...project, drawingSet: next });
  const setSheet = (id: string, patch: Partial<DrawingSheet>) => save({ ...set, sheets: set.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const [dbSheets, setDbSheets] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; svg: string; size: SheetSize; fits: boolean } | null>(null);
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
    const r = await renderSheet(project, set, s, run);
    if (!r) return undefined;
    const a = autoSize(r.w, r.h);
    const size = s.size === 'auto' ? a.size : s.size;
    setSizes((x) => ({ ...x, [s.id]: { size, fits: a.fits || s.size !== 'auto' } }));
    return { ...r, size, fits: a.fits };
  }

  async function exportSet(each: boolean) {
    if (!set.sheets.length) return;
    setBusy(each ? 'each' : 'set');
    try {
      const rev = currentRevision(project);
      const pages: { html: string; size: SheetSize; s: DrawingSheet }[] = [];
      for (const [i, s] of set.sheets.entries()) {
        if (!s.boards.length) continue;
        const r = await sizeOf(s);
        if (!r) continue;
        pages.push({ s, size: r.size, html: buildSldSheetHtml(project, r.svg, r.size, { no: s.number, title: s.title, count: set.sheets.length, index: i + 1 }) });
      }
      const toBytes = window.lvds?.files?.pdfBytes;
      if (each || !toBytes) {
        let n = 0;
        for (const p of pages) if (await savePdf(`${safeFileName(`${p.s.number} ${p.s.title}`)}.pdf`, p.html, { pageSize: p.size, landscape: true })) n++;
        onStatus(`Saved ${n} of ${pages.length} sheets${!toBytes && !each ? ' (one PDF per sheet — the combined set needs the desktop app)' : ''}`);
        return;
      }
      const parts: Uint8Array[] = [];
      if (set.register) parts.push(await toBytes({ html: registerHtml(project, pages.map((p) => ({ number: p.s.number, title: p.s.title, size: p.size })), rev?.id ?? '—', rev?.date ?? new Date().toISOString().slice(0, 10)), cssPages: true }));
      for (const p of pages) parts.push(await toBytes({ html: p.html, cssPages: true }));
      const bytes = await mergePdfs(parts, `${project.name} · SLD set · ${revisionStamp(project)}`);
      const m = await saveBinary(`${safeFileName(`${project.name} SLD drawing set`)}.pdf`, bytes, 'PDF', 'pdf', 'application/pdf');
      if (m) onStatus(`${m} — ${pages.length} sheets${set.register ? ' + register' : ''}`);
    } catch (e) {
      onStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
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
        <label className="row"><input type="checkbox" checked={dbSheets} onChange={(e) => setDbSheets(e.target.checked)} /> Also a circuit diagram for every DB</label>
        <span className="sp" />
        <label className="row">Numbers <input className="bi-text" style={{ width: 80 }} defaultValue={set.prefix} key={set.prefix} onBlur={(e) => save(renumber({ ...set, prefix: e.target.value || 'E-SLD-' }))} />001…</label>
        <label className="row"><input type="checkbox" checked={!!set.register} onChange={(e) => save({ ...set, register: e.target.checked })} /> Drawing register first</label>
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
                <button className="chip" disabled={!s.boards.length} onClick={async () => { const r = await sizeOf(s); if (r) setPreview({ id: s.id, svg: r.svg, size: r.size, fits: r.fits }); }}>Preview</button>
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
            <div className="ds-paper" dangerouslySetInnerHTML={{ __html: preview.svg }} />
            <div className="modal-actions"><span className="sp" /><button className="chip" onClick={() => setPreview(null)}>Close</button></div>
          </div>
        </div>
      )}
    </Page>
  );
}
