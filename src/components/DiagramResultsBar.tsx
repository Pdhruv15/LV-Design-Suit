import { LAYER_LABELS, type ResultLayers } from '../diagram/annotations';
import { EXTERNAL_ENGINES } from '../engines';
import { COLOR_BY, type ColorBy } from '../diagram/heatmap';
import type { SupplyMode } from '../calc/scenario';
import MenuButton from './MenuButton';
import { CircleCheck, CircleX, TriangleAlert, X } from 'lucide-react';

export type ResultSource = 'builtin' | string; // or an external engine id

/** Controls for the result labels on the diagram: which values to show,
 * and whether they come from the built-in engine or a full engine study. */
export default function DiagramResultsBar({
  layers,
  onLayers,
  source,
  onSource,
  onRun,
  running,
  note,
  colorBy,
  onColorBy,
  supply,
  onSupply,
  hasGenerator,
  outages = [],
  calc
}: {
  layers: ResultLayers;
  onLayers: (l: ResultLayers) => void;
  source: ResultSource;
  onSource: (s: ResultSource) => void;
  onRun: () => void;
  running: boolean;
  note?: { text: string; cls?: string };
  colorBy: ColorBy;
  onColorBy: (c: ColorBy) => void;
  supply: SupplyMode;
  onSupply: (m: SupplyMode) => void;
  hasGenerator: boolean;
  /** Main boards whose transformer can fail with a tie to another. */
  outages?: string[];
  /** State of the network studies: out of date (with what), failing checks, and when they last ran. */
  calc?: { stale: number; staleWhat?: string; fails: number; at?: number; onRun: () => void };
}) {
  const shown = LAYER_LABELS.filter(([k]) => layers[k]).length;
  const supplyLabel = supply === 'generator' ? 'On generator' : supply.startsWith('outage:') ? `Transformer of ${supply.slice(7)} failed` : '';
  const dot = note?.cls?.includes('bad') ? 'var(--bad)' : note?.cls?.includes('warn') || note?.cls?.includes('stale') ? 'var(--warn)' : 'var(--ok)';
  return (
    <>
      <MenuButton label={<>View <span className="m">({shown})</span></>} title="Values shown on the drawing, colouring and the operating scenario" active={colorBy !== 'none' || supply !== 'normal'}>
        {() => (
          <>
            <div className="mp-h">Show on the drawing</div>
            {LAYER_LABELS.map(([k, label]) => (
              <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => onLayers({ ...layers, [k]: !layers[k] })} /> {label}</label>
            ))}
            <hr />
            <div className="mp-h">Colour by</div>
            <label><select value={colorBy} onChange={(e) => onColorBy(e.target.value as ColorBy)}>{COLOR_BY.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
            <div className="mp-h">Supply</div>
            <label><select value={supply} onChange={(e) => onSupply(e.target.value as SupplyMode)} title="Operating scenario: normal, mains lost (standby generators), or one transformer out with the bus tie closed">
              <option value="normal">Normal supply</option>
              <option value="generator" disabled={!hasGenerator}>On generator (mains lost){hasGenerator ? '' : ' — add a generator'}</option>
              {outages.map((id) => <option key={id} value={`outage:${id}`}>Transformer of {id} failed</option>)}
            </select></label>
          </>
        )}
      </MenuButton>
      {supplyLabel && <button className="chip supply-pick active" onClick={() => onSupply('normal')} title="Back to normal supply" aria-label={`${supplyLabel} — back to normal supply`}>{supplyLabel} <X size={13} aria-hidden /></button>}
      {calc && (calc.stale ? (
        <button className="chip calc-chip warn" onClick={calc.onRun} title={`Out of date: ${calc.staleWhat ?? 'the studies'} — click to run (F5)`}><TriangleAlert size={13} aria-hidden /> Out of date · Run</button>
      ) : (
        <span className={`calc-chip ${calc.fails ? 'bad' : 'ok'}`} title={`Calculations up to date${calc.at ? ` — run at ${new Date(calc.at).toLocaleTimeString()}` : ''}${calc.fails ? ` · ${calc.fails} check(s) failing — see the results below` : ''}`}>
          {calc.fails ? <><CircleX size={13} aria-hidden /> {calc.fails} failing</> : <><CircleCheck size={13} aria-hidden /> Calculated</>}{calc.at ? <span className="m"> · {new Date(calc.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
        </span>
      ))}
      <label className="results-src" title={note?.text}>
        {source !== 'builtin' && <span className="res-dot" style={{ background: dot }} />}
        <select className="chip" value={supply === 'generator' ? 'builtin' : source} disabled={supply === 'generator'} onChange={(e) => onSource(e.target.value)} aria-label="Results from">
          <option value="builtin">Results: built-in</option>
          {EXTERNAL_ENGINES.map((e) => <option key={e.id} value={e.id}>Results: {e.name} load flow</option>)}
        </select>
      </label>
      {source !== 'builtin' && <button className="chip primary" disabled={running} onClick={onRun}>{running ? 'Running…' : 'Run simulation'}</button>}
      {note && source !== 'builtin' && <span className={`results-note ${note.cls ?? 'm'}`}>{note.text}</span>}
    </>
  );
}
