import { useState } from 'react';
import { applyTemplate, bestTemplate, loadLayerTemplates, saveLayerTemplates, withTemplate, type CadLayerTemplate } from '../model/cadLayerTemplates';
import { LAYER_ROLES } from '../model/cadRooms';
import type { CadLayerStats } from '../model/cadPlaces';
import type { CadLayerMap, CadLayerRole } from '../types';

const holds = (l: CadLayerStats) => [
  l.outlines && `${l.outlines} outline${l.outlines === 1 ? '' : 's'}`, l.hatches && `${l.hatches} hatch${l.hatches === 1 ? '' : 'es'}`,
  l.curves && `${l.curves} line${l.curves === 1 ? '' : 's'}`, l.texts && `${l.texts} text${l.texts === 1 ? '' : 's'}`, l.blocks && `${l.blocks} block${l.blocks === 1 ? '' : 's'}`
].filter(Boolean).join(' · ');

/** The layers of a floor plan, what each holds, and what each is (room outline, room name, tray…), with the layer
 * templates saved per architect or consultant (LV Database): apply one, or save this mapping as one. */
export default function CadLayerTable({ layers, roles, onChange, onApplyMap }: {
  layers: CadLayerStats[];
  roles: CadLayerMap[];
  onChange: (layer: string, role: CadLayerRole) => void;
  /** Sets every layer's role at once (a template applied); without it the template bar is hidden. */
  onApplyMap?: (roles: CadLayerMap[]) => void;
}) {
  const [templates, setTemplates] = useState<CadLayerTemplate[]>(loadLayerTemplates);
  const [chosen, setChosen] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const best = bestTemplate(layers.map((l) => l.name), templates);
  const use = (t: CadLayerTemplate) => { onApplyMap?.(applyTemplate(roles, t)); setNote(`Layers mapped as “${t.name}”.`); };
  function save() {
    const n = name.trim();
    if (!n) return;
    const replacing = templates.some((t) => t.name.toLowerCase() === n.toLowerCase());
    const list = withTemplate(templates, n, roles);
    if (!saveLayerTemplates(list)) { setNote('Could not save the template.'); return; }
    setTemplates(list); setName('');
    setNote(`${replacing ? 'Updated' : 'Saved'} layer template “${n}” in the LV Database — it is offered for this architect’s plans in every project.`);
  }

  return (
    <>
      {onApplyMap && (
        <div className="modal-actions">
          {best && best.template.name !== chosen && (
            <button className="chip" onClick={() => { setChosen(best.template.name); use(best.template); }} title="A saved layer template that knows most of this plan's layers">
              Use “{best.template.name}” ({best.matched} of {best.of} layers)
            </button>
          )}
          <select aria-label="Layer template" value={chosen} onChange={(e) => { setChosen(e.target.value); const t = templates.find((x) => x.name === e.target.value); if (t) use(t); }}>
            <option value="">{templates.length ? 'Layer template…' : 'No layer templates yet'}</option>
            {templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          <span className="sp" />
          <input aria-label="Template name" placeholder="Save as template, e.g. ABC Architects" style={{ width: '16em' }} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="chip" disabled={!name.trim() || !roles.length} onClick={save}>Save template</button>
        </div>
      )}
      {note && <p className="m">{note}</p>}
      <table className="bi-table compact">
        <thead><tr><th>Layer</th><th>Holds</th><th>Is</th></tr></thead>
        <tbody>
          {layers.map((l) => (
            <tr key={l.name}>
              <td>{l.name}</td>
              <td>{holds(l) || '—'}</td>
              <td>
                <select aria-label={`Layer ${l.name} is`} value={roles.find((m) => m.layer === l.name)?.role ?? 'ignore'} onChange={(e) => onChange(l.name, e.target.value as CadLayerRole)}>
                  {LAYER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
