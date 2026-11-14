import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { layoutPaper, layoutViewports, PLAN_LABEL, PLAN_TYPES } from '../../docs/planLayout';
import { PLAN_PREFIX, renumber, setOf, startStatus, type DrawingSet, type DrawingSheet, type PlanType } from '../../model/drawingSet';
import { boxFrom, insideVp, isLocked, patchViewport, scalesOf, vpId, vpName, withViewports, type PlanViewport } from '../../model/planViewports';
import { TABLE_WIDTHS, tableName, type PlacedTable, type TableKind } from '../../model/sheetTables';
import type { PaperOverlay } from '../sld/SheetWorkspace';
import type { Project } from '../../types';

/** Design CAD → layouts (paper space), under the drawing as in industry CAD: Model, then a tab per layout of the level
 * (its plan sheets, src/model/planViewports.ts), then + for a new one. A layout tab shows the sheet's paper (the Sheets
 * page, bare) with its viewport frames over it, dashed (on screen only); a frame picked shows its properties, dragged
 * it moves, its corners resize it; a double-click inside works in the model through it (MS), outside goes back (PS). */

type Pt = [number, number];
type Level = { buildingId: string; levelId: string; name: string };

/** The level's layouts: its plan sheets, in the register's order. */
export const layoutsOf = (p: Project, lv: { buildingId: string; levelId: string } | undefined): DrawingSheet[] =>
  lv ? setOf(p).sheets.filter((s) => s.kind === 'plan' && s.buildingId === lv.buildingId && s.levelId === lv.levelId) : [];

/** A new layout of the level: a plan sheet of the type, after the set's other sheets of that type, numbered. */
export function newLayout(set: DrawingSet, lv: Level, type: PlanType, copyOf?: DrawingSheet): { set: DrawingSet; id: string } {
  const sheets = [...set.sheets];
  let id = `pl-${type}-${lv.buildingId}-${lv.levelId}-L1`;
  for (let k = 2; sheets.some((x) => x.id === id); k++) id = `pl-${type}-${lv.buildingId}-${lv.levelId}-L${k}`;
  const s: DrawingSheet = copyOf
    ? { ...copyOf, id, number: '', title: `${copyOf.title} (copy)`, history: undefined, issuedHash: undefined, issuedHashV: undefined, issuedItems: undefined, rev: undefined }
    : { id, number: '', title: `${lv.name} · ${PLAN_LABEL[type]}`, kind: 'plan', plan: type, buildingId: lv.buildingId, levelId: lv.levelId, scale: '1:100', size: 'auto', boards: [], status: startStatus(set) };
  const at = sheets.reduce((a, x, i) => (x.kind === 'plan' && x.plan === s.plan ? i + 1 : a), sheets.length);
  sheets.splice(at, 0, s);
  return { set: renumber({ ...set, sheets }), id };
}

/** A layout moved one place among the level's layouts (dir −1 left, +1 right). */
export function moveLayout(set: DrawingSet, id: string, dir: -1 | 1): DrawingSet {
  const i = set.sheets.findIndex((s) => s.id === id), s = set.sheets[i];
  if (i < 0) return set;
  const same = (x: DrawingSheet) => x.kind === 'plan' && x.buildingId === s.buildingId && x.levelId === s.levelId;
  let j = i + dir;
  while (j >= 0 && j < set.sheets.length && !same(set.sheets[j])) j += dir;
  if (j < 0 || j >= set.sheets.length) return set;
  const sheets = [...set.sheets];
  [sheets[i], sheets[j]] = [sheets[j], sheets[i]];
  return { ...set, sheets };
}

/** A layout made in Design CAD on the drawing (Layout2…): its tab id, name and tooltip. */
export interface DrawingTab { id: string; name: string; title: string }
type TabMenu = { s?: DrawingSheet; d?: DrawingTab; x: number; y: number };

