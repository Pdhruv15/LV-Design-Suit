import { useMemo, useState } from 'react';
import type { Feeder, Project } from '../../types';
import { breakerTypeOf, instantaneousTripA } from '../../calc/earthing';
import { evaluateSelectivity, genericTripTimeS } from '../../calc/protection';
import { faultCurrentKA, impedanceToBoard } from '../../calc/electrical';
import { Page, StatusCell, StatusCounts } from '../ui';

const COLORS = ['#4aa8ff', '#b784ff', '#37d6c6', '#ff8fb1', '#9fd356', '#f5c04a', '#ff9f43', '#7fd1ff'];

// Chart ranges (log-log) and plot box.
const I_MIN = 10, I_MAX = 100000, T_MIN = 0.01, T_MAX = 10000;
const W = 640, H = 420, L = 56, R = 16, T = 12, B = 40;
const x = (i: number) => L + ((Math.log10(i) - Math.log10(I_MIN)) / (Math.log10(I_MAX) - Math.log10(I_MIN))) * (W - L - R);
const y = (t: number) => T + ((Math.log10(T_MAX) - Math.log10(t)) / (Math.log10(T_MAX) - Math.log10(T_MIN))) * (H - T - B);
const clampT = (t: number) => Math.min(Math.max(t, T_MIN), T_MAX);

function curvePath(f: Feeder): string {
  const im = instantaneousTripA(f);
  const pts: [number, number][] = [];
  const start = f.breakerRatingA * 1.06;
  for (let k = 0; k <= 60; k++) {
    const i = start * Math.pow(im / start, k / 60);
    if (i >= im) break;
    pts.push([i, clampT(genericTripTimeS(f, i, im))]);
  }
  pts.push([im, clampT(genericTripTimeS(f, im * 0.999, im))], [im, 0.02], [I_MAX, 0.02]);
  return pts
    .filter(([i]) => i >= I_MIN && i <= I_MAX)
    .map(([i, t], n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)} ${y(t).toFixed(1)}`)
    .join(' ');
}

export default function CoordinationStudy({ project }: { project: Project }) {
  const incomers = project.feeders.filter((f) => f.feedsBoardId);
  const [boardId, setBoardId] = useState(incomers[0]?.feedsBoardId ?? '');
  const all = useMemo(() => evaluateSelectivity(project), [project]);

  const incomer = incomers.find((f) => f.feedsBoardId === boardId);
  const outgoing = project.feeders.filter((f) => f.boardId === boardId);
  const busFaultKA = boardId ? faultCurrentKA(impedanceToBoard(project, boardId), project.voltageV) : 0;
  const curves = incomer ? [incomer, ...outgoing] : outgoing;

  const decades = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e++) out.push(Math.pow(10, e));
    return out;
  };

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
          <div className="tcc-wrap">
            <svg className="tcc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Time-current curves for ${boardId}`}>
              {decades(I_MIN, I_MAX).map((i) => (
                <g key={`x${i}`}>
                  <line x1={x(i)} y1={T} x2={x(i)} y2={H - B} className="grid" />
                  <text x={x(i)} y={H - B + 16} textAnchor="middle" className="m">{i >= 1000 ? `${i / 1000}k` : i}</text>
                </g>
              ))}
              {decades(T_MIN, T_MAX).map((t) => (
                <g key={`y${t}`}>
                  <line x1={L} y1={y(t)} x2={W - R} y2={y(t)} className="grid" />
                  <text x={L - 6} y={y(t) + 4} textAnchor="end" className="m">{t < 1 ? t : t.toLocaleString()}</text>
                </g>
              ))}
              <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="m">Current (A)</text>
              <text x={14} y={(T + H - B) / 2} textAnchor="middle" className="m" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>Time (s)</text>
              {busFaultKA * 1000 < I_MAX && (
                <g>
                  <line x1={x(busFaultKA * 1000)} y1={T} x2={x(busFaultKA * 1000)} y2={H - B} className="fault-line" />
                  <text x={x(busFaultKA * 1000) - 4} y={T + 12} textAnchor="end" className="m">Ik″ {busFaultKA.toFixed(1)} kA</text>
                </g>
              )}
              {curves.map((f, n) => (
                <path key={f.id} d={curvePath(f)} fill="none" stroke={COLORS[n % COLORS.length]} strokeWidth={n === 0 && incomer ? 2.6 : 1.6} />
              ))}
            </svg>
            <ul className="legend">
              {curves.map((f, n) => (
                <li key={f.id}>
                  <span style={{ background: COLORS[n % COLORS.length] }} />
                  {f.id} — {f.breakerRatingA} A {breakerTypeOf(f)}
                  {n === 0 && incomer ? ' (incomer)' : ''}
                </li>
              ))}
            </ul>
          </div>
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
