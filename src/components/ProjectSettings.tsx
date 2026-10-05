import { useState } from 'react';
import { builtUpAreaOf } from '../calc/building';
import { POINT_TEMPLATES, pointTemplateOf, STUDY_DEFAULTS, type Project, type ProjectInfo, type StudySettings } from '../types';

type SettingsTab = 'system' | 'targets' | 'forms' | 'schedule';
const SETTINGS_TABS: [SettingsTab, string][] = [['system', 'System & limits'], ['targets', 'Sizing targets'], ['forms', 'Submission forms'], ['schedule', 'Load schedule']];
const WIRES = [1.5, 2.5, 4, 6, 10];
const ELCB_MA = [10, 30, 100, 300];

/** Project-wide design basis: system voltage, frequency, ambient, voltage
 * drop limit, and the sizing targets used by the studies. */
export default function ProjectSettings({ project, onSave, onClose }: { project: Project; onSave: (p: Project) => void; onClose: () => void }) {
  const [p, setP] = useState<Project>(project);
  const [tab, setTab] = useState<SettingsTab>('system');
  const study: Required<StudySettings> = { ...STUDY_DEFAULTS, ...p.studySettings };

  const set = <K extends keyof Project>(k: K, v: Project[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const setStudy = (k: keyof StudySettings, v: number) => setP((prev) => ({ ...prev, studySettings: { ...prev.studySettings, [k]: v } }));
  const setInfo = <K extends keyof ProjectInfo>(k: K, v: ProjectInfo[K]) =>
    setP((prev) => ({ ...prev, info: { ...prev.info, [k]: v === '' ? undefined : v } }));
  const info = p.info ?? {};
  const num = (v: string, fallback: number) => (v === '' || Number.isNaN(+v) ? fallback : +v);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!p.name.trim()) return;
    onSave(p);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Project settings and design basis</h3>
        <label className="settings-name">Project name<input value={p.name} required onChange={(e) => set('name', e.target.value)} /></label>
        {p.origin && <p className="m">{p.origin.kind === 'duplicate' ? 'Duplicated' : 'Saved as a copy'} from {p.origin.copiedFromName ? <b>{p.origin.copiedFromName}</b> : 'another project'} on {new Date(p.origin.copiedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.</p>}
        <div className="tabs feeder-tabs" role="tablist">
          {SETTINGS_TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        <div className="feeder-tab-body settings-body">
        {tab === 'system' && (
          <div className="grid2">
          <label>System voltage (V, phase-phase)
            <select value={p.voltageV} onChange={(e) => set('voltageV', +e.target.value)}>
              {[380, 400, 415, 440, 480].map((v) => <option key={v} value={v}>{v} V</option>)}
            </select>
          </label>
          <label>Frequency
            <select value={p.frequencyHz} onChange={(e) => set('frequencyHz', +e.target.value)}>
              <option value={50}>50 Hz</option>
              <option value={60}>60 Hz</option>
            </select>
          </label>
          <label>Design ambient (°C)<input type="number" min="20" max="70" value={p.ambientC} onChange={(e) => set('ambientC', num(e.target.value, p.ambientC))} /></label>
          <label>Voltage drop limit, source to load (%)<input type="number" step="0.5" min="1" max="10" value={p.vdLimitPct} onChange={(e) => set('vdLimitPct', num(e.target.value, p.vdLimitPct))} /></label>
          <label>Conductor temperature for voltage drop
            <select value={p.vdTempC ?? ''} onChange={(e) => set('vdTempC', e.target.value === '' ? undefined : +e.target.value)}>
              <option value="">Standard (R20 × 1.2)</option><option value={20}>20 °C</option><option value={70}>70 °C — PVC</option><option value={90}>90 °C — XLPE</option>
              {p.vdTempC !== undefined && ![20, 70, 90].includes(p.vdTempC) && <option value={p.vdTempC}>{p.vdTempC} °C</option>}
            </select>
          </label>
          <label className="row" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={!!p.calc?.autoRun} onChange={(e) => set('calc', { ...p.calc, autoRun: e.target.checked })} />
            Auto-run calculations on every change (otherwise: Run / F5). Load schedule and form totals are always live.
          </label>
          </div>
        )}
        {tab === 'targets' && (
          <div className="grid2">
          <label>Power factor target<input type="number" step="0.01" min="0.8" max="1" value={study.pfTarget} onChange={(e) => setStudy('pfTarget', num(e.target.value, study.pfTarget))} /></label>
          <label>Future load growth (%)<input type="number" min="0" max="100" value={study.futureGrowthPct} onChange={(e) => setStudy('futureGrowthPct', num(e.target.value, study.futureGrowthPct))} /></label>
          <label>Transformer max loading (%)<input type="number" min="10" max="100" value={study.transformerMaxLoadingPct} onChange={(e) => setStudy('transformerMaxLoadingPct', num(e.target.value, study.transformerMaxLoadingPct))} /></label>
          <label>Generator max loading (%)<input type="number" min="10" max="100" value={study.generatorMaxLoadingPct} onChange={(e) => setStudy('generatorMaxLoadingPct', num(e.target.value, study.generatorMaxLoadingPct))} /></label>
          </div>
        )}
        {tab === 'forms' && (
          <div className="grid2">
          <label style={{ gridColumn: '1 / -1' }}>Load schedule point columns
            <select value={pointTemplateOf(p).id} onChange={(e) => set('pointTemplate', e.target.value)}>
              {POINT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>Owner<input value={info.owner ?? ''} onChange={(e) => setInfo('owner', e.target.value)} /></label>
          <label>Consultant<input value={info.consultant ?? ''} onChange={(e) => setInfo('consultant', e.target.value)} /></label>
          <label>Consultant / contractor (form footer)<input value={info.contractor ?? ''} onChange={(e) => setInfo('contractor', e.target.value)} /></label>
          <label>Area<input value={info.area ?? ''} placeholder="e.g. VILLA, UAE" onChange={(e) => setInfo('area', e.target.value)} /></label>
          <label>Plot no.<input value={info.plotNo ?? ''} onChange={(e) => setInfo('plotNo', e.target.value)} /></label>
          <label>Planned completion date<input value={info.plannedCompletion ?? ''} onChange={(e) => setInfo('plannedCompletion', e.target.value)} /></label>
          <label>Tel<input value={info.tel ?? ''} onChange={(e) => setInfo('tel', e.target.value)} /></label>
          <label>Fax<input value={info.fax ?? ''} onChange={(e) => setInfo('fax', e.target.value)} /></label>
          <label>Total built-up area (m²)<input inputMode="decimal" value={info.builtUpAreaM2 ?? ''} placeholder={builtUpAreaOf({ ...p, info: { ...info, builtUpAreaM2: undefined } })?.toString() ?? ''} title="Blank: from Building information" onChange={(e) => setInfo('builtUpAreaM2', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : +e.target.value)} /></label>
          <label>Demand factor for maximum demand<input inputMode="decimal" value={info.mdDemandFactor ?? ''} placeholder="0.80" onChange={(e) => setInfo('mdDemandFactor', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : +e.target.value)} /></label>
          </div>
        )}
        {tab === 'schedule' && (
          <div className="grid2">
          <label>Lighting circuits — min wire (mm²)
            <select value={study.minWireLightingMm2} onChange={(e) => setStudy('minWireLightingMm2', +e.target.value)}>
              {WIRES.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label>Lighting circuits — ELCB (mA)
            <select value={study.elcbLightingMa} onChange={(e) => setStudy('elcbLightingMa', +e.target.value)}>
              {ELCB_MA.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label>Power circuits — min wire (mm²)
            <select value={study.minWirePowerMm2} onChange={(e) => setStudy('minWirePowerMm2', +e.target.value)}>
              {WIRES.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label>Power circuits — ELCB (mA)
            <select value={study.elcbPowerMa} onChange={(e) => setStudy('elcbPowerMa', +e.target.value)}>
              {ELCB_MA.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          </div>
        )}
        </div>
        <p className="m">
          Calculations follow IEC 60364 (cable sizing, protection, earthing) and IEC 60909 (fault levels). Set the voltage
          drop limit and ambient to your authority's requirements (e.g. DEWA).
        </p>
        <div className="modal-actions">
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">Save settings</button>
        </div>
      </form>
    </div>
  );
}
