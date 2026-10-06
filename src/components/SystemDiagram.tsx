import { withNetwork } from '../calc/network';
import { txTag } from '../model/transformers';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { STATUS_TEXT } from '../calc/statusText';
import { componentLabel } from '../model/components';
import type { DrawingInfo, Project } from '../types';
import { cableTypeOf, CABLE_TYPE_DEFS, labelCode, needsFireRated } from '../model/cableTypes';
import { cableRefOf } from '../model/cableRefs';
import { LEGEND_ROW, LEGEND_SYM_X, LEGEND_TEXT_X, legendEntries, legendWidth, LoadSym, polesText, SwitchSym, switchKindOf } from '../diagram/IecSymbols';
import type { FeederResult, Status } from '../calc/electrical';
import { boardSummary, loadTypeOf } from '../calc/summary';
import { failReasons, quickFixes } from '../calc/quickFix';
import { boardLocation } from '../model/levels';
import { boardPhaseKw } from '../calc/loadSchedule';
import { DEWA_EXTRA_Y, LEAF_W, layoutSystem } from '../diagram/layout';
import { panelSummary } from '../docs/mdSheet';
import { cpcOf } from '../calc/cableTable';
import LoadIcon from './LoadIcon';
import type { Annotations, ResultLayers } from '../diagram/annotations';
import { addsWay, canDrop, canMove, type DropTarget, type MoveItem, type PaletteItem } from '../model/sldEdit';
import { cables } from '../calc/cableTable';
import { upsLoadingPct } from '../calc/sizing';
import { isMotor, starterInfo, starterOf } from '../calc/motor';
import { sldDevices } from '../diagram/sldDevices';
import { cableSizeText, runsOf, upstreamVoltageDropPct } from '../calc/electrical';
import { MOTOR_START_DIP_LIMIT_PCT, type GeneratorRun, type OutageScenario } from '../calc/scenario';
import { boardRatio, COLOR_BY, earthRatio, feederRatio, heatColor, type ColorBy } from '../diagram/heatmap';
import { evaluateEarthingAll } from '../calc/earthing';
import { INCOMER_DEVICES, incomerDeviceOf, type Board, type Feeder } from '../types';
import { getDragItem, setDragItem } from '../diagram/dragItem';

interface Tag {
  text: string;
  cls: string;
}

type GridStyle = 'lines' | 'dots' | 'off';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const worst = (statuses: (Status | undefined)[]): Status =>
  statuses.includes('bad') ? 'bad' : statuses.includes('warn') ? 'warn' : 'ok';

/** Incomer protection: the board's own, else the authority supply's CT and setting. */
export const protectionOf = (b: Board): Board['protection'] | undefined => {
  const p = { ctRatio: b.protection?.ctRatio ?? b.supply?.ctRatio, irSetting: b.protection?.irSetting ?? b.supply?.irSetting, relays: b.protection?.relays, apfc: b.protection?.apfc };
  return p.ctRatio || p.irSetting || p.relays?.length || p.apfc ? p : undefined;
};

/** Instruments and earthing default on for main boards. */
export const hasInstruments = (b: Board) => b.instruments ?? !b.upstreamId;
export const hasEarthPits = (b: Board) => b.earthing?.show ?? !b.upstreamId;
/** Main earth conductor: typed, else the incomer's protective conductor size (min. 16), else 50 mm². */
export function earthConductorOf(project: Project, b: Board): number {
  if (b.earthing?.conductorMm2) return b.earthing.conductorMm2;
  const inc = project.feeders.find((f) => f.feedsBoardId === b.id);
  return inc ? Math.max(16, cpcOf(inc)) : 50;
}

/** DEWA wording of poles and device. */
const dewaPoles = (f: Feeder) => (f.phase && f.phase !== 'RYB' ? 'SP' : f.cores === 2 ? 'SPN' : f.cores === 3 ? 'TP' : 'TPN');
const dewaDevice = (f: Feeder) => { const t = f.breakerType ?? (f.breakerRatingA <= 63 ? 'C' : 'MCCB'); return t === 'ACB' ? 'ACB' : t === 'MCCB' ? 'MCCB' : 'MCB'; };

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Whole-network single line diagram: utility → transformer → main board →
 * sub-boards → loads. Wheel to zoom, drag to pan; click a board or a load to
 * select it, double-click to edit it. Optional result labels (current,
 * voltage, voltage drop, fault level, power factor, loading) are printed
 * next to each board and feeder. */
