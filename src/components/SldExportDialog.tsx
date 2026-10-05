import { useState } from 'react';
import type { DrawingInfo, Project } from '../types';
import { buildSldSheetHtml, DEFAULT_DRAWING_TITLE, titleBlockOf } from '../docs/sldSheet';
import { buildSheetDxfPages } from '../docs/sheetDxf';
import { dxfExportNotice, namedDxfFiles } from '../docs/dxfFiles';
import { cableRefsUsed } from '../model/cableRefs';
import { printableSvg } from '../diagram/exportSvg';
import { safeFileName, saveBinary, savePdf, saveText } from '../util/files';
import JSZip from 'jszip';

/** The diagram on screen (full extent), as printable SVG. */
function currentSvg(): { svg: string; w: number; h: number } | undefined {
  const live = document.querySelector<SVGSVGElement>('.sysdiag svg');
  if (!live) return undefined;
  const w = Number(live.dataset.w);
  const h = Number(live.dataset.h);
  return { svg: printableSvg(live, w, h), w, h };
}

/** Title block details and export of the SLD as a drawing: PDF sheet with
 * frame and title block (A3 / A2 / A1), DXF for CAD, or plain SVG. The
 * drawing shows what's on screen — result labels, colours, generator mode. */
export default function SldExportDialog({ project, onSave, onStatus, onClose, stale = false }: {
  project: Project;
  /** Results on the diagram are out of date. */
  stale?: boolean;
  onSave: (d: DrawingInfo) => void;
  onStatus: (m: string) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<DrawingInfo>({ sheet: 'A3', ...project.drawing });
  const [busy, setBusy] = useState('');
  const t = titleBlockOf({ ...project, drawing: d });
  const set = (k: keyof DrawingInfo, v: string) => setD({ ...d, [k]: v || undefined });
  const name = safeFileName(`${project.name} ${d.number || 'SLD'}`);

  async function run(kind: 'pdf' | 'dxf' | 'svg') {
    const cur = currentSvg();
    if (!cur) return onStatus('Open the system diagram first');
    onSave(d);
    setBusy(kind);
    try {
      const p = { ...project, drawing: d };
      let m: string | null = null;
      if (kind === 'pdf') {
        m = await savePdf(`${name}.pdf`, buildSldSheetHtml(p, cur.svg, d.sheet ?? 'A3'), { pageSize: d.sheet ?? 'A3', landscape: true });
      } else if (kind === 'svg') {
        m = await saveText(`${name}.svg`, cur.svg, 'SVG image', 'svg');
      } else {
        const one = d.cableLabels === 'ref' ? { no: t.number, title: t.title, index: 1, count: 1, cables: cableRefsUsed(p) } : undefined;
        const files = namedDxfFiles(name, buildSheetDxfPages(p, cur.svg, d.sheet ?? 'A3', one));
        if (files.length === 1) m = await saveText(files[0].name, files[0].data, 'DXF drawing (AutoCAD R12)', 'dxf');
        else {
          const zip = new JSZip();
          files.forEach((f) => zip.file(f.name, f.data));
          m = await saveBinary(`${name}-DXF.zip`, await zip.generateAsync({ type: 'uint8array' }), 'ZIP', 'zip', 'application/zip');
        }
        const notice = dxfExportNotice(files);
        if (m && notice) m += ` — ${notice}`;
      }
      if (m) onStatus(m);
    } catch (e) {
      onStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export SLD drawing</h3>
        {stale && <p className="warn">⚠ The result labels on the diagram are out of date — press Run (F5) first if the drawing shows results.</p>}
        <p className="m">The drawing shows the diagram as it is on screen — result labels, colours and generator mode included. Title block details are saved with the project.</p>
        <div className="grid2">
          <label style={{ gridColumn: '1 / -1' }}>Company / consultant<input value={d.company ?? ''} placeholder={project.info?.consultant ?? ''} onChange={(e) => set('company', e.target.value)} /></label>
          <label style={{ gridColumn: '1 / -1' }}>Drawing title<input value={d.title ?? ''} placeholder={DEFAULT_DRAWING_TITLE} onChange={(e) => set('title', e.target.value)} /></label>
          <label>Drawing no.<input value={d.number ?? ''} placeholder="e.g. E-SLD-001" onChange={(e) => set('number', e.target.value)} /></label>
          <label>Sheet
            <select value={d.sheet ?? 'A3'} onChange={(e) => set('sheet', e.target.value)}>
              <option value="A4">A4 landscape</option>
              <option value="A3">A3 landscape</option>
              <option value="A2">A2 landscape</option>
              <option value="A1">A1 landscape</option>
            </select>
          </label>
          <label>Drawn<input value={d.drawnBy ?? ''} onChange={(e) => set('drawnBy', e.target.value)} /></label>
          <label>Checked<input value={d.checkedBy ?? ''} onChange={(e) => set('checkedBy', e.target.value)} /></label>
          <label>Approved<input value={d.approvedBy ?? ''} onChange={(e) => set('approvedBy', e.target.value)} /></label>
          <label>Revision<input value={`${t.revision} · ${t.date}`} disabled title="From Documents → Revisions" /></label>
        </div>
        <div className="modal-actions">
          <button className="chip" onClick={() => { onSave(d); onClose(); }}>Save details</button>
          <span className="sp" />
          <button className="chip" disabled={!!busy} onClick={() => run('svg')}>{busy === 'svg' ? 'Exporting…' : 'SVG'}</button>
          <button className="chip" disabled={!!busy} onClick={() => run('dxf')} title="AutoCAD R12 DXF at the selected paper size, with editable layers and title block. Additional notes and schedules are included as continuation sheets in a ZIP.">{busy === 'dxf' ? 'Exporting…' : `DXF ${d.sheet ?? 'A3'} (CAD)`}</button>
          <button className="chip primary" disabled={!!busy} onClick={() => run('pdf')}>{busy === 'pdf' ? 'Exporting…' : `PDF ${d.sheet ?? 'A3'}`}</button>
        </div>
      </div>
    </div>
  );
}
