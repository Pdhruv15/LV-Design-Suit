import type { Board } from '../types';
import type { FeederResult } from '../calc/electrical';
import { circuitRef } from '../calc/loadSchedule';

const SPACING = 138; // horizontal slot per feeder
const MARGIN = 70;

/** Single-board view: the incoming supply (transformer or incomer) drops
 * onto the centre of the busbar, and the outgoing feeders are spread evenly
 * either side of it, so the incomer always lands on the busbar whatever
 * the number of feeders. */
export default function SingleLineDiagram({
  board,
  voltageV = 415,
  incomerLabel,
  results,
  selected,
  onSelect
}: {
  board: Board;
  voltageV?: number;
  incomerLabel?: string;
  results: FeederResult[];
  selected: string | null;
  onSelect: (feederId: string) => void;
}) {
  const n = results.length;
  const width = Math.max(n, 4) * SPACING + 2 * MARGIN;
  const cx = width / 2; // incomer / transformer position
  const xs = results.map((_, i) => cx + (i - (n - 1) / 2) * SPACING);
  const busX1 = Math.min(cx - 60, (xs[0] ?? cx) - 60);
  const busX2 = Math.max(cx + 60, (xs[n - 1] ?? cx) + 60);
  const isMain = !board.upstreamId;

  return (
    <svg viewBox={`0 0 ${width} 345`} style={{ minWidth: Math.min(width, 1100), width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Single line diagram of ${board.name}`}>
      {isMain ? (
        <>
          <line x1={cx} y1="0" x2={cx} y2="17" className="ln" />
          <text className="m" x={cx + 10} y="10">
            11 kV incoming
          </text>
          <circle cx={cx} cy="30" r="13" className="tr" />
          <circle cx={cx} cy="44" r="13" className="tr" />
          <text className="b" x={cx + 22} y="32">
            TX · {board.sourceKva ?? '—'} kVA
          </text>
          <text className="m" x={cx + 22} y="46">
            11/{(voltageV / 1000).toFixed(3)} kV · Z {board.sourceImpedancePct ?? '—'}%
          </text>
          <line x1={cx} y1="57" x2={cx} y2="68" className="ln" />
          <rect x={cx - 7} y="68" width="14" height="14" className="sym" />
          <line x1={cx} y1="82" x2={cx} y2="118" className="ln" />
        </>
      ) : (
        <>
          <line x1={cx} y1="10" x2={cx} y2="102" className="ln" />
          <text className="b" x={cx + 22} y="40">
            Incomer
          </text>
          <text className="m" x={cx + 22} y="54">
            {incomerLabel ?? `from ${board.upstreamId}`}
          </text>
          <rect x={cx - 7} y="102" width="14" height="14" className="sym" />
          <line x1={cx} y1="116" x2={cx} y2="118" className="ln" />
        </>
      )}
      <text className="b" x={cx - 16} y="106" textAnchor="end" style={{ fill: 'var(--bus)' }}>
        {board.id} · {voltageV} V busbar
      </text>
      <line x1={busX1} y1="118" x2={busX2} y2="118" style={{ stroke: 'var(--bus)', strokeWidth: 4, strokeLinecap: 'round' }} />
      {results.map((r, i) => {
        const x = xs[i];
        const f = r.feeder;
        const col = `var(--${r.status})`;
        const sel = selected === f.id;
        return (
          <g key={f.id} tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onSelect(f.id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(f.id)}>
            <line x1={x} y1="118" x2={x} y2="150" className="ln" />
            <rect x={x - 6} y="150" width="12" height="20" className="sym" />
            <line x1={x - 6} y1="168" x2={x + 6} y2="152" className="ln" />
            <line x1={x} y1="170" x2={x} y2="232" className="ln" />
            <text className="b" x={x + 11} y="163">
              {f.breakerRatingA} A
            </text>
            <text className="m" x={x + 8} y="200">
              {f.cableCsaMm2}mm² · {f.lengthM}m
            </text>
            <text className="m" x={x + 8} y="213">
              Vd {r.vdTotalPct.toFixed(1)}% total
            </text>
            <rect x={x - 59} y="232" width="118" height="64" rx="6" className="box" style={sel ? { stroke: 'var(--acc)', strokeWidth: 2 } : undefined} />
            <circle cx={x + 48} cy="244" r="4" fill={col} />
            <text className="b" x={x - 51} y="251">
              {circuitRef(f) ?? f.id}
            </text>
            <text className="m" x={x - 51} y="267">
              {(() => { const n = f.room || f.name || '—'; return n.length > 19 ? n.slice(0, 18) + '…' : n; })()}
            </text>
            <text x={x - 51} y="287">
              {r.ib.toFixed(0)} A{f.feedsBoardId ? ` · → ${f.feedsBoardId}` : ` · ${(f.loadKw * f.demandFactor).toFixed(0)} kW${f.generation ? ' gen' : ''}`}
            </text>
            <rect x={x - 59} y="304" width="118" height="6" rx="3" fill="var(--line)" />
            <rect x={x - 59} y="304" width={Math.min(118, (1.18 * r.loadingPct))} height="6" rx="3" fill={col} />
            <text className="m" x={x - 59} y="328">
              {r.loadingPct.toFixed(0)}% of {f.breakerRatingA} A
            </text>
          </g>
        );
      })}
    </svg>
  );
}
