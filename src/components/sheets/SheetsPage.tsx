import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowDownToLine, Baseline, BetweenHorizontalStart, BetweenVerticalStart, Bold, Check, ClipboardPaste, ClipboardType,
  Copy, Dot, Eye, FilePlus2, FolderOpen, Grid2x2, Hash, Italic, LayoutTemplate, Link2, ListFilter, MoveHorizontal, PaintBucket, Paintbrush, Pencil, Percent, Plus, RefreshCw, RotateCw, Ruler, Save, Scissors, Search,
  Sigma, TableCellsMerge, Trash2, Underline, Undo2, Upload, WrapText, type LucideIcon
} from 'lucide-react';
import type { Project } from '../../types';
import { cellAt, cellName, colName } from '../../calc/sheetFormula';
import {
  allBordered, allStyled, area, DEFAULT_WIDTH, deleteCols, deleteRows, edgesOf, fillDownEdits, insertCols, insertRows, mergeArea, mergeAt, newSheet, pasteEdits, rawRows, sheetNameError, sheetValues, shown, shownRows, sumFormula,
  unmergeArea, withNextWidth, withStyle, type Area, type Sheet, type SheetAlign, type SheetBook, type SheetNumberFormat, type SheetStyle
} from '../../model/sheets';
import { addCircuitRow, discardPending, fillLinked, linkAt, linkFields, pendingCount, typeLinked, typeRefusal } from '../../docs/sheetLink';
import { applyLinked, pendingMarks } from '../../docs/sheetApply';
import { parseClipboard, toClipboard } from '../grid/excelGrid';
import FormatsPanel from './FormatsPanel';
import LinkPanel from './LinkPanel';
import { safeFileName, saveBinary } from '../../util/files';

/** Sheets: the engineer's own schedules in an Excel-style grid with formulas, inside the app. This stage has the
 * grid, the formula bar, the sheet tabs, the File and Home tabs of the ribbon, opening and saving Excel files,
 * and linking a sheet to a DB of the project (Electrical tab, Link columns: LinkPanel.tsx). Writing typed values back to
 * the project and the other Electrical tools follow (docs/notes/Future development, Sheets proposal). */