/** The tabs under the drawing: Model, the drawing file's own layouts, the layouts made on it here, then the level's plan
 * sheets. + makes a layout of the drawing; a tab's right-click menu has its own commands and New plan sheet. */
export function LayoutTabs({ files = [], drawings = [], layouts, active, onPick, onNew, onNewSheet, onDrawing, onRename, onCopy, onMove, onDelete, onPageSetup, onPlot, onTemplates, onSaveTemplate }: {
  /** The drawing file's own layouts (paper space), first, as in the file: their tab id, name and tooltip. */
  files?: { id: string; name: string; title: string }[];
  /** Layouts made on the drawing here (+), after the file's own. */
  drawings?: DrawingTab[];
  layouts: DrawingSheet[];
  active: string | null;
  onPick: (id: string | null) => void;
  /** A new layout of the drawing (+); absent: no +. */
  onNew?: () => void;
  /** A new plan sheet of the level, from a tab's right-click menu; absent: not offered. */
  onNewSheet?: (type: PlanType) => void;
  onDrawing?: { rename: (d: DrawingTab) => void; copy: (d: DrawingTab) => void; move: (d: DrawingTab, dir: -1 | 1) => void; remove: (d: DrawingTab) => void; pageSetup: (d: DrawingTab) => void };
  onRename: (s: DrawingSheet) => void;
  onCopy: (s: DrawingSheet) => void;
  onMove: (s: DrawingSheet, dir: -1 | 1) => void;
  onDelete: (s: DrawingSheet) => void;
  onPageSetup: (s: DrawingSheet) => void;
  /** Plot a plan sheet (its tab's menu); absent: not offered. */
  onPlot?: (s: DrawingSheet) => void;
  /** A new layout from a template (the tab menu's From template…); absent: not offered. */
  onTemplates?: () => void;
  /** Save a layout (a plan sheet's or a layout of the drawing's tab id) as a template; absent: not offered. */
  onSaveTemplate?: (id: string) => void;
}) {
  const [menu, setMenu] = useState<TabMenu | null>(null);
  useEffect(() => {
    if (!menu) return undefined;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [menu]);
  const pick = (f: () => void) => { setMenu(null); f(); };
  const ctx = (m: Omit<TabMenu, 'x' | 'y'>) => (e: ReactMouseEvent) => {
    e.preventDefault();
    if (m.s || m.d || onNewSheet || onNew) setMenu({ ...m, x: e.clientX, y: e.clientY });
  };
  const sheetTypes = onNewSheet ? <>
    {(menu?.s || menu?.d) && <hr />}
    <div className="cad-tab-menu-h">New plan sheet of the level</div>
    {PLAN_TYPES.map((t, i) => <button key={t} role="menuitem" autoFocus={!menu?.s && !menu?.d && i === 0} onClick={() => pick(() => onNewSheet(t))}>{PLAN_LABEL[t]} <span className="m">{PLAN_PREFIX[t]}</span></button>)}
  </> : null;
  return (
    <>
      <div className="cad-ltabs" role="tablist" aria-label="Model and layouts">
        <button role="tab" aria-selected={!active} className={`cad-ltab${!active ? ' on' : ''}`} title="Model: the plan at real size (drawing units)" onClick={() => onPick(null)} onContextMenu={ctx({})}>Model</button>
        {files.map((f) => (
          <button key={f.id} role="tab" aria-selected={active === f.id} className={`cad-ltab${active === f.id ? ' on' : ''}`} title={f.title} onClick={() => onPick(f.id)} onContextMenu={ctx({})}>{f.name}</button>
        ))}
        {drawings.map((d) => (
          <button key={d.id} role="tab" aria-selected={active === d.id} className={`cad-ltab${active === d.id ? ' on' : ''}`} title={`${d.title} · right-click for more`} onClick={() => onPick(d.id)} onContextMenu={ctx({ d })}>{d.name}</button>
        ))}
        {layouts.map((s) => (
          <button key={s.id} role="tab" aria-selected={active === s.id} className={`cad-ltab${active === s.id ? ' on' : ''}`} title={`${s.number} — ${s.title}: the project's plan sheet · right-click for more`}
            onClick={() => onPick(s.id)} onContextMenu={ctx({ s })}>{s.number || s.title}{files.length + drawings.length > 0 && <span className="cad-ltab-k">sheet</span>}</button>
        ))}
        {onNew && <button className="cad-ltab add" aria-label="New layout" title="New layout of this drawing (LAYOUT) · right-click a tab for a plan sheet" onClick={() => onNew()}><Plus size={13} strokeWidth={2} /></button>}
      </div>
      {menu && (
        <>
          <div className="st-cover" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="dw-menu st-ctx cad-tab-menu up" role="menu" aria-label={menu.s ? `Layout ${menu.s.number}` : menu.d ? `Layout ${menu.d.name}` : 'New plan sheet'} style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 236)), top: menu.y }}>
            {onNew && <><button role="menuitem" autoFocus onClick={() => pick(onNew)}>New layout <span className="m">LAYOUT</span></button>{onTemplates && <button role="menuitem" onClick={() => pick(onTemplates)}>From template…</button>}{(menu.s || menu.d) && <hr />}</>}
            {menu.s && <>
              <button role="menuitem" autoFocus={!onNew} onClick={() => pick(() => onRename(menu.s!))}>Rename…</button>
              <button role="menuitem" onClick={() => pick(() => onCopy(menu.s!))}>Copy</button>
              {onSaveTemplate && <button role="menuitem" onClick={() => pick(() => onSaveTemplate(menu.s!.id))}>Save as template…</button>}
              <button role="menuitem" onClick={() => pick(() => onMove(menu.s!, -1))}>Move left</button>
              <button role="menuitem" onClick={() => pick(() => onMove(menu.s!, 1))}>Move right</button>
              <button role="menuitem" onClick={() => pick(() => onPageSetup(menu.s!))}>Page setup…</button>
              {onPlot && <button role="menuitem" onClick={() => pick(() => onPlot(menu.s!))}>Plot… <span className="m">PLOT</span></button>}
              <button role="menuitem" onClick={() => pick(() => onDelete(menu.s!))}>Delete</button>
            </>}
            {menu.d && onDrawing && <>
              <button role="menuitem" autoFocus={!onNew} onClick={() => pick(() => onDrawing.rename(menu.d!))}>Rename…</button>
              <button role="menuitem" onClick={() => pick(() => onDrawing.copy(menu.d!))}>Copy</button>
              {onSaveTemplate && <button role="menuitem" onClick={() => pick(() => onSaveTemplate(menu.d!.id))}>Save as template…</button>}
              <button role="menuitem" onClick={() => pick(() => onDrawing.move(menu.d!, -1))}>Move left</button>
              <button role="menuitem" onClick={() => pick(() => onDrawing.move(menu.d!, 1))}>Move right</button>
              <button role="menuitem" onClick={() => pick(() => onDrawing.pageSetup(menu.d!))}>Page setup…</button>
              <button role="menuitem" onClick={() => pick(() => onDrawing.remove(menu.d!))}>Delete</button>
            </>}
            {sheetTypes}
          </div>
        </>
      )}
    </>
  );
}

