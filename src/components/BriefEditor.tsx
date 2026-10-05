import { useState } from 'react';
import type { DefaultRow } from '../model/setupPreview';
import { briefFromTemplate, SYSTEM_LABEL, type SetupTemplate } from '../model/setupTemplate';
import {
  deliverableCatalog, newBrief, PARTY_LABEL, resetToRole, ROLE_LABEL, SCOPE_ITEMS, withRole, withScope,
  type Deliverable, type Party, type ProjectBrief, type ProjectRole, type ScopeId
} from '../model/brief';

type Change = (b: ProjectBrief) => void;

export function PartiesStep({ brief, onChange }: { brief: ProjectBrief; onChange: Change }) {
  const setParty = (role: Party['role'], patch: Partial<Party>) => onChange({ ...brief, parties: brief.parties.map((p) => (p.role === role ? { ...p, ...patch } : p)) });
  const setAuthority = (authority: string) => onChange({ ...brief, authority, parties: brief.parties.map((p) => (p.role === 'authority' ? { ...p, name: authority } : p)) });
  return (
    <div className="brief-parties">
      <label>Approving authority<input value={brief.authority} placeholder="e.g. DEWA" onChange={(e) => setAuthority(e.target.value)} /></label>
      {brief.parties.filter((p) => p.role !== 'authority').map((p) => (
        <fieldset key={p.role} className="brief-party">
          <legend>{PARTY_LABEL[p.role]}{p.role === brief.role ? ' (you)' : ''}</legend>
          <div className="grid2">
            <label>Company / name<input value={p.name} onChange={(e) => setParty(p.role, { name: e.target.value })} /></label>
            <label>Contact person<input value={p.contact ?? ''} onChange={(e) => setParty(p.role, { contact: e.target.value })} /></label>
            <label>Phone<input value={p.tel ?? ''} onChange={(e) => setParty(p.role, { tel: e.target.value })} /></label>
            <label>Email<input type="email" value={p.email ?? ''} onChange={(e) => setParty(p.role, { email: e.target.value })} /></label>
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function ScopeStep({ brief, onChange }: { brief: ProjectBrief; onChange: Change }) {
  const toggle = (id: ScopeId) => onChange(withScope(brief, brief.scope.includes(id) ? brief.scope.filter((x) => x !== id) : SCOPE_ITEMS.map((s) => s.id).filter((x) => x === id || brief.scope.includes(x))));
  return (
    <div>
      <p className="m">Tick what this job covers. Parts you leave out stay available, but are not counted in the project's readiness.</p>
      <div className="brief-scope">
        {SCOPE_ITEMS.map((s) => (
          <label key={s.id} className="row"><input type="checkbox" checked={brief.scope.includes(s.id)} onChange={() => toggle(s.id)} /> <b>{s.label}</b> <span className="m">— {s.hint}</span></label>
        ))}
      </div>
      {brief.role === 'contractor' && brief.scope.includes('boq') && (
        <label style={{ marginTop: 8 }}>BOQ is for
          <select value={brief.boqType ?? 'new-installation'} onChange={(e) => onChange({ ...brief, boqType: e.target.value as ProjectBrief['boqType'] })}>
            <option value="new-installation">A new installation</option>
            <option value="fit-out">A fit-out (existing building and assets)</option>
          </select>
        </label>
      )}
    </div>
  );
}

export function DeliverablesStep({ brief, onChange }: { brief: ProjectBrief; onChange: Change }) {
  const [extra, setExtra] = useState('');
  const set = (id: string, patch: Partial<Deliverable>) => onChange({ ...brief, deliverables: brief.deliverables.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const remove = (id: string) => onChange({ ...brief, deliverables: brief.deliverables.filter((d) => d.id !== id) });
  const suggested = deliverableCatalog(brief.role, brief.scope, brief.authority).filter((s) => !brief.deliverables.some((d) => d.id === s.id));
  const add = () => { const t = extra.trim(); if (t) { onChange({ ...brief, deliverables: [...brief.deliverables, { id: `custom-${Date.now().toString(36)}`, title: t }] }); setExtra(''); } };
  return (
    <div>
      <p className="m">What is to be delivered, and by when. Tick items as they are issued.</p>
      <table className="projects-table">
        <thead><tr><th style={{ width: 28 }} /><th>Deliverable</th><th>Target date</th><th /></tr></thead>
        <tbody>
          {brief.deliverables.map((d) => (
            <tr key={d.id}>
              <td><input type="checkbox" checked={!!d.done} onChange={(e) => set(d.id, { done: e.target.checked })} title="Delivered" /></td>
              <td><input className="bi-text" value={d.title} onChange={(e) => set(d.id, { title: e.target.value })} /></td>
              <td><input type="date" value={d.targetDate ?? ''} onChange={(e) => set(d.id, { targetDate: e.target.value || undefined })} /></td>
              <td className="acts"><button type="button" className="icon-btn" title="Remove" onClick={() => remove(d.id)}>✕</button></td>
            </tr>
          ))}
          {brief.deliverables.length === 0 && <tr><td colSpan={4} className="m">No deliverables yet.</td></tr>}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <input className="bi-text" placeholder="Add your own, e.g. Site survey report" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="chip" disabled={!extra.trim()} onClick={add}>Add</button>
      </div>
      {suggested.length > 0 && (
        <p className="m" style={{ marginTop: 8 }}>Suggested: {suggested.map((s) => <button type="button" key={s.id} className="chip-lite" onClick={() => onChange({ ...brief, deliverables: [...brief.deliverables, s] })}>+ {s.title}</button>)}</p>
      )}
    </div>
  );
}

/** Role cards, for the first step and for changing the role later. */
function RoleCards({ role, onPick }: { role?: ProjectRole; onPick: (r: ProjectRole) => void }) {
  return (
    <div className="home-actions" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((r) => (
        <button key={r} type="button" className={`home-act${role === r ? ' primary' : ''}`} onClick={() => onPick(r)}><b>{ROLE_LABEL[r].title}</b><span>{ROLE_LABEL[r].blurb}</span></button>
      ))}
    </div>
  );
}

const STEPS = ['Name and role', 'Parties', 'Scope', 'Deliverables', 'Review'];

/** New project: name and role, parties, scope, deliverables, then create. Quick create makes the project from
 * the name alone, as before (no brief). */
export function NewProjectWizard({ initialName, company, taken, templates = [], defaults = [], storage, onChooseFolder, onQuick, onCreate, onCancel }: {
  initialName: string; company?: string; taken?: string[];
  /** What the project will start with, and where each value comes from. */
  defaults?: DefaultRow[];
  /** Where it will be saved (the projects folder, or this browser), with a way to change the folder on the desktop. */
  storage?: string; onChooseFolder?: () => void;
  /** Saved setup templates to start from. */
  templates?: SetupTemplate[];
  onQuick: (name: string) => void; onCreate: (name: string, brief: ProjectBrief, template?: SetupTemplate) => void; onCancel: () => void;
}) {
  const [tpl, setTpl] = useState<SetupTemplate | undefined>();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const duplicate = taken?.some((t) => t.trim().toLowerCase() === name.trim().toLowerCase());
  const pick = (r: ProjectRole) => setBrief((cur) => (cur ? withRole(cur, r, company) : newBrief(r, { company })));
  const canNext = step === 0 ? !!name.trim() && !!brief : true;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (step < STEPS.length - 1) { if (canNext) setStep(step + 1); } else if (brief && name.trim()) onCreate(name.trim(), brief, tpl); }}>
        <h3>New project <span className="m">— step {step + 1} of {STEPS.length}: {STEPS[step]}</span></h3>
        <div className="tabs feeder-tabs" role="tablist">
          {STEPS.map((s, i) => <button key={s} type="button" role="tab" aria-selected={step === i} className={step === i ? 'on' : ''} disabled={i > 0 && !brief} onClick={() => (i === 0 || brief) && setStep(i)}>{i + 1}. {s}</button>)}
        </div>
        <div className="feeder-tab-body" style={{ minHeight: 260 }}>
          {step === 0 && (
            <>
              <label>Project name<input autoFocus value={name} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} /></label>
              {duplicate && <p className="m" style={{ color: 'var(--warn, #e2a03f)' }}>A project with this name already exists. It is kept as a separate project.</p>}
              {templates.length > 0 && (
                <label style={{ marginTop: 8 }}>Start from
                  <select value={tpl?.id ?? ''} onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); setTpl(t); setBrief(t ? briefFromTemplate(t, company) : null); }}>
                    <option value="">A blank project</option>{templates.map((t) => <option key={t.id} value={t.id}>Setup template: {t.name}</option>)}
                  </select>
                </label>
              )}
              {tpl && <p className="m">The template supplies your side of the job, authority, scope, suggested deliverables{Object.values(tpl.system).some((v) => v !== undefined) ? ` and system defaults (${Object.entries(tpl.system).filter(([, v]) => v !== undefined).map(([k, v]) => `${SYSTEM_LABEL[k as keyof typeof SYSTEM_LABEL]} ${v}`).join(', ')})` : ''}. It does not copy party names, dates, drawings, equipment or revisions.</p>}
              <p className="m" style={{ marginTop: 10 }}>Which side of the job are you on?</p>
              <RoleCards role={brief?.role} onPick={pick} />
            </>
          )}
          {step === 1 && brief && <PartiesStep brief={brief} onChange={setBrief} />}
          {step === 2 && brief && <ScopeStep brief={brief} onChange={setBrief} />}
          {step === 3 && brief && <DeliverablesStep brief={brief} onChange={setBrief} />}
          {step === 4 && brief && (
            <div className="brief-review">
              <p><b>{name.trim() || 'Untitled project'}</b> — {ROLE_LABEL[brief.role].title}</p>
              <p className="m">Authority: {brief.authority || '—'}</p>
              <p>{brief.parties.filter((p) => p.role !== 'authority' && p.name.trim()).map((p) => `${PARTY_LABEL[p.role]}: ${p.name}`).join(' · ') || <span className="m">No parties entered yet — you can add them in Project settings.</span>}</p>
              <p><b>Scope:</b> {brief.scope.map((s) => SCOPE_ITEMS.find((x) => x.id === s)?.label).join(', ') || 'nothing selected'}</p>
              <p><b>Deliverables ({brief.deliverables.length}):</b> {brief.deliverables.map((d) => d.title).join(' · ') || '—'}</p>
              {defaults.length > 0 && (
                <>
                  <p style={{ marginTop: 10 }}><b>The project will start with</b> <span className="m">— change these in Profile &amp; preferences, or the company database</span></p>
                  <table className="projects-table">
                    <tbody>{defaults.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.value}</td><td className="m">{d.source}</td></tr>)}</tbody>
                  </table>
                </>
              )}
              {storage && <p style={{ marginTop: 10 }}><b>Saved in:</b> {storage} {onChooseFolder && <button type="button" className="linkish" onClick={onChooseFolder}>Change folder…</button>} <span className="m">— it is saved the first time you press Save.</span></p>}
              <p className="m">You can change all of this later from the project's Overview and Project settings.</p>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="chip" onClick={() => onQuick(name.trim() || initialName)} disabled={!name.trim()} title="Create the project now from the name alone, with your defaults — no role, scope or deliverables">Quick create</button>
          <span className="sp" />
          <button type="button" className="chip" onClick={onCancel}>Cancel</button>
          {step > 0 && <button type="button" className="chip" onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS.length - 1
            ? <button type="submit" className="chip primary" disabled={!canNext}>Next</button>
            : <button type="submit" className="chip primary" disabled={!brief || !name.trim()}>Create project</button>}
        </div>
      </form>
    </div>
  );
}

