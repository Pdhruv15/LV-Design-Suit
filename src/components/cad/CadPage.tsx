import { useEffect, useMemo, useRef, useState } from 'react';
import CadCanvas, { type CadMarks, type CadToggles } from './CadCanvas';
import { rememberedDrawing, type CadState, type CadTool } from './cadState';
import { chooseDrawing, reopenDrawing, sampleDrawing, type CadObject, type CadView } from '../../engines/cad/cadEngine';
import { angleDeg, areaOf, distance, drawingUnits, inside, m, m2, roomAround, segmentsOn, WALL_LAYER } from '../../model/cadMeasure';
import { pickedRoom, putRooms } from '../../model/floorPlanActions';
import { floorLabel, floorList } from '../../model/levels';
import { SAMPLE_PLANS } from '../floorPlanState';
import type { Project } from '../../types';

type Pt = [number, number];
type Result =
  | { kind: 'dist'; a: Pt; b: Pt }
  | { kind: 'area'; points: Pt[]; how: 'corners' | 'object' | 'room'; name?: string }
  | { kind: 'object'; o: CadObject };

const hex = (rgb: number) => (rgb === 0xff000007 ? 'var(--cad-ink)' : `#${rgb.toString(16).padStart(6, '0')}`);
const TOGGLES: { k: keyof CadToggles; label: string; key: string }[] = [
  { k: 'snap', label: 'SNAP', key: 'F9' }, { k: 'osnap', label: 'OSNAP', key: 'F3' }, { k: 'ortho', label: 'ORTHO', key: 'F8' }, { k: 'grid', label: 'GRID', key: 'F7' }
];
const HELP = 'Commands: OPEN · DI (distance) · AREA (O = object) · RA (room area) · LI (inspect) · FIT (ZE) · LAYER · OSNAP (F3) · GRID (F7) · ORTHO (F8) · SNAP (F9) · Esc cancels, Enter closes an area.';
const PROMPT: Record<CadTool, string> = {
  none: 'Click an object to see what it is.',
  dist: 'DI  Specify first point:',
  area: 'AREA  Specify first corner point or [Object]:',
  room: 'ROOM AREA  Click inside a room:'
};

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
  const units = view ? drawingUnits(view.info.units) : drawingUnits(4);
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
  useEffect(() => { setPoints([]); setObjectMode(false); cad.say(`Command: ${PROMPT[tool]}`); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Walls for Room area: layers named WALL / PARTITION / COLUMN that are shown, else every shown layer.
  const walls = useMemo(() => {
    if (!view) return [];
    const shown = view.info.layers.map((_, i) => i).filter((i) => cad.layersOn[i]);
    const named = shown.filter((i) => WALL_LAYER.test(view.info.layers[i].name));
    return segmentsOn(view.segs, view.segLayers, view.info.origin, new Set(named.length ? named : shown));
  }, [view, cad.layersOn]);

  /** The room name inside an outline: a text on a layer named like room names, else any text inside. */
  const nameInside = (poly: Pt[]) => {
    const texts = (view?.info.texts ?? []).filter((t) => cad.layersOn[t.layer] && inside([t.x, t.y], poly));
    const named = texts.find((t) => /ROOM|RM|NAME|SPACE/i.test(view!.info.layers[t.layer]?.name ?? ''));
    return (named ?? texts[0])?.s.trim();
  };

  function finishArea(pts: Pt[]) {
    if (pts.length < 3) { cad.say('An area needs at least 3 corners.'); return; }
    setResult({ kind: 'area', points: pts, how: 'corners', name: nameInside(pts) });
    const { area, perimeter } = areaOf(pts);
    cad.say(`Area = ${m2(toM2(area))}, Perimeter = ${m(toM(perimeter))}`);
    setPoints([]);
  }

  function click(at: Pt, pixel: number) {
    if (!view) return;
    if (tool === 'none') {
      const o = view.pick(at[0], at[1], 6 * pixel, cad.layersOn);
      setResult(o ? { kind: 'object', o } : null);
      if (o) cad.say(`LIST  ${o.kind}${o.block ? ` ${o.block}` : ''} on ${view.info.layers[o.layer]?.name ?? '?'}${o.length !== undefined && !o.closed ? `, length ${m(toM(o.length))}` : ''}${o.area !== undefined ? `, area ${m2(toM2(o.area))}` : ''}`);
    } else if (tool === 'dist') {
      if (points.length === 0) { setPoints([at]); setResult(null); cad.say('DI  Specify second point:'); return; }
      const a = points[0];
      setResult({ kind: 'dist', a, b: at });
      cad.say(`Distance = ${m(toM(distance(a, at)))}, Angle = ${angleDeg(a, at).toFixed(2)}°, ΔX = ${m(toM(at[0] - a[0]))}, ΔY = ${m(toM(at[1] - a[1]))}`);
      setPoints([]);
    } else if (tool === 'area') {
      if (objectMode) {
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
      cad.say('AREA  Specify next corner point or press Enter to close:');
    } else if (tool === 'room') {
      const r = roomAround(walls, at, units.factor);
      if (!r) { cad.say('ROOM AREA  No closed room around that point (open to the outside, or over 50 m across). Use AREA and click its corners.'); return; }
      setResult({ kind: 'area', points: r.points, how: 'room', name: nameInside(r.points) });
      cad.say(`Room area = ${m2(toM2(r.area))}`);
    }
  }

  function run(text: string) {
    const c = text.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!c) { if (tool === 'area' && points.length >= 3) finishArea(points); return; }
    cad.say(`Command: ${c}`);
    if (c === 'OPEN') openFile();
    else if (['FIT', 'ZE', 'Z E', 'ZOOM E', 'ZOOM EXTENTS'].includes(c)) cad.fit();
    else if (c === 'DI' || c === 'DIST' || c === 'DISTANCE') cad.setTool('dist');
    else if (c === 'AREA' || c === 'AA') cad.setTool('area');
    else if (c === 'O' && tool === 'area') { setObjectMode(true); setPoints([]); cad.say('AREA  Select a closed object:'); }
    else if (c === 'RA' || c === 'ROOM' || c === 'ROOMAREA') cad.setTool('room');
    else if (c === 'LI' || c === 'LIST') cad.setTool('none');
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
      if (points.length || objectMode) { setPoints([]); setObjectMode(false); cad.say('*Cancel*'); } else if (tool !== 'none') cad.setTool('none'); else setResult(null);
      return;
    }
    if (e.key === 'Enter' && !typing && tool === 'area' && points.length >= 3) { finishArea(points); return; }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[a-zA-Z?]$/.test(e.key)) input.current?.focus();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const marks: CadMarks | null = result?.kind === 'dist' ? { points: [result.a, result.b], label: m(toM(distance(result.a, result.b))) }
    : result?.kind === 'area' && result.how !== 'object' ? { points: result.points, closed: true, label: m2(toM2(areaOf(result.points).area)) }
    : points.length ? (() => {
      const live = cursor.at ? [...points, cursor.at] : points;
      const label = tool === 'dist' && live.length === 2 ? m(toM(distance(live[0], live[1]))) : tool === 'area' && live.length >= 3 ? m2(toM2(areaOf(live).area)) : undefined;
      return { points, live: true, area: tool === 'area', label };
    })()
    : tool === 'dist' || tool === 'area' ? { points: [], live: false } : null;
  const highlight: [number, number] | null = result?.kind === 'object' ? [result.o.seg_start, result.o.seg_end] : null;
  const objectArea = result?.kind === 'area' && result.how === 'object';

  return (
    <section className="cad">
      <div className="cad-work">
        {view ? (
          <div className="cad-stage">
            <CadCanvas view={view} layersOn={cad.layersOn} toggles={cad.toggles} fitKey={cad.fitKey} onCursor={(at, snap) => setCursor({ at, snap })} onClick={click} marks={objectArea ? { points: result.points, closed: true } : marks} highlight={highlight} />
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
              {result ? <ResultView r={result} view={view!} toM={toM} toM2={toM2} project={project} onChange={onChange} /> : view ? (
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
            <h4>Layers {view && <span className="cad-lyr-all"><button onClick={() => cad.allLayers(true)}>All on</button></span>}</h4>
            <div className="cad-layers">
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
function ResultView({ r, view, toM, toM2, project, onChange }: {
  r: Result; view: CadView; toM: (v: number) => number; toM2: (v: number) => number; project: Project; onChange: (next: Project, message: string) => void;
}) {
  if (r.kind === 'dist') {
    const d = distance(r.a, r.b);
    return <><div>Distance <b className="cad-big">{m(toM(d))}</b></div><div className="m">ΔX {m(toM(r.b[0] - r.a[0]))} · ΔY {m(toM(r.b[1] - r.a[1]))} · angle {angleDeg(r.a, r.b).toFixed(2)}°</div></>;
  }
  if (r.kind === 'area') {
    const { area, perimeter } = areaOf(r.points);
    return (
      <>
        <div>{r.how === 'room' ? 'Room area' : 'Area'} <b className="cad-big">{m2(toM2(area))}</b></div>
        <div className="m">Perimeter {m(toM(perimeter))}{r.how === 'object' ? ' · of the object picked' : ''}</div>
        <AddRoom key={`${area}`} project={project} areaM2={toM2(area)} name={r.name ?? ''} file={view.file} onChange={onChange} />
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

/** Sends a measured area to Building information as a room on a level. */
function AddRoom({ project, areaM2, name: initial, file, onChange }: { project: Project; areaM2: number; name: string; file: string; onChange: (next: Project, message: string) => void }) {
  const floors = floorList(project.building).filter((f) => !f.ref.index);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial);
  const [levelKey, setLevelKey] = useState(floors[0]?.key ?? '');
  const floor = floors.find((f) => f.key === levelKey);
  if (!open) return <button className="chip cad-addroom" onClick={() => setOpen(true)}>Add as room…</button>;
  if (!floors.length) return <p className="m">Add the building and its levels in Building information first; rooms are kept per level.</p>;
  return (
    <div className="cad-roomform">
      <label>Name<input value={name} placeholder="e.g. Majlis" onChange={(e) => setName(e.target.value)} /></label>
      <label>Level<select value={levelKey} onChange={(e) => setLevelKey(e.target.value)}>{floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}</select></label>
      <button className="chip primary" disabled={!floor} onClick={() => {
        const room = pickedRoom(project, name.trim(), areaM2, file, floor!.ref);
        const { project: next } = putRooms(project, [room], floor!.ref, []);
        onChange(next, `${room.name} · ${m2(room.areaM2)} added to ${floorLabel(project.building, floor!)} · ⌘Z to undo`);
        setOpen(false);
      }}>Add</button>
    </div>
  );
}
