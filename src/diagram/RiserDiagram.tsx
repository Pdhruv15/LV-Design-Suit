import { useMemo } from 'react';
import type { Project } from '../types';
import { riserLayout, U, ROW_H, type RiserLayout } from './riserLayout';

/** IEC 60617 symbols for the riser diagram, all from one unit U so they
 * scale together (none bigger or smaller than the others). */
export const RiserSym = {
  db: (x: number, y: number) => (
    <g>
      <rect x={x - 0.8 * U} y={y - 0.45 * U} width={1.6 * U} height={0.9 * U} className="sym" />
      <polygon points={`${x - 0.8 * U},${y + 0.45 * U} ${x + 0.8 * U},${y + 0.45 * U} ${x + 0.8 * U},${y - 0.45 * U}`} className="sym-fill" />
    </g>
  ),
  tx: (x: number, y: number) => (
    <g><circle cx={x - 0.32 * U} cy={y} r={0.5 * U} className="sym-ln" /><circle cx={x + 0.32 * U} cy={y} r={0.5 * U} className="sym-ln" /></g>
  ),
  gen: (x: number, y: number) => (
    <g><circle cx={x} cy={y} r={0.6 * U} className="sym" /><text x={x} y={y + 0.22 * U} textAnchor="middle" className="b riser-g">G</text></g>
  ),
  ats: (x: number, y: number) => (
    <g><circle cx={x - 0.35 * U} cy={y} r={0.1 * U} className="sym-fill" /><line x1={x - 0.35 * U} y1={y} x2={x + 0.3 * U} y2={y - 0.3 * U} className="ln" /><circle cx={x + 0.35 * U} cy={y} r={0.1 * U} className="sym-fill" /></g>
  ),
  tap: (x: number, y: number) => <rect x={x - 0.3 * U} y={y - 0.3 * U} width={0.6 * U} height={0.6 * U} className="sym" />,
  bus: (x: number, y1: number, y2: number) => (
    <g className="riser-bus"><line x1={x - 0.18 * U} y1={y1} x2={x - 0.18 * U} y2={y2} /><line x1={x + 0.18 * U} y1={y1} x2={x + 0.18 * U} y2={y2} /></g>
  )
};

export const RISER_LEGEND: { key: string; label: string; draw: (x: number, y: number) => JSX.Element }[] = [
  { key: 'tx', label: 'Transformer', draw: (x, y) => RiserSym.tx(x, y) },
  { key: 'gen', label: 'Standby generator', draw: (x, y) => RiserSym.gen(x, y) },
  { key: 'ats', label: 'Changeover (ATS)', draw: (x, y) => RiserSym.ats(x, y) },
  { key: 'db', label: 'Distribution board / panel', draw: (x, y) => RiserSym.db(x, y) },
  { key: 'bus', label: 'Busbar trunking riser', draw: (x, y) => <g className="riser-bus"><line x1={x - 0.7 * U} y1={y - 0.18 * U} x2={x + 0.7 * U} y2={y - 0.18 * U} /><line x1={x - 0.7 * U} y1={y + 0.18 * U} x2={x + 0.7 * U} y2={y + 0.18 * U} /></g> },
  { key: 'tap', label: 'Tap-off unit', draw: (x, y) => RiserSym.tap(x, y) },
  { key: 'cable', label: 'Cable', draw: (x, y) => <line x1={x - 0.7 * U} y1={y} x2={x + 0.7 * U} y2={y} className="ln" /> },
  { key: 'fr', label: 'Fire-rated cable', draw: (x, y) => <line x1={x - 0.7 * U} y1={y} x2={x + 0.7 * U} y2={y} className="ln fr" /> },
  { key: 'standby', label: 'Standby supply', draw: (x, y) => <line x1={x - 0.7 * U} y1={y} x2={x + 0.7 * U} y2={y} className="ln riser-standby" /> }
];