const LATER = 'Comes in a later stage';
const CSS = `
.shx { display: flex; flex-direction: column; gap: 12px; color: var(--tx); min-width: 0; }
.shx h3 { margin: 0; font-size: 18px; }
.shx-ribbon { border: 1px solid var(--line); border-radius: 9px; background: var(--panel); overflow: hidden; }
.shx-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--line); padding: 0 12px; }
.shx-tab { height: 40px; padding: 0 20px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--mut); font: inherit; cursor: pointer; }
.shx-tab[aria-selected="true"] { color: var(--tx); font-weight: 600; border-bottom-color: var(--acc); }
.shx-tab:disabled { opacity: 0.5; cursor: default; }
.shx-body { display: flex; padding: 14px 0 10px; overflow-x: auto; }
.shx-group { display: flex; flex-direction: column; justify-content: space-between; gap: 8px; padding: 0 20px; border-right: 1px solid var(--line); flex: none; }
.shx-group:last-child { border-right: 0; }
.shx-tools { display: flex; gap: 12px; align-items: center; min-height: 88px; }
.shx-name { font-size: 11px; color: var(--mut); text-align: center; }
.shx-big { box-sizing: border-box; width: 88px; height: 88px; padding: 10px 8px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--tx); font: inherit; font-size: 12px; line-height: 1.25; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
.shx-col { display: grid; grid-template-rows: 40px 40px; grid-auto-flow: column; gap: 8px 4px; }
.shx-sm { box-sizing: border-box; height: 40px; padding: 0 12px; border-radius: 6px; border: 0; background: transparent; color: var(--tx); font: inherit; font-size: 12.5px; white-space: nowrap; display: flex; align-items: center; gap: 10px; text-align: left; cursor: pointer; }
.shx-icons { display: grid; grid-template-columns: repeat(3, 40px); gap: 8px; }
.shx-ic { box-sizing: border-box; width: 40px; height: 40px; padding: 0; border-radius: 6px; border: 1px solid var(--line); background: var(--p2); color: var(--tx); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.shx-big:hover:not(:disabled), .shx-sm:hover:not(:disabled), .shx-ic:hover:not(:disabled) { background: var(--p2); border-color: var(--line-strong); }
.shx-ic[aria-pressed="true"], .shx-sm[aria-pressed="true"], .shx-big[aria-pressed="true"] { outline: 1px solid var(--acc); }
.shx-big:disabled, .shx-sm:disabled, .shx-ic:disabled { opacity: 0.45; cursor: default; }
.shx-big svg, .shx-sm svg, .shx-ic svg { color: var(--acc); flex: none; }
.shx-bar { display: grid; grid-template-columns: 84px 1fr; gap: 8px; }
.shx-bar label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; font-weight: 600; color: var(--mut); }
.shx-bar input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--p2); color: var(--tx); font: inherit; font-size: 13px; }
.shx-main { display: flex; gap: 12px; align-items: flex-start; }
.shx-main > .shx-wrap { flex: 1; min-width: 0; }
.shx-wrap { overflow: auto; max-height: 62vh; border: 1px solid var(--line); background: var(--panel); outline: none; }
.shx-grid { border-collapse: collapse; table-layout: fixed; font-variant-numeric: tabular-nums; font-size: 12.5px; }
.shx-grid th { position: sticky; top: 0; z-index: 2; height: 24px; padding: 0 6px; border: 1px solid var(--line); background: var(--p2); color: var(--mut); font-size: 11px; font-weight: 600; text-align: center; }
.shx-grid th.shx-row { position: sticky; left: 0; top: auto; z-index: 1; width: 40px; }
.shx-grid th.shx-corner { left: 0; z-index: 3; width: 40px; }
.shx-grid th.shx-on { color: var(--tx); background: var(--line); }
.shx-grid td { height: 26px; padding: 0 6px; border: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: cell; }
.shx-grid td.shx-sel { background: color-mix(in srgb, var(--acc) 14%, transparent); }
.shx-grid td.shx-act { outline: 2px solid var(--acc); outline-offset: -2px; }
.shx-grid td.shx-fx { color: var(--mut); }
.shx-grid td.shx-err { color: var(--bad); }
.shx-grid td.shx-keep { text-decoration: underline dotted; text-underline-offset: 3px; }
.shx-grid td.shx-fill { background: color-mix(in srgb, var(--acc) 22%, transparent); }
.shx-grid td.shx-accent { color: var(--acc); }
.shx-grid td.shx-lk { box-shadow: inset 2px 0 0 var(--res-cur); }
.shx-grid td.shx-own { box-shadow: inset 2px 0 0 var(--res-pf); }
.shx-grid td.shx-pend { position: relative; }
.shx-grid td.shx-pend::after { content: ""; position: absolute; top: 2px; right: 2px; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
.shx-grid td.shx-over { box-shadow: inset 0 0 0 2px var(--warn); }
.shx-grid th .shx-lkname { display: block; font-size: 10px; font-weight: 400; color: var(--res-cur); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shx-grid th .shx-lkname.shx-lkown { color: var(--res-pf); }
.shx-grid td input { box-sizing: border-box; width: 100%; height: 22px; border: 0; outline: 0; padding: 0; background: var(--bg); color: var(--tx); font: inherit; }
.shx-sheets { display: flex; flex-wrap: wrap; gap: 4px; }
.shx-sheet { height: 36px; padding: 0 16px; border: 1px solid var(--line); border-radius: 0 0 6px 6px; background: var(--bg); color: var(--mut); font: inherit; cursor: pointer; }
.shx-sheet[aria-selected="true"] { background: var(--panel); color: var(--tx); font-weight: 600; border-top: 2px solid var(--acc); }
.shx-note { font-size: 12px; color: var(--mut); margin: 0; }
`;

type Tab = 'file' | 'home' | 'electrical';
interface Clip { text: string; rows: string[][]; from: { r: number; c: number } }
const EMPTY_BOOK = (): SheetBook => ({ sheets: [newSheet()] });

function Group({ name, children }: { name: string; children: ReactNode }) {
  return <div className="shx-group" role="group" aria-label={name}><div className="shx-tools">{children}</div><span className="shx-name">{name}</span></div>;
}
function Big({ icon: Icon, label, onClick, disabled, title, pressed }: { icon: LucideIcon; label: string; onClick?: () => void; disabled?: boolean; title?: string; pressed?: boolean }) {
  return <button type="button" className="shx-big" onClick={onClick} disabled={disabled || !onClick} aria-pressed={pressed} title={title ?? (onClick ? label : LATER)}><Icon size={26} aria-hidden /><span>{label}</span></button>;
}
function Small({ icon: Icon, label, onClick, disabled, pressed, title }: { icon: LucideIcon; label: string; onClick?: () => void; disabled?: boolean; pressed?: boolean; title?: string }) {
  return <button type="button" className="shx-sm" onClick={onClick} disabled={disabled || !onClick} aria-pressed={pressed} title={title ?? (onClick ? label : LATER)}><Icon size={18} aria-hidden /><span>{label}</span></button>;
}
function IconTool({ icon: Icon, label, onClick, pressed, disabled }: { icon: LucideIcon; label: string; onClick?: () => void; pressed?: boolean; disabled?: boolean }) {
  return <button type="button" className="shx-ic" onClick={onClick} disabled={!onClick || disabled} aria-label={label} aria-pressed={pressed} title={onClick ? label : `${label} — ${LATER.toLowerCase()}`}><Icon size={18} aria-hidden /></button>;
}

