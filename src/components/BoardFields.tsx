import { BOARD_KINDS, SPD_TYPES, type Board } from '../types';
import { DEFAULT_TRANSFORMER_XR } from '../calc/electrical';

/** Editable board fields, shared by the properties panel (applied as you
 * type) and the double-click edit dialog (applied on Save).
 * 'general': equipment data; 'source': transformer data (main boards). */
export default function BoardFields({ board, onChange, section }: { board: Board; onChange: (b: Board) => void; section: 'general' | 'source' }) {
  const isMain = !board.upstreamId;
  function set<K extends keyof Board>(key: K, value: Board[K]) {
    onChange({ ...board, [key]: value });
  }
  const text = (key: 'name' | 'ipRating' | 'location' | 'manufacturer' | 'model', placeholder = '') => (
    <input value={board[key] ?? ''} placeholder={placeholder} onChange={(e) => set(key, e.target.value || (key === 'name' ? '' : undefined))} />
  );
  const num = (key: 'ratedCurrentA' | 'sourceKva' | 'sourceImpedancePct' | 'sourceXr', step = 1, placeholder = '') => (
    <input
      type="number"
      step={step}
      min="0"
      placeholder={placeholder}
      value={board[key] ?? ''}
      onChange={(e) => set(key, e.target.value === '' ? undefined : +e.target.value)}
    />
  );

  if (section === 'source') {
    return (
      <div className="form-kv">
        <label>Transformer (kVA){num('sourceKva', 50)}</label>
        <label>Impedance Z (%){num('sourceImpedancePct', 0.1)}</label>
        <label>X/R ratio{num('sourceXr', 0.5, String(DEFAULT_TRANSFORMER_XR))}</label>
      </div>
    );
  }
  return (
    <div className="form-kv">
      <label>Name{text('name')}</label>
      <label>
        Type
        <select value={board.kind ?? (isMain ? 'MDB' : 'DB')} onChange={(e) => set('kind', e.target.value as Board['kind'])}>
          {BOARD_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </label>
      <label>Rated current (A){num('ratedCurrentA', 1, 'e.g. 400')}</label>
      {board.kind === 'UPS' && (
        <label>UPS rating (kVA)
          <input inputMode="decimal" value={board.upsKva ?? ''} placeholder="e.g. 20"
            onChange={(e) => set('upsKva', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : +e.target.value)} />
        </label>
      )}
      <label>Standby generator (kVA, via ATS)
        <input inputMode="decimal" value={board.standby?.kva ?? ''} placeholder="none"
          title="Leave blank for no generator. Everything on and below this board then counts as essential load."
          onChange={(e) => set('standby', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : { kva: +e.target.value })} />
      </label>
      <label>
        Busbar material
        <select value={board.busbarMaterial ?? ''} onChange={(e) => set('busbarMaterial', (e.target.value || undefined) as Board['busbarMaterial'])}>
          <option value="">—</option>
          <option value="copper">Copper</option>
          <option value="aluminium">Aluminium</option>
        </select>
      </label>
      <label>Surge protection (SPD)
        <select value={board.spd ?? ''} onChange={(e) => set('spd', (e.target.value || undefined) as Board['spd'])}>
          <option value="">None</option>
          {SPD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label>IP rating{text('ipRating', 'e.g. IP42')}</label>
      <label>Location{text('location')}</label>
      <label>Manufacturer{text('manufacturer')}</label>
      <label>Model{text('model')}</label>
    </div>
  );
}
