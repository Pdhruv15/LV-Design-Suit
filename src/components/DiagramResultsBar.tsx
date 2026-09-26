import { LAYER_LABELS, type ResultLayers } from '../diagram/annotations';
import { EXTERNAL_ENGINES } from '../engines';

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
  note
}: {
  layers: ResultLayers;
  onLayers: (l: ResultLayers) => void;
  source: ResultSource;
  onSource: (s: ResultSource) => void;
  onRun: () => void;
  running: boolean;
  note?: { text: string; cls?: string };
}) {
  return (
    <div className="results-bar" role="group" aria-label="Diagram results">
      <span className="m">Show:</span>
      {LAYER_LABELS.map(([k, label]) => (
        <button key={k} className={`toggle ${layers[k] ? 'on' : ''}`} aria-pressed={layers[k]} onClick={() => onLayers({ ...layers, [k]: !layers[k] })}>
          {label}
        </button>
      ))}
      <span className="sp" />
      <label className="m">
        Results from{' '}
        <select value={source} onChange={(e) => onSource(e.target.value)}>
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
