import { useMemo, useState } from 'react';
import type { Board, Project } from '../types';
import { Page } from './ui';
import { applyHierarchy } from '../model/hierarchy';
import { planBatchHierarchy, type BatchHierarchySpec } from '../model/hierarchyBuilder';
import { findFloor, floorLabel, floorList } from '../model/levels';
import { kindOf, renameByLevel, renamePanels, renameProblems } from '../model/renamePanels';
import { boardAndDescendants } from '../model/edit';
import { namesOf, PANEL_ROLES, planEmergency, prefixOf, roleOf, type PanelRole } from '../model/emergency';
import BuildHierarchyDialog from './BuildHierarchyDialog';
import BranchPanel from './BranchPanel';

type Tab = 'quick' | 'list' | 'floors' | 'repeat' | 'templates';
const TABS: [Tab, string][] = [['quick', 'Quick create'], ['list', 'Panel list'], ['floors', 'Typical floors'], ['repeat', 'Repeat group'], ['templates', 'Templates']];
const ROWS = 300; // panel list rows drawn at once; search narrows it

/** Design → Panels: create panels quickly by count (levels later), then edit
 * levels, parents and locations in one list and rename by level. Typical
 * floors, repeat group and templates are the same builders as before. */
export default function PanelsPage({ project, onChange, onCreated, onStatus, onBuilding }: {
  project: Project;
  onChange: (p: Project) => void;
  /** A batch was added: highlight it in the panel tree. */
  onCreated: (next: Project, message: string, added: string[]) => void;
  onStatus: (m: string) => void;
  onBuilding: () => void;
}) {
  const [tab, setTab] = useState<Tab>('quick');
  const created = (next: Project, message: string) => {
    const before = new Set(project.boards.map((b) => b.id));
    onCreated(next, message, next.boards.filter((b) => !before.has(b.id)).map((b) => b.id));
  };
  return (
    <Page title="Panels" intro="Create panels by count first, push them to the SLD and load schedules, then add levels, locations and connections later in Panel list. Names stay incremental (MDB-01, SMDB-01, DB-001) until a panel has a level; Rename by level then applies type – level – number (SMDB-L1, DB-L3-07).">
      <div className="seg pp-tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'quick' && <QuickCreate project={project} onCreate={created} onList={() => setTab('list')} onChange={onChange} />}
      {tab === 'list' && <PanelList project={project} onChange={onChange} onStatus={onStatus} onBuilding={onBuilding} />}
      {tab === 'floors' && <BuildHierarchyDialog embedded project={project} onCreate={created} onClose={() => setTab('quick')} onBuilding={onBuilding} />}
      {(tab === 'repeat' || tab === 'templates') && <div className="bh"><BranchPanel key={tab} mode={tab === 'repeat' ? 'repeat' : 'assemblies'} project={project} onCreate={created} onClose={() => setTab('quick')} /></div>}
    </Page>
  );
}

