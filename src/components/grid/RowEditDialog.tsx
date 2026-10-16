import { useEffect, useRef, useState } from 'react';
import type { SheetEdit, SheetModel } from '../../docs/sheet';

/** Double-click edit dialog for one row of a ClassicGrid form: every
 * typed cell of the row as a field, calculated cells shown for reference.
 * Changes apply together on Save, through the grid's own checks. */
export default function RowEditDialog({ model, y, focusX, hidden, onSave, onClose }: {
  model: SheetModel;
  y: number;
  focusX?: number;
  /** Cells covered by a merge (not drawn). */
  hidden: (y: number, x: number) => boolean;
  onSave: (edits: SheetEdit[]) => void;
  onClose: () => void;
}) {
  const row = model.data[y];
  const text = (x: number) => (row[x] === undefined || row[x] === null ? '' : String(row[x]));
  const [draft, setDraft] = useState<Record<number, string>>({});
  const form = useRef<HTMLFormElement>(null);

  // Group title above each column, for labels like "kWh METER · 3-PH".
  const groupOf: string[] = [];
  for (const g of model.groups) for (let i = 0; i < g.colspan; i++) groupOf.push(g.title);
  const label = (x: number) => [groupOf[x], model.cols[x].title].filter(Boolean).join(' · ') || `Column ${x + 1}`;

  const xs = row.map((_, x) => x).filter((x) => !hidden(y, x) && (model.editable(y, x) || text(x) !== ''));
  const title = xs.map(text).find((v) => v && !/^\d+(\.\d+)?$/.test(v)) ?? `Row ${y + 1}`;

  useEffect(() => {
    const el = form.current?.querySelector<HTMLElement>(`[data-x="${focusX}"]`) ?? form.current?.querySelector<HTMLElement>('[data-x]');
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [focusX]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSave(Object.entries(draft).filter(([x, v]) => v !== text(+x)).map(([x, value]) => ({ y, x: +x, value })));
  }

  return (
    <div className="modal-backdrop" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form ref={form} className="modal row-edit" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Edit: {title}</h3>
        <p className="m">White fields are typed; the rest are calculated. Changes apply on Save.</p>
        <div className="ce-grid">
          {xs.map((x) => {
            const col = model.cols[x];
            const value = draft[x] ?? text(x);
            const set = (v: string) => setDraft({ ...draft, [x]: v });
            if (!model.editable(y, x)) return <label key={x} className="ce-ro">{label(x)}<output>{text(x)}</output></label>;
            return (
              <label key={x} className={col.align === 'left' && !col.source ? 'ce-wide' : undefined}>{label(x)}
                {col.source ? (
                  <select data-x={x} value={value} onChange={(e) => set(e.target.value)}>
                    {!col.source.includes(value) && <option value={value}>{value}</option>}
                    {col.source.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                  </select>
                ) : (
                  <input data-x={x} value={value} inputMode={typeof row[x] === 'number' ? 'decimal' : undefined} onChange={(e) => set(e.target.value)} />
                )}
              </label>
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">Save changes</button>
        </div>
      </form>
    </div>
  );
}