/** Change a project's role, parties, scope and deliverables from its Overview. */
export function BriefDialog({ initial, company, onSave, onSaveTemplate, onCancel }: { initial?: ProjectBrief; company?: string; onSave: (b: ProjectBrief) => void; /** Keep this setup (scope, deliverables, system defaults) as a template for new projects. */ onSaveTemplate?: (b: ProjectBrief) => void; onCancel: () => void }) {
  const [brief, setBrief] = useState<ProjectBrief>(initial ?? newBrief('consultant', { company }));
  const [tab, setTab] = useState<'scope' | 'parties' | 'deliverables'>(initial ? 'deliverables' : 'scope');
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(brief); }}>
        <h3>Scope, parties and deliverables</h3>
        <label>Your side of the job
          <select value={brief.role} onChange={(e) => setBrief(withRole(brief, e.target.value as ProjectRole, company))} title="Your scope, your own, dated and delivered deliverables and the parties are kept; suggestions you never touched change to the new role's">
            {(Object.keys(ROLE_LABEL) as ProjectRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r].title}</option>)}
          </select>
        </label>
        <p className="m">Changing the role keeps what you set. <button type="button" className="linkish" onClick={() => { if (window.confirm('Replace the scope and deliverables with this role’s suggestions? Your own deliverables, dates and ticks are lost. The parties are kept.')) setBrief(resetToRole(brief, brief.role, company)); }}>Reset scope and deliverables to the suggestions…</button></p>
        <div className="tabs feeder-tabs" role="tablist">
          {([['scope', 'Scope'], ['parties', 'Parties'], ['deliverables', 'Deliverables']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="feeder-tab-body" style={{ minHeight: 260 }}>
          {tab === 'scope' && <ScopeStep brief={brief} onChange={setBrief} />}
          {tab === 'parties' && <PartiesStep brief={brief} onChange={setBrief} />}
          {tab === 'deliverables' && <DeliverablesStep brief={brief} onChange={setBrief} />}
        </div>
        <div className="modal-actions">{onSaveTemplate && <button type="button" className="chip" onClick={() => onSaveTemplate(brief)} title="Keep this role, scope, deliverables and the system defaults as a template for new projects. Party names are not kept.">Save as setup template…</button>}<span className="sp" /><button type="button" className="chip" onClick={onCancel}>Cancel</button><button type="submit" className="chip primary">Save</button></div>
      </form>
    </div>
  );
}
