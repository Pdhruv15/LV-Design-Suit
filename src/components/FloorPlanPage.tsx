import { useEffect, useMemo, useRef, useState } from 'react';
import CadLayerTable from './CadLayerTable';
import FloorPlanCanvas, { type PlanDrag, type PlanMark, type PlanOverlay, type PlanPath, type PlanRoomShape } from './FloorPlanCanvas';
import ElvPlanPanel from './elv/ElvPlanPanel';
import { coverageNote, deviceLabel, deviceNear, elvLayer, fillAt, moveTo, placeAt, remove, rotate } from './elv/elvPlan';
import { rememberedPlan, type FloorPlanPanel, type FloorPlanState, type FloorPlanTool } from './floorPlanState';
import { buildingInfoOf, roomTypesOf } from '../calc/building';
import { trayPlanOf } from '../calc/cableTray';
import { polygonArea, roomBoundaryAt, wallSegments } from '../model/cadBoundary';
import { CAD_LENGTH_DEFAULTS, lengthBreakdown, metresPerUnit, pullCadLengths } from '../model/cadLengths';
import { inside, pullBoardPlaces } from '../model/cadPlaces';
import { blockAt, curveAt, linkedPaths, placeBoard, toggleCurve } from '../model/cadPlanLinks';
import { withLayerMap } from '../model/cadRooms';
import { pullCadTrays } from '../model/cadTrays';
import { pickedRoom, planRoutes, planState, putBoards, putLengths, putRooms, putTrays, renameRoom, trayPlan, withPlan } from '../model/floorPlanActions';
import { floorLabel, floorList } from '../model/levels';
import type { CadLayerMap, CadLayerRole, CadLengthSettings, Feeder, Project } from '../types';

type Pt = [number, number];

/** Widest opening (m) closed as a wall when a room is found from a click inside it: doors. */
const DOOR_GAP_M = 1.2;
/** How far from the click (m) walls are looked for. */
const REACH_M = 25;

const HINTS: Record<FloorPlanTool, string> = {
  auto: 'Click a room the plan outlines to add it, or press Add found rooms to add them all.',
  room: 'Click inside a room: its outline comes from the walls (door openings up to 1.2 m closed) and it is added to Building information.',
  trace: 'Click the corners of the room, then the first corner again (or Enter): it is added. Esc cancels.',
  name: 'Click the room name text on the plan: it names the selected room.',
  link: 'Choose the feeder on the right, then click the lines of its route: its length is updated. Click a linked line again to unlink it.',
  tray: 'Type the tray route on the right, then click its runs: the tray length and the feeders on it are updated.',
  place: 'Choose the board on the right, then click its symbol or the spot: its room, level and position are updated.',
  dist: 'Click two points to measure a length.',
  area: 'Click the corners of an area, then the first corner again (or Enter). Nothing is added.',
  'elv-place': 'Pick a device on the right, then click the plan: it goes into the room under it.',
  'elv-fill': 'Point at a room to see a grid of the chosen device at its coverage spacing; click to place it.',
  'elv-select': 'Click a device to select it, drag it to move it. Delete removes it; ← → turn a camera or speaker.'
};
/** Tools that draw something following the pointer; other tools leave the page alone while it moves. */
const FOLLOWS_POINTER = new Set<FloorPlanTool>(['trace', 'area', 'dist', 'elv-fill']);
const PANELS: { id: FloorPlanPanel; label: string }[] = [{ id: 'rooms', label: 'Rooms' }, { id: 'cables', label: 'Cables' }, { id: 'trays', label: 'Trays' }, { id: 'boards', label: 'Boards' }, { id: 'elv', label: 'ELV' }];

export const feederLabel = (f: Feeder) => (f.feedsBoardId ? `${f.boardId} → ${f.feedsBoardId}` : `${f.boardId} ${f.phase && f.way ? `${f.phase}${f.way}` : ''} ${f.name}`.replace(/\s+/g, ' ').trim());
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : undefined; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The Floor plan page: an architect's DWG / DXF plan in the app's canvas, beside the SLD. The tools are on the Floor
 * plan ribbon tab; each pick changes the model at once (one undo step): rooms into Building information (and so the Load
 * assessment), feeder lengths, tray routes, board locations. The panel shows what is in the model. 2D plan only. */
