import { useRef, useState } from 'react';
import { POINT_TEMPLATES, STUDY_DEFAULTS, type Project, type StudySettings } from '../types';
import { defaultsFromProject, readLogo, signature, type DesignDefaults, type Preferences, type UserProfile } from '../model/profile';

type Tab = 'me' | 'defaults' | 'app';
const ELCB_MA = [10, 30, 100, 300];

/** My details (name, designation, company, logo…), what new projects start
 * with, and app preferences (autosave). Stored on this computer. */
export default function PreferencesDialog({ prefs, project, onSave, onApplyToProject, onClose }: {
  prefs: Preferences;
  project: Project;
  onSave: (p: Preferences) => void;
  /** Put my details in the open project's title block and reports. */
  onApplyToProject: (u: UserProfile) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('me');
  const [p, setP] = useState<Preferences>(prefs);
  const [logoErr, setLogoErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const u = p.profile;
  const d = p.defaults;

  const setU = (k: keyof UserProfile, v: string) => setP((x) => ({ ...x, profile: { ...x.profile, [k]: v || undefined } }));
  const setD = <K extends keyof DesignDefaults>(k: K, v: DesignDefaults[K]) => setP((x) => ({ ...x, defaults: { ...x.defaults, [k]: v } }));
  const setS = (k: keyof StudySettings, v: number | undefined) => setP((x) => ({ ...x, defaults: { ...x.defaults, studySettings: { ...x.defaults.studySettings, [k]: v } } }));
  const num = (v: string) => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);
  const text = (k: keyof UserProfile, label: string, ph = '', full = false) => (
    <label style={full ? { gridColumn: '1 / -1' } : undefined}>{label}<input value={(u[k] as string) ?? ''} placeholder={ph} onChange={(e) => setU(k, e.target.value)} /></label>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal prefs" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(p); }}>
        <h3>Profile &amp; preferences</h3>
        <div className="tabs prefs-tabs">
          <button type="button" className={tab === 'me' ? 'on' : ''} onClick={() => setTab('me')}>My details</button>
          <button type="button" className={tab === 'defaults' ? 'on' : ''} onClick={() => setTab('defaults')}>New project defaults</button>
          <button type="button" className={tab === 'app' ? 'on' : ''} onClick={() => setTab('app')}>Saving</button>
        </div>

        {tab === 'me' && (
          <>
            <p className="m">Filled in on every new project: “Drawn by” and company in the SLD title block, “Prepared by” on study reports, the author of revisions and who saved the project last.</p>
            <div className="grid2">
              {text('name', 'Your name', 'Full name, as on drawings')}
              {text('designation', 'Designation', 'e.g. Senior Electrical Engineer')}
              {text('company', 'Company / consultant', '', true)}
              {text('phone', 'Phone')}
              {text('email', 'Email')}
              {text('checkedBy', 'Usually checked by')}
              {text('approvedBy', 'Usually approved by')}
            </div>
            <div className="logo-row">
              <div className="logo-box">{u.logo ? <img src={u.logo} alt="Company logo" /> : <span className="m">No logo</span>}</div>
              <div>
                <button type="button" className="chip" onClick={() => fileRef.current?.click()}>{u.logo ? 'Change logo…' : 'Add company logo…'}</button>
                {u.logo && <button type="button" className="chip" onClick={() => setU('logo', '')}>Remove</button>}
                <p className="m">PNG or JPG; shown in the SLD title block and on report covers.</p>
                {logoErr && <p className="bad">{logoErr}</p>}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { setU('logo', await readLogo(f)); setLogoErr(''); } catch (err) { setLogoErr(err instanceof Error ? err.message : String(err)); }
              }} />
            </div>
            {signature(u) && <p className="m">Reports will say: <b>Prepared by {signature(u)}</b></p>}
            <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} disabled={!u.name && !u.company}
              title="Replace the drawn / checked / approved names, company and logo of the open project with yours"
              onClick={() => onApplyToProject(u)}>
              Use my details in “{project.name}”
            </button>
          </>
        )}

        {tab === 'defaults' && (
          <>
            <p className="m">New projects start with these. Blank = the app’s default. Existing projects keep their own settings.</p>
            <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setP((x) => ({ ...x, defaults: defaultsFromProject(project) }))}>
              Copy from “{project.name}”
            </button>
            <div className="grid2">
              <label>System voltage (V)
                <select value={d.voltageV ?? ''} onChange={(e) => setD('voltageV', num(e.target.value))}>
                  <option value="">App default (415 V)</option>
                  {[380, 400, 415, 440, 480].map((v) => <option key={v} value={v}>{v} V</option>)}
                </select>
              </label>
              <label>Frequency
                <select value={d.frequencyHz ?? ''} onChange={(e) => setD('frequencyHz', num(e.target.value))}>
                  <option value="">App default (50 Hz)</option>
                  <option value={50}>50 Hz</option>
                  <option value={60}>60 Hz</option>
                </select>
              </label>
              <label>Design ambient (°C)<input inputMode="decimal" value={d.ambientC ?? ''} placeholder="45" onChange={(e) => setD('ambientC', num(e.target.value))} /></label>
              <label>Voltage drop limit (%)<input inputMode="decimal" value={d.vdLimitPct ?? ''} placeholder="4" onChange={(e) => setD('vdLimitPct', num(e.target.value))} /></label>
              <label>Power factor target<input inputMode="decimal" value={d.studySettings?.pfTarget ?? ''} placeholder={String(STUDY_DEFAULTS.pfTarget)} onChange={(e) => setS('pfTarget', num(e.target.value))} /></label>
              <label>Future load growth (%)<input inputMode="decimal" value={d.studySettings?.futureGrowthPct ?? ''} placeholder={String(STUDY_DEFAULTS.futureGrowthPct)} onChange={(e) => setS('futureGrowthPct', num(e.target.value))} /></label>
              <label>Transformer max loading (%)<input inputMode="decimal" value={d.studySettings?.transformerMaxLoadingPct ?? ''} placeholder={String(STUDY_DEFAULTS.transformerMaxLoadingPct)} onChange={(e) => setS('transformerMaxLoadingPct', num(e.target.value))} /></label>
              <label>Generator max loading (%)<input inputMode="decimal" value={d.studySettings?.generatorMaxLoadingPct ?? ''} placeholder={String(STUDY_DEFAULTS.generatorMaxLoadingPct)} onChange={(e) => setS('generatorMaxLoadingPct', num(e.target.value))} /></label>
              <label>Lighting circuits — ELCB (mA)
                <select value={d.studySettings?.elcbLightingMa ?? ''} onChange={(e) => setS('elcbLightingMa', num(e.target.value))}>
                  <option value="">App default ({STUDY_DEFAULTS.elcbLightingMa} mA)</option>
                  {ELCB_MA.map((m) => <option key={m} value={m}>{m} mA</option>)}
                </select>
              </label>
              <label>Power circuits — ELCB (mA)
                <select value={d.studySettings?.elcbPowerMa ?? ''} onChange={(e) => setS('elcbPowerMa', num(e.target.value))}>
                  <option value="">App default ({STUDY_DEFAULTS.elcbPowerMa} mA)</option>
                  {ELCB_MA.map((m) => <option key={m} value={m}>{m} mA</option>)}
                </select>
              </label>
              <label>SLD sheet size
                <select value={d.sheet ?? ''} onChange={(e) => setD('sheet', (e.target.value || undefined) as DesignDefaults['sheet'])}>
                  <option value="">App default (A3)</option>
                  {(['A4', 'A3', 'A2', 'A1'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>SLD symbols
                <select value={d.symbols ?? ''} onChange={(e) => setD('symbols', (e.target.value || undefined) as DesignDefaults['symbols'])}>
                  <option value="">App default (IEC 60617)</option>
                  <option value="iec">IEC 60617</option>
                  <option value="simple">Simple icons</option>
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Load schedule point columns
                <select value={d.pointTemplate ?? ''} onChange={(e) => setD('pointTemplate', e.target.value || undefined)}>
                  <option value="">App default</option>
                  {POINT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </div>
            <label className="row"><input type="checkbox" checked={!!d.autoRun} onChange={(e) => setD('autoRun', e.target.checked || undefined)} /> Auto-run calculations on every change</label>
          </>
        )}

        {tab === 'app' && (
          <>
            <label>Recovery copy of unsaved work
              <select value={p.app.autosaveMin} onChange={(e) => setP((x) => ({ ...x, app: { ...x.app, autosaveMin: +e.target.value } }))}>
                <option value={1}>Every minute</option>
                <option value={2}>Every 2 minutes</option>
                <option value={5}>Every 5 minutes</option>
                <option value={10}>Every 10 minutes</option>
                <option value={0}>Off</option>
              </select>
            </label>
            <p className="m">
              While a project has unsaved changes, a copy is kept on this computer. If the app or the computer stops before you save,
              the app offers to restore it the next time it starts. Your project file is only changed when you save (Ctrl+S / ⌘S).
            </p>
          </>
        )}

        <div className="modal-actions">
          <span className="sp" />
          <button type="button" className="chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="chip primary">Save</button>
        </div>
      </form>
    </div>
  );
}
