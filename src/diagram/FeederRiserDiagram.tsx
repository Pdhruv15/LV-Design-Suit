import { useMemo } from 'react';
import type { Project } from '../types';
import { U } from './riserLayout';
import { RiserSym } from './RiserDiagram';
import { COL, feederRiserLayout, type FeederRiserLayout, type LeafSymbol } from './feederRiserLayout';

/** Board symbols of the riser schematic, from the riser's unit U (1.6U × 0.9U). */
export const LeafSym: Record<LeafSymbol, (x: number, y: number) => JSX.Element> = {
  db: (x, y) => (
    <g>
      <rect x={x - 0.8 * U} y={y - 0.45 * U} width={1.6 * U} height={0.9 * U} className="sym" />
      <path d={`M${x - 0.8 * U} ${y - 0.45 * U}L${x + 0.8 * U} ${y + 0.45 * U}M${x + 0.8 * U} ${y - 0.45 * U}L${x - 0.8 * U} ${y + 0.45 * U}`} className="ln" />
    </g>
  ),
  smdb: (x, y) => RiserSym.db(x, y),
  mcc: (x, y) => (
    <g>
      <rect x={x - 0.8 * U} y={y - 0.45 * U} width={1.6 * U} height={0.9 * U} className="sym" />
      <text x={x} y={y + 0.27 * U} textAnchor="middle" className="b fr-sym-t">M</text>
    </g>
  ),
  ups: (x, y) => (
    <g>
      <rect x={x - 0.8 * U} y={y - 0.45 * U} width={1.6 * U} height={0.9 * U} className="sym" />
      <text x={x} y={y + 0.27 * U} textAnchor="middle" className="b fr-sym-t">UPS</text>
    </g>
  )
};

/** A breaker on a vertical feeder, between y1 and y2 (an arc, IEC 60617 style). */
const breaker = (x: number, y1: number, y2: number) => <path d={`M${x} ${y1}Q${x + 0.55 * U} ${(y1 + y2) / 2} ${x} ${y2}`} className="ln" fill="none" />;

export const FEEDER_RISER_LEGEND: { key: string; label: string; draw: (x: number, y: number) => JSX.Element }[] = [
  { key: 'tx', label: 'Transformer / incoming supply', draw: (x, y) => RiserSym.tx(x, y) },
  { key: 'gen', label: 'Standby generator', draw: (x, y) => RiserSym.gen(x, y) },
  { key: 'ats', label: 'Changeover (ATS)', draw: (x, y) => RiserSym.ats(x, y) },
  { key: 'panel', label: 'Panel with busbar (MDB, EMDB, SMDB)', draw: (x, y) => <g><rect x={x - 0.8 * U} y={y - 0.45 * U} width={1.6 * U} height={0.9 * U} className="fr-panel" /><line x1={x - 0.65 * U} y1={y + 0.2 * U} x2={x + 0.65 * U} y2={y + 0.2 * U} className="fr-busbar" /></g> },
  { key: 'db', label: 'Distribution board (DB, EDB)', draw: (x, y) => LeafSym.db(x, y) },
  { key: 'smdb', label: 'Sub-main / main board (SMDB)', draw: (x, y) => LeafSym.smdb(x, y) },
  { key: 'mcc', label: 'Motor control centre (MCC, EMCC)', draw: (x, y) => LeafSym.mcc(x, y) },
  { key: 'ups', label: 'UPS board', draw: (x, y) => LeafSym.ups(x, y) },
  { key: 'bus', label: 'Busbar trunking riser', draw: (x, y) => <g className="riser-bus"><line x1={x - 0.7 * U} y1={y - 0.18 * U} x2={x + 0.7 * U} y2={y - 0.18 * U} /><line x1={x - 0.7 * U} y1={y + 0.18 * U} x2={x + 0.7 * U} y2={y + 0.18 * U} /></g> },
  { key: 'tap', label: 'Tap-off unit (TOU)', draw: (x, y) => RiserSym.tap(x, y) },
  { key: 'breaker', label: 'Circuit breaker', draw: (x, y) => <g transform={`rotate(-90 ${x} ${y})`}><line x1={x} y1={y - 0.7 * U} x2={x} y2={y - 0.4 * U} className="ln" />{breaker(x, y - 0.4 * U, y + 0.4 * U)}<line x1={x} y1={y + 0.4 * U} x2={x} y2={y + 0.7 * U} className="ln" /></g> },
  { key: 'cable', label: 'Cable', draw: (x, y) => <line x1={x - 0.7 * U} y1={y} x2={x + 0.7 * U} y2={y} className="ln" /> },
  { key: 'fr', label: 'Fire-rated cable (emergency)', draw: (x, y) => <line x1={x - 0.7 * U} y1={y} x2={x + 0.7 * U} y2={y} className="ln fr" /> },
  { key: 'standby', label: 'Standby supply', draw: (x, y) => <line x1={x - 0.7 * U} y1={y} x2={x + 0.7 * U} y2={y} className="ln riser-standby" /> }
];

