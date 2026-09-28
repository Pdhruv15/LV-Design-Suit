import { useRef, type ReactNode } from 'react';
import { cellName, STYLE, type SheetEdit, type SheetModel } from '../../docs/sheet';
import { cellKey } from './excelGrid';
import { useExcelGrid } from './useExcelGrid';

/** Cell look from the model's style: input, calculated, label row, muted. */
function cellClass(style: string | undefined): string {
  if (!style) return '';
  if (style.startsWith(STYLE.label)) return 'gx-label';
  if (style.startsWith(STYLE.muted)) return 'gx-muted';
  if (style.startsWith(STYLE.calc)) return 'gx-calc';
  return '';
}

/** A form (SheetModel) drawn as the app's own Classic table, with
 * Excel-style keys, paste, selection, copy and fill down (useExcelGrid).
 * Typing commits on Enter / leaving the cell; onEdits validates and applies,
 * returning messages for values that don't fit. */
export default function ClassicGrid({ model, onEdits, onStatus, children, className }: {
  model: SheetModel;
  onEdits: (edits: SheetEdit[]) => { changed: boolean; rejected: string[] };
  onStatus: (m: string) => void;
  children?: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const apply = (edits: SheetEdit[]) => {
    if (!edits.length) return;
    const { rejected } = onEdits(edits);
    if (rejected.length) onStatus(`Not applied — ${rejected.slice(0, 3).join('; ')}${rejected.length > 3 ? ` (+${rejected.length - 3} more)` : ''}`);
  };
  useExcelGrid(root, apply);

  // Merged cells: the top-left cell spans, the others are skipped.
  const covered = new Set<string>();
  const span = new Map<string, [number, number]>();
  for (const [name, [cols, rows]] of Object.entries(model.merges)) {
    const m = name.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    const x0 = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const y0 = Number(m[2]) - 1;
    span.set(cellKey(y0, x0), [cols, rows]);
    for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x0 + cols; x++) if (y !== y0 || x !== x0) covered.add(cellKey(y, x));
  }

  return (
    <div className={`gx-wrap ${className ?? ''}`} ref={root}>
      <table className="gx">
        <thead>
          {model.groups.some((g) => g.title) && (
            <tr>{model.groups.map((g, i) => <th key={i} colSpan={g.colspan} className={g.title ? 'gx-group' : 'gx-blank'}>{g.title}</th>)}</tr>
          )}
          <tr>{model.cols.map((c, i) => <th key={i} style={{ minWidth: c.width }}>{c.title}</th>)}</tr>
        </thead>
        <tbody>
          {model.data.map((row, y) => (
            <tr key={y}>
              {row.map((v, x) => {
                const k = cellKey(y, x);
                if (covered.has(k)) return null;
                const [cs, rs] = span.get(k) ?? [1, 1];
                const col = model.cols[x];
                const cls = `${cellClass(model.styles[cellName(x, y)])} ${col.align === 'left' ? 'l' : ''}`.trim();
                const value = v === undefined || v === null ? '' : String(v);
                if (!model.editable(y, x)) {
                  return <td key={x} colSpan={cs} rowSpan={rs} className={cls} data-cell={k}>{value}</td>;
                }
                return (
                  <td key={x} colSpan={cs} rowSpan={rs} className={`gx-in ${cls}`}>
                    {col.source ? (
                      <select data-cell={k} value={value} onChange={(e) => apply([{ y, x, value: e.target.value }])}>
                        {!col.source.includes(value) && <option value={value}>{value}</option>}
                        {col.source.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                      </select>
                    ) : (
                      <input
                        key={value}
                        data-cell={k}
                        defaultValue={value}
                        inputMode={typeof v === 'number' ? 'decimal' : undefined}
                        onBlur={(e) => { if (e.target.value !== value) apply([{ y, x, value: e.target.value }]); }}
                        onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLInputElement).value = value; }}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {model.totals && (
          <tfoot>
            <tr>{model.totals.map((t, i) => <td key={i}>{t}</td>)}</tr>
          </tfoot>
        )}
      </table>
      {children}
    </div>
  );
}