export default function SystemDiagram({
  project,
  calcProject,
  stale = false,
  results,
  selectedFeederId,
  selectedBoardId,
  onSelectFeeder,
  onSelectBoard,
  tool = 'select',
  annotations,
  layers,
  cableRefs: cableRefsProp,
  hideLegend = false,
  outlines,
  clouds,
  onOutline,
  onMoveToSheet,
  focus,
  onFixFeeder,
  arrows,
  fromSheet,
  cull = false,
  onEditFeeder,
  onEditBoard,
  onOpenSchedule,
  onDropItem,
  onMoveItem,
  onPatchFeeder,
  colorBy = 'none',
  scenario,
  chain,
  onRemoveTie,
  resizable = false,
  fullScreen = false,
  onToggleFullScreen,
  onDrawing
}: {
  project: Project;
  /** The project the results were calculated for (the last run). */
  calcProject?: Project;
  /** Results out of date: labels, dots and colours are shown faded. */
  stale?: boolean;
  results: FeederResult[];
  selectedFeederId: string | null;
  selectedBoardId: string | null;
  onSelectFeeder: (id: string) => void;
  onSelectBoard: (id: string) => void;
  /** 'pan': dragging and clicking never select anything. */
  tool?: 'select' | 'pan';
  annotations?: Annotations;
  layers?: ResultLayers;
  /** Cable text as a reference number (legend: CABLE SCHEDULE) and the size only. */
  cableRefs?: boolean;
  /** Leave the symbol legend out (drawing sheets put it in their legend column). */
  hideLegend?: boolean;
  /** Sheet outlines on the design canvas: which panels go on which sheet. */
  outlines?: { id: string; label: string; boards: string[]; color: string }[];
  /** Revision clouds around panels (drawing sheets). */
  clouds?: { boards: string[]; rev: string }[];
  onOutline?: (sheetId: string) => void;
  /** A panel dragged into another sheet's outline. */
  onMoveToSheet?: (boardId: string, sheetId: string) => void;
  /** Centre the view on this panel or circuit (n changes on every request). */
  focus?: { kind: 'board' | 'feeder'; id: string; n: number };
  /** Apply a quick fix from a circuit's hover card. */
  onFixFeeder?: (id: string, patch: Partial<Feeder>, label: string) => void;
  /** Callouts with leader arrows (drawing sheets). */
  arrows?: { target: string; text: string; dir: 'ne' | 'nw' | 'se' | 'sw'; len?: number }[];
  /** Drawing sheets: the sheet number of the board feeding each panel drawn from another sheet. */
  fromSheet?: Record<string, string>;
  /** Draw only the boards and circuits in view (plus a margin) — for the interactive SLD on large
   * projects. Exports and sheets leave it off so everything is drawn. */
  cull?: boolean;
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
  scenario?: { project: Project; energized: Set<string>; generators: GeneratorRun[]; outage?: OutageScenario['outage'] };
  /** Click on a bus tie. */
  onRemoveTie?: (id: string) => void;
  /** Breakers in the selected feeder's discrimination chain, by status. */
  chain?: Map<string, Status>;
  /** Drag handle at the bottom edge to change the height (remembered). */
  resizable?: boolean;
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
  /** Change the drawing settings (symbol style, legend): shows their buttons. */
  onDrawing?: (patch: Partial<DrawingInfo>) => void;
}) {
  const iec = (project.drawing?.symbols ?? 'iec') === 'iec';
  // DEWA submission style: panel frames, summary boxes (LOC, TCL, DF, MDL), DEWA wording.
  const dewa = project.drawing?.sldStyle !== 'standard'; // on unless switched off
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
      layers.fault && icuShort(id),
      layers.pf && a.pf !== undefined && { text: `PF ${a.pf.toFixed(2)}`, cls: 'r-pf' },
      layers.loading && a.loadingPct !== undefined && { text: `${a.loadingPct.toFixed(0)}% of In`, cls: a.loadingStatus ?? '' }
    ];
    return [...t.filter((x): x is Tag => !!x), ...earthTag];
  };
  // Breaking capacity below the fault level at the board the breaker is on.
  const icuShort = (id: string): Tag | false => {
    const f = project.feeders.find((x) => x.id === id);
    const ik = f && annotations?.boards[f.boardId]?.faultKA;
    return !!f && ik !== undefined && f.breakerIcuKa > 0 && f.breakerIcuKa < ik && { text: `✕ Icu ${f.breakerIcuKa} < Ik ${ik.toFixed(1)} kA`, cls: 'bad' };
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
  const layout = useMemo(() => layoutSystem(project, dewa ? DEWA_EXTRA_Y : 0), [project, dewa]);
  // CAD label limits follow neighbouring drops on the same row. This is
  // export metadata only; it does not change the live or printed diagram.
  const cadSlots = useMemo(() => {
    const slots = new Map<string, number>();
    const rows = new Map<number, typeof layout.feeders>();
    for (const n of layout.feeders) (rows.get(n.busY) ?? rows.set(n.busY, []).get(n.busY)!).push(n);
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      row.forEach((n, i) => slots.set(n.feeder.id, row[i + 1] ? row[i + 1].x - n.x : LEAF_W));
    }
    return slots;
  }, [layout]);
  /** Box around these panels: board box, summary box, busbar and outgoing ways. */
  const boardsBox = (ids: string[], pad: number) => {
    const ns = layout.boards.filter((n) => ids.includes(n.board.id));
    if (!ns.length) return null;
    const x1 = Math.min(...ns.map((n) => (n.terminal ? n.x - 66 : n.busX1 - 12))) - pad;
    const x2 = Math.max(...ns.map((n) => (n.terminal ? n.x + 135 : Math.max(n.busX2 + 12, n.x + 135)))) + pad;
    const y1 = Math.min(...ns.map((n) => n.busY - (dewa ? 165 : 70))) - pad;
    const y2 = Math.max(...ns.map((n) => n.busY + (n.terminal ? 10 : 120))) + pad;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  /** The sheet outline under a screen point (the smallest one), for dropping a panel on a sheet. */
  const outlineAt = (cx: number, cy: number): string | undefined => {
    const svg = svgRef.current, ctm = svg?.getScreenCTM();
    if (!svg || !ctm || !outlines?.length) return undefined;
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const p = pt.matrixTransform(ctm.inverse());
    const hits = outlines.map((o, i) => ({ o, r: boardsBox(o.boards, 8 + (i % 3) * 6) })).filter((h) => h.r && p.x >= h.r.x && p.x <= h.r.x + h.r.w && p.y >= h.r.y && p.y <= h.r.y + h.r.h);
    hits.sort((a, b) => a.r!.w * a.r!.h - b.r!.w * b.r!.h);
    return hits[0]?.o.id;
  };
  const [overOutline, setOverOutline] = useState<string | null>(null);
  // Way numbers along each busbar (DEWA style).
  const wayNo = useMemo(() => { const m = new Map<string, number>(), c = new Map<string, number>(); for (const n of [...layout.feeders].sort((a, b) => a.x - b.x)) { const k = (c.get(n.feeder.boardId) ?? 0) + 1; c.set(n.feeder.boardId, k); m.set(n.feeder.id, k); } return m; }, [layout]);
  const byFeeder = useMemo(() => new Map(results.map((r) => [r.feeder.id, r])), [results]);
  const feedersOn = useMemo(() => { const m = new Map<string, Feeder[]>(); for (const f of project.feeders) (m.get(f.boardId) ?? m.set(f.boardId, []).get(f.boardId)!).push(f); return m; }, [project.feeders]);
  // Board loading and voltage come from the network that is running: the
  // generator scenario in generator mode.
  const running = scenario?.project ?? calcProject ?? project;
  // One network index for all the panel summaries (totals, fault level, voltage reuse the same walks).
  const summaries = useMemo(() => {
    const src = scenario?.project ?? calcProject ?? project;
    const srcById = new Map(src.boards.map((x) => [x.id, x]));
    return withNetwork(src, () => new Map(project.boards.map((b) => {
      const calc = srcById.get(b.id);
      return [b.id, calc ? boardSummary(src, calc) : withNetwork(project, () => boardSummary(project, b))];
    })));
  },
    [project, calcProject, scenario]
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

  // The symbol legend sits to the right of the network, inside the drawing (so it exports).
  const legend = useMemo(() => (iec && !hideLegend && (project.drawing?.legend ?? true) ? legendEntries(calcProject ?? project) : []), [iec, hideLegend, project, calcProject]);
  // Cable text as reference numbers: on the drawing sheets when chosen there, on screen with Always numbers.
  const cableRefs = cableRefsProp ?? project.drawing?.cableLabels === 'ref';
  const legendW = legendWidth(legend);
  const W = layout.width + (legend.length ? legendW + 30 : 0);
  const H = Math.max(layout.height, legend.length ? 80 + legend.length * LEGEND_ROW : 0);
  const full: ViewBox = { x: 0, y: 0, w: W, h: H };
  const [vb, setVb] = useState<ViewBox>(full);
  // Visible span (drawing units) with a margin of half a screen each side, so panning shows no gaps.
  const viewX1 = vb.x - Math.max(vb.w * 0.5, 400), viewX2 = vb.x + vb.w * 1.5 + 400;
  // Hover card: a circuit's or panel's results, with quick fixes for a failing circuit.
  const [card, setCard] = useState<{ kind: 'board' | 'feeder'; id: string; x: number; y: number } | null>(null);
  const hideCard = useRef<ReturnType<typeof setTimeout>>();
  const showCard = (kind: 'board' | 'feeder', id: string) => (e: React.MouseEvent) => {
    if (pick.current || drag.current?.moved) return;
    clearTimeout(hideCard.current);
    const r = svgRef.current?.parentElement?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    setCard((c) => (c && c.id === id && c.kind === kind ? c : { kind, id, x, y }));
  };
  const leaveCard = () => { clearTimeout(hideCard.current); hideCard.current = setTimeout(() => setCard(null), 300); };
  // Grid (lines like CAD, dots, or none) and canvas height: this viewer's preferences.
  const [grid, setGrid] = useState<GridStyle>(() => {
    try { const g = localStorage.getItem('sld.grid'); return g === 'dots' || g === 'off' ? g : 'lines'; } catch { return 'lines'; }
  });
  const nextGrid = () => {
    const g: GridStyle = grid === 'lines' ? 'dots' : grid === 'dots' ? 'off' : 'lines';
    setGrid(g);
    try { localStorage.setItem('sld.grid', g); } catch { /* preference only */ }
  };
  const [height, setHeight] = useState<number | undefined>(() => {
    try { const h = Number(localStorage.getItem('sld.height')); return h >= 300 ? h : undefined; } catch { return undefined; }
  });
  const rootRef = useRef<HTMLDivElement>(null);
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = rootRef.current?.getBoundingClientRect().height ?? 500;
    let h = h0;
    const move = (ev: PointerEvent) => { h = Math.max(300, Math.min(4000, h0 + ev.clientY - y0)); setHeight(h); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem('sld.height', String(Math.round(h))); } catch { /* preference only */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  useEffect(() => {
    if (!fullScreen || !onToggleFullScreen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onToggleFullScreen(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [fullScreen, onToggleFullScreen]);
  const svgRef = useRef<SVGSVGElement>(null);
  // On screen, squeeze any label wider than its slot so it can't run over the neighbouring feeder.
  useLayoutEffect(() => {
    svgRef.current?.querySelectorAll<SVGTextElement>('text[data-dxf-max-width], text[data-fit-width]').forEach((t) => {
      t.removeAttribute('textLength');
      const max = Number(t.getAttribute('data-dxf-max-width') ?? t.getAttribute('data-fit-width'));
      const w = t.getComputedTextLength?.() ?? 0;
      if (max > 0 && w > max) { t.setAttribute('textLength', String(max)); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    });
  });
  const drag = useRef<{ px: number; py: number; vb: ViewBox; moved: boolean } | null>(null);

  // Re-fit when the network's overall size changes (boards/feeders added).
  useEffect(() => setVb({ x: 0, y: 0, w: W, h: H }), [W, H]);

  // Centre on a panel or circuit picked in the results below the drawing.
  useEffect(() => {
    if (!focus) return;
    const pt = focus.kind === 'board'
      ? layout.boards.find((n) => n.board.id === focus.id) && (() => { const n = layout.boards.find((m) => m.board.id === focus.id)!; return { x: n.x, y: n.busY - 30 }; })()
      : layout.feeders.find((n) => n.feeder.id === focus.id) && (() => { const n = layout.feeders.find((m) => m.feeder.id === focus.id)!; return { x: n.x, y: n.busY + 40 }; })();
    if (!pt) return;
    setVb((v) => { const w = Math.min(v.w, 1400), h = (w / v.w) * v.h; return { x: pt.x - w / 2, y: pt.y - h / 2, w, h }; });
  }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [cableEdit, setCableEdit] = useState<{ id: string; x: number; y: number; size: string; cores: string; length: string; runs: string; type: string } | null>(null);
  const lengthOk = (v: string) => /^\d*\.?\d+$/.test(v.trim().replace(',', '.')) && Number(v.trim().replace(',', '.')) > 0;
  const saveCable = () => {
    if (!cableEdit || !onPatchFeeder || !lengthOk(cableEdit.length)) return;
    // Only sizes from the cable table and 2/3/4 cores: anything else would break every calculation.
    if (!cables().some((c) => c.csaMm2 === Number(cableEdit.size)) || !['2', '3', '4'].includes(cableEdit.cores)) return;
    onPatchFeeder(cableEdit.id, { cableCsaMm2: Number(cableEdit.size), cores: Number(cableEdit.cores) as 2 | 3 | 4, lengthM: Number(cableEdit.length.trim().replace(',', '.')), parallel: Number(cableEdit.runs) > 1 ? Number(cableEdit.runs) : undefined, cableType: cableEdit.type || undefined });
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
      const ol = !ok && pk.item.kind === 'board' && onMoveToSheet ? outlineAt(e.clientX, e.clientY) ?? null : null;
      if (ol !== overOutline) setOverOutline(ol);
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
      else if (pk.item.kind === 'board' && onMoveToSheet) { const sh = outlineAt(e.clientX, e.clientY); if (sh) onMoveToSheet(pk.item.id, sh); }
      setOverOutline(null);
    }
    // Keep the flag until the click event has fired, so a drag isn't a click.
    setTimeout(() => (drag.current = null), 0);
  }
  // Drag and drop: a busbar, a feeder or the empty canvas highlights while
  // an item that can go there is dragged over it.
  const [hover, setHover] = useState<string | null>(null);
  // Where along a busbar a new way would go: between the two feeders nearest the pointer.
  const [insertAt, setInsertAt] = useState<{ boardId: string; x: number; before?: string } | null>(null);
  const busInsert = (boardId: string, clientX: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return undefined;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = 0;
    const x = pt.matrixTransform(ctm.inverse()).x;
    const onBus = layout.feeders.filter((n) => n.feeder.boardId === boardId).sort((a, b) => a.x - b.x);
    const next = onBus.find((n) => n.x > x);
    const prev = [...onBus].reverse().find((n) => n.x <= x);
    const gx = next && prev ? (next.x + prev.x) / 2 : next ? next.x - LEAF_W / 2 : prev ? prev.x + LEAF_W / 2 : x;
    return { boardId, x: gx, before: next?.feeder.id };
  };
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
            if (target.type === 'bus' && addsWay(item)) {
              const ins = busInsert(target.boardId, e.clientX);
              if (ins && (ins.boardId !== insertAt?.boardId || ins.before !== insertAt?.before)) setInsertAt(ins);
            } else if (insertAt) setInsertAt(null);
          },
          onDrop: (e: React.DragEvent) => {
            const item = getDragItem();
            if (!item) return;
            e.preventDefault();
            e.stopPropagation();
            setHover(null);
            setDragItem(null);
            const ins = target.type === 'bus' && addsWay(item) ? busInsert(target.boardId, e.clientX) : undefined;
            setInsertAt(null);
            onDropItem(item, ins?.before && target.type === 'bus' ? { ...target, before: ins.before } : target);
          }
        }
      : {};
  const dropCls = (key: string) => (hover === key ? ' drop-ok' : '');

  const click = (fn: () => void) => () => {
    if (!drag.current?.moved && tool !== 'pan') fn();
  };

  const main = layout.roots[0];

  return (
    <div
      ref={rootRef}
      className={`sysdiag ${tool === 'pan' ? 'pan' : ''}${dropCls('canvas')}${stale ? ' stale' : ''}`}
      style={resizable && height && !fullScreen ? { height } : undefined}
    >
      <div className="sysdiag-tools" role="toolbar" aria-label="Diagram zoom">
        {onDrawing && <button className="chip" onClick={() => onDrawing({ symbols: iec ? 'simple' : 'iec' })} title={iec ? 'IEC 60617 symbols — switch to simple icons' : 'Simple icons — switch to IEC 60617 symbols'}>{iec ? 'IEC' : 'Icons'}</button>}
        {onDrawing && <button className={`chip${dewa ? ' on' : ''}`} onClick={() => onDrawing({ sldStyle: dewa ? 'standard' : undefined })} title="DEWA submission style: a frame around each panel with its summary (LOC, TCL, DF, MDL), way numbers and DEWA wording">DEWA</button>}
        {onDrawing && <button className={`chip${project.drawing?.cableLabels === 'ref' ? ' on' : ''}`} onClick={() => onDrawing({ cableLabels: project.drawing?.cableLabels === 'ref' ? undefined : 'ref' })} title="Cable text as reference numbers (CABLE SCHEDULE legend). Off: full description on screen; drawing sheets switch to numbers by themselves when crowded.">Cable no.</button>}
        {onDrawing && iec && <button className={`chip${legend.length ? ' on' : ''}`} onClick={() => onDrawing({ legend: !(project.drawing?.legend ?? true) })} title="Symbol legend beside the drawing (printed on the exports)">Legend</button>}
        <button className="chip" onClick={nextGrid} title="Grid: lines, dots or none">{grid === 'lines' ? '▦' : grid === 'dots' ? '⁙' : '□'}</button>
        <button className="chip" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in">+</button>
        <button className="chip" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
        <button className="chip" onClick={() => setVb(full)}>Fit</button>
        {onToggleFullScreen && <button className="chip" onClick={onToggleFullScreen} title={fullScreen ? 'Exit full screen (Esc)' : 'Full screen'}>{fullScreen ? '✕' : '⤢'}</button>}
      </div>
      {resizable && !fullScreen && (
        <div className="sysdiag-resize" onPointerDown={startResize} onDoubleClick={() => { setHeight(undefined); try { localStorage.removeItem('sld.height'); } catch { /* ignore */ } }} title="Drag to make the drawing taller or shorter — double-click for the default height" />
      )}
      <svg
        ref={svgRef}
        data-w={W}
        data-h={H}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        role="img"
        aria-label={`Single line diagram of ${project.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        {...dnd({ type: 'canvas' }, 'canvas')}
        onDragLeave={(e) => { if (!svgRef.current?.contains(e.relatedTarget as Node)) { setHover(null); setInsertAt(null); } }}
      >
        {/* Grid: in drawing units, so it pans and zooms with the drawing; not exported. */}
        {grid !== 'off' && (
          <g className="grid-bg" pointerEvents="none">
            <defs>
              <pattern id="sld-grid-minor" width="20" height="20" patternUnits="userSpaceOnUse">
                {grid === 'lines' ? <path d="M20 0H0V20" className="grid-minor" /> : <circle cx="0" cy="0" r="1.1" className="grid-dot" />}
              </pattern>
              <pattern id="sld-grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
                <rect width="100" height="100" fill="url(#sld-grid-minor)" />
                {grid === 'lines' && <path d="M100 0H0V100" className="grid-major" />}
              </pattern>
            </defs>
            <rect x={vb.x - vb.w * 2} y={vb.y - vb.h * 2} width={vb.w * 5} height={vb.h * 5} fill="url(#sld-grid-major)" />
          </g>
        )}

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

        {/* RMUs: one box across the transformers each one feeds (11 kV side) */}
        {[...new Set(layout.roots.map((r) => r.board.rmu).filter((x): x is string => !!x))].map((rmu) => {
          const rs = layout.roots.filter((r) => r.board.rmu === rmu);
          const x1 = Math.min(...rs.map((r) => r.x)) - 34;
          const x2 = Math.max(...rs.map((r) => r.x)) + 34;
          return (
            <g key={`rmu-${rmu}`} className="rmu">
              <title>{`${rmu}: ring main unit feeding ${rs.map((r) => r.board.id).join(', ')}`}</title>
              <rect x={x1} y={41} width={x2 - x1} height={18} rx="3" className="sym rmu-box" />
              <text x={(x1 + x2) / 2} y={54} textAnchor="middle" className="b" style={{ fontSize: 10 }}>{rmu} · 11 kV</text>
            </g>
          );
        })}
        {layout.roots.map((r) => r.board.upstreamId ? (() => {
          // Part of the network (a study report's scope): the board is fed
          // from a board that isn't drawn.
          const inc = (calcProject ?? project).feeders.find((f) => f.feedsBoardId === r.board.id && f.boardId === r.board.upstreamId);
          return (
            <g key={`from-${r.board.id}`} className="from-up">
              <path d={`M${r.x - 7} 60 L${r.x} 72 L${r.x + 7} 60`} className="ln" />
              <line x1={r.x} y1="40" x2={r.x} y2={r.busY - 58} className="ln" />
              <text className="b" x={r.x + 14} y="46">From {r.board.upstreamId}{fromSheet?.[r.board.id] ? ` — sheet ${fromSheet[r.board.id]}` : ''}</text>
              {inc && <text className="m" x={r.x + 14} y="60">{inc.id}: {cableSizeText(inc)}, {inc.lengthM} m · {inc.breakerRatingA} A</text>}
            </g>
          );
        })() : !r.board.sourceKva && r.board.supply ? (
          <g key={`sup-${r.board.id}`} className="tx" onDoubleClick={edit(onEditBoard, r.board.id)}>
            <title>Supply from the authority — double-click to edit</title>
            <rect x={r.x - 16} y={52} width={32} height={26} rx={3} className="sym" />
            <text className="b" x={r.x} y={69} textAnchor="middle" style={{ fontSize: 10 }}>kWh</text>
            <text className="b" x={r.x + 24} y="62">{r.board.supply.fedFrom ?? 'DEWA'} supply</text>
            {dewa ? (
              <>
                <text className="m" x={r.x + 24} y="76">METER CABINET{r.board.supply.ctRatio || r.board.protection?.ctRatio ? ` · CTM ${r.board.supply.ctRatio ?? r.board.protection?.ctRatio}` : ''}</text>
                {r.board.supply.ratingA && <text className="m" x={r.x + 24} y="90">{r.board.supply.ratingA}A TP {r.board.supply.device ?? 'MCCB'}{r.board.supply.faultKa ? ` ${r.board.supply.faultKa} kA` : ''}</text>}
                <text className="m" x={r.x + 24} y="104">CABLE BY {r.board.supply.fedFrom ?? 'DEWA'} · FED FROM {r.board.supply.fedFrom ?? 'DEWA'}</text>
              </>
            ) : <text className="m" x={r.x + 24} y="76">{r.board.supply.ratingA ? `${r.board.supply.ratingA} A ${r.board.supply.device ?? ''}` : 'meter cabinet'}{r.board.supply.meter ? ` · ${r.board.supply.meter} meter` : ''}</text>}
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
            <text className="b" x={r.x + 24} y="86">{txTag(project, r.board.id) ?? 'Transformer'}</text>
            <text className="m" x={r.x + 24} y="100">
              {r.board.sourceKva ? `${r.board.sourceKva} kVA · ${r.board.sourceImpedancePct ?? '—'}% Z` : 'no source data'}
            </text>
            {r.board.sourceKva && <text className="m" x={r.x + 24} y="113">{r.board.vectorGroup ?? 'Dyn11'} · 11 / {(project.voltageV / 1000).toFixed(3)} kV</text>}
            <line x1={r.x} y1="114" x2={r.x} y2={r.busY - 58} className="ln" />
            <text className="m" x={r.x - 8} y={r.busY - (dewa ? 96 : protectionOf(r.board) ? 84 : 72)} textAnchor="end">{project.voltageV} V</text>
            {scenario?.outage?.failedId === r.board.id && (
              <g className="failed-tx">
                <line x1={r.x - 20} y1="68" x2={r.x + 20} y2="116" />
                <line x1={r.x + 20} y1="68" x2={r.x - 20} y2="116" />
                <text x={r.x + 24} y="114" className="res bad">FAILED</text>
              </g>
            )}
            {(() => {
              const t = scenario?.outage?.transformers.find((x) => x.boardId === r.board.id);
              if (!t) return null;
              return <text x={r.x + 24} y="114" className={`res ${t.loadingPct > 100 ? 'bad' : t.loadingPct > 80 ? 'warn' : 'ok'}`}>{t.loadingPct.toFixed(0)}% loaded ({t.demandKva.toFixed(0)} kVA)</text>;
            })()}
          </g>
        ))}

        {/* Main earthing detail: earth pits left of each main board's incoming supply */}
        {layout.roots.map((r, i) => {
          const b = r.board;
          if (!hasEarthPits(b)) return null;
          const prev = layout.roots[i - 1];
          if (prev && prev.x > r.x - 280) return null; // no room beside a neighbouring main board
          const ox = r.x - 150, oy = 60;
          const mm = earthConductorOf(project, b);
          const pits = b.earthing?.pits ?? 2;
          const el = b.earthing?.electrodeM ?? 3;
          const sp = b.earthing?.spacingM ?? 6;
          const rod = (x: number) => (
            <g key={x}>
              <rect x={x - 7} y={oy + 12} width="14" height="10" className="sym" />
              <line x1={x} y1={oy + 17} x2={x} y2={oy + 40} className="ln" />
              <line x1={x - 7} y1={oy + 40} x2={x + 7} y2={oy + 40} className="ln" />
              <line x1={x - 4.5} y1={oy + 43} x2={x + 4.5} y2={oy + 43} className="ln" />
              <line x1={x - 2} y1={oy + 46} x2={x + 2} y2={oy + 46} className="ln" />
            </g>
          );
          return (
            <g key={`earth-${b.id}`} className="acc earth-pit">
              <title>{`${b.id} main earthing: ${pits} earth pits, ${el} m electrodes, min. ${sp} m apart, 1C ${mm} mm² Cu/PVC earth conductor`}</title>
              <text x={ox} y={oy - 6} className="acc-t b">EARTH PITS ({pits} NO.)</text>
              <line x1={ox + 15} y1={oy + 8} x2={ox + 85} y2={oy + 8} className="ln" />
              <line x1={ox + 15} y1={oy + 8} x2={ox + 15} y2={oy + 12} className="ln" />
              <line x1={ox + 85} y1={oy + 8} x2={ox + 85} y2={oy + 12} className="ln" />
              <line x1={ox + 50} y1={oy + 8} x2={ox + 50} y2={oy + 2} className="ln" />
              <path d={`M${ox + 50} ${oy + 2} H${r.x - 20}`} className="ln interlock" />
              <text x={r.x - 22} y={oy + 11} textAnchor="end" className="acc-t" style={{ fontSize: 7 }}>to MET</text>
              {rod(ox + 15)}
              {rod(ox + 85)}
              <line x1={ox + 15} y1={oy + 52} x2={ox + 85} y2={oy + 52} className="ln" />
              <path d={`M${ox + 15} ${oy + 52} l5 -2.5 v5 z M${ox + 85} ${oy + 52} l-5 -2.5 v5 z`} className="dot" />
              <text x={ox + 50} y={oy + 50} textAnchor="middle" className="acc-t" style={{ fontSize: 7 }}>{sp.toFixed(1)} m (MIN)</text>
              <text x={ox} y={oy + 63} className="acc-t" style={{ fontSize: 7.5 }}>1C {mm}mm² CU/PVC</text>
              <text x={ox} y={oy + 72} className="acc-t" style={{ fontSize: 7.5 }}>MIN. {el} m ELECTRODE WITH</text>
              <text x={ox} y={oy + 81} className="acc-t" style={{ fontSize: 7.5 }}>INSPECTION PIT AND COVER</text>
            </g>
          );
        })}

        {/* Bus couplers between main boards: normally open, closed when a transformer is out */}
        {(project.ties ?? []).map((t) => {
          const a = layout.roots.find((r) => r.board.id === t.a);
          const b = layout.roots.find((r) => r.board.id === t.b);
          if (!a || !b) return null;
          const [left, right] = a.x < b.x ? [a, b] : [b, a];
          const y = left.busY;
          const x1 = left.busX2;
          const x2 = right.busX1;
          const mx = (x1 + x2) / 2;
          const run = scenario?.outage?.tie?.id === t.id ? scenario.outage.tie : undefined;
          return (
            <g key={t.id} className={`tie${run ? ' closed' : ''}`} onClick={click(() => onRemoveTie?.(t.id))}>
              <title>{`${t.id}: bus coupler ${t.ratingA} A, ${run ? 'closed' : 'normally open'} — click to remove`}</title>
              <line x1={x1} y1={y} x2={mx - 9} y2={y} className="tie-ln" data-dxf-layer="BUSBAR" />
              <line x1={mx + 9} y1={y} x2={x2} y2={y} className="tie-ln" data-dxf-layer="BUSBAR" />
              <rect x={mx - 9} y={y - 9} width="18" height="18" rx="2" className="sym" />
              {run ? <line x1={mx - 9} y1={y} x2={mx + 9} y2={y} className="ln" /> : <line x1={mx - 6} y1={y + 6} x2={mx + 6} y2={y - 6} className="ln" />}
              <text x={mx} y={y - 16} textAnchor="middle" className="b">{t.id} · {t.ratingA} A</text>
              <text x={mx} y={y + 24} textAnchor="middle" className={run ? `res ${run.loadingPct > 100 ? 'bad' : run.loadingPct > 85 ? 'warn' : 'ok'}` : 'm'}>
                {run ? `CLOSED · ${run.currentA.toFixed(0)} A (${run.loadingPct.toFixed(0)}%)` : 'N/O'}
              </text>
            </g>
          );
        })}

        {/* Feeders: breaker, cable, then a load or a drop to a sub-board */}
        {layout.feeders.map((n) => {
          if (cull && (n.x < viewX1 || n.x > viewX2)) return null;
          const f = n.feeder;
          const r = byFeeder.get(f.id);
          const status = r?.status ?? 'ok';
          const sel = f.id === selectedFeederId;
          const y = n.busY;
          const endY = n.childBoardId ? y + layout.levelH - 58 : y + 76;
          const tagY = dewa ? 16 : 0; // DEWA: cable text takes two lines
          const cadSlot = cadSlots.get(f.id) ?? LEAF_W;
          const cadCableDx = f.kwhMeter && !n.childBoardId ? (f.kwhMeter === 'CT' ? 50 : 35) : 0;
          const cadCableWidth = Math.max(1, cadSlot - (cableRefs ? 26 : 12) - 7 - cadCableDx);
          const cadDeviceWidth = Math.max(1, cadSlot - 26);
          return (
            <g
              key={f.id}
              className={`fd ${sel ? 'sel' : ''}${dropCls(`fd:${f.id}`)}${off(f.boardId) ? ' off' : ''}`}
              onMouseEnter={showCard('feeder', f.id)}
              onMouseLeave={leaveCard}
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
              {iec ? <SwitchSym x={n.x} y={y + 18} kind={switchKindOf(f)} /> : <rect x={n.x - 6} y={y + 18} width="12" height="16" className="sym" />}
              {chain?.has(f.id) && (
                <rect x={n.x - 11} y={y + 13} width="22" height="26" rx="4" className={`disc-ring ${chain.get(f.id)}`}>
                  <title>{`Discrimination: ${chain.get(f.id) === 'ok' ? 'selective' : chain.get(f.id) === 'warn' ? 'partial' : 'not selective'}`}</title>
                </rect>
              )}
              {!iec && <line x1={n.x - 5} y1={y + 32} x2={n.x + 5} y2={y + 20} className="ln" />}
              {dewa ? <text x={n.x + 10} y={y + 41} className="acc-t" data-dxf-max-width={cadDeviceWidth}>{f.breakerIcuKa} kA{f.rcdMa ? ` · ${f.rcdMa}mA ELCB` : ''}</text>
                : iec && <text x={n.x + 10} y={y + 41} className="acc-t" data-dxf-max-width={cadDeviceWidth}>{polesText(f)} · {f.breakerIcuKa} kA</text>}
              {dewa && <text x={n.x - 5} y={y + 13} textAnchor="end" className="acc-t way-no">{wayNo.get(f.id)}</text>}
              <line x1={n.x} y1={y + 34} x2={n.x} y2={endY} className={`ln ${status !== 'ok' ? status : ''}${cableTypeOf(project, f).fireRated ? ' fr' : ''}`}
                style={feederHeat(f.id) ? { stroke: feederHeat(f.id), strokeWidth: 3.5 } : undefined} />
              {dewa ? <text className="b" x={n.x + 10} y={y + 28} data-dxf-max-width={cadDeviceWidth}>{f.breakerRatingA}A {dewaPoles(f)} {dewaDevice(f)}</text>
                : <text className="b" x={n.x + 10} y={y + 30} data-dxf-max-width={cadDeviceWidth}>{f.breakerRatingA} A{f.rcdMa ? <tspan className="acc-t"> · {f.rcdMa} mA</tspan> : null}</text>}
              <text
                className={`${dewa ? 'acc-t' : 'm'}${onPatchFeeder ? ' cable-lbl' : ''}`}
                style={dewa ? { fontSize: 9 } : undefined}
                x={n.x + 7}
                y={y + (dewa ? 57 : 52)}
                data-dxf-max-width={cadCableWidth}
                data-dxf-dy={dewa ? 3 : 0}
                data-dxf-dx={cadCableDx}
                onPointerDown={(e) => onPatchFeeder && e.stopPropagation()}
                onClick={(e) => {
                  if (!onPatchFeeder || tool === 'pan') return;
                  e.stopPropagation();
                  const r = svgRef.current!.parentElement!.getBoundingClientRect();
                  setCableEdit({ id: f.id, x: e.clientX - r.left, y: e.clientY - r.top, size: String(f.cableCsaMm2), cores: String(f.cores), length: String(f.lengthM), runs: String(runsOf(f)), type: f.cableType ?? '' });
                }}
              >
                {onPatchFeeder && <title>Click to change the cable</title>}
                {cableRefs ? `${runsOf(f) > 1 ? `${runsOf(f)}×` : ''}${f.cores}C ${f.cableCsaMm2}mm²${cableTypeOf(project, f).fireRated ? ' *' : ''}` : dewa ? `${runsOf(f) > 1 ? `${runsOf(f)}×` : ''}${f.cores}C ${f.cableCsaMm2}mm² CU/${cableTypeOf(project, f).code}`
                  : <>{runsOf(f) > 1 ? `${runsOf(f)}×` : ''}{f.cores}C × {f.cableCsaMm2}mm²{(() => { const c = labelCode(project, f); return c ? ` ${c}` : ''; })()} · {f.lengthM}m</>}
                {needsFireRated(project, f) && !cableTypeOf(project, f).fireRated && <tspan className="res warn"> ⚠ FR</tspan>}
              </text>
              {cableRefs && (() => { const r = cableRefOf(project, f); return (
                <g className="cable-ref"><title>{`Cable ${r.ref}: ${r.text}`}</title>
                  <circle cx={n.x - 13} cy={y + (dewa ? 64 : 49)} r="7.5" className="cable-ref-c" />
                  <text x={n.x - 13} y={y + (dewa ? 67 : 52)} textAnchor="middle" className="cable-ref-t">{r.ref}</text>
                  <text x={n.x + 7} y={y + (dewa ? 68 : 63)} className="acc-t" style={{ fontSize: 8 }} data-dxf-max-width={cadCableWidth} data-dxf-dx={cadCableDx}>{f.lengthM}m</text>
                </g>); })()}
              {dewa && !cableRefs && <text className="acc-t" style={{ fontSize: 9 }} x={n.x + 7} y={y + 67} data-dxf-max-width={cadCableWidth} data-dxf-dy={3} data-dxf-dx={cadCableDx}>{cableTypeOf(project, f).armoured ? `+1C ${cpcOf(f)}mm² ECC · ` : ''}{f.lengthM}m</text>}
              {/* Accessories on the feeder, top to bottom: earth leakage (its
                  rating goes with the breaker's), metering on the right below
                  the cable text, local isolator just above the load. */}
              {(() => {
                // Boxed devices on the feeder, to the left of the line (the cable text is on the right).
                const dev = sldDevices(f);
                // One compact column left of the line, top to bottom (cable-reference circles sit close in, so shift out).
                const shiftX = cableRefs ? 12 : 0;
                const box = (i: number, label: string, key: string) => {
                  const by = y + 36 + i * 13;
                  const w = label.length * 5.2 + 6;
                  const x1 = n.x - 8 - shiftX;
                  return (
                    <g className="acc" data-dxf-layer="DEVICE" key={key}>
                      <line x1={x1} y1={by + 5.5} x2={n.x} y2={by + 5.5} className="ln" />
                      <rect x={x1 - w} y={by} width={w} height="11" className="sym" />
                      <text x={x1 - w / 2} y={by + 8.5} textAnchor="middle" className="acc-t b" style={{ fontSize: 7.5 }}>{label}</text>
                    </g>
                  );
                };
                const items: { key: string; label: string }[] = [];
                if (dev.elcb) items.push({ key: 'elcb', label: dev.elcb.label });
                if (dev.starter && !n.childBoardId) items.push({ key: 'starter', label: dev.starter });
                for (const e of dev.extras) items.push({ key: e, label: e });
                return (
                  <>
                    {items.map((it, i) => box(i, it.label, it.key))}
                    {dev.elcb && (
                      <g className="acc">
                        <title>{`Earth leakage protection${dev.elcb.ma ? ` ${dev.elcb.ma} mA` : ''}`}</title>
                        <ellipse cx={n.x - 8 - shiftX - dev.elcb.label.length * 5.2 - 6 - 5} cy={y + 41.5} rx="4.5" ry="2.2" className="sym-ln" />
                        {dev.elcb.ma ? <text x={n.x - 8 - shiftX} y={y + 34} textAnchor="end" className="acc-t" style={{ fontSize: 7 }}>{dev.elcb.ma}mA</text> : null}
                      </g>
                    )}
                  </>
                );
              })()}
              {f.kwhMeter && (() => {
                // Sub-board incomers: below their result labels.
                const my = n.childBoardId ? y + 128 + tagY : y + 62;
                return (
                <g className="acc">
                  <title>{f.kwhMeter === 'CT' ? 'CT-operated kWh meter' : `${f.kwhMeter} direct kWh meter`}</title>
                  {f.kwhMeter === 'CT' && <circle cx={n.x} cy={my} r="4.5" className="sym-ln" />}
                  <line x1={n.x + (f.kwhMeter === 'CT' ? 4.5 : 0)} y1={my} x2={n.x + 10} y2={my} className="ln" style={f.kwhMeter === 'CT' ? { strokeDasharray: '2 1.5' } : undefined} />
                  <rect x={n.x + 10} y={my - 6} width="24" height="12" rx="2" className="sym" />
                  <text x={n.x + 22} y={my + 3} textAnchor="middle" className="acc-t b">kWh</text>
                  {f.kwhMeter === 'CT' && <text x={n.x + 37} y={my + 3} className="acc-t">CT</text>}
                </g>
                );
              })()}
              {f.localIsolator && !n.childBoardId && (
                <g className="acc">
                  <title>Local isolator at the equipment</title>
                  <rect x={n.x - 4} y={y + 66} width="8" height="9" className="bg-fill" />
                  <circle cx={n.x} cy={y + 67} r="1.6" className="dot" />
                  <line x1={n.x} y1={y + 75} x2={n.x - 7} y2={y + 67} className="ln" />
                  {dewa ? <text x={n.x + 10} y={y + 79} className="acc-t" style={{ fontSize: 9 }} data-dxf-max-width={cadDeviceWidth}>{f.breakerRatingA}A {dewaPoles(f)} ISOLATOR (W/P)</text> : <text x={n.x - 9} y={y + 74} textAnchor="end" className="acc-t">ISO</text>}
                </g>
              )}
              {!n.childBoardId && (
                <>
                  {iec ? (
                    <>
                      <line x1={n.x} y1={y + 76} x2={n.x} y2={y + 84} className="ln" />
                      <LoadSym x={n.x} y={y + 94} type={loadTypeOf(f)} motor={isMotor(f)} fireFighting={loadTypeOf(f) === 'fire-pump'} />
                    </>
                  ) : (
                    <>
                      <circle cx={n.x} cy={y + 94} r="18" className={`load ${status}`} />
                      <g transform={`translate(${n.x} ${y + 94})`} className={`icon ${status}`}>
                        <LoadIcon type={loadTypeOf(f)} />
                      </g>
                    </>
                  )}
                  <text className="b" x={n.x} y={y + 132} textAnchor="middle">{trunc(f.id, 16)}</text>
                  <text className="m" x={n.x} y={y + 146} textAnchor="middle">{trunc(f.name, 19)}</text>
                  <text x={n.x} y={y + 160} textAnchor="middle" data-fit-width={cadSlot - 6}>
                    {f.componentId && project.components?.some((c) => c.id === f.componentId) ? trunc(componentLabel(project, project.components!.find((c) => c.id === f.componentId)!, f), 30) : f.kvar ? `${f.capSteps && f.capSteps > 1 ? `${f.capSteps} × ${+(f.kvar / f.capSteps).toFixed(1)}` : f.kvar} kvar${f.detunedPct ? ` · ${f.detunedPct}% det.` : ''}` : `${dewa && !f.generation ? `TCL : ${f.loadKw.toFixed(2)}` : (f.loadKw * f.demandFactor).toFixed(0)} kW${f.generation ? ' gen' : ''}${isMotor(f) ? ` · ${starterInfo(starterOf(f)).short}` : ''}`}
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
                  <text key={t.text} x={n.x + 7} y={y + 72 + tagY + i * 13} className={`res ${t.cls}`}>{t.text}</text>
                ))}
              {sel && <rect x={n.x - 60} y={y + 8} width="120" height={n.childBoardId ? 50 : 160} rx="8" className="sel-ring" />}
            </g>
          );
        })}

        {/* Boards: box on the incoming line, then the busbar */}
        {layout.boards.map((n) => {
          if (cull && (n.busX2 < viewX1 || n.busX1 > viewX2)) return null;
          const b = n.board;
          const s = summaries.get(b.id)!;
          const status = worst([s.loadingStatus, ...(feedersOn.get(b.id) ?? []).map((f) => byFeeder.get(f.id)?.status)]);
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
              onMouseEnter={showCard('board', b.id)}
              onMouseLeave={leaveCard}
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
              {b.standby && (() => {
                // ATS (one box on the incoming line) or two ACBs, mains and
                // generator, mechanically / electrically interlocked.
                const acb = b.standby.changeover === 'ACB';
                const gx = acb ? n.x + 67 : n.x + 45;
                const gy = n.busY - (acb ? 72 : 80);
                const g = scenario?.generators.find((x) => x.boardId === b.id);
                const cls = g ? (g.loadingPct > 100 ? 'bad' : g.loadingPct > 80 ? 'warn' : 'ok') : '';
                const m = g?.largestMotor;
                return (
                  <g className="standby">
                    <title>{`Standby generator ${b.standby.kva} kVA through ${acb ? 'interlocked mains and generator ACBs' : 'an ATS'} — everything on ${b.id} is essential load`}</title>
                    {acb ? (
                      <>
                        <rect x={n.x - 2} y={n.busY - 89} width="4" height="13" className="bg-fill" />
                        <SwitchSym x={n.x} y={n.busY - 92} kind="acb" />
                        <line x1={n.x} y1={gy} x2={n.x + 18} y2={gy} className="ln" />
                        <rect x={n.x + 18} y={gy - 6} width="20" height="12" rx="1" className="sym" />
                        <path d={`M${n.x + 24} ${gy - 3} l8 6 M${n.x + 32} ${gy - 3} l-8 6`} className="ln" />
                        <line x1={n.x + 38} y1={gy} x2={gx - 11} y2={gy} className="ln" />
                        <path d={`M${n.x + 7} ${n.busY - 84} L${n.x + 28} ${n.busY - 84} L${n.x + 28} ${gy - 6}`} className="ln interlock" />
                        <text x={n.x + 9} y={n.busY - 76} className="acc-t b">IL</text>
                      </>
                    ) : (
                      <>
                        <rect x={n.x - 11} y={n.busY - 88} width="22" height="15" rx="2" className="sym" />
                        <text x={n.x} y={n.busY - 77} textAnchor="middle" className="b" style={{ fontSize: 8 }}>ATS</text>
                        <line x1={n.x + 11} y1={gy} x2={gx - 11} y2={gy} className="ln" />
                      </>
                    )}
                    <circle cx={gx} cy={gy} r="11" className="sym" />
                    <text x={gx} y={gy + 4} textAnchor="middle" className="b" style={{ fontSize: 11 }}>G</text>
                    <text x={gx + 15} y={gy + 3} className="m">{b.standby.kva} kVA</text>
                    {g && (
                      <>
                        <circle cx={gx} cy={gy} r="14" className="gen-live" />
                        <text x={gx + 15} y={gy - 10} className={`res ${cls}`}>ON · {g.loadingPct.toFixed(0)}% loaded</text>
                        {m && (
                          <text x={gx + 15} y={gy + 16} className={`res ${m.dipPct > MOTOR_START_DIP_LIMIT_PCT ? 'bad' : 'ok'}`}>
                            {m.feeder.name || m.feeder.id} start: dip {m.dipPct.toFixed(0)}%
                          </text>
                        )}
                      </>
                    )}
                  </g>
                );
              })()}
              {(() => {
                // Incomer CT, long-time setting and protection relays.
                const p = protectionOf(b);
                if (!p) return null;
                const cy = n.busY - 66;
                const txt = [p.ctRatio && `CT ${p.ctRatio}`, p.irSetting && `Ir ${p.irSetting}×In`, ...(p.relays ?? [])].filter(Boolean).join(' · ');
                const cap = p.apfc ? layout.feeders.find((x) => x.feeder.boardId === b.id && loadTypeOf(x.feeder) === 'capacitor') : undefined;
                return (
                  <g className="acc">
                    <title>{`Incomer: ${txt}${p.apfc ? ' · APFC relay CT' : ''}`}</title>
                    <circle cx={n.x} cy={cy} r="4.5" className="sym-ln" />
                    <line x1={n.x - 4.5} y1={cy} x2={n.x - 14} y2={cy} className="ln" style={{ strokeDasharray: '2 1.5' }} />
                    <text x={n.x - 16} y={cy + 3} textAnchor="end" className="acc-t">{txt}</text>
                    {cap && (
                      <>
                        <path d={`M${n.x + 4.5} ${cy} H${cap.x - 22} V${n.busY + 22}`} className="ln interlock" />
                        <rect x={cap.x - 31} y={n.busY + 22} width="18" height="11" rx="1" className="sym" />
                        <text x={cap.x - 22} y={n.busY + 30} textAnchor="middle" className="acc-t b">PFR</text>
                      </>
                    )}
                  </g>
                );
              })()}
              {b.kind === 'UPS' && (
                <g>
                  <title>{`UPS ${b.upsKva ?? '—'} kVA`}</title>
                  <rect x={n.x - 15} y={n.busY - 118} width="30" height="17" rx="2" className="sym" />
                  <text x={n.x} y={n.busY - 106} textAnchor="middle" className="b" style={{ fontSize: 9 }}>UPS</text>
                </g>
              )}
              {dewa && !n.terminal && (() => {
                // Panel frame: busbar, outgoing ways and incomer; cables cross it at a gland mark.
                const x1 = n.busX1 - 7, x2 = n.busX2 + 7, y1 = n.busY - 84, y2 = n.busY + 47;
                const gland = (x: number, gy: number) => <path key={`${x}-${gy}`} d={`M${x - 5} ${gy - 4} q3 4 0 8 M${x + 5} ${gy - 4} q-3 4 0 8`} className="ln" />;
                const outs = layout.feeders.filter((f) => f.feeder.boardId === b.id);
                return (
                  <g className="panel-frame">
                    <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} className="frame-ln" />
                    {gland(n.x, y1)}
                    {outs.map((f) => gland(f.x, y2))}
                  </g>
                );
              })()}
              {dewa && (() => {
                // Summary box: name, LOC, TCL, DF, MDL = TCL × DF (the panel's own DF).
                const sm = panelSummary(project, b);
                const bx = n.x + 12, by = n.terminal ? n.busY - 150 : n.busY - 160;
                const lines = [`LOC : ${trunc(boardLocation(project, b) || '—', 16)}`, `TCL : ${sm.tclKw.toFixed(2)} kW`, `DF : ${sm.df.toFixed(2)}`, `MDL : ${sm.mdlKw.toFixed(2)} kW`];
                return (
                  <g className="panel-sum">
                    <title>{`${b.id}: TCL ${sm.tclKw.toFixed(2)} kW × DF ${sm.df.toFixed(2)} = MDL ${sm.mdlKw.toFixed(2)} kW`}</title>
                    <rect x={bx} y={by} width="118" height="70" rx="6" className="sum-box" />
                    <text x={bx + 6} y={by + 13} className="b" style={{ textDecoration: 'underline' }}>{trunc(b.id, 16)}</text>
                    {lines.map((t, i) => <text key={i} x={bx + 6} y={by + 27 + i * 12} className="acc-t">{t}</text>)}
                  </g>
                );
              })()}
              {incomerDeviceOf(b) && !b.standby && (() => {
                const dev = incomerDeviceOf(b)!;
                // Incomer switching device on the line above the name box.
                const kind = dev === 'ISOL' ? 'isolator' : dev === 'ACB' ? 'acb' : dev === 'MCCB-NA' ? 'nonauto' : 'breaker';
                const sy = n.busY - (protectionOf(b) ? 92 : 84);
                return (
                  <g className="acc">
                    <title>{`Incomer: ${INCOMER_DEVICES.find((d) => d.value === dev)!.label}`}</title>
                    <rect x={n.x - 2} y={sy - 1} width="4" height="19" className="bg-fill" />
                    <SwitchSym x={n.x} y={sy} kind={kind} />
                    <text x={n.x + 12} y={sy + 11} className="acc-t b">{`${b.ratedCurrentA ? `${b.ratedCurrentA} A ` : ''}${dev === 'MCCB-NA' ? 'MCCB (NA)' : dev}`}</text>
                  </g>
                );
              })()}
              <rect x={n.x - 62} y={n.busY - 58} width="124" height="36" rx="6" className="box" style={sel ? { stroke: 'var(--acc)', strokeWidth: 2 } : undefined} />
              <text className="b" x={n.x - 54} y={n.busY - 42}>{trunc(b.id, 14)}</text>
              <text className="m" x={n.x - 54} y={n.busY - 28}>
                {b.kind ?? (b.upstreamId ? 'DB' : 'MDB')}
                {b.ratedCurrentA ? ` · ${b.ratedCurrentA} A` : ''}
              </text>
              <circle cx={n.x + 52} cy={n.busY - 46} r="4" style={{ fill: `var(--${status})` }} />
              {hasInstruments(b) && !n.terminal && (() => {
                // Ammeter and voltmeter with selector switches, R-Y-B lamps: inside the panel, left of the board box.
                const room = n.x - 66 - n.busX1;
                const x0 = room >= 50 ? n.busX1 + 2 : n.busX1 - 52;
                const y0 = n.busY - 52;
                const meter = (x: number, t: string) => (
                  <g key={t}>
                    <rect x={x} y={y0} width="16" height="14" className="sym" />
                    <text x={x + 8} y={y0 + 11} textAnchor="middle" className="acc-t b">{t}</text>
                    <rect x={x - 1} y={y0 + 16} width="18" height="10" className="sym" />
                    <text x={x + 8} y={y0 + 24} textAnchor="middle" className="acc-t" style={{ fontSize: 7 }}>S/S</text>
                  </g>
                );
                return (
                  <g className="acc instruments">
                    <title>Ammeter and voltmeter with selector switches, R-Y-B indicating lamps</title>
                    {meter(x0 + 2, 'A')}
                    {meter(x0 + 24, 'V')}
                    {['R', 'Y', 'B'].map((ph, i) => (
                      <g key={ph}>
                        <circle cx={x0 + 7 + i * 15} cy={y0 + 38} r="5.5" className="sym" />
                        <text x={x0 + 7 + i * 15} y={y0 + 41} textAnchor="middle" className="acc-t" style={{ fontSize: 7 }}>{ph}</text>
                      </g>
                    ))}
                  </g>
                );
              })()}
              {b.spd && (
                <g className="acc">
                  <title>{`Surge protection device, Type ${b.spd === 'T1+2' ? '1+2' : b.spd.slice(1)}`}</title>
                  {(() => {
                    // On the busbar's right end (or under the board box when it has no busbar).
                    const sx = n.terminal ? n.x - 40 : n.busX2 - 8;
                    const sy = n.terminal ? n.busY - 22 : n.busY;
                    return (
                      <>
                        <line x1={sx} y1={sy} x2={sx} y2={sy - 12} className="ln" />
                        <rect x={sx - 6} y={sy - 26} width="12" height="14" className="sym" />
                        <path d={`M${sx + 2} ${sy - 24} l-3 5 h3 l-3 5`} className="sym-ln" />
                        <line x1={sx} y1={sy - 26} x2={sx} y2={sy - 31} className="ln" />
                        <line x1={sx - 6} y1={sy - 31} x2={sx + 6} y2={sy - 31} className="ln" />
                        <line x1={sx - 4} y1={sy - 34} x2={sx + 4} y2={sy - 34} className="ln" />
                        <line x1={sx - 2} y1={sy - 37} x2={sx + 2} y2={sy - 37} className="ln" />
                        <text x={sx - 9} y={sy - 16} textAnchor="end" className="acc-t">SPD {b.spd === 'T1+2' ? 'T1+2' : b.spd}</text>
                      </>
                    );
                  })()}
                </g>
              )}
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
        {legend.length > 0 && (
          <g className="legend" transform={`translate(${layout.width + 10} 30)`}>
            <rect x="0" y="0" width={legendW} height={46 + legend.length * LEGEND_ROW} rx="4" className="legend-box" />
            <text x="12" y="22" className="b">LEGEND</text>
            <line x1="0" y1="32" x2={legendW} y2="32" className="ln" />
            {legend.map((e, i) => (
              <g key={e.key}>
                {e.draw(LEGEND_SYM_X, 32 + 20 + i * LEGEND_ROW)}
                <text x={LEGEND_TEXT_X} y={32 + 24 + i * LEGEND_ROW} className="legend-t">{e.label}</text>
              </g>
            ))}
          </g>
        )}
        {(outlines ?? []).map((o, i) => {
          const r = boardsBox(o.boards, 8 + (i % 3) * 6);
          if (!r) return null;
          return (
            <g key={o.id} className={`sheet-outline${overOutline === o.id ? ' over' : ''}`} onClick={(e) => { if (!onOutline) return; e.stopPropagation(); onOutline(o.id); }}>
              <title>{`${o.label} — click to open the sheet`}</title>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="10" style={{ stroke: o.color }} />
              <text x={r.x + 8} y={r.y + 16} style={{ fill: o.color }}>{o.label}</text>
            </g>
          );
        })}
        {(clouds ?? []).map((c, i) => {
          const r = boardsBox(c.boards, 12);
          if (!r) return null;
          return (
            <g key={i} className="rev-cloud">
              <path d={cloudPath(r.x, r.y, r.w, r.h)} />
              <path d={`M${r.x + r.w - 6} ${r.y - 4} l12 -20 l12 20 z`} className="rev-tri" />
              <text x={r.x + r.w + 6} y={r.y - 9} textAnchor="middle" className="b">{c.rev}</text>
            </g>
          );
        })}
        {(arrows ?? []).map((a, i) => {
          let ax: number | undefined, ay: number | undefined;
          if (a.target.startsWith('f:')) {
            const fn = layout.feeders.find((n) => n.feeder.id === a.target.slice(2));
            if (fn) { ax = fn.x; ay = fn.busY + 46; }
          } else {
            const bn = layout.boards.find((n) => n.board.id === a.target);
            if (bn) { ax = bn.x + (a.dir.endsWith('e') ? 62 : -62); ay = bn.busY - 40; }
          }
          if (ax === undefined || ay === undefined) return null;
          const L = a.len ?? 80;
          const tx = ax + (a.dir.endsWith('e') ? L : -L), ty = ay + (a.dir.startsWith('n') ? -L * 0.7 : L * 0.7);
          const ang = Math.atan2(ay - ty, ax - tx);
          const head = (d: number) => `${ax! - 9 * Math.cos(ang + d)},${ay! - 9 * Math.sin(ang + d)}`;
          const right = a.dir.endsWith('e');
          return (
            <g key={i} className="callout">
              <line x1={tx} y1={ty} x2={ax} y2={ay} className="ln" />
              <polygon points={`${ax},${ay} ${head(0.4)} ${head(-0.4)}`} className="callout-head" />
              <line x1={tx} y1={ty} x2={tx + (right ? 10 : -10)} y2={ty} className="ln" />
              <text x={tx + (right ? 14 : -14)} y={ty + 4} textAnchor={right ? 'start' : 'end'} className="b callout-t">{a.text}</text>
            </g>
          );
        })}
        {insertAt && hover === `bus:${insertAt.boardId}` && (() => {
          const n = layout.boards.find((b) => b.board.id === insertAt.boardId);
          if (!n) return null;
          return (
            <g className="insert-guide" pointerEvents="none">
              <line x1={insertAt.x} y1={n.busY - 16} x2={insertAt.x} y2={n.busY + 96} />
              <circle cx={insertAt.x} cy={n.busY} r="4.5" />
            </g>
          );
        })()}
      </svg>
      {colorBy !== 'none' && (
        <div className="heat-legend">
          <b>{COLOR_BY.find((c) => c.value === colorBy)?.label}</b>
          <div className="heat-bar" />
          <div className="heat-ticks"><span>0</span><span>50%</span><span>85%</span><span>≥100% of limit</span></div>
          <span className="m">{COLOR_BY.find((c) => c.value === colorBy)?.legend}</span>
        </div>
      )}
      {scenario?.outage && (
        <div className={`mode-banner${scenario.outage.tie ? '' : ' bad'}`}>
          {scenario.outage.tie
            ? `Transformer of ${scenario.outage.failedId} failed — ${scenario.outage.tie.id} closed; ${scenario.outage.tie.fromId}'s transformer carries both`
            : `Transformer of ${scenario.outage.failedId} failed — no bus tie: ${scenario.outage.failedId} and everything below it is off`}
        </div>
      )}
      {scenario && !scenario.outage && (
        <div className="mode-banner">
          {scenario.generators.length
            ? `On generator: ${scenario.generators.map((g) => `${g.boardId} ${g.kva} kVA`).join(', ')} — mains lost, ATS changed over; dimmed boards are off`
            : 'No standby generator in this project — drop “Generator + ATS” on a board'}
        </div>
      )}
      {moving && <div className="move-ghost" style={{ left: moving.x + 14, top: moving.y + 10 }}>Move {moving.label}{hover ? '' : ' — drop on a busbar or feeder'}</div>}
      {card && !moving && !cableEdit && (() => {
        const W = 270;
        const host = svgRef.current?.parentElement?.getBoundingClientRect();
        const left = Math.max(4, Math.min(card.x + 16, (host?.width ?? 800) - W - 4));
        const top = Math.max(4, Math.min(card.y + 14, (host?.height ?? 600) - 230));
        const keep = { onMouseEnter: () => clearTimeout(hideCard.current), onMouseLeave: leaveCard };
        if (card.kind === 'board') {
          const b = project.boards.find((x) => x.id === card.id);
          if (!b) return null;
          const sm = boardSummary(calcProject ?? project, b);
          const a = annotations?.boards[b.id];
          const vp = a?.voltagePct ?? sm.voltagePct;
          return (
            <div className="hover-card" style={{ left, top, width: W }} {...keep}>
              <div className="hc-head"><b>{b.id}</b> <span className="m">{b.kind ?? (b.upstreamId ? 'DB' : 'MDB')}{b.ratedCurrentA ? ` · ${b.ratedCurrentA} A` : ''}</span></div>
              <dl className="hc-kv">
                <dt>Voltage</dt><dd className={a?.voltageStatus ?? ''}>{((project.voltageV * vp) / 100).toFixed(0)} V ({vp.toFixed(1)} %)</dd>
                <dt>Fault level Ik″</dt><dd>{(a?.faultKA ?? sm.faultKA).toFixed(1)} kA</dd>
                <dt>Demand</dt><dd>{sm.demandKw.toFixed(1)} kW · {sm.currentA.toFixed(0)} A</dd>
                <dt>Loading</dt><dd className={sm.loadingStatus ?? ''}>{sm.loadingPct === undefined ? 'no rating' : `${sm.loadingPct.toFixed(0)} %`}</dd>
                <dt>TCL × DF = MDL</dt><dd>{(() => { const p = panelSummary(project, b); return `${p.tclKw.toFixed(1)} × ${p.df.toFixed(2)} = ${p.mdlKw.toFixed(1)} kW`; })()}</dd>
              </dl>
            </div>
          );
        }
        const f = project.feeders.find((x) => x.id === card.id);
        const r = f && byFeeder.get(f.id);
        if (!f || !r) return null;
        const reasons = r.status === 'ok' ? [] : failReasons(calcProject ?? project, r);
        const fixes = onFixFeeder && r.status !== 'ok' ? quickFixes(calcProject ?? project, f) : [];
        return (
          <div className={`hover-card ${r.status}`} style={{ left, top, width: W }} {...keep}>
            <div className="hc-head"><b>{f.id}</b> <span className="m">{f.name}</span><span className={`hc-st ${r.status}`}>{STATUS_TEXT[r.status]}</span></div>
            <dl className="hc-kv">
              <dt>Cable</dt><dd>{runsOf(f) > 1 ? `${runsOf(f)}× ` : ''}{f.cores}C {f.cableCsaMm2} mm² · {f.lengthM} m</dd>
              <dt>Ib / In / Iz</dt><dd className={r.protectionStatus === 'bad' || r.ampacityStatus === 'bad' ? 'bad' : ''}>{r.ib.toFixed(0)} / {f.breakerRatingA} / {r.ampacity.toFixed(0)} A</dd>
              <dt>Voltage drop</dt><dd className={r.vdStatus}>{r.vdPct.toFixed(2)} % cable · {r.vdTotalPct.toFixed(2)} % total</dd>
              <dt>Fault / Icu</dt><dd className={r.icuStatus === 'bad' ? 'bad' : ''}>{r.breakerFaultKA.toFixed(1)} kA / {f.breakerIcuKa} kA</dd>
            </dl>
            {reasons.length > 0 && <ul className="hc-why">{reasons.map((t) => <li key={t}>{t}</li>)}</ul>}
            {fixes.length > 0 && (
              <div className="hc-fix">
                <span className="m">Quick fix:</span>
                {fixes.map((x) => (
                  <button key={x.label} className={`chip ${x.after.status}`} title={`After: Vd ${x.after.vdTotalPct.toFixed(2)} %, Iz ${x.after.ampacity.toFixed(0)} A — ${x.after.status === 'ok' ? 'passes' : 'still to check'}`}
                    onClick={() => { onFixFeeder!(f.id, x.patch, x.label); setCard(null); }}>{x.label}</button>
                ))}
              </div>
            )}
          </div>
        );
      })()}
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
          <label>Type
            <select value={cableEdit.type} onChange={(e) => setCableEdit({ ...cableEdit, type: e.target.value })}>
              {(() => { const f = project.feeders.find((x) => x.id === cableEdit.id); return <option value="">Auto — {f ? cableTypeOf(project, f).label : ''}</option>; })()}
              {CABLE_TYPE_DEFS.filter((d) => d.value !== 'XLPE/SWA/PVC').map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
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

/** The symbol legend on its own (the drawing sheets' legend column). */
export function LegendSvg({ project }: { project: Project }) {
  const legend = legendEntries(project);
  if (!legend.length) return null;
  const h = 46 + legend.length * LEGEND_ROW;
  const W = legendWidth(legend);
  return (
    <div className="sysdiag">
      <svg viewBox={`0 0 ${W} ${h}`} width={W} height={h} data-w={W} data-h={h}>
        <g className="legend">
          <rect x="0" y="0" width={W} height={h} rx="4" className="legend-box" />
          <text x="12" y="22" className="b">LEGEND</text>
          <line x1="0" y1="32" x2={W} y2="32" className="ln" />
          {legend.map((e, i) => (
            <g key={e.key}>
              {e.draw(LEGEND_SYM_X, 32 + 20 + i * LEGEND_ROW)}
              <text x={LEGEND_TEXT_X} y={32 + 24 + i * LEGEND_ROW} className="legend-t">{e.label}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

/** A revision cloud: arcs along a rectangle. */
function cloudPath(x: number, y: number, w: number, h: number): string {
  const step = 18;
  const nx = Math.max(2, Math.round(w / step)), ny = Math.max(2, Math.round(h / step));
  const sx = w / nx, sy = h / ny;
  let d = `M${x} ${y}`;
  for (let i = 0; i < nx; i++) d += ` a${sx / 2} ${sx / 2} 0 0 1 ${sx} 0`;
  for (let i = 0; i < ny; i++) d += ` a${sy / 2} ${sy / 2} 0 0 1 0 ${sy}`;
  for (let i = 0; i < nx; i++) d += ` a${sx / 2} ${sx / 2} 0 0 1 ${-sx} 0`;
  for (let i = 0; i < ny; i++) d += ` a${sy / 2} ${sy / 2} 0 0 1 0 ${-sy}`;
  return `${d} z`;
}
