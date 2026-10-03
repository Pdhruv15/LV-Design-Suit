import { useMemo, useState } from 'react';
import type { Board, Project } from '../types';
import { evenAssignment, levelRef, planHierarchy, type HierarchySpec } from '../model/hierarchy';
import { floorList } from '../model/levels';

const ROWS = 400; // rows drawn at once in the panel table (search narrows it)

/** Build panel hierarchy: MDBs, SMDBs per floor and DBs under each SMDB from
 * the building's levels, previewed and checked, then created in one step
 * (one undo removes it all). Structure only: incomers are placeholders,
 * sizing pending. Names: type – level – number (SMDB-L1, SMDB-L2-02). */
export default function BuildHierarchyDialog({ project, onCreate, onClose }: {
  project: Project;
  onCreate: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const buildings = project.building?.buildings ?? [];
  const mains = project.boards.filter((b) => !b.upstreamId);
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? '');
  const floors = useMemo(() => floorList(project.building).filter((f) => f.buildingId === buildingId), [project.building, buildingId]);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.max(0, floors.length - 1));
  const [source, setSource] = useState<'create' | 'existing'>(mains.length ? 'existing' : 'create');
  const [createN, setCreateN] = useState(1);
  const [existing, setExisting] = useState<string[]>(mains.slice(0, 1).map((b) => b.id));
  const [smdbPerFloor, setSmdb] = useState(1);
  const [dbPerSmdb, setDb] = useState(1);
  const [incomers, setIncomers] = useState(true);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<'tree' | 'floor' | 'table'>('tree');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);

  const chosen = floors.slice(Math.min(from, to), Math.max(from, to) + 1);
  const mdbCount = source === 'create' ? createN : existing.length;
  const spec: HierarchySpec = {
    buildingId, floors: chosen.map((f) => f.key), mdbs: source === 'create' ? { create: createN } : { existing },
    assign: Object.fromEntries(Object.entries(assign).filter(([k, v]) => chosen.some((f) => f.key === k) && v < mdbCount)), smdbPerFloor, dbPerSmdb, incomers
  };
  const plan = useMemo(() => planHierarchy(project, spec), [project, JSON.stringify(spec)]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (k: string) => plan.boards.filter((b) => b.kind === k).length;
  const children = useMemo(() => { const m = new Map<string, Board[]>(); for (const b of plan.boards) if (b.upstreamId) (m.get(b.upstreamId) ?? m.set(b.upstreamId, []).get(b.upstreamId)!).push(b); return m; }, [plan]);
  const levelOf = (b: Board) => { const f = floors.find((x) => b.level && x.key === `${b.level.building}/${b.level.level}/${b.level.index ?? 0}`); return f ? levelRef(f.tag) : '—'; };
  const sel = plan.boards.find((b) => b.id === picked);
  const even = evenAssignment(chosen, mdbCount);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

  function create() {
    if (!plan.ok) return;
    const next = { ...project, boards: [...project.boards, ...plan.boards], feeders: [...project.feeders, ...plan.feeders] };
    onCreate(next, `Created ${plan.boards.length} panels and ${plan.feeders.length} incomers — sizing pending (Ctrl+Z undoes it all)`);
  }

  const row = (b: Board, depth: number) => (
    <div key={b.id} className={`bh-row${picked === b.id ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 18 }} onClick={() => setPicked(b.id)}>
      {children.get(b.id)?.length ? <button className="bh-tw" onClick={(e) => { e.stopPropagation(); toggle(b.id); }}>{open.has(b.id) ? '▾' : '▸'}</button> : <span className="bh-tw" />}
      <b>{b.id}</b> <span className="chip-lite">{b.kind}</span> <span className="m">{levelOf(b)}</span>
      {plan.feeders.some((f) => f.feedsBoardId === b.id) && <span className="bh-pending">sizing pending</span>}
      {children.get(b.id)?.length ? <span className="m"> · {children.get(b.id)!.length} below</span> : null}
    </div>
  );
  const tree = (id: string, depth: number): React.ReactNode[] => (children.get(id) ?? []).flatMap((b) => [row(b, depth), ...(open.has(b.id) ? tree(b.id, depth + 1) : [])]);
  const roots = plan.mdbIds.map((id) => plan.boards.find((b) => b.id === id) ?? ({ id, name: id, kind: 'MDB' } as Board));
  const filtered = plan.boards.filter((b) => !query || b.id.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal bh" onClick={(e) => e.stopPropagation()}>
        <h3>Build panel hierarchy</h3>
        <p className="m">MDBs, SMDBs on each floor and DBs under each SMDB, from the levels in Building information. Names: type – level – number (SMDB-L1, SMDB-L2-02). Structure only — incomers are placeholders until sized.</p>
        {!buildings.length ? (
          <p className="warn">Add the building and its levels in Building information first — the floors come from there.</p>
        ) : (
          <div className="bh-cols">
            <section className="card bh-in">
              <h4>Build</h4>
              <div className="form-kv">
                {buildings.length > 1 && <label>Building<select value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setFrom(0); setTo(999); setAssign({}); }}>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
                <label>From floor<select value={Math.min(from, floors.length - 1)} onChange={(e) => { setFrom(+e.target.value); setAssign({}); }}>{floors.map((f, i) => <option key={f.key} value={i}>{levelRef(f.tag)} — {f.name}</option>)}</select></label>
                <label>To floor<select value={Math.min(to, floors.length - 1)} onChange={(e) => { setTo(+e.target.value); setAssign({}); }}>{floors.map((f, i) => <option key={f.key} value={i}>{levelRef(f.tag)} — {f.name}</option>)}</select></label>
                <label>Fed from<select value={source} onChange={(e) => { setSource(e.target.value as 'create' | 'existing'); setAssign({}); }}><option value="existing" disabled={!mains.length}>Existing main boards</option><option value="create">New MDBs</option></select></label>
                {source === 'create'
                  ? <label>New MDBs<input className="bi-num" inputMode="numeric" value={createN} onChange={(e) => { setCreateN(num(e.target.value, 1, 20)); setAssign({}); }} /></label>
                  : <div className="bh-mains">{mains.map((b) => <label key={b.id} className="row"><input type="checkbox" checked={existing.includes(b.id)} onChange={(e) => { setExisting(e.target.checked ? mains.map((m) => m.id).filter((id) => id === b.id || existing.includes(id)) : existing.filter((x) => x !== b.id)); setAssign({}); }} /> {b.id}</label>)}</div>}
                <label>SMDBs per floor<input className="bi-num" inputMode="numeric" value={smdbPerFloor} onChange={(e) => setSmdb(num(e.target.value, 1, 50))} /></label>
                <label>DBs under each SMDB<input className="bi-num" inputMode="numeric" value={dbPerSmdb} onChange={(e) => setDb(num(e.target.value, 0, 50))} /></label>
              </div>
              <label className="row"><input type="checkbox" checked={incomers} onChange={(e) => setIncomers(e.target.checked)} /> Create incomer feeders (length from the riser)</label>
              <p className="m">e.g. {plan.boards.filter((b) => b.kind !== 'MDB').slice(0, 3).map((b) => b.id).join(', ') || '—'}</p>
            </section>

            <section className="card bh-mid">
              <div className="bh-tiles">
                <div className="dash-tile"><span className="dash-label">MDB</span><span className="dash-value">{plan.mdbIds.length}</span><span className="dash-sub">{source === 'create' ? 'new' : 'existing'}</span></div>
                <div className="dash-tile"><span className="dash-label">SMDB</span><span className="dash-value">{count('SMDB')}</span></div>
                <div className="dash-tile"><span className="dash-label">DB</span><span className="dash-value">{count('DB')}</span></div>
              </div>
              <p className="m">{plan.boards.length} new panels across {chosen.length} level{chosen.length === 1 ? '' : 's'}</p>
              <div className="row" style={{ gap: 8 }}>
                <div className="seg">{([['tree', 'Electrical tree'], ['floor', 'By floor'], ['table', 'Panel table']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
                {tab === 'table' && <input className="bi-text" placeholder="Search panels…" value={query} onChange={(e) => setQuery(e.target.value)} />}
              </div>
              <div className="bh-list">
                {tab === 'tree' && roots.flatMap((b) => [row(b, 0), ...(open.has(b.id) ? tree(b.id, 1) : [])])}
                {tab === 'floor' && plan.assignment.map(({ floor, mdbId }) => {
                  const here = plan.boards.filter((b) => b.kind !== 'MDB' && b.level && `${b.level.building}/${b.level.level}/${b.level.index ?? 0}` === floor.key);
                  return <div key={floor.key} className="bh-floor"><b>{levelRef(floor.tag)}</b> <span className="m">{floor.name} · from {mdbId}</span><div className="m">{here.map((b) => b.id).join(', ')}</div></div>;
                })}
                {tab === 'table' && (
                  <table className="bi-table compact">
                    <thead><tr><th>Panel</th><th>Type</th><th>Level</th><th>Fed from</th></tr></thead>
                    <tbody>{filtered.slice(0, ROWS).map((b) => <tr key={b.id} className={picked === b.id ? 'on' : ''} onClick={() => setPicked(b.id)}><td>{b.id}</td><td>{b.kind}</td><td>{levelOf(b)}</td><td>{b.upstreamId ?? 'supply to assign'}</td></tr>)}</tbody>
                  </table>
                )}
                {tab === 'table' && filtered.length > ROWS && <p className="m">Showing {ROWS} of {filtered.length} — search to narrow.</p>}
              </div>
            </section>

            <section className="card bh-side">
              <h4>Floors → MDB</h4>
              <table className="bi-table compact">
                <tbody>{chosen.map((f) => (
                  <tr key={f.key}><td>{levelRef(f.tag)}</td><td>
                    <select className="bi-sel" value={assign[f.key] ?? even[f.key] ?? 0} onChange={(e) => setAssign({ ...assign, [f.key]: +e.target.value })}>
                      {plan.mdbIds.map((id, i) => <option key={id} value={i}>{id}</option>)}
                    </select>
                  </td></tr>
                ))}</tbody>
              </table>
              {sel && (
                <>
                  <h4>{sel.id}</h4>
                  <p className="m">{sel.kind} · {levelOf(sel)} · fed from {sel.upstreamId ?? 'supply to assign'} · {children.get(sel.id)?.length ?? 0} below</p>
                </>
              )}
              <h4>Checks</h4>
              <ul className="bh-checks">{plan.checks.map((c) => <li key={c.text} className={c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'bad'}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} {c.text}</li>)}</ul>
            </section>
          </div>
        )}
        <div className="modal-actions">
          <span className="m">{plan.boards.length} panels · {plan.feeders.length} incomers · one undoable step</span>
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!plan.ok || !plan.boards.length} onClick={create}>Create hierarchy</button>
        </div>
      </div>
    </div>
  );
}