/** Where the sheet's drawing area is on the page (paper mm from its top left): its plan's SVG, found by its width. */
function areaOrigin(frame: HTMLIFrameElement | null, areaW: number, pageMmPerPx: number): Pt | null {
  const doc = frame?.contentDocument;
  if (!doc) return null;
  const svg = [...doc.querySelectorAll('svg')].find((el) => Math.abs(parseFloat(el.getAttribute('width') ?? '') - areaW) < 0.05 && (el.getAttribute('width') ?? '').endsWith('mm'));
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  return [r.left * pageMmPerPx, r.top * pageMmPerPx];
}

/** Where the tables placed on the page are (paper mm from its top left, and their size): their SVGs, found by id. */
function tableRects(frame: HTMLIFrameElement | null, pageMmPerPx: number): Record<string, [number, number, number, number]> {
  const doc = frame?.contentDocument, out: Record<string, [number, number, number, number]> = {};
  if (!doc) return out;
  for (const el of doc.querySelectorAll<HTMLElement>('.ptab[data-id]')) { const r = el.getBoundingClientRect(); out[el.dataset.id!] = [r.left * pageMmPerPx, r.top * pageMmPerPx, r.width * pageMmPerPx, r.height * pageMmPerPx]; }
  return out;
}

/** The viewport frames over a layout's page, the frames of the tables placed on it (LEGEND / NOTES, moved by their
 * edges), and the viewport worked in with the drawing inside it. */
