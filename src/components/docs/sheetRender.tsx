import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Project } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { evaluateProject } from '../../calc/electrical';
import { buildAnnotations, SHEET_LAYERS } from '../../diagram/annotations';
import { printableSvg } from '../../diagram/exportSvg';
import { autoSize, drawable, LEGEND_RESERVE_MM, MIN_MM_PER_PX, fromSheetLabels, registerHtml, scaleOn, sheetProject, sheetRev, type DrawingSet, type DrawingSheet, type SheetSize } from '../../model/drawingSet';
import { buildSldSheetHtml, type SheetInfo } from '../../docs/sldSheet';
import { buildSheetDxfPages } from '../../docs/sheetDxf';
import { dxfExportNotice, namedDxfFiles, uniqueDxfFiles, type DxfFile } from '../../docs/dxfFiles';
import { buildRegisterWorkbook } from '../../docs/registerWorkbook';
import { workbookBytes } from '../../docs/formWorkbook';
import JSZip from 'jszip';
import { mergePdfs } from '../../docs/mergePdf';
import { currentRevision, revisionStamp } from '../../model/revisions';
import { cableRefsUsed } from '../../model/cableRefs';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { SHEET_MM } from '../../docs/sldSheet';
import SystemDiagram, { LegendSvg } from '../SystemDiagram';
import { earthingDrawing } from '../../diagram/earthingDrawing';
import RiserDiagram, { RiserLegendSvg } from '../../diagram/RiserDiagram';
import { riserLayout } from '../../diagram/riserLayout';
import { boardIncomerLabel } from '../../docs/loadScheduleDoc';
import SingleLineDiagram from '../SingleLineDiagram';

const noop = () => {};

/** Draws one sheet off-screen and returns printable SVG with its size in px. */
export async function renderSheet(project: Project, set: DrawingSet, s: DrawingSheet, run?: CalcRun, cableRefs = false): Promise<{ svg: string; w: number; h: number } | undefined> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:2400px;height:1400px;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    if (s.kind === 'earthing') return earthingDrawing(project);
    if (s.kind === 'riser') {
      if (!s.buildingId) return undefined;
      flushSync(() => root.render(<RiserDiagram project={project} buildingId={s.buildingId!} />));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const svg = host.querySelector<SVGSVGElement>('.sysdiag svg');
      if (!svg) return undefined;
      const w = Number(svg.dataset.w), h = Number(svg.dataset.h);
      return { svg: printableSvg(svg, w, h), w, h };
    }
    if (s.kind === 'board') {
      const b = project.boards.find((x) => x.id === s.boards[0]);
      if (!b) return undefined;
      // Always the current design (a stored run may be older than the last edit).
      const results = evaluateProject(project).filter((r) => r.feeder.boardId === b.id);
      flushSync(() => root.render(<div className="sld-print"><SingleLineDiagram board={b} voltageV={project.voltageV} incomerLabel={boardIncomerLabel(project, b)} results={results} selected={null} onSelect={noop} /></div>));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const svg = host.querySelector<SVGSVGElement>('svg');
      if (!svg) return undefined;
      const [, , w, h] = (svg.getAttribute('viewBox') ?? '0 0 1000 345').split(' ').map(Number);
      return { svg: printableSvg(svg, w, h), w, h };
    }
    // Calculate the whole network (upstream voltage drop and source impedance
    // included), then draw only this sheet's panels with those results.
    const drawing = sheetProject(project, set, s);
    const full = evaluateProject(project);
    const onSheet = new Set(drawing.feeders.map((f) => f.id));
    const results = full.filter((r) => onSheet.has(r.feeder.id));
    flushSync(() => root.render(
      <SystemDiagram project={drawing} calcProject={drawing} results={results} annotations={buildAnnotations(project, full)} layers={s.tags ?? set.tags ?? SHEET_LAYERS} cableRefs={cableRefs} hideLegend clouds={s.clouds} arrows={s.arrows} fromSheet={fromSheetLabels(project, set, s)}
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
  history: s.history?.map((h) => ({ id: h.rev, date: h.date, description: h.description })),
  notes: s.notes?.filter((n) => n.trim())
});

/** The symbol legend of what's drawn on this sheet, as printable SVG. */
async function legendOf(drawing: Project): Promise<string> {
  if (drawing.drawing?.symbols === 'simple' || drawing.drawing?.legend === false) return '';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<LegendSvg project={drawing} />));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const svg = host.querySelector<SVGSVGElement>('svg');
    return svg ? printableSvg(svg, Number(svg.dataset.w), Number(svg.dataset.h)) : '';
  } finally { root.unmount(); host.remove(); }
}