/** The riser legend on its own (the sheet's legend column). */
export function RiserLegendSvg({ used }: { used: Set<string> }) {
  const items = RISER_LEGEND.filter((e) => used.has(e.key));
  const W = 300, rowH = 1.5 * U, h = 46 + items.length * rowH;
  return (
    <div className="sysdiag riser">
      <svg viewBox={`0 0 ${W} ${h}`} width={W} height={h} data-w={W} data-h={h}>
        <g className="legend">
          <rect x="0" y="0" width={W} height={h} rx="4" className="legend-box" />
          <text x="12" y="22" className="b">LEGEND</text>
          <line x1="0" y1="32" x2={W} y2="32" className="ln" />
          {items.map((e, i) => (
            <g key={e.key}>{e.draw(34, 32 + 0.95 * U + i * rowH)}<text x="64" y={32 + 0.95 * U + i * rowH + 4} className="legend-t">{e.label}</text></g>
          ))}
        </g>
      </svg>
    </div>
  );
}

/** One building's riser diagram (SVG). */
export default function RiserDiagram({ project, buildingId, layout: given }: { project: Project; buildingId: string; layout?: RiserLayout }) {
  const L = useMemo(() => given ?? riserLayout(project, buildingId), [given, project, buildingId]);
  if (L.empty) return <p className="m">No panels on this building's levels yet — set each panel's Level (panel properties → Level).</p>;
  return (
    <div className="sysdiag riser">
      <svg viewBox={`0 0 ${L.width} ${L.height}`} width={L.width} height={L.height} data-w={L.width} data-h={L.height}>
        {L.rows.map((r, i) => (
          <g key={i}>
            <line x1={0} y1={r.y + ROW_H / 2} x2={L.width} y2={r.y + ROW_H / 2} className="riser-floor" />
            <text x={0.3 * U} y={r.y - 2} className="b">{r.label}</text>
            <text x={0.3 * U} y={r.y + 0.65 * U} className="m">{r.sub}</text>
          </g>
        ))}
        {L.buses.map((b) => (
          <g key={b.id}>
            {RiserSym.bus(b.x, b.y1, b.y2)}
            {b.taps.map((y, i) => <g key={i}><line x1={b.x + 0.3 * U} y1={y} x2={b.x + 1.0 * U} y2={y} className="ln" />{RiserSym.tap(b.x, y)}</g>)}
            <text x={b.x - 0.45 * U} y={(b.y1 + b.y2) / 2} textAnchor="middle" transform={`rotate(-90 ${b.x - 0.45 * U} ${(b.y1 + b.y2) / 2})`} className="m">{b.label}</text>
          </g>
        ))}
        {L.links.map((l, i) => (
          <g key={i}>
            <polyline points={l.points.map((p) => p.join(',')).join(' ')} className={`ln${l.fireRated ? ' fr' : ''}${l.standby ? ' riser-standby' : ''}`} fill="none" />
            {l.label && (l.vertical
              ? <text x={l.labelAt[0]} y={l.labelAt[1]} textAnchor="middle" transform={`rotate(-90 ${l.labelAt[0]} ${l.labelAt[1]})`} className="m">{l.label}</text>
              : <text x={l.labelAt[0]} y={l.labelAt[1]} textAnchor="middle" className="m">{l.label}</text>)}
          </g>
        ))}
        {L.sources.map((s, i) => (
          <g key={i}>
            {s.kind === 'tx' ? RiserSym.tx(s.x, s.y) : RiserSym.gen(s.x, s.y)}
            <text x={s.x} y={s.y + (s.kind === 'tx' ? -0.75 : 1.05) * U} textAnchor="middle" className="b">{s.title}</text>
            <text x={s.x} y={s.y + (s.kind === 'tx' ? 1.05 : 1.6) * U} textAnchor="middle" className="m">{s.sub}</text>
          </g>
        ))}
        {L.ats.map((a, i) => <g key={i}>{RiserSym.ats(a.x, a.y)}<text x={a.x} y={a.y - 0.5 * U} textAnchor="middle" className="m">ATS</text></g>)}
        {L.nodes.map((n) => (
          <g key={n.board.id}>
            <title>{`${n.board.id} — ${n.board.name}`}</title>
            {RiserSym.db(n.x, n.y)}
            <text x={n.x + 1.0 * U} y={n.y - 2} className="b">{n.title}{n.count ? ` ×${n.count}` : ''}</text>
            <text x={n.x + 1.0 * U} y={n.y + 0.6 * U} className="m">{n.sub}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