export function layoutOverlay({ project, sheet, sel, ms, mv, onSelect, onMs, onBox, onNew, canvas, place = null, onPlace, onTableAt, onContext }: {
  project: Project;
  sheet: DrawingSheet;
  sel: string | null;
  ms: string | null;
  /** MV: two corners picked on the paper make a viewport. */
  mv: boolean;
  /** LEGEND / NOTES: a point picked on the paper places a table there (its top left corner). */
  place?: TableKind | null;
  onPlace?: (kind: TableKind, at: Pt) => void;
  /** A table moved (paper mm, drawing area). */
  onTableAt?: (id: string, at: Pt) => void;
  onSelect: (id: string | null) => void;
  onMs: (id: string | null) => void;
  /** A frame moved or resized (paper mm, drawing area). */
  onBox: (id: string, box: PlanViewport['box']) => void;
  onNew: (box: PlanViewport['box']) => void;
  /** The drawing, fitted to the viewport worked in. */
  canvas: (v: PlanViewport, pxPerMm: number) => ReactNode;
  /** A right-click on the paper: inside a viewport (its id; not the one worked in) or on the paper (null), at the
   * screen point. */
  onContext?: (id: string | null, x: number, y: number) => void;
}): PaperOverlay {
  return ({ pxPerMm, frame, loaded }) => <Frames key={`${sheet.id}-${loaded}`} {...{ project, sheet, sel, ms, mv, onSelect, onMs, onBox, onNew, canvas, pxPerMm, frame, place, onPlace, onTableAt, onContext }} />;
}

/** On screen only (never plotted): how far in from the paper's edge a printer can print, as the dashed line. */
export const PRINT_EDGE_MM = 5;

/** The paper's printable area (dashed) and its trim marks at the four corners, outside the sheet. */
function PaperMarks({ edge }: { edge: number }) {
  return (
    <>
      <div className="cad-printable" style={{ inset: edge }} title={`Printable area: ${PRINT_EDGE_MM} mm in from the paper's edge (on screen only, not plotted)`} />
      {(['nw', 'ne', 'sw', 'se'] as const).map((k) => <span key={k} className={`cad-trim ${k}`} aria-hidden />)}
    </>
  );
}