/** The riser symbols used on a building's riser sheet, as printable SVG. */
async function riserLegendOf(project: Project, buildingId: string): Promise<string> {
  const used = riserLayout(project, buildingId).used;
  if (!used.size) return '';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<RiserLegendSvg used={used} />));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const svg = host.querySelector<SVGSVGElement>('svg');
    return svg ? printableSvg(svg, Number(svg.dataset.w), Number(svg.dataset.h)) : '';
  } finally { root.unmount(); host.remove(); }
}

/** Cable text on a sheet: reference numbers (legend: CABLE SCHEDULE) when
 * chosen, or in Auto when the cable text would print smaller than ≈ 2.3 mm
 * (a large SLD squeezed onto the paper). */
export const REF_BELOW_MM_PER_PX = 0.25;
const reserveOf = (s: DrawingSheet) => (s.kind === 'board' ? 0 : LEGEND_RESERVE_MM);

/** The finished sheet (frame, drawing, title block) as HTML, with its size.
 * withLegend: show the CABLE SCHEDULE even if this sheet itself has full
 * cable text (another sheet of the set uses numbers). */
export async function sheetHtml(project: Project, set: DrawingSet, s: DrawingSheet, run?: CalcRun, withLegend = false, withMarkups = true): Promise<{ html: string; size: SheetSize; fits: boolean; refs: boolean; svg: string; legendSvg: string } | undefined> {
  const mode = s.cableLabels ?? project.drawing?.cableLabels ?? 'auto';
  let refs = mode === 'ref' && s.kind === 'system';
  let r = await renderSheet(project, set, s, run, refs);
  if (!r) return undefined;
  const a = autoSize(r.w, r.h, reserveOf(s));
  const size = s.size === 'auto' ? a.size : s.size;
  if (mode === 'auto' && s.kind === 'system' && (!a.fits || scaleOn(size, r.w, r.h, reserveOf(s)) < REF_BELOW_MM_PER_PX)) {
    refs = true;
    r = (await renderSheet(project, set, s, run, true)) ?? r;
  }
  const legendSvg = s.kind === 'system' ? await legendOf(sheetProject(project, set, s)) : s.kind === 'riser' && s.buildingId ? await riserLegendOf(project, s.buildingId) : '';
  const html = sheetHtmlFrom(project, set, s, r.svg, size, refs || withLegend, legendSvg, withMarkups);
  // Readable on the paper actually used (a chosen A3 can be too small too).
  return { html, size, fits: scaleOn(size, r.w, r.h, reserveOf(s)) >= MIN_MM_PER_PX, refs, svg: r.svg, legendSvg };
}

/** Sheet HTML from a drawn SVG (legend: every cable number used in the set). */
export function sheetHtmlFrom(project: Project, set: DrawingSet, s: DrawingSheet, svg: string, size: SheetSize, legend: boolean, legendSvg = '', withMarkups = true): string {
  return buildSldSheetHtml(project, svg, size, fullSheetInfo(project, set, s, legend, legendSvg, withMarkups));
}

/** Title block values, legend and cable schedule of one sheet (PDF and DXF). */
export function fullSheetInfo(project: Project, set: DrawingSet, s: DrawingSheet, legend: boolean, legendSvg = '', withMarkups = true): SheetInfo {
  const info: SheetInfo = { ...sheetInfo(set, s, set.sheets.indexOf(s)), legendSvg, ...(withMarkups && s.markups?.length ? { markups: s.markups } : {}) };
  if (legend) {
    const boards = new Set(set.sheets.flatMap((x) => (x.kind === 'system' ? x.boards : [])));
    info.cables = cableRefsUsed(project, project.feeders.filter((f) => boards.has(f.boardId)));
  }
  return info;
}

/** The sheets as DXF files (real paper size in mm, frame, title block,
 * legend column, layers): one file, or a ZIP of all when several. */
export async function dxfFiles(project: Project, set: DrawingSet, run: CalcRun | undefined, only?: string[]): Promise<DxfFile[]> {
  return dxfOf(project, set, await prepareSheets(project, set, run, only));
}

/** DXF files of prepared sheets (same cable-schedule rule as the PDFs). */
export function dxfOf(project: Project, set: DrawingSet, pages: PreparedSheet[]): DxfFile[] {
  const anyRefs = pages.some((p) => p.refs);
  return uniqueDxfFiles(pages.flatMap((p) => namedDxfFiles(
    safeFileName(`${p.s.number}${p.s.rev || sheetRev(p.s) ? `_Rev${p.s.rev || sheetRev(p.s)}` : ''}`),
    buildSheetDxfPages(project, p.svg, p.size, fullSheetInfo(project, set, p.s, anyRefs && p.s.kind === 'system', p.legendSvg))
  )));
}

