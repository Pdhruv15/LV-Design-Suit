import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import type { FeederResult, Status } from '../calc/electrical';
import { boardSummary, loadTypeOf } from '../calc/summary';
import { boardPhaseKw } from '../calc/loadSchedule';
import { LEVEL_H, layoutSystem } from '../diagram/layout';
import LoadIcon from './LoadIcon';
import type { Annotations, ResultLayers } from '../diagram/annotations';

interface Tag {
  text: string;
  cls: string;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const worst = (statuses: (Status | undefined)[]): Status =>
  statuses.includes('bad') ? 'bad' : statuses.includes('warn') ? 'warn' : 'ok';

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Whole-network single line diagram: utility → transformer → main board →
 * sub-boards → loads. Wheel to zoom, drag to pan; click a board or a load to
 * select it, double-click to edit it. Optional result labels (current,
 * voltage, voltage drop, fault level, power factor, loading) are printed
 * next to each board and feeder. */
export default function SystemDiagram({
  project,
  results,
  selectedFeederId,
  selectedBoardId,
  onSelectFeeder,
  onSelectBoard,
  tool = 'select',
  annotations,
  layers,
  onEditFeeder,
  onEditBoard,
  onOpenSchedule
}: {
  project: Project;
  results: FeederResult[];
  selectedFeederId: string | null;
  selectedBoardId: string | null;
  onSelectFeeder: (id: string) => void;
  onSelectBoard: (id: string) => void;
  /** 'pan': dragging and clicking never select anything. */
  tool?: 'select' | 'pan';
  annotations?: Annotations;
  layers?: ResultLayers;
  onEditFeeder?: (id: string) => void;
  onEditBoard?: (id: string) => void;
  /** Opens a DB's load schedule (double-click on a collapsed circuit block). */
  onOpenSchedule?: (boardId: string) => void;
}) {
  const feederTags = (id: string): Tag[] => {
    const a = annotations?.feeders[id];
    if (!a || !layers) return [];
    const t: (Tag | false)[] = [
      layers.current && a.currentA !== undefined && { text: `${a.currentA.toFixed(0)} A`, cls: 'r-cur' },
      layers.vd && a.vdTotalPct !== undefined && { text: `ΔV ${a.vdTotalPct.toFixed(2)}%`, cls: a.vdStatus ?? '' },
      layers.fault && a.faultKA !== undefined && { text: `Ik ${a.faultKA.toFixed(1)} kA`, cls: 'r-fault' },
      layers.pf && a.pf !== undefined && { text: `PF ${a.pf.toFixed(2)}`, cls: 'r-pf' },
      layers.loading && a.loadingPct !== undefined && { text: `${a.loadingPct.toFixed(0)}% of In`, cls: a.loadingStatus ?? '' }
    ];
    return t.filter((x): x is Tag => !!x);
  };
  const boardTags = (id: string): Tag[] => {
    const a = annotations?.boards[id];
    if (!a || !layers) return [];
    const t: (Tag | false)[] = [
      layers.voltage && a.voltageV !== undefined && { text: `${a.voltageV.toFixed(0)} V · ${a.voltagePct!.toFixed(1)}%`, cls: a.voltageStatus ?? '' },
      layers.fault && a.faultKA !== undefined && { text: `Ik″ ${a.faultKA.toFixed(1)} kA`, cls: 'r-fault' },
      layers.pf && a.pf !== undefined && { text: `PF ${a.pf.toFixed(2)}`, cls: 'r-pf' }
    ];
    return t.filter((x): x is Tag => !!x);
  };
  const edit = (fn?: (id: string) => void, id?: string) => () => {
    if (tool !== 'pan' && fn && id) fn(id);
  };
  const layout = useMemo(() => layoutSystem(project), [project]);
  const byFeeder = useMemo(() => new Map(results.map((r) => [r.feeder.id, r])), [results]);
  const summaries = useMemo(() => new Map(project.boards.map((b) => [b.id, boardSummary(project, b)])), [project]);

  const full: ViewBox = { x: 0, y: 0, w: layout.width, h: layout.height };
  const [vb, setVb] = useState<ViewBox>(full);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; vb: ViewBox; moved: boolean } | null>(null);

  // Re-fit when the network's overall size changes (boards/feeders added).
  useEffect(() => setVb({ x: 0, y: 0, w: layout.width, h: layout.height }), [layout.width, layout.height]);

  function zoom(factor: number, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) {
    setVb((v) => {
      const w = Math.min(Math.max(v.w * factor, 200), layout.width * 3);
      const h = (w / v.w) * v.h;
      return { x: cx - ((cx - v.x) * w) / v.w, y: cy - ((cy - v.y) * h) / v.h, w, h };
    });
  }

