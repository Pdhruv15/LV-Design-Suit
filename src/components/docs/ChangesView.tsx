import { useMemo } from 'react';
import type { Project } from '../../types';
import type { MainView } from '../../views';
import { baselineOf } from '../../model/designBaseline';
import { impactBetween, type DesignImpact } from '../../model/designImpact';
import { Page } from '../ui';
import ModificationsPanel from './ModificationsPanel';

const f2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US');
const WHY = { changed: 'changed', upstream: 'fed by a changed panel', downstream: 'fed from a changed item' } as const;

/** What a set of changes touches: panels, studies to run again, drawings and schedules, BOQ design quantities, and
 * what this preview does not determine. Shows no results of its own. */
export function ImpactPanel({ impact, onGo }: { impact: DesignImpact; onGo?: (v: MainView) => void }) {
  const go = (v?: MainView) => (v && onGo ? () => onGo(v) : undefined);
  if (impact.empty) return <p className="m">No engineering or drawing differences.</p>;
  return (
    <div className="impact">
      <section className="card">
        <h4>What changes <span className="m">({impact.changes.length})</span></h4>
        <ul className="rev-fields-list">
          {impact.changes.slice(0, 40).map((c) => (
            <li key={`${c.what}-${c.id}-${c.kind}`}><b>{c.label}</b> <span className="m">{c.kind}</span>{c.fields.length > 0 && <span className="rev-fields">{c.fields.slice(0, 6).map((f) => <span key={f.field}>{f.field}: <s>{f.from}</s> → {f.to}</span>)}{c.fields.length > 6 && <span className="m">+ {c.fields.length - 6} more</span>}</span>}</li>
          ))}
          {impact.changes.length > 40 && <li className="m">+ {impact.changes.length - 40} more</li>}
        </ul>
      </section>
      <section className="card">
        <h4>Panels affected <span className="m">({impact.panels.length})</span></h4>
        <p>{impact.panels.map((p) => <span key={p.id} className={`chip-lite${p.why === 'changed' ? ' on' : ''}`} title={WHY[p.why]}>{p.id}</span>)}</p>
        {impact.demand.length > 0 && (
          <table className="schedule rev-kw">
            <thead><tr><th>Panel</th><th>Demand before (kW)</th><th>Demand after (kW)</th><th>Change</th></tr></thead>
            <tbody>{impact.demand.map((k) => <tr key={k.boardId}><td>{k.boardId}</td><td>{f2(k.from)}</td><td>{f2(k.to)}</td><td className={k.to > k.from ? 'warn' : 'ok'}>{k.to > k.from ? '+' : ''}{f2(k.to - k.from)}</td></tr>)}</tbody>
          </table>
        )}
        <p className="m">Demand is added up from the loads entered; it is not a study result.</p>
      </section>
      <section className="card">
        <h4>Studies to run again <span className="m">({impact.studies.length})</span></h4>
        {impact.studies.length === 0 ? <p className="m">None — no study input changed.</p> : (
          <ul>{impact.studies.map((s) => <li key={s.id}>{go(s.view) ? <button className="linkish" onClick={go(s.view)}>{s.label}</button> : s.label} <span className="m">— {s.reason}</span></li>)}</ul>
        )}
      </section>
      <section className="card">
        <h4>Drawings and schedules affected <span className="m">({impact.documents.length})</span></h4>
        {impact.documents.length === 0 ? <p className="m">None.</p> : <ul>{impact.documents.map((d, i) => <li key={i}>{go(d.view) ? <button className="linkish" onClick={go(d.view)}>{d.label}</button> : d.label} <span className="m">— {d.reason}</span></li>)}</ul>}
      </section>
      {impact.quantities.length > 0 && (
        <section className="card">
          <h4>BOQ design quantities <span className="m">({impact.quantities.length})</span></h4>
          <table className="schedule">
            <thead><tr><th>Item</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
            <tbody>{impact.quantities.slice(0, 40).map((q) => <tr key={q.key}><td>{q.description}</td><td>{f2(q.from)} {q.unit}</td><td>{f2(q.to)} {q.unit}</td><td className={q.to > q.from ? 'warn' : 'ok'}>{q.to > q.from ? '+' : ''}{f2(q.to - q.from)}</td></tr>)}</tbody>
          </table>
          {impact.quantities.length > 40 && <p className="m">+ {impact.quantities.length - 40} more</p>}
        </section>
      )}
      {impact.assumptions.length > 0 && (
        <section className="card">
          <h4>Not determined here</h4>
          <ul>{impact.assumptions.map((a) => <li key={a} className="m">{a}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

/** Design changes: what the working draft changes against its baseline, and what that touches. */
export default function ChangesView({ project, me = '', onChange, onApply, onStatus, onGo }: {
  project: Project; me?: string; onChange: (p: Project) => void; onApply: (p: Project) => void; onStatus: (m: string) => void; onGo?: (v: MainView) => void;
}) {
  const base = baselineOf(project);
  const impact = useMemo(() => (base ? impactBetween(base.revision.snapshot, project) : undefined), [base?.revision, project]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page title="Design changes" intro="What the working draft changes compared with its baseline, and what that touches: panels, the studies to run again, drawings and schedules, and BOQ design quantities. It shows no new results — it says what to run again.">
      <ModificationsPanel project={project} me={me} onChange={onChange} onApply={onApply} onStatus={onStatus} onGo={onGo} />
      <h4 style={{ marginTop: 14 }}>Working draft against its baseline</h4>
      {!base || !impact ? (
        <p className="m">Nothing to compare yet: issue a revision first (Reports → Revisions). The baseline is the issued revision the draft is measured against.</p>
      ) : (
        <>
          <p><b>Baseline: Rev {base.revision.id}</b> <span className="m">{base.revision.date}{base.revision.description ? ` · ${base.revision.description}` : ''}{base.chosen ? '' : ' · latest issued'}</span></p>
          <ImpactPanel impact={impact} onGo={onGo} />
        </>
      )}
    </Page>
  );
}