function Frames({ project, sheet, sel, ms, mv, onSelect, onMs, onBox, onNew, canvas, pxPerMm, frame, place, onPlace, onTableAt, onContext }: Omit<Parameters<typeof layoutOverlay>[0], never> & { pxPerMm: number; frame: HTMLIFrameElement | null }) {
  const root = useRef<HTMLDivElement>(null);
  const paper = layoutPaper(project, sheet);
  const vps = layoutViewports(project, sheet);
  const tables = sheet.tables ?? [];
  const iframePxPerMm = 3.78; // the page is laid out at 3.78 px per mm inside its frame (SheetWorkspace)
  const [origin, setOrigin] = useState<Pt | null>(null);
  const [tRects, setTRects] = useState<Record<string, [number, number, number, number]>>({});
  useEffect(() => { setTRects(tableRects(frame, 1 / iframePxPerMm)); }, [frame, tables.length]);
  const [tDrag, setTDrag] = useState<{ id: string; from: Pt; at: Pt } | null>(null);
  // Measured on the page; else where src/docs/sldSheet.ts puts it (frame 20 mm from the left and 10 mm from the top, its
  // 0.7 mm border, the drawing 3 mm inside).
  useEffect(() => { if (paper) setOrigin(areaOrigin(frame, paper.area.w, 1 / iframePxPerMm) ?? [23.7, 13.7]); }, [frame, paper?.area.w]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<{ id: string; how: 'move' | 'nw' | 'ne' | 'sw' | 'se'; from: Pt; box: PlanViewport['box'] } | null>(null);
  const [first, setFirst] = useState<Pt | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  // Paper mm (drawing area) of a pointer event.
  const mmAt = (e: { clientX: number; clientY: number }): Pt => {
    const r = root.current!.getBoundingClientRect(), o = origin ?? [0, 0];
    return [(e.clientX - r.left) / pxPerMm - o[0], (e.clientY - r.top) / pxPerMm - o[1]];
  };
  // A double-click inside a viewport works in it; outside goes back to the paper (the page's own clicks stay its).
  useEffect(() => {
    const host = root.current?.parentElement;
    if (!host) return undefined;
    const dbl = (e: MouseEvent) => {
      if (!origin) return;
      const at = mmAt(e), v = [...vps].reverse().find((x) => insideVp(x, at));
      if (ms && v?.id === ms) return;
      e.preventDefault();
      onMs(v ? v.id : null);
    };
    // A right-click on the paper or in a viewport's frame: its menu (in the viewport worked in, the drawing's own).
    const ctx = (e: MouseEvent) => {
      if (!origin || !onContext || e.defaultPrevented) return;
      const at = mmAt(e), v = [...vps].reverse().find((x) => insideVp(x, at));
      if (ms && v?.id === ms) return;
      e.preventDefault();
      onContext(v ? v.id : null, e.clientX, e.clientY);
    };
    host.addEventListener('dblclick', dbl);
    host.addEventListener('contextmenu', ctx);
    return () => { host.removeEventListener('dblclick', dbl); host.removeEventListener('contextmenu', ctx); };
  });
  const marks = <PaperMarks edge={PRINT_EDGE_MM * pxPerMm} />;
  if (!paper || !origin) return <div ref={root} className="cad-vps">{marks}</div>;
  const px = (mm: number) => mm * pxPerMm;
  const shown = (v: PlanViewport): PlanViewport['box'] => (drag?.id === v.id ? drag.box : v.box);
  const moveTo = (e: React.PointerEvent) => {
    if (!drag) return;
    const [x, y] = mmAt(e), dx = x - drag.from[0], dy = y - drag.from[1], [l, t, w, h] = vps.find((v) => v.id === drag.id)!.box;
    const box: PlanViewport['box'] = drag.how === 'move' ? [l + dx, t + dy, w, h]
      : boxFrom(drag.how === 'nw' ? [l + dx, t + dy] : drag.how === 'ne' ? [l, t + dy] : drag.how === 'sw' ? [l + dx, t] : [l, t], drag.how === 'nw' ? [l + w, t + h] : drag.how === 'ne' ? [l + w + dx, t + h] : drag.how === 'sw' ? [l + w, t + h + dy] : [l + w + dx, t + h + dy]);
    setDrag({ ...drag, box: box.map((k) => +k.toFixed(1)) as PlanViewport['box'] });
  };
  const endDrag = () => { if (drag && drag.box.join() !== vps.find((v) => v.id === drag.id)?.box.join() && drag.box[2] > 2 && drag.box[3] > 2) onBox(drag.id, drag.box); setDrag(null); };
  const tMove = (e: React.PointerEvent) => { if (!tDrag) return; const [x, y] = mmAt(e), t = tables.find((q) => q.id === tDrag.id)!; setTDrag({ ...tDrag, at: [+(t.at[0] + x - tDrag.from[0]).toFixed(1), +(t.at[1] + y - tDrag.from[1]).toFixed(1)] }); };
  const tEnd = () => { if (tDrag && tDrag.at.join() !== tables.find((q) => q.id === tDrag.id)?.at.join()) onTableAt?.(tDrag.id, tDrag.at); setTDrag(null); };
  return (
    <div ref={root} className={`cad-vps${mv || place ? ' mv' : ''}`} style={{ cursor: mv || place ? 'crosshair' : undefined }}
      onPointerMove={(e) => { moveTo(e); tMove(e); if (mv) setHover(mmAt(e)); }} onPointerUp={() => { endDrag(); tEnd(); }}
      onPointerDown={place ? (e) => { e.stopPropagation(); const at = mmAt(e); onPlace?.(place, [+at[0].toFixed(1), +at[1].toFixed(1)]); } : mv ? (e) => {
        e.stopPropagation();
        const at = mmAt(e);
        if (!first) { setFirst(at); return; }
        setFirst(null);
        const b = boxFrom(first, at);
        if (b[2] > 2 && b[3] > 2) onNew(b.map((k) => +k.toFixed(1)) as PlanViewport['box']);
      } : undefined}>
      {marks}
      {vps.map((v) => {
        const [l, t, w, h] = shown(v), on = sel === v.id, inside = ms === v.id;
        const grab = (how: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => { if (mv) return; e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); onSelect(v.id); setDrag({ id: v.id, how, from: mmAt(e), box: v.box }); };
        return (
          <div key={v.id} className={`cad-vp${on ? ' on' : ''}${inside ? ' ms' : ''}`} aria-label={vpName(vps, v.id)}
            style={{ left: px(origin[0] + l), top: px(origin[1] + t), width: px(w), height: px(h) }}>
            {inside && <div className="cad-vp-model">{canvas(v, pxPerMm)}</div>}
            {!inside && (['t', 'b', 'l', 'r'] as const).map((k) => <span key={k} className={`cad-vp-edge ${k}`} onPointerDown={grab('move')} onPointerMove={moveTo} onPointerUp={endDrag} title={`${vpName(vps, v.id)} · 1:${v.scale}${isLocked(v) ? ' · locked' : ''} — drag to move, double-click inside to work in it`} />)}
            {on && !inside && (['nw', 'ne', 'sw', 'se'] as const).map((k) => <span key={k} className={`cad-vp-grip ${k}`} onPointerDown={grab(k)} onPointerMove={moveTo} onPointerUp={endDrag} />)}
          </div>
        );
      })}
      {tables.map((t) => {
        const r = tRects[t.id], at = tDrag?.id === t.id ? tDrag.at : t.at, on = sel === t.id;
        const w = r ? r[2] : t.widthMm, h = r ? r[3] : 20;
        const grab = (e: React.PointerEvent) => { if (mv || place) return; e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); onSelect(t.id); setTDrag({ id: t.id, from: mmAt(e), at: t.at }); };
        return (
          <div key={t.id} className={`cad-vp cad-ptab${on ? ' on' : ''}`} aria-label={tableName(tables, t.id)} style={{ left: px(origin[0] + at[0]), top: px(origin[1] + at[1]), width: px(w), height: px(h) }}>
            {(['t', 'b', 'l', 'r'] as const).map((k) => <span key={k} className={`cad-vp-edge ${k}`} onPointerDown={grab} onPointerMove={tMove} onPointerUp={tEnd} title={`${tableName(tables, t.id)} · ${t.widthMm} mm wide · drag to move`} />)}
          </div>
        );
      })}
      {mv && first && hover && (() => { const [l, t, w, h] = boxFrom(first, hover); return <div className="cad-vp new" style={{ left: px(origin[0] + l), top: px(origin[1] + t), width: px(w), height: px(h) }} />; })()}
    </div>
  );
}

