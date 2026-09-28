import type { Feeder, Project } from '../types';
import { breakerTypeOf } from '../calc/earthing';
import { discriminationChain } from '../calc/protection';
import { faultCurrentKA, impedanceToBoard } from '../calc/electrical';
import TccChart from './TccChart';
import { STATUS_LABEL } from './ui';

/** Discrimination along the selected feeder's supply: its breaker against
 * the one feeding its board, and so on up to the main board, with their
 * time-current curves. */
export default function DiscriminationPanel({ project, feeder }: { project: Project; feeder: Feeder }) {
  const chain = discriminationChain(project, feeder);
  if (!chain.length) {
    return (
      <div className="pn disc">
        <h3>Discrimination</h3>
        <p className="m">{feeder.id} is fed straight from a main board — no breaker above it to discriminate with.</p>
      </div>
    );
  }
  const breakers = [feeder, ...chain.map((r) => r.upstream)];
  const faultKA = faultCurrentKA(impedanceToBoard(project, feeder.boardId), project.voltageV);
  return (
    <div className="pn disc">
      <h3>Discrimination <span className="m">up to the main board</span></h3>
      <ol className="disc-chain">
        {chain.map((r) => (
          <li key={`${r.upstream.id}-${r.downstream.id}`} className={r.status}>
            <div>
              <b>{r.downstream.id}</b> {r.downstream.breakerRatingA} A {breakerTypeOf(r.downstream)} under <b>{r.upstream.id}</b> {r.upstream.breakerRatingA} A {breakerTypeOf(r.upstream)}
              <span className={`pill ${r.status}`}>{STATUS_LABEL[r.status]}</span>
            </div>
            <div className="m">
              Ratio {r.ratio.toFixed(2)} {r.ratioOk ? '≥ 1.6 (overload OK)' : '< 1.6 — overload not selective'} ·{' '}
              {r.shortCircuit === 'total'
                ? `short circuit total (limit ${r.limitKA.toFixed(1)} kA ≥ fault ${r.faultKA.toFixed(1)} kA)`
                : `short circuit partial to ${r.limitKA.toFixed(1)} kA (fault ${r.faultKA.toFixed(1)} kA)`}
            </div>
          </li>
        ))}
      </ol>
      <TccChart compact feeders={breakers} faultKA={faultKA} bold={feeder.id} label={(f) => `${f.id} — ${f.breakerRatingA} A ${breakerTypeOf(f)}`} />
      <p className="m note">Generic curve shapes: confirm with the manufacturer's selectivity tables.</p>
    </div>
  );
}
