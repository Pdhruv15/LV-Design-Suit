import { useEffect, useMemo, useRef, useState } from 'react';
import CadCanvas, { type CadMarks, type CadToggles, type CanvasDevice } from './CadCanvas';
import { NO_ACTIONS, rememberedDrawing, SAMPLE_PLANS, type CadState, type CadTool } from './cadState';
import { chooseDrawing, drawingWithDevices, reopenDrawing, sampleDrawing, type CadObject, type CadView } from '../../engines/cad/cadEngine';
import { cableLabel, cablesOf, circuitLabel, finalCircuits, LV_PALETTE, moveItem, placedOn, placeItem, placeLvPoint, removeItem, type PaletteItem, type PlacedItem } from '../../model/cadDevices';
import { addSketch, arcThrough, dimensionLines, itemAt, moved, rectangle, removeSketch, rotated, segmentsOf, shapesOut, sketchOf, snapPoints, trayLength, TRAY_LAYER, TRAY_WIDTHS, typedPoint, updateSketch } from '../../model/cadSketch';
import { trayPlanOf } from '../../calc/cableTray';
import { fittingCounts, trayFittings, type TrayFitting } from '../../model/cadTrayFittings';
import type { SketchItem } from '../../types';
import { ELV_PALETTE, elvPlacedOn, elvSystemOf, moveElv, placeElv, removeElv } from '../../components/elv/elvCadDevices';
import { copyTo, coverageNote, elvLayer, fillAt, rotate as rotateElv, SYSTEM_LABEL } from '../../components/elv/elvPlan';
import { saveBinary } from '../../util/files';
import { angleDeg, areaOf, distance, inside, m, m2, roomAround, segmentsOn } from '../../model/cadMeasure';
import { layerMapFor, layersWith, roomsFromPlan, withLayerMap } from '../../model/cadRooms';
import { layerStatsOf, objectPath, planOfView } from '../../model/cadViewPlan';
import { planDrawings, scheduleSummary, updateSchedules } from '../../model/cadPlanSchedules';
import { buildingInfoOf } from '../../calc/building';
import { plansOf } from '../../model/cadPlans';
import { CAD_UNITS, planScale } from '../../model/cadUnits';
import CadLayerTable from '../CadLayerTable';
import { planLevel, setPlanLevel } from './cadFileMenu';
import { pathOfPlan } from './cadState';
import { pickedRoom, putRooms, renameRoom } from '../../model/floorPlanActions';
import { floorLabel, floorList } from '../../model/levels';
import type { CadLayerMap, CadLayerRole, Project } from '../../types';

type Pt = [number, number];
type Result =
  | { kind: 'dist'; a: Pt; b: Pt }
  | { kind: 'area'; points: Pt[]; how: 'corners' | 'object' | 'room' | 'trace'; name?: string }
  | { kind: 'object'; o: CadObject }
  | { kind: 'device'; it: PlacedItem }
  | { kind: 'sketch'; it: SketchItem };

const hex = (rgb: number) => (rgb === 0xff000007 ? 'var(--cad-ink)' : `#${rgb.toString(16).padStart(6, '0')}`);
const TOGGLES: { k: keyof CadToggles; label: string; key: string }[] = [
  { k: 'snap', label: 'SNAP', key: 'F9' }, { k: 'osnap', label: 'OSNAP', key: 'F3' }, { k: 'ortho', label: 'ORTHO', key: 'F8' }, { k: 'grid', label: 'GRID', key: 'F7' }
];
const HELP = 'Commands: OPEN · SAVE (DXF) · ROOMS (add found rooms) · RA (click inside a room) · TR (trace a room) · PN (pick its name) · CT (cable tray run) · CR (cable route) · LR (link a line as a cable route) · SCHED (update schedules) · FILL (fill a room with an ELV device) · COV (coverage) · L (line) · PL (polyline, C closes) · REC · C (circle) · A (arc, 3 points) · T (text) · DIM · M (move) · CO (copy) · RO (rotate) · E (erase) · DI (distance) · AREA (O = object) · RA (room area) · DEV (add device) · M (move) · E (delete) · LI (inspect) · FIT (ZE) · LAYER · OSNAP (F3) · GRID (F7) · ORTHO (F8) · SNAP (F9) · Esc cancels, Enter closes an area.';
/** Device symbol size on the plan (radius, metres). */
const DEVICE_R_M = 0.2;
const PROMPT: Record<CadTool, string> = {
  none: 'Click an object to see what it is.',
  dist: 'DI  Specify first point:',
  area: 'AREA  Specify first corner point or [Object]:',
  room: 'ROOM  Click inside a room (its outline comes from the walls):',
  trace: 'TRACE  Specify first corner of the room:',
  name: 'NAME  Click the room name on the drawing:',
  tray: 'TRAY  Specify start point of the tray run:',
  cable: 'ROUTE  Specify start point of the cable route:',
  link: 'LINK  Click a line of the drawing: it becomes the cable route:',
  dev: 'DEV  Specify insertion point:',
  fill: 'FILL  Click inside a room: the ELV device chosen is placed at its coverage spacing:',
  move: 'MOVE  Select object, then specify base point:',
  copy: 'COPY  Select object, then specify base point:',
  rotate: 'ROTATE  Select object, then specify base point:',
  line: 'LINE  Specify first point:',
  pline: 'PLINE  Specify start point:',
  rect: 'RECTANG  Specify first corner point:',
  circle: 'CIRCLE  Specify center point:',
  arc: 'ARC  Specify start point:',
  text: 'TEXT  Specify start point of text:',
  dim: 'DIM  Specify first extension line origin:'
};
/** Layer of the cable routes drawn or linked in the app. */
const CABLE_LAYER = 'E-CABLE';
/** The smallest room of a level whose outline (metres) is around a point (drawing units, `k` metres per unit). */
function roomAtPointOf(p: Project, f: { ref: { building: string; level: string } }, at: Pt, k: number) {
  return buildingInfoOf(p).rooms
    .filter((r) => r.buildingId === f.ref.building && r.levelId === f.ref.level && (r.outline?.length ?? 0) >= 3 && inside([at[0] * k, at[1] * k], r.outline!))
    .sort((a, b) => a.areaM2 - b.areaM2)[0];
}
const pathLength = (pts: Pt[]) => pts.slice(1).reduce((t, q, i) => t + distance(pts[i], q), 0);
/** Layers for what is drawn in the app (written into the DXF on save). */
const DRAW_LAYER = 'LV-SKETCH', ANNO_LAYER = 'LV-ANNO';
const DRAW_TOOLS: CadTool[] = ['line', 'pline', 'tray', 'cable', 'rect', 'circle', 'arc', 'text', 'dim', 'move', 'copy', 'rotate'];

/** The CAD view: a DWG / DXF drawing opened natively, as a CAD program shows it — model space, crosshair, snaps, layers,
 * a command line and a status bar. Engine in Rust (WebAssembly), desktop and web alike. Measure a distance, an area (by
 * corners, a closed object, or inside a room), and click any object to see what it is. */
