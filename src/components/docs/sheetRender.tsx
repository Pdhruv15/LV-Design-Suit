import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Project } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { evaluateProject } from '../../calc/electrical';
import { buildAnnotations, SHEET_LAYERS } from '../../diagram/annotations';
import { printableSvg } from '../../diagram/exportSvg';
import { autoSize, registerHtml, sheetProject, sheetRev, type DrawingSet, type DrawingSheet, type SheetSize } from '../../model/drawingSet';
import { buildSldSheetHtml, type SheetInfo } from '../../docs/sldSheet';
import { mergePdfs } from '../../docs/mergePdf';
import { currentRevision, revisionStamp } from '../../model/revisions';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { SHEET_MM } from '../../docs/sldSheet';
import SystemDiagram from '../SystemDiagram';
import SingleLineDiagram from '../SingleLineDiagram';

const noop = () => {};

/** Draws one sheet off-screen and returns printable SVG with its size in px. */
export async function renderSheet(project: Project, set: DrawingSet, s: DrawingSheet, run?: CalcRun): Promise<{ svg: string; w: number; h: number } | undefined> {
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
      <SystemDiagram project={drawing} calcProject={drawing} results={results} annotations={buildAnnotations(drawing, results)} layers={set.tags ?? SHEET_LAYERS}
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


/** Title block values of sheet i of the set. */
export const sheetInfo = (set: DrawingSet, s: DrawingSheet, i: number): SheetInfo => ({
  no: s.number, title: s.title, count: set.sheets.length, index: i + 1, status: s.status || set.status || undefined,
  rev: s.rev || undefined, date: s.date || undefined, drawnBy: s.drawnBy || undefined, checkedBy: s.checkedBy || undefined, approvedBy: s.approvedBy || undefined, scale: s.scale || undefined,
  history: s.history?.map((h) => ({ id: h.rev, date: h.date, description: h.description }))
});

/** The finished sheet (frame, drawing, title block) as HTML, with its size. */
export async function sheetHtml(project: Project, set: DrawingSet, s: DrawingSheet, run?: CalcRun): Promise<{ html: string; size: SheetSize; fits: boolean } | undefined> {
  const r = await renderSheet(project, set, s, run);
  if (!r) return undefined;
  const a = autoSize(r.w, r.h);
  const size = s.size === 'auto' ? a.size : s.size;
  return { html: buildSldSheetHtml(project, r.svg, size, sheetInfo(set, s, set.sheets.indexOf(s))), size, fits: a.fits || s.size !== 'auto' };
}

/** Every sheet as one PDF (register first, when on) or a PDF per sheet. */
export async function exportDrawingSet(project: Project, set: DrawingSet, run: CalcRun | undefined, each: boolean, onStatus: (m: string) => void, only?: string[], withRegister = !only): Promise<void> {
  try {
    const rev = currentRevision(project);
    const pages: { html: string; size: SheetSize; s: DrawingSheet }[] = [];
    for (const s of set.sheets) {
      if (!s.boards.length || (only && !only.includes(s.id))) continue;
      const r = await sheetHtml(project, set, s, run);
      if (r) pages.push({ s, size: r.size, html: r.html });
    }
    const toBytes = window.lvds?.files?.pdfBytes;
    if (each || !toBytes) {
      let n = 0;
      for (const p of pages) if (await savePdf(`${safeFileName(`${p.s.number} ${p.s.title}`)}.pdf`, p.html, { pageSize: p.size, landscape: true })) n++;
      onStatus(`Saved ${n} of ${pages.length} sheets${!toBytes && !each ? ' (one PDF per sheet — the combined set needs the desktop app)' : ''}`);
      return;
    }
    const parts: Uint8Array[] = [];
    const reg = set.register && withRegister;
    if (reg) {
      const sizes = pages.map((p) => [p.s.id, p.size] as [string, string]);
      const rows = registerRows(only ? { ...set, sheets: set.sheets.filter((s) => only.includes(s.id)) } : set, sizes, rev?.id);
      parts.push(await toBytes({ html: registerHtml(project, rows, rev?.id ?? '—', rev?.date ?? new Date().toISOString().slice(0, 10), set.issues, project.drawing?.company ?? project.info?.consultant ?? ''), cssPages: true }));
    }
    for (const p of pages) parts.push(await toBytes({ html: p.html, cssPages: true }));
    const titles = [...(reg ? ['Drawing register'] : []), ...pages.map((p) => `${p.s.number}  ${p.s.title}`)];
    const bytes = await mergePdfs(parts, `${project.name} · SLD set · ${revisionStamp(project)}`, titles);
    const m = await saveBinary(`${safeFileName(`${project.name} SLD drawing set`)}.pdf`, bytes, 'PDF', 'pdf', 'application/pdf');
    if (m) onStatus(`${m} — ${pages.length} sheets${reg ? ' + register' : ''}`);
  } catch (e) {
    onStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Register rows with each sheet's own revision, date and status. */
export const registerRows = (set: DrawingSet, sizes: [string, string][] = [], projectRev?: string) => {
  const m = new Map(sizes);
  return set.sheets.map((s) => ({ number: s.number, title: s.title, size: m.get(s.id) ?? (s.size === 'auto' ? 'Auto' : s.size), rev: sheetRev(s, projectRev) || undefined, date: s.date || s.history?.[s.history.length - 1]?.date, status: s.status || set.status }));
};

/** The finished sheet, scaled to fit the dialog. */
export function SheetPreview({ html, size }: { html: string; size: SheetSize }) {
  const { w, h } = SHEET_MM[size];
  const pxW = w * 3.78, pxH = h * 3.78;
  const scale = Math.min(1, 1100 / pxW, 600 / pxH);
  return (
    <div className="ds-sheet" style={{ width: pxW * scale, height: pxH * scale }}>
      <iframe title="Sheet preview" srcDoc={html} sandbox="" style={{ width: pxW, height: pxH, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, background: '#fff' }} />
    </div>
  );
}
