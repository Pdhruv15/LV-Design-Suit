import { STARTERS } from '../calc/motor';
import { useState } from 'react';
import { BREAKER_TYPES, LOAD_TYPES, type BreakerType, type Feeder, type LoadType, type Project } from '../types';
import { breakerTypeOf, defaultCpcMm2 } from '../calc/earthing';
import type { LibraryLoad } from '../database/database';

/** Diagram icon for a library item, from its category or schedule column. */
function libraryLoadType(item: LibraryLoad): LoadType | undefined {
  const c = (item.category ?? '').toLowerCase();
  if (c === 'lighting' || item.column === 'ltg') return 'lighting';
  if (c === 'socket' || item.column === 's13' || item.column === 's15') return 'sockets';
  if (c === 'a/c' || c === 'fan' || item.column === 'sac' || item.column === 'wac') return 'hvac';
  if (c === 'motor' || c === 'pump' || item.column === 'pump') return 'motor';
  return item.category ? 'general' : undefined;
}
import { cables } from '../calc/cableTable';
import { designCurrentA, selectCable, upstreamVoltageDropPct } from '../calc/electrical';

const emptyFeeder = (boardId: string): Feeder => ({
  id: '', boardId, name: '', loadKw: 10, demandFactor: 0.8, powerFactor: 0.85,
  lengthM: 20, cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 25
});

