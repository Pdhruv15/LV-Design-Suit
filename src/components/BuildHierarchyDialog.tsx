import { useEffect, useMemo, useRef, useState } from 'react';
import { useStable } from '../util/useStable';
import { Building2, ChevronDown, ChevronRight, Copy, Layers, ListTree, X } from 'lucide-react';
import type { Board, Project } from '../types';
import { applyHierarchy, evenAssignment, levelRef } from '../model/hierarchy';
import { planBatchHierarchy, type BatchHierarchySpec, type PanelDraftEdit, type PanelDraftEdits, type QuantityBasis } from '../model/hierarchyBuilder';
import { floorList, levelKey } from '../model/levels';
import BranchPanel from './BranchPanel';
import { toggleIn } from '../util/sets';

const ROWS = 400;
const STEPS = ['Starting point', 'Quantities', 'Connections', 'Review & create'];
type Mode = 'floors' | 'quantity' | 'repeat' | 'assemblies';
const number = (text: string) => text.trim() === '' ? NaN : Number(text);
const quantityError = (text: string, min: number, max: number) => !Number.isInteger(number(text)) || number(text) < min || number(text) > max ? `Enter a whole number from ${min} to ${max}.` : undefined;

/** Guided, project-local draft: quantities → editable connections → review.
 * The project is changed once, only when the user creates the checked plan. */
