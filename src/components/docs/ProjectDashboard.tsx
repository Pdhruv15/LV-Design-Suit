import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import type { CalcRun, StudyKey } from '../../calc/runs';
import { buildDashboard, lengthText, sizesText, type DashBar, type TodoItem } from '../../calc/dashboard';
import { buildDashboardHtml } from '../../docs/dashboardPdf';
import { safeFileName, savePdf } from '../../util/files';
import { Page } from '../ui';
import { projectReadiness } from '../../calc/projectReadiness';

import type { MainView } from '../../views';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

function Tile({ label, value, sub, onClick, title }: { label: string; value: string; sub?: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button className={`dash-tile${onClick ? ' link' : ''}`} onClick={onClick} disabled={!onClick} title={title}>
      <span className="dash-label">{label}</span>
      <span className="dash-value">{value}</span>
      {sub && <span className="dash-sub">{sub}</span>}
    </button>
  );
}

/** Horizontal bars, one series: sorted, values labelled at the bar end. */
function Bars({ bars, unit = 'kW', empty }: { bars: DashBar[]; unit?: string; empty: string }) {
  if (!bars.length) return <p className="m">{empty}</p>;
  const max = Math.max(...bars.map((b) => b.kw));
  return (
    <div className="dash-bars" role="table">
      {bars.slice(0, 12).map((b) => (
        <div key={b.label} className="dash-bar" role="row" title={`${b.label}: ${f1(b.kw)} ${unit} (${f0(b.pct)} %)`}>
          <span className="dash-bar-label" role="cell">{b.label}</span>
          <span className="dash-bar-track" role="cell"><span className="dash-bar-fill" style={{ width: `${Math.max(1, (b.kw / max) * 100)}%` }} /></span>
          <span className="dash-bar-val" role="cell">{f0(b.kw)} <span className="m">{unit} · {f0(b.pct)} %</span></span>
        </div>
      ))}
      {bars.length > 12 && <p className="m">+ {bars.length - 12} more</p>}
    </div>
  );
}

/** The project at a glance: headline numbers, load breakdowns, transformer
 * loading and a to-do list; exports as a one-page PDF. */
