import { useEffect, useMemo, useRef } from 'react';
import jspreadsheet from 'jspreadsheet-ce';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jsuites/dist/jsuites.css';
import type { Project } from '../../types';
import { deleteCircuit } from '../../model/schedule';
import { applySheetEdits, buildDbSheet, colName, isEditable, type DbSheet, type SheetEdit } from '../../docs/dbSheet';

type Worksheet = jspreadsheet.WorksheetInstance;

/** Cell styles: input cells white, calculated cells grey, the WATT / UNIT
 * row and empty ways tinted, and the check column coloured by result. */
function cellStyles(sheet: DbSheet): Record<string, string> {
  const out: Record<string, string> = {};
  sheet.rows.forEach((row, y) => {
    sheet.cols.forEach((c, x) => {
      const name = `${colName(x)}${y + 1}`;
      if (row.type === 'watts') {
        out[name] = c.key.startsWith('pt:') ? 'background-color:#fff6d6;font-weight:600' : 'background-color:#fff6d6;font-weight:600;color:#6b5a1e';
      } else if (!isEditable(sheet, y, x) || c.key === 'incomer' || c.key === 'elcb') {
        out[name] = c.key === 'ref' && row.type === 'slot' ? 'background-color:#f3f5f8;color:#9aa6b8' : 'background-color:#eef1f5;color:#26303d';
      } else if (row.type === 'slot') {
        out[name] = 'background-color:#fbfcfe';
      }
      if (c.key === 'check' && row.type === 'circuit') {
        const s = sheet.status[y];
        out[name] = `background-color:#eef1f5;font-weight:600;color:${s === 'bad' ? '#c21f32' : s === 'warn' ? '#a86500' : '#13803d'}`;
      }
      if (c.key === 'incomer' || c.key === 'elcb') out[name] += ';writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-size:11px';
    });
  });
  return out;
}

/** The DB load schedule as an Excel-style sheet (Jspreadsheet CE): type,
 * paste from Excel, fill down, undo. Only the white cells take input; the
 * grey ones are calculated by the app and refresh as you type. */
export default function LoadScheduleSheet({ project, boardId, onChange, onStatus }: {
  project: Project;
  boardId: string;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Worksheet | null>(null);
  const shape = useRef('');
  const quiet = useRef(false); // true while the app itself writes into the grid
  const sheet = useMemo(() => buildDbSheet(project, boardId), [project, boardId]);
  // The grid's event handlers are created once per build; keep them reading
  // the latest project and sheet.
  const latest = useRef({ project, sheet, onChange, onStatus });
  latest.current = { project, sheet, onChange, onStatus };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (ws.current && shape.current === sheet.shape) {
      // Same rows and columns: refresh values only, keeping the selection.
      quiet.current = true;
      try {
        const current = ws.current.getData() as (string | number)[][];
        sheet.data.forEach((line, y) => line.forEach((v, x) => {
          if (String(current[y]?.[x] ?? '') !== String(v)) ws.current!.setValueFromCoords(x, y, v, true);
        }));
        ws.current.setStyle(cellStyles(sheet));
        // No API to update footers: write the TOTAL (kW) cells directly
        // (the first cell of the row is the row-number column).
        const tds = el.querySelectorAll('tfoot tr:first-child td');
        sheet.totals.forEach((t, x) => { if (tds[x + 1]) tds[x + 1].textContent = t; });
      } finally {
        quiet.current = false;
      }
      return;
    }

    const selected = ws.current?.selectedCell as number[] | undefined;
    if (ws.current) jspreadsheet.destroy(el as jspreadsheet.JspreadsheetInstanceElement, true);
    shape.current = sheet.shape;

    const toEdits = (changes: { x: string | number; y: string | number; value: unknown }[]): SheetEdit[] =>
      changes.map((c) => ({ x: Number(c.x), y: Number(c.y), value: c.value as string }));

    const [w] = jspreadsheet(el, {
      about: false,
      allowExport: false,
      parseFormulas: false,
      autoIncrement: false,
      worksheets: [{
        data: sheet.data,
        columns: sheet.cols.map((c) => ({
          title: c.title,
          width: c.width,
          wordWrap: c.key === 'room' || c.key === 'remarks',
          align: c.key === 'room' || c.key === 'remarks' ? 'left' : 'center',
          readOnly: !c.input && c.key !== 'incomer' && c.key !== 'elcb' ? true : undefined,
          ...(c.source ? { type: 'dropdown' as const, source: c.source, autocomplete: true } : { type: 'text' as const })
        })),
        nestedHeaders: [sheet.groups],
        mergeCells: sheet.merges,
        footers: [sheet.totals],
        style: cellStyles(sheet),
        freezeColumns: sheet.cols.findIndex((c) => c.key === 'room') + 1,
        tableOverflow: true,
        tableWidth: '100%',
        tableHeight: '62vh',
        allowInsertRow: false,
        allowManualInsertRow: false,
        allowInsertColumn: false,
        allowManualInsertColumn: false,
        allowDeleteRow: false,
        allowDeleteColumn: false,
        allowRenameColumn: false,
        columnSorting: false,
        columnDrag: false,
        rowDrag: false,
        allowComments: false,
        defaultRowHeight: 24
      }],
      // Locked cells keep their value (typing, delete key, paste, fill).
      onbeforechange: (inst, _cell, x, y, value) => {
        if (quiet.current) return value;
        return isEditable(latest.current.sheet, Number(y), Number(x)) ? value : (inst.getValueFromCoords(Number(x), Number(y), false) as string);
      },
      onafterchanges: (_inst, changes) => {
        if (quiet.current || !changes.length) return;
        const { project: p, sheet: s, onChange: set, onStatus: status } = latest.current;
        const { project: next, rejected } = applySheetEdits(p, s, toEdits(changes));
        if (rejected.length) status(`Not applied — ${rejected.slice(0, 3).join('; ')}${rejected.length > 3 ? ` (+${rejected.length - 3} more)` : ''}`);
        if (next !== p) set(next);
        else {
          // Nothing changed in the project: put the grid back to the project's values.
          quiet.current = true;
          try { s.data.forEach((line, yy) => line.forEach((v, xx) => w.setValueFromCoords(xx, yy, v, true))); } finally { quiet.current = false; }
        }
      },
      contextMenu: (_inst, x, y, _e, items, role) => {
        const { project: p, sheet: s, onChange: set } = latest.current;
        const row = y === null ? undefined : s.rows[Number(y)];
        const keep = items.filter((i) => /copy|paste|undo|redo/i.test(i.title ?? ''));
        if (role !== 'cell' || !row || row.type !== 'circuit') return keep;
        const f = row.feeder;
        return [
          ...keep,
          { type: 'line', title: '' },
          {
            title: `Delete circuit ${f.phase}${f.way}${f.room ? ` (${f.room})` : ''}`,
            onclick: () => window.confirm(`Delete circuit ${f.phase}${f.way}?`) && set(deleteCircuit(p, f.id))
          }
        ];
      }
    });
    ws.current = w;
    if (selected?.length === 4) w.updateSelectionFromCoords?.(selected[0], selected[1], selected[2], selected[3]);
  }, [sheet]);

  useEffect(() => () => {
    if (host.current && ws.current) jspreadsheet.destroy(host.current as jspreadsheet.JspreadsheetInstanceElement, true);
    ws.current = null;
  }, []);

  return (
    <div className="ls-sheet">
      <div ref={host} />
      <p className="ls-sheet-foot">{sheet.cableText}</p>
    </div>
  );
}
