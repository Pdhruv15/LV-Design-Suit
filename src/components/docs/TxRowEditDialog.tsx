import { Modal } from '../ui';
import { useEffect, useRef, useState } from 'react';
import type { Board } from '../../types';
import { rowCtText, type TxSummaryRow } from '../../docs/txSummary';

const kw = (v: number) => v.toFixed(2);
const num = (v: string) => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);

type Field = 'substation' | 'ref' | 'rating' | 'setting' | 'faultKa' | 'cable' | 'ecc' | 'R' | 'Y' | 'B' | 'df' | '1-PH' | '3-PH' | 'CT' | 'remarks';

/** Double-click edit dialog for one transformer row of the TCL summary.
 * Same fields as the row; changes apply together on Save. */
export default function TxRowEditDialog({ row, substation, onSave, onDelete, onClose }: {
  row: TxSummaryRow;
  substation: string;
  onSave: (patch: Partial<Board>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const r = row;
  const b = r.board;
  const initial: Record<Field, string> = {
    substation,
    ref: b.txRef ?? b.id,
    rating: String(r.ratingA ?? ''),
    setting: String(r.setting ?? ''),
    faultKa: String(r.faultKa ?? ''),
    cable: r.cable,
    ecc: r.ecc,
    R: r.phases.R ? kw(r.phases.R) : '',
    Y: r.phases.Y ? kw(r.phases.Y) : '',
    B: r.phases.B ? kw(r.phases.B) : '',
    df: String(r.df),
    '1-PH': String(r.meters['1-PH'] || ''),
    '3-PH': String(r.meters['3-PH'] || ''),
    CT: String(r.meters.CT || ''),
    remarks: b.supply?.ctRatio ? `${b.supply.ctRatio} CT` : rowCtText(r)
  };
  const [d, setD] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = form.current?.querySelector<HTMLInputElement>('input[data-f="ref"]');
    el?.focus();
    el?.select();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const changed = (f: Field) => d[f] !== initial[f];
    const patch: Partial<Board> = {};
    const supply = { ...b.supply };
    if (changed('substation')) patch.substation = d.substation.trim() || undefined;
    if (changed('ref')) patch.txRef = d.ref.trim() && d.ref.trim() !== b.id ? d.ref.trim() : undefined;
    if (changed('rating')) supply.ratingA = num(d.rating);
    if (changed('setting')) supply.irSetting = num(d.setting);
    if (changed('faultKa')) supply.faultKa = num(d.faultKa);
    if (changed('cable')) supply.cable = d.cable || undefined;
    if (changed('ecc')) supply.ecc = d.ecc || undefined;
    if (changed('remarks')) supply.ctRatio = d.remarks.replace(/\s*CT\s*$/i, '').trim() || undefined;
    if ((['rating', 'setting', 'faultKa', 'cable', 'ecc', 'remarks'] as Field[]).some(changed)) patch.supply = supply;
    if (r.manual && (['R', 'Y', 'B'] as const).some(changed)) patch.summaryLoad = { R: num(d.R) ?? 0, Y: num(d.Y) ?? 0, B: num(d.B) ?? 0 };
    if (changed('df')) patch.mdDemandFactor = num(d.df);
    if (r.manual && (['1-PH', '3-PH', 'CT'] as const).some(changed)) patch.summaryMeters = { ...b.summaryMeters, '1-PH': num(d['1-PH']) ?? 0, '3-PH': num(d['3-PH']) ?? 0, CT: num(d.CT) ?? 0 };
    if (Object.keys(patch).length) onSave(patch);
    else onClose();
  }

  const field = (f: Field, label: string, extra?: { ph?: string; wide?: boolean }) => (
    <label key={f} className={extra?.wide ? 'ce-wide' : undefined}>{label}
      <input data-f={f} value={d[f]} placeholder={extra?.ph} onChange={(e) => setD({ ...d, [f]: e.target.value })} />
    </label>
  );
  const shown = (label: string, v: string) => <label key={label} className="ce-ro">{label}<output>{v}</output></label>;

  return (
    <Modal onClose={onClose} className="modal row-edit" onSubmit={submit} boxRef={form}>
      <h3>Edit transformer: {initial.ref}</h3>
      <p className="m">{r.manual ? 'Nothing drawn below yet — loads and meters are typed here.' : 'Loads and meters come from the boards below it.'} Changes apply on Save.</p>
      <div className="ce-grid">
        {field('ref', 'Transformer reference')}
        {field('substation', 'Substation')}
        {shown('SP/TP', r.poles)}
      </div>
      <fieldset>
        <legend>Main breaker</legend>
        <div className="ce-grid">
          {field('rating', `${r.device} rating (A)`)}
          {r.device === 'ACB' && field('setting', 'Setting (× In)', { ph: '1.0' })}
          {field('faultKa', 'Fault duty (kA)')}
        </div>
      </fieldset>
      <fieldset>
        <legend>Cable</legend>
        <div className="ce-grid">
          {field('cable', 'Cable size / type', { wide: true })}
          {field('ecc', 'ECC size 1C, mm²', { ph: '2X150' })}
        </div>
      </fieldset>
      <fieldset>
        <legend>Connection load</legend>
        <div className="ce-grid">
          {(['R', 'Y', 'B'] as const).map((ph) => (r.manual ? field(ph, `${ph}-phase kW`, { ph: '0.00' }) : shown(`${ph}-phase kW`, kw(r.phases[ph]))))}
          {shown('TCL (kW)', kw(r.tclKw))}
          {field('df', 'D.F')}
          {shown('MDL (kW)', kw(r.mdlKw))}
        </div>
      </fieldset>
      <fieldset>
        <legend>kWh meters</legend>
        <div className="ce-grid">
          {(['1-PH', '3-PH', 'CT'] as const).map((m) => (r.manual ? field(m, m) : shown(m, String(r.meters[m] || ''))))}
        </div>
      </fieldset>
      {field('remarks', 'Remarks (CT ratio)')}
      <div className="modal-actions">
        <button type="button" className="chip bad-btn" onClick={onDelete}>{r.manual ? 'Remove transformer' : 'Remove with everything below'}</button>
        <span className="sp" />
        <button type="button" className="chip" onClick={onClose}>Cancel</button>
        <button type="submit" className="chip primary">Save changes</button>
      </div>
    </Modal>
  );
}
