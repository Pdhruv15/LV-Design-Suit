import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { cellAt, cellName, colName } from '../../calc/sheetFormula';
import { linkBoards, linkFields, linkFromPlaceholders, linkLabel, linkNeeds, linkToBoard, removeLink, setFirstRow, setLinkCell, setLinkColumn, sheetsForBoards, startLink, suggestLink, templateOf } from '../../docs/sheetLink';
import { formatNameError, loadFormats, saveFormats, withFormat } from '../../model/scheduleFormats';
import { mergeAt, type Sheet, type SheetLink } from '../../model/sheets';
import type { Project } from '../../types';
import { ask } from '../ConfirmDialog';
import { PANEL_CSS } from './panelCss';

/** The Link columns panel of the Sheets page: which cells and columns of a sheet are linked to a DB of the project. */

/** The heading of a column: the text above the first circuit row, or that of the merged area holding it, or the nearest text above (three rows). */
function headingOf(sheet: Sheet, col: number, first: number): string {
  for (let r = first - 1; r >= Math.max(1, first - 3); r--) {
    const m = mergeAt(sheet, r, col), t = (m ? sheet.cells[cellName(m.c0, m.r0)] : sheet.cells[cellName(col, r)]) ?? '';
    if (t.trim()) return t.trim();
  }
  return '';
}

