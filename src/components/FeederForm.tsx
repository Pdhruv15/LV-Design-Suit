import { useState } from 'react';
import type { Feeder, Project } from '../types';
import { CABLE_TABLE } from '../calc/cableTable';
import { selectCable } from '../calc/electrical';

const SQRT3 = Math.sqrt(3);
const emptyFeeder = (boardId: string): Feeder => ({
  id: '', boardId, name: '', loadKw: 10, demandFactor: 0.8, powerFactor: 0.85,
  lengthM: 20, cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 25
});

export default function FeederForm({
  project,
  boardId,
  initial,
  onSave,
  onDelete,
  onClose
}: {
  project: Project;
  boardId: string;
  initial?: Feeder;
  onSave: (f: Feeder) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Feeder>(initial ?? emptyFeeder(boardId));
  const [suggestion, setSuggestion] = useState<string>('');
  const isNew = !initial;

  function set<K extends keyof Feeder>(key: K, val: Feeder[K]) {
    setF((prev) => ({ ...prev, [key]: val }));
  }

  function suggestCable() {
    const demandKw = f.loadKw * f.demandFactor;
    const ib = (demandKw * 1000) / (SQRT3 * project.voltageV * f.powerFactor);
    const size = selectCable(ib, f.lengthM, project.voltageV, f.cores, f.powerFactor, project.ambientC, project.vdLimitPct);
    if (size) {
      set('cableCsaMm2', size);
      setSuggestion(`Ib ≈ ${ib.toFixed(0)} A → ${size} mm² satisfies ampacity and the ${project.vdLimitPct}% voltage-drop limit at ${f.lengthM} m.`);
    } else {
      setSuggestion(`Ib ≈ ${ib.toFixed(0)} A — no cable up to 300 mm² meets the voltage-drop limit at this length. Consider shortening the run or raising the limit.`);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.id.trim() || !f.name.trim()) return;
    onSave(f);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{isNew ? 'Add feeder' : `Edit feeder: ${initial!.id}`}</h3>
        <div className="grid2">
          <label>Circuit ID<input value={f.id} disabled={!isNew} required onChange={(e) => set('id', e.target.value)} placeholder="e.g. DB-KITCHEN" /></label>
          <label>Name<input value={f.name} required onChange={(e) => set('name', e.target.value)} placeholder="e.g. Kitchen distribution board" /></label>
          <label>Connected load (kW)<input type="number" step="0.1" value={f.loadKw} onChange={(e) => set('loadKw', +e.target.value)} /></label>
          <label>Demand factor<input type="number" step="0.01" min="0" max="1" value={f.demandFactor} onChange={(e) => set('demandFactor', +e.target.value)} /></label>
          <label>Power factor<input type="number" step="0.01" min="0" max="1" value={f.powerFactor} onChange={(e) => set('powerFactor', +e.target.value)} /></label>
          <label>Cable length (m)<input type="number" step="1" value={f.lengthM} onChange={(e) => set('lengthM', +e.target.value)} /></label>
          <label>Cores
            <select value={f.cores} onChange={(e) => set('cores', +e.target.value as 2 | 3 | 4)}>
              <option value={2}>2 (single-phase)</option>
              <option value={3}>3</option>
              <option value={4}>4 (3-phase)</option>
            </select>
          </label>
          <label>Cable size (mm²)
            <select value={f.cableCsaMm2} onChange={(e) => set('cableCsaMm2', +e.target.value)}>
              {CABLE_TABLE.map((c) => (
                <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2} mm²</option>
              ))}
            </select>
          </label>
          <label>Breaker rating (A)<input type="number" step="1" value={f.breakerRatingA} onChange={(e) => set('breakerRatingA', +e.target.value)} /></label>
          <label>Breaker Icu (kA)<input type="number" step="0.5" value={f.breakerIcuKa} onChange={(e) => set('breakerIcuKa', +e.target.value)} /></label>
        </div>
        <label className="row"><input type="checkbox" checked={!!f.generation} onChange={(e) => set('generation', e.target.checked)} /> Generation source (PV / generator)</label>

        <div className="suggest-row">
          <button type="button" className="chip" onClick={suggestCable}>Suggest cable size</button>
          {suggestion && <span className="m">{suggestion}</span>}
        </div>

        <div className="modal-actions">
          {onDelete && <button type="button" className="chip bad-btn" onClick={onDelete}>Delete feeder</button>}
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">{isNew ? 'Add feeder' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}
