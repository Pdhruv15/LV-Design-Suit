import { useMemo, useState } from 'react';
import { LOAD_TYPES, type LoadType, type StarterType } from '../types';
import { STARTERS } from '../calc/motor';
import { CABLE_TYPE_DEFS } from '../model/cableTypes';
import { componentValues, type CompField, type UserComponent } from '../model/components';
import { fillParams } from '../model/params';
import type { Project } from '../types';

const REQUIRED = ['kW', 'PF'];

/** Make or edit your own component: how it's wired, its inputs, formulas
 * worked out from them, and the label printed on the SLD. */
export default function ComponentEditor({ project, initial, onSave, onClose }: { project: Project; initial: UserComponent; onSave: (c: UserComponent) => void; onClose: () => void }) {
  const [c, setC] = useState<UserComponent>(initial);
  const set = <K extends keyof UserComponent>(k: K, v: UserComponent[K]) => setC((x) => ({ ...x, [k]: v }));
  const { values, errors } = useMemo(() => componentValues(c, project.voltageV), [c, project.voltageV]);
  const label = useMemo(() => {
    const extra: Record<string, string> = { Name: c.name, Component: c.name, Starter: c.starter ?? 'DOL', Brand: c.brand ?? '', Model: c.model ?? '' };
    for (const [k, v] of Object.entries(values)) extra[k] = Number.isFinite(v) ? String(+v.toFixed(2)) : '?';
    return fillParams(c.label, project, extra);
  }, [c, values, project]);
  const setField = (list: 'inputs' | 'results', i: number, patch: Partial<CompField>) => set(list, c[list].map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const names = [...c.inputs, ...c.results].map((f) => f.name);
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal comp-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (c.name.trim() && !errors.length) onSave({ ...c, name: c.name.trim() }); }}>
        <h3>Component</h3>
        <div className="grid2">
          <label>Name<input value={c.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label>Symbol / load type
            <select value={c.loadType} onChange={(e) => set('loadType', e.target.value as LoadType)}>
              {LOAD_TYPES.filter((t) => t.value !== 'capacitor').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>Supply
            <select value={c.poles} onChange={(e) => set('poles', +e.target.value as 1 | 3)}>
              <option value={3}>3-phase</option><option value={1}>1-phase</option>
            </select>
          </label>
          <label>Starter
            <select value={c.starter ?? ''} onChange={(e) => set('starter', (e.target.value || undefined) as StarterType | undefined)}>
              <option value="">— (not a motor) / DOL</option>
              {STARTERS.filter((s) => s.value !== 'DOL').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>Cable type
            <select value={c.cableType ?? ''} onChange={(e) => set('cableType', e.target.value || undefined)}>
              <option value="">Default</option>
              {CABLE_TYPE_DEFS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label>Brand / model<input value={[c.brand, c.model].filter(Boolean).join(' / ')} placeholder="e.g. Carrier / 39HQ" onChange={(e) => { const [b, ...m] = e.target.value.split('/'); setC((x) => ({ ...x, brand: b.trim() || undefined, model: m.join('/').trim() || undefined })); }} /></label>
        </div>
        <label className="row"><input type="checkbox" checked={!!c.essential} onChange={(e) => set('essential', e.target.checked || undefined)} /> Essential (on the standby generator)</label>

        <h4 className="modal-sub">Inputs <span className="m">— set on each copy; kW and PF size the circuit, DF is the demand factor</span></h4>
        <table className="comp-table"><thead><tr><th>Name</th><th>Default</th><th>Unit</th><th /></tr></thead><tbody>
          {c.inputs.map((f, i) => (
            <tr key={i}>
              <td><input value={f.name} disabled={REQUIRED.includes(f.name)} onChange={(e) => setField('inputs', i, { name: clean(e.target.value) })} /></td>
              <td><input inputMode="decimal" value={f.value ?? ''} onChange={(e) => setField('inputs', i, { value: e.target.value === '' ? undefined : +e.target.value })} /></td>
              <td><input value={f.unit ?? ''} onChange={(e) => setField('inputs', i, { unit: e.target.value || undefined })} /></td>
              <td>{!REQUIRED.includes(f.name) && <button type="button" className="icon-btn" onClick={() => set('inputs', c.inputs.filter((_, k) => k !== i))}>✕</button>}</td>
            </tr>
          ))}
        </tbody></table>
        <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => set('inputs', [...c.inputs, { name: `Input${c.inputs.length + 1}`, value: 0 }])}>+ Input</button>

        <h4 className="modal-sub">Results <span className="m">— formulas: + − * / ^ ( ), sqrt, min, max, round; names: {names.join(', ')}, Voltage</span></h4>
        <table className="comp-table"><thead><tr><th>Name</th><th>Formula</th><th>Unit</th><th>Value</th><th /></tr></thead><tbody>
          {c.results.map((f, i) => (
            <tr key={i}>
              <td><input value={f.name} onChange={(e) => setField('results', i, { name: clean(e.target.value) })} /></td>
              <td><input style={{ minWidth: 240 }} value={f.formula ?? ''} onChange={(e) => setField('results', i, { formula: e.target.value })} /></td>
              <td><input value={f.unit ?? ''} onChange={(e) => setField('results', i, { unit: e.target.value || undefined })} /></td>
              <td className={Number.isFinite(values[f.name]) ? '' : 'bad'}>{Number.isFinite(values[f.name]) ? +values[f.name].toFixed(3) : '?'}</td>
              <td><button type="button" className="icon-btn" onClick={() => set('results', c.results.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody></table>
        <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => set('results', [...c.results, { name: `Result${c.results.length + 1}`, formula: 'kW / PF' }])}>+ Result</button>
        {errors.length > 0 && <p className="bad">{errors.join(' · ')}</p>}

        <label>Label on the SLD<input value={c.label} onChange={(e) => set('label', e.target.value)} /></label>
        <p className="m">Preview: <b>{label}</b> — use {'{Name}'}, any input or result, {'{Starter}'}, {'{Brand}'}, {'{Model}'} and project parameters.</p>

        <div className="modal-actions">
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary" disabled={!c.name.trim() || errors.length > 0}>Save component</button>
        </div>
      </form>
    </div>
  );
}