export default function CadPage({ cad, project, onChange, onStatus }: {
  cad: CadState;
  project: Project;
  onChange: (next: Project, message: string) => void;
  onStatus: (m: string) => void;
}) {
  const { view, tool } = cad;
  const [cursor, setCursor] = useState<{ at: Pt | null; snap?: string }>({ at: null });
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState<Pt[]>([]);
  const [objectMode, setObjectMode] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const last = rememberedDrawing(project.id);
  const units = planScale(project, view?.file, view?.info.units);
  const toM = (v: number) => v * units.factor;
  const toM2 = (v: number) => v * units.factor * units.factor;

  async function load(read: () => Promise<CadView | null>, missing?: string) {
    setBusy(true);
    try {
      const v = await read();
      if (v) { cad.open(v); onStatus(`${v.file} opened`); setResult(null); setPoints([]); } else if (missing) cad.say(missing);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      cad.say(msg); onStatus(msg);
    } finally { setBusy(false); }
  }
  const openFile = () => void load(() => chooseDrawing());

  // While no drawing is open (and none to reopen), the sample villa is shown — a test aid (SAMPLE_PLANS).
  const tried = useRef(false);
  useEffect(() => {
    if (view || tried.current || last || !SAMPLE_PLANS.length) return;
    tried.current = true;
    void load(() => sampleDrawing(SAMPLE_PLANS[0].file));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the page first shows no drawing

  // A tool chosen (ribbon or command line): start it afresh and say what it asks for.
  useEffect(() => { setPoints([]); setObjectMode(false); cad.setTextAt(null); cad.say(`Command: ${PROMPT[tool]}`); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Layer roles (File → Layer roles): the project's, else a guess from the layer's name and what it holds.
  const layerStats = useMemo(() => (view ? layerStatsOf(view) : []), [view]);
  const roles = useMemo(() => layerMapFor(project, layerStats), [project, layerStats]);
  // Walls for Room area: shown layers whose role is Wall, else every shown layer.
  const walls = useMemo(() => {
    if (!view) return [];
    const wallNames = layersWith(roles, 'wall');
    const shown = view.info.layers.map((_, i) => i).filter((i) => cad.layersOn[i]);
    const named = shown.filter((i) => wallNames.has(view.info.layers[i].name.toLowerCase()));
    return segmentsOn(view.segs, view.segLayers, view.info.origin, new Set(named.length ? named : shown));
  }, [view, cad.layersOn, roles]);

  // Devices are kept per level, in metres on its plan: the level this drawing shows, and what is placed on it.
  const floors = floorList(project.building).filter((f) => !f.ref.index);
  const { floor, set: levelSet } = planLevel(project, view?.file);
  const plans = plansOf(project);
  const placed: PlacedItem[] = useMemo(() => (floor ? [...placedOn(project, floor.ref), ...elvPlacedOn(project, floor.ref)] : []), [project, floor]);
  const palette: PaletteItem[] = [...LV_PALETTE, ...ELV_PALETTE];
  const item = palette.find((x) => x.id === cad.device) ?? palette[0];
  const circuits = useMemo(() => finalCircuits(project), [project]);
  const selectedItem = placed.find((d) => d.key === cad.selected) ?? null;
  // What the engineer drew on this drawing (drawing units), its snap points, and the drawn object selected.
  const sketch = useMemo(() => (view ? sketchOf(project, view.file) : []), [project, view]);
  const sketchSnaps = useMemo(() => snapPoints(sketch), [sketch]);
  const selSketch = sketch.find((it) => `sk:${it.id}` === cad.selected) ?? null;
  const fittings = useMemo(() => trayFittings(sketch, 0.001 / units.factor).fittings, [sketch, units.factor]);
  const cables = useMemo(() => cablesOf(project), [project]);
  // ELV: the device chosen (if an ELV one), its system for coverage and Copy to level, and the coverage / Fill preview.
  const elvItem = ELV_PALETTE.find((e) => e.id === cad.device);
  const elvSystem = elvSystemOf(elvItem?.kind.elv ?? 'smoke-detector');
  const fillRoom = tool === 'fill' && cursor.at && floor ? roomAtPointOf(project, floor, cursor.at, units.factor)?.id : undefined;
  const elv = useMemo(() => (floor && (cad.coverage || fillRoom) ? elvLayer(project, { building: floor.ref.building, level: floor.ref.level }, units.factor, {
    system: elvSystem, coverage: cad.coverage, selected: null,
    ...(fillRoom && elvItem && cursor.at ? { preview: { type: elvItem.kind.elv, at: [cursor.at[0] * units.factor, cursor.at[1] * units.factor] as Pt } } : {})
  }) : undefined), [project, floor?.key, elvSystem, cad.coverage, fillRoom, elvItem?.id, units.factor]); // eslint-disable-line react-hooks/exhaustive-deps -- the preview follows the room under the pointer, not every move
  const cableLabels = useMemo(() => Object.fromEntries(sketch.filter((it) => it.cable).map((it) => {
    const f = project.feeders.find((x) => x.id === it.cable!.feederId);
    return [it.id, f ? cableLabel(project, f).split(' · ')[0] : `${it.cable!.feederId} (removed)`];
  })), [sketch, project]);
  const textH = 0.25 / units.factor;
  const rUnits = DEVICE_R_M / units.factor;
  const ghosts: CanvasDevice[] = (elv?.symbols ?? []).filter((x) => x.ghost).map((x, i) => ({ key: `ghost${i}`, x: x.at[0], y: x.at[1], r: rUnits, shape: x.shape, text: x.text, label: '', elv: true, ghost: true }));
  const devices: CanvasDevice[] = cad.showDevices ? [...ghosts, ...placed.map((d) => ({
    key: d.key, x: d.x / units.factor, y: d.y / units.factor, r: d.what === 'board' ? rUnits * 2 : rUnits, shape: d.symbol.shape, text: d.symbol.text,
    label: d.what === 'lv' ? d.detail.split(' · ')[0] : d.what === 'board' ? d.label : '', selected: d.key === cad.selected, elv: d.what === 'elv'
  }))] : ghosts;
  const deviceAt = (at: Pt, pixel: number) => {
    let best: { d: PlacedItem; dist: number } | undefined;
    for (const d of placed) {
      const dist = distance(at, [d.x / units.factor, d.y / units.factor]);
      if (dist <= Math.max(rUnits * (d.what === 'board' ? 2 : 1), 8 * pixel) && (!best || dist < best.dist)) best = { d, dist };
    }
    return best?.d;
  };
  const change = (next: Project, message: string) => { onChange(next, message); cad.say(message); };
  function removeSelected() {
    if (selSketch && view) { change(removeSketch(project, view.file, selSketch.id), `${selSketch.tray ? 'Cable tray' : selSketch.cable ? 'Cable route' : selSketch.kind === 'pline' ? 'Polyline' : selSketch.kind[0].toUpperCase() + selSketch.kind.slice(1)} erased · ⌘Z to undo`); cad.setSelected(null); setResult(null); return; }
    if (!selectedItem) { cad.say('ERASE  Select an object first (click it).'); return; }
    change(selectedItem.what === 'elv' ? removeElv(project, selectedItem.id) : removeItem(project, selectedItem), `${selectedItem.label} deleted${selectedItem.what === 'lv' ? ` — taken off ${selectedItem.detail.split(' · ')[0]}` : ''} · ⌘Z to undo`);
    cad.setSelected(null); setResult(null);
  }
  async function saveDxf() {
    if (!view) return;
    try {
      const out = placed.map((d) => ({ layer: d.what === 'lv' ? 'E-LV-POINTS' : d.what === 'elv' ? 'E-ELV-DEVICES' : 'E-BOARDS', x: d.x / units.factor, y: d.y / units.factor, r: rUnits * (d.what === 'board' ? 2 : 1), text: d.symbol.text, label: d.what === 'lv' ? d.detail.split(' · ')[0] : d.label }));
      const bytes = await drawingWithDevices(view, out, shapesOut(sketch, units.factor));
      const name = `${view.file.replace(/\.(dwg|dxf)$/i, '')} - with devices.dxf`;
      const msg = await saveBinary(name, bytes, 'DXF drawing', 'dxf', 'application/dxf');
      if (msg) { cad.say(`SAVE  ${msg} (${placed.length} device${placed.length === 1 ? '' : 's'} on E-LV-POINTS / E-ELV-DEVICES / E-BOARDS, ${sketch.length} drawn object${sketch.length === 1 ? '' : 's'} on ${DRAW_LAYER} / ${ANNO_LAYER})`); onStatus(msg); }
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); cad.say(msg); onStatus(msg); }
  }
  cad.actions.current = { save: () => void saveDxf(), remove: removeSelected, addFound: () => addFound(), schedules: () => schedules(), copyTo: (k) => copyLevel(k) };
  // While the page is not shown the ribbon's actions do nothing (they would work on a project as it was).
  useEffect(() => () => { cad.actions.current = NO_ACTIONS; }, []); // eslint-disable-line react-hooks/exhaustive-deps -- on leaving the page

  /** Copy to level: this level's devices of the chosen ELV device's system, at the same plan positions. */
  function copyLevel(key: string) {
    const to = floors.find((f) => f.key === key);
    if (!floor || !to || to.key === floor.key) return;
    const r = copyTo(project, { building: floor.ref.building, level: floor.ref.level }, { building: to.ref.building, level: to.ref.level }, elvSystem, floorLabel(project.building, to));
    if (r.next) change(r.next, r.message); else cad.say(`COPY  ${r.message}`);
  }

  /** The room name inside an outline: a text on a layer named like room names, else any text inside. */
  const nameInside = (poly: Pt[]) => {
    const texts = (view?.info.texts ?? []).filter((t) => cad.layersOn[t.layer] && inside([t.x, t.y], poly));
    const named = texts.find((t) => /ROOM|RM|NAME|SPACE/i.test(view!.info.layers[t.layer]?.name ?? ''));
    return (named ?? texts[0])?.s.trim();
  };

  function finishArea(pts: Pt[]) {
    if (pts.length < 3) { cad.say('An area needs at least 3 corners.'); return; }
    setResult({ kind: 'area', points: pts, how: tool === 'trace' ? 'trace' : 'corners', name: nameInside(pts) });
    const { area, perimeter } = areaOf(pts);
    cad.say(`Area = ${m2(toM2(area))}, Perimeter = ${m(toM(perimeter))}`);
    setPoints([]);
  }

  const draw = (item: Omit<SketchItem, 'id'>, what: string) => {
    if (!view) return;
    const { project: next, id } = addSketch(project, view.file, item);
    change(next, `${what} · ⌘Z to undo`);
    return id;
  };
  /** The object a modify tool works on: the drawn object or the device under the click. */
  const selectAt = (at: Pt, pixel: number): boolean => {
    const d = deviceAt(at, pixel);
    if (d) { cad.setSelected(d.key); setResult({ kind: 'device', it: d }); return true; }
    const sk = itemAt(sketch, at, 6 * pixel);
    if (sk) { cad.setSelected(`sk:${sk.id}`); setResult({ kind: 'sketch', it: sk }); return true; }
    return false;
  };
  /** Moves (or copies) the selected object by (dx, dy) drawing units. */
  function shift(dx: number, dy: number, copy: boolean) {
    if (!view || !floor && !selSketch) return;
    if (selSketch) {
      if (copy) draw({ ...moved(selSketch, dx, dy), id: undefined } as Omit<SketchItem, 'id'>, 'Copied');
      else change(updateSketch(project, view.file, moved(selSketch, dx, dy)), 'Moved · ⌘Z to undo');
      return;
    }
    if (!selectedItem || !floor) return;
    const [x, y] = [selectedItem.x + dx * units.factor, selectedItem.y + dy * units.factor];
    if (!copy) { change(selectedItem.what === 'elv' ? moveElv(project, selectedItem.id, x, y) : moveItem(project, selectedItem, x, y, floor.ref), `${selectedItem.label} moved · ⌘Z to undo`); return; }
    if (selectedItem.what === 'lv') {
      const src = (project.lvPoints ?? []).find((p) => p.id === selectedItem.id)!;
      change(placeLvPoint(project, floor.ref, src.type, src.feederId, x, y).project, `${selectedItem.label} copied onto ${selectedItem.detail.split(' · ')[0]} · ⌘Z to undo`);
    } else if (selectedItem.what === 'elv') {
      const src = (project.elvDevices ?? []).find((p) => p.id === selectedItem.id)!;
      change(placeElv(project, src.type, floor.ref, x, y).project, `${selectedItem.label} copied · ⌘Z to undo`);
    } else cad.say('COPY  A board is one item; place another board with Add device.');
  }

  function click(at: Pt, pixel: number) {
    if (!view) return;
    const last = points[points.length - 1];
    if (tool === 'move' || tool === 'copy' || tool === 'rotate') {
      if (!selSketch && !selectedItem) {
        if (selectAt(at, pixel)) cad.say(tool === 'rotate' && !itemAt(sketch, at, 6 * pixel) ? 'ROTATE  Click where it faces:' : `${tool.toUpperCase()}  Specify base point:`); else cad.say(`${tool.toUpperCase()}  Select object:`);
        return;
      }
      if (tool === 'rotate' && !selSketch) {
        // A camera or speaker turns to face the point clicked (its coverage follows); other devices keep their way.
        if (selectedItem?.what !== 'elv') { cad.say('ROTATE  Drawn objects, cameras and speakers only (other devices keep their orientation).'); return; }
        const deg = (Math.atan2(at[1] - selectedItem.y / units.factor, at[0] - selectedItem.x / units.factor) * 180) / Math.PI;
        const r = rotateElv(project, selectedItem.id, deg);
        change(r.next, r.message); setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
      }
      if (!points.length) { setPoints([at]); cad.say(tool === 'rotate' ? 'ROTATE  Specify rotation angle (degrees) or a point:' : `${tool.toUpperCase()}  Specify second point:`); return; }
      const base = points[0];
      if (tool === 'rotate') {
        const a = Math.atan2(at[1] - base[1], at[0] - base[0]);
        change(updateSketch(project, view.file, rotated(selSketch!, base, a)), `Rotated ${(a * 180 / Math.PI).toFixed(2)}° · ⌘Z to undo`);
        setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
      }
      shift(at[0] - base[0], at[1] - base[1], tool === 'copy');
      if (tool === 'move') { setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); }
      return;
    }
    if (tool === 'line') {
      if (last) draw({ kind: 'line', layer: DRAW_LAYER, pts: [last, at] }, `Line ${m(toM(distance(last, at)))}`);
      setPoints([at]); cad.say('LINE  Specify next point or Enter to stop:'); return;
    }
    if (tool === 'tray' || tool === 'cable') { setPoints((p) => [...p, at]); cad.say(`${tool === 'tray' ? 'TRAY' : 'ROUTE'}  Specify next point${points.length ? ', Enter to finish' : ''}:`); return; }
    if (tool === 'link') {
      const feeder = project.feeders.find((f) => f.id === cad.cableFeeder);
      if (!feeder) { cad.say('LINK  Choose the cable first (the panel on the right).'); return; }
      const o = view.pick(at[0], at[1], 6 * pixel, cad.layersOn);
      const pts = o ? objectPath(view, o) : [];
      if (pts.length < 2) { cad.say('LINK  That is not a line or polyline. Click a line of the drawing:'); return; }
      draw({ kind: 'pline', layer: CABLE_LAYER, pts, cable: { feederId: feeder.id } }, `Cable route of ${cableLabel(project, feeder)}: ${m(toM(pathLength(pts)))} (linked from ${view.info.layers[o!.layer]?.name ?? 'the drawing'})`);
      return;
    }
    if (tool === 'pline') {
      if (points.length >= 3 && distance(at, points[0]) <= 8 * pixel) { finishPline(true); return; }
      setPoints((p) => [...p, at]); cad.say('PLINE  Specify next point, C to close, Enter to finish:'); return;
    }
    if (tool === 'rect') {
      if (!last) { setPoints([at]); cad.say('RECTANG  Specify other corner point:'); return; }
      const pts = rectangle(last, at);
      draw({ kind: 'pline', layer: DRAW_LAYER, pts, closed: true }, `Rectangle ${m(toM(Math.abs(at[0] - last[0])))} × ${m(toM(Math.abs(at[1] - last[1])))}`);
      setPoints([]); cad.say(PROMPT.rect); return;
    }
    if (tool === 'circle') {
      if (!last) { setPoints([at]); cad.say('CIRCLE  Specify radius (a point, or type it):'); return; }
      finishCircle(distance(last, at)); return;
    }
    if (tool === 'arc') {
      if (points.length < 2) { setPoints((p) => [...p, at]); cad.say(points.length ? 'ARC  Specify end point:' : 'ARC  Specify second point:'); return; }
      const a = arcThrough(points[0], points[1], at);
      if (!a) cad.say('ARC  The three points are in line; pick another end point.');
      else { draw({ ...a, layer: DRAW_LAYER } as Omit<SketchItem, 'id'>, `Arc radius ${m(toM(a.r ?? 0))}`); setPoints([]); cad.say(PROMPT.arc); }
      return;
    }
    if (tool === 'text') { cad.setTextAt(at); cad.say('TEXT  Enter text (then Enter):'); input.current?.focus(); return; }
    if (tool === 'dim') {
      if (points.length < 2) { setPoints((p) => [...p, at]); cad.say(points.length ? 'DIM  Specify dimension line location:' : 'DIM  Specify second extension line origin:'); return; }
      const len = distance(points[0], points[1]);
      draw({ kind: 'dim', layer: ANNO_LAYER, pts: [points[0], points[1], at], text: toM(len).toFixed(2), h: textH * 0.8 }, `Dimension ${m(toM(len))}`);
      setPoints([]); cad.say(PROMPT.dim); return;
    }
    if (tool === 'none') {
      const d = deviceAt(at, pixel);
      if (d) { cad.setSelected(d.key); setResult({ kind: 'device', it: d }); cad.say(`LIST  ${d.label}${d.detail ? ` · ${d.detail}` : ''}${d.room ? ` · ${d.room}` : ''}`); return; }
      cad.setSelected(null);
      const sk = itemAt(sketch, at, 6 * pixel);
      if (sk) { cad.setSelected(`sk:${sk.id}`); setResult({ kind: 'sketch', it: sk }); cad.say(`LIST  ${sk.tray ? `Cable tray ${sk.tray.widthMm} mm, ${m(toM(trayLength(sk)))}${sk.tray.route ? ` on route ${sk.tray.route}` : ', no route'}` : sk.cable ? `Cable route of ${cableLabels[sk.id] ?? sk.cable.feederId}, ${m(toM(pathLength(sk.pts)))}` : sk.kind === 'pline' ? 'Polyline' : sk.kind} on ${sk.layer} (drawn here)`); return; }
      const o = view.pick(at[0], at[1], 6 * pixel, cad.layersOn);
      setResult(o ? { kind: 'object', o } : null);
      if (o) cad.say(`LIST  ${o.kind}${o.block ? ` ${o.block}` : ''} on ${view.info.layers[o.layer]?.name ?? '?'}${o.length !== undefined && !o.closed ? `, length ${m(toM(o.length))}` : ''}${o.area !== undefined ? `, area ${m2(toM2(o.area))}` : ''}`);
    } else if (tool === 'dist') {
      if (points.length === 0) { setPoints([at]); setResult(null); cad.say('DI  Specify second point:'); return; }
      const a = points[0];
      setResult({ kind: 'dist', a, b: at });
      cad.say(`Distance = ${m(toM(distance(a, at)))}, Angle = ${angleDeg(a, at).toFixed(2)}°, ΔX = ${m(toM(at[0] - a[0]))}, ΔY = ${m(toM(at[1] - a[1]))}`);
      setPoints([]);
    } else if (tool === 'area' || tool === 'trace') {
      if (objectMode && tool === 'area') {
        const o = view.pick(at[0], at[1], 6 * pixel, cad.layersOn, true);
        if (!o || o.area === undefined) { cad.say('AREA  That is not a closed object (polyline, circle, hatch). Select a closed object:'); return; }
        const segs: Pt[] = [];
        for (let i = o.seg_start; i < o.seg_end; i += 1) segs.push([view.segs[i * 4] + view.info.origin[0], view.segs[i * 4 + 1] + view.info.origin[1]]);
        setResult({ kind: 'area', points: segs, how: 'object' });
        cad.say(`Area = ${m2(toM2(o.area))}${o.length !== undefined ? `, Perimeter = ${m(toM(o.length))}` : ''}`);
        return;
      }
      if (points.length >= 3 && distance(at, points[0]) <= 8 * pixel) { finishArea(points); return; }
      if (points.length === 0) setResult(null);
      setPoints((p) => [...p, at]);
      cad.say(`${tool === 'trace' ? 'TRACE' : 'AREA'}  Specify next corner point or press Enter to close:`);
    } else if (tool === 'dev') {
      if (!floor) { cad.say('DEV  Add the building and its levels in Building information first; devices are kept per level.'); return; }
      try {
        const [x, y] = [at[0] * units.factor, at[1] * units.factor];
        const r = 'elv' in item.kind ? placeElv(project, (ELV_PALETTE.find((e) => e.id === item.id) ?? ELV_PALETTE[0]).kind.elv, floor.ref, x, y)
          : placeItem(project, item, floor.ref, x, y, { feederId: cad.feederId, boardId: cad.boardId });
        change(r.project, `${r.message} · ⌘Z to undo`);
      } catch (e) { cad.say(`DEV  ${e instanceof Error ? e.message : String(e)}`); }
    } else if (tool === 'fill') {
      if (!floor) { cad.say('FILL  Add the building and its levels in Building information first.'); return; }
      if (!elvItem) { cad.say('FILL  Choose an ELV device first (a detector, speaker, data outlet…) in the Devices panel.'); return; }
      const r = fillAt(project, { building: floor.ref.building, level: floor.ref.level }, elvItem.kind.elv, [at[0] * units.factor, at[1] * units.factor]);
      if (r.next) change(r.next, r.message); else cad.say(`FILL  ${r.message}`);
    } else if (tool === 'room') {
      const r = roomAround(walls, at, units.factor);
      if (!r) { cad.say('ROOM AREA  No closed room around that point (open to the outside, or over 50 m across). Use AREA and click its corners.'); return; }
      setResult({ kind: 'area', points: r.points, how: 'room', name: nameInside(r.points) });
      cad.say(`Room area = ${m2(toM2(r.area))}`);
    } else if (tool === 'name') {
      const o = view.pick(at[0], at[1], 6 * pixel, cad.layersOn);
      const text = o?.text?.trim();
      if (!text) { cad.say('NAME  That is not a text. Click the room name on the drawing:'); return; }
      if (result?.kind === 'area' && result.how !== 'object') { setResult({ ...result, name: text }); cad.say(`NAME  ${text} — Add as room… to add it`); return; }
      const room = floor && roomAtPoint(at);
      if (!room) { cad.say(`NAME  “${text}” is not inside a room yet: find the room first (Click inside or Trace).`); return; }
      if (room.name.toLowerCase() === text.toLowerCase()) { cad.say(`NAME  ${room.name} already`); return; }
      change(renameRoom(project, room.id, text), `${room.name} renamed ${text} · ⌘Z to undo`);
    }
  }

  /** The smallest room of the plan's level whose outline (metres) is around a point (drawing units). */
  const roomAtPoint = (at: Pt) => (floor ? roomAtPointOf(project, floor, at, units.factor) : undefined);

  /** Add found rooms: the closed outlines on the room-outline layers (Layer roles), named by the text inside, added to
   * Building information on the plan's level (a room found again keeps its ID; one undo step). */
  function addFound() {
    if (!view) return;
    if (!floor) { cad.say('ROOMS  Add the building and its levels in Building information first; rooms are kept per level.'); return; }
    if (!roles.some((r) => r.role === 'room')) { cad.say('ROOMS  No layer has the role Room outline: set it in File → Layer roles, or use Click inside / Trace.'); cad.setShowRoles(true); return; }
    const code = CAD_UNITS.find((u) => u.id === units.unit)!.code;
    const { rooms, zones } = roomsFromPlan(planOfView(view, code, cad.layersOn), roles, project.cadLength);
    if (!rooms.length) { cad.say('ROOMS  No closed outlines on the room-outline layers that are shown. Use Click inside or Trace.'); return; }
    const { project: next } = putRooms(project, rooms.map((r) => ({ ...r, file: view.file })), floor.ref, roles);
    const label = floorLabel(project.building, floor);
    change(next, `${rooms.length} room${rooms.length === 1 ? '' : 's'} from the plan on ${label}${rooms.some((r) => !r.named) ? ` (${rooms.filter((r) => !r.named).length} without a name: Pick name)` : ''}${zones ? ` · ${zones} zone outline${zones === 1 ? '' : 's'} left out` : ''}${levelSet ? '' : ' — level not set: File → Level'} · ⌘Z to undo`);
  }

  function finishPline(closed: boolean) {
    if (points.length >= 2) draw({ kind: 'pline', layer: DRAW_LAYER, pts: points, closed }, `Polyline (${points.length} points${closed ? ', closed' : ''})`);
    setPoints([]); cad.say(PROMPT.pline);
  }
  /** A cable route along the points clicked, for the cable chosen. */
  function finishCable() {
    const feeder = project.feeders.find((f) => f.id === cad.cableFeeder);
    if (!feeder) cad.say('ROUTE  Choose the cable first (the panel on the right).');
    else if (points.length >= 2) draw({ kind: 'pline', layer: CABLE_LAYER, pts: points, cable: { feederId: feeder.id } }, `Cable route of ${cableLabel(project, feeder)}: ${m(toM(pathLength(points)))}`);
    setPoints([]); cad.say(PROMPT.cable);
  }
  /** Update schedules: tray route lengths and fittings, feeder lengths and tray routes, from every level's plan. */
  function schedules() {
    if (!view) return;
    const u = updateSchedules(project, planDrawings(project, { file: view.file, insunits: view.info.units }));
    const same = JSON.stringify([u.project.trays, u.project.feeders]) === JSON.stringify([project.trays, project.feeders]);
    if (same) { cad.say(`SCHED  Up to date: ${scheduleSummary(u)}`); return; }
    change(u.project, `Schedules updated: ${scheduleSummary(u)} · ⌘Z to undo`);
  }
  /** A cable tray run along the points clicked, at the chosen width; on a tray route only once one is chosen. */
  function finishTray() {
    if (points.length >= 2) {
      const { widthMm, route } = cad.tray;
      const it = { kind: 'pline' as const, layer: TRAY_LAYER, pts: points, tray: { widthMm, ...(route ? { route } : {}) } };
      draw(it, `Cable tray ${widthMm} mm, ${m(toM(trayLength({ ...it, id: '' })))}${route ? ` on route ${route}` : ' (no route: assign one when you know it)'}`);
    }
    setPoints([]); cad.say(PROMPT.tray);
  }
  function finishCircle(r: number) {
    if (!points[0] || r <= 0) return;
    draw({ kind: 'circle', layer: DRAW_LAYER, pts: [points[0]], r }, `Circle radius ${m(toM(r))}`);
    setPoints([]); cad.say(PROMPT.circle);
  }

  function run(text: string) {
    const raw = text.trim();
    const c = raw.toUpperCase().replace(/\s+/g, ' ');
    // Typed input for the tool in use: the text of TEXT, a radius, an angle, a point or a distance.
    if (tool === 'text' && cad.textAt && raw) {
      draw({ kind: 'text', layer: ANNO_LAYER, pts: [cad.textAt], text: raw, h: textH }, `Text "${raw}"`);
      cad.setTextAt(null); cad.say(PROMPT.text); return;
    }
    if (!c) {
      if ((tool === 'area' || tool === 'trace') && points.length >= 3) finishArea(points);
      else if (tool === 'pline') finishPline(false);
      else if (tool === 'tray') finishTray();
      else if (tool === 'cable') finishCable();
      else if (tool === 'line') { setPoints([]); cad.say(PROMPT.line); }
      else if (tool === 'copy') { setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); }
      return;
    }
    if (tool === 'pline' && c === 'C' && points.length >= 3) { finishPline(true); return; }
    if (tool === 'circle' && points.length === 1 && /^-?[\d.]+$/.test(c)) { finishCircle(Number(c)); return; }
    if (tool === 'rotate' && !selSketch && selectedItem?.what === 'elv' && /^-?[\d.]+$/.test(c)) {
      const r = rotateElv(project, selectedItem.id, Number(c));
      change(r.next, r.message); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
    }
    if (tool === 'rotate' && selSketch && points.length === 1 && /^-?[\d.]+$/.test(c)) {
      const a = (Number(c) * Math.PI) / 180;
      if (view) change(updateSketch(project, view.file, rotated(selSketch, points[0], a)), `Rotated ${Number(c).toFixed(2)}° · ⌘Z to undo`);
      setPoints([]); cad.setSelected(null); setResult(null); cad.setTool('none'); return;
    }
    if (DRAW_TOOLS.includes(tool) || tool === 'dist' || tool === 'area' || tool === 'trace') {
      const p = typedPoint(raw, points[points.length - 1], cursor.at);
      if (p) { cad.say(`  ${raw}`); click(p, 1e-9); return; }
    }
    cad.say(`Command: ${c}`);
    if (c === 'OPEN') openFile();
    else if (['FIT', 'ZE', 'Z E', 'ZOOM E', 'ZOOM EXTENTS'].includes(c)) cad.fit();
    else if (c === 'DI' || c === 'DIST' || c === 'DISTANCE') cad.setTool('dist');
    else if (c === 'AREA' || c === 'AA') cad.setTool('area');
    else if (c === 'O' && tool === 'area') { setObjectMode(true); setPoints([]); cad.say('AREA  Select a closed object:'); }
    else if (c === 'RA' || c === 'ROOM' || c === 'ROOMAREA') cad.setTool('room');
    else if (c === 'ROOMS' || c === 'ADDROOMS') addFound();
    else if (c === 'TR' || c === 'TRACE') cad.setTool('trace');
    else if (c === 'PN' || c === 'NAME') cad.setTool('name');
    else if (c === 'LI' || c === 'LIST') cad.setTool('none');
    else if (c === 'DEV' || c === 'DEVICE' || c === 'INSERT' || c === 'I') cad.setTool('dev');
    else if (c === 'M' || c === 'MOVE') cad.setTool('move');
    else if (c === 'CO' || c === 'CP' || c === 'COPY') cad.setTool('copy');
    else if (c === 'RO' || c === 'ROTATE') cad.setTool('rotate');
    else if (c === 'L' || c === 'LINE') cad.setTool('line');
    else if (c === 'PL' || c === 'PLINE' || c === 'POLYLINE') cad.setTool('pline');
    else if (c === 'CT' || c === 'TRAY' || c === 'CABLETRAY') cad.setTool('tray');
    else if (c === 'CR' || c === 'ROUTE' || c === 'CABLEROUTE') cad.setTool('cable');
    else if (c === 'LR' || c === 'LINK') cad.setTool('link');
    else if (c === 'SCHED' || c === 'SCHEDULES' || c === 'UPDATE') schedules();
    else if (c === 'FILL' || c === 'FR') cad.setTool('fill');
    else if (c === 'COV' || c === 'COVERAGE') cad.setCoverage(!cad.coverage);
    else if (c === 'REC' || c === 'RECTANG' || c === 'RECTANGLE') cad.setTool('rect');
    else if (c === 'C' || c === 'CIRCLE') cad.setTool('circle');
    else if (c === 'A' || c === 'ARC') cad.setTool('arc');
    else if (c === 'T' || c === 'DT' || c === 'TEXT' || c === 'MT') cad.setTool('text');
    else if (c === 'DIM' || c === 'DIMALIGNED' || c === 'DAL' || c === 'DLI') cad.setTool('dim');
    else if (c === 'E' || c === 'ERASE' || c === 'DEL' || c === 'DELETE') removeSelected();
    else if (c === 'SAVE' || c === 'DXFOUT' || c === 'SAVEAS') void saveDxf();
    else if (c === 'LA' || c === 'LAYER' || c === 'LAYERS') cad.setShowLayers(!cad.showLayers);
    else if (c === 'OS' || c === 'OSNAP') cad.toggle('osnap');
    else if (c === 'GRID') cad.toggle('grid');
    else if (c === 'ORTHO') cad.toggle('ortho');
    else if (c === 'SNAP') cad.toggle('snap');
    else if (c === 'HELP' || c === '?') cad.say(HELP);
    else cad.say(`Unknown command "${c}". ${HELP}`);
  }

  // CAD keys while this page shows: function keys toggle, typing goes to the command line, Enter closes an area, Esc
  // cancels the command (and the tool).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const fn: Record<string, keyof CadToggles> = { F3: 'osnap', F7: 'grid', F8: 'ortho', F9: 'snap' };
    if (fn[e.key]) { e.preventDefault(); cad.toggle(fn[e.key]); return; }
    if (e.key === 'Escape' && (!typing || e.target === input.current)) {
      setCmd(''); input.current?.blur();
      if (points.length || objectMode || cad.textAt) { setPoints([]); setObjectMode(false); cad.setTextAt(null); cad.say('*Cancel*'); } else if (tool !== 'none') cad.setTool('none'); else { setResult(null); cad.setSelected(null); }
      return;
    }
    if (e.key === 'Enter' && !typing && (tool === 'area' || tool === 'trace') && points.length >= 3) { finishArea(points); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && (selectedItem || selSketch)) { e.preventDefault(); removeSelected(); return; }
    if (e.key === 'Enter' && !typing && (tool === 'pline' || tool === 'tray' || tool === 'cable' || tool === 'line' || tool === 'copy')) { run(''); return; }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[a-zA-Z?]$/.test(e.key)) input.current?.focus();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // The object being drawn (or moved / copied / rotated), following the cursor.
  const cur = cursor.at;
  const lastPt = points[points.length - 1];
  const preview: SketchItem[] = !cur ? [] : (() => {
    const base = { id: '_', layer: '' };
    if (tool === 'line' && lastPt) return [{ ...base, kind: 'line', pts: [lastPt, cur] }];
    if (tool === 'pline' && points.length) return [{ ...base, kind: 'line', pts: [...points, cur] }];
    if (tool === 'cable' && points.length) return [{ ...base, kind: 'line', pts: [...points, cur] }];
    if (tool === 'tray' && points.length) return [{ ...base, kind: 'pline', pts: [...points, cur], tray: { widthMm: cad.tray.widthMm } }];
    if (tool === 'rect' && lastPt) return [{ ...base, kind: 'pline', pts: rectangle(lastPt, cur), closed: true }];
    if (tool === 'circle' && lastPt) return [{ ...base, kind: 'circle', pts: [lastPt], r: distance(lastPt, cur) }];
    if (tool === 'arc' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'arc' && points.length === 2) { const a = arcThrough(points[0], points[1], cur); return a ? [{ ...base, ...a } as SketchItem] : []; }
    if (tool === 'dim' && points.length === 1) return [{ ...base, kind: 'line', pts: [points[0], cur] }];
    if (tool === 'dim' && points.length === 2) return [{ ...base, kind: 'dim', pts: [points[0], points[1], cur] }];
    if ((tool === 'move' || tool === 'copy') && lastPt && selSketch) return [moved(selSketch, cur[0] - lastPt[0], cur[1] - lastPt[1])];
    if ((tool === 'move' || tool === 'copy') && lastPt) return [{ ...base, kind: 'line', pts: [lastPt, cur] }];
    if (tool === 'rotate' && lastPt && selSketch) return [rotated(selSketch, lastPt, Math.atan2(cur[1] - lastPt[1], cur[0] - lastPt[0]))];
    return [];
  })();
  const liveLabel = cur && lastPt && ['line', 'pline', 'tray', 'cable', 'dim', 'move', 'copy'].includes(tool) ? `${m(toM(distance(lastPt, cur)))}  ${angleDeg(lastPt, cur).toFixed(1)}°`
    : cur && lastPt && tool === 'circle' ? `R ${m(toM(distance(lastPt, cur)))}` : undefined;
  const marks: CadMarks | null = DRAW_TOOLS.includes(tool) && lastPt ? { points: [lastPt], live: true, label: liveLabel }
    : result?.kind === 'dist' ? { points: [result.a, result.b], label: m(toM(distance(result.a, result.b))) }
    : result?.kind === 'area' && result.how !== 'object' ? { points: result.points, closed: true, label: m2(toM2(areaOf(result.points).area)) }
    : points.length ? (() => {
      const live = cursor.at ? [...points, cursor.at] : points;
      const corners = tool === 'area' || tool === 'trace';
      const label = tool === 'dist' && live.length === 2 ? m(toM(distance(live[0], live[1]))) : corners && live.length >= 3 ? m2(toM2(areaOf(live).area)) : undefined;
      return { points, live: true, area: corners, label };
    })()
    : tool === 'dist' || tool === 'area' || tool === 'trace' ? { points: [], live: false } : null;
  const highlight: [number, number] | null = result?.kind === 'object' ? [result.o.seg_start, result.o.seg_end] : null;
  const objectArea = result?.kind === 'area' && result.how === 'object';

  return (
    <section className="cad">
      <div className="cad-work">
        {view ? (
          <div className="cad-stage">
            <CadCanvas view={view} layersOn={cad.layersOn} toggles={cad.toggles} fitKey={cad.fitKey} onCursor={(at, snap) => setCursor({ at, snap })} onClick={click} marks={objectArea ? { points: result.points, closed: true } : marks} highlight={highlight} devices={devices} sketch={sketch} selectedSketch={selSketch?.id ?? null} extraSnaps={sketchSnaps} preview={preview} unitsPerMm={0.001 / units.factor} labels={cableLabels} covers={elv?.covers} gaps={elv?.gaps} />
            <div className="cad-coords">{cursor.at ? `X ${cursor.at[0].toFixed(2)}   Y ${cursor.at[1].toFixed(2)}   ${units.label}` : units.label}</div>
          </div>
        ) : (
          <div className="cad-stage cad-empty">
            <p className="m">Open a DWG or DXF drawing. It opens here as in a CAD program — read by the app's own engine, no CAD program needed.</p>
            <div className="cad-actions">
              <button className="chip primary" disabled={busy} onClick={openFile}>{busy ? 'Opening…' : 'Open drawing…'}</button>
              {last && window.lvds?.cadFile?.readBytes && <button className="chip" disabled={busy} onClick={() => void load(() => reopenDrawing(last), 'That drawing is no longer where it was. Open it again.')}>Reopen {last.split(/[\\/]/).pop()}</button>}
              {SAMPLE_PLANS.map((x) => <button key={x.file} className="chip" disabled={busy} onClick={() => void load(() => sampleDrawing(x.file))}>{x.label}</button>)}
            </div>
          </div>
        )}
        {cad.showLayers && (
          <aside className="cad-side">
            <h4>Result</h4>
            <div className="cad-res">
              {result ? <ResultView r={result.kind === 'sketch' && selSketch ? { kind: 'sketch', it: selSketch } : result} view={view!} toM={toM} toM2={toM2} project={project} onChange={onChange} onMove={() => cad.setTool('move')} onRemove={removeSelected} onCopy={() => cad.setTool('copy')} onRotate={() => cad.setTool('rotate')} onAdded={() => setResult(null)} fittings={fittings} /> : view ? (
                <>{view.file}<br /><span className="m">{view.info.format} · {units.label}{units.assumed ? ' (not set in the drawing: taken as mm)' : ''} · {view.info.segments.toLocaleString()} lines · {view.info.texts.length} texts</span><br /><span className="m">{PROMPT[tool]}</span></>
              ) : <span className="m">No drawing open.</span>}
              {view && SAMPLE_PLANS.some((x) => x.file === view.file) && (
                <div className="cad-sample">
                  Sample plan for testing{' '}
                  <select aria-label="Sample floor" value={view.file} onChange={(e) => void load(() => sampleDrawing(e.target.value))}>
                    {SAMPLE_PLANS.map((x) => <option key={x.file} value={x.file}>{x.label}</option>)}
                  </select>
                </div>
              )}
            </div>
            {tool === 'tray' && view && (
              <>
                <h4>Cable tray</h4>
                <div className="cad-devform">
                  <TrayFields project={project} widthMm={cad.tray.widthMm} route={cad.tray.route} onChange={(t) => cad.setTray({ ...cad.tray, ...t })} />
                  <span className="m">Click the run's points, Enter to finish. The route can be left for later. End a run on another tray for a tee; a run of another width in line makes a reducer.</span>
                </div>
                <Fittings fittings={fittings} title="Fittings on this plan" />
              </>
            )}
            {(tool === 'cable' || tool === 'link') && view && (
              <>
                <h4>Cable route</h4>
                <div className="cad-devform">
                  <label>Cable<select aria-label="Cable" value={cad.cableFeeder} onChange={(e) => cad.setCableFeeder(e.target.value)}>
                    <option value="">Choose a cable…</option>
                    {cables.map((f) => <option key={f.id} value={f.id}>{cableLabel(project, f)}</option>)}
                  </select></label>
                  <span className="m">{tool === 'cable' ? 'Click the route\'s points, Enter to finish.' : 'Click a line or polyline of the drawing (e.g. on a cable layer).'} Update schedules then gives the cable its length, and the tray routes it runs along.</span>
                </div>
              </>
            )}
            {(tool === 'dev' || tool === 'move' || tool === 'fill') && view && (
              <>
                <h4>Devices</h4>
                <div className="cad-pal" role="group" aria-label="Device to place">
                  {palette.map((x) => (
                    <button key={x.id} aria-pressed={cad.device === x.id} className={'elv' in x.kind ? 'elv' : 'lv'} onClick={() => { cad.setDevice(x.id); if (tool !== 'fill' || !('elv' in x.kind)) cad.setTool('dev'); }}>{x.symbol.text || '●'}<span>{x.label}</span></button>
                  ))}
                </div>
                <div className="cad-devform">
                  {floors.length > 0 && (
                    <label>This drawing shows<select aria-label="Level of this drawing" value={floor?.key} onChange={(e) => { const f = floors.find((x) => x.key === e.target.value); if (f && view) setPlanLevel(project, view.file, f, change, view.info.units); }}>{floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}</select></label>
                  )}
                  {'lv' in item.kind && (
                    <label>Circuit<select aria-label="Circuit" value={cad.feederId} onChange={(e) => cad.setFeederId(e.target.value)}>
                      <option value="">Choose a circuit…</option>
                      {circuits.map((f) => <option key={f.id} value={f.id}>{circuitLabel(project, f)}</option>)}
                    </select></label>
                  )}
                  {'board' in item.kind && (
                    <label>Board<select aria-label="Board" value={cad.boardId} onChange={(e) => cad.setBoardId(e.target.value)}>
                      <option value="">Choose a board…</option>
                      {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
                    </select></label>
                  )}
                  {!floors.length && <p className="m">Add the building and its levels in Building information first; devices are kept per level.</p>}
                  <span className="m">{placed.length} device{placed.length === 1 ? '' : 's'} on this level</span>
                  {elvItem && <span className="m">{elvItem.label}{coverageNote(elvItem.kind.elv)} · {SYSTEM_LABEL[elvSystem]}{cad.coverage && elv ? ` · ${elv.coverage.filter((c) => c.gaps.length).length} room${elv.coverage.filter((c) => c.gaps.length).length === 1 ? '' : 's'} not fully covered` : ''}</span>}
                </div>
              </>
            )}
            {plans.length > 0 && (
              <>
                <h4>Plans</h4>
                <div className="cad-layers" role="list" aria-label="Plans of this project">
                  {plans.map((x) => {
                    const here = !!view && levelSet && floor?.key === x.floor.key;
                    const canOpen = !!x.file && (SAMPLE_PLANS.some((s) => s.file === x.file) || (!!pathOfPlan(project.id, x.file) && !!window.lvds?.cadFile?.readBytes));
                    return (
                      <button key={x.floor.key} role="listitem" className={`cad-lyr${x.file ? '' : ' off'}`} aria-current={here || undefined} disabled={busy || here || (!!x.file && !canOpen)}
                        title={x.file ? (canOpen ? `Open ${x.file}` : `${x.file}: open it from Plans (its folder is not known on this computer)`) : `Open a drawing as the plan of ${x.label}`}
                        onClick={() => void load(async () => {
                          const v = !x.file ? await chooseDrawing() : SAMPLE_PLANS.some((s) => s.file === x.file) ? await sampleDrawing(x.file) : await reopenDrawing(pathOfPlan(project.id, x.file)!);
                          if (v && !x.file) setPlanLevel(project, v.file, x.floor, change, v.info.units);
                          return v;
                        }, 'That drawing is no longer where it was. Open it from Plans.')}>
                        <b>{x.label}</b>{x.file ?? 'no plan'}<span className="m">{here ? 'open' : x.file ? '' : 'open…'}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {view && cad.showRoles && (
              <>
                <h4>Layer roles</h4>
                <div>
                  <CadLayerTable layers={layerStats} roles={roles}
                    onChange={(layer: string, role: CadLayerRole) => change(withLayerMap(project, roles.map((x) => (x.layer === layer ? { ...x, role } : x))), `Layer ${layer}: ${role} · ⌘Z to undo`)}
                    onApplyMap={(m: CadLayerMap[]) => change(withLayerMap(project, m), 'Layer template applied · ⌘Z to undo')} />
                </div>
              </>
            )}
            <h4>Layers {view && <span className="cad-lyr-all"><button onClick={() => cad.allLayers(true)}>All on</button></span>}</h4>
            <div className="cad-layers">
              {view && placed.length > 0 && (
                <button className={`cad-lyr${cad.showDevices ? '' : ' off'}`} aria-pressed={cad.showDevices} onClick={() => cad.setShowDevices(!cad.showDevices)}>
                  <i style={{ background: 'var(--cad-dev)' }} />Devices placed in the app<span className="m">{cad.showDevices ? 'on' : 'off'}</span>
                </button>
              )}
              {view?.info.layers.map((l, i) => l.count > 0 || view.info.texts.some((t) => t.layer === i) ? (
                <button key={l.name} className={`cad-lyr${cad.layersOn[i] ? '' : ' off'}`} aria-pressed={!!cad.layersOn[i]} title={`${l.count.toLocaleString()} lines`} onClick={() => cad.setLayer(i, !cad.layersOn[i])}>
                  <i style={{ background: hex(l.rgb) }} />{l.name}<span className="m">{cad.layersOn[i] ? 'on' : 'off'}</span>
                </button>
              ) : null)}
            </div>
          </aside>
        )}
      </div>
      <form className="cad-cmd" onSubmit={(e) => { e.preventDefault(); run(cmd); setCmd(''); }}>
        <span className="m cad-hist">{cad.history[cad.history.length - 1] ?? 'Command: type OPEN, DI, AREA… or use the CAD ribbon'}</span>
        <span>›</span>
        <input ref={input} aria-label="Command" value={cmd} placeholder="Type a command" onChange={(e) => setCmd(e.target.value)} />
      </form>
      <div className="cad-status">
        {TOGGLES.map((x) => (
          <button key={x.k} className={`cad-tg${cad.toggles[x.k] ? ' on' : ''}`} aria-pressed={cad.toggles[x.k]} title={`${x.label} (${x.key})`} onClick={() => cad.toggle(x.k)}>{x.label}</button>
        ))}
        <span className="sp" />
        <span>{cursor.snap ?? ''}</span>
        <span>{view ? `${view.file} · ${view.info.format} · ${units.label} · 1 : 1` : ''}</span>
      </div>
    </section>
  );
}

/** The Result panel: a distance, an area (with Add as room…), or what the clicked object is. */
function ResultView({ r, view, toM, toM2, project, onChange, onMove, onRemove, onCopy, onRotate, onAdded, fittings }: {
  r: Result; view: CadView; toM: (v: number) => number; toM2: (v: number) => number; project: Project; onChange: (next: Project, message: string) => void;
  onMove: () => void; onRemove: () => void; onCopy: () => void; onRotate: () => void; onAdded: () => void; fittings: TrayFitting[];
}) {
  if (r.kind === 'sketch' && r.it.cable) {
    const it = r.it, cable = r.it.cable;
    const f = project.feeders.find((x) => x.id === cable.feederId);
    return (
      <>
        <div><b>Cable route</b> <span className="m">drawn here · {it.layer}</span></div>
        <dl className="cad-props">
          <dt>Cable</dt><dd>{f ? cableLabel(project, f) : `${cable.feederId} (no longer in the design)`}</dd>
          <dt>Route</dt><dd>{m(toM(pathLength(it.pts)))}</dd>
          {f?.lengthM !== undefined && <><dt>Cable length</dt><dd>{f.lengthM} m</dd></>}
        </dl>
        <div className="cad-devform">
          <label>Cable<select aria-label="Cable of this route" value={cable.feederId} onChange={(e) => {
            const g = project.feeders.find((x) => x.id === e.target.value);
            if (g) onChange(updateSketch(project, view.file, { ...it, cable: { feederId: g.id } }), `Cable route now for ${cableLabel(project, g)} · ⌘Z to undo`);
          }}>{cablesOf(project).map((x) => <option key={x.id} value={x.id}>{cableLabel(project, x)}</option>)}</select></label>
        </div>
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRotate}>Rotate</button><button className="chip" onClick={onRemove}>Erase</button></div>
      </>
    );
  }
  if (r.kind === 'sketch' && r.it.tray) {
    const it = r.it, tray = r.it.tray;
    return (
      <>
        <div><b>Cable tray</b> <span className="m">drawn here · {it.layer}</span></div>
        <dl className="cad-props">
          <dt>Length</dt><dd>{m(toM(trayLength(it)))}</dd>
          <dt>Route</dt><dd>{tray.route ?? 'not assigned'}</dd>
        </dl>
        <div className="cad-devform">
          <TrayFields project={project} widthMm={tray.widthMm} route={tray.route ?? ''} onChange={(t) => {
            const next = { ...tray, ...t };
            const { route, ...rest } = next;
            onChange(updateSketch(project, view.file, { ...it, tray: route ? { ...rest, route } : rest }), `Cable tray ${next.widthMm} mm${route ? ` on route ${route}` : ', no route'} · ⌘Z to undo`);
          }} />
        </div>
        <Fittings fittings={fittings.filter((f) => f.runs.includes(it.id))} title="Fittings on this run" />
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRotate}>Rotate</button><button className="chip" onClick={onRemove}>Erase</button></div>
      </>
    );
  }
  if (r.kind === 'sketch') {
    const it = r.it;
    const len = segmentsOf(it).reduce((t, [a, b]) => t + distance(a, b), 0);
    const name = { line: 'Line', pline: it.closed ? 'Closed polyline' : 'Polyline', circle: 'Circle', arc: 'Arc', text: 'Text', dim: 'Dimension' }[it.kind];
    return (
      <>
        <div><b>{name}</b> <span className="m">drawn here · {it.layer}</span></div>
        <dl className="cad-props">
          {it.kind === 'text' && <><dt>Text</dt><dd>{it.text}</dd></>}
          {it.kind === 'dim' && <><dt>Measures</dt><dd>{m(toM(dimensionLines(it.pts[0], it.pts[1], it.pts[2]).length))}</dd></>}
          {it.r !== undefined && <><dt>Radius</dt><dd>{m(toM(it.r))}</dd></>}
          {it.kind !== 'text' && it.kind !== 'dim' && <><dt>{it.closed || it.kind === 'circle' ? 'Perimeter' : 'Length'}</dt><dd>{m(toM(len))}</dd></>}
          {it.closed && <><dt>Area</dt><dd>{m2(toM2(areaOf(it.pts).area))}</dd></>}
        </dl>
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRotate}>Rotate</button><button className="chip" onClick={onRemove}>Erase</button></div>
      </>
    );
  }
  if (r.kind === 'device') {
    const it = r.it;
    return (
      <>
        <div><b>{it.label}</b> <span className="m">{it.what === 'lv' ? 'LV point' : it.what === 'elv' ? 'ELV device' : 'Board'}</span></div>
        <dl className="cad-props">
          {it.detail && <><dt>{it.what === 'lv' ? 'Circuit' : it.what === 'elv' ? 'System' : 'Name'}</dt><dd>{it.detail}</dd></>}
          <dt>Room</dt><dd>{it.room ?? '—'}</dd>
          <dt>Position</dt><dd>{it.x.toFixed(2)}, {it.y.toFixed(2)} m</dd>
        </dl>
        <div className="cad-devbtns"><button className="chip" onClick={onMove}>Move</button><button className="chip" onClick={onCopy}>Copy</button><button className="chip" onClick={onRemove}>Delete</button></div>
      </>
    );
  }
  if (r.kind === 'dist') {
    const d = distance(r.a, r.b);
    return <><div>Distance <b className="cad-big">{m(toM(d))}</b></div><div className="m">ΔX {m(toM(r.b[0] - r.a[0]))} · ΔY {m(toM(r.b[1] - r.a[1]))} · angle {angleDeg(r.a, r.b).toFixed(2)}°</div></>;
  }
  if (r.kind === 'area') {
    const { area, perimeter } = areaOf(r.points);
    return (
      <>
        <div>{r.how === 'room' || r.how === 'trace' ? 'Room area' : 'Area'} <b className="cad-big">{m2(toM2(area))}</b></div>
        <div className="m">Perimeter {m(toM(perimeter))}{r.how === 'object' ? ' · of the object picked' : ''}</div>
        <AddRoom key={`${area}:${r.name ?? ''}`} project={project} areaM2={toM2(area)} name={r.name ?? ''} file={view.file} level={planLevel(project, view.file).floor?.key} onChange={onChange}
          outline={r.points.map(([x, y]): Pt => [Math.round(toM(x) * 1000) / 1000, Math.round(toM(y) * 1000) / 1000])} startOpen={r.how === 'trace' || r.how === 'room'} onAdded={onAdded} />
      </>
    );
  }
  const o = r.o;
  const layer = view.info.layers[o.layer];
  return (
    <>
      <div><b>{o.kind}{o.block ? ` · ${o.block}` : ''}</b></div>
      <dl className="cad-props">
        <dt>Layer</dt><dd><i style={{ background: hex(layer?.rgb ?? 0) }} />{layer?.name ?? '—'}</dd>
        <dt>Handle</dt><dd>{o.handle}</dd>
        {o.text !== undefined && <><dt>Text</dt><dd>{o.text}</dd></>}
        {o.radius !== undefined && <><dt>Radius</dt><dd>{m(toM(o.radius))}</dd></>}
        {o.length !== undefined && <><dt>{o.closed ? 'Perimeter' : 'Length'}</dt><dd>{m(toM(o.length))}</dd></>}
        {o.area !== undefined && <><dt>Area</dt><dd>{m2(toM2(o.area))}</dd></>}
        {o.vertices !== undefined && <><dt>Vertices</dt><dd>{o.vertices}{o.closed ? ' · closed' : ''}</dd></>}
        {Object.entries(o.attrs ?? {}).map(([k, v]) => <><dt key={`k${k}`}>{k}</dt><dd key={`v${k}`}>{v || '—'}</dd></>)}
      </dl>
    </>
  );
}

/** Tray fittings counted by kind and size ("2 × Bend 90° 300"). */
function Fittings({ fittings, title }: { fittings: TrayFitting[]; title: string }) {
  if (!fittings.length) return null;
  return (
    <dl className="cad-props" aria-label={title}>
      <dt>{title}</dt><dd>{fittingCounts(fittings).map(([label, n]) => `${n} × ${label}`).join(', ')}</dd>
    </dl>
  );
}

/** Width and tray route of a cable tray run: the route is optional (Not assigned), chosen from the project's tray
 * routes. */
function TrayFields({ project, widthMm, route, onChange }: { project: Project; widthMm: number; route: string; onChange: (t: { widthMm?: number; route?: string }) => void }) {
  const routes = trayPlanOf(project).routes;
  return (
    <>
      <label>Width<select aria-label="Tray width" value={widthMm} onChange={(e) => onChange({ widthMm: Number(e.target.value) })}>
        {TRAY_WIDTHS.map((w) => <option key={w} value={w}>{w} mm</option>)}
      </select></label>
      <label>Route<select aria-label="Tray route" value={route} onChange={(e) => onChange({ route: e.target.value })}>
        <option value="">Not assigned</option>
        {routes.map((r) => <option key={r.id} value={r.name}>{r.name}{r.from || r.to ? ` · ${r.from ?? ''} → ${r.to ?? ''}` : ''}</option>)}
        {route && !routes.some((r) => r.name === route) && <option value={route}>{route}</option>}
      </select></label>
    </>
  );
}

/** Sends a measured area to Building information as a room on a level. */
function AddRoom({ project, areaM2, name: initial, file, level, outline, startOpen, onChange, onAdded }: {
  project: Project; areaM2: number; name: string; file: string; level?: string; outline: Pt[]; startOpen?: boolean; onChange: (next: Project, message: string) => void; onAdded: () => void;
}) {
  const floors = floorList(project.building).filter((f) => !f.ref.index);
  const [open, setOpen] = useState(!!startOpen);
  const [name, setName] = useState(initial);
  const [levelKey, setLevelKey] = useState(level ?? floors[0]?.key ?? '');
  const floor = floors.find((f) => f.key === levelKey);
  if (!open) return <button className="chip cad-addroom" onClick={() => setOpen(true)}>Add as room…</button>;
  if (!floors.length) return <p className="m">Add the building and its levels in Building information first; rooms are kept per level.</p>;
  return (
    <div className="cad-roomform">
      <label>Name<input value={name} placeholder="e.g. Majlis" onChange={(e) => setName(e.target.value)} /></label>
      <label>Level<select value={levelKey} onChange={(e) => setLevelKey(e.target.value)}>{floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}</select></label>
      <button className="chip primary" disabled={!floor} onClick={() => {
        const room = pickedRoom(project, name.trim(), areaM2, file, floor!.ref, outline);
        const { project: next } = putRooms(project, [room], floor!.ref, []);
        onChange(next, `${room.name} · ${m2(room.areaM2)} added to ${floorLabel(project.building, floor!)} · ⌘Z to undo`);
        setOpen(false); onAdded();
      }}>Add</button>
    </div>
  );
}