export default function FeederForm({
  project,
  boardId,
  initial,
  preset,
  library = [],
  onSave,
  onDelete,
  onClose
}: {
  project: Project;
  boardId: string;
  initial?: Feeder;
  /** Defaults for a new feeder, e.g. { loadType: 'motor' } from the ribbon. */
  preset?: Partial<Feeder>;
  /** Equipment from Loads.xlsx, offered as 'From library'. */
  library?: LibraryLoad[];
  onSave: (f: Feeder) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Feeder>(initial ?? { ...emptyFeeder(boardId), ...preset });
  const [suggestion, setSuggestion] = useState<string>('');

  /** Fills the form from a library item (power, PF, DF, phases, load type). */
  function fromLibrary(name: string) {
    const item = library.find((l) => l.name === name);
    if (!item) return;
    setF((prev) => ({
      ...prev,
      name: prev.name || item.name,
      loadKw: item.watts / 1000,
      powerFactor: item.pf ?? prev.powerFactor,
      demandFactor: item.demandFactor ?? prev.demandFactor,
      cores: item.phases === 3 ? 4 : item.phases === 1 ? 2 : prev.cores,
      loadType: libraryLoadType(item) ?? prev.loadType,
      remarks: [item.manufacturer, item.model].filter(Boolean).join(' ') || prev.remarks
    }));
    setSuggestion(`Filled from library: ${item.name} — ${item.watts} W${item.pf ? `, PF ${item.pf}` : ''}${item.phases ? `, ${item.phases}-phase` : ''}. Check the cable and breaker with "Suggest cable size".`);
  }
  const isNew = !initial;

  function set<K extends keyof Feeder>(key: K, val: Feeder[K]) {
    setF((prev) => ({ ...prev, [key]: val }));
  }

  function suggestCable() {
    const ib = designCurrentA(f, project);
    const upstream = upstreamVoltageDropPct(project, f.boardId);
    const budget = project.vdLimitPct - upstream;
    const size = selectCable(ib, f.lengthM, project.voltageV, f.cores, f.powerFactor, project.ambientC, budget, f.breakerRatingA);
    const budgetNote = upstream > 0 ? ` (${upstream.toFixed(2)}% already used upstream, ${budget.toFixed(2)}% left)` : '';
    if (size) {
      set('cableCsaMm2', size);
      setSuggestion(`Ib ≈ ${ib.toFixed(0)} A, In = ${f.breakerRatingA} A → ${size} mm² gives Iz ≥ In and meets the ${project.vdLimitPct}% total voltage-drop limit at ${f.lengthM} m${budgetNote}.`);
    } else {
      setSuggestion(`Ib ≈ ${ib.toFixed(0)} A, In = ${f.breakerRatingA} A — no cable up to 300 mm² gives Iz ≥ In within the voltage-drop budget${budgetNote}. Consider a shorter run, a smaller breaker, or a higher limit.`);
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
        {library.length > 0 && !f.feedsBoardId && (
          <label className="row">
            From library
            <select value="" onChange={(e) => fromLibrary(e.target.value)} style={{ flex: 1 }}>
              <option value="">Choose equipment from Loads.xlsx…</option>
              {library.map((l) => <option key={l.name} value={l.name}>{l.name} — {l.watts} W{l.phases ? `, ${l.phases}-ph` : ''}</option>)}
            </select>
          </label>
        )}
        <div className="grid2">
          <label>Circuit ID<input value={f.id} disabled={!isNew} required onChange={(e) => set('id', e.target.value)} placeholder="e.g. DB-KITCHEN" /></label>
          <label>Name<input value={f.name} required onChange={(e) => set('name', e.target.value)} placeholder="e.g. Kitchen distribution board" /></label>
          <label>Load type
            <select value={f.loadType ?? (f.generation ? 'pv' : 'general')} onChange={(e) => set('loadType', e.target.value as LoadType)}>
              {LOAD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          {f.loadType === 'capacitor' ? (
            <label>Capacitor bank (kvar)<input inputMode="decimal" value={f.kvar ?? ''} onChange={(e) => set('kvar', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : +e.target.value)} /></label>
          ) : (
            <label>Connected load (kW)<input type="number" step="0.1" value={f.loadKw} onChange={(e) => set('loadKw', +e.target.value)} /></label>
          )}
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
              {cables().map((c) => (
                <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2} mm²</option>
              ))}
            </select>
          </label>
          {(f.loadType === 'motor' || f.loadType === 'fire-pump') && (
            <label>Motor starter
              <select value={f.starter ?? 'DOL'} onChange={(e) => set('starter', e.target.value as Feeder['starter'])}>
                {STARTERS.map((s) => <option key={s.value} value={s.value} title={s.title}>{s.label} (≈ {s.multiple} × start)</option>)}
              </select>
            </label>
          )}
          <label>Runs in parallel
            <select value={f.parallel ?? 1} onChange={(e) => set('parallel', +e.target.value > 1 ? +e.target.value : undefined)}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? 'Single cable' : `${n} cables in parallel`}</option>)}
            </select>
          </label>
          <label>Breaker rating (A)<input type="number" step="1" value={f.breakerRatingA} onChange={(e) => set('breakerRatingA', +e.target.value)} /></label>
          <label>Breaker Icu (kA)<input type="number" step="0.5" value={f.breakerIcuKa} onChange={(e) => set('breakerIcuKa', +e.target.value)} /></label>
          <label>Breaker type
            <select value={breakerTypeOf(f)} onChange={(e) => set('breakerType', e.target.value as BreakerType)}>
              {BREAKER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          {(breakerTypeOf(f) === 'MCCB' || breakerTypeOf(f) === 'ACB') && (
            <label>Instantaneous Im (× In)<input type="number" step="0.5" min="1" value={f.breakerImMultiple ?? 10} onChange={(e) => set('breakerImMultiple', +e.target.value)} /></label>
          )}
          <label>Protective conductor (mm²)
            <select value={f.cpcMm2 ?? ''} onChange={(e) => set('cpcMm2', e.target.value === '' ? undefined : +e.target.value)}>
              <option value="">Auto — {defaultCpcMm2(f.cableCsaMm2)} mm² (IEC 60364-5-54)</option>
              {cables().filter((c) => c.csaMm2 <= f.cableCsaMm2).map((c) => (
                <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2} mm²</option>
              ))}
            </select>
          </label>
        </div>
        <label className="row"><input type="checkbox" checked={!!f.generation} onChange={(e) => set('generation', e.target.checked)} /> Generation source (PV / generator)</label>
        <label className="row"><input type="checkbox" checked={f.essential ?? f.loadType === 'fire-pump'} onChange={(e) => set('essential', e.target.checked)} /> Essential load (supplied by the standby generator)</label>

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
