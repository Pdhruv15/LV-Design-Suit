import { LAYER_LABELS, type ResultLayers } from '../diagram/annotations';
import { EXTERNAL_ENGINES } from '../engines';
import { COLOR_BY, type ColorBy } from '../diagram/heatmap';
import type { SupplyMode } from '../calc/scenario';

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
  hasGenerator
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
}) {
  return (
    <div className="results-bar" role="group" aria-label="Diagram results">
      <span className="m">Show:</span>
      {LAYER_LABELS.map(([k, label]) => (
        <button key={k} className={`toggle ${layers[k] ? 'on' : ''}`} aria-pressed={layers[k]} onClick={() => onLayers({ ...layers, [k]: !layers[k] })}>
          {label}
        </button>
      ))}
      <label className="m">
        Colour by{' '}
        <select value={colorBy} onChange={(e) => onColorBy(e.target.value as ColorBy)}>
          {COLOR_BY.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <div className="seg supply-seg" role="radiogroup" aria-label="Supply">
        <button role="radio" aria-checked={supply === 'normal'} className={supply === 'normal' ? 'on' : ''} onClick={() => onSupply('normal')}>Normal supply</button>
        <button role="radio" aria-checked={supply === 'generator'} className={supply === 'generator' ? 'on' : ''} disabled={!hasGenerator}
          title={hasGenerator ? 'Mains lost: the network on the standby generators' : 'Add a generator first: drop “Generator + ATS” on a board'}
          onClick={() => onSupply('generator')}>On generator</button>
      </div>
      <span className="sp" />
      <label className="m">
        Results from{' '}
        <select value={supply === 'generator' ? 'builtin' : source} disabled={supply === 'generator'} onChange={(e) => onSource(e.target.value)}>
          <option value="builtin">Built-in (instant)</option>
          {EXTERNAL_ENGINES.map((e) => (
            <option key={e.id} value={e.id}>{e.name} load flow</option>
          ))}
        </select>
      </label>
      {source !== 'builtin' && (
        <button className="chip primary" disabled={running} onClick={onRun}>
          {running ? 'Running…' : 'Run simulation'}
        </button>
      )}
      {note && <span className={`results-note ${note.cls ?? 'm'}`}>{note.text}</span>}
    </div>
  );
}
