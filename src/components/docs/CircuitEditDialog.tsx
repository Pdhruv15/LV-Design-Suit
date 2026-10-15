import { useEffect, useRef, useState } from 'react';
import type { Board, Feeder, PointType, Project } from '../../types';
import { cables } from '../../calc/cableTable';
import { defaultCpcMm2 } from '../../calc/earthing';
import { breakerRatings } from '../../calc/sizing';
import { pointLabel, type pointColumns } from '../../calc/loadSchedule';
import type { CircuitPatch } from '../../model/schedule';

const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.round(+v) || 0));

/** Double-click edit dialog for one load schedule circuit. Edits the same
 * fields as the table row; changes apply on Save. `focus` is the field the
 * user double-clicked (a sheet column key like 'mcb' or 'pt:ltg'). */
export default function CircuitEditDialog({
  project,
  board,
  feeder,
  circuitRef,
  columns,
  focus,
  onSave,
  onDelete,
  onClose
}: {
  project: Project;
  board: Board;
  feeder: Feeder;
  circuitRef: string;
  columns: ReturnType<typeof pointColumns>;
  focus?: string;
  onSave: (patch: CircuitPatch) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const f = feeder;
  const [room, setRoom] = useState(f.room ?? '');
  const [remarks, setRemarks] = useState(f.remarks ?? '');
  const [points, setPoints] = useState<Partial<Record<PointType, number>>>({ ...f.points });
  const [mcb, setMcb] = useState(f.breakerRatingA);
  const [wire, setWire] = useState(f.cableCsaMm2);
  const [ecc, setEcc] = useState<number | undefined>(f.cpcMm2);
  const [length, setLength] = useState(String(f.lengthM));
  const [manual, setManual] = useState(!!f.manualSize);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const el = form.current?.querySelector<HTMLElement>(`[data-field="${focus ?? 'room'}"]`) ?? form.current?.querySelector<HTMLElement>('[data-field="room"]');
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [focus]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const len = Number(length.replace(',', '.'));
    if (!(len > 0)) return;
    const patch: CircuitPatch = {};
    if (room !== (f.room ?? '')) patch.room = room;
    if (remarks !== (f.remarks ?? '')) patch.remarks = remarks || undefined;
    if (columns.some((t) => (points[t.value as PointType] ?? 0) !== (f.points?.[t.value as PointType] ?? 0))) patch.points = points;
    if (len !== f.lengthM) patch.lengthM = len;
    // Only send sizes that changed: sending any of them marks the circuit hand-sized.
    if (manual) {
      if (mcb !== f.breakerRatingA) patch.breakerRatingA = mcb;
      if (wire !== f.cableCsaMm2) patch.cableCsaMm2 = wire;
      if (ecc !== f.cpcMm2) patch.cpcMm2 = ecc;
    }
    if (manual !== !!f.manualSize) patch.manualSize = manual;
    if (Object.keys(patch).length) onSave(patch);
    else onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form ref={form} className="modal circuit-edit" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Edit circuit: {circuitRef}</h3>
        <p className="m">{board.id} · phase {f.phase} · changes apply on Save.</p>
        <div className="ce-grid">
          <label>Room / area<input data-field="room" value={room} placeholder="Room" onChange={(e) => setRoom(e.target.value)} /></label>
          <label>Length (m) <span className="m">calc only</span>
            <input data-field="length" inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} aria-invalid={!(Number(length.replace(',', '.')) > 0)} />
          </label>
        </div>
        <fieldset className="ce-points">
          <legend>Connected loads / points</legend>
          <div className="ce-grid ce-pts">
            {columns.map((t) => (
              <label key={t.value} title={t.title}>{pointLabel(board, t.value, project)}
                <input data-field={`pt:${t.value}`} inputMode="numeric" value={points[t.value as PointType] || ''}
                  onChange={(e) => setPoints({ ...points, [t.value]: num(e.target.value) })} />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Protection &amp; wiring</legend>
          <label className="row"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Sized by hand <span className="m">(untick to size MCB, wire and ECC from the load again)</span></label>
          <div className="ce-grid">
            <label>MCB (A)
              <select data-field="mcb" value={mcb} disabled={!manual} onChange={(e) => setMcb(+e.target.value)}>
                {[...new Set([...breakerRatings().filter((a) => a <= 125), mcb])].sort((a, b) => a - b).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label>CCT wire mm²
              <select data-field="wire" value={wire} disabled={!manual} onChange={(e) => setWire(+e.target.value)}>
                {cables().map((c) => <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2}</option>)}
              </select>
            </label>
            <label>ECC mm²
              <select data-field="ecc" value={ecc ?? ''} disabled={!manual} onChange={(e) => setEcc(e.target.value === '' ? undefined : +e.target.value)}>
                <option value="">{defaultCpcMm2(wire)} (default)</option>
                {cables().filter((c) => c.csaMm2 <= wire).map((c) => <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2}</option>)}
              </select>
            </label>
          </div>
        </fieldset>
        <label>Remarks<input data-field="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
        <div className="modal-actions">
          <button type="button" className="chip bad-btn" onClick={() => window.confirm(`Delete circuit ${circuitRef}?`) && onDelete()}>Delete circuit</button>
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">Save changes</button>
        </div>
      </form>
    </div>
  );
}