export default function ProjectDashboard({ project, run, stale, saved = false, onOpen, onGo, onRun, onStatus }: {
  project: Project;
  saved?: boolean;
  onOpen?: (v: MainView | 'settings') => void;
  run?: CalcRun;
  stale: StudyKey[];
  onGo: (go: NonNullable<TodoItem['go']>) => void;
  onRun: () => void;
  onStatus: (m: string) => void;
}) {
  const d = useMemo(() => buildDashboard(project, run, stale), [project, run, stale]);
  const [busy, setBusy] = useState(false);
  const i = d.info;
  const fails = d.studies.reduce((a, s) => a + s.fail, 0);
  const checks = d.studies.reduce((a, s) => a + s.check, 0);
  const passes = d.studies.reduce((a, s) => a + s.pass, 0);
  const stages = projectReadiness(project, d, run, stale, saved);
  const nextStage = stages.find(s => !s.done);


  async function exportPdf() {
    setBusy(true);
    try {
      const m = await savePdf(`${safeFileName(project.name)} - project summary.pdf`, buildDashboardHtml(project, d), { pageSize: 'A4', landscape: true });
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Overview"
      actions={<>
        {stale.length > 0 && <button className="chip" onClick={onRun}>Run (F5)</button>}
        <button className="chip primary" disabled={busy} onClick={exportPdf}>1-page PDF summary</button>
      </>}
    >
      <section className="card dash-info">
        <div className="dash-name">
          <b>{i.name}</b>
          <span className="dash-status">{i.status}</span>
          {i.revision && <span className="m">{i.revision}</span>}
        </div>
        <div className="dash-meta">
          {[['Owner', i.owner], ['Plot', i.plot], ['Area', i.area], ['Consultant', i.consultant], ['Engineer', i.engineer],
            ['Last saved', i.updatedAt ? `${new Date(i.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${i.updatedBy ? ` · ${i.updatedBy}` : ''}` : undefined]]
            .filter(([, v]) => v).map(([k, v]) => <span key={k}><span className="m">{k}:</span> {v}</span>)}
        </div>
      </section>

      <div className="dash-actions">
        <button className="chip primary" onClick={() => onOpen?.('design')}>Continue design</button>
        <button className={`chip${stale.length || !run ? ' stale' : ''}`} onClick={onRun} title="Run the network studies (F5)">Run calculations{stale.length ? ` · ${stale.length} out of date` : ''}</button>
        <button className="chip" onClick={() => onOpen?.('study-reports')}>Study reports</button>
        <button className="chip" onClick={() => onOpen?.('drawings')}>Drawings</button>
        <span className="sp" />
        <span className={`m dash-state ${saved ? 'ok' : 'warn'}`}>{saved ? '✓ Saved' : '● Not saved'}</span>
        <span className={`m dash-state ${!run || stale.length ? 'warn' : 'ok'}`}>{!run ? 'Calculations not run' : stale.length ? 'Results out of date' : `✓ Calculated ${new Date(run.at).toLocaleTimeString()}`}</span>
      </div>

      <section className="card dash-start">
        <h4>Project readiness <span className="m">— {stages.filter(s => s.done).length} / {stages.length} stages complete</span></h4>
        <p className="m">Checks cover network results, configured UPS and solar studies, and drawings. Completion records workflow progress; engineering review is still required.</p>
        <div className="dash-tiles more">{stages.map(stage => <Tile key={stage.id} label={stage.label} value={stage.done ? 'Complete' : 'Pending'} sub={stage.detail} onClick={onOpen ? () => stage.id === 'calculate' ? onRun() : onOpen(stage.go) : undefined} />)}</div>
        {nextStage && onOpen && <button className="chip primary" onClick={() => nextStage.id === 'calculate' ? onRun() : nextStage.id === 'resolve' ? document.getElementById('dash-todo')?.scrollIntoView({ behavior: 'smooth' }) : onOpen(nextStage.go)}>Next: {nextStage.label}</button>}
      </section>
      <div className="dash-tiles key">
        <Tile label="Maximum demand" value={`${f0(d.demandKw)} kW`} sub={<>{f0(d.demandKva)} kVA · PF {d.pf.toFixed(2)}</>} />
        <Tile label="Transformers" value={d.transformers.length ? sizesText(d.transformers.map((t) => t.kva)) : 'None'}
          sub={d.transformers.length ? <>{f0((d.demandKva / Math.max(1, d.transformerKva)) * 100)} % loaded · {d.substations} substation{d.substations > 1 ? 's' : ''}</> : 'Set on the main board'} onClick={() => onGo({ view: 'sizing' })} />
        <Tile label="Generators" value={d.generators.length ? sizesText(d.generators.map((g) => g.kva)) : 'None'}
          sub={d.generatorLoadingPct !== undefined ? <>{f0(d.generatorLoadingPct)} % loaded</> : 'Standby: on a board with an ATS'} onClick={() => onGo({ view: 'sizing' })} />
        <Tile label="Studies" value={run ? (d.stale.length ? 'Out of date' : fails ? `${fails} fail` : checks ? `${checks} to check` : 'All pass') : 'Not run'}
          sub={run ? <>{passes} pass · {checks} check · {fails} fail{stale.length ? ' · out of date' : ''}</> : 'Press Run (F5)'} onClick={stale.length || !run ? onRun : () => onGo({ view: 'report' })} />
        <Tile label="Outstanding" value={d.todo.length ? `${d.todo.filter((t) => t.status === 'bad').length} to fix · ${d.todo.filter((t) => t.status !== 'bad').length} to check` : 'Nothing'} sub={d.todo[0]?.text ?? 'All clear'} onClick={() => document.getElementById('dash-todo')?.scrollIntoView({ behavior: 'smooth' })} />
      </div>

      <div className="dash-tiles more">
        <Tile label="Connected load (TCL)" value={`${f0(d.connectedKw)} kW`} sub={<>{d.byType.length} load types</>} onClick={() => onGo({ view: 'load-schedule' })} />
        <Tile label="Panels" value={String(d.panels.total)} sub={d.panels.byKind.map((k) => `${k.n} ${k.label}`).join(' · ')} />
        <Tile label="Total area" value={d.area ? `${f0(d.area.gfaM2)} m²` : '—'}
          sub={d.area ? <>{d.area.source === 'building' ? `GFA · ${d.area.floors} floors${d.area.buildings > 1 ? ` · ${d.area.buildings} buildings` : ''}` : d.area.source === 'forms' ? 'built-up area (forms)' : 'space plan areas'}</> : 'Add it in Building information'}
          onClick={() => onGo({ view: 'building' })} />
        <Tile label="Power density" value={d.density ? `${f1(d.density.connected)} W/m²` : '—'} sub={d.density ? <>connected · {f1(d.density.demand)} W/m² demand</> : 'Needs the area'} />
        <Tile label="Capacitors" value={d.capacitorKvar ? `${f0(d.capacitorKvar)} kvar` : 'None'} sub={<>PF {d.pf.toFixed(2)} with them</>} onClick={() => onGo({ view: 'pfc' })} />
        <Tile label="Cables" value={lengthText(d.cableM)} sub={<>{d.cableRuns} cables{d.extras.length ? ` · ${d.extras.join(' · ')}` : ''}</>} onClick={() => onGo({ view: 'cable-schedule' })} />
      </div>

      <div className="dash-grid">
        <section className="card">
          <h4>Load by type <span className="m">(maximum demand)</span></h4>
          <Bars bars={d.byType} empty="No loads yet." />
        </section>
        <section className="card">
          <h4>Transformer loading <span className="m">(demand ÷ rating, limit {d.transformers[0]?.limitPct ?? 80} %)</span></h4>
          {!d.transformers.length && <p className="m">No transformer set on a main board.</p>}
          <div className="dash-meters">
            {d.transformers.map((t) => (
              <button key={t.boardId} className="dash-meter" onClick={() => onGo({ view: 'sizing' })} title={`${t.boardId}: ${f0(t.demandKva)} kVA of ${t.kva} kVA`}>
                <span className="dash-bar-label">{t.boardId} <span className="m">{t.kva} kVA</span></span>
                <span className="dash-meter-track">
                  <span className="dash-meter-fill" style={{ width: `${Math.min(100, t.loadingPct)}%` }} />
                  <span className="dash-meter-limit" style={{ left: `${t.limitPct}%` }} />
                </span>
                <span className="dash-bar-val">{f0(t.loadingPct)} % {t.status !== 'ok' && <span className={t.status}>{t.status === 'bad' ? '✕ over' : '⚠ above limit'}</span>}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card">
          <h4>{d.perArea.title}</h4>
          <Bars bars={d.perArea.bars} empty="Add levels and rooms in Building information to see the load per level." />
        </section>
        <section className="card">
          <h4 id="dash-todo">To do <span className="m">({d.todo.length})</span></h4>
          {!d.todo.length ? <p className="ok">✓ Nothing outstanding.</p> : (
            <ul className="dash-todo">
              {d.todo.slice(0, 14).map((t, k) => (
                <li key={k}>
                  <span className={`dash-todo-mark ${t.status}`}>{t.status === 'bad' ? '✕ Fix' : '⚠ Check'}</span>
                  {t.go ? <button className="linkish" onClick={() => onGo(t.go!)}>{t.text}</button> : <span>{t.text}</span>}
                </li>
              ))}
              {d.todo.length > 14 && <li className="m">+ {d.todo.length - 14} more</li>}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}
