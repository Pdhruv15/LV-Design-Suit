import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { settingsOf } from '../types';
import { sizeTransformers } from '../calc/txGen';
import { applyTransformers, DEWA_TRANSFORMER_KVA, mainBoards, mainOf, moveUnder, nextRmus, planTransformers, rmuNames, setRmu, setSubstation, setTransformer, txTag } from '../model/transformers';
import { toggleIn } from '../util/sets';

const fmt = (n: number | undefined, d = 0) => (n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));

/** Panels → Transformers: DEWA transformers (one MDB each), their loading, and which panels each one feeds. */
export default function TransformersTab({ project, onChange, onCreate, onStatus }: {
  project: Project;
  onChange: (p: Project) => void;
  onCreate: (next: Project, message: string) => void;
  onStatus: (m: string) => void;
}) {
  const [kvas, setKvas] = useState<number[]>([1500, 1500]);
  const [ties, setTies] = useState(false);
  const [perRmu, setPerRmu] = useState<1 | 2>(1);
  const [sub, setSub] = useState('');
  const plan = useMemo(() => planTransformers(project, kvas.map((kva) => ({ kva })), ties, perRmu, sub), [project, kvas, ties, perRmu, sub]);
  const mains = mainBoards(project);
  const rows = useMemo(() => { try { return sizeTransformers(project, { txBoards: [], sizeList: 'dewa', n1: [], includePfc: true, emergencyLoadingPct: 100, genBoards: {} }); } catch { return []; } }, [project]);
  const limit = settingsOf(project).transformerMaxLoadingPct;
  // Panels fed straight from a main board: these are moved between transformers.
  const firstLevel = project.boards.filter((b) => b.upstreamId && mains.some((m) => m.id === b.upstreamId));
  const [moveSel, setMoveSel] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');

  const setCount = (n: number) => setKvas(Array.from({ length: Math.max(0, Math.min(15, n)) }, (_, i) => kvas[i] ?? kvas[kvas.length - 1] ?? 1500));
  function create() {
    if (plan.problems.length) return;
    onCreate(applyTransformers(project, plan), `${plan.boards.length} transformer${plan.boards.length > 1 ? 's' : ''} with ${plan.boards.map((b) => b.id).join(', ')}${plan.ties.length ? ` and ${plan.ties.length} bus tie(s)` : ''}`);
  }
  function move() {
    if (!target || !moveSel.size) return;
    onChange(moveUnder(project, [...moveSel], target));
    onStatus(`${moveSel.size} panel(s) now on ${txTag(project, target) ?? target} (${target}) — incomer lengths marked to check`);
    setMoveSel(new Set());
  }

  return (
    <div className="pp-cols tx-cols">
      <section className="card">
        <h4>Add transformers</h4>
        <p className="m">DEWA 11 / 0.415 kV. Each transformer feeds its own MDB.</p>
        <div className="form-kv">
          <label>Transformers<input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={kvas.length} onChange={(e) => setCount(Number(e.target.value) || 0)} /></label>
          {kvas.map((k, i) => (
            <label key={i}>{plan.boards[i]?.id ?? `TX ${i + 1}`}<select value={k} onChange={(e) => setKvas(kvas.map((x, j) => (j === i ? Number(e.target.value) : x)))}>{DEWA_TRANSFORMER_KVA.map((v) => <option key={v} value={v}>{v} kVA</option>)}</select></label>
          ))}
        </div>
        <label>Substation<input className="bi-text" style={{ width: 130 }} value={sub} placeholder="e.g. SS-01" onChange={(e) => setSub(e.target.value)} /></label>
        <label>RMU<select value={perRmu} onChange={(e) => setPerRmu(Number(e.target.value) as 1 | 2)}><option value={1}>One RMU per transformer</option><option value={2}>One RMU for two transformers</option></select></label>
        <p className="m">{[...new Set(plan.boards.map((b) => b.rmu))].join(', ')}</p>
        <label className="row"><input type="checkbox" checked={ties} onChange={(e) => setTies(e.target.checked)} /> Bus tie between pairs (normally open)</label>
        {plan.problems.map((p) => <p key={p} className="bad">{p}</p>)}
        <button className="chip primary" disabled={!!plan.problems.length} onClick={create}>Create {kvas.length} transformer{kvas.length === 1 ? '' : 's'} + MDB{kvas.length === 1 ? '' : 's'}</button>
      </section>

      <section className="card">
        <h4>Transformer loading</h4>
        {!mains.length && <p className="m">No main boards yet.</p>}
        <div className="pp-table">
          <table className="bi-table compact">
            <thead><tr><th>Transformer</th><th>MDB</th><th>kVA</th><th>Substation</th><th>RMU</th><th>Demand kVA</th><th>Loading</th><th>DEWA size needed</th><th>Feeds</th></tr></thead>
            <tbody>{mains.map((m) => {
              const r = rows.find((x) => x.board.id === m.id);
              const pct = r?.loadingPct;
              const feeds = project.boards.filter((b) => b.upstreamId === m.id).length;
              return (
                <tr key={m.id}>
                  <td>{txTag(project, m.id) ?? <span className="warn">none</span>}</td>
                  <td>{m.id}</td>
                  <td><select value={m.sourceKva ?? ''} onChange={(e) => onChange(setTransformer(project, m.id, e.target.value ? Number(e.target.value) : undefined))}><option value="">—</option>{[...new Set([...DEWA_TRANSFORMER_KVA, ...(m.sourceKva ? [m.sourceKva] : [])])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v}</option>)}</select></td>
                  <td><input className="bi-text" style={{ width: 90 }} defaultValue={m.substation ?? ''} key={`${m.id}-${m.substation ?? ''}`} placeholder="—" onBlur={(e) => e.target.value.trim() !== (m.substation ?? '') && onChange(setSubstation(project, m.id, e.target.value))} /></td>
                  <td><select value={m.rmu ?? ''} onChange={(e) => onChange(setRmu(project, m.id, e.target.value === '+' ? nextRmus(project, 1)[0] : e.target.value || undefined))}><option value="">—</option>{rmuNames(project).map((n) => <option key={n} value={n}>{n}</option>)}<option value="+">New RMU</option></select></td>
                  <td>{fmt(r?.demandKva, 1)}</td>
                  <td className={pct === undefined ? 'm' : pct > limit ? 'bad' : 'ok'}>{pct === undefined ? '—' : `${fmt(pct, 1)} %`}</td>
                  <td>{r?.recommendedKva ? `${r.split > 1 ? `${r.split} × ` : ''}${r.recommendedKva} kVA` : '—'}</td>
                  <td>{feeds} panel{feeds === 1 ? '' : 's'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="m">Loading limit {limit} % (Project settings). DEWA size needed includes future growth and that limit.</p>
      </section>

      <section className="card">
        <h4>Move panels to another transformer</h4>
        {!firstLevel.length ? <p className="m">No panels fed from a main board yet.</p> : <>
          <div className="pp-table tx-move">
            <table className="bi-table compact">
              <thead><tr><th></th><th>Panel</th><th>Now on</th></tr></thead>
              <tbody>{firstLevel.map((b) => {
                const m = mainOf(project, b.id)!;
                return (
                  <tr key={b.id} className={moveSel.has(b.id) ? 'on' : ''}>
                    <td><input type="checkbox" checked={moveSel.has(b.id)} onChange={() => setMoveSel((s) => toggleIn(s, b.id))} /></td>
                    <td>{b.id}</td><td>{txTag(project, m.id) ?? '—'} · {m.id}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="pp-bar">
            <label>Move to<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">—</option>{mains.map((m) => <option key={m.id} value={m.id}>{txTag(project, m.id) ?? 'no TX'} · {m.id}</option>)}</select></label>
            <button className="chip" disabled={!target || !moveSel.size} onClick={move}>Move {moveSel.size || ''}</button>
          </div>
          <p className="m">Everything below a moved panel goes with it. Its incomer cable length is marked to check.</p>
        </>}
      </section>
    </div>
  );
}