export default function FloorPlanPage({ project, fp, onChange, onStatus }: {
  project: Project;
  fp: FloorPlanState;
  onChange: (next: Project, message: string) => void;
  onStatus: (message: string) => void;
}) {
  const cadFile = window.lvds?.cadFile;
  const [points, setPoints] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<{ id: string; at: Pt } | null>(null); // ELV device being dragged (metres)
  const [note, setNote] = useState('');
  const { plan: open, tool } = fp;
  const floors = floorList(project.building).filter((f) => !f.ref.index); // one entry per level, not per typical floor
  const floor = floors.find((f) => f.key === fp.levelKey) ?? floors[0];
  const level = floor?.ref;
  const info = buildingInfoOf(project);
  const roomTypes = roomTypesOf(info);
  const s = useMemo(() => (open ? planState(project, open) : null), [project, open]);
  // Linked routes and tray runs: worked out once per plan and link change, not on every pointer move.
  const linkPaths = useMemo(() => (open && s ? linkedPaths(open.drawing, s.links) : []), [open, s]);
  const mpu = s ? metresPerUnit(s.plan.units, project.cadLength).factor : 1;
  const segments = useMemo(() => {
    if (!open || !s) return [];
    const walls = s.roles.filter((m) => m.role === 'wall' || m.role === 'room');
    const use = s.roles.some((m) => m.role === 'wall') ? walls : s.roles.filter((m) => !['ignore', 'room-name', 'fixture', 'board', 'tray', 'route'].includes(m.role));
    return wallSegments(open.drawing, new Set(use.map((m) => m.layer.toLowerCase())));
  }, [open, s]);
  useEffect(() => { setPoints([]); setNote(''); setCursor(null); }, [tool]);
  // Enter / Esc while tracing or measuring (the handler is set below, once a plan is open).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  async function load(read: () => Promise<{ file: string; path?: string; drawing: import('../model/cadDrawing').CadDrawing } | null>) {
    setBusy(true); setNote('');
    try { const r = await read(); if (r) fp.setPlan(r); else setNote('That plan is no longer where it was. Open it again.'); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const last = rememberedPlan(project.id);

  if (!open || !s) {
    return (
      <section className="stage fpp-empty">
        <h3>Floor plan</h3>
        {cadFile ? (
          <>
            <p className="m">Open an architect's floor plan (DWG or DXF). It is read here — no CAD program is needed — and shown like the SLD; the tools are on the Floor plan ribbon tab.</p>
            <div className="fpp-actions">
              <button className="chip primary" disabled={busy} onClick={() => load(() => cadFile.openPlan())}>{busy ? 'Opening…' : 'Open plan…'}</button>
              {last && cadFile.readPlan && <button className="chip" disabled={busy} onClick={() => load(() => cadFile.readPlan!(last!))}>Reopen {last.split(/[\\/]/).pop()}</button>}
            </div>
          </>
        ) : <p className="m">Opening a floor plan (DWG / DXF) needs the LV Design Studio desktop app.</p>}
        {note && <p className="m">{note}</p>}
      </section>
    );
  }

  const cur = open;
  const roles = s.roles;
  const links = s.links;
  const change = (next: Project, message: string) => { onChange(next, message); setNote(message); };
  const levelRooms = level ? info.rooms.filter((r) => r.buildingId === level.building && r.levelId === level.level) : [];
  const roomInModel = (name: string, handle?: string) => levelRooms.find((r) => (handle && r.source?.sourceId === handle && r.source.file?.toLowerCase() === open.file.toLowerCase()) || r.name.toLowerCase() === name.toLowerCase());
  const found = s.rooms.rooms.map((r) => ({ room: r, points: s.base.outlines.find((o) => o.handle && o.handle === r.handle)?.points ?? [], model: roomInModel(r.name, r.handle) }));
  const notAdded = found.filter((f) => !f.model || Math.abs(f.model.areaM2 - f.room.areaM2) >= 0.05);
  const nameInside = (poly: Pt[]) => {
    const tag = (s.base.tags ?? []).find((x) => inside([x.x, x.y], poly) && x.name);
    const text = s.base.texts.find((x) => inside([x.x, x.y], poly) && roles.find((m) => m.layer === x.layer)?.role === 'room-name');
    return tag?.name ?? text?.text ?? '';
  };
  const textAt = (at: Pt, pixel: number) => {
    let best: { s: string; d: number } | undefined;
    for (const e of open.drawing.entities) {
      if (e.k !== 'text' || !e.s.trim()) continue;
      const ht = e.ht || 12 * pixel, w = 0.6 * ht * e.s.length;
      const dx = at[0] < e.at[0] ? e.at[0] - at[0] : at[0] > e.at[0] + w ? at[0] - e.at[0] - w : 0;
      const dy = at[1] < e.at[1] ? e.at[1] - at[1] : at[1] > e.at[1] + ht ? at[1] - e.at[1] - ht : 0;
      const d = Math.hypot(dx, dy);
      if (d <= 6 * pixel && (!best || d < best.d)) best = { s: e.s.trim(), d };
    }
    return best?.s;
  };
  const needLevel = () => { if (!level) setNote('Add the building and its levels in Building information first; rooms are kept per level.'); return !!level; };

  function addPicked(poly: Pt[], areaUnits: number) {
    if (!needLevel()) return;
    const room = pickedRoom(project, nameInside(poly), areaUnits * mpu * mpu, cur.file, level!, poly.map(([x, y]): Pt => [Math.round(x * mpu * 1000) / 1000, Math.round(y * mpu * 1000) / 1000]));
    const { project: next, ids } = putRooms(withPlan(project, roles, links), [room], level!, roles);
    if (ids[0]) { fp.setOutlines((o) => ({ ...o, [ids[0]]: poly })); fp.setSelectedRoom(ids[0]); }
    setPoints([]);
    change(next, `${room.name} · ${room.areaM2.toFixed(2)} m² added to ${floorLabel(project.building, floor!)}${room.named ? '' : ' — click its name on the plan (Pick name)'} · ⌘Z to undo`);
  }
  function addFound() {
    if (!needLevel()) return;
    if (!notAdded.length) { setNote('Every room the plan outlines is already in the model.'); return; }
    const { project: next } = putRooms(project, notAdded.map((f) => f.room), level!, roles);
    change(withPlan(next, roles, links), `${plural(notAdded.length, 'room')} from the plan added or updated on ${floorLabel(project.building, floor!)} · ⌘Z to undo`);
  }
  fp.addFoundRef.current = addFound;

  function click(at: Pt, pixel: number) {
    setNote('');
    const closes = points.length >= 3 && Math.hypot(at[0] - points[0][0], at[1] - points[0][1]) <= 8 * pixel;
    if (tool === 'auto') {
      const hit = found.filter((f) => inside(at, f.points)).sort((a, b) => Math.abs(polygonArea(a.points)) - Math.abs(polygonArea(b.points)))[0];
      if (!hit) return;
      if (hit.model && Math.abs(hit.model.areaM2 - hit.room.areaM2) < 0.05) { fp.setSelectedRoom(hit.model.id); return; }
      if (!needLevel()) return;
      const { project: next, ids } = putRooms(project, [hit.room], level!, roles);
      if (ids[0]) fp.setSelectedRoom(ids[0]);
      change(withPlan(next, roles, links), `${hit.room.name} · ${hit.room.areaM2.toFixed(2)} m² ${hit.model ? 'updated' : 'added'} · ⌘Z to undo`);
    } else if (tool === 'room') {
      const room = roomBoundaryAt(segments, at, { gap: DOOR_GAP_M / mpu, reach: REACH_M / mpu });
      if (!room) setNote('No closed room around that point (open to the outside, or larger than 50 m across). Trace its outline instead.');
      else addPicked(room.points, room.area);
    } else if (tool === 'trace') {
      if (closes) addPicked(points, Math.abs(polygonArea(points)));
      else setPoints((p) => [...p, at]);
    } else if (tool === 'name') {
      const text = textAt(at, pixel);
      if (!text) setNote('No text there. Click on the room name.');
      else if (!fp.selectedRoom) setNote('Select a room first (in the list, or click it with Add found rooms).');
      else change(renameRoom(project, fp.selectedRoom, text), `Room named ${text} · ⌘Z to undo`);
    } else if (tool === 'dist') {
      setPoints((p) => (p.length >= 2 ? [at] : [...p, at]));
    } else if (tool === 'area') {
      setPoints((p) => (closes ? [...p, p[0]] : p.length && p[p.length - 1] === p[0] ? [at] : [...p, at]));
    } else if (tool === 'link' || tool === 'tray') {
      const target = tool === 'link' ? fp.targets.feeder : fp.targets.tray;
      if (!target) { setNote(tool === 'link' ? 'Choose the feeder on the right first.' : 'Type the tray route on the right first.'); return; }
      const c = curveAt(cur.drawing, at, 6 * pixel);
      if (!c) { setNote('No line, arc or polyline there.'); return; }
      const kind = tool === 'link' ? 'routes' : 'trays';
      const unlink = links[kind]?.[c.h] === target;
      const withLink = withPlan(project, roles, toggleCurve(links, kind, c.h, target));
      const after = planState(withLink, cur);
      if (tool === 'link') {
        const next = putLengths(withLink, after.plan, after.roles, [target]);
        const f = next.feeders.find((x) => x.id === target);
        change(next, `${unlink ? 'Unlinked from' : 'Linked to'} ${f ? feederLabel(f) : target}${f ? ` · length ${f.lengthM} m` : ''} · ⌘Z to undo`);
      } else {
        const next = putTrays(withLink, after.linked, after.plan, after.roles, target);
        const t = trayPlanOf(next).routes.find((r) => r.name === target);
        change(next, `${unlink ? 'Unlinked from' : 'Linked to'} tray ${target}${t?.lengthM ? ` · ${t.lengthM} m` : ''} · ⌘Z to undo`);
      }
    } else if (tool === 'elv-place' || tool === 'elv-fill' || tool === 'elv-select') {
      if (!needLevel()) return;
      const m: Pt = [at[0] * mpu, at[1] * mpu];
      if (tool === 'elv-select') {
        const d = deviceNear(project, level!, fp.elv.system, m, 10 * pixel * mpu);
        fp.setElv((e) => ({ ...e, selected: d?.id ?? null }));
      } else if (tool === 'elv-place') {
        const r = placeAt(project, level!, fp.elv.device, m);
        fp.setElv((e) => ({ ...e, selected: r.id }));
        change(r.next, r.message);
      } else {
        const r = fillAt(project, level!, fp.elv.device, m);
        if (r.next) change(r.next, r.message); else setNote(r.message);
      }
    } else if (tool === 'place') {
      const board = fp.targets.board;
      if (!board) { setNote('Choose the board on the right first.'); return; }
      const b = blockAt(cur.drawing, at, 8 * pixel);
      const withPlace = withPlan(project, roles, placeBoard(links, board, b ? { handle: b.h, x: b.at[0], y: b.at[1] } : { x: at[0], y: at[1] }));
      const after = planState(withPlace, cur);
      const next = putBoards(withPlace, after.plan, level, [board]);
      const placed = next.boards.find((x) => x.id === board);
      change(next, `${board} placed${placed?.location ? ` in ${placed.location}` : ''} · ⌘Z to undo`);
    }
  }

  keyRef.current = (e: KeyboardEvent) => {
    const sel = fp.panel === 'elv' && fp.elv.selected && (project.elvDevices ?? []).some((d) => d.id === fp.elv.selected) ? fp.elv.selected : null;
    const typing = e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (sel && !typing && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault(); e.stopPropagation();
      const r = remove(project, sel); fp.setElv((x) => ({ ...x, selected: null })); change(r.next, r.message); return;
    }
    if (sel && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const d = project.elvDevices!.find((x) => x.id === sel)!;
      if (d.type === 'camera' || d.type === 'ceiling-speaker' || d.type === 'horn-speaker') {
        e.preventDefault(); e.stopPropagation();
        const r = rotate(project, sel, (d.rotationDeg ?? 0) + (e.key === 'ArrowLeft' ? 15 : -15)); change(r.next, r.message); return;
      }
    }
    if (e.key === 'Escape' && points.length) { e.stopPropagation(); setPoints([]); }
    if (e.key === 'Enter' && points.length >= 3) {
      if (tool === 'trace') addPicked(points, Math.abs(polygonArea(points)));
      if (tool === 'area') setPoints((p) => [...p, p[0]]);
    }
  };

  const closedArea = points.length > 3 && points[points.length - 1] === points[0];
  const live = cursor && !closedArea && points.length && (tool === 'trace' || tool === 'area' || (tool === 'dist' && points.length === 1)) ? [...points, cursor] : points;
  const lengthM = tool === 'dist' && live.length === 2 ? Math.hypot(live[1][0] - live[0][0], live[1][1] - live[0][1]) * mpu : undefined;
  const areaM2 = (tool === 'area' || tool === 'trace') && live.length >= 3 ? Math.abs(polygonArea(closedArea ? points.slice(0, -1) : live)) * mpu * mpu : undefined;
  const overlay: PlanOverlay | undefined = live.length ? { points: live, closed: closedArea, label: lengthM !== undefined ? `${lengthM.toFixed(2)} m` : areaM2 !== undefined ? `${areaM2.toFixed(2)} m²` : undefined } : undefined;

  const panel = fp.panel;
  const shapes: PlanRoomShape[] = panel === 'rooms' ? [
    ...found.map((f, i) => ({ key: `f${i}`, points: f.points, picked: !!f.model, selected: !!f.model && f.model.id === fp.selectedRoom })),
    ...Object.entries(fp.outlines).map(([id, pts]) => ({ key: id, points: pts, picked: true, selected: id === fp.selectedRoom }))
  ] : [];
  const routePaths = linkPaths;
  const target = panel === 'cables' ? fp.targets.feeder : fp.targets.tray;
  const paths: PlanPath[] = panel === 'cables' || panel === 'trays'
    ? routePaths.filter((p) => (panel === 'cables' ? p.kind === 'route' : true)).map((p) => ({ points: p.points, tone: p.to === target ? 'on' : p.kind }))
    : [];
  const marks: PlanMark[] = panel === 'boards'
    ? [...s.plan.places.map((p) => ({ at: [p.x, p.y] as Pt, label: p.boardId, on: p.boardId === fp.targets.board })), ...s.plan.symbols.filter((x) => !s.plan.places.some((p) => p.boardId === x.name)).map((x) => ({ at: [x.x, x.y] as Pt, label: x.name }))]
    : [];
  // ELV layer: devices, the chosen system's coverage, the Fill room preview; a dragged device drawn where it is held.
  const elvShown = panel === 'elv' && !!level;
  const elv = elvShown ? elvLayer(project, level!, mpu, {
    system: fp.elv.system, coverage: fp.elv.coverage, selected: fp.elv.selected, ...(held ? { held } : {}),
    ...(tool === 'elv-fill' && cursor ? { preview: { type: fp.elv.device, at: [cursor[0] * mpu, cursor[1] * mpu] as Pt } } : {})
  }) : undefined;
  const elvDrag: PlanDrag | undefined = elvShown && tool === 'elv-select' ? {
    start: (at, pixel) => {
      const d = deviceNear(project, level!, fp.elv.system, [at[0] * mpu, at[1] * mpu], 10 * pixel * mpu);
      if (!d) return false;
      fp.setElv((e) => ({ ...e, selected: d.id })); setHeld({ id: d.id, at: [d.x, d.y] }); return true;
    },
    move: (at) => setHeld((h) => (h ? { ...h, at: [at[0] * mpu, at[1] * mpu] } : h)),
    end: (at) => {
      const h = held; setHeld(null);
      if (!h) return;
      const d = project.elvDevices?.find((x) => x.id === h.id);
      const m: Pt = [at[0] * mpu, at[1] * mpu];
      if (d && Math.hypot(d.x - m[0], d.y - m[1]) > 0.05) { const r = moveTo(project, h.id, m); change(r.next, r.message); }
    }
  } : undefined;
  const linkedM = target ? routePaths.filter((p) => p.to === target && p.kind === (panel === 'cables' ? 'route' : 'tray')).reduce((t, p) => t + p.length, 0) * mpu : 0;
  const readout = lengthM !== undefined ? `Length ${lengthM.toFixed(2)} m` : areaM2 !== undefined ? `Area ${areaM2.toFixed(2)} m²`
    : panel === 'rooms' ? `${plural(found.length, 'room')} on the plan · ${notAdded.length} not added`
      : panel === 'elv' ? `${deviceLabel(fp.elv.device)}${coverageNote(fp.elv.device)}` : linkedM ? `${target}: ${linkedM.toFixed(2)} m linked on the plan` : '';

  return (
    <section className="fpp">
      <div className="fpp-stage">
        <FloorPlanCanvas drawing={open.drawing} rooms={shapes} overlay={overlay} paths={paths} marks={marks} symbols={elv?.symbols} covers={elv?.covers} gaps={elv?.gaps} drag={elvDrag}
          fitKey={fp.fitKey} zoomKey={fp.zoomKey} onClick={click} onMove={FOLLOWS_POINTER.has(tool) ? setCursor : undefined} />
        {readout && <div className="fp-readout">{readout}</div>}
        <div className="fp-hint">{note || HINTS[tool]}</div>
      </div>
      <aside className="fp-side">
        <div className="fpp-file m">{open.file} · {open.drawing.format} · {s.rooms.units}
          {floors.length > 0 && (
            <select aria-label="Level of this plan" value={floor?.key} onChange={(e) => fp.setLevelKey(e.target.value)}>
              {floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}
            </select>
          )}
        </div>
        <div className="fp-tasks" role="tablist" aria-label="What is in the model">
          {PANELS.map((p) => <button key={p.id} role="tab" aria-selected={panel === p.id && !fp.showLayers} onClick={() => { fp.setPanel(p.id); fp.setShowLayers(false); }}>{p.label}</button>)}
        </div>
        {fp.showLayers ? (
          <div className="fp-layers">
            <h4>Layers</h4>
            <CadLayerTable layers={s.base.layers ?? []} roles={roles}
              onChange={(layer: string, role: CadLayerRole) => change(withLayerMap(project, roles.map((x) => (x.layer === layer ? { ...x, role } : x))), `Layer ${layer}: ${role}`)}
              onApplyMap={(m: CadLayerMap[]) => change(withLayerMap(project, m), 'Layer template applied')} />
          </div>
        ) : panel === 'rooms' ? (
          <RoomsPanel project={project} rooms={levelRooms} roomTypes={roomTypes} file={open.file} selected={fp.selectedRoom} onSelect={fp.setSelectedRoom} notAdded={notAdded.length} levelName={floor ? floorLabel(project.building, floor) : undefined} onAddFound={addFound} onChange={change} />
        ) : panel === 'cables' ? (
          <CablesPanel project={project} s={s} target={fp.targets.feeder} onTarget={(v) => fp.setTargets((t) => ({ ...t, feeder: v }))} onChange={change} />
        ) : panel === 'trays' ? (
          <TraysPanel project={project} s={s} target={fp.targets.tray} onTarget={(v) => fp.setTargets((t) => ({ ...t, tray: v }))} onChange={change} />
        ) : panel === 'elv' ? (
          <ElvPlanPanel project={project} level={level} levelName={floor ? floorLabel(project.building, floor) : undefined} system={fp.elv.system} device={fp.elv.device}
            selected={fp.elv.selected} coverage={elv?.coverage ?? []} onDevice={(t) => fp.setElv((e) => ({ ...e, device: t }))} onSelect={(id) => fp.setElv((e) => ({ ...e, selected: id }))} onChange={change} />
        ) : (
          <BoardsPanel project={project} s={s} level={level} target={fp.targets.board} onTarget={(v) => fp.setTargets((t) => ({ ...t, board: v }))} onChange={change} onStatus={onStatus} />
        )}
      </aside>
    </section>
  );
}

type S = NonNullable<ReturnType<typeof planState>>;

function RoomsPanel({ project, rooms, roomTypes, file, selected, onSelect, notAdded, levelName, onAddFound, onChange }: {
  project: Project; rooms: import('../types').BuildingRoom[]; roomTypes: import('../types').RoomType[]; file: string; selected: string | null; onSelect: (id: string) => void;
  notAdded: number; levelName?: string; onAddFound: () => void; onChange: (next: Project, message: string) => void;
}) {
  const info = buildingInfoOf(project);
  const setRoom = (id: string, patch: Partial<import('../types').BuildingRoom>, message: string) =>
    onChange({ ...project, building: { ...info, rooms: info.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }, message);
  const total = rooms.reduce((t, r) => t + r.areaM2 * (r.count ?? 1), 0);
  if (!levelName) return <p className="m fp-pad">Add the building and its levels in Building information first; rooms are kept per level.</p>;
  return (
    <>
      <h4>Rooms on {levelName} <small className="m">· in the model</small></h4>
      <div className="fp-list">
        <table className="bi-table compact">
          <thead><tr><th>Room</th><th>Area m²</th><th>Type</th><th /></tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className={r.id === selected ? 'sel' : undefined} onClick={() => onSelect(r.id)}>
                <td>{r.id === selected
                  ? <input aria-label="Room name" defaultValue={r.name} onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== r.name) setRoom(r.id, { name: n }, `Room renamed ${n}`); }} />
                  : r.name}</td>
                <td className="num">{r.areaM2.toFixed(2)}</td>
                <td>
                  <select aria-label={`Room type of ${r.name}`} value={r.type} onClick={(e) => e.stopPropagation()} onChange={(e) => setRoom(r.id, { type: e.target.value }, `${r.name}: ${roomTypes.find((t) => t.id === e.target.value)?.label ?? e.target.value}`)}>
                    {roomTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </td>
                <td className="m">{r.source?.app === 'cad' && r.source.file?.toLowerCase() === file.toLowerCase() ? (r.source.sourceId ? 'plan' : 'picked') : r.source?.app === 'cad' ? 'other plan' : 'typed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {notAdded > 0 && <p className="m fp-pad">{plural(notAdded, 'room')} on the plan not added yet. <button className="chip" onClick={onAddFound}>Add found rooms</button></p>}
      </div>
      <div className="modal-actions fp-foot"><span className="m">Total {total.toFixed(2)} m² · the Load assessment follows Building information</span></div>
    </>
  );
}

function CablesPanel({ project, s, target, onTarget, onChange }: { project: Project; s: S; target: string; onTarget: (v: string) => void; onChange: (next: Project, message: string) => void }) {
  const settings: CadLengthSettings = project.cadLength ?? {};
  const d = { ...CAD_LENGTH_DEFAULTS, ...settings };
  const routes = planRoutes(project, s.plan, s.roles);
  const pull = pullCadLengths(project, routes, s.plan.units);
  const feeders = [...project.feeders].filter((f) => !f.generation).sort((a, b) => feederLabel(a).localeCompare(feederLabel(b)));
  const setting = (k: 'verticalM' | 'terminationM' | 'wastePct', v: string) => {
    const next = { ...settings, [k]: num(v) };
    onChange({ ...project, cadLength: Object.values(next).some((x) => x !== undefined) ? next : undefined }, 'Cable length allowances changed — press Apply plan lengths to use them');
  };
  return (
    <>
      <div className="fp-form">
        <label>Link clicks to feeder
          <select value={target} onChange={(e) => onTarget(e.target.value)}>
            <option value="">Choose a feeder…</option>
            {feeders.map((f) => <option key={f.id} value={f.id}>{feederLabel(f)}</option>)}
          </select>
        </label>
        <label>Vertical (m)<input inputMode="decimal" defaultValue={settings.verticalM ?? ''} placeholder={String(d.verticalM)} onBlur={(e) => setting('verticalM', e.target.value)} /></label>
        <label>Terminations (m)<input inputMode="decimal" defaultValue={settings.terminationM ?? ''} placeholder={String(d.terminationM)} onBlur={(e) => setting('terminationM', e.target.value)} /></label>
        <label>Waste (%)<input inputMode="decimal" defaultValue={settings.wastePct ?? ''} placeholder={String(d.wastePct)} onBlur={(e) => setting('wastePct', e.target.value)} /></label>
      </div>
      <div className="fp-list">
        <p className="m fp-pad">{plural(routes.length, 'route')} on the plan · {pull.matching} lengths already match · {pull.units}</p>
        {pull.proposals.length > 0 && (
          <table className="bi-table compact">
            <thead><tr><th>Feeder</th><th>Model (m)</th><th>Plan (m)</th></tr></thead>
            <tbody>
              {pull.proposals.map((x) => (
                <tr key={x.feederId} className={x.feederId === target ? 'sel' : undefined} onClick={() => onTarget(x.feederId)}>
                  <td>{x.label}</td><td className="num">{x.currentM ?? '—'}</td><td className="num" title={lengthBreakdown(x)}>{x.proposedM}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="modal-actions fp-foot">
        <span className="m">Run the calculations after, to check voltage drop</span><span className="sp" />
        <button className="chip" disabled={!pull.proposals.length} onClick={() => onChange(putLengths(withPlan(project, s.roles, s.links), s.plan, s.roles), `${plural(pull.proposals.length, 'feeder length')} from the plan · ⌘Z to undo`)}>Apply plan lengths</button>
      </div>
    </>
  );
}

function TraysPanel({ project, s, target, onTarget, onChange }: { project: Project; s: S; target: string; onTarget: (v: string) => void; onChange: (next: Project, message: string) => void }) {
  const pull = pullCadTrays(project, trayPlan(project, s.linked, s.plan, s.roles));
  const known = trayPlanOf(project).routes;
  const count = pull.feeders.length + pull.lengths.length;
  return (
    <>
      <div className="fp-form">
        <label>Link clicks to tray route
          <input list="fpp-trays" placeholder="e.g. A" value={target} onChange={(e) => onTarget(e.target.value.toUpperCase().replace(/\s+/g, ''))} />
          <datalist id="fpp-trays">{known.map((r) => <option key={r.name} value={r.name} />)}</datalist>
        </label>
      </div>
      <div className="fp-list">
        <table className="bi-table compact">
          <thead><tr><th>Tray route</th><th>Model (m)</th><th>Plan (m)</th></tr></thead>
          <tbody>
            {known.map((r) => {
              const plan = pull.lengths.find((l) => l.name === r.name);
              return <tr key={r.name} className={r.name === target ? 'sel' : undefined} onClick={() => onTarget(r.name)}><td>{r.name}</td><td className="num">{r.lengthM ?? '—'}</td><td className="num">{plan ? plan.proposedM : 'matches'}</td></tr>;
            })}
            {pull.lengths.filter((l) => l.isNew).map((l) => <tr key={l.name} onClick={() => onTarget(l.name)}><td>{l.name} <span className="m">(new)</span></td><td className="num">—</td><td className="num">{l.proposedM}</td></tr>)}
          </tbody>
        </table>
        {pull.feeders.length > 0 && <p className="m fp-pad">Feeders whose trays differ: {pull.feeders.map((f) => `${f.label} → ${f.proposed || 'none'}`).join('; ')}</p>}
      </div>
      <div className="modal-actions fp-foot">
        <span className="sp" />
        <button className="chip" disabled={!count} onClick={() => onChange(putTrays(withPlan(project, s.roles, s.links), s.linked, s.plan, s.roles), `${plural(count, 'tray change')} from the plan · ⌘Z to undo`)}>Apply plan trays</button>
      </div>
    </>
  );
}

function BoardsPanel({ project, s, level, target, onTarget, onChange }: { project: Project; s: S; level?: import('../model/levels').LevelRef; target: string; onTarget: (v: string) => void; onChange: (next: Project, message: string) => void; onStatus: (m: string) => void }) {
  const working = withLayerMap(project, s.roles);
  const pull = pullBoardPlaces(working, s.plan, level);
  return (
    <>
      <div className="fp-form">
        <label>Place clicks as board
          <select value={target} onChange={(e) => onTarget(e.target.value)}>
            <option value="">Choose a board…</option>
            {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}{s.links.places?.[b.id] ? ' (placed)' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="fp-list">
        <table className="bi-table compact">
          <thead><tr><th>Board</th><th>Location in the model</th><th>Plan</th></tr></thead>
          <tbody>
            {project.boards.map((b) => {
              const p = pull.proposals.find((x) => x.boardId === b.id);
              const onPlan = s.plan.places.some((x) => x.boardId === b.id) || s.plan.symbols.some((x) => x.name === b.id);
              return <tr key={b.id} className={b.id === target ? 'sel' : undefined} onClick={() => onTarget(b.id)}><td>{b.id}</td><td>{b.location || '—'}</td><td className="m">{p ? `→ ${p.room ?? 'not in a room'}` : onPlan ? 'matches' : '—'}</td></tr>;
            })}
          </tbody>
        </table>
        {pull.unknown.length > 0 && <p className="m fp-pad">Symbols naming boards not in the design: {pull.unknown.join(', ')}</p>}
      </div>
      <div className="modal-actions fp-foot">
        <span className="sp" />
        <button className="chip" disabled={!pull.proposals.length} onClick={() => onChange(putBoards(withPlan(project, s.roles, s.links), s.plan, level), `${plural(pull.proposals.length, 'board')} placed from the plan · ⌘Z to undo`)}>Apply plan boards</button>
      </div>
    </>
  );
}
