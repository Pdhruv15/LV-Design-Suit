import type { Project } from '../types';
import type { CalcRun, StudyKey } from '../calc/runs';
import type { MainView } from '../views';
import { QUICK_PATHS, startChecklist, WORKFLOW, type ChecklistItem } from '../help/guide';
import { Page } from './ui';

type Go = (v: MainView | 'settings') => void;

/** Start-here checklist, ticked from the project (also on the dashboard). */
export function Checklist({ items, onGo, compact }: { items: ChecklistItem[]; onGo: Go; compact?: boolean }) {
  const done = items.filter((x) => x.done).length;
  return (
    <div className="help-check">
      <div className="help-progress"><span style={{ width: `${(done / items.length) * 100}%` }} /></div>
      <p className="m">{done} of {items.length} done{compact && done === items.length ? ' — ready to submit' : ''}</p>
      <ul>
        {items.map((x) => (
          <li key={x.id} className={x.done ? 'done' : ''}>
            <span className="help-tick">{x.done ? '✓' : '○'}</span>
            <button className="linkish" onClick={() => onGo(x.go)}>{x.label}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Help: the workflow from start to finish, quick paths for one job, and the checklist. */
export default function HelpView({ project, run, stale, saved, onGo }: { project: Project; run?: CalcRun; stale: StudyKey[]; saved: boolean; onGo: Go }) {
  const phases = ['Setup', 'Design', 'Check', 'Deliver'] as const;
  return (
    <Page title="Help — how to use LV Design Studio" intro="The whole job from start to finish, or just the one calculation you need. Click any step or task to open it.">
      <div className="help-grid">
        <section className="card">
          <h4>Project workflow — start to finish</h4>
          <div className="help-flow">
            {phases.map((ph) => (
              <div key={ph} className={`help-phase p-${ph.toLowerCase()}`}>
                <span className="help-phase-name">{ph}</span>
                {WORKFLOW.filter((s) => s.phase === ph).map((s) => (
                  <button key={s.n} className="help-step" onClick={() => onGo(s.go)}>
                    <span className="help-n">{s.n}</span>
                    <span><b>{s.title}</b><span className="m"> · {s.where}</span><br /><span className="help-what">{s.what}</span></span>
                  </button>
                ))}
              </div>
            ))}
            <p className="m">Step 6 loops back to 4–5 until the dashboard’s to-do list is empty.</p>
          </div>
        </section>
        <section className="card">
          <h4>Start here — this project</h4>
          <Checklist items={startChecklist(project, run, stale, saved)} onGo={onGo} />
          <h4 style={{ marginTop: 16 }}>Tips</h4>
          <ul className="help-tips">
            <li><b>Ctrl+S / ⌘S</b> saves; a recovery copy is kept automatically.</li>
            <li><b>F5</b> runs the calculations; pages show when results are out of date.</li>
            <li>Click a board in the <b>panel tree</b> — each page opens or filters to it; double-click opens it on the SLD.</li>
            <li>Issue a <b>revision</b> before sending anything, so every sheet carries Rev A, B…</li>
            <li>Set your name, company, logo and defaults once in <b>Profile</b>.</li>
          </ul>
        </section>
      </div>
      <section className="card" style={{ marginTop: 12 }}>
        <h4>Quick paths — just one job</h4>
        <table className="help-quick">
          <thead><tr><th>I only want…</th><th>Go to</th><th>Steps</th><th /></tr></thead>
          <tbody>
            {QUICK_PATHS.map((q) => (
              <tr key={q.task}>
                <td>{q.task}</td><td className="m">{q.where}</td><td>{q.steps}</td>
                <td><button className="chip" onClick={() => onGo(q.go)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Page>
  );
}
