import { useMemo, useState } from 'react';
import type { PlanPanel, Project, SpacePlan, SpaceUse } from '../../types';
import { autoAssign, DEFAULT_USES, emptyPlan, panelLoad, PLAN_TRANSFORMER_SIZES, summarize, usesOf } from '../../calc/spacePlan';
import { applyPlanEdits, buildPlanSheet } from '../../docs/planSheet';
import { planToSld } from '../../model/planToSld';
import FormSheet from './FormSheet';
import { Page } from '../ui';

const f0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Space planning: areas (power density or specific kW) → panels →
 * transformers → RMUs, with automatic assignment and "Create SLD". */
export default function SpacePlanView({ project, onChange, onStatus, onCreated }: {
  project: Project;
  onChange: (p: Project, step?: boolean) => void;
  onStatus: (m: string) => void;
  onCreated: () => void;
}) {
  const plan = project.spacePlan ?? emptyPlan();
  const setPlan = (next: SpacePlan, step = false) => onChange({ ...project, spacePlan: next }, step);
  const s = plan.settings;
  const sum = useMemo(() => summarize(plan), [plan]);
  const sheet = useMemo(() => buildPlanSheet(plan), [plan]);
  const [showUses, setShowUses] = useState(false);
  const uses = usesOf(plan);
  const num = (v: string, fallback: number) => (v.trim() === '' || Number.isNaN(+v) ? fallback : +v);

  const setPanel = (id: string, patch: Partial<PlanPanel>) =>
    setPlan({ ...plan, panels: plan.panels.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPanel = (kind: PlanPanel['kind']) => {
    let n = plan.panels.length + 1;
    while (plan.panels.some((p) => p.id === `${kind}-${n}`)) n++;
    setPlan({ ...plan, panels: [...plan.panels, { id: `${kind}-${n}`, building: '', kind }] }, true);
  };
  const addTransformer = () => {
    let n = plan.transformers.length + 1;
    while (plan.transformers.some((t) => t.id === `TX-${n}`)) n++;
    setPlan({ ...plan, transformers: [...plan.transformers, { id: `TX-${n}`, kva: sum.transformerKva || 1500 }] }, true);
  };
  const setUse = (id: string, patch: Partial<SpaceUse>) => setPlan({ ...plan, uses: uses.map((u) => (u.id === id ? { ...u, ...patch } : u)) });

  function auto(fresh: boolean) {
    const base = fresh
      ? { ...plan, areas: plan.areas.map(({ panel: _p, ...a }) => a), panels: [], transformers: [] }
      : plan;
    const next = autoAssign(base);
    setPlan(next, true);
    const t = summarize(next);
    onStatus(`${fresh ? 'Re-planned' : 'Assigned'}: ${next.panels.length} panels on ${t.transformers.length} × transformers, ${t.rmus.length} RMU${t.rmus.length === 1 ? '' : 's'}`);
  }

  function createSld() {
    if (sum.unassignedAreas.length || sum.unfedPanels.length) {
      onStatus('Assign every area to a panel and every panel to a transformer first — use Auto-assign');
      return;
    }
    if (!window.confirm('Create the SLD from this plan? It replaces the current boards and feeders (you can undo).')) return;
    const r = planToSld(project, plan);
    onChange({ ...r.project, spacePlan: plan }, true);
    onStatus(`Created the SLD: ${r.counts.rmus} RMU${r.counts.rmus === 1 ? '' : 's'}, ${r.counts.transformers} transformers, ${r.counts.panels} panels, ${r.counts.loads} planned loads — breakers and cables sized`);
    onCreated();
  }

  const panelsOf = (tx: string) => plan.panels.filter((p) => p.kind === 'MDB' && p.transformer === tx);
  const childrenOf = (id: string) => plan.panels.filter((p) => p.kind === 'SMDB' && p.parent === id);
  const areaNames = (id: string) => plan.areas.filter((a) => a.panel === id).map((a) => [a.floor, a.name].filter(Boolean).join(' ')).join(', ');

  return (
    <Page
      title="Space planning — power density"
      intro="Enter the areas (m² × W/m², or a specific kW), then Auto-assign: areas go to an MDB per building, MDBs to transformers at the loading limit (a transformer may feed MDBs in several buildings), transformers to RMUs. Change any assignment in the tables, then Create SLD."
      actions={
        <>
          <button className="chip" onClick={() => auto(false)} title="Fill in what's missing, keeping your assignments">Auto-assign</button>
          <button className="chip" onClick={() => window.confirm('Clear all panels, transformers and assignments and plan again?') && auto(true)}>Re-plan from scratch</button>
          <button className="chip primary" onClick={createSld}>Create SLD</button>
        </>
      }
    >
      <div className="plan-settings">
        <label>Transformer size
          <select value={s.transformerKva} onChange={(e) => setPlan({ ...plan, settings: { ...s, transformerKva: +e.target.value } })}>
            <option value={0}>Automatic (fewest units)</option>
            {PLAN_TRANSFORMER_SIZES.map((k) => <option key={k} value={k}>{k} kVA</option>)}
          </select>
        </label>
        <label>Max loading %<input inputMode="decimal" key={`maxLoadingPct-${s.maxLoadingPct}`} defaultValue={s.maxLoadingPct} onBlur={(e) => setPlan({ ...plan, settings: { ...s, maxLoadingPct: num(e.target.value, s.maxLoadingPct) } })} /></label>
        <label>Transformers per RMU<input inputMode="numeric" key={`maxTransformersPerRmu-${s.maxTransformersPerRmu}`} defaultValue={s.maxTransformersPerRmu} onBlur={(e) => setPlan({ ...plan, settings: { ...s, maxTransformersPerRmu: Math.max(1, Math.round(num(e.target.value, s.maxTransformersPerRmu))) } })} /></label>
        <label>Power factor<input inputMode="decimal" key={`powerFactor-${s.powerFactor}`} defaultValue={s.powerFactor} onBlur={(e) => setPlan({ ...plan, settings: { ...s, powerFactor: Math.min(1, Math.max(0.5, num(e.target.value, s.powerFactor))) } })} /></label>
        <label>Future growth %<input inputMode="decimal" key={`growthPct-${s.growthPct}`} defaultValue={s.growthPct} onBlur={(e) => setPlan({ ...plan, settings: { ...s, growthPct: num(e.target.value, s.growthPct) } })} /></label>
        <button className="chip" onClick={() => setShowUses(!showUses)}>{showUses ? 'Hide' : 'Edit'} use types (W/m²)</button>
      </div>

      {showUses && (
        <div className="plan-uses">
          <p className="warn m">{plan.uses ? 'Your values.' : 'PLACEHOLDER values — replace with your DEWA / company W/m² and demand factors.'}</p>
          <table className="schedule">
            <thead><tr><th>Use type</th><th>W/m²</th><th>Demand factor</th></tr></thead>
            <tbody>
              {uses.map((u) => (
                <tr key={u.id}>
                  <td>{u.label}</td>
                  <td><input key={`w-${u.wPerM2}`} inputMode="decimal" defaultValue={u.wPerM2} onBlur={(e) => setUse(u.id, { wPerM2: num(e.target.value, u.wPerM2) })} /></td>
                  <td><input key={`d-${u.demandFactor}`} inputMode="decimal" defaultValue={u.demandFactor} onBlur={(e) => setUse(u.id, { demandFactor: Math.min(1, num(e.target.value, u.demandFactor)) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.uses && <button className="chip" onClick={() => setPlan({ ...plan, uses: undefined })}>Back to defaults ({DEFAULT_USES.length} types)</button>}
        </div>
      )}

      <div className="plan-cards">
        <div><span>Connected load</span><b>{f0(sum.connectedKw)} kW</b></div>
        <div><span>Maximum demand</span><b>{f0(sum.demandKw)} kW · {f0(sum.demandKva)} kVA</b></div>
        <div><span>Transformers needed</span><b>{sum.requiredTransformers} × {sum.transformerKva} kVA</b><small>at ≤ {s.maxLoadingPct}% loading</small></div>
        <div><span>RMUs needed</span><b>{sum.requiredRmus}</b><small>max {s.maxTransformersPerRmu} transformers each</small></div>
        <div><span>In the plan</span><b>{plan.transformers.length} TX · {sum.rmus.length} RMU · {plan.panels.length} panels</b>
          <small className={sum.unassignedAreas.length || sum.unfedPanels.length ? 'warn' : 'ok'}>
            {sum.unassignedAreas.length || sum.unfedPanels.length ? `${sum.unassignedAreas.length} areas / ${sum.unfedPanels.length} panels not assigned` : 'All assigned'}
          </small>
        </div>
      </div>

      <h3 className="section-title flush">1 · Areas</h3>
      <FormSheet
        model={sheet}
        height="40vh"
        onStatus={onStatus}
        onEdits={(edits) => {
          const { plan: next, rejected } = applyPlanEdits(plan, sheet, edits);
          if (next !== plan) setPlan(next);
          return { changed: next !== plan, rejected };
        }}
      />

      <div className="plan-grid">
        <section>
          <h3 className="section-title">2 · Panels <button className="chip" onClick={() => addPanel('MDB')}>+ MDB</button> <button className="chip" onClick={() => addPanel('SMDB')}>+ SMDB</button></h3>
          <table className="schedule plan-table">
            <thead><tr><th>Panel</th><th>Building</th><th>Type</th><th>Location</th><th>Fed from</th><th>MD (kVA)</th><th /></tr></thead>
            <tbody>
              {plan.panels.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.id}</b></td>
                  <td><input value={p.building} onChange={(e) => setPanel(p.id, { building: e.target.value })} /></td>
                  <td>{p.kind}</td>
                  <td><input value={p.location ?? ''} onChange={(e) => setPanel(p.id, { location: e.target.value || undefined })} /></td>
                  <td>
                    {p.kind === 'MDB' ? (
                      <select value={p.transformer ?? ''} onChange={(e) => setPanel(p.id, { transformer: e.target.value || undefined })}>
                        <option value="">— transformer —</option>
                        {plan.transformers.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                      </select>
                    ) : (
                      <select value={p.parent ?? ''} onChange={(e) => setPanel(p.id, { parent: e.target.value || undefined })}>
                        <option value="">— panel —</option>
                        {plan.panels.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{f0(panelLoad(plan, p.id).demandKva)}</td>
                  <td><button className="icon-btn" title={`Remove ${p.id}`} onClick={() => setPlan({ ...plan, panels: plan.panels.filter((x) => x.id !== p.id), areas: plan.areas.map((a) => (a.panel === p.id ? { ...a, panel: undefined } : a)) }, true)}>✕</button></td>
                </tr>
              ))}
              {plan.panels.length === 0 && <tr><td colSpan={7} className="m">No panels yet — Auto-assign creates them from the areas.</td></tr>}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="section-title">3 · Transformers &amp; RMUs <button className="chip" onClick={addTransformer}>+ Transformer</button></h3>
          <table className="schedule plan-table">
            <thead><tr><th>Transformer</th><th>Size</th><th>RMU</th><th>Panels</th><th>MD (kVA)</th><th>Loading</th><th /></tr></thead>
            <tbody>
              {sum.transformers.map((t) => (
                <tr key={t.transformer.id}>
                  <td><b>{t.transformer.id}</b></td>
                  <td>
                    <select value={t.transformer.kva} onChange={(e) => setPlan({ ...plan, transformers: plan.transformers.map((x) => (x.id === t.transformer.id ? { ...x, kva: +e.target.value } : x)) })}>
                      {[...new Set([...PLAN_TRANSFORMER_SIZES, t.transformer.kva])].map((k) => <option key={k} value={k}>{k} kVA</option>)}
                    </select>
                  </td>
                  <td><input value={t.transformer.rmu ?? ''} placeholder="RMU-1" onChange={(e) => setPlan({ ...plan, transformers: plan.transformers.map((x) => (x.id === t.transformer.id ? { ...x, rmu: e.target.value || undefined } : x)) })} /></td>
                  <td>{t.panels.map((p) => p.id).join(', ') || '—'}</td>
                  <td>{f0(t.demandKva)}</td>
                  <td className={t.status}><b>{t.loadingPct.toFixed(0)}%</b></td>
                  <td><button className="icon-btn" title={`Remove ${t.transformer.id}`} onClick={() => setPlan({ ...plan, transformers: plan.transformers.filter((x) => x.id !== t.transformer.id), panels: plan.panels.map((p) => (p.transformer === t.transformer.id ? { ...p, transformer: undefined } : p)) }, true)}>✕</button></td>
                </tr>
              ))}
              {plan.transformers.length === 0 && <tr><td colSpan={7} className="m">No transformers yet — Auto-assign sizes them.</td></tr>}
            </tbody>
          </table>
          {sum.rmus.some((r) => r.transformers.length > s.maxTransformersPerRmu) && (
            <p className="bad m">An RMU has more than {s.maxTransformersPerRmu} transformers.</p>
          )}
        </section>
      </div>

      <h3 className="section-title">Tree</h3>
      <div className="plan-tree">
        {[...new Set(plan.transformers.map((t) => t.rmu ?? '(no RMU)'))].map((rmu) => (
          <div key={rmu} className="plan-rmu">
            <b>{rmu}</b>
            {plan.transformers.filter((t) => (t.rmu ?? '(no RMU)') === rmu).map((t) => {
              const l = sum.transformers.find((x) => x.transformer.id === t.id)!;
              return (
                <div key={t.id} className="plan-tx">
                  <span className={l.status}>├─ {t.id} {t.kva} kVA ({l.loadingPct.toFixed(0)} %)</span>
                  {panelsOf(t.id).map((p) => (
                    <div key={p.id} className="plan-panel">
                      │   ├─ {p.id} · {p.building || '—'}{p.location ? ` ${p.location}` : ''} · {f0(panelLoad(plan, p.id).demandKva)} kVA
                      {areaNames(p.id) && <div className="plan-areas">│   │    └─ {areaNames(p.id)}</div>}
                      {childrenOf(p.id).map((c) => (
                        <div key={c.id} className="plan-areas">│   │    ├─ {c.id} · {f0(panelLoad(plan, c.id).demandKva)} kVA{areaNames(c.id) ? ` — ${areaNames(c.id)}` : ''}</div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        {plan.transformers.length === 0 && <p className="m">Add areas and press Auto-assign.</p>}
      </div>
    </Page>
  );
}
