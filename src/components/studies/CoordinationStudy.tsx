import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { breakerTypeOf } from '../../calc/earthing';
import TccChart from '../TccChart';
import { evaluateSelectivity } from '../../calc/protection';
import { faultCurrentKA, impedanceToBoard } from '../../calc/electrical';
import { Page, StatusCell, StatusCounts } from '../ui';

export default function CoordinationStudy({ project }: { project: Project }) {
  const incomers = project.feeders.filter((f) => f.feedsBoardId);
  const [boardId, setBoardId] = useState(incomers[0]?.feedsBoardId ?? '');
  const all = useMemo(() => evaluateSelectivity(project), [project]);

  const incomer = incomers.find((f) => f.feedsBoardId === boardId);
  const outgoing = project.feeders.filter((f) => f.boardId === boardId);
  const busFaultKA = boardId ? faultCurrentKA(impedanceToBoard(project, boardId), project.voltageV) : 0;
  const curves = incomer ? [incomer, ...outgoing] : outgoing;

  return (
    <Page
      title="Protection coordination"
      actions={<StatusCounts statuses={all.map((r) => r.status)} />}
      intro="Selectivity between each sub-board's incoming breaker and its outgoing breakers: overload selectivity needs In(up) ÷ In(down) ≥ 1.6; short-circuit selectivity is total when the upstream breaker's magnetic no-trip threshold is above the maximum fault at the downstream breaker, otherwise partial up to that threshold. The curves are generic shapes for comparison, not manufacturer data — confirm final coordination with the manufacturer's selectivity tables."
    >
      {incomers.length === 0 ? (
        <p className="m">Add a sub-board (fed through an incomer) to see coordination between breakers.</p>
      ) : (
        <>
          <label className="setting">
            Board
            <select value={boardId} onChange={(e) => setBoardId(e.target.value)}>
              {incomers.map((f) => (
                <option key={f.id} value={f.feedsBoardId}>{f.feedsBoardId} (incomer {f.id})</option>
              ))}
            </select>
          </label>
          <TccChart feeders={curves} faultKA={busFaultKA} bold={incomer?.id} label={(f, n) => `${f.id} — ${f.breakerRatingA} A ${breakerTypeOf(f)}${n === 0 && incomer ? ' (incomer)' : ''}`} />
        </>
      )}

      <table>
        <thead>
          <tr>
            <th>Upstream</th><th>Downstream</th><th>In ratio</th><th>Overload</th><th>Fault at downstream (kA)</th>
            <th>Selectivity limit (kA)</th><th>Short circuit</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {all.map((r) => (
            <tr key={`${r.upstream.id}-${r.downstream.id}`} onClick={() => setBoardId(r.upstream.feedsBoardId!)} className={r.upstream.feedsBoardId === boardId ? 'sel' : ''}>
              <td>{r.upstream.id} ({r.upstream.breakerRatingA} A)</td>
              <td>{r.downstream.id} ({r.downstream.breakerRatingA} A)</td>
              <td>{r.ratio.toFixed(2)}</td>
              <StatusCell status={r.ratioOk ? 'ok' : 'warn'}>{r.ratioOk ? '≥ 1.6' : '< 1.6'}</StatusCell>
              <td>{r.faultKA.toFixed(1)}</td>
              <td>{r.limitKA.toFixed(1)}</td>
              <StatusCell status={r.shortCircuit === 'total' ? 'ok' : 'warn'}>{r.shortCircuit === 'total' ? 'Total' : `Partial to ${r.limitKA.toFixed(1)} kA`}</StatusCell>
              <StatusCell status={r.status} />
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}
