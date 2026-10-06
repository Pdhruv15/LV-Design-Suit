import { useEffect, useState } from 'react';
import type { Project } from '../../types';
import type { MainView } from '../../views';
import { opView } from '../../model/proposalRegister';
import { isPreviewStale, previewProposal, type ProposalPreview } from '../../model/proposalPreview';
import { loadPriceLists } from '../../model/priceList';
import type { ModificationRecord } from '../../model/designChanges';

const TABS = ['Changed values', 'Studies affected', 'Drawings and schedules', 'BOQ quantity effect', 'Open checks and limitations'] as const;
const f = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US');
const word = (s: string) => (s === 'ok' ? 'pass' : s === 'warn' ? 'check' : s === 'bad' ? 'fail' : s);

/** Preview of a proposal, calculated on request from the working design and the design with the proposal applied. It is labelled
 * Proposed, changes nothing, and is marked out of date as soon as the design or the proposal changes. */
export default function ProposalPreviewPanel({ project, rec, onGo }: { project: Project; rec: ModificationRecord; onGo?: (v: MainView) => void }) {
  const [prev, setPrev] = useState<ProposalPreview | undefined>();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  useEffect(() => { setPrev(undefined); }, [rec.id]);
  const list = (() => { try { return loadPriceLists()[0]; } catch { return undefined; } })();
  const stale = prev ? isPreviewStale(project, rec, prev, list) : false;
  const run = () => { setBusy(true); setTimeout(() => { try { setPrev(previewProposal(project, rec, list)); } finally { setBusy(false); } }, 20); };

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <h4>Impact preview <span className="chip-lite">Proposed</span></h4>
      <p className="m">Calculated now for the working design and for the design with this proposal applied (the whole network, not one circuit). Nothing is changed. The last study run is never used as the “before”.</p>
      <button className="chip primary" disabled={busy || !rec.ops.length} onClick={run}>{busy ? 'Calculating…' : prev ? 'Recalculate preview' : 'Calculate preview'}</button>
      {stale && <p className="bad" role="alert">This preview is out of date: the design or the proposal changed after it was calculated. Recalculate before relying on it.</p>}
      {prev && (
        <>
          <div className="tabs feeder-tabs" role="tablist" style={{ marginTop: 8 }}>{TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
          {prev.skipped.map((m, i) => <p key={i} className="warn">⚠ {m}</p>)}
          {tab === 'Changed values' && (
            <>
              <table className="schedule"><thead><tr><th>Item</th><th>Current design</th><th>Expected before</th><th>Proposed</th></tr></thead><tbody>
                {rec.ops.map((o) => { const v = opView(project, o); return <tr key={o.id}><td>{v.item}</td><td>{v.current}</td><td>{v.expectedBefore}</td><td><b>{v.proposed}</b></td></tr>; })}
              </tbody></table>
              <h5>Calculated results that change (proposed)</h5>
              {prev.circuits.length ? <table className="schedule"><thead><tr><th>Circuit</th><th>Panel</th><th>Result</th><th>Now</th><th>Proposed</th></tr></thead><tbody>
                {prev.circuits.map((c, i) => <tr key={i}><td>{c.id}</td><td>{c.boardId}</td><td>{c.metric}</td><td>{f(c.from)} {c.unit}</td><td><b>{f(c.to)} {c.unit}</b></td></tr>)}
              </tbody></table> : <p className="m">No circuit result changes.</p>}
              {prev.statuses.length > 0 && <ul>{prev.statuses.map((s, i) => <li key={i} className={s.to === 'bad' ? 'bad' : ''}>{s.what}: {word(s.from)} → <b>{word(s.to)}</b></li>)}</ul>}
            </>
          )}
          {tab === 'Studies affected' && (
            <>
              {prev.impact.studies.length ? <ul>{prev.impact.studies.map((s) => <li key={s.id}>{s.view && onGo ? <button className="linkish" onClick={() => onGo(s.view!)}>{s.label}</button> : s.label} <span className="m">— {s.reason}</span></li>)}</ul> : <p className="m">No study inputs change.</p>}
              {prev.ups.map((u) => (
                <div key={u.id}><h5>{u.name} — UPS and battery (proposed)</h5>
                  <table className="schedule"><thead><tr><th>Result</th><th>Now</th><th>Proposed</th></tr></thead><tbody>{u.rows.map((r, i) => <tr key={i}><td>{r.metric}</td><td>{r.from}</td><td><b>{r.to}</b></td></tr>)}</tbody></table>
                  {u.issues.map((m, i) => <p key={i} className="bad">⚠ {m}</p>)}
                </div>
              ))}
            </>
          )}
          {tab === 'Drawings and schedules' && (prev.documents.length ? <table className="schedule"><thead><tr><th>Document</th><th>Why</th><th>Impact</th></tr></thead><tbody>
            {prev.documents.map((d, i) => <tr key={i}><td>{d.view && onGo ? <button className="linkish" onClick={() => onGo(d.view!)}>{d.label}</button> : d.label}</td><td>{d.reason}</td><td>{d.certainty === 'known' ? 'Known: the drawing shows this equipment' : 'Manual review needed'}</td></tr>)}
          </tbody></table> : <p className="m">No drawing or schedule is flagged.</p>)}
          {tab === 'BOQ quantity effect' && (
            <>
              {prev.quantities.length ? <table className="schedule"><thead><tr><th>Item</th><th>Now</th><th>Proposed</th><th>Change</th><th>Cost effect</th></tr></thead><tbody>
                {prev.quantities.map((q) => <tr key={q.key} title={q.note}><td>{q.description}</td><td>{f(q.from)} {q.unit}</td><td>{f(q.to)} {q.unit}</td><td>{q.delta > 0 ? '+' : ''}{f(q.delta)}</td>
                  <td className={typeof q.cost === 'string' ? 'm' : ''}>{typeof q.cost === 'number' ? `${q.cost > 0 ? '+' : ''}${f(q.cost)}` : q.cost}{q.note && typeof q.cost === 'number' ? ' (estimate)' : ''}</td></tr>)}
              </tbody></table> : <p className="m">No design quantity changes.</p>}
              {prev.adjustments.map((m, i) => <p key={i} className="warn">⚠ {m}</p>)}
              <p className="m">Design quantities only. Your manual lines, quantity adjustments, wastage and prices are not changed or included.</p>
            </>
          )}
          {tab === 'Open checks and limitations' && <ul>{prev.limitations.map((l, i) => <li key={i} className="m">{l}</li>)}</ul>}
        </>
      )}
    </div>
  );
}