/** A placed table's properties (its frame picked): width, text height, columns and rows of a legend, title, delete. */
export function TablePanel({ sheet, table, labels, onChange, onDelete }: {
  sheet: DrawingSheet;
  table: PlacedTable;
  /** The legend rows the sheet has (their labels), for hiding. */
  labels: string[];
  onChange: (patch: Partial<PlacedTable>, what: string) => void;
  onDelete: () => void;
}) {
  const tables = sheet.tables ?? [], name = tableName(tables, table.id), legend = table.kind === 'legend';
  const [custom, setCustom] = useState('');
  const hidden = table.hidden ?? [];
  return (
    <div className="cad-devform cad-vpform" aria-label="Table properties">
      <b>{name} <span className="m">{sheet.number}</span></b>
      <label>Width
        <select aria-label="Table width" value={TABLE_WIDTHS.includes(table.widthMm) ? table.widthMm : 'custom'} onChange={(e) => e.target.value !== 'custom' && onChange({ widthMm: Number(e.target.value) }, `${e.target.value} mm wide`)}>
          {TABLE_WIDTHS.map((k) => <option key={k} value={k}>{k} mm</option>)}
          <option value="custom">{TABLE_WIDTHS.includes(table.widthMm) ? 'Custom…' : `${table.widthMm} mm`}</option>
        </select>
      </label>
      <label>Custom (mm)<input aria-label="Custom width" inputMode="numeric" value={custom} placeholder={String(table.widthMm)} onChange={(e) => setCustom(e.target.value)}
        onBlur={() => { const k = Math.round(Number(custom)); if (k >= 40 && k !== table.widthMm) onChange({ widthMm: k }, `${k} mm wide`); setCustom(''); }} /></label>
      <div className="seg" role="group" aria-label="Text height">
        {([2.5, 3.5] as const).map((h) => <button key={h} className={(table.textMm ?? 2.5) === h ? 'on' : ''} onClick={() => (table.textMm ?? 2.5) !== h && onChange({ textMm: h === 2.5 ? undefined : h }, `${h} mm text`)}>{h} mm</button>)}
      </div>
      {legend && <div className="seg" role="group" aria-label="Columns">
        {([1, 2] as const).map((c) => <button key={c} className={(table.cols ?? 1) === c ? 'on' : ''} onClick={() => (table.cols ?? 1) !== c && onChange({ cols: c === 1 ? undefined : c }, `${c} column${c === 1 ? '' : 's'}`)}>{c} {c === 1 ? 'column' : 'columns'}</button>)}
      </div>}
      <label>Title<input aria-label="Table title" defaultValue={table.title ?? ''} key={table.title ?? ''} placeholder={legend ? 'LEGEND · (the layout)' : 'NOTES'} onBlur={(e) => (e.target.value.trim() || undefined) !== table.title && onChange({ title: e.target.value.trim() || undefined }, 'title')} /></label>
      {legend && labels.length > 0 && <div role="group" aria-label="Rows">{labels.map((l) => {
        const off = hidden.includes(l);
        return <label key={l}><input type="checkbox" checked={!off} onChange={() => { const next = off ? hidden.filter((x) => x !== l) : [...hidden, l]; onChange({ hidden: next.length ? next : undefined }, `row ${l} ${off ? 'shown' : 'hidden'}`); }} /> {l}</label>;
      })}</div>}
      {legend && <label>Rows added (one per line)<textarea aria-label="Rows added" rows={2} defaultValue={(table.extra ?? []).join('\n')} key={(table.extra ?? []).join('|')} onBlur={(e) => { const next = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (next.join('|') !== (table.extra ?? []).join('|')) onChange({ extra: next.length ? next : undefined }, 'rows added'); }} /></label>}
      <div className="cad-devbtns"><button className="chip" onClick={onDelete}>Delete {legend ? 'legend' : 'notes'} table</button></div>
    </div>
  );
}

