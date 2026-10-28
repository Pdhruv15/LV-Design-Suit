import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui';
import CadLayerTable from './CadLayerTable';
import FloorPlanCanvas, { type PlanMark, type PlanOverlay, type PlanPath, type PlanRoomShape } from './FloorPlanCanvas';
import { BoardsPanel, LengthsPanel, TraysPanel, type TaskProps } from './FloorPlanTasks';
import { buildingInfoOf, roomTypesOf } from '../calc/building';
import { planFromDrawing, type CadDrawing } from '../model/cadDrawing';
import { polygonArea, roomBoundaryAt, wallSegments } from '../model/cadBoundary';
import { metresPerUnit } from '../model/cadLengths';
import { inside } from '../model/cadPlaces';
import { blockAt, curveAt, linkedDrawing, linkedPaths, linksFor, placeBoard, toggleCurve, withLinks, withPointPlaces } from '../model/cadPlanLinks';
import { applyRooms, layerMapFor, proposeRooms, roomsFromPlan, type CadRoom } from '../model/cadRooms';
import { floorLabel, floorList } from '../model/levels';
import type { CadLayerMap, CadLayerRole, CadPlanLinks, Project } from '../types';

type Pt = [number, number];
export type FloorPlanTask = 'rooms' | 'lengths' | 'trays' | 'boards';
type Tool = 'auto' | 'room' | 'trace' | 'name' | 'dist' | 'area' | 'link' | 'tray' | 'place';
interface Picked { name: string; points: Pt[]; areaM2: number }

/** Widest opening (m) closed as a wall when a room is found from a click inside it: doors. */
const DOOR_GAP_M = 1.2;
/** How far from the click (m) walls are looked for. */
const REACH_M = 25;

