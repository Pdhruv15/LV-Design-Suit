import { useEffect, useRef, useState } from 'react';
import CadCanvas, { type CadToggles } from './CadCanvas';
import { rememberedDrawing, type CadState } from './cadState';
import { chooseDrawing, reopenDrawing, sampleDrawing, type CadView } from '../../engines/cad/cadEngine';
import { SAMPLE_PLANS } from '../floorPlanState';

type Pt = [number, number];

const UNITS: Record<number, string> = { 0: 'unitless', 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
const hex = (rgb: number) => (rgb === 0xff000007 ? 'var(--cad-ink)' : `#${rgb.toString(16).padStart(6, '0')}`);
const TOGGLES: { k: keyof CadToggles; label: string; key: string }[] = [
  { k: 'snap', label: 'SNAP', key: 'F9' }, { k: 'osnap', label: 'OSNAP', key: 'F3' }, { k: 'ortho', label: 'ORTHO', key: 'F8' }, { k: 'grid', label: 'GRID', key: 'F7' }
];
const HELP = 'Commands: OPEN · FIT (ZE) · LAYER · OSNAP (F3) · GRID (F7) · ORTHO (F8) · SNAP (F9) · Esc cancels. Pan: middle button or Space + drag; zoom: wheel.';

/** The CAD view: a DWG / DXF drawing opened natively, as a CAD program shows it — model space, crosshair, snaps, layers,
 * a command line and a status bar. Engine in Rust (WebAssembly), desktop and web alike. Step 1: open and view. */
export default function CadPage({ cad, projectId, onStatus }: { cad: CadState; projectId?: string; onStatus: (m: string) => void }) {
  const { view } = cad;
  const [cursor, setCursor] = useState<{ at: Pt | null; snap?: string }>({ at: null });
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const last = rememberedDrawing(projectId);

  async function load(read: () => Promise<CadView | null>, missing?: string) {
    setBusy(true);
    try {
      const v = await read();
      if (v) { cad.open(v); onStatus(`${v.file} opened`); } else if (missing) cad.say(missing);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      cad.say(m); onStatus(m);
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

  function run(text: string) {
    const c = text.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!c) return;
    cad.say(`Command: ${c}`);
    if (c === 'OPEN') openFile();
    else if (['FIT', 'ZE', 'Z E', 'ZOOM E', 'ZOOM EXTENTS'].includes(c)) cad.fit();
    else if (c === 'LA' || c === 'LAYER' || c === 'LAYERS') cad.setShowLayers(!cad.showLayers);
    else if (c === 'OS' || c === 'OSNAP') cad.toggle('osnap');
    else if (c === 'GRID') cad.toggle('grid');
    else if (c === 'ORTHO') cad.toggle('ortho');
    else if (c === 'SNAP') cad.toggle('snap');
    else if (c === 'HELP' || c === '?') cad.say(HELP);
    else cad.say(`Unknown command "${c}". ${HELP}`);
  }

  // CAD keys while this page shows: function keys toggle, typing goes to the command line, Esc cancels it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      const fn: Record<string, keyof CadToggles> = { F3: 'osnap', F7: 'grid', F8: 'ortho', F9: 'snap' };
      if (fn[e.key]) { e.preventDefault(); cad.toggle(fn[e.key]); return; }
      if (e.key === 'Escape' && e.target === input.current) { setCmd(''); input.current?.blur(); return; }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[a-zA-Z?]$/.test(e.key)) { input.current?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [cad]);

  const units = view ? UNITS[view.info.units] ?? `units ${view.info.units}` : '';
  return (
    <section className="cad">
      <div className="cad-work">
        {view ? (
          <div className="cad-stage">
            <CadCanvas view={view} layersOn={cad.layersOn} toggles={cad.toggles} fitKey={cad.fitKey} onCursor={(at, snap) => setCursor({ at, snap })} />
            <div className="cad-coords">{cursor.at ? `X ${cursor.at[0].toFixed(2)}   Y ${cursor.at[1].toFixed(2)}   ${units}` : `${units}`}</div>
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
              {view ? <>{view.file}<br /><span className="m">{view.info.format} · {units} · {view.info.segments.toLocaleString()} lines · {view.info.texts.length} texts</span></> : <span className="m">No drawing open.</span>}
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
        <span className="m cad-hist">{cad.history[cad.history.length - 1] ?? 'Command: type OPEN, FIT, LAYER… or use the CAD ribbon'}</span>
        <span>›</span>
        <input ref={input} aria-label="Command" value={cmd} placeholder="Type a command" onChange={(e) => setCmd(e.target.value)} />
      </form>
      <div className="cad-status">
        {TOGGLES.map((x) => (
          <button key={x.k} className={`cad-tg${cad.toggles[x.k] ? ' on' : ''}`} aria-pressed={cad.toggles[x.k]} title={`${x.label} (${x.key})`} onClick={() => cad.toggle(x.k)}>{x.label}</button>
        ))}
        <span className="sp" />
        <span>{cursor.snap ?? ''}</span>
        <span>{view ? `${view.file} · ${view.info.format} · ${units} · 1 : 1` : ''}</span>
      </div>
    </section>
  );
}