/** Viewport properties (its frame picked): scale, lock, plan type shown, references, frame printed, delete. */
export function ViewportPanel({ project, sheet, vp, refs, onChange, onDelete, onLayers }: {
  project: Project;
  sheet: DrawingSheet;
  vp: PlanViewport;
  /** The references of the level's plan (names). */
  refs: string[];
  onChange: (patch: Partial<PlanViewport>, what: string) => void;
  onDelete: () => void;
  onLayers: () => void;
}) {
  const vps = layoutViewports(project, sheet), scales = scalesOf(project);
  const [custom, setCustom] = useState('');
  return (
    <div className="cad-devform cad-vpform" aria-label="Viewport properties">
      <b>{vpName(vps, vp.id)} <span className="m">{sheet.number}</span></b>
      <label>Scale
        <select aria-label="Viewport scale" value={scales.includes(vp.scale) ? vp.scale : 'custom'} onChange={(e) => e.target.value !== 'custom' && onChange({ scale: Number(e.target.value) }, `scale 1:${e.target.value}`)}>
          {scales.map((k) => <option key={k} value={k}>1:{k}</option>)}
          <option value="custom">{scales.includes(vp.scale) ? 'Custom…' : `1:${vp.scale}`}</option>
        </select>
      </label>
      <label>Custom 1:<input aria-label="Custom scale" inputMode="numeric" value={custom} placeholder={String(vp.scale)} onChange={(e) => setCustom(e.target.value)}
        onBlur={() => { const k = Math.round(Number(custom)); if (k > 0 && k !== vp.scale) onChange({ scale: k }, `scale 1:${k}`); setCustom(''); }} /></label>
      <div className="seg" role="group" aria-label="Locked">
        <button className={isLocked(vp) ? 'on' : ''} onClick={() => !isLocked(vp) && onChange({ locked: undefined }, 'locked')}>Locked</button>
        <button className={!isLocked(vp) ? 'on' : ''} onClick={() => isLocked(vp) && onChange({ locked: false }, 'unlocked: pan and zoom inside it move its view')}>Unlocked</button>
      </div>
      <div className="seg" role="group" aria-label="Shows">
        {PLAN_TYPES.map((t) => <button key={t} className={(vp.shows ?? sheet.plan) === t ? 'on' : ''} onClick={() => onChange({ shows: t === sheet.plan ? undefined : t }, `shows the ${PLAN_LABEL[t].toLowerCase()}`)}>{PLAN_LABEL[t].replace(' layout', '')}</button>)}
      </div>
      {refs.length > 0 && <div role="group" aria-label="References in this viewport">{refs.map((r) => {
        const off = vp.refsOff?.includes(r) ?? false;
        return <label key={r}><input type="checkbox" checked={!off} onChange={() => { const next = off ? (vp.refsOff ?? []).filter((x) => x !== r) : [...(vp.refsOff ?? []), r]; onChange({ refsOff: next.length ? next : undefined }, `reference ${r} ${off ? 'shown' : 'hidden'} here`); }} /> {r}</label>;
      })}</div>}
      <label><input type="checkbox" checked={!!vp.frame} onChange={() => onChange({ frame: vp.frame ? undefined : true }, vp.frame ? 'frame not printed' : 'frame printed')} /> Frame prints</label>
      <div className="cad-devbtns"><button className="chip" onClick={onLayers}>Layers in this viewport…</button><button className="chip" onClick={onDelete}>Delete viewport</button></div>
    </div>
  );
}

/** The project with a layout's viewports changed (the worked-out one becomes the sheet's own on the first change). */
export function changeViewports(p: Project, sheet: DrawingSheet, change: (list: PlanViewport[]) => PlanViewport[]): Project {
  const list = change(layoutViewports(p, sheet));
  return { ...p, drawingSet: withViewports(setOf(p), sheet.id, list) };
}
export { patchViewport, vpId };
