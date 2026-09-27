import { useEffect, useRef, type ReactNode } from 'react';
import jspreadsheet from 'jspreadsheet-ce';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jsuites/dist/jsuites.css';
import type { SheetEdit, SheetModel } from '../../docs/sheet';

type Worksheet = jspreadsheet.WorksheetInstance;
export type SheetMenuItem = { title: string; onclick: () => void };

/** A submission form as an Excel-style sheet (Jspreadsheet CE): type,
 * paste from Excel, fill down, undo. Only the model's editable cells take
 * values; everything else is calculated by the app and refreshes as you
 * type. onEdits applies the values and returns messages for rejected ones. */
export default function FormSheet({ model, onEdits, onStatus, menuFor, height = '62vh', children }: {
  model: SheetModel;
  onEdits: (edits: SheetEdit[]) => { changed: boolean; rejected: string[] };
  onStatus: (m: string) => void;
  /** Extra right-click items for a row. */
  menuFor?: (y: number) => SheetMenuItem[];
  height?: string;
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Worksheet | null>(null);
  const shape = useRef('');
  const quiet = useRef(false); // true while the app itself writes into the grid
  // The grid's handlers are created once per build; keep them current.
  const latest = useRef({ model, onEdits, onStatus, menuFor });
  latest.current = { model, onEdits, onStatus, menuFor };

  const writeTotals = (w: Worksheet, el: HTMLElement, totals?: string[]) => {
    // No API to update footers: store them (the grid redraws its footer from
    // its options) and write the cells directly (the first cell of the row
    // is the row-number column).
    if (totals) (w.options as { footers?: string[][] }).footers = [totals];
    const tds = el.querySelectorAll('tfoot tr:first-child td');
    totals?.forEach((t, x) => { if (tds[x + 1]) tds[x + 1].textContent = t; });
  };

  const refreshValues = (w: Worksheet, m: SheetModel) => {
    quiet.current = true;
    try {
      const current = w.getData() as (string | number)[][];
      m.data.forEach((line, y) => line.forEach((v, x) => {
        if (String(current[y]?.[x] ?? '') !== String(v)) w.setValueFromCoords(x, y, v, true);
      }));
      w.setStyle(m.styles);
    } finally {
      quiet.current = false;
    }
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (ws.current && shape.current === model.shape) {
      refreshValues(ws.current, model);
      writeTotals(ws.current, el, model.totals);
      return;
    }

    const selected = ws.current?.selectedCell as number[] | undefined;
    if (ws.current) jspreadsheet.destroy(el as jspreadsheet.JspreadsheetInstanceElement, true);
    shape.current = model.shape;

    const [w] = jspreadsheet(el, {
      about: false,
      allowExport: false,
      parseFormulas: false,
      autoIncrement: false,
      worksheets: [{
        data: model.data,
        columns: model.cols.map((c) => ({
          title: c.title,
          width: c.width,
          wordWrap: !!c.wrap,
          align: c.align ?? 'center',
          readOnly: c.input ? undefined : true,
          ...(c.source ? { type: 'dropdown' as const, source: c.source, autocomplete: true } : { type: 'text' as const })
        })),
        nestedHeaders: [model.groups],
        mergeCells: model.merges,
        footers: model.totals ? [model.totals] : undefined,
        style: model.styles,
        freezeColumns: model.freezeColumns,
        tableOverflow: true,
        tableWidth: '100%',
        tableHeight: height,
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
        return latest.current.model.editable(Number(y), Number(x)) ? value : (inst.getValueFromCoords(Number(x), Number(y), false) as string);
      },
      onafterchanges: (_inst, changes) => {
        if (quiet.current || !changes.length) return;
        const { model: m, onEdits: apply, onStatus: status } = latest.current;
        const edits = changes.map((c) => ({ x: Number(c.x), y: Number(c.y), value: c.value as string }));
        const { changed, rejected } = apply(edits);
        if (rejected.length) status(`Not applied — ${rejected.slice(0, 3).join('; ')}${rejected.length > 3 ? ` (+${rejected.length - 3} more)` : ''}`);
        // Nothing changed in the project: put the grid back to its values.
        if (!changed) refreshValues(w, m);
      },
      contextMenu: (_inst, _x, y, _e, items, role) => {
        const keep = items.filter((i) => /copy|paste|undo|redo/i.test(i.title ?? ''));
        const extra = role === 'cell' && y !== null ? latest.current.menuFor?.(Number(y)) ?? [] : [];
        return extra.length ? [...keep, { type: 'line', title: '' }, ...extra] : keep;
      }
    });
    ws.current = w;
    if (selected?.length === 4) w.updateSelectionFromCoords?.(selected[0], selected[1], selected[2], selected[3]);
  }, [model]);

  useEffect(() => () => {
    if (host.current && ws.current) jspreadsheet.destroy(host.current as jspreadsheet.JspreadsheetInstanceElement, true);
    ws.current = null;
  }, []);

  return (
    <div className="ls-sheet">
      <div ref={host} />
      {children}
    </div>
  );
}