export default function BuildHierarchyDialog({ project, onCreate, onClose, onBuilding, embedded = false }: {
  project: Project;
  /** Shown inside the Panels page (Typical floors tab): no pop-up, starts at the quantities step. */
  embedded?: boolean;
  onCreate: (next: Project, message: string) => void;
  onClose: () => void;
  onBuilding?: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const buildings = project.building?.buildings ?? [];
  const allFloors = useMemo(() => floorList(project.building), [project.building]);
  const mains = project.boards.filter((b) => !b.upstreamId);
  const [step, setStep] = useState(embedded ? 1 : 0);
  const [mode, setMode] = useState<Mode>(embedded || allFloors.length ? 'floors' : 'quantity');
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? '');
  const floors = allFloors.filter((f) => f.buildingId === buildingId);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.max(0, floors.length - 1));
  const [source, setSource] = useState<'create' | 'existing'>(mains.length ? 'existing' : 'create');
  const [createN, setCreateN] = useState('1');
  const [existing, setExisting] = useState<string[]>(mains.slice(0, 1).map((b) => b.id));
  const [smdb, setSmdb] = useState('1');
  const [db, setDb] = useState('1');
  const [smdbBasis, setSmdbBasis] = useState<QuantityBasis>(allFloors.length ? 'floor' : 'total');
  const [dbBasis, setDbBasis] = useState<QuantityBasis>(allFloors.length ? 'floor' : 'total');
  const [incomers, setIncomers] = useState(true);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<PanelDraftEdits>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<'tree' | 'floor' | 'table'>('tree');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const chosen = floors.slice(Math.min(from, to), Math.max(from, to) + 1);
  const mdbCount = source === 'create' ? number(createN) : existing.length;
  const spec = useStable<BatchHierarchySpec>({
    mode: mode === 'floors' ? 'floors' : 'quantity', buildingId, floors: chosen.map((f) => f.key),
    mdbs: source === 'create' ? { create: number(createN) } : { existing },
    smdb: { count: number(smdb), basis: smdbBasis }, db: { count: number(db), basis: dbBasis }, incomers,
    assign: Object.fromEntries(Object.entries(assign).filter(([key, index]) => chosen.some((f) => f.key === key) && index < mdbCount))
  });
  const plan = useMemo(() => planBatchHierarchy(project, spec, edits), [project, spec, edits]);
  const base = useMemo(() => planBatchHierarchy(project, spec), [project, spec]);
  const selected = plan.draft.find((d) => d.key === picked) ?? plan.draft.find((d) => d.board.kind !== 'MDB') ?? plan.draft[0];
  const children = useMemo(() => {
    const map = new Map<string, Board[]>();
    for (const b of plan.boards) if (b.upstreamId) {
      const siblings = map.get(b.upstreamId) ?? []; siblings.push(b); map.set(b.upstreamId, siblings);
    }
    return map;
  }, [plan]);
  const draftById = new Map(plan.draft.map((d) => [d.board.id, d]));
  const draftByBoard = new Map(plan.draft.map((d) => [d.board, d]));
  const previewById = new Map(plan.boards.map((b) => [b.id, b]));
  const levelOf = (b: Board) => { const f = allFloors.find((f) => b.level && f.key === levelKey(b.level)); return f ? levelRef(f.tag) : '—'; };
  const word = query.trim().toLowerCase();
  const filtered = plan.boards.filter((b) => !word || `${b.id} ${b.name} ${b.kind} ${levelOf(b)} ${b.location ?? ''}`.toLowerCase().includes(word));
  const keep = new Set(filtered.map((b) => b.id));
  if (word) for (const b of filtered) {
    let parent = b.upstreamId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) { visited.add(parent); keep.add(parent); parent = previewById.get(parent)?.upstreamId; }
  }
  const roots = plan.mdbIds.map((id) => plan.boards.find((b) => b.id === id) ?? project.boards.find((b) => b.id === id)).filter((b): b is Board => !!b);
  // Reparenting may connect a draft directly to another existing board.
  const rootIds = new Set(roots.map((b) => b.id));
  for (const b of plan.boards) if (b.upstreamId && !draftById.has(b.upstreamId) && !rootIds.has(b.upstreamId)) {
    const parent = project.boards.find((p) => p.id === b.upstreamId); if (parent) { roots.push(parent); rootIds.add(parent.id); }
  }
  const treeRows: { board: Board; depth: number }[] = [];
  const walk = (b: Board, depth: number, seen: Set<string>) => {
    if (seen.has(b.id) || (word && !keep.has(b.id))) return;
    treeRows.push({ board: b, depth });
    if (depth === 0 || open.has(b.id) || word) for (const child of children.get(b.id) ?? []) walk(child, depth + 1, new Set([...seen, b.id]));
  };
  // Invalid tags/connections must remain selectable so they can be fixed.
  // A flat draft also avoids hiding a cycle behind the tree's roots.
  if (plan.ok) roots.forEach((b) => walk(b, 0, new Set()));
  else filtered.forEach((board) => treeRows.push({ board, depth: 0 }));
  const even = evenAssignment(chosen, Number.isInteger(mdbCount) && mdbCount > 0 ? mdbCount : 0);
  const resetDraft = () => { setEdits({}); setPicked(null); setOpen(new Set()); };
  const selectMode = (next: Mode) => {
    setMode(next); setStep(0); setSmdbBasis(next === 'floors' ? 'floor' : 'total'); setDbBasis(next === 'floors' ? 'floor' : 'total');
    setTab('tree'); setAssign({}); setQuery(''); resetDraft();
  };
  const updateDraft = (edit: PanelDraftEdit) => { if (selected) setEdits((prev) => ({ ...prev, [selected.key]: { ...prev[selected.key], ...edit } })); };
  const toggle = (id: string) => setOpen((prev) => toggleIn(prev, id));
  const count = (kind: string) => plan.boards.filter((b) => b.kind === kind).length;
  const inputErrors = { mdb: source === 'create' ? quantityError(createN, 1, 20) : undefined,
    smdb: quantityError(smdb, 0, smdbBasis === 'total' ? 5000 : 50), db: quantityError(db, 0, dbBasis === 'total' ? 5000 : 50) };

  useEffect(() => {
    if (embedded) return; // a page, not a pop-up: no focus trap or Escape
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !dialog.current) return;
      const targets = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter((el) => el.offsetParent !== null);
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose, embedded]);

  const create = () => {
    if (!plan.ok || !plan.boards.length) return;
    onCreate(applyHierarchy(project, plan), `Created ${plan.boards.length} panels and ${plan.feeders.length} incomers — loads and sizing pending. One Undo removes this batch.`);
  };
  const panelRow = (b: Board, depth: number) => {
    const entry = draftByBoard.get(b);
    const expanded = depth === 0 || open.has(b.id) || !!word;
    return <div key={entry?.key ?? b.id} className={`bh-row${entry?.key === selected?.key ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 18 }}>
      {(children.get(b.id)?.length ?? 0) > 0 && depth > 0 ? <button className="bh-tw" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${b.id}`} onClick={() => toggle(b.id)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="bh-tw">{depth === 0 ? <ChevronDown size={14} /> : null}</span>}
      <button className="bh-tag" disabled={!entry} aria-pressed={entry?.key === selected?.key} onClick={() => setPicked(entry!.key)}>{b.id || '(tag required)'}</button>
      <span className="chip-lite">{b.kind ?? 'MDB'}</span><span className="m">{levelOf(b)}</span>
      {entry ? <span className="bh-pending">New</span> : <span className="m">Existing</span>}
      {children.get(b.id)?.length ? <span className="m">{children.get(b.id)!.length} below</span> : null}
    </div>;
  };
  const stats = <div className="bh-tiles" aria-live="polite">
    <div className="dash-tile"><span className="dash-label">MDB</span><span className="dash-value">{plan.mdbIds.length}</span><span className="dash-sub">{source === 'create' ? 'new' : 'existing sources'}</span></div>
    <div className="dash-tile"><span className="dash-label">SMDB</span><span className="dash-value">{count('SMDB')}</span><span className="dash-sub">new</span></div>
    <div className="dash-tile"><span className="dash-label">DB</span><span className="dash-value">{count('DB')}</span><span className="dash-sub">new</span></div>
  </div>;
  const checks = <ul className="bh-checks" aria-label="Hierarchy checks">{plan.checks.map((c, i) => <li key={`${i}-${c.text}`} className={c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'bad'}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} {c.text}</li>)}</ul>;

  const body = <>
      {!embedded && <header className="bh-heading"><div><h3 id="bh-title">Build panel hierarchy</h3><span className="m">{mode === 'repeat' ? 'Repeat a panel group' : mode === 'assemblies' ? 'Saved templates' : 'Draft the structure, check the connections, then create.'}</span></div><button className="icon-btn" aria-label="Close hierarchy builder" onClick={onClose}><X size={18} /></button></header>}
      {mode === 'repeat' || mode === 'assemblies' ? <><button className="chip bh-back" onClick={() => selectMode(allFloors.length ? 'floors' : 'quantity')}>← Starting point</button><div className="bh-stage"><BranchPanel key={mode} mode={mode} project={project} onCreate={onCreate} onClose={onClose} /></div></> : <>
        <ol className="bh-steps" aria-label="Hierarchy setup progress">{STEPS.map((label, index) => embedded && index === 0 ? null : <li key={label}><button className={step === index ? 'on' : ''} aria-current={step === index ? 'step' : undefined} disabled={index > step} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button></li>)}</ol>
        <div className="bh-stage">
          {step === 0 && <>
            <h4>How do you want to start?</h4>
            <div className="bh-starts">{([
              ['quantity', 'By quantity', 'Enter project totals or panels per parent. No building setup needed.', ListTree],
              ['floors', 'Typical floors', 'Create panels across the building levels, with explicit quantities per floor.', Building2],
              ['repeat', 'Repeat a panel group', 'Copy an existing panel with the boards and circuits below it.', Copy],
              ['assemblies', 'Saved templates', 'Insert a panel group from your saved assembly library.', Layers]
            ] as const).map(([key, title, description, Icon]) => <button key={key} className={`bh-start${mode === key ? ' on' : ''}`} aria-pressed={mode === key} onClick={() => selectMode(key)}><Icon size={22} /><span><b>{title}</b><small>{description}</small></span></button>)}</div>
            {mode === 'floors' && !floors.length && <p className="warn">No building levels yet. Choose By quantity{onBuilding && <> or <button className="linkish" onClick={onBuilding}>open Building information</button></>}.</p>}
            <p className="m">New panels start with loads, supply data and engineering sizing still to complete.</p>
          </>}
          {step === 1 && <div className="bh-setup">
            <section className="card"><h4>{mode === 'floors' ? 'Typical floors' : 'Project quantities'}</h4>
              <div className="form-kv">
                {mode === 'floors' && <>
                  <label className="bh-full">Building<select value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setFrom(0); setTo(Math.max(0, allFloors.filter((f) => f.buildingId === e.target.value).length - 1)); setAssign({}); resetDraft(); }}>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                  <label>From floor<select value={Math.min(from, floors.length - 1)} onChange={(e) => { setFrom(+e.target.value); setAssign({}); resetDraft(); }}>{floors.map((f, i) => <option key={f.key} value={i}>{levelRef(f.tag)} — {f.name}</option>)}</select></label>
                  <label>To floor<select value={Math.min(to, floors.length - 1)} onChange={(e) => { setTo(+e.target.value); setAssign({}); resetDraft(); }}>{floors.map((f, i) => <option key={f.key} value={i}>{levelRef(f.tag)} — {f.name}</option>)}</select></label>
                </>}
                <label className={source === 'existing' ? 'bh-full' : undefined}>MDB source<select value={source} onChange={(e) => { setSource(e.target.value as 'create' | 'existing'); setAssign({}); resetDraft(); }}><option value="existing" disabled={!mains.length}>Existing main boards</option><option value="create">Create new MDBs</option></select></label>
                {source === 'create' ? <label>New MDBs · total<input inputMode="numeric" value={createN} aria-invalid={!!inputErrors.mdb} aria-describedby={inputErrors.mdb ? 'bh-mdb-error' : undefined} onChange={(e) => { setCreateN(e.target.value); setAssign({}); resetDraft(); }} />{inputErrors.mdb && <small className="bh-error" id="bh-mdb-error">{inputErrors.mdb}</small>}</label>
                  : <fieldset className="bh-mains"><legend>Main boards to use</legend>{mains.map((b) => <label key={b.id} className="row"><input type="checkbox" checked={existing.includes(b.id)} onChange={(e) => { setExisting(e.target.checked ? [...existing, b.id] : existing.filter((id) => id !== b.id)); setAssign({}); resetDraft(); }} />{b.id}</label>)}</fieldset>}
                <label>SMDB quantity<input inputMode="numeric" value={smdb} aria-invalid={!!inputErrors.smdb} aria-describedby={inputErrors.smdb ? 'bh-smdb-error' : undefined} onChange={(e) => { setSmdb(e.target.value); resetDraft(); }} />{inputErrors.smdb && <small className="bh-error" id="bh-smdb-error">{inputErrors.smdb}</small>}</label>
                <label>SMDB quantity basis<select value={smdbBasis} onChange={(e) => { setSmdbBasis(e.target.value as QuantityBasis); resetDraft(); }}><option value="total">Total across this batch</option>{mode === 'floors' ? <option value="floor">Per floor</option> : <option value="parent">Per MDB</option>}</select></label>
                <label>DB quantity<input inputMode="numeric" value={db} aria-invalid={!!inputErrors.db} aria-describedby={inputErrors.db ? 'bh-db-error' : undefined} onChange={(e) => { setDb(e.target.value); resetDraft(); }} />{inputErrors.db && <small className="bh-error" id="bh-db-error">{inputErrors.db}</small>}</label>
                <label>DB quantity basis<select value={dbBasis} onChange={(e) => { setDbBasis(e.target.value as QuantityBasis); resetDraft(); }}><option value="total">Total across this batch</option>{mode === 'floors' && <option value="floor">Per floor</option>}<option value="parent">Per SMDB</option></select></label>
              </div>
              <label className="row"><input type="checkbox" checked={incomers} onChange={(e) => setIncomers(e.target.checked)} />Create incomer connections (sizing pending)</label>
              {Object.keys(edits).length > 0 && <p className="m">Changing these quantities or options resets the individual panel edits in your preview.</p>}
            </section>
            <section className="card"><h4>Resulting quantities</h4>{stats}<p className="bh-total">{plan.boards.length} new panels · {plan.feeders.length} incomers{mode === 'floors' ? ` · ${chosen.length} selected floors` : ''}</p>
              <p className="m">{smdbBasis === 'floor' ? `${chosen.length} floors × ${smdb || '—'} SMDBs per floor` : smdbBasis === 'parent' ? `${Number.isFinite(mdbCount) ? mdbCount : '—'} MDBs × ${smdb || '—'} SMDBs per MDB` : `${smdb || '—'} SMDBs in total`}<br />{dbBasis === 'floor' ? `${chosen.length} floors × ${db || '—'} DBs per floor` : dbBasis === 'parent' ? `${count('SMDB')} SMDBs × ${db || '—'} DBs per SMDB` : `${db || '—'} DBs in total`}</p>
              <p className="m">Totals are distributed evenly over available parents. Review and change individual connections in the next step.</p>{checks}
            </section>
          </div>}
          {step >= 2 && <>
            <div className="bh-review-summary">{stats}<p className="bh-total">{plan.boards.length} new panels · {plan.feeders.length} incomers{mode === 'floors' ? ` · ${chosen.length} selected floors` : ''}</p></div>
            <div className="bh-preview-cols">
              <section className="card bh-mid"><h4>{step === 3 ? 'Final preview' : 'Connection preview'}</h4>
                <div className="bh-preview-tools"><div className="seg">{([['tree', 'Electrical tree'], ['floor', 'By floor'], ['table', 'Panel table']] as const).filter(([key]) => key !== 'floor' || mode === 'floors').map(([key, label]) => <button key={key} className={tab === key ? 'on' : ''} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div><input type="search" aria-label="Search preview panels" placeholder="Find a panel, type or floor…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
                {tab === 'tree' && <div className="row"><button className="chip" onClick={() => setOpen(new Set(plan.boards.map((b) => b.id)))}>Expand all</button><button className="chip" onClick={() => setOpen(new Set())}>Collapse branches</button></div>}
                <div className="bh-list" aria-label="Hierarchy preview">
                  {tab === 'tree' && treeRows.slice(0, ROWS).map(({ board, depth }) => panelRow(board, depth))}
                  {tab === 'floor' && <>{allFloors.map((floor) => {
                    const here = filtered.filter((b) => b.level && levelKey(b.level) === floor.key);
                    return here.length ? <div className="bh-floor" key={floor.key}><h4>{levelRef(floor.tag)} · {floor.name} <span className="m">{here.length} panels</span></h4>{here.slice(0, 50).map((b) => panelRow(b, 0))}{here.length > 50 && <p className="m">Search to show the remaining panels on this floor.</p>}</div> : null;
                  })}{filtered.some((b) => !b.level) && <div className="bh-floor"><h4>No floor assigned</h4>{filtered.filter((b) => !b.level).slice(0, 50).map((b) => panelRow(b, 0))}</div>}</>}
                  {tab === 'table' && <table className="bi-table compact"><thead><tr><th>Panel tag</th><th>Type</th><th>Floor</th><th>Fed from</th></tr></thead><tbody>{filtered.slice(0, ROWS).map((b) => <tr key={draftByBoard.get(b)?.key} className={draftByBoard.get(b)?.key === selected?.key ? 'on' : ''}><td><button className="bh-tag" onClick={() => setPicked(draftByBoard.get(b)!.key)}>{b.id || '(tag required)'}</button></td><td>{b.kind}</td><td>{levelOf(b)}</td><td>{b.upstreamId ?? 'Supply to assign'}</td></tr>)}</tbody></table>}
                  {!filtered.length && <p className="m">No panels match this search.</p>}
                </div>
                {(tab === 'tree' ? treeRows.length : filtered.length) > ROWS && <p className="m">Showing the first {ROWS} rows. Search to narrow the preview.</p>}
                {mode === 'floors' && <details className="bh-assign"><summary>Floor → MDB assignment</summary><p className="m">Automatic split by floor; change individual floors below. Changing this assignment resets individual panel edits.</p><div className="bh-assignment-list">{chosen.map((f) => <label key={f.key}>{levelRef(f.tag)}<select aria-label={`MDB for ${levelRef(f.tag)}`} value={assign[f.key] ?? even[f.key] ?? 0} onChange={(e) => { setAssign({ ...assign, [f.key]: +e.target.value }); resetDraft(); }}>{base.mdbIds.map((id, i) => <option key={id} value={i}>{id}</option>)}</select></label>)}</div></details>}
              </section>
              <section className="card bh-side"><h4>Selected panel</h4>{selected ? <div className="form-kv">
                <label>Panel tag<input value={edits[selected.key]?.tag ?? selected.board.id} onChange={(e) => updateDraft({ tag: e.target.value })} /></label>
                <span className="m">{selected.board.kind} · {children.get(selected.board.id)?.length ?? 0} downstream panels</span>
                {selected.parentKey ? <label>Fed from<select value={selected.parentKey} onChange={(e) => updateDraft({ parentKey: e.target.value })}>{[...project.boards.map((b) => ({ key: b.id, board: b })), ...plan.draft].filter((d) => d.key !== selected.key).map((d) => <option key={d.key} value={d.key}>{d.board.id || '(tag required)'} · {d.board.kind ?? 'board'}</option>)}</select></label> : <p className="warn">Main-board supply still to assign.</p>}
                <label>Floor<select value={selected.board.level ? levelKey(selected.board.level) : ''} onChange={(e) => updateDraft({ floorKey: e.target.value })}><option value="">No floor assigned</option>{allFloors.map((f) => <option key={f.key} value={f.key}>{f.buildingName} · {levelRef(f.tag)}</option>)}</select></label>
                <label>Location<input value={edits[selected.key]?.location ?? selected.board.location ?? ''} placeholder="Electrical room, riser…" onChange={(e) => updateDraft({ location: e.target.value })} /></label>
                {edits[selected.key] && <button className="chip" onClick={() => setEdits((prev) => { const next = { ...prev }; delete next[selected.key]; return next; })}>Reset this panel's edits</button>}
              </div> : <p className="m">Select a new panel in the preview.</p>}<h4>Checks</h4>{checks}
              </section>
            </div>
          </>}
        </div>
        <footer className="modal-actions bh-actions"><span className="m">{step === 3 ? 'Create once · open on the SLD · Undo removes this batch' : 'The project is unchanged until Create'}</span><span className="sp" />{!embedded && <button className="chip" onClick={onClose}>Cancel</button>}{step > (embedded ? 1 : 0) && <button className="chip" onClick={() => setStep(step - 1)}>Back</button>}{step < 3 ? <button className="chip primary" disabled={step === 0 ? mode === 'floors' && !floors.length : !(step === 1 ? base.ok : plan.ok)} onClick={() => setStep(step + 1)}>{step === 0 ? 'Next: quantities' : step === 1 ? 'Next: connections' : 'Next: review'}</button> : <button className="chip primary" disabled={!plan.ok || !plan.boards.length} onClick={create}>Create {plan.boards.length} panels</button>}</footer>
      </>}
    </>;
  return embedded
    ? <div ref={dialog} className="bh bh-guided bh-embedded">{body}</div>
    : <div className="modal-backdrop"><div ref={dialog} className="modal bh bh-guided" role="dialog" aria-modal="true" aria-labelledby="bh-title" tabIndex={-1}>{body}</div></div>;
}