export default function SheetsPage({ project, onChange, onStatus, onUndo, openSheetId }: { project: Project; onChange: (p: Project, step?: boolean) => void; onStatus?: (m: string) => void; onUndo?: () => void; openSheetId?: string }) {
  const book = useMemo(() => (project.sheets?.sheets.length ? project.sheets : EMPTY_BOOK()), [project.sheets]);
  const [sheetId, setSheetId] = useState(() => (book.sheets.some((s) => s.id === openSheetId) ? openSheetId! : book.sheets[0].id));
  useEffect(() => { if (openSheetId && book.sheets.some((s) => s.id === openSheetId)) setSheetId(openSheetId); }, [openSheetId]); // eslint-disable-line react-hooks/exhaustive-deps -- picks the sheet when the id arrives or changes, not on later edits
  const stored = book.sheets.find((s) => s.id === sheetId) ?? book.sheets[0];
  /** The shown sheet is live: a linked sheet is filled from the project, and saving stores the filled sheet. */
  const sheet = useMemo(() => fillLinked(project, stored), [project, stored]);
  const [panel, setPanel] = useState<'link' | 'formats' | null>(null);
  const [showLinks, setShowLinks] = useState(true);
  const [tab, setTab] = useState<Tab>('home');
  const [act, setAct] = useState({ r: 1, c: 1 });
  const [anchor, setAnchor] = useState({ r: 1, c: 1 });
  const [edit, setEdit] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const clip = useRef<Clip | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  /** Set when Enter, Tab or Escape ended an edit, so the input's blur does not save it a second time. */
  const ended = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const values = useMemo(() => sheetValues(sheet), [sheet]);
  const sel: Area = useMemo(() => area(act, anchor), [act, anchor]);
  const name = cellName(act.c, act.r);
  const raw = sheet.cells[name] ?? '';
  const single = sel.r0 === sel.r1 && sel.c0 === sel.c1;

  const editing = edit !== null;
  useEffect(() => { if (editing) editInput.current?.focus(); }, [editing]);

  const save = (next: Sheet, more: Partial<SheetBook> = {}) =>
    onChange({ ...project, sheets: { ...book, ...more, sheets: (more.sheets ?? book.sheets).map((s) => (s.id === next.id ? next : s)) } }, true);
  /** Typing goes through the link: a typed value of a linked column waits for Apply to project, a cell the app fills is refused. */
  const setCells = (edits: Record<string, string>) => {
    const r = typeLinked(project, sheet, edits);
    if (r.refused) onStatus?.(r.refused);
    if (r.sheet !== sheet) save(r.sheet);
  };
  /** Opens the editor on a cell, unless it may not be typed in. */
  const openEditor = (k: string, text: string) => { const msg = typeRefusal(sheet, k); if (msg) { onStatus?.(msg); return; } ended.current = false; setEdit(text); };
  const waiting = pendingCount(sheet);
  const marks = useMemo(() => (pendingCount(sheet) ? pendingMarks(project, sheet) : {}), [project, sheet]);
  const apply = () => {
    const r = applyLinked(project, sheet), more = r.rejected.length > 1 ? ` and ${r.rejected.length - 1} more` : '';
    if (!r.changed && !r.added) { if (r.rejected.length) onStatus?.(`Nothing applied: ${r.rejected[0]}${more}`); return; }
    onChange({ ...r.project, sheets: { ...book, sheets: book.sheets.map((x) => (x.id === r.sheet.id ? r.sheet : x)) } }, true);
    onStatus?.(`Applied to ${sheet.link?.boardId}: ${r.changed} ${r.changed === 1 ? 'circuit' : 'circuits'} changed, ${r.added} added.${r.rejected.length ? ` Not applied: ${r.rejected[0]}${more}` : ''}`);
  };
  /** A new row for a circuit: the active cell goes to it, in the first column that takes typing. */
  const addCircuit = () => {
    const next = addCircuitRow(sheet), l = next.link!, here = l.rows.filter((k) => !k.startsWith('new:')).length + l.added!.length - 1;
    const col = Object.entries(l.columns).filter(([, f]) => linkFields(l.category).find((x) => x.key === f)?.typed && !(f === 'row.watts' && Object.values(l.columns).some((g) => g.startsWith('row.points.')))).map(([c]) => cellAt(`${c}1`)!.col).sort((a, b) => a - b)[0] ?? 1;
    save(next);
    setAct({ r: l.firstRow + here, c: col }); setAnchor({ r: l.firstRow + here, c: col });
  };
  const style = (change: Partial<SheetStyle>) => save(withStyle(sheet, sel, change));
  const toggle = (key: 'bold' | 'italic' | 'underline' | 'wrap' | 'fill' | 'accent') => style({ [key]: allStyled(sheet, sel, key) ? undefined : true });
  const cur = sheet.styles?.[name] ?? {};
  const bordered = allBordered(sheet, sel);
  const anyBorder = useMemo(() => Object.values(sheet.styles ?? {}).some((x) => x.border), [sheet.styles]);
  /** Every cell of a merged area -> its area, so the grid can span the first cell and skip the rest. */
  const mergeOf = useMemo(() => { const m = new Map<string, Area>(); for (const a of sheet.merges ?? []) for (let r = a.r0; r <= a.r1; r++) for (let c = a.c0; c <= a.c1; c++) m.set(`${r},${c}`, a); return m; }, [sheet.merges]);
  const touching = (sheet.merges ?? []).some((m) => m.r0 <= sel.r1 && m.r1 >= sel.r0 && m.c0 <= sel.c1 && m.c1 >= sel.c0);
  const merge = () => {
    if (touching) { save(unmergeArea(sheet, sel)); return; }
    const next = mergeArea(sheet, sel), m = mergeAt(next, sel.r0, sel.c0);
    save(next);
    if (m) { setAct({ r: m.r0, c: m.c0 }); setAnchor({ r: m.r1, c: m.c1 }); }
  };

  const move = (r: number, c: number, extend = false) => {
    const m0 = { r: Math.max(1, Math.min(sheet.rows, r)), c: Math.max(1, Math.min(sheet.cols, c)) }, m = mergeAt(sheet, m0.r, m0.c);
    const to = m ? { r: m.r0, c: m.c0 } : m0;
    setAct(to);
    if (!extend) setAnchor(to);
    wrap.current?.querySelector(`[data-cell="${cellName(to.c, to.r)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  /** A step from the active cell; from a merged area's first cell it goes on past the area. */
  const step = (dr: number, dc: number, extend = false) => { const m = mergeAt(sheet, act.r, act.c); move(dr > 0 && m ? m.r1 + 1 : act.r + dr, dc > 0 && m ? m.c1 + 1 : act.c + dc, extend); };
  const commit = (v: string, dr = 0, dc = 0) => {
    ended.current = true;
    setEdit(null);
    setCells({ [name]: v });
    if (dr || dc) step(dr, dc);
    wrap.current?.focus();
  };

  // ---- clipboard
  const copy = (cut = false) => {
    const text = toClipboard(shownRows(sheet, sel, values));
    clip.current = { text, rows: rawRows(sheet, sel), from: { r: sel.r0, c: sel.c0 } };
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    if (cut) setCells(Object.fromEntries(Object.keys(pasteEdits(rawRows(sheet, sel), sel)).map((k) => [k, ''])));
    onStatus?.(cut ? 'Cut' : 'Copied');
  };
  const pasteText = (text: string, valuesOnly = false) => {
    const own = clip.current && clip.current.text === text ? clip.current : null;
    const block = own && !valuesOnly ? own.rows : parseClipboard(text);
    if (!block.length) return;
    setCells(pasteEdits(block, sel, own && !valuesOnly ? own.from : undefined));
  };
  const paste = (valuesOnly = false) => {
    const read = navigator.clipboard?.readText?.();
    if (read) void read.then((t) => pasteText(t, valuesOnly)).catch(() => clip.current && pasteText(clip.current.text, valuesOnly));
    else if (clip.current) pasteText(clip.current.text, valuesOnly);
  };
  const clear = () => setCells(Object.fromEntries(Object.keys(pasteEdits(rawRows(sheet, sel), sel)).map((k) => [k, ''])));
  const fillDown = () => { if (sel.r1 > sel.r0) setCells(fillDownEdits(sheet, sel)); };
  const sum = () => { const f = sumFormula(sheet, act.r, act.c, values); if (f) setCells({ [name]: f }); else onStatus?.('Sum: no numbers above or to the left of this cell'); };

  // ---- Excel files (the library loads only now)
  async function openFile(file: File) {
    setBusy(true);
    try {
      const { readXlsx, reportText } = await import('../../docs/sheetXlsx');
      const kept = project.sheets?.sheets.length ? book.sheets : [];
      const { sheets, report } = await readXlsx(await file.arrayBuffer(), file.name, kept);
      if (!sheets.length) { onStatus?.(`${file.name}: no sheets in this file`); return; }
      onChange({ ...project, sheets: { ...book, sheets: [...kept, ...sheets] } }, true);
      setSheetId(sheets[0].id); setEdit(null); setAct({ r: 1, c: 1 }); setAnchor({ r: 1, c: 1 });
      onStatus?.(reportText(file.name, report));
    } catch {
      onStatus?.(`${file.name} could not be opened as an Excel (.xlsx) file`);
    } finally {
      setBusy(false);
    }
  }
  async function saveFile() {
    setBusy(true);
    try {
      const { buildXlsx } = await import('../../docs/sheetXlsx');
      const base = (sheet.source ?? `${project.name} - Sheets`).replace(/\.xlsx$/i, '');
      const m = await saveBinary(`${safeFileName(base)}.xlsx`, new Uint8Array(await buildXlsx(book.sheets.map((x) => fillLinked(project, x))).xlsx.writeBuffer()), 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus?.(m);
    } finally {
      setBusy(false);
    }
  }

  // ---- sheets
  const addSheet = () => { const s = newSheet(book.sheets); onChange({ ...project, sheets: { ...book, sheets: [...book.sheets, s] } }, true); setSheetId(s.id); move(1, 1); };
  const removeSheet = () => {
    if (book.sheets.length < 2) return;
    const rest = book.sheets.filter((s) => s.id !== sheet.id);
    onChange({ ...project, sheets: { ...book, sheets: rest } }, true);
    setSheetId(rest[0].id);
  };
  const rename = (v: string) => {
    setRenaming(null);
    if (v.trim() === sheet.name) return;
    const e = sheetNameError(v, book.sheets.filter((s) => s.id !== sheet.id));
    if (e) onStatus?.(e); else save({ ...sheet, name: v.trim() });
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) { e.preventDefault(); step(arrows[k][0], arrows[k][1], e.shiftKey); return; }
    if (k === 'Tab') { e.preventDefault(); step(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'F2') { e.preventDefault(); openEditor(name, raw); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clear(); return; }
    if (mod) {
      const key = k.toLowerCase();
      // Paste comes through the paste event below, so it is not also run from the key.
      const run: Record<string, () => void> = { c: () => copy(), x: () => copy(true), b: () => toggle('bold'), i: () => toggle('italic'), u: () => toggle('underline'), d: fillDown };
      if (run[key]) { e.preventDefault(); e.stopPropagation(); run[key](); }
      return;
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); ended.current = false; setEdit(k); }
  };

  const colHeads = Array.from({ length: sheet.cols }, (_, i) => i + 1);
  const rowHeads = Array.from({ length: sheet.rows }, (_, i) => i + 1);
  const cls = (r: number, c: number, k: string) => {
    const st = sheet.styles?.[k], out: string[] = [], m = mergeOf.get(`${r},${c}`) ?? { r0: r, c0: c, r1: r, c1: c };
    if (m.r0 <= sel.r1 && m.r1 >= sel.r0 && m.c0 <= sel.c1 && m.c1 >= sel.c0 && !single) out.push('shx-sel');
    if (r === act.r && c === act.c) out.push('shx-act');
    if (values[k]?.error) out.push('shx-err'); else if (sheet.cells[k]?.startsWith('=')) out.push('shx-fx');
    if (values[k]?.unsupported && !values[k]?.error) out.push('shx-keep');
    if (st?.fill) out.push('shx-fill');
    if (st?.accent) out.push('shx-accent');
    if (marks[k]) out.push(marks[k].kind === 'pending' ? 'shx-pend' : 'shx-pend shx-over');
    if (showLinks && sheet.link) { const l = linkAt(sheet, r, c); if (l?.own) out.push('shx-own'); else if (l) out.push('shx-lk'); }
    return out.join(' ');
  };
  const cellStyle = (k: string, r: number, c: number): React.CSSProperties => {
    const st = sheet.styles?.[k] ?? {}, v = values[k]?.value, e = anyBorder ? edgesOf(sheet, r, c) : undefined;
    const edge = (n: 0 | 1 | 2 | undefined) => (n ? `${n}px solid var(--tx)` : undefined);
    return {
      borderTop: edge(e?.t), borderRight: edge(e?.r), borderBottom: edge(e?.b), borderLeft: edge(e?.l),
      fontWeight: st.bold ? 700 : undefined, fontStyle: st.italic ? 'italic' : undefined, textDecoration: st.underline ? 'underline' : undefined,
      textAlign: st.align ?? (typeof v === 'number' ? 'right' : 'left'), whiteSpace: st.wrap ? 'normal' : undefined
    };
  };
  const align = (a: SheetAlign) => style({ align: cur.align === a ? undefined : a });
  const fmt = (f: SheetNumberFormat) => style({ fmt: f === 'general' ? undefined : f });

  return (
    <div className="shx">
      <style>{CSS}</style>
      <h3>Sheets</h3>
      <p className="shx-note">Your own schedules in an Excel-style grid, saved with the project. Formulas: + − × ÷, SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ROUNDUP, ROUNDDOWN, IF, AND, OR, NOT, ABS, SQRT, VLOOKUP. Open an Excel file from the File tab: its formulas, bold, alignment, number formats and widths are kept, and a formula the app cannot work out keeps its value from the file (shown with a dotted underline). Linking columns to the project comes in the next stage.</p>

      <div className="shx-ribbon">
        <div className="shx-tabs" role="tablist" aria-label="Sheet tools">
          <button type="button" role="tab" className="shx-tab" aria-selected={tab === 'file'} onClick={() => setTab('file')}>File</button>
          <button type="button" role="tab" className="shx-tab" aria-selected={tab === 'home'} onClick={() => setTab('home')}>Home</button>
          <button type="button" role="tab" className="shx-tab" aria-selected={tab === 'electrical'} onClick={() => setTab('electrical')}>Electrical</button>
          {['Formulas', 'Data', 'Review'].map((t) => <button key={t} type="button" role="tab" className="shx-tab" aria-selected={false} disabled title={LATER}>{t}</button>)}
        </div>
        {tab === 'file' ? (
          <div className="shx-body">
            <Group name="Sheets">
              <Big icon={FilePlus2} label="New sheet" onClick={addSheet} />
              <div className="shx-col">
                <Small icon={Pencil} label="Rename sheet" onClick={() => setRenaming(sheet.name)} />
                <Small icon={Trash2} label="Delete sheet" onClick={removeSheet} disabled={book.sheets.length < 2} />
              </div>
            </Group>
            <Group name="Excel file">
              <Big icon={FolderOpen} label="Open Excel file" onClick={() => fileInput.current?.click()} disabled={busy} />
              <Big icon={Save} label="Save as .xlsx" onClick={() => void saveFile()} disabled={busy} />
              <input ref={fileInput} type="file" accept=".xlsx" hidden aria-label="Excel file to open" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f); }} />
            </Group>
          </div>
        ) : tab === 'electrical' ? (
          <div className="shx-body">
            <Group name="Project link">
              <Big icon={Link2} label="Link columns" onClick={() => setPanel(panel === 'link' ? null : 'link')} pressed={panel === 'link'} />
              <div className="shx-col">
                <Small icon={Eye} label="Show linked cells" onClick={() => setShowLinks(!showLinks)} pressed={showLinks} />
                <Small icon={Upload} label="Apply to project" onClick={apply} disabled={!waiting} title={waiting ? `Apply to project — ${waiting} typed ${waiting === 1 ? 'value' : 'values'}` : undefined} />
                <Small icon={RefreshCw} label="Refresh from project" onClick={() => { save(discardPending(sheet)); onStatus?.('Typed values that were not applied are removed.'); }} disabled={!waiting && !sheet.link?.added?.length} />
              </div>
            </Group>
            <Group name="Circuits">
              <Small icon={Plus} label={sheet.link?.category === 'md' ? 'Add feeder' : 'Add circuit'} onClick={addCircuit} disabled={!sheet.link?.boardId} />
            </Group>
            <Group name="Sheets for a board">
              <Big icon={LayoutTemplate} label="My formats" onClick={() => setPanel(panel === 'formats' ? null : 'formats')} pressed={panel === 'formats'} />
            </Group>
          </div>
        ) : (
          <div className="shx-body">
            <Group name="Clipboard">
              <Big icon={ClipboardPaste} label="Paste" onClick={() => paste()} />
              <div className="shx-col">
                <Small icon={Scissors} label="Cut" onClick={() => copy(true)} />
                <Small icon={Copy} label="Copy" onClick={() => copy()} />
                <Small icon={ClipboardType} label="Paste values" onClick={() => paste(true)} />
                <Small icon={Paintbrush} label="Copy format" />
              </div>
            </Group>
            <Group name="Font">
              <div className="shx-icons">
                <IconTool icon={Bold} label="Bold" onClick={() => toggle('bold')} pressed={!!cur.bold} />
                <IconTool icon={Italic} label="Italic" onClick={() => toggle('italic')} pressed={!!cur.italic} />
                <IconTool icon={Underline} label="Underline" onClick={() => toggle('underline')} pressed={!!cur.underline} />
                <IconTool icon={PaintBucket} label="Highlight fill" onClick={() => toggle('fill')} pressed={!!cur.fill} />
                <IconTool icon={Baseline} label="Accent text colour" onClick={() => toggle('accent')} pressed={!!cur.accent} />
                <IconTool icon={Grid2x2} label="Borders" onClick={() => style({ border: bordered ? undefined : 'trbl' })} pressed={bordered} />
              </div>
            </Group>
            <Group name="Alignment">
              <div className="shx-icons">
                <IconTool icon={AlignLeft} label="Align left" onClick={() => align('left')} pressed={cur.align === 'left'} />
                <IconTool icon={AlignCenter} label="Align centre" onClick={() => align('center')} pressed={cur.align === 'center'} />
                <IconTool icon={AlignRight} label="Align right" onClick={() => align('right')} pressed={cur.align === 'right'} />
                <IconTool icon={WrapText} label="Wrap text" onClick={() => toggle('wrap')} pressed={!!cur.wrap} />
                <IconTool icon={TableCellsMerge} label="Merge cells" onClick={merge} pressed={!!mergeAt(sheet, act.r, act.c)} disabled={single && !touching} />
                <IconTool icon={RotateCw} label="Rotate heading" />
              </div>
            </Group>
            <Group name="Number">
              <div className="shx-col">
                <Small icon={Hash} label="General" onClick={() => fmt('general')} pressed={!cur.fmt} />
                <Small icon={Dot} label="Decimals 0.00" onClick={() => fmt('dec2')} pressed={cur.fmt === 'dec2'} />
                <Small icon={Percent} label="Percent" onClick={() => fmt('percent')} pressed={cur.fmt === 'percent'} />
                <Small icon={Ruler} label="Units" />
              </div>
            </Group>
            <Group name="Rows and columns">
              <Big icon={BetweenHorizontalStart} label="Insert row" onClick={() => save(insertRows(sheet, sel.r0, sel.r1 - sel.r0 + 1))} />
              <div className="shx-col">
                <Small icon={Trash2} label="Delete row" onClick={() => { save(deleteRows(sheet, sel.r0, sel.r1 - sel.r0 + 1)); move(sel.r0, act.c); }} />
                <Small icon={BetweenVerticalStart} label="Insert column" onClick={() => save(insertCols(sheet, sel.c0, sel.c1 - sel.c0 + 1))} />
                <Small icon={Trash2} label="Delete column" onClick={() => { save(deleteCols(sheet, sel.c0, sel.c1 - sel.c0 + 1)); move(act.r, sel.c0); }} />
                <Small icon={MoveHorizontal} label="Column width" onClick={() => save(withNextWidth(sheet, sel))} />
              </div>
            </Group>
            <Group name="Editing">
              <div className="shx-col">
                <Small icon={Sigma} label="Sum" onClick={sum} />
                <Small icon={ArrowDownToLine} label="Fill down" onClick={fillDown} disabled={sel.r1 === sel.r0} />
                <Small icon={ArrowDownAZ} label="Sort" />
                <Small icon={ListFilter} label="Filter" />
                <Small icon={Search} label="Find" />
                <Small icon={Undo2} label="Undo" onClick={onUndo} />
              </div>
            </Group>
            <Group name="Project">
              <Big icon={Check} label="Apply to project" onClick={apply} disabled={!waiting} />
            </Group>
          </div>
        )}
      </div>

      <div className="shx-bar">
        <label>Cell<input aria-label="Cell" key={`${sheet.id}:${cellName(sel.c0, sel.r0)}:${cellName(sel.c1, sel.r1)}`} defaultValue={single ? name : `${cellName(sel.c0, sel.r0)}:${cellName(sel.c1, sel.r1)}`} spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const p = cellAt(e.currentTarget.value.trim()); if (p) move(p.row, p.col); wrap.current?.focus(); } }} /></label>
        <label>Formula<input aria-label="Formula" key={`${sheet.id}:${name}:${raw}`} defaultValue={raw} spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value, 1, 0); } else if (e.key === 'Escape') { e.currentTarget.value = raw; wrap.current?.focus(); } }}
          onBlur={(e) => { if (e.currentTarget.value !== raw) setCells({ [name]: e.currentTarget.value }); }} /></label>
      </div>

      <div className="shx-main">
      <div className="shx-wrap" ref={wrap} tabIndex={0} onKeyDown={onKey} role="grid" aria-label={`Sheet ${sheet.name}`}
        onPaste={(e) => { if (!editing) { e.preventDefault(); pasteText(e.clipboardData.getData('text/plain')); } }}>
        <table className="shx-grid">
          <colgroup><col style={{ width: 40 }} />{colHeads.map((c) => <col key={c} style={{ width: sheet.widths?.[colName(c)] ?? DEFAULT_WIDTH }} />)}</colgroup>
          <thead>
            <tr><th className="shx-corner" aria-hidden />{colHeads.map((c) => { const f = showLinks ? sheet.link?.columns[colName(c)] : undefined, label = f ? linkFields(sheet.link!.category).find((x) => x.key === f)?.label ?? f : undefined; return <th key={c} scope="col" className={c >= sel.c0 && c <= sel.c1 ? 'shx-on' : undefined} title={label}>{colName(c)}{label && <span className={`shx-lkname${f === 'own' ? ' shx-lkown' : ''}`}>{label}</span>}</th>; })}</tr>
          </thead>
          <tbody>
            {rowHeads.map((r) => (
              <tr key={r}>
                <th scope="row" className={`shx-row${r >= sel.r0 && r <= sel.r1 ? ' shx-on' : ''}`}>{r}</th>
                {colHeads.map((c) => {
                  const k = cellName(c, r), here = editing && r === act.r && c === act.c, m = mergeOf.get(`${r},${c}`);
                  if (m && (m.r0 !== r || m.c0 !== c)) return null;
                  return (
                    <td key={c} data-cell={k} role="gridcell" aria-selected={r === act.r && c === act.c} className={cls(r, c, k)} style={cellStyle(k, r, c)}
                      rowSpan={m ? m.r1 - m.r0 + 1 : undefined} colSpan={m ? m.c1 - m.c0 + 1 : undefined}
                      title={marks[k]?.text ?? (values[k]?.error ? `${values[k]!.error}: ${sheet.cells[k]}` : values[k]?.unsupported ? `Kept from the Excel file with its last value — the app cannot work this formula out: ${sheet.cells[k]}` : undefined)}
                      onMouseDown={(e) => { if (!here) move(r, c, e.shiftKey); }}
                      onDoubleClick={() => openEditor(k, sheet.cells[k] ?? '')}>
                      {here
                        ? <input ref={editInput} aria-label={`Edit ${k}`} defaultValue={edit ?? ''} spellCheck={false}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(e.currentTarget.value, e.shiftKey ? -1 : 1, 0); }
                              else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(e.currentTarget.value, 0, e.shiftKey ? -1 : 1); }
                              else if (e.key === 'Escape') { e.stopPropagation(); ended.current = true; setEdit(null); wrap.current?.focus(); }
                            }}
                            onBlur={(e) => { if (!ended.current) { setEdit(null); setCells({ [k]: e.currentTarget.value }); } }} />
                        : shown(values[k], sheet.styles?.[k]?.fmt)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {panel === 'link' && <LinkPanel project={project} sheet={sheet} sheets={book.sheets} active={act} onSheet={(next) => save(next)} onStatus={onStatus} onClose={() => setPanel(null)} onFormats={() => setPanel('formats')}
        onAddSheets={(made) => onChange({ ...project, sheets: { ...book, sheets: [...book.sheets, ...made] } }, true)} />}
      {panel === 'formats' && <FormatsPanel project={project} sheets={book.sheets} onStatus={onStatus} onClose={() => setPanel(null)} onProject={(next) => onChange(next, true)}
        onAddSheets={(made) => { onChange({ ...project, sheets: { ...book, sheets: [...book.sheets, ...made] } }, true); setSheetId(made[made.length - 1].id); setEdit(null); }} />}
      </div>
      {waiting > 0 && <p className="shx-note">{waiting} typed {waiting === 1 ? 'value waits' : 'values wait'} for Apply to project.</p>}

      <div className="shx-sheets" role="tablist" aria-label="Sheets">
        {book.sheets.map((s) => (renaming !== null && s.id === sheet.id
          ? <input key={s.id} aria-label="Sheet name" autoFocus defaultValue={renaming} style={{ height: 36, padding: '0 10px' }}
              onKeyDown={(e) => { if (e.key === 'Enter') rename(e.currentTarget.value); else if (e.key === 'Escape') setRenaming(null); }} onBlur={(e) => rename(e.currentTarget.value)} />
          : <button key={s.id} type="button" role="tab" className="shx-sheet" aria-selected={s.id === sheet.id} onClick={() => { setSheetId(s.id); setEdit(null); move(1, 1); }} onDoubleClick={() => setRenaming(s.name)}>{s.name}</button>))}
        <button type="button" className="shx-sheet" onClick={addSheet} aria-label="New sheet">+</button>
      </div>
      <p className="shx-note">Type to enter, Enter and Tab to move on, F2 or double-click to edit, Shift with the arrows or a click to select an area, Ctrl/⌘ C, X, V, B, I, U, and Ctrl/⌘ D to fill down. Greyed tools come in later stages.</p>
    </div>
  );
}
