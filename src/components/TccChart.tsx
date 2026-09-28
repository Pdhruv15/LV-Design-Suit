import type { Feeder } from '../types';
import { breakerTypeOf, instantaneousTripA } from '../calc/earthing';
import { genericTripTimeS } from '../calc/protection';

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

const decades = (lo: number, hi: number) => {
  const out: number[] = [];
  for (let e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e++) out.push(Math.pow(10, e));
  return out;
};

/** Generic time-current curves (log-log) for a set of breakers, with the
 * prospective fault level. `bold` draws one curve heavier (an incomer). */
export default function TccChart({ feeders, faultKA, bold, label, compact }: {
  feeders: Feeder[];
  faultKA?: number;
  bold?: string;
  label?: (f: Feeder, i: number) => string;
  compact?: boolean;
}) {
  return (
    <div className={`tcc-wrap${compact ? ' compact' : ''}`}>
      <svg className="tcc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Time-current curves">
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
        {faultKA !== undefined && faultKA * 1000 < I_MAX && (
          <g>
            <line x1={x(faultKA * 1000)} y1={T} x2={x(faultKA * 1000)} y2={H - B} className="fault-line" />
            <text x={x(faultKA * 1000) - 4} y={T + 12} textAnchor="end" className="m">Ik″ {faultKA.toFixed(1)} kA</text>
          </g>
        )}
        {feeders.map((f, n) => (
          <path key={f.id} d={curvePath(f)} fill="none" stroke={COLORS[n % COLORS.length]} strokeWidth={f.id === bold ? 2.6 : 1.6} />
        ))}
      </svg>
      <ul className="legend">
        {feeders.map((f, n) => (
          <li key={f.id}>
            <span style={{ background: COLORS[n % COLORS.length] }} />
            {label ? label(f, n) : `${f.id} — ${f.breakerRatingA} A ${breakerTypeOf(f)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