  // Native (non-passive) wheel listener so the page doesn't scroll while zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setVb((v) => {
        const scale = Math.max(v.w / r.width, v.h / r.height);
        const cx = v.x + (e.clientX - r.left - (r.width - v.w / scale) / 2) * scale;
        const cy = v.y + (e.clientY - r.top - (r.height - v.h / scale) / 2) * scale;
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const w = Math.min(Math.max(v.w * factor, 200), layout.width * 3);
        const h = (w / v.w) * v.h;
        return { x: cx - ((cx - v.x) * w) / v.w, y: cy - ((cy - v.y) * h) / v.h, w, h };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [layout.width]);

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { px: e.clientX, py: e.clientY, vb, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const el = svgRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) el.setPointerCapture(e.pointerId);
    d.moved = true;
    const r = el.getBoundingClientRect();
    const scale = Math.max(d.vb.w / r.width, d.vb.h / r.height);
    setVb({ ...d.vb, x: d.vb.x - dx * scale, y: d.vb.y - dy * scale });
  }
  function onPointerUp() {
    // Keep the flag until the click event has fired, so a drag isn't a click.
    setTimeout(() => (drag.current = null), 0);
  }
  const click = (fn: () => void) => () => {
    if (!drag.current?.moved && tool !== 'pan') fn();
  };

  const main = layout.roots[0];

  return (
    <div className={`sysdiag ${tool === 'pan' ? 'pan' : ''}`}>
      <div className="sysdiag-tools" role="toolbar" aria-label="Diagram zoom">
        <button className="chip" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in">+</button>
        <button className="chip" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
        <button className="chip" onClick={() => setVb(full)}>Fit</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        role="img"
        aria-label={`Single line diagram of ${project.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* Utility and transformers */}
        {main && (
          <g>
            <circle cx={layout.utilityX} cy="22" r="11" className="sym" />
            <path d={`M${layout.utilityX - 5} 22 q2.5 -6 5 0 t5 0`} className="ln" />
            <text className="b" x={layout.utilityX + 18} y="20">Utility</text>
            <text className="m" x={layout.utilityX + 18} y="34">11 kV</text>
            {layout.roots.length > 1 && (
              <line x1={layout.roots[0].x} y1="50" x2={layout.roots[layout.roots.length - 1].x} y2="50" className="ln mv" />
            )}
            <line x1={layout.utilityX} y1="33" x2={layout.utilityX} y2="50" className="ln mv" />
          </g>
        )}
        {layout.roots.map((r) => (
          <g key={`tx-${r.board.id}`} className="tx" onDoubleClick={edit(onEditBoard, r.board.id)}>
            <title>Double-click to edit the transformer</title>
            <line x1={r.x} y1="50" x2={r.x} y2="70" className="ln mv" />
            <circle cx={r.x} cy="84" r="14" className="tr" />
            <circle cx={r.x} cy="100" r="14" className="tr" />
            <text className="b" x={r.x + 24} y="86">Transformer</text>
            <text className="m" x={r.x + 24} y="100">
              {r.board.sourceKva ? `${r.board.sourceKva} kVA · ${r.board.sourceImpedancePct ?? '—'}% Z` : 'no source data'}
            </text>
            <line x1={r.x} y1="114" x2={r.x} y2={r.busY - 58} className="ln" />
            <text className="m" x={r.x - 8} y={r.busY - 72} textAnchor="end">{project.voltageV} V</text>
          </g>
        ))}

        {/* Feeders: breaker, cable, then a load or a drop to a sub-board */}
        {layout.feeders.map((n) => {
          const f = n.feeder;
          const r = byFeeder.get(f.id);
          const status = r?.status ?? 'ok';
          const sel = f.id === selectedFeederId;
          const y = n.busY;
          const endY = n.childBoardId ? y + LEVEL_H - 58 : y + 76;
          return (
            <g
              key={f.id}
              className={`fd ${sel ? 'sel' : ''}`}
              onClick={click(() => onSelectFeeder(f.id))}
              onDoubleClick={edit(onEditFeeder, f.id)}
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' ? onSelectFeeder(f.id) : e.key === 'F2' && edit(onEditFeeder, f.id)())}
            >
              <title>{`${f.id} — double-click to edit`}</title>
              <line x1={n.x} y1={y} x2={n.x} y2={y + 18} className="ln" />
              <rect x={n.x - 6} y={y + 18} width="12" height="16" className="sym" />
              <line x1={n.x - 5} y1={y + 32} x2={n.x + 5} y2={y + 20} className="ln" />
              <line x1={n.x} y1={y + 34} x2={n.x} y2={endY} className={`ln ${status !== 'ok' ? status : ''}`} />
              <text className="b" x={n.x + 10} y={y + 30}>{f.breakerRatingA} A</text>
              <text className="m" x={n.x + 7} y={y + 52}>{f.cableCsaMm2}mm² · {f.lengthM}m</text>
              {!n.childBoardId && (
                <>
                  <circle cx={n.x} cy={y + 94} r="18" className={`load ${status}`} />
                  <g transform={`translate(${n.x} ${y + 94})`} className={`icon ${status}`}>
                    <LoadIcon type={loadTypeOf(f)} />
                  </g>
                  <text className="b" x={n.x} y={y + 132} textAnchor="middle">{trunc(f.id, 16)}</text>
                  <text className="m" x={n.x} y={y + 146} textAnchor="middle">{trunc(f.name, 19)}</text>
                  <text x={n.x} y={y + 160} textAnchor="middle">
                    {(f.loadKw * f.demandFactor).toFixed(0)} kW{f.generation ? ' gen' : ''}
                    {!layers?.current && ` · ${r ? r.ib.toFixed(0) : '–'} A`}
                  </text>
                  {feederTags(f.id).map((t, i) => (
                    <text key={t.text} x={n.x} y={y + 177 + i * 13} textAnchor="middle" className={`res ${t.cls}`}>{t.text}</text>
                  ))}
                  <circle cx={n.x + 22} cy={y + 78} r="4" style={{ fill: `var(--${status})` }} />
                </>
              )}
              {n.childBoardId &&
                feederTags(f.id).map((t, i) => (
                  <text key={t.text} x={n.x + 7} y={y + 72 + i * 13} className={`res ${t.cls}`}>{t.text}</text>
                ))}
              {sel && <rect x={n.x - 60} y={y + 8} width="120" height={n.childBoardId ? 50 : 160} rx="8" className="sel-ring" />}
            </g>
          );
        })}

        {/* DBs with many final circuits: one block per DB */}
        {layout.blocks.map((blk) => {
          const y = blk.busY;
          const kw = blk.circuits.reduce((s, f) => s + f.loadKw * f.demandFactor, 0);
          const ph = boardPhaseKw({ ...project, feeders: blk.circuits }, blk.boardId);
          const statuses = blk.circuits.map((f) => byFeeder.get(f.id)?.status);
          const status = worst(statuses);
          const failing = statuses.filter((s) => s !== 'ok').length;
          return (
            <g key={`blk-${blk.boardId}`} className="fd blk" onClick={click(() => onSelectBoard(blk.boardId))} onDoubleClick={edit(onOpenSchedule, blk.boardId)} tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onOpenSchedule?.(blk.boardId)}>
              <title>{`${blk.circuits.length} final circuits — double-click to open the load schedule`}</title>
              <line x1={blk.x} y1={y} x2={blk.x} y2={y + 30} className="ln" />
              <rect x={blk.x - 54} y={y + 36} width="108" height="92" rx="7" className="box stack" />
              <rect x={blk.x - 58} y={y + 32} width="108" height="92" rx="7" className={`box ${status !== 'ok' ? status : ''}`} />
              <text className="b" x={blk.x - 4} y={y + 54} textAnchor="middle">{blk.circuits.length} circuits</text>
              <text x={blk.x - 4} y={y + 70} textAnchor="middle">{kw.toFixed(1)} kW</text>
              <text className="m" x={blk.x - 4} y={y + 86} textAnchor="middle">R {ph.R.toFixed(1)} · Y {ph.Y.toFixed(1)}</text>
              <text className="m" x={blk.x - 4} y={y + 99} textAnchor="middle">B {ph.B.toFixed(1)} kW</text>
              <text x={blk.x - 4} y={y + 115} textAnchor="middle" className={`res ${failing ? status : 'm'}`}>{failing ? `${failing} to check` : 'open schedule ›'}</text>
            </g>
          );
        })}

        {/* Boards: box on the incoming line, then the busbar */}
        {layout.boards.map((n) => {
          const b = n.board;
          const s = summaries.get(b.id)!;
          const status = worst([s.loadingStatus, ...project.feeders.filter((f) => f.boardId === b.id).map((f) => byFeeder.get(f.id)?.status)]);
          const sel = b.id === selectedBoardId;
          return (
            <g
              key={b.id}
              className={`bd ${sel ? 'sel' : ''}`}
              onClick={click(() => onSelectBoard(b.id))}
              onDoubleClick={edit(onEditBoard, b.id)}
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' ? onSelectBoard(b.id) : e.key === 'F2' && edit(onEditBoard, b.id)())}
            >
              <title>{`${b.id} — double-click to edit`}</title>
              <line x1={n.busX1} y1={n.busY} x2={n.busX2} y2={n.busY} className={`bus ${sel ? 'sel' : ''}`} />
              <line x1={n.x} y1={n.busY - 22} x2={n.x} y2={n.busY} className="ln" />
              <rect x={n.x - 62} y={n.busY - 58} width="124" height="36" rx="6" className="box" style={sel ? { stroke: 'var(--acc)', strokeWidth: 2 } : undefined} />
              <text className="b" x={n.x - 54} y={n.busY - 42}>{trunc(b.id, 14)}</text>
              <text className="m" x={n.x - 54} y={n.busY - 28}>
                {b.kind ?? (b.upstreamId ? 'DB' : 'MDB')}
                {b.ratedCurrentA ? ` · ${b.ratedCurrentA} A` : ''}
              </text>
              <circle cx={n.x + 52} cy={n.busY - 46} r="4" style={{ fill: `var(--${status})` }} />
              {[
                ...boardTags(b.id),
                ...(s.loadingPct !== undefined ? [{ text: `${s.loadingPct.toFixed(0)}% loaded`, cls: layers?.loading ? s.loadingStatus ?? 'm' : 'm' }] : [])
              ].map((t, i) => (
                <text key={t.text} x={n.x + 68} y={n.busY - 47 + i * 13} className={`res ${t.cls}`}>{t.text}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
