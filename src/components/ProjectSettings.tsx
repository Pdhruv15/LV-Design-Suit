import { useState } from 'react';
import { STUDY_DEFAULTS, type Project, type StudySettings } from '../types';

/** Project-wide design basis: system voltage, frequency, ambient, voltage
 * drop limit, and the sizing targets used by the studies. */
export default function ProjectSettings({ project, onSave, onClose }: { project: Project; onSave: (p: Project) => void; onClose: () => void }) {
  const [p, setP] = useState<Project>(project);
  const study: Required<StudySettings> = { ...STUDY_DEFAULTS, ...p.studySettings };

  const set = <K extends keyof Project>(k: K, v: Project[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const setStudy = (k: keyof StudySettings, v: number) => setP((prev) => ({ ...prev, studySettings: { ...prev.studySettings, [k]: v } }));
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
        <div className="grid2">
          <label style={{ gridColumn: '1 / -1' }}>Project name<input value={p.name} required onChange={(e) => set('name', e.target.value)} /></label>
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
          <label>Power factor target<input type="number" step="0.01" min="0.8" max="1" value={study.pfTarget} onChange={(e) => setStudy('pfTarget', num(e.target.value, study.pfTarget))} /></label>
          <label>Future load growth (%)<input type="number" min="0" max="100" value={study.futureGrowthPct} onChange={(e) => setStudy('futureGrowthPct', num(e.target.value, study.futureGrowthPct))} /></label>
          <label>Transformer max loading (%)<input type="number" min="10" max="100" value={study.transformerMaxLoadingPct} onChange={(e) => setStudy('transformerMaxLoadingPct', num(e.target.value, study.transformerMaxLoadingPct))} /></label>
          <label>Generator max loading (%)<input type="number" min="10" max="100" value={study.generatorMaxLoadingPct} onChange={(e) => setStudy('generatorMaxLoadingPct', num(e.target.value, study.generatorMaxLoadingPct))} /></label>
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
