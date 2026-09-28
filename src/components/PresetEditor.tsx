import { useState } from 'react';
import { BOARD_KINDS, LOAD_TYPES, METER_TYPES, RCD_MA, type BoardKind, type LoadType, type MeterType, type StarterType } from '../types';
import { STARTERS } from '../calc/motor';
import { presetParts, type FeederPreset, type PresetBreaker } from '../model/presets';
import { CABLE_TYPE_DEFS } from '../model/cableTypes';

const num = (v: string) => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);

/** Edit a feeder preset: what the way feeds (a load or a sub-board) and the
 * way itself (breaker, earth leakage, metering, isolator). */
export default function PresetEditor({ initial, onSave, onClose }: {
  initial: FeederPreset;
  onSave: (p: FeederPreset) => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<FeederPreset>(initial);
  const set = <K extends keyof FeederPreset>(k: K, v: FeederPreset[K]) => setP((x) => {
    const next = { ...x, [k]: v };
    if (v === undefined || v === '' || v === false) delete next[k];
    return next;
  });
  const text = (k: 'name' | 'loadName', ph = '') => <input value={(p[k] as string) ?? ''} placeholder={ph} onChange={(e) => set(k, e.target.value)} />;
  const n = (k: 'loadKw' | 'powerFactor' | 'demandFactor' | 'boardRatingA' | 'breakerRatingA' | 'icuKa' | 'lengthM' | 'kvar', ph = '') =>
    <input inputMode="decimal" value={p[k] ?? ''} placeholder={ph} onChange={(e) => set(k, num(e.target.value))} />;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (p.name.trim()) onSave({ ...p, name: p.name.trim() }); }}>
        <h3>Feeder preset</h3>
        <p className="m">{presetParts(p)}</p>
        <div className="grid2">
          <label style={{ gridColumn: '1 / -1' }}>Name{text('name', 'e.g. MCCB + RCD → AHU 30 kW')}</label>
          <label>Feeds
            <select value={p.kind} onChange={(e) => set('kind', e.target.value as FeederPreset['kind'])}>
              <option value="load">A load</option>
              <option value="board">A sub-board</option>
            </select>
          </label>
          {p.kind === 'board' ? (
            <>
              <label>Board type
                <select value={p.boardKind ?? 'DB'} onChange={(e) => set('boardKind', e.target.value as BoardKind)}>
                  {BOARD_KINDS.filter((k) => k.value !== 'MC').map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              <label>Board rating (A){n('boardRatingA', '63')}</label>
            </>
          ) : (
            <>
              <label>Load type
                <select value={p.loadType ?? 'general'} onChange={(e) => set('loadType', e.target.value as LoadType)}>
                  {LOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label>Load name{text('loadName', 'e.g. AHU')}</label>
              {p.loadType === 'capacitor' ? <label>Capacitor (kvar){n('kvar')}</label> : <label>Load (kW){n('loadKw', '1')}</label>}
              <label>Power factor{n('powerFactor', '0.9')}</label>
              <label>Demand factor{n('demandFactor', '1')}</label>
              <label>Supply
                <select value={p.singlePhase ? '1' : '3'} onChange={(e) => set('singlePhase', e.target.value === '1' || undefined)}>
                  <option value="3">3-phase (4-core)</option>
                  <option value="1">1-phase (2-core)</option>
                </select>
              </label>
              {(p.loadType === 'motor' || p.loadType === 'fire-pump' || p.starter) && (
                <label>Starter
                  <select value={p.starter ?? ''} onChange={(e) => set('starter', (e.target.value || undefined) as StarterType | undefined)}>
                    <option value="">Direct on line</option>
                    {STARTERS.filter((s) => s.value !== 'DOL').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
          <label>Breaker
            <select value={p.breaker ?? ''} onChange={(e) => set('breaker', (e.target.value || undefined) as PresetBreaker | undefined)}>
              <option value="">App's choice for the rating</option>
              <option value="MCB">MCB</option>
              <option value="MCCB">MCCB</option>
              <option value="ACB">ACB</option>
            </select>
          </label>
          <label>Breaker rating (A){n('breakerRatingA', 'sized for the load')}</label>
          <label>Breaking capacity (kA){n('icuKa', p.kind === 'board' ? '36' : '25')}</label>
          <label>Cable length (m){n('lengthM', '30')}</label>
          <label>Cable type
            <select value={p.cableType ?? ''} onChange={(e) => set('cableType', e.target.value || undefined)}>
              <option value="">Default (fire-rated for life safety)</option>
              {CABLE_TYPE_DEFS.filter((d) => d.value !== 'XLPE/SWA/PVC').map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label>Earth leakage (RCD)
            <select value={p.rcdMa ?? ''} onChange={(e) => set('rcdMa', num(e.target.value))}>
              <option value="">None</option>
              {RCD_MA.map((m) => <option key={m} value={m}>{m} mA</option>)}
            </select>
          </label>
          <label>kWh meter
            <select value={p.kwhMeter ?? ''} onChange={(e) => set('kwhMeter', (e.target.value || undefined) as MeterType | undefined)}>
              <option value="">None</option>
              {METER_TYPES.map((m) => <option key={m} value={m}>{m === 'CT' ? 'CT-operated' : `${m} direct`}</option>)}
            </select>
          </label>
        </div>
        {p.kind === 'load' && <label className="row"><input type="checkbox" checked={!!p.localIsolator} onChange={(e) => set('localIsolator', e.target.checked || undefined)} /> Local isolator at the equipment</label>}
        {p.kind === 'load' && <label className="row"><input type="checkbox" checked={!!p.essential} onChange={(e) => set('essential', e.target.checked || undefined)} /> Essential load (on the standby generator)</label>}
        <div className="modal-actions">
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary" disabled={!p.name.trim()}>Save preset</button>
        </div>
      </form>
    </div>
  );
}