export function FeederRiserLegendSvg({ used }: { used: Set<string> }) {
  const items = FEEDER_RISER_LEGEND.filter((e) => used.has(e.key));
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

/** One building's riser schematic with individual feeders (SVG). */
export default function FeederRiserDiagram({ project, buildingId, layout: given }: { project: Project; buildingId: string; layout?: FeederRiserLayout }) {
  const L = useMemo(() => given ?? feederRiserLayout(project, buildingId), [given, project, buildingId]);
  if (L.empty) return <p className="m">No panels on this building's levels yet — set each panel's Level (panel properties → Level).</p>;
  const tagW = COL - 0.6 * U;
  return (
    <div className="sysdiag riser">
      <svg viewBox={`0 0 ${L.width} ${L.height}`} width={L.width} height={L.height} data-w={L.width} data-h={L.height}>
        {L.rows.map((r, i) => (
          <g key={i}>
            <line x1={0} y1={r.yLine} x2={L.width} y2={r.yLine} className="riser-floor" />
            <text x={0.3 * U} y={r.yLine - 0.95 * U} className="b">{r.label}</text>
            <text x={0.3 * U} y={r.yLine - 0.25 * U} className="m">{r.sub}</text>
          </g>
        ))}
        {L.panels.map((p) => (
          <g key={p.board.id}>
            <title>{`${p.board.id} — ${p.board.name}`}</title>
            <rect x={p.x1} y={p.y1} width={p.x2 - p.x1} height={p.y2 - p.y1} className="fr-panel" />
            <line x1={p.x1 + 0.3 * U} y1={p.busY} x2={p.x2 - 0.3 * U} y2={p.busY} className="fr-busbar" />
            {p.lines.map((t, i) => (
              <text key={i} x={p.x1 + 0.3 * U} y={p.titleTop ? p.y1 + (0.8 + i * 0.7) * U : p.busY + (0.75 + i * 0.6) * U} className={i ? 'm' : 'b'}>{t}</text>
            ))}
          </g>
        ))}
        {L.feeders.map((f, i) => {
          const up = f.brk[1] < f.yBus || f.yTo < f.yBus;
          const [b1, b2] = f.brk;
          return (
            <g key={i}>
              <line x1={f.x} y1={f.yBus} x2={f.x} y2={b1} className={`ln${f.fireRated ? ' fr' : ''}`} />
              {b1 !== b2 && breaker(f.x, b1, b2)}
              <line x1={f.x} y1={b2} x2={f.x} y2={f.yTo} className={`ln${f.fireRated ? ' fr' : ''}`} />
              <circle cx={f.x} cy={f.yBus} r={0.12 * U} className="sym-fill" />
              {f.device.map((t, j) => (
                <text key={j} x={f.x + 0.45 * U} y={(up ? Math.min(b1, b2) : Math.min(b1, b2)) + (0.3 + j * 0.6) * U} className="m">{t}</text>
              ))}
              {f.cable && f.cableAt && (f.cableVertical
                ? <text x={f.cableAt[0]} y={f.cableAt[1]} textAnchor="middle" transform={`rotate(-90 ${f.cableAt[0]} ${f.cableAt[1]})`} className="m">{f.cable}</text>
                : <text x={f.cableAt[0]} y={f.cableAt[1]} className="m">{f.cable}</text>)}
            </g>
          );
        })}
        {L.busways.map((b) => {
          const mid = (b.y1 + b.y2) / 2;
          return (
            <g key={b.id}>
              {RiserSym.bus(b.x, b.y1, b.y2)}
              <text x={b.x - 0.45 * U} y={mid} textAnchor="middle" transform={`rotate(-90 ${b.x - 0.45 * U} ${mid})`} className="m">{b.label}</text>
              {b.taps.map((t, i) => (
                <g key={i}>
                  <polyline points={[[b.x + 0.3 * U, t.y], [t.x2, t.y], ...(t.up !== undefined ? [[t.x2, t.up]] : [])].map((q) => q.join(',')).join(' ')} className="ln" fill="none" />
                  {RiserSym.tap(b.x, t.y)}
                  <text x={b.x + 0.45 * U} y={t.y - 0.3 * U} className="m">{t.text}</text>
                </g>
              ))}
            </g>
          );
        })}
        {L.wires.map((w, i) => <polyline key={i} points={w.points.map((p) => p.join(',')).join(' ')} className={`ln${w.standby ? ' riser-standby' : ''}`} fill="none" />)}
        {L.ats.map((a, i) => <g key={i}>{RiserSym.ats(a.x, a.y)}<text x={a.x - 0.6 * U} y={a.y + 0.2 * U} textAnchor="end" className="m">ATS</text></g>)}
        {L.sources.map((s, i) => (
          <g key={i}>
            {s.kind === 'tx' ? RiserSym.tx(s.x, s.y) : RiserSym.gen(s.x, s.y)}
            <text x={s.x} y={s.y + 1.35 * U} textAnchor="middle" className="b">{s.title}</text>
            <text x={s.x} y={s.y + 2 * U} textAnchor="middle" className="m">{s.sub}</text>
          </g>
        ))}
        {L.leaves.map((n) => (
          <g key={n.board.id}>
            <title>{`${n.board.id} — ${n.board.name}`}</title>
            <rect x={n.x - tagW / 2} y={n.tagY} width={tagW} height={1.5 * U} className="fr-tag" />
            {n.lines.map((t, i) => <text key={i} x={n.x - tagW / 2 + 0.25 * U} y={n.tagY + (0.62 + i * 0.65) * U} className="m">{t}</text>)}
            {LeafSym[n.symbol](n.x, n.y)}
          </g>
        ))}
      </svg>
    </div>
  );
}
