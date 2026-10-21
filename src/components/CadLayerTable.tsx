import { LAYER_ROLES } from '../model/cadRooms';
import type { CadLayerStats } from '../model/cadPlaces';
import type { CadLayerMap, CadLayerRole } from '../types';

const holds = (l: CadLayerStats) => [
  l.outlines && `${l.outlines} outline${l.outlines === 1 ? '' : 's'}`, l.hatches && `${l.hatches} hatch${l.hatches === 1 ? '' : 'es'}`,
  l.curves && `${l.curves} line${l.curves === 1 ? '' : 's'}`, l.texts && `${l.texts} text${l.texts === 1 ? '' : 's'}`, l.blocks && `${l.blocks} block${l.blocks === 1 ? '' : 's'}`
].filter(Boolean).join(' · ');

/** The layers of a floor plan, what each holds, and what each is (room outline, room name, tray…). */
export default function CadLayerTable({ layers, roles, onChange }: { layers: CadLayerStats[]; roles: CadLayerMap[]; onChange: (layer: string, role: CadLayerRole) => void }) {
  return (
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
  );
}
