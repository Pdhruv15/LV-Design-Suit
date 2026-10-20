import { proposalOutstanding } from '../../model/proposalStatus';
import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import type { CalcRun, StudyKey } from '../../calc/runs';
import { buildDashboard, lengthText, sizesText, type DashBar, type TodoItem } from '../../calc/dashboard';
import { buildDashboardHtml } from '../../docs/dashboardPdf';
import { safeFileName, savePdf } from '../../util/files';
import { Page } from '../ui';
import { splitTodo, stageChecklist } from '../../calc/projectReadiness';
import { ifcIssued, nextStage as nextDesignStage, prevStage as prevDesignStage, splitByStage, STAGE_INFO, stageOf, tenderRoute } from '../../model/designStage';
import { deliverableProgress, PARTY_LABEL, ROLE_LABEL, SCOPE_ITEMS } from '../../model/brief';

import type { MainView } from '../../views';
import { isOverdue, submissionCounts, submissionsOf, timeText } from '../../model/submissions';

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
export default function ProjectDashboard({ project, run, stale, saved = false, onOpen, onEditBrief, onChangeProject, onGo, onRun, onStatus, onIssueStage, onStepBack }: {
  project: Project;
  /** Back to the previous stage (a gate issued by mistake). */
  onStepBack?: () => void;
  /** The stage gate: issue this stage's package and move on. */
  onIssueStage?: () => void;
  saved?: boolean;
  onOpen?: (v: MainView | 'settings') => void;
  /** Open the scope / parties / deliverables editor. */
  onEditBrief?: () => void;
  /** Change the project (ticking a deliverable). */
  onChangeProject?: (p: Project) => void;
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
  const cards = stageChecklist(project, d, run, stale, saved);
  const { counted: inScope, outside: todoOutside } = splitTodo(project, d.todo);
  const { counted: todoCounted, later: todoLater } = splitByStage(project, inScope);
  const brief = project.brief;
  const progress = deliverableProgress(brief);


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
        <h4>Design stage <span className="m">— {STAGE_INFO[stageOf(project)].label}{ifcIssued(project) ? ' · IFC issued' : ''} · {tenderRoute(project) === 'before-ifc' ? 'tender before IFC' : 'IFC package used for tender'}</span></h4>
        <p className="m">Each stage adds detail to the one before. Checks for a later stage are listed but not counted yet. Completion records workflow progress; engineering review is still required.</p>
        <div className="dash-tiles more">{cards.map((c, k) => (
          <div key={c.stage} className="dash-tile" style={c.state === 'current' ? { borderColor: 'var(--acc)' } : undefined}>
            <span className="dash-label">{k + 1}. {c.label}</span>
            <span className="dash-value">{c.state === 'done' ? `Done${c.gate ? ` · Rev ${c.gate.revisionId}` : ''}` : c.state === 'current' ? 'Current' : 'Next'}</span>
            <span className="dash-sub">{c.does}</span>
            <ul className="dash-stage-checks">{c.checks.map((x) => { const ok = c.state === 'done' || (c.state === 'current' && x.done); return (
              <li key={x.label} className={ok ? 'ok' : 'm'}><span>{ok ? '✓' : '○'}</span>
                {onOpen ? <button className="linkish" onClick={() => x.go === 'dashboard' ? document.getElementById('dash-todo')?.scrollIntoView({ behavior: 'smooth' }) : onOpen(x.go)}>{x.label}</button> : x.label}</li>
            ); })}</ul>
            {c.gate && <span className="m">Issued {new Date(c.gate.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{c.gate.by ? ` · ${c.gate.by}` : ''}</span>}
          </div>
        ))}</div>
        <div className="dash-actions">
        {onIssueStage && !(stageOf(project) === 'ifc' && ifcIssued(project)) && (
          <button className="chip primary" onClick={onIssueStage} title="Records a revision, makes it the baseline and moves to the next stage">
            {stageOf(project) === 'ifc' ? 'Issue IFC' : `Issue ${STAGE_INFO[stageOf(project)].label.toLowerCase()} → ${STAGE_INFO[nextDesignStage(project)!].label}`}
          </button>
        )}
        {onStepBack && (prevDesignStage(project) || ifcIssued(project)) && (
          <button className="chip" onClick={onStepBack} title="Undo a stage issued by mistake: the revision stays in the history; only the stage goes back">
            {stageOf(project) === 'ifc' && ifcIssued(project) ? 'Reopen IFC' : `Back to ${STAGE_INFO[prevDesignStage(project)!].label.toLowerCase()}`}
          </button>
        )}
        </div>
      </section>
      <section className="card dash-brief">
        <h4>Scope and deliverables{brief && <span className="m"> — {ROLE_LABEL[brief.role].title.split(' — ')[0]}{progress.total ? ` · ${progress.done} / ${progress.total} delivered` : ''}</span>}
          {onEditBrief && <button className="chip" style={{ float: 'right' }} onClick={onEditBrief}>{brief ? 'Edit…' : 'Set scope and deliverables…'}</button>}</h4>
        {!brief
          ? <p className="m">No scope set: every part of the app counts towards readiness. Set the role, parties, scope and deliverables to track what this job needs.</p>
          : <>
            <p className="m">{[`Authority: ${brief.authority || '—'}`, ...brief.parties.filter(p => p.role !== 'authority' && p.name.trim()).map(p => `${PARTY_LABEL[p.role]}: ${p.name}`)].join(' · ')}</p>
            <p>{brief.scope.map(s => SCOPE_ITEMS.find(x => x.id === s)?.label).join(' · ') || <span className="m">No scope selected</span>}</p>
            {brief.deliverables.length > 0 && (
              <ul className="dash-deliverables">
                {brief.deliverables.map(dv => (
                  <li key={dv.id}>
                    <label className="row"><input type="checkbox" checked={!!dv.done} disabled={!onChangeProject} onChange={e => onChangeProject?.({ ...project, brief: { ...brief, deliverables: brief.deliverables.map(x => x.id === dv.id ? { ...x, done: e.target.checked } : x) } })} /> <span className={dv.done ? 'm' : ''}>{dv.title}</span></label>
                    {dv.targetDate && <span className={`m${!dv.done && dv.targetDate < new Date().toISOString().slice(0, 10) ? ' late' : ''}`}> — due {new Date(dv.targetDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>}
      </section>
      <div className="dash-tiles key">
        <Tile label="Maximum demand" value={`${f0(d.demandKw)} kW`} sub={<>{f0(d.demandKva)} kVA · PF {d.pf.toFixed(2)}</>} />
        <Tile label="Transformers" value={d.transformers.length ? sizesText(d.transformers.map((t) => t.kva)) : 'None'}
          sub={d.transformers.length ? <>{f0((d.demandKva / Math.max(1, d.transformerKva)) * 100)} % loaded · {d.substations} substation{d.substations > 1 ? 's' : ''}</> : 'Set on the main board'} onClick={() => onGo({ view: 'sizing' })} />
        <Tile label="Generators" value={d.generators.length ? sizesText(d.generators.map((g) => g.kva)) : 'None'}
          sub={d.generatorLoadingPct !== undefined ? <>{f0(d.generatorLoadingPct)} % loaded</> : 'Standby: on a board with an ATS'} onClick={() => onGo({ view: 'sizing' })} />
        <Tile label="Studies" value={run ? (d.stale.length ? 'Out of date' : fails ? `${fails} fail` : checks ? `${checks} to check` : 'All pass') : 'Not run'}
          sub={run ? <>{passes} pass · {checks} warning · {fails} fail{stale.length ? ' · out of date' : ''}</> : 'Press Run (F5)'} onClick={stale.length || !run ? onRun : () => onGo({ view: 'report' })} />
        <Tile label="Outstanding" value={todoCounted.length ? `${todoCounted.filter((t) => t.status === 'bad').length} to fix · ${todoCounted.filter((t) => t.status !== 'bad').length} to check` : 'Nothing'} sub={todoCounted[0]?.text ?? (todoOutside.length ? `All clear · ${todoOutside.length} outside the scope` : 'All clear')} onClick={() => document.getElementById('dash-todo')?.scrollIntoView({ behavior: 'smooth' })} />
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
        {(project.modifications?.length ?? 0) > 0 && (() => {
          const o = proposalOutstanding(project, run);
          return (
            <section className="card">
              <h4>Modifications <span className="m">({project.modifications!.length})</span></h4>
              <p className="m">{o.counts.draft} draft · {o.counts.awaitingDecision} awaiting a decision · {o.counts.acceptedNotApplied} accepted, not applied{o.counts.conflicts ? ` · ${o.counts.conflicts} with changed values` : ''}{o.counts.needRerun ? ` · ${o.counts.needRerun} applied, studies to run again` : ''}</p>
              {o.pending.slice(0, 5).map((x) => <p key={x.id} className="m">• {x.text}</p>)}
              <button className="chip" onClick={() => onGo({ view: 'modifications' })}>Open modifications</button>
            </section>
          );
        })()}
        {submissionsOf(project).length > 0 && (() => {
          const now = new Date().toISOString().slice(0, 10);
          const c = submissionCounts(project, now);
          const late = submissionsOf(project).filter((s) => isOverdue(project, s, now));
          return (
            <section className="card">
              <h4>Submissions <span className="m">({c.total})</span></h4>
              <p className="m">{c.open} awaiting response{c.overdue ? <> · <b className="warn">{c.overdue} overdue</b></> : ''} · {c.approved + c.withComments} approved{c.resubmit ? ` · ${c.resubmit} to resubmit` : ''}{c.openComments ? ` · ${c.openComments} open comment${c.openComments > 1 ? 's' : ''}` : ''}</p>
              {late.slice(0, 5).map((s) => <p key={s.id} className="m">• {s.id} {s.title} — {s.to}, {timeText(project, s, now).toLowerCase()}</p>)}
              <button className="chip" onClick={() => onGo({ view: 'submissions' })}>Open submissions</button>
            </section>
          );
        })()}
        <section className="card">
          <h4 id="dash-todo">To do <span className="m">({todoCounted.length})</span></h4>
          {!todoCounted.length ? <p className="ok">✓ Nothing outstanding{todoOutside.length ? ' in this project’s scope' : ''}.</p> : (
            <ul className="dash-todo">
              {todoCounted.slice(0, 14).map((t, k) => (
                <li key={k}>
                  <span className={`dash-todo-mark ${t.status}`}>{t.status === 'bad' ? '✕ Fix' : '⚠ Check'}</span>
                  {t.go ? <button className="linkish" onClick={() => onGo(t.go!)}>{t.text}</button> : <span>{t.text}</span>}
                </li>
              ))}
              {todoCounted.length > 14 && <li className="m">+ {todoCounted.length - 14} more</li>}
            </ul>
          )}
          {todoLater.length > 0 && (
            <details className="dash-outside">
              <summary>For a later design stage ({todoLater.length}) <span className="m">— not counted at {STAGE_INFO[stageOf(project)].label}</span></summary>
              <ul className="dash-todo">
                {todoLater.map((t, k) => (
                  <li key={k}>
                    <span className={`dash-todo-mark ${t.status}`}>{t.status === 'bad' ? '✕ Fix' : '⚠ Check'}</span>
                    {t.go ? <button className="linkish" onClick={() => onGo(t.go!)}>{t.text}</button> : <span>{t.text}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {todoOutside.length > 0 && (
            <details className="dash-outside">
              <summary>Outside this project’s scope ({todoOutside.length}) <span className="m">— not counted in readiness</span></summary>
              <ul className="dash-todo">
                {todoOutside.map((t, k) => (
                  <li key={k}>
                    <span className={`dash-todo-mark ${t.status}`}>{t.status === 'bad' ? '✕ Fix' : '⚠ Check'}</span>
                    {t.go ? <button className="linkish" onClick={() => onGo(t.go!)}>{t.text}</button> : <span>{t.text}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </Page>
  );
}