export default function LinkPanel({ project, sheet, sheets, active, onSheet, onAddSheets, onStatus, onClose, onFormats }: {
  project: Project; sheet: Sheet; sheets: Sheet[]; active: { r: number; c: number }; onSheet: (next: Sheet) => void; onAddSheets: (made: Sheet[]) => void; onStatus?: (m: string) => void; onClose: () => void; onFormats: () => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const [kind, setKind] = useState<SheetLink['category']>('db');
  const link = sheet.link, name = cellName(active.c, active.r);
  const head = (
    <div className="shl-head"><h4>Link columns</h4><button type="button" className="shl-btn shl-x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button></div>
  );
  const kindSelect = (value: SheetLink['category'], onChange: (to: SheetLink['category']) => void) => (
    <label className="shl-row"><span>This sheet is a</span>
      <select aria-label="This sheet is a" value={value} onChange={(e) => onChange(e.target.value as SheetLink['category'])}>
        <option value="db">{linkLabel('db')}</option><option value="md">{linkLabel('md')} (MDB, SMDB, MCC)</option>
      </select></label>
  );
  if (!link) {
    const holders = kind === 'db' ? linkFromPlaceholders(sheet) : undefined;
    return (
      <aside className="shl" aria-label="Link columns">
        <style>{PANEL_CSS}</style>
        {head}
        <p>This sheet is not linked to the project.</p>
        {kindSelect(kind, setKind)}
        <button type="button" className="shl-btn shl-go" onClick={() => { const s = suggestLink(sheet, kind); if (s) onSheet(s); else onStatus?.('No heading row found. Start with no links and pick the first circuit row.'); }}>Suggest links from the headings</button>
        {holders && <button type="button" className="shl-btn" onClick={() => { onSheet(holders.sheet); if (holders.unknown.length) onStatus?.(`Not linked: ${holders.unknown.join(', ')}`); }}>Use the placeholders in this sheet</button>}
        <button type="button" className="shl-btn" onClick={() => onSheet(startLink(sheet, active.r, kind))}>Start with no links</button>
        {loadFormats().length > 0 && <button type="button" className="shl-btn" onClick={onFormats}>Use one of my formats…</button>}
      </aside>
    );
  }
  const saveFormat = (text: string) => {
    const bad = formatNameError(text, []);
    if (bad) { onStatus?.(bad); return; }
    const r = withFormat(loadFormats(), text, templateOf(sheet)!);
    saveFormats(r.list);
    setNaming(null);
    onStatus?.(r.updated ? `Format "${text.trim()}" updated.` : `Format "${text.trim()}" saved. It is in My formats for every project.`);
  };
  const panel = link.category === 'md';
  const changeKind = async (to: SheetLink['category']) => {
    if (to === link.category) return;
    if ((Object.keys(link.cells).length || Object.keys(link.columns).length) && !(await ask(`Change this sheet to a ${to === 'db' ? 'DB schedule' : 'panel schedule'}? Its links are removed: the two have different fields.`))) return;
    onSheet(startLink(removeLink(sheet), link.firstRow, to));
  };
  const boards = linkBoards(project, link.category), needs = linkNeeds(link), ready = needs.every((n) => n.ok);
  const cellFields = linkFields(link.category).filter((f) => f.kind === 'cell'), rowFields = linkFields(link.category).filter((f) => f.kind === 'row');
  const lastRow = link.firstRow + Math.max(1, link.rows.length) - 1;
  const used = new Set(Object.values(link.cells).map((c) => c.field));
  const free = cellFields.find((f) => !used.has(f.key));
  const cellList = Object.entries(link.cells).sort(([a], [b]) => { const p = cellAt(a)!, q = cellAt(b)!; return p.row - q.row || p.col - q.col; });
  const columns = Array.from({ length: sheet.cols }, (_, i) => i + 1).map((c) => ({ letters: colName(c), heading: headingOf(sheet, c, link.firstRow) })).filter((c) => c.heading || link.columns[c.letters]);
  const others = boards.filter((b) => !sheets.some((s) => s.link?.boardId === b.id));
  return (
    <aside className="shl" aria-label="Link columns">
      <style>{PANEL_CSS}</style>
      {head}
      {kindSelect(link.category, (to) => void changeKind(to))}
      <label className="shl-row"><span>Board</span>
        <select aria-label="Board" value={link.boardId ?? ''} onChange={(e) => { if (e.target.value) onSheet(linkToBoard(sheet, e.target.value)); }}>
          <option value="">Choose a board</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
        </select></label>
      <div className="shl-row"><span>First circuit row</span>
        <input type="number" min={1} aria-label="First circuit row" key={link.firstRow} defaultValue={link.firstRow} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== link.firstRow) onSheet(setFirstRow(sheet, n)); else e.target.value = String(link.firstRow); }} />
        <button type="button" className="shl-btn" onClick={() => onSheet(setFirstRow(sheet, active.r))} disabled={active.r === link.firstRow}>Use row {active.r}</button></div>

      <h5>Cells of the sheet</h5>
      {cellList.map(([k, c]) => {
        const at = cellAt(k)!, caption = c.before?.replace(/\s*:\s*$/, '').trim() || (at.col > 1 ? sheet.cells[cellName(at.col - 1, at.row)] ?? '' : '');
        return (
          <div className="shl-line" key={k}>
            <span>{k}</span><span className="shl-cap" title={caption}>{caption}</span>
            <select aria-label={`Field of ${k}`} value={c.field} onChange={(e) => onSheet(setLinkCell(sheet, k, e.target.value))}>
              {!cellFields.some((f) => f.key === c.field) && <option value={c.field}>{c.field}</option>}
              {cellFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <button type="button" className="shl-btn shl-x" aria-label={`Unlink ${k}`} onClick={() => onSheet(setLinkCell(sheet, k, undefined))}><X size={14} aria-hidden /></button>
          </div>
        );
      })}
      <button type="button" className="shl-btn" disabled={!!link.cells[name] || (active.r >= link.firstRow && active.r <= lastRow) || !free} onClick={() => free && onSheet(setLinkCell(sheet, name, free.key))}>Link cell {name}</button>

      <h5>Columns — row {link.firstRow} repeats for every {panel ? 'feeder' : 'circuit'}</h5>
      <div className="shl-cols" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {columns.map(({ letters, heading }) => {
          const f = link.columns[letters] ?? '';
          return (
            <div className="shl-line" key={letters}>
              <span>{letters}</span><span className="shl-cap" title={heading}>{heading}</span>
              <select aria-label={`Link of column ${letters}`} className={f === 'own' ? 'shl-own' : undefined} value={f} onChange={(e) => onSheet(setLinkColumn(sheet, letters, e.target.value || undefined))}>
                <option value="">Not linked</option>
                {rowFields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <div className="shl-needs" aria-label="Needed to build the board and the SLD">
        <strong>Needed to build the board and the SLD</strong>
        {needs.map((n) => <div className="shl-need" key={n.key}>{n.ok ? <Check size={14} color="var(--ok)" aria-label="done" /> : <X size={14} color="var(--bad)" aria-label="missing" />}<span>{n.label}</span></div>)}
        <span className="shl-mut">Optional: {panel ? 'device, rating' : 'MCB'} and cable. Left blank, the app sizes them by the rules.</span>
      </div>
      <p style={{ color: ready ? 'var(--ok)' : 'var(--mut)' }}>{ready ? 'Ready — this sheet can build boards, circuits and the SLD.' : 'Not ready — link what is marked above.'}</p>
      {link.boardId && <button type="button" className="shl-btn shl-go" disabled={!others.length} onClick={() => onAddSheets(sheetsForBoards(sheets, sheet, others.map((b) => b.id)))}>Add a sheet for every other {panel ? 'panel' : 'DB'} ({others.length})</button>}
      {naming === null
        ? <button type="button" className="shl-btn" onClick={() => setNaming(loadFormats().find((f) => f.name === sheet.name)?.name ?? sheet.source?.replace(/\.[^.]*$/, '') ?? sheet.name)}>Save as my format…</button>
        : <div className="shl-row">
            <input aria-label="Format name" autoFocus defaultValue={naming} style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') saveFormat(e.currentTarget.value); else if (e.key === 'Escape') setNaming(null); }} />
            <button type="button" className="shl-btn" onClick={(e) => saveFormat((e.currentTarget.parentElement!.querySelector('input') as HTMLInputElement).value)}>Save</button>
            <button type="button" className="shl-btn" onClick={() => setNaming(null)}>Cancel</button>
          </div>}
      <button type="button" className="shl-btn" onClick={() => onSheet(removeLink(sheet))}>Remove the link</button>
      <p className="shl-note">Linked cells are filled from the project. What you type in them is kept until you press Apply to project.</p>
    </aside>
  );
}
