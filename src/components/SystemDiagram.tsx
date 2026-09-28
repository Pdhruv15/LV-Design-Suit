import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import type { FeederResult, Status } from '../calc/electrical';
import { boardSummary, loadTypeOf } from '../calc/summary';
import { boardPhaseKw } from '../calc/loadSchedule';
import { LEVEL_H, layoutSystem } from '../diagram/layout';
import LoadIcon from './LoadIcon';
import type { Annotations, ResultLayers } from '../diagram/annotations';
import { canDrop, canMove, type DropTarget, type MoveItem, type PaletteItem } from '../model/sldEdit';
import { cables } from '../calc/cableTable';
import { upsLoadingPct } from '../calc/sizing';
import { isMotor, starterInfo, starterOf } from '../calc/motor';
import { runsOf, upstreamVoltageDropPct } from '../calc/electrical';
import { MOTOR_START_DIP_LIMIT_PCT, type GeneratorRun } from '../calc/scenario';
import { boardRatio, COLOR_BY, earthRatio, feederRatio, heatColor, type ColorBy } from '../diagram/heatmap';
import { evaluateEarthingAll } from '../calc/earthing';
import type { Feeder } from '../types';
import { getDragItem, setDragItem } from '../diagram/dragItem';

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
  onOpenSchedule,
  onDropItem,
  onMoveItem,
  onPatchFeeder,
  colorBy = 'none',
  scenario,
  chain
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
  /** Opens a DB's load schedule (double-click on the DB's circuit summary). */
  onOpenSchedule?: (boardId: string) => void;
  /** Drag and drop from the equipment library; the diagram only reports
   * where an item was dropped. */
  onDropItem?: (item: PaletteItem, target: DropTarget) => void;
  /** A load or board picked up on the diagram and dropped on a target. */
  onMoveItem?: (item: MoveItem, target: DropTarget) => void;
  /** Quick edit of a feeder's cable from its label. */
  onPatchFeeder?: (feederId: string, patch: Partial<Feeder>) => void;
  /** Colour cables and busbars by a result. */
  colorBy?: ColorBy;
  /** Generator mode: the network as it runs on the standby generators.
   * Everything else is drawn dimmed; results must be for this network. */
  scenario?: { project: Project; energized: Set<string>; generators: GeneratorRun[] };
  /** Breakers in the selected feeder's discrimination chain, by status. */
  chain?: Map<string, Status>;
}) {
  const feederTags = (id: string): Tag[] => {
    // Earth fault loop colouring: Zs against its limit on every feeder.
    const e = earthing?.get(id);
    const earthTag: Tag[] = e ? [{ text: `Zs ${e.zsOhm.toFixed(2)} / ${e.maxZsOhm.toFixed(2)} Ω`, cls: e.status }] : [];
    const a = annotations?.feeders[id];
    if (!a || !layers) return earthTag;
    const t: (Tag | false)[] = [
      layers.current && a.currentA !== undefined && { text: `${a.currentA.toFixed(0)} A`, cls: 'r-cur' },
      layers.vd && a.vdTotalPct !== undefined && { text: `ΔV ${a.vdTotalPct.toFixed(2)}%`, cls: a.vdStatus ?? '' },
      layers.fault && a.faultKA !== undefined && { text: `Ik ${a.faultKA.toFixed(1)} kA`, cls: 'r-fault' },
      layers.pf && a.pf !== undefined && { text: `PF ${a.pf.toFixed(2)}`, cls: 'r-pf' },
      layers.loading && a.loadingPct !== undefined && { text: `${a.loadingPct.toFixed(0)}% of In`, cls: a.loadingStatus ?? '' }
    ];
    return [...t.filter((x): x is Tag => !!x), ...earthTag];
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
  // Board loading and voltage come from the network that is running: the
  // generator scenario in generator mode.
  const running = scenario?.project ?? project;
  const summaries = useMemo(
    () => new Map(project.boards.map((b) => {
      const live = scenario ? scenario.project.boards.find((x) => x.id === b.id) : undefined;
      return [b.id, live ? boardSummary(scenario!.project, live) : boardSummary(project, b)];
    })),
    [project, scenario]
  );
  const off = (boardId: string) => !!scenario && !scenario.energized.has(boardId);
  const earthing = useMemo(
    () => (colorBy === 'earth' ? new Map(evaluateEarthingAll(running).map((e) => [e.feeder.id, e])) : undefined),
    [colorBy, running]
  );
  const feederHeat = (id: string) => {
    const r = byFeeder.get(id);
    const e = earthing?.get(id);
    const ratio = colorBy === 'earth' ? (e ? earthRatio(e) : undefined) : r && colorBy !== 'none' ? feederRatio(r, colorBy, project.vdLimitPct) : undefined;
    return ratio === undefined ? undefined : heatColor(ratio);
  };
  const boardHeat = (id: string) => {
    const s = summaries.get(id);
    if (!s || colorBy === 'none' || off(id)) return undefined;
    const ratio = boardRatio(s, upstreamVoltageDropPct(running, id), colorBy, project.vdLimitPct);
    return ratio === undefined ? undefined : heatColor(ratio);
  };

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

  // Moving what's on the diagram: press on a load, board or incomer and drag
  // it to a busbar (reconnect) or onto another feeder (place before it).
  // Dragging the empty background still pans.
  const pick = useRef<{ item: MoveItem; label: string; px: number; py: number } | null>(null);
  const [moving, setMoving] = useState<{ label: string; x: number; y: number } | null>(null);
  const [cableEdit, setCableEdit] = useState<{ id: string; x: number; y: number; size: string; cores: string; length: string; runs: string } | null>(null);
  const lengthOk = (v: string) => /^\d*\.?\d+$/.test(v.trim().replace(',', '.')) && Number(v.trim().replace(',', '.')) > 0;
  const saveCable = () => {
    if (!cableEdit || !onPatchFeeder || !lengthOk(cableEdit.length)) return;
    // Only sizes from the cable table and 2/3/4 cores: anything else would break every calculation.
    if (!cables().some((c) => c.csaMm2 === Number(cableEdit.size)) || !['2', '3', '4'].includes(cableEdit.cores)) return;
    onPatchFeeder(cableEdit.id, { cableCsaMm2: Number(cableEdit.size), cores: Number(cableEdit.cores) as 2 | 3 | 4, lengthM: Number(cableEdit.length.trim().replace(',', '.')), parallel: Number(cableEdit.runs) > 1 ? Number(cableEdit.runs) : undefined });
    setCableEdit(null);
  };
  const startPick = (item: MoveItem, label: string) => (e: React.PointerEvent) => {
    if (!onMoveItem || tool === 'pan' || e.button !== 0) return;
    pick.current = { item, label, px: e.clientX, py: e.clientY };
  };
  const targetAt = (x: number, y: number): { target: DropTarget; key: string } | undefined => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]');
    const key = el?.getAttribute('data-drop');
    if (!key) return undefined;
    const id = key.slice(key.indexOf(':') + 1);
    return { key, target: key.startsWith('bus:') ? { type: 'bus', boardId: id } : { type: 'feeder', feederId: id } };
  };

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { px: e.clientX, py: e.clientY, vb, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const pk = pick.current;
    const svg = svgRef.current;
    if (pk && svg) {
      if (!moving && Math.hypot(e.clientX - pk.px, e.clientY - pk.py) < 6) return;
      if (!moving) svg.setPointerCapture(e.pointerId);
      if (drag.current) drag.current.moved = true; // not a click
      const t = targetAt(e.clientX, e.clientY);
      const ok = t && canMove(project, pk.item, t.target) ? t.key : null;
      if (ok !== hover) setHover(ok);
      const r = svg.parentElement!.getBoundingClientRect();
      setMoving({ label: pk.label, x: e.clientX - r.left, y: e.clientY - r.top });
      return;
    }
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
  function onPointerUp(e: React.PointerEvent) {
    const pk = pick.current;
    pick.current = null;
    if (pk && moving) {
      const t = targetAt(e.clientX, e.clientY);
      setMoving(null);
      setHover(null);
      if (t && canMove(project, pk.item, t.target)) onMoveItem?.(pk.item, t.target);
    }
    // Keep the flag until the click event has fired, so a drag isn't a click.
    setTimeout(() => (drag.current = null), 0);
  }
  // Drag and drop: a busbar, a feeder or the empty canvas highlights while
  // an item that can go there is dragged over it.
  const [hover, setHover] = useState<string | null>(null);
  const dnd = (target: DropTarget, key: string) =>
    onDropItem
      ? {
          onDragOver: (e: React.DragEvent) => {
            const item = getDragItem();
            if (!item) return;
            e.stopPropagation(); // the nearest target decides; never fall through to the canvas
            if (!canDrop(project, item, target)) {
              if (hover) setHover(null);
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (hover !== key) setHover(key);
          },
          onDrop: (e: React.DragEvent) => {
            const item = getDragItem();
            if (!item) return;
            e.preventDefault();
            e.stopPropagation();
            setHover(null);
            setDragItem(null);
            onDropItem(item, target);
          }
        }
      : {};
  const dropCls = (key: string) => (hover === key ? ' drop-ok' : '');

  const click = (fn: () => void) => () => {
    if (!drag.current?.moved && tool !== 'pan') fn();
  };

  const main = layout.roots[0];

  return (
    <div className={`sysdiag ${tool === 'pan' ? 'pan' : ''}${dropCls('canvas')}`}>
      <div className="sysdiag-tools" role="toolbar" aria-label="Diagram zoom">
        <button className="chip" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in">+</button>
        <button className="chip" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
        <button className="chip" onClick={() => setVb(full)}>Fit</button>
      </div>
      <svg
        ref={svgRef}
        data-w={layout.width}
        data-h={layout.height}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        role="img"
        aria-label={`Single line diagram of ${project.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        {...dnd({ type: 'canvas' }, 'canvas')}
        onDragLeave={(e) => { if (!svgRef.current?.contains(e.relatedTarget as Node)) setHover(null); }}
      >
        {/* Utility and transformers */}
        {main && layout.roots.some((r) => r.board.sourceKva) && (
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
        {layout.roots.map((r) => !r.board.sourceKva && r.board.supply ? (
          <g key={`sup-${r.board.id}`} className="tx" onDoubleClick={edit(onEditBoard, r.board.id)}>
            <title>Supply from the authority — double-click to edit</title>
            <rect x={r.x - 16} y={52} width={32} height={26} rx={3} className="sym" />
            <text className="b" x={r.x} y={69} textAnchor="middle" style={{ fontSize: 10 }}>kWh</text>
            <text className="b" x={r.x + 24} y="62">{r.board.supply.fedFrom ?? 'DEWA'} supply</text>
            <text className="m" x={r.x + 24} y="76">{r.board.supply.ratingA ? `${r.board.supply.ratingA} A ${r.board.supply.device ?? ''}` : 'meter cabinet'}{r.board.supply.meter ? ` · ${r.board.supply.meter} meter` : ''}</text>
            <line x1={r.x} y1="34" x2={r.x} y2="52" className="ln" />
            <line x1={r.x} y1="78" x2={r.x} y2={r.busY - 58} className="ln" />
            <text className="m" x={r.x - 8} y={r.busY - 72} textAnchor="end">{project.voltageV} V</text>
          </g>
        ) : (
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
              className={`fd ${sel ? 'sel' : ''}${dropCls(`fd:${f.id}`)}${off(f.boardId) ? ' off' : ''}`}
              {...dnd({ type: 'feeder', feederId: f.id }, `fd:${f.id}`)}
              data-drop={`fd:${f.id}`}
              onPointerDown={startPick(n.childBoardId ? { kind: 'board', id: n.childBoardId } : { kind: 'feeder', id: f.id }, n.childBoardId ?? f.name ?? f.id)}
              onClick={click(() => onSelectFeeder(f.id))}
              onDoubleClick={edit(onEditFeeder, f.id)}
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' ? onSelectFeeder(f.id) : e.key === 'F2' && edit(onEditFeeder, f.id)())}
            >
              <title>{`${f.id} — double-click to edit`}</title>
              <line x1={n.x} y1={y} x2={n.x} y2={y + 18} className="ln" />
              <rect x={n.x - 6} y={y + 18} width="12" height="16" className="sym" />
              {chain?.has(f.id) && (
                <rect x={n.x - 11} y={y + 13} width="22" height="26" rx="4" className={`disc-ring ${chain.get(f.id)}`}>
                  <title>{`Discrimination: ${chain.get(f.id) === 'ok' ? 'selective' : chain.get(f.id) === 'warn' ? 'partial' : 'not selective'}`}</title>
                </rect>
              )}
              <line x1={n.x - 5} y1={y + 32} x2={n.x + 5} y2={y + 20} className="ln" />
              <line x1={n.x} y1={y + 34} x2={n.x} y2={endY} className={`ln ${status !== 'ok' ? status : ''}`}
                style={feederHeat(f.id) ? { stroke: feederHeat(f.id), strokeWidth: 3.5 } : undefined} />
              <text className="b" x={n.x + 10} y={y + 30}>{f.breakerRatingA} A</text>
              <text
                className={`m${onPatchFeeder ? ' cable-lbl' : ''}`}
                x={n.x + 7}
                y={y + 52}
                onPointerDown={(e) => onPatchFeeder && e.stopPropagation()}
                onClick={(e) => {
                  if (!onPatchFeeder || tool === 'pan') return;
                  e.stopPropagation();
                  const r = svgRef.current!.parentElement!.getBoundingClientRect();
                  setCableEdit({ id: f.id, x: e.clientX - r.left, y: e.clientY - r.top, size: String(f.cableCsaMm2), cores: String(f.cores), length: String(f.lengthM), runs: String(runsOf(f)) });
                }}
              >
                {onPatchFeeder && <title>Click to change the cable</title>}
                {runsOf(f) > 1 ? `${runsOf(f)}×` : ''}{f.cores}C × {f.cableCsaMm2}mm² · {f.lengthM}m
              </text>
              {!n.childBoardId && (
                <>
                  <circle cx={n.x} cy={y + 94} r="18" className={`load ${status}`} />
                  <g transform={`translate(${n.x} ${y + 94})`} className={`icon ${status}`}>
                    <LoadIcon type={loadTypeOf(f)} />
                  </g>
                  <text className="b" x={n.x} y={y + 132} textAnchor="middle">{trunc(f.id, 16)}</text>
                  <text className="m" x={n.x} y={y + 146} textAnchor="middle">{trunc(f.name, 19)}</text>
                  <text x={n.x} y={y + 160} textAnchor="middle">
                    {f.kvar ? `${f.kvar} kvar` : `${(f.loadKw * f.demandFactor).toFixed(0)} kW${f.generation ? ' gen' : ''}${isMotor(f) ? ` · ${starterInfo(starterOf(f)).short}` : ''}`}
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

        {/* Boards: box on the incoming line, then the busbar */}
        {layout.boards.map((n) => {
          const b = n.board;
          const s = summaries.get(b.id)!;
          const status = worst([s.loadingStatus, ...project.feeders.filter((f) => f.boardId === b.id).map((f) => byFeeder.get(f.id)?.status)]);
          const sel = b.id === selectedBoardId;
          const kw = n.circuits.reduce((sum, f) => sum + f.loadKw * f.demandFactor, 0);
          const ph = boardPhaseKw({ ...project, feeders: n.circuits }, b.id);
          const failing = n.circuits.filter((f) => byFeeder.get(f.id)?.status !== 'ok').length;
          const circuitTags: Tag[] = n.circuits.length
            ? [
                { text: `${n.circuits.length} circuits · ${kw.toFixed(1)} kW`, cls: 'b' },
                { text: `R ${ph.R.toFixed(1)} · Y ${ph.Y.toFixed(1)} · B ${ph.B.toFixed(1)} kW`, cls: 'm' },
                ...(failing ? [{ text: `${failing} circuit${failing > 1 ? 's' : ''} to check`, cls: status }] : [])
              ]
            : [];
          return (
            <g
              key={b.id}
              className={`bd ${sel ? 'sel' : ''}${dropCls(`bus:${b.id}`)}${off(b.id) ? ' off' : ''}`}
              {...dnd({ type: 'bus', boardId: b.id }, `bus:${b.id}`)}
              data-drop={`bus:${b.id}`}
              onPointerDown={startPick({ kind: 'board', id: b.id }, b.id)}
              onClick={click(() => onSelectBoard(b.id))}
              onDoubleClick={edit(onEditBoard, b.id)}
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' ? onSelectBoard(b.id) : e.key === 'F2' && edit(onEditBoard, b.id)())}
            >
              <title>{`${b.id} — double-click to edit`}</title>
              {!n.terminal && <line x1={n.busX1} y1={n.busY} x2={n.busX2} y2={n.busY} className={`bus ${sel ? 'sel' : ''}`}
                style={boardHeat(b.id) ? { stroke: boardHeat(b.id) } : undefined} />}
              {/* Wide invisible band along the busbar, so drops don't need pixel precision. */}
              {onDropItem && <line x1={n.busX1 - 20} y1={n.busY} x2={n.busX2 + 20} y2={n.busY} className="bus-hit" />}
              <line x1={n.x} y1={n.busY - 22} x2={n.x} y2={n.busY} className="ln" />
              {b.standby && (
                <g className="standby">
                  <title>{`Standby generator ${b.standby.kva} kVA through an ATS — everything on ${b.id} is essential load`}</title>
                  <rect x={n.x - 11} y={n.busY - 88} width="22" height="15" rx="2" className="sym" />
                  <text x={n.x} y={n.busY - 77} textAnchor="middle" className="b" style={{ fontSize: 8 }}>ATS</text>
                  <line x1={n.x + 11} y1={n.busY - 80} x2={n.x + 34} y2={n.busY - 80} className="ln" />
                  <circle cx={n.x + 45} cy={n.busY - 80} r="11" className="sym" />
                  <text x={n.x + 45} y={n.busY - 76} textAnchor="middle" className="b" style={{ fontSize: 11 }}>G</text>
                  <text x={n.x + 60} y={n.busY - 77} className="m">{b.standby.kva} kVA</text>
                  {(() => {
                    const g = scenario?.generators.find((x) => x.boardId === b.id);
                    if (!g) return null;
                    const cls = g.loadingPct > 100 ? 'bad' : g.loadingPct > 80 ? 'warn' : 'ok';
                    const m = g.largestMotor;
                    return (
                      <>
                        <circle cx={n.x + 45} cy={n.busY - 80} r="14" className="gen-live" />
                        <text x={n.x + 60} y={n.busY - 90} className={`res ${cls}`}>ON · {g.loadingPct.toFixed(0)}% loaded</text>
                        {m && (
                          <text x={n.x + 60} y={n.busY - 64} className={`res ${m.dipPct > MOTOR_START_DIP_LIMIT_PCT ? 'bad' : 'ok'}`}>
                            {m.feeder.name || m.feeder.id} start: dip {m.dipPct.toFixed(0)}%
                          </text>
                        )}
                      </>
                    );
                  })()}
                </g>
              )}
              {b.kind === 'UPS' && (
                <g>
                  <title>{`UPS ${b.upsKva ?? '—'} kVA`}</title>
                  <rect x={n.x - 15} y={n.busY - 118} width="30" height="17" rx="2" className="sym" />
                  <text x={n.x} y={n.busY - 106} textAnchor="middle" className="b" style={{ fontSize: 9 }}>UPS</text>
                </g>
              )}
              <rect x={n.x - 62} y={n.busY - 58} width="124" height="36" rx="6" className="box" style={sel ? { stroke: 'var(--acc)', strokeWidth: 2 } : undefined} />
              <text className="b" x={n.x - 54} y={n.busY - 42}>{trunc(b.id, 14)}</text>
              <text className="m" x={n.x - 54} y={n.busY - 28}>
                {b.kind ?? (b.upstreamId ? 'DB' : 'MDB')}
                {b.ratedCurrentA ? ` · ${b.ratedCurrentA} A` : ''}
              </text>
              <circle cx={n.x + 52} cy={n.busY - 46} r="4" style={{ fill: `var(--${status})` }} />
              {n.terminal && circuitTags.length > 0 && (
                <g className="sched" onDoubleClick={(e) => { e.stopPropagation(); edit(onOpenSchedule, b.id)(); }}>
                  <title>Final circuits are on the load schedule — double-click to open it</title>
                  {circuitTags.map((t, i) => (
                    <text key={t.text} x={n.x} y={n.busY - 4 + i * 13} textAnchor="middle" className={`res ${t.cls}`}>{t.text}</text>
                  ))}
                </g>
              )}
              {[
                ...(n.terminal ? [] : circuitTags),
                ...(b.kind === 'UPS' ? (() => {
                  const pct = upsLoadingPct(project, b);
                  return [{ text: `UPS ${b.upsKva ?? '—'} kVA${pct !== undefined ? ` · ${pct.toFixed(0)}%` : ''}`, cls: pct === undefined ? 'm' : pct > 100 ? 'bad' : pct > 80 ? 'warn' : 'ok' }];
                })() : []),
                ...boardTags(b.id),
                ...(s.loadingPct !== undefined ? [{ text: `${s.loadingPct.toFixed(0)}% loaded`, cls: layers?.loading ? s.loadingStatus ?? 'm' : 'm' }] : [])
              ].map((t, i) => (
                <text key={t.text} x={n.x + 68} y={n.busY - 47 + i * 13} className={`res ${t.cls}`}>{t.text}</text>
              ))}
            </g>
          );
        })}
      </svg>
      {colorBy !== 'none' && (
        <div className="heat-legend">
          <b>{COLOR_BY.find((c) => c.value === colorBy)?.label}</b>
          <div className="heat-bar" />
          <div className="heat-ticks"><span>0</span><span>50%</span><span>85%</span><span>≥100% of limit</span></div>
          <span className="m">{COLOR_BY.find((c) => c.value === colorBy)?.legend}</span>
        </div>
      )}
      {scenario && (
        <div className="mode-banner">
          {scenario.generators.length
            ? `On generator: ${scenario.generators.map((g) => `${g.boardId} ${g.kva} kVA`).join(', ')} — mains lost, ATS changed over; dimmed boards are off`
            : 'No standby generator in this project — drop “Generator + ATS” on a board'}
        </div>
      )}
      {moving && <div className="move-ghost" style={{ left: moving.x + 14, top: moving.y + 10 }}>Move {moving.label}{hover ? '' : ' — drop on a busbar or feeder'}</div>}
      {cableEdit && (
        <form
          className="cable-edit"
          style={{ left: cableEdit.x, top: cableEdit.y + 8 }}
          onSubmit={(e) => { e.preventDefault(); saveCable(); }}
          onKeyDown={(e) => e.key === 'Escape' && setCableEdit(null)}
        >
          <b>{cableEdit.id} cable</b>
          <label>Size
            <select value={cableEdit.size} onChange={(e) => setCableEdit({ ...cableEdit, size: e.target.value })}>
              {cables().map((c) => <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2} mm²</option>)}
            </select>
          </label>
          <label>Runs in parallel
            <select value={cableEdit.runs} onChange={(e) => setCableEdit({ ...cableEdit, runs: e.target.value })}>
              {['1', '2', '3', '4', '5', '6'].map((c) => <option key={c} value={c}>{c === '1' ? 'single' : `${c} ×`}</option>)}
            </select>
          </label>
          <label>Cores
            <select value={cableEdit.cores} onChange={(e) => setCableEdit({ ...cableEdit, cores: e.target.value })}>
              {['2', '3', '4'].map((c) => <option key={c} value={c}>{c}C</option>)}
            </select>
          </label>
          <label>Length (m)
            <input autoFocus inputMode="decimal" value={cableEdit.length} aria-invalid={!lengthOk(cableEdit.length)}
              onChange={(e) => setCableEdit({ ...cableEdit, length: e.target.value })} onFocus={(e) => e.target.select()} />
          </label>
          <div className="cable-edit-actions">
            <button type="button" className="chip" onClick={() => setCableEdit(null)}>Cancel</button>
            <button type="submit" className="chip primary" disabled={!lengthOk(cableEdit.length)}>Apply</button>
          </div>
        </form>
      )}
    </div>
  );
}