const TASKS: { id: FloorPlanTask; label: string }[] = [
  { id: 'rooms', label: 'Rooms' }, { id: 'lengths', label: 'Cable lengths' }, { id: 'trays', label: 'Tray routes' }, { id: 'boards', label: 'Boards' }
];
const TOOLS: Record<Tool, { label: string; hint: string; icon: string }> = {
  auto: { label: 'Find rooms', hint: 'Rooms with a closed outline on a room layer are found and named automatically. Click one to check it.', icon: 'M3 4h8v7H3zM13 4h8v7h-8zM3 13h18v7H3z' },
  room: { label: 'Click inside room', hint: 'Click inside a room: its walls are followed to make the outline (door openings up to 1.2 m are closed) and its area is measured.', icon: 'M4 5h16v14H4zM12 9v6M9 12h6' },
  trace: { label: 'Trace outline', hint: 'Click the corners of the room, then click the first corner again (or press Enter). Esc cancels.', icon: 'M4 18 6 6l12 2 2 10z' },
  name: { label: 'Pick room name', hint: 'Click the room name text on the plan; it names the selected room.', icon: 'M5 6h14M12 6v12M9 18h6' },
  dist: { label: 'Measure length', hint: 'Click two points to measure a length on the plan.', icon: 'M3 17 17 3M3 17l3 3M17 3l3 3' },
  area: { label: 'Measure area', hint: 'Click the corners of an area, then the first corner again (or Enter). Nothing is added.', icon: 'M4 20V8l8-4 8 4v12zM8 14h8' },
  link: { label: 'Link route', hint: 'Choose a feeder, then click the lines of its cable route; click a linked line again to unlink it. Routes on the cable route layers link themselves.', icon: 'M4 18c4 0 4-12 8-12s4 12 8 12M4 18h.01M20 18h.01' },
  tray: { label: 'Link tray run', hint: 'Type a tray route (A, T-2…), then click its runs; click a linked run again to unlink it. Runs on the tray layers are named by their labels.', icon: 'M3 9h18v6H3zM7 9v6M12 9v6M17 9v6' },
  place: { label: 'Place board', hint: 'Choose a board, then click its symbol (or the spot) on the plan. Boards whose block has a TAG / BOARD / PANEL attribute are found by themselves.', icon: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h3' }
};
const TOOLS_OF: Record<FloorPlanTask, Tool[]> = {
  rooms: ['auto', 'room', 'trace', 'name', 'dist', 'area'],
  lengths: ['link', 'dist'],
  trays: ['tray', 'dist'],
  boards: ['place', 'dist']
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Floor plan window: an architect's DWG / DXF plan read by the built-in reader (no CAD program), shown in the app.
 * Rooms: closed outlines found automatically; others found by a click inside them (walls followed, doors closed) or
 * traced, and named by clicking their name — to Building information (the Load assessment follows). Cable lengths,
 * tray routes and board locations: routes, tray runs and boards linked automatically from the layer map and by
 * clicking, reviewed beside the design. Links are kept in the project per drawing. 2D plan only. */
export default function FloorPlanView({ project, initialTask = 'rooms', initialPlan, onApply, onClose }: {
  project: Project;
  initialTask?: FloorPlanTask;
  /** A plan already read (opened from Finder / Explorer). */
  initialPlan?: { file: string; drawing: CadDrawing } | null;
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const cadFile = window.lvds?.cadFile;
  const [file, setFile] = useState('');
  const [drawing, setDrawing] = useState<CadDrawing | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [roles, setRoles] = useState<CadLayerMap[]>([]);
  const [links, setLinks] = useState<CadPlanLinks>({ file: '' });
  const [showLayers, setShowLayers] = useState(false);
  const floors = floorList(project.building).filter((f) => !f.ref.index); // one entry per level, not per typical floor
  const [levelKey, setLevelKey] = useState(floors[0]?.key ?? '');
  const [task, setTask] = useState<FloorPlanTask>(initialTask);
  const [tool, setTool] = useState<Tool>(TOOLS_OF[initialTask][0]);
  const [targets, setTargets] = useState<Record<FloorPlanTask, string>>({ rooms: '', lengths: '', trays: '', boards: '' });
  const [picked, setPicked] = useState<Picked[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [types, setTypes] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [zoomKey, setZoomKey] = useState(0);

  const info = buildingInfoOf(project);
  const roomTypes = roomTypesOf(info);
  const floor = floors.find((f) => f.key === levelKey);
  const plan = useMemo(() => (drawing ? planFromDrawing(drawing, { file }) : null), [drawing, file]);
  const mpu = plan ? metresPerUnit(plan.units, project.cadLength).factor : 1;
  // The plan with this window's links, and the curves of the route and tray layers (for the other tasks).
  const linked = useMemo(() => (drawing ? linkedDrawing(drawing, links) : null), [drawing, links]);
  const curveLayers = useMemo(() => roles.filter((m) => m.role === 'route' || m.role === 'tray').map((m) => m.layer), [roles]);
  const linkedPlan = useMemo(() => (linked ? withPointPlaces(planFromDrawing(linked, { file, curveLayers }), links) : null), [linked, file, curveLayers, links]);
  const read = useMemo(() => (plan ? roomsFromPlan(plan, roles, project.cadLength) : null), [plan, roles, project.cadLength]);
  const outlines = useMemo(() => new Map((plan?.outlines ?? []).filter((o) => o.handle).map((o) => [o.handle!, o.points])), [plan]);
  const found = read?.rooms ?? [];
  const all: CadRoom[] = [...found, ...picked.map((p, k): CadRoom => ({ name: p.name || `Room ${found.length + k + 1}`, areaM2: p.areaM2, layer: '', named: !!p.name, file }))];
  const review = floor && read ? proposeRooms(project, all, floor.ref.building, floor.ref.level) : null;
  const rows = (review?.proposals ?? []).map((r, i) => ({ ...r, i, name: names[i] ?? r.name, type: types[i] ?? r.type, picked: i >= found.length }));
  const changing = rows.filter((r) => r.status !== 'same');
  const accepted = changing.filter((r) => !skip.has(r.i));
  const shapeOf = (i: number): Pt[] => (i < found.length ? outlines.get(found[i].handle ?? '') ?? [] : picked[i - found.length]?.points ?? []);
  const target = targets[task];
  const setTarget = (v: string) => setTargets((t) => ({ ...t, [task]: v }));

  // Walls for "Click inside room": the wall and room-outline layers; without a wall layer, every drawn layer that is not
  // text, blocks, trays, routes or ignored.
  const segments = useMemo(() => {
    if (!drawing) return [];
    const walls = roles.filter((m) => m.role === 'wall' || m.role === 'room');
    const use = roles.some((m) => m.role === 'wall') ? walls : roles.filter((m) => !['ignore', 'room-name', 'fixture', 'board', 'tray', 'route'].includes(m.role));
    return wallSegments(drawing, new Set(use.map((m) => m.layer.toLowerCase())));
  }, [drawing, roles]);

  function load(f: string, d: CadDrawing) {
    const p = planFromDrawing(d);
    setFile(f); setDrawing(d); setRoles(layerMapFor(project, p.layers ?? [])); setLinks(linksFor(project, f));
    setPicked([]); setNames({}); setTypes({}); setSkip(new Set()); setSelected(null); setPoints([]); setTool(TOOLS_OF[task][0]); setFitKey((k) => k + 1);
  }
  useEffect(() => {
    if (initialPlan) load(initialPlan.file, initialPlan.drawing);
  }, [initialPlan]); // eslint-disable-line react-hooks/exhaustive-deps -- a plan handed over once

  async function open() {
    if (!cadFile) return;
    setBusy(true); setNote('');
    try {
      const r = await cadFile.openPlan();
      if (r) load(r.file, r.drawing);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const textAt = (at: Pt, pixel: number) => {
    let best: { s: string; d: number } | undefined;
    for (const e of drawing?.entities ?? []) {
      if (e.k !== 'text' || !e.s.trim()) continue;
      const ht = e.ht || 12 * pixel;
      const w = 0.6 * ht * e.s.length;
      const dx = at[0] < e.at[0] ? e.at[0] - at[0] : at[0] > e.at[0] + w ? at[0] - e.at[0] - w : 0;
      const dy = at[1] < e.at[1] ? e.at[1] - at[1] : at[1] > e.at[1] + ht ? at[1] - e.at[1] - ht : 0;
      const d = Math.hypot(dx, dy);
      if (d <= 6 * pixel && (!best || d < best.d)) best = { s: e.s.trim(), d };
    }
    return best?.s;
  };
  const nameInside = (poly: Pt[]) => {
    const t = (plan?.texts ?? []).filter((x) => inside([x.x, x.y], poly) && roles.find((m) => m.layer === x.layer)?.role === 'room-name');
    const tag = (plan?.tags ?? []).find((x) => inside([x.x, x.y], poly) && x.name);
    return tag?.name ?? t[0]?.text ?? '';
  };
  const addPicked = (poly: Pt[], areaUnits: number) => {
    const name = nameInside(poly);
    setPicked((p) => [...p, { name, points: poly, areaM2: round2(areaUnits * mpu * mpu) }]);
    setSelected(found.length + picked.length);
    setPoints([]);
    if (!name) { setTool('name'); setNote('Room added. Click its name on the plan, or type it.'); } else setNote(`Room "${name}" added.`);
  };
  const rename = (i: number, name: string) => {
    if (i >= found.length) setPicked((p) => p.map((x, k) => (k === i - found.length ? { ...x, name } : x)));
    else setNames((n) => ({ ...n, [i]: name }));
  };

  function click(at: Pt, pixel: number) {
    setNote('');
    const closes = points.length >= 3 && Math.hypot(at[0] - points[0][0], at[1] - points[0][1]) <= 8 * pixel;
    if (tool === 'auto') {
      const hits = rows.filter((r) => inside(at, shapeOf(r.i))).sort((a, b) => Math.abs(polygonArea(shapeOf(a.i))) - Math.abs(polygonArea(shapeOf(b.i))));
      setSelected(hits[0]?.i ?? null);
    } else if (tool === 'room') {
      const room = roomBoundaryAt(segments, at, { gap: DOOR_GAP_M / mpu, reach: REACH_M / mpu });
      if (!room) setNote('No closed room around that point (open to the outside, or larger than 50 m across). Trace its outline instead.');
      else addPicked(room.points, room.area);
    } else if (tool === 'trace') {
      if (closes) addPicked(points, Math.abs(polygonArea(points)));
      else setPoints((p) => [...p, at]);
    } else if (tool === 'name') {
      const s = textAt(at, pixel);
      if (!s) setNote('No text there. Click on the room name.');
      else if (selected === null) setNote('Select a room first (in the list or with Find rooms).');
      else rename(selected, s);
    } else if (tool === 'dist') {
      setPoints((p) => (p.length >= 2 ? [at] : [...p, at]));
    } else if (tool === 'area') {
      setPoints((p) => (closes ? [...p, p[0]] : p.length && p[p.length - 1] === p[0] ? [at] : [...p, at]));
    } else if (tool === 'link' || tool === 'tray') {
      if (!target) { setNote(tool === 'link' ? 'Choose the feeder first.' : 'Type the tray route first.'); return; }
      const c = curveAt(drawing!, at, 6 * pixel);
      if (!c) { setNote('No line, arc or polyline there.'); return; }
      const kind = tool === 'link' ? 'routes' : 'trays';
      const was = links[kind]?.[c.h];
      setLinks((l) => toggleCurve(l, kind, c.h, target));
      setNote(was === target ? `Unlinked from ${target}.` : `Linked to ${target}.`);
    } else if (tool === 'place') {
      if (!target) { setNote('Choose the board first.'); return; }
      const b = blockAt(drawing!, at, 8 * pixel);
      setLinks((l) => placeBoard(l, target, b ? { handle: b.h, x: b.at[0], y: b.at[1] } : { x: at[0], y: at[1] }));
      setNote(`${target} placed ${b ? `at block ${b.name}` : 'at that point'}.`);
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && points.length) { e.stopPropagation(); setPoints([]); }
      if (e.key === 'Enter' && points.length >= 3) {
        if (tool === 'trace') addPicked(points, Math.abs(polygonArea(points)));
        if (tool === 'area') setPoints((p) => [...p, p[0]]);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  const closedArea = points.length > 3 && points[points.length - 1] === points[0];
  const live = cursor && !closedArea && points.length && (tool === 'trace' || tool === 'area' || (tool === 'dist' && points.length === 1)) ? [...points, cursor] : points;
  const lengthM = tool === 'dist' && live.length === 2 ? Math.hypot(live[1][0] - live[0][0], live[1][1] - live[0][1]) * mpu : undefined;
  const areaM2 = (tool === 'area' || tool === 'trace') && live.length >= 3 ? Math.abs(polygonArea(closedArea ? points.slice(0, -1) : live)) * mpu * mpu : undefined;
  const overlay: PlanOverlay | undefined = live.length ? {
    points: live, closed: closedArea,
    label: lengthM !== undefined ? `${lengthM.toFixed(2)} m` : areaM2 !== undefined ? `${areaM2.toFixed(2)} m²` : undefined
  } : undefined;
  const shapes: PlanRoomShape[] = task === 'rooms' ? rows.map((r) => ({ key: String(r.i), points: shapeOf(r.i), picked: r.picked, selected: r.i === selected })) : [];
  const routePaths = useMemo(() => (drawing ? linkedPaths(drawing, links) : []), [drawing, links]);
  const paths: PlanPath[] = task === 'lengths' || task === 'trays'
    ? routePaths.filter((p) => (task === 'lengths' ? p.kind === 'route' : true)).map((p) => ({ points: p.points, tone: p.to === target ? 'on' : p.kind }))
    : [];
  const marks: PlanMark[] = task === 'boards' && linkedPlan
    ? [...linkedPlan.places.map((p) => ({ at: [p.x, p.y] as Pt, label: p.boardId, on: p.boardId === target })), ...linkedPlan.symbols.filter((s) => !linkedPlan.places.some((p) => p.boardId === s.name)).map((s) => ({ at: [s.x, s.y] as Pt, label: s.name }))]
    : [];
  const sel = rows.find((r) => r.i === selected);
  const targetM = (task === 'lengths' || task === 'trays') && target ? routePaths.filter((p) => p.to === target && p.kind === (task === 'lengths' ? 'route' : 'tray')).reduce((s, p) => s + p.length, 0) * mpu : 0;
  const readout = lengthM !== undefined ? `Length ${lengthM.toFixed(2)} m` : areaM2 !== undefined ? `Area ${areaM2.toFixed(2)} m²`
    : task === 'rooms' ? (read ? `Rooms found: ${found.length}${picked.length ? ` · picked: ${picked.length}` : ''}` : '')
      : targetM ? `${target}: ${targetM.toFixed(2)} m linked on the plan` : '';

  function applyRoomsToProject() {
    if (!floor) return;
    const same = rows.filter((r) => r.status === 'same');
    const next = withLinks(applyRooms(project, accepted, floor.ref.building, floor.ref.level, roles, same), links);
    onApply(next, accepted.length ? `Floor plan: ${accepted.length} room${accepted.length === 1 ? '' : 's'} on ${floorLabel(project.building, floor)} updated` : 'Floor plan: layer mapping saved, no rooms changed');
  }

  if (!cadFile) {
    return (
      <Modal onClose={onClose} className="modal">
        <h3>Floor plan</h3>
        <p className="m">Opening a floor plan (DWG / DXF) needs the LV Design Studio desktop app.</p>
        <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }

  const taskProps: TaskProps | null = linkedPlan && linked ? {
    project, plan: linkedPlan, linked, roles, links, level: floor?.ref, levelName: floor ? floorLabel(project.building, floor) : undefined,
    target, onTarget: setTarget, onApply
  } : null;

  return (
    <Modal onClose={onClose} className="modal fp-window" label="Floor plan" closeOnBackdrop={false}>
      <div className="fp-head">
        <h3>Floor plan</h3>
        {drawing && <span className="m">{file} · {drawing.format} · {read?.units}</span>}
        {drawing && <span className="fp-tag">read in LV Design Studio</span>}
        <span className="sp" />
        {floors.length > 0 && (
          <label className="row">This plan shows
            <select aria-label="Level of this plan" value={levelKey} onChange={(e) => setLevelKey(e.target.value)}>
              {floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}
            </select>
          </label>
        )}
        <button className="chip" disabled={busy} onClick={open}>{busy ? 'Opening…' : 'Open floor plan…'}</button>
        <button className="chip" disabled={!plan} aria-pressed={showLayers} onClick={() => setShowLayers((s) => !s)}>Layers…</button>
        <button className="chip" onClick={onClose}>Close</button>
      </div>

      <div className="fp-tools" role="toolbar" aria-label="Plan tools">
        {TOOLS_OF[task].map((id, k) => (
          <button key={id} className={`fp-tool${k > 0 && id === 'dist' ? ' fp-gap' : ''}`} aria-pressed={tool === id} disabled={!drawing} onClick={() => { setTool(id); setPoints([]); setNote(''); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={TOOLS[id].icon} /></svg>{TOOLS[id].label}
          </button>
        ))}
        <span className="sp" />
        <button className="fp-tool" disabled={!drawing} onClick={() => setZoomKey((k) => k + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-4.5-4.5M8 11h6M11 8v6" /></svg>Zoom</button>
        <button className="fp-tool" disabled={!drawing} onClick={() => setFitKey((k) => k + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>Fit</button>
      </div>

      <div className="fp-body">
        <div className="fp-stage">
          {drawing ? (
            <FloorPlanCanvas drawing={drawing} rooms={shapes} overlay={overlay} paths={paths} marks={marks} fitKey={fitKey} zoomKey={zoomKey} onClick={click} onMove={setCursor} />
          ) : (
            <p className="m fp-empty">Open an architect's floor plan (DWG or DXF). It is read here; no CAD program is needed.</p>
          )}
          {readout && <div className="fp-readout">{readout}</div>}
          {drawing && <div className="fp-hint">{note || TOOLS[tool].hint}</div>}
          {!drawing && note && <div className="fp-hint">{note}</div>}
        </div>

        <aside className="fp-side">
          <div className="fp-tasks" role="tablist" aria-label="What to take from the plan">
            {TASKS.map((t) => (
              <button key={t.id} role="tab" aria-selected={task === t.id} onClick={() => { setTask(t.id); setTool(TOOLS_OF[t.id][0]); setPoints([]); setNote(''); setShowLayers(false); }}>{t.label}</button>
            ))}
          </div>
          {showLayers && plan ? (
            <div className="fp-layers">
              <h4>Layers</h4>
              <CadLayerTable layers={plan.layers ?? []} roles={roles}
                onChange={(layer: string, role: CadLayerRole) => setRoles((m) => m.map((x) => (x.layer === layer ? { ...x, role } : x)))}
                onApplyMap={setRoles} />
            </div>
          ) : task !== 'rooms' ? (
            taskProps ? (
              task === 'lengths' ? <LengthsPanel {...taskProps} /> : task === 'trays' ? <TraysPanel {...taskProps} /> : <BoardsPanel {...taskProps} />
            ) : <p className="m fp-pad">Open a floor plan first.</p>
          ) : (
            <>
              <h4>Room <small className="m">{sel ? (sel.picked ? 'picked on the plan' : 'found on the room layer') : 'click a room on the plan'}</small></h4>
              {sel && (
                <div className="fp-form">
                  <label>Name<input value={sel.name} disabled={!!sel.existingId && !sel.picked} onChange={(e) => rename(sel.i, e.target.value)} /></label>
                  <label>Area (m²)<input value={sel.areaM2.toFixed(2)} readOnly /></label>
                  <label>Room type
                    <select value={sel.type ?? ''} onChange={(e) => setTypes((x) => ({ ...x, [sel.i]: e.target.value }))}>
                      <option value="">Choose…</option>
                      {roomTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </label>
                  {sel.picked && <button className="chip" onClick={() => { setPicked((p) => p.filter((_, k) => k !== sel.i - found.length)); setSelected(null); }}>Remove</button>}
                </div>
              )}
              <div className="fp-list">
                {!floors.length ? <p className="m fp-pad">Add the building and its levels in Building information first; rooms are kept per level.</p> : (
                  <table className="bi-table compact">
                    <thead><tr><th /><th>Room</th><th>Area m²</th><th>Type</th><th>Status</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.i} className={r.i === selected ? 'sel' : undefined} onClick={() => setSelected(r.i)}>
                          <td>{r.status !== 'same' && <input type="checkbox" aria-label={`Add ${r.name}`} checked={!skip.has(r.i)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSkip((k) => { const n = new Set(k); if (e.target.checked) n.delete(r.i); else n.add(r.i); return n; })} />}</td>
                          <td>{r.name}</td>
                          <td className="num">{r.areaM2.toFixed(2)}</td>
                          <td>{roomTypes.find((t) => t.id === r.type)?.label ?? '—'}</td>
                          <td className="m">{r.status === 'new' ? (r.picked ? 'New · picked' : 'New') : r.status === 'same' ? 'Matches' : `${r.currentAreaM2?.toFixed(2)} → ${r.areaM2.toFixed(2)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {review && review.notOnPlan.length > 0 && <p className="m fp-pad">On this level but not on the plan (kept): {review.notOnPlan.map((r) => r.name).join(', ')}</p>}
              </div>
              <div className="modal-actions fp-foot">
                <span className="m">{read ? `${changing.length} to add or update · ${rows.length - changing.length} match · the Load assessment follows Building information` : ''}</span>
                <span className="sp" />
                <button className="chip primary" disabled={!plan || !floor} onClick={applyRoomsToProject}>Add to Building information</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </Modal>
  );
}