/** Counts only: MDBs, SMDBs and DBs as totals, spread evenly, no levels needed. */
function QuickCreate({ project, onCreate, onList, onChange }: { project: Project; onCreate: (next: Project, message: string) => void; onList: () => void; onChange: (p: Project) => void }) {
  const mains = project.boards.filter((b) => !b.upstreamId);
  const [source, setSource] = useState<'create' | 'existing'>('create');
  const [mdb, setMdb] = useState('1');
  const [existing, setExisting] = useState<string[]>(mains.slice(0, 1).map((b) => b.id));
  const [smdb, setSmdb] = useState('2');
  const [db, setDb] = useState('10');
  const [incomers, setIncomers] = useState(true);
  const [done, setDone] = useState('');
  // Emergency panel: EMDB on an ATS (mains from a normal panel + standby generator), optional sub-panels.
  const [emg, setEmg] = useState(false);
  const [eCount, setECount] = useState('1');
  const [eMains, setEMains] = useState('');
  const [eKva, setEKva] = useState('');
  const [eSub, setESub] = useState('0');
  const [eDb, setEDb] = useState('0');
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const spec: BatchHierarchySpec = {
    mode: 'quantity', mdbs: source === 'create' ? { create: num(mdb) } : { existing },
    smdb: { count: num(smdb), basis: 'total' }, db: { count: num(db), basis: 'total' }, incomers, names: namesOf(project)
  };
  const normalCount = (source === 'create' ? num(mdb) || 0 : 0) + (num(smdb) || 0) + (num(db) || 0);
  const plan = useMemo(() => planBatchHierarchy(project, spec), [project, JSON.stringify(spec)]); // eslint-disable-line react-hooks/exhaustive-deps
  // The normal batch first; the emergency panel is then fed from any normal panel, including new ones.
  const afterNormal = useMemo(() => (plan.ok && plan.boards.length ? applyHierarchy(project, plan) : project), [project, plan]);
  const mainsChoices = afterNormal.boards.filter((b) => roleOf(afterNormal, b) === 'MDB' || roleOf(afterNormal, b) === 'SMDB');
  const mainsFrom = mainsChoices.some((b) => b.id === eMains) ? eMains : mainsChoices[0]?.id ?? '';
  const ePlan = useMemo(() => (emg ? planEmergency(afterNormal, { count: num(eCount), mainsFrom, generatorKva: eKva.trim() ? num(eKva) : undefined, esmdb: num(eSub), edb: num(eDb), incomers }) : undefined),
    [emg, afterNormal, eCount, mainsFrom, eKva, eSub, eDb, incomers]); // eslint-disable-line react-hooks/exhaustive-deps
  const normalOk = normalCount === 0 || plan.ok;
  const canCreate = (normalCount > 0 || emg) && normalOk && (!emg || !!ePlan?.ok) && (plan.boards.length + (ePlan?.boards.length ?? 0)) > 0;
  const total = (normalCount > 0 && plan.ok ? plan.boards.length : 0) + (ePlan?.boards.length ?? 0);
  const setPrefix = (role: PanelRole, v: string) => onChange({ ...project, panelPrefixes: { ...project.panelPrefixes, [role]: v || undefined } });
  const kids = useMemo(() => { const m = new Map<string, Board[]>(); for (const b of plan.boards) if (b.upstreamId) (m.get(b.upstreamId) ?? m.set(b.upstreamId, []).get(b.upstreamId)!).push(b); return m; }, [plan]);
  const count = (k: string) => plan.boards.filter((b) => b.kind === k).length;
  const range = (k: string) => { const ids = plan.boards.filter((b) => b.kind === k).map((b) => b.id); return ids.length ? (ids.length > 1 ? `${ids[0]} … ${ids[ids.length - 1]}` : ids[0]) : '—'; };
  const per = (parents: string[]) => { const n = parents.map((id) => kids.get(id)?.length ?? 0); return n.length ? (Math.min(...n) === Math.max(...n) ? `${n[0]}` : `${Math.min(...n)}–${Math.max(...n)}`) : '0'; };
  const smdbIds = plan.boards.filter((b) => b.kind === 'SMDB').map((b) => b.id);

  function create() {
    if (!canCreate) return;
    const next = ePlan ? { ...afterNormal, boards: [...afterNormal.boards, ...ePlan.boards], feeders: [...afterNormal.feeders, ...ePlan.feeders] } : afterNormal;
    const feeders = (normalCount > 0 ? plan.feeders.length : 0) + (ePlan?.feeders.length ?? 0);
    onCreate(next, `Created ${total} panels and ${feeders} incomers (sizing pending) — add levels in Panel list. One Undo removes this batch.`);
    setDone(`Created ${total} panels${normalCount > 0 ? `: ${range('MDB')}, ${range('SMDB')}, ${range('DB')}` : ''}${ePlan ? `; emergency ${ePlan.boards.map((b) => b.id).join(', ')}` : ''}.`);
  }

  return (
    <>
      <div className="pp-cols">
        <section className="card">
          <h4>Quantities</h4>
          <div className="form-kv">
            <label>Fed from<select value={source} onChange={(e) => setSource(e.target.value as 'create' | 'existing')}><option value="create">New MDBs</option><option value="existing" disabled={!mains.length}>Existing main boards</option></select></label>
            {source === 'create'
              ? <label>MDBs<input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={mdb} onChange={(e) => setMdb(e.target.value)} /></label>
              : <div className="bh-mains">{mains.map((b) => <label key={b.id} className="row"><input type="checkbox" checked={existing.includes(b.id)} onChange={(e) => setExisting(e.target.checked ? mains.map((m) => m.id).filter((id) => id === b.id || existing.includes(id)) : existing.filter((x) => x !== b.id))} /> {b.id}</label>)}</div>}
            <label>SMDBs (total)<input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={smdb} onChange={(e) => setSmdb(e.target.value)} /></label>
            <label>DBs (total)<input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={db} onChange={(e) => setDb(e.target.value)} /></label>
          </div>
          <label className="row"><input type="checkbox" checked={incomers} onChange={(e) => setIncomers(e.target.checked)} /> Create incomer feeders (placeholders, sizing pending)</label>
          <p className="m">Spread evenly: SMDBs over the MDBs, DBs over the SMDBs (or the MDBs when there are no SMDBs). Names are incremental until levels are set. Set a count to 0 to skip it.</p>
          <label className="row"><input type="checkbox" checked={emg} onChange={(e) => setEmg(e.target.checked)} /> <b>Emergency panel (ATS)</b></label>
          {emg && <>
            <p className="m">DEWA practice: one dedicated emergency panel with a dual supply through an ATS — mains from a normal panel, standby from the generator. Everything on and below it counts as essential load.</p>
            <div className="form-kv">
              <label>{prefixOf(project, 'EMDB')}s<input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={eCount} onChange={(e) => setECount(e.target.value)} /></label>
              <label>ATS mains from<select value={mainsFrom} onChange={(e) => setEMains(e.target.value)}>{mainsChoices.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select></label>
              <label>Standby generator<span className="pfcc-in"><input className="bi-num" style={{ width: 70 }} inputMode="decimal" value={eKva} placeholder="kVA" onChange={(e) => setEKva(e.target.value)} /><span className="m">kVA (blank: later)</span></span></label>
              <label>{prefixOf(project, 'ESMDB')}s (total)<input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={eSub} onChange={(e) => setESub(e.target.value)} /></label>
              <label>{prefixOf(project, 'EDB')}s (total)<input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={eDb} onChange={(e) => setEDb(e.target.value)} /></label>
            </div>
          </>}
          <details className="pp-names">
            <summary>Naming table</summary>
            <p className="m">Prefix for each panel role — used for new panels and by Rename by level. Blank = the role name.</p>
            <table className="bi-table compact"><tbody>{PANEL_ROLES.map((r) => (
              <tr key={r.role}><td>{r.label}</td><td><input className="bi-text" style={{ width: 90 }} value={project.panelPrefixes?.[r.role] ?? ''} placeholder={r.role} onChange={(e) => setPrefix(r.role, e.target.value.replace(/\s+/g, '').toUpperCase())} /></td></tr>
            ))}</tbody></table>
          </details>
        </section>

        <section className="card">
          <h4>Preview</h4>
          <div className="bh-tiles">
            <div className="dash-tile"><span className="dash-label">MDB</span><span className="dash-value">{plan.mdbIds.length}</span><span className="dash-sub">{source === 'create' ? range('MDB') : 'existing'}</span></div>
            <div className="dash-tile"><span className="dash-label">SMDB</span><span className="dash-value">{count('SMDB')}</span><span className="dash-sub">{range('SMDB')}</span></div>
            <div className="dash-tile"><span className="dash-label">DB</span><span className="dash-value">{count('DB')}</span><span className="dash-sub">{range('DB')}</span></div>
          </div>
          {plan.ok && <p className="m">{count('SMDB') ? `${per(plan.mdbIds)} SMDB per MDB · ${per(smdbIds)} DB per SMDB` : `${per(plan.mdbIds)} DB per MDB`} · {plan.feeders.length} incomers</p>}
          <div className="bh-list pp-tree">
            {plan.mdbIds.slice(0, 50).map((m) => (
              <div key={m}>
                <div className="bh-row"><b>{m}</b> <span className="chip-lite">MDB</span></div>
                {(kids.get(m) ?? []).slice(0, 60).map((s) => (
                  <div key={s.id} className="bh-row" style={{ paddingLeft: 26 }}><b>{s.id}</b> <span className="chip-lite">{s.kind}</span>{kids.get(s.id)?.length ? <span className="m"> → {kids.get(s.id)!.length} DB: {kids.get(s.id)![0].id}{kids.get(s.id)!.length > 1 ? ` … ${kids.get(s.id)![kids.get(s.id)!.length - 1].id}` : ''}</span> : null}</div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h4>Checks</h4>
          <ul className="bh-checks">{[...(normalCount > 0 ? plan.checks : []), ...(ePlan?.checks ?? [])].map((c, i) => <li key={`${i}-${c.text}`} className={c.level}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} {c.text}</li>)}</ul>
          {ePlan?.ok && <><h4>Emergency</h4><p className="m">{ePlan.boards.map((b) => `${b.id}${b.upstreamId ? ` ← ${b.upstreamId}` : ''}`).join(' · ')}</p></>}
          {done && <p className="ok">{done} <button className="chip" onClick={onList}>Add levels in Panel list</button></p>}
        </section>
      </div>
      <div className="modal-actions pp-foot">
        <span className="m">Appears in the panel tree, SLD and load schedules at once · one Undo removes the batch</span>
        <span className="sp" />
        <button className="chip primary" disabled={!canCreate} onClick={create}>Create {total} panels</button>
      </div>
    </>
  );
}

/** Every panel in one table: tick several, set their level / fed from / location, then rename by level. */
function PanelList({ project, onChange, onStatus, onBuilding }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void; onBuilding: () => void }) {
  const floors = floorList(project.building);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState('');
  const [parent, setParent] = useState('');
  const [location, setLocation] = useState('');
  const [renames, setRenames] = useState<{ from: string; to: string; level: string; on: boolean }[] | null>(null);
  const word = q.trim().toLowerCase();
  const levelText = (b: Board) => { const f = findFloor(project.building, b.level); return f ? floorLabel(project.building, f) : ''; };
  const rows = project.boards.filter((b) => !word || [b.id, kindOf(b), b.upstreamId ?? '', levelText(b), b.location ?? ''].some((t) => t.toLowerCase().includes(word)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const picked = project.boards.filter((b) => sel.has(b.id));
  const noLevel = project.boards.filter((b) => !findFloor(project.building, b.level)).length;
  // A panel can't be fed from itself or from anything below it.
  const badParents = useMemo(() => { const s = new Set<string>(); for (const b of picked) for (const id of boardAndDescendants(project, b.id)) s.add(id); return s; }, [project, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (fn: (b: Board) => Board, what: string) => {
    onChange({ ...project, boards: project.boards.map((b) => (sel.has(b.id) ? fn(b) : b)) });
    onStatus(`${what} for ${sel.size} panel${sel.size === 1 ? '' : 's'}`);
  };
  function setFedFrom() {
    if (!parent || badParents.has(parent)) return;
    // Move each picked panel and its incomer feeder to the new parent; lengths need checking.
    const ids = new Set(picked.map((b) => b.id));
    onChange({
      ...project,
      boards: project.boards.map((b) => (ids.has(b.id) ? { ...b, upstreamId: parent } : b)),
      feeders: project.feeders.map((f) => (f.feedsBoardId && ids.has(f.feedsBoardId) ? { ...f, boardId: parent, lengthToCheck: true } : f))
    });
    onStatus(`${ids.size} panel(s) now fed from ${parent} — incomer lengths marked to check`);
  }
  function applyRenames() {
    const pairs = (renames ?? []).filter((r) => r.on);
    const problems = renameProblems(project, pairs);
    if (problems.length) { onStatus(problems[0]); return; }
    onChange(renamePanels(project, pairs));
    onStatus(`Renamed ${pairs.length} panel(s) by level — feeders, circuits, sheets and references updated`);
    setRenames(null); setSel(new Set());
  }
  const renameIssues = renames ? renameProblems(project, renames.filter((r) => r.on)) : [];

  return (
    <>
      <div className="pp-bar">
        <input type="search" className="bi-text" placeholder="Find a panel, type, level, location…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="m">{project.boards.length} panels · {noLevel} without a level{sel.size ? ` · ${sel.size} ticked` : ''}</span>
        <span className="sp" />
        <button className="chip" disabled={!floors.length} onClick={() => setRenames(renameByLevel(project, sel.size ? sel : undefined).map((r) => ({ ...r, on: true })))} title="Type – level – number for panels that have a level (ticked panels only, when any are ticked)">Rename by level…</button>
      </div>
      {!floors.length && <p className="warn">No levels yet — add the building and its levels in <button className="linkish" onClick={onBuilding}>Building information</button>, then set them here.</p>}
      {sel.size > 0 && (
        <div className="pp-bar">
          <b>{sel.size} ticked:</b>
          <label>Level <select className="bi-sel" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">—</option><option value="none">No level</option>{floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}</select></label>
          <button className="chip" disabled={!level} onClick={() => { const f = floors.find((x) => x.key === level); patch((b) => { const { level: _x, ...rest } = b; return f ? { ...b, level: f.ref } : rest; }, f ? `Level ${floorLabel(project.building, f)} set` : 'Level cleared'); }}>Set level</button>
          <label>Fed from <select className="bi-sel" value={parent} onChange={(e) => setParent(e.target.value)}><option value="">—</option>{project.boards.filter((b) => !badParents.has(b.id)).map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select></label>
          <button className="chip" disabled={!parent} onClick={setFedFrom}>Set fed from</button>
          <label>Location <input className="bi-text" style={{ width: 160 }} value={location} placeholder="e.g. Elec. room" onChange={(e) => setLocation(e.target.value)} /></label>
          <button className="chip" onClick={() => patch((b) => { const { location: _x, ...rest } = b; return location.trim() ? { ...b, location: location.trim() } : rest; }, 'Location set')}>Set location</button>
          <button className="chip" onClick={() => setSel(new Set())}>Clear ticks</button>
        </div>
      )}
      {renames && (
        <section className="card">
          <h4>Rename by level — {renames.filter((r) => r.on).length} change(s) <span className="m">· untick any you want to keep</span></h4>
          {!renames.length ? <p className="m">Nothing to rename: set levels first (panels without a level keep their names), or the names already follow the rule.</p> : (
            <div className="bh-list">
              <table className="bi-table compact"><thead><tr><th /><th>Now</th><th>New</th><th>Level</th></tr></thead>
                <tbody>{renames.map((r, i) => <tr key={r.from}><td><input type="checkbox" checked={r.on} onChange={() => setRenames(renames.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} /></td><td>{r.from}</td><td><b>{r.to}</b></td><td>{r.level}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {renameIssues.map((x) => <p key={x} className="bad">{x}</p>)}
          <div className="row" style={{ gap: 6 }}><button className="chip primary" disabled={!renames.some((r) => r.on) || renameIssues.length > 0} onClick={applyRenames}>Rename {renames.filter((r) => r.on).length}</button><button className="chip" onClick={() => setRenames(null)}>Cancel</button></div>
        </section>
      )}
      <div className="pp-table">
        <table className="bi-table compact">
          <thead><tr><th><input type="checkbox" checked={rows.length > 0 && rows.every((b) => sel.has(b.id))} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...rows.map((b) => b.id)]) : new Set([...sel].filter((id) => !rows.some((b) => b.id === id))))} title="Tick all shown" /></th><th>Panel</th><th>Type</th><th>Fed from</th><th>Level</th><th>Location</th></tr></thead>
          <tbody>{rows.slice(0, ROWS).map((b) => (
            <tr key={b.id} className={sel.has(b.id) ? 'on' : ''} onClick={() => toggle(b.id)} style={{ cursor: 'pointer' }}>
              <td><input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} onClick={(e) => e.stopPropagation()} /></td>
              <td><b>{b.id}</b></td><td>{kindOf(b)}</td><td>{b.upstreamId ?? <span className="m">supply</span>}</td>
              <td>{levelText(b) || <span className="m">—</span>}</td><td>{b.location ?? ''}</td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length > ROWS && <p className="m">Showing {ROWS} of {rows.length} — search to narrow.</p>}
      </div>
    </>
  );
}