export async function exportSheetsDxf(project: Project, set: DrawingSet, run: CalcRun | undefined, onStatus: (m: string) => void, only?: string[]): Promise<void> {
  try {
    const files = await dxfFiles(project, set, run, only);
    if (!files.length) { onStatus('No sheets to export'); return; }
    const notice = dxfExportNotice(files);
    if (files.length === 1) {
      const m = await saveBinary(files[0].name, new TextEncoder().encode(files[0].data), 'DXF', 'dxf', 'application/dxf');
      if (m) onStatus(`${m}${notice ? ` — ${notice}` : ''}`);
      return;
    }
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.data);
    const m = await saveBinary(`${safeFileName(`${project.name} drawings DXF`)}.zip`, await zip.generateAsync({ type: 'uint8array' }), 'ZIP', 'zip', 'application/zip');
    if (m) onStatus(`${m} — ${files.length} DXF sheets${notice ? ` — ${notice}` : ''}`);
  } catch (e) {
    onStatus(`DXF export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Everything for a submission in one ZIP: the set as one PDF (desktop),
 * a DXF per sheet, and the drawing register (Excel). */
export async function exportEverythingZip(project: Project, set: DrawingSet, run: CalcRun | undefined, onStatus: (m: string) => void): Promise<void> {
  try {
    const zip = new JSZip();
    const pages = await prepareSheets(project, set, run);
    const dxf = dxfOf(project, set, pages);
    for (const f of dxf) zip.file(`DXF/${f.name}`, f.data);
    const toBytes = window.lvds?.files?.pdfBytes;
    if (toBytes) {
      const parts: Uint8Array[] = [], titles: string[] = [];
      const rev = currentRevision(project);
      if (set.register) { parts.push(await toBytes({ html: registerHtml(project, registerRows(set, [], rev?.id), rev?.id ?? '—', rev?.date ?? new Date().toISOString().slice(0, 10), set.issues, project.drawing?.company ?? project.info?.consultant ?? ''), cssPages: true })); titles.push('Drawing register'); }
      for (const p of pages) {
        const one = await toBytes({ html: p.html, cssPages: true });
        parts.push(one); titles.push(`${p.s.number}  ${p.s.title}`);
        zip.file(`PDF/${safeFileName(`${p.s.number}${p.s.rev ? `_Rev${p.s.rev}` : ''}`)}.pdf`, one);
      }
      zip.file(`${safeFileName(`${project.name} drawing set`)}.pdf`, await mergePdfs(parts, `${project.name} · drawings · ${revisionStamp(project)}`, titles));
    }
    zip.file(`${safeFileName(`${project.name} drawing register`)}.xlsx`, await workbookBytes(buildRegisterWorkbook(project, set)));
    const m = await saveBinary(`${safeFileName(`${project.name} drawings`)}.zip`, await zip.generateAsync({ type: 'uint8array' }), 'ZIP', 'zip', 'application/zip');
    const notice = dxfExportNotice(dxf);
    if (m) onStatus(`${m} — ${dxf.length} DXF${toBytes ? ' + PDFs' : ' (PDFs need the desktop app)'} + register${notice ? ` — ${notice}` : ''}`);
  } catch (e) {
    onStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Every sheet as one PDF (register first, when on) or a PDF per sheet. */
export interface PreparedSheet { s: DrawingSheet; html: string; size: SheetSize; fits: boolean; refs: boolean; svg: string; legendSvg: string }
/** The sheets as they print, for every export (one PDF, PDF per sheet, DXF,
 * ZIP): drawn from the current design, and when any sheet uses cable
 * numbers the CABLE SCHEDULE goes on every SLD sheet. */
export async function prepareSheets(project: Project, set: DrawingSet, run?: CalcRun, only?: string[]): Promise<PreparedSheet[]> {
  const pages: PreparedSheet[] = [];
  for (const s of set.sheets) {
    if (!drawable(s) || (only && !only.includes(s.id))) continue;
    const r = await sheetHtml(project, set, s, run);
    if (r) pages.push({ s, ...r });
  }
  if (pages.some((p) => p.refs)) for (const p of pages) if (!p.refs && p.s.kind === 'system') p.html = sheetHtmlFrom(project, set, p.s, p.svg, p.size, true, p.legendSvg);
  return pages;
}

export async function exportDrawingSet(project: Project, set: DrawingSet, run: CalcRun | undefined, each: boolean, onStatus: (m: string) => void, only?: string[], withRegister = !only): Promise<void> {
  try {
    const rev = currentRevision(project);
    const pages = await prepareSheets(project, set, run, only);
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
