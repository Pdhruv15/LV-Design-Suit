import { useEffect, useState } from 'react';
import type { Project } from '../types';
import type { EngineFeederResult, EngineProbe, StudyResults } from '../engines/types';
import { EXTERNAL_ENGINES, builtinEngine } from '../engines';
import { probeEngines } from '../engines/external';

type Key = keyof EngineFeederResult;

const COLUMNS: { key: Key; label: string; digits: number; relative: boolean; tolerance: number }[] = [
  { key: 'ib', label: 'Ib (A)', digits: 0, relative: true, tolerance: 5 },
  { key: 'vdTotalPct', label: 'Vd total (%)', digits: 2, relative: false, tolerance: 0.25 },
  { key: 'breakerFaultKA', label: 'Ik″ at breaker (kA)', digits: 1, relative: true, tolerance: 5 },
  { key: 'endFaultKA', label: 'Ik″ at cable end (kA)', digits: 1, relative: true, tolerance: 5 }
];

/** Difference of the external engine from the built-in one: percent for
 * currents, percentage points for voltage drop. */
function delta(a: number | undefined, b: number | undefined, relative: boolean): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  return relative ? ((b - a) / a) * 100 : b - a;
}

/** Signed delta; values that round to zero show as plain 0 (no "-0.0"). */
function formatDelta(d: number, digits: number): string {
  const s = d.toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return d > 0 ? `+${s}` : s;
}

export default function EngineCompare({ project }: { project: Project }) {
  const [probe, setProbe] = useState<EngineProbe | { error: string } | null>(null);
  const [engineId, setEngineId] = useState(EXTERNAL_ENGINES[0].id);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState<{ project: Project; builtin: StudyResults; external: StudyResults } | null>(null);

  useEffect(() => {
    probeEngines().then(setProbe);
  }, []);

  const probeOk = probe && !('error' in probe) ? probe : null;
  const engine = EXTERNAL_ENGINES.find((e) => e.id === engineId)!;
  const available = !!probeOk?.engines[engineId]?.available;

  async function runStudy() {
    setRunning(true);
    setError('');
    try {
      const [builtin, external] = await Promise.all([builtinEngine.run(project), engine.run(project)]);
      setRun({ project, builtin, external });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function choosePython() {
    await window.lvds.settings.choosePython();
    setProbe(null);
    setProbe(await probeEngines(true));
  }

  const hasBridge = typeof window !== 'undefined' && !!window.lvds;

  return (
    <div className="tw">
      <div className="boq-head">
        <div className="engine-controls">
          <label>
            Compare built-in with{' '}
            <select value={engineId} onChange={(e) => setEngineId(e.target.value)}>
              {EXTERNAL_ENGINES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <button className="chip primary" disabled={!available || running} onClick={runStudy}>
            {running ? 'Running…' : 'Run study'}
          </button>
        </div>
        <span className="m">
          {!probe && 'Checking Python engines…'}
          {probe && 'error' in probe && probe.error}
          {probeOk && `Python ${probeOk.python} · ${engine.name}: ${available ? probeOk.engines[engineId].version : 'not installed'}`}
          {hasBridge && (
            <button className="linkish" onClick={choosePython}>
              Choose Python…
            </button>
          )}
        </span>
      </div>

      {probeOk && !available && (
        <p className="m">
          {engine.name} isn't installed for this Python. Install it with{' '}
          <code>{engineId === 'opendss' ? 'pip install opendssdirect.py' : 'pip install pandapower'}</code>, or choose a
          different Python.
        </p>
      )}
      {error && <p className="bad">{error}</p>}

      {run && (
        <>
          {run.project !== project && <p className="warn">The project has changed since this run — run the study again.</p>}
          <table className="compare">
            <thead>
              <tr>
                <th rowSpan={2}>Circuit</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} colSpan={3}>
                    {c.label}
                  </th>
                ))}
              </tr>
              <tr>
                {COLUMNS.map((c) => [
                  <th key={`${c.key}-a`}>Built-in</th>,
                  <th key={`${c.key}-b`}>{engine.name.split(' ')[0]}</th>,
                  <th key={`${c.key}-d`}>{c.relative ? 'Δ %' : 'Δ pts'}</th>
                ])}
              </tr>
            </thead>
            <tbody>
              {run.project.feeders.map((f) => {
                const a = run.builtin.feeders[f.id] ?? {};
                const b = run.external.feeders[f.id] ?? {};
                return (
                  <tr key={f.id}>
                    <td>{f.id}</td>
                    {COLUMNS.map((c) => {
                      const d = delta(a[c.key], b[c.key], c.relative);
                      const cls = d === undefined ? '' : Math.abs(d) > c.tolerance ? 'warn' : 'ok';
                      return [
                        <td key={`${c.key}-a`}>{a[c.key]?.toFixed(c.digits) ?? '–'}</td>,
                        <td key={`${c.key}-b`}>{b[c.key]?.toFixed(c.digits) ?? '–'}</td>,
                        <td key={`${c.key}-d`} className={cls}>
                          {d === undefined ? '–' : formatDelta(d, c.relative ? 1 : 2)}
                        </td>
                      ];
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <ul className="engine-notes m">
            {run.external.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
            <li>
              Expected differences: the external engines solve the actual load flow, so currents come out a few percent
              higher than the built-in engine's nominal-voltage figure; PV feeders show a voltage rise; pandapower fault
              levels include the IEC 60909 voltage factor (c = 1.10), the built-in engine uses c = 1.
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
