import { X } from 'lucide-react';
import { ask } from '../ConfirmDialog';
import { useMemo, useRef, useState } from 'react';
import type { Project } from '../../types';
import {
  REF_FIELDS, REF_KINDS, REF_STATUSES, appliedStatus, changedSinceApplied, duplicateReference, exportReferences, importReferences, loadReferences,
  newReference, projectValue, referenceChanges, referenceIssues, saveReference, saveUserReferences, type DesignReference, type RefEntry, type RefKey
} from '../../model/designReference';
import { Page } from '../ui';
import { saveText } from '../../util/files';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const show = (v: number | undefined, unit: string) => (v === undefined ? '—' : `${+v.toFixed(2)}${unit ? ` ${unit}` : ''}`);

/** Standards → Design references: DEWA, IEC, BS 7671, ADDC, EtihadWE and your
 * own, each a set of design values with clauses and notes, plus free reference
 * entries. Built-in ones are read only — duplicate to customise. Yours are
 * saved in LV Database/Library.json (synced by Drive). "Apply to this project"
 * shows what changes, then writes the values and records the reference. */
export default function DesignReferencesView({ project, onApply, onStatus }: {
  project: Project;
  onApply: (ref: DesignReference) => void;
  onStatus: (m: string) => void;
}) {
  const [refs, setRefs] = useState<DesignReference[]>(loadReferences);
  const [selId, setSelId] = useState<string>(project.designReference?.id && refs.some((r) => r.id === project.designReference!.id) ? project.designReference.id : refs[0].id);
  const [draft, setDraft] = useState<DesignReference | null>(null);
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saved = refs.find((r) => r.id === selId) ?? refs[0];
  const ref = draft && draft.id === saved.id ? draft : saved;
  const readOnly = !!saved.builtIn;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const issues = useMemo(() => (dirty ? referenceIssues(ref, refs) : []), [dirty, ref, refs]);
  const applied = appliedStatus(project, refs);
  const drift = changedSinceApplied(project);
  const changes = useMemo(() => referenceChanges(project, saved), [project, saved]);

  const persist = (list: DesignReference[]) => { setRefs(list); saveUserReferences(list); };
  const select = async (id: string) => {
    if (dirty && !(await ask('Discard your unsaved changes to this reference?'))) return;
    setDraft(null); setPreview(false); setSelId(id);
  };
  const edit = (patch: Partial<DesignReference>) => setDraft({ ...ref, ...patch });
  const setValue = (key: RefKey, patch: { value?: number | null; clause?: string; note?: string }) => {
    const cur = ref.values[key];
    const values = { ...ref.values };
    if (patch.value === null) delete values[key];
    else {
      const next = { ...cur, ...patch, value: patch.value ?? cur?.value };
      if (next.value === undefined) return; // clause or note without a value: keep only once a value is typed
      values[key] = { value: next.value, ...(next.clause && { clause: next.clause }), ...(next.note && { note: next.note }) };
    }
    edit({ values });
  };
  const setEntry = (id: string, patch: Partial<RefEntry>) => edit({ entries: ref.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

  async function add(r: DesignReference, message: string) {
    if (dirty && !(await ask('Discard your unsaved changes to this reference?'))) return;
    const list = [...refs, r];
    persist(list);
    setDraft(null); setPreview(false); setSelId(r.id);
    onStatus(message);
  }
  function save() {
    if (!draft || issues.length) return;
    const list = saveReference(refs, draft);
    persist(list);
    setDraft(null);
    onStatus(`Saved ${draft.name} (version ${list.find((r) => r.id === draft.id)?.version})`);
  }
  async function remove() {
    if (readOnly || !(await ask(`Delete the reference "${saved.name}"? Projects that used it keep their values.`))) return;
    const list = refs.filter((r) => r.id !== saved.id);
    persist(list);
    setDraft(null); setSelId(list[0].id);
    onStatus(`Deleted ${saved.name}`);
  }
  async function exportOne(list: DesignReference[], name: string) {
    const defaultName = `${name.replace(/[^\w ()-]+/g, '').trim() || 'Design references'}.json`;
    const m = await saveText(defaultName, exportReferences(list), 'Design references', 'json');
    if (m) onStatus(m);
  }
  async function importFile(file: File) {
    const { added, error } = importReferences(await file.text(), refs);
    if (error) { onStatus(error); return; }
    persist([...refs, ...added]);
    setDraft(null); setSelId(added[0].id);
    onStatus(`Imported ${added.length} reference${added.length > 1 ? 's' : ''}`);
  }
  function apply() {
    onApply(saved);
    setPreview(false);
    onStatus(changes.length ? `Applied ${saved.name}: ${changes.length} value${changes.length > 1 ? 's' : ''} changed` : `${saved.name} recorded as this project's design reference`);
  }

  const groups = REF_KINDS.map(([k, label]) => ({ label, items: refs.filter((r) => r.kind === k) })).filter((g) => g.items.length);

  return (
    <Page
      title="Design references"
      intro="Design values from an authority, a standard or your own practice, with their clauses — DEWA, IEC, BS 7671, ADDC, EtihadWE or your own. Built-in references are read only: duplicate one to customise it. Yours are saved in the LV Database folder and sync to every computer."
      actions={<>
        <button className="chip" onClick={() => add(newReference(), 'New reference — fill in the values you need; blank values are not applied')}>+ New</button>
        <button className="chip" onClick={() => fileRef.current?.click()}>Import</button>
        <button className="chip" disabled={!refs.some((r) => !r.builtIn)} onClick={() => exportOne(refs.filter((r) => !r.builtIn), 'Design references')} title="All your references in one file">Export mine</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
      </>}
    >
      <section className="card u-mb-3">
        {project.designReference ? (
          <p className="u-flush">
            This project uses <b>{project.designReference.name}</b> version {project.designReference.version}, applied {fmtDate(project.designReference.appliedAt)}.
            {drift.length > 0 && <span className="warn"> {drift.length} value{drift.length > 1 ? 's' : ''} changed in the project since: {drift.map((k) => REF_FIELDS.find((f) => f.key === k)!.label).join(', ')}.</span>}
            {applied.newer && <span className="warn"> The reference has been edited since (now version {applied.ref!.version}) — apply it again to update.</span>}
            {applied.missing && <span className="m"> The reference is no longer in your library; the project keeps its values.</span>}
          </p>
        ) : <p className="m u-flush">This project has no design reference yet. Pick one below and apply it.</p>}
      </section>

      <div className="ref-grid">
        <section className="card ref-list">
          {groups.map((g) => (
            <div key={g.label}>
              <h4>{g.label}</h4>
              <table className="compact"><tbody>
                {g.items.map((r) => (
                  <tr key={r.id} className={r.id === saved.id ? 'sel' : ''} onClick={() => select(r.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      {r.name}{r.id === project.designReference?.id && <span className="ok"> ✓</span>}
                      <div className="m">{r.builtIn ? 'Built-in' : `v${r.version} · ${r.updatedAt}`} · <span className={r.status === 'verified' ? 'ok' : 'warn'}>{r.status === 'verified' ? 'Verified' : 'To verify'}</span></div>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          ))}
        </section>

        <div>
          <section className="card u-mb-3">
            <div className="stage-head">
              <h4 className="u-flush">{ref.name || 'Unnamed reference'}</h4>
              <div className="row">
                {dirty ? <>
                  <button className="chip" onClick={() => setDraft(null)}>Discard</button>
                  <button className="chip primary" disabled={issues.length > 0} onClick={save}>Save</button>
                </> : <>
                  <button className="chip" onClick={() => add(duplicateReference(saved), `Copy of ${saved.name} — edit it and save`)}>Duplicate</button>
                  <button className="chip" onClick={() => exportOne([saved], saved.name)}>Export</button>
                  {!readOnly && <button className="chip" onClick={remove}>Delete</button>}
                  <button className="chip primary" onClick={() => setPreview(true)}>Apply to this project…</button>
                </>}
              </div>
            </div>
            {readOnly && <p className="m">Built-in — read only. Duplicate it to change values or add your own entries.</p>}
            {issues.length > 0 && <ul className="warn">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}

            {preview && !dirty && (
              <div className="card" style={{ margin: '8px 0' }}>
                <h4 style={{ margin: '0 0 6px' }}>Apply {saved.name} to {project.name}</h4>
                {changes.length ? (
                  <table className="compact"><thead><tr><th>Setting</th><th className="num">Now</th><th className="num">After</th></tr></thead><tbody>
                    {changes.map((c) => <tr key={c.key}><td>{c.label}</td><td className="num">{show(c.from, c.unit)}</td><td className="num"><b>{show(c.to, c.unit)}</b></td></tr>)}
                  </tbody></table>
                ) : <p className="m">The project already has every value of this reference. Applying records it as the project's design reference.</p>}
                {saved.status !== 'verified' && <p className="warn">This reference is marked “to verify”: check its values against the current regulations before submission.</p>}
                <p className="m">Blank values in the reference leave the project's own setting as it is. Run the studies again after applying.</p>
                <div className="row">
                  <button className="chip" onClick={() => setPreview(false)}>Cancel</button>
                  <button className="chip primary" onClick={apply}>{changes.length ? `Apply ${changes.length} change${changes.length > 1 ? 's' : ''}` : 'Record as the project reference'}</button>
                </div>
              </div>
            )}

            <div className="grid2">
              <label>Name<input value={ref.name} disabled={readOnly} onChange={(e) => edit({ name: e.target.value })} /></label>
              <label>Type
                <select value={ref.kind} disabled={readOnly} onChange={(e) => edit({ kind: e.target.value as DesignReference['kind'] })}>
                  {REF_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label>Region<input value={ref.region ?? ''} disabled={readOnly} placeholder="e.g. Dubai, Abu Dhabi" onChange={(e) => edit({ region: e.target.value || undefined })} /></label>
              <label>Edition / date<input value={ref.edition ?? ''} disabled={readOnly} placeholder="e.g. 2024 edition" onChange={(e) => edit({ edition: e.target.value || undefined })} /></label>
              <label>Source document or link<input value={ref.source ?? ''} disabled={readOnly} onChange={(e) => edit({ source: e.target.value || undefined })} /></label>
              <label>Status
                <select value={ref.status} disabled={readOnly} onChange={(e) => edit({ status: e.target.value as DesignReference['status'] })}>
                  {REF_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<textarea className="param-try" style={{ minHeight: 48 }} value={ref.notes ?? ''} disabled={readOnly} onChange={(e) => edit({ notes: e.target.value || undefined })} /></label>
            </div>
          </section>

          <section className="card u-mb-3">
            <h4 className="u-flush u-mb-2">Design values</h4>
            <p className="m">Applied to the project's settings. Leave a value blank if this reference does not set it.</p>
            <div className="ref-scroll">
              <table className="compact"><thead><tr><th>Setting</th><th className="num">Value</th><th>Clause</th><th>Note</th><th className="num">This project</th></tr></thead><tbody>
                {REF_FIELDS.map((f) => {
                  const v = ref.values[f.key];
                  const cur = projectValue(project, f.key);
                  return (
                    <tr key={f.key}>
                      <td>{f.label}{f.unit && <span className="m"> ({f.unit})</span>}</td>
                      <td className="num">
                        <input type="number" style={{ width: 80 }} step={'step' in f ? f.step : 1} value={v?.value ?? ''} disabled={readOnly}
                          onChange={(e) => setValue(f.key, { value: e.target.value === '' ? null : +e.target.value })} />
                      </td>
                      <td><input value={v?.clause ?? ''} disabled={readOnly || !v} style={{ width: 150 }} onChange={(e) => setValue(f.key, { clause: e.target.value })} /></td>
                      <td><input value={v?.note ?? ''} disabled={readOnly || !v} style={{ width: '100%', minWidth: 160 }} title={v?.note} onChange={(e) => setValue(f.key, { note: e.target.value })} /></td>
                      <td className={`num${v && cur !== v.value ? ' warn' : ''}`}>{show(cur, f.unit)}</td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
          </section>

          <section className="card">
            <h4 className="u-flush u-mb-2">Reference entries</h4>
            <p className="m">Your own look-up data: limits, rules, clauses, anything you check against. Not applied to the project.</p>
            <div className="ref-scroll">
              <table className="compact"><thead><tr><th>Topic</th><th>Value</th><th>Unit</th><th>Clause / reference</th><th>Note</th><th /></tr></thead><tbody>
                {ref.entries.map((e) => (
                  <tr key={e.id}>
                    <td><input value={e.topic} disabled={readOnly} style={{ width: '100%', minWidth: 180 }} onChange={(x) => setEntry(e.id, { topic: x.target.value })} /></td>
                    <td><input value={e.value} disabled={readOnly} style={{ width: 70 }} onChange={(x) => setEntry(e.id, { value: x.target.value })} /></td>
                    <td><input value={e.unit ?? ''} disabled={readOnly} style={{ width: 50 }} onChange={(x) => setEntry(e.id, { unit: x.target.value || undefined })} /></td>
                    <td><input value={e.clause ?? ''} disabled={readOnly} style={{ width: 150 }} onChange={(x) => setEntry(e.id, { clause: x.target.value || undefined })} /></td>
                    <td><input value={e.note ?? ''} disabled={readOnly} style={{ width: '100%', minWidth: 140 }} onChange={(x) => setEntry(e.id, { note: x.target.value || undefined })} /></td>
                    <td>{!readOnly && <button className="icon-btn" title="Remove" onClick={() => edit({ entries: ref.entries.filter((x) => x.id !== e.id) })} aria-label="Remove"><X size={14} aria-hidden /></button>}</td>
                  </tr>
                ))}
                {!ref.entries.length && <tr><td colSpan={6} className="m">{readOnly ? 'No entries.' : 'Add rules you look up often, e.g. “Socket-outlets per circuit — 6”.'}</td></tr>}
              </tbody></table>
            </div>
            {!readOnly && <button className="chip" style={{ marginTop: 8 }} onClick={() => edit({ entries: [...ref.entries, { id: `e-${Date.now().toString(36)}`, topic: '', value: '' }] })}>+ Entry</button>}
          </section>
        </div>
      </div>
    </Page>
  );
}
