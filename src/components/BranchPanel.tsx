import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { applyBranchCopies, assemblyFrom, branchSummary, extractBranch, loadAssemblies, otherFloors, planBranchCopies, saveAssemblies, type Assembly, type Branch } from '../model/branchCopy';
import { floorList } from '../model/levels';
import { levelRef } from '../model/hierarchy';
import { useStable } from '../util/useStable';

/** Repeat branch / Assemblies tabs of Build hierarchy: copy a board with
 * everything below it to chosen floors, or insert a saved assembly — renamed
 * by level (SMDB-L1 → SMDB-L5), previewed, checked, created in one step. */
export default function BranchPanel({ mode, project, onCreate, onClose }: {
  mode: 'repeat' | 'assemblies';
  project: Project;
  onCreate: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const sources = project.boards.filter((b) => b.upstreamId);
  const [sourceId, setSourceId] = useState(sources.find((b) => b.kind === 'SMDB')?.id ?? sources[0]?.id ?? '');
  const [assemblies, setAssemblies] = useState<Assembly[]>(() => loadAssemblies());
  const [asmId, setAsmId] = useState(assemblies[0]?.id ?? '');
  const [saveName, setSaveName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [parentMode, setParentMode] = useState<'same' | 'choose'>('same');
  const [parentId, setParentId] = useState('');
  const [note, setNote] = useState('');

  const branch: Branch | undefined = useMemo(
    () => (mode === 'repeat' ? extractBranch(project, sourceId) : assemblies.find((a) => a.id === asmId)?.branch),
    [mode, project, sourceId, assemblies, asmId]
  );
  const sourceParent = mode === 'repeat' ? project.boards.find((b) => b.id === sourceId)?.upstreamId : undefined;
  const floors = mode === 'repeat' ? otherFloors(project, sourceId) : floorList(project.building);
  const parent = parentMode === 'same' && sourceParent ? sourceParent : parentId;
  const targets = useStable(floors.filter((f) => picked.includes(f.key)).map((floor) => ({ floor, parentId: parent })));
  const anyFloors = floors.length > 0;
  const plan = useMemo(() => (branch && parent ? planBranchCopies(project, branch, targets.length || anyFloors ? targets : [{ parentId: parent }]) : undefined),
    [project, branch, parent, targets, anyFloors]);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const boardsAdded = plan?.copies.reduce((n, c) => n + c.boards.length, 0) ?? 0;

  function create() {
    if (!plan?.ok || !branch) return;
    onCreate(applyBranchCopies(project, plan), `${mode === 'repeat' ? `Repeated ${branch.rootId}` : `Inserted ${assemblies.find((a) => a.id === asmId)?.name}`} — ${plan.copies.length} cop${plan.copies.length > 1 ? 'ies' : 'y'}, ${boardsAdded} panels (Ctrl+Z undoes it all)`);
  }
  function saveAssembly() {
    const a = assemblyFrom(project, sourceId, saveName, note || undefined);
    if (!a) return;
    const list = [...assemblies.filter((x) => x.name !== a.name), a];
    if (saveAssemblies(list)) { setAssemblies(list); setAsmId(a.id); setSaveName(''); setNote(''); }
  }
  function removeAssembly(id: string) {
    const list = assemblies.filter((x) => x.id !== id);
    if (saveAssemblies(list)) { setAssemblies(list); if (asmId === id) setAsmId(list[0]?.id ?? ''); }
  }

  return (
    <>
      <div className="bh-cols">
        <section className="card bh-in">
          {mode === 'repeat' ? (
            <>
              <h4>Branch to repeat</h4>
              <label>Board (with everything below it)
                <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setPicked([]); }}>{sources.map((b) => <option key={b.id} value={b.id}>{b.id}{b.kind ? ` · ${b.kind}` : ''}</option>)}</select>
              </label>
              {branch && <p className="m">{branchSummary(branch)}{branch.token ? ` · level ${branch.token} in the names` : ' · no level in the names — copies are numbered'}</p>}
              <h4>Save as assembly</h4>
              <input className="bi-text" placeholder={`Name, e.g. Typical floor ${sourceId.split('-')[0] || 'SMDB'}`} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <input className="bi-text" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="chip" disabled={!branch} onClick={saveAssembly} title="Kept in your library (Library.json in the database folder), for any project">Save {sourceId} as assembly</button>
            </>
          ) : (
            <>
              <h4>Assemblies <span className="m">— your library</span></h4>
              {!assemblies.length && <p className="m">None yet. In Repeat branch, pick a board and "Save as assembly".</p>}
              <div className="bh-asm">
                {assemblies.map((a) => (
                  <div key={a.id} className={`bh-row${asmId === a.id ? ' on' : ''}`} onClick={() => setAsmId(a.id)}>
                    <span style={{ flex: 1, minWidth: 0 }}><b>{a.name}</b><br /><span className="m">{branchSummary(a.branch)} · {a.savedAt}</span>{a.note && <><br /><span className="m">{a.note}</span></>}</span>
                    <button className="icon-btn" title={`Delete ${a.name} from your library`} onClick={(e) => { e.stopPropagation(); removeAssembly(a.id); }}>✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
          <h4>Fed from</h4>
          {mode === 'repeat' && sourceParent && <label className="row"><input type="radio" checked={parentMode === 'same'} onChange={() => setParentMode('same')} /> Same as the source ({sourceParent})</label>}
          <label className="row"><input type="radio" checked={parentMode === 'choose' || !sourceParent || mode !== 'repeat'} onChange={() => setParentMode('choose')} /> Board
            <select className="bi-sel" value={parentId} onChange={(e) => { setParentId(e.target.value); setParentMode('choose'); }}><option value="">—</option>{project.boards.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select>
          </label>
        </section>

        <section className="card bh-mid">
          <h4>Floors</h4>
          {!floors.length ? <p className="m">No other floors in Building information{mode === 'assemblies' ? ' — the assembly is inserted once, on the board chosen' : ''}.</p> : (
            <>
              <div className="row" style={{ gap: 6 }}><button className="chip" onClick={() => setPicked(floors.map((f) => f.key))}>All</button><button className="chip" onClick={() => setPicked([])}>None</button></div>
              <div className="bh-floors">{floors.map((f) => <label key={f.key} className="row"><input type="checkbox" checked={picked.includes(f.key)} onChange={() => toggle(f.key)} /> {levelRef(f.tag)} <span className="m">{f.name}</span></label>)}</div>
            </>
          )}
          <h4>Preview</h4>
          <div className="bh-list">
            {plan?.copies.map((c, i) => (
              <div key={i} className="bh-floor"><b>{c.floor ? levelRef(c.floor.tag) : 'Copy'}</b> <span className="m">from {c.parentId}{c.numbered ? ` · numbered -${c.numbered}` : ''}</span><div className="m">{c.boards.map((b) => b.id).join(', ')} · {c.feeders.length} feeders and circuits</div></div>
            ))}
            {!plan && <p className="m">Choose {branch ? 'the board it is fed from' : mode === 'repeat' ? 'a board' : 'an assembly'}.</p>}
          </div>
        </section>

        <section className="card bh-side">
          <h4>Checks</h4>
          <ul className="bh-checks">{plan?.checks.map((c) => <li key={c.text} className={c.level}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} {c.text}</li>)}</ul>
          <p className="m">Loads, circuits, cable sizes and breakers are copied as they are. Each copy gets its floor; incomer lengths come from the riser and are marked to check.</p>
        </section>
      </div>
      <div className="modal-actions">
        <span className="m">{plan ? `${plan.copies.length} cop${plan.copies.length === 1 ? 'y' : 'ies'} · ${boardsAdded} panels · one undoable step` : ''}</span>
        <span className="sp" />
        <button className="chip" onClick={onClose}>Cancel</button>
        <button className="chip primary" disabled={!plan?.ok} onClick={create}>{mode === 'repeat' ? 'Repeat branch' : 'Insert assembly'}</button>
      </div>
    </>
  );
}
