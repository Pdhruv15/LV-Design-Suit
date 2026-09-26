import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { evaluateFeeder } from '../../calc/electrical';
import { breakerTypeOf } from '../../calc/earthing';
import { applyAllRecommendations, applyRecommendation, recommend, type SelectionMode } from '../../calc/sizing';
import { Page, StatusCell, StatusCounts } from '../ui';

/** Current vs recommended breaker (In, type, Icu) and cable for every
 * feeder, with Apply per row or for everything. */
export default function SelectionStudy({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const [mode, setMode] = useState<SelectionMode>('fix');
  const rows = useMemo(
    () => project.feeders.map((f) => ({ rec: recommend(project, f, mode), result: evaluateFeeder(project, f) })),
    [project, mode]
  );
  const pending = rows.filter((r) => r.rec.changed).length;

  const diff = (now: string | number, next: string | number | undefined) =>
    next === undefined ? <span className="bad">—</span> : next === now ? <span className="m">{next}</span> : <b className="acc">{next}</b>;

  return (
    <Page
      title="Breaker and cable selection"
      actions={
        <>
          <StatusCounts statuses={rows.map((r) => r.result.status)} />
          <div className="seg" role="radiogroup" aria-label="Selection mode">
            <button role="radio" aria-checked={mode === 'fix'} className={mode === 'fix' ? 'on' : ''} onClick={() => setMode('fix')}>Fix only</button>
            <button role="radio" aria-checked={mode === 'optimise'} className={mode === 'optimise' ? 'on' : ''} onClick={() => setMode('optimise')}>Optimise</button>
          </div>
          <button className="chip primary" disabled={!pending} onClick={() => onChange(applyAllRecommendations(project, mode))}>
            Apply all ({pending})
          </button>
        </>
      }
      intro="Fix only upsizes what fails and keeps anything already adequate; Optimise also downsizes oversized breakers, Icu ratings and cables. Criteria: breaker In ≥ Ib ÷ 0.85 (keeps loading under 85 %), Icu ≥ the fault level at the supply busbar, and the smallest cable with Iz ≥ In that keeps the total voltage drop within 85 % of the limit (incomers get a 1 % share). Apply all works top-down so each circuit sees the final upstream values."
    >
      <table>
        <thead>
          <tr>
            <th>Circuit</th><th>Ib (A)</th><th>Status now</th>
            <th>Breaker now</th><th>→ Recommended</th><th>Icu now</th><th>→</th><th>Cable now</th><th>→</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ rec, result }) => {
            const f = rec.feeder;
            return (
              <tr key={f.id}>
                <td>{f.id}</td>
                <td>{rec.ib.toFixed(0)}</td>
                <StatusCell status={result.status} />
                <td>{f.breakerRatingA} A {breakerTypeOf(f)}</td>
                <td>{diff(`${f.breakerRatingA} A ${breakerTypeOf(f)}`, rec.breakerRatingA && `${rec.breakerRatingA} A ${rec.breakerType}`)}</td>
                <td>{f.breakerIcuKa} kA</td>
                <td>{diff(`${f.breakerIcuKa} kA`, rec.breakerIcuKa && `${rec.breakerIcuKa} kA`)}</td>
                <td>{f.cableCsaMm2} mm²</td>
                <td>{diff(`${f.cableCsaMm2} mm²`, rec.cableCsaMm2 && `${rec.cableCsaMm2} mm²`)}</td>
                <td>
                  {rec.note ? (
                    <span className="warn">{rec.note}</span>
                  ) : rec.changed ? (
                    <button className="chip" onClick={() => onChange({ ...project, feeders: project.feeders.map((x) => (x.id === f.id ? applyRecommendation(x, rec) : x)) })}>
                      Apply
                    </button>
                  ) : (
                    <span className="m">Up to date</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Page>
  );
}
