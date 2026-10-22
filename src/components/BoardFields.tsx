import { BOARD_KINDS, INCOMER_DEVICES, RELAY_TYPES, SPD_TYPES, type Board, type IncomerDevice, type BuildingInfo, type EarthingPlan } from '../types';
import { findFloor, floorList, levelKey } from '../model/levels';
import { DEFAULT_TRANSFORMER_XR } from '../calc/electrical';

/** Groups of the 'general' fields, so the edit dialog can show them as tabs. */
export type BoardFieldGroup = 'board' | 'incomer' | 'sld' | 'location';
export const BOARD_FIELD_GROUPS: [BoardFieldGroup, string][] = [['board', 'General'], ['incomer', 'Incomer & protection'], ['sld', 'On the SLD'], ['location', 'Location & make']];

/** Editable board fields, shared by the properties panel (applied as you
 * type) and the double-click edit dialog (applied on Save).
 * 'general': equipment data (all groups, or only `groups`); 'source': transformer data (main boards). */
export default function BoardFields({ board, onChange, section, building, groups, earthing }: { board: Board; onChange: (b: Board) => void; section: 'general' | 'source'; building?: BuildingInfo; groups?: BoardFieldGroup[]; earthing?: EarthingPlan }) {
  const show = (g: BoardFieldGroup) => !groups || groups.includes(g);
  // A heading over each group when a tab shows more than one (the tab name already says it otherwise).
  const head = (g: BoardFieldGroup) => (!groups || groups.length > 1) && <h4 className="kv-head">{BOARD_FIELD_GROUPS.find(([k]) => k === g)?.[1]}</h4>;
  const floors = floorList(building);
  const isMain = !board.upstreamId;
  function set<K extends keyof Board>(key: K, value: Board[K]) {
    onChange({ ...board, [key]: value });
  }
  const setProt = (patch: Partial<NonNullable<Board['protection']>>) => {
    const p = { ...board.protection, ...patch };
    set('protection', Object.values(p).some((v) => v !== undefined) ? p : undefined);
  };
  const numOrU = (v: string) => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);
  const setEarth = (patch: Partial<NonNullable<Board['earthing']>>) => {
    const e = { ...board.earthing, ...patch };
    set('earthing', Object.values(e).some((v) => v !== undefined) ? e : undefined);
  };
  const text = (key: 'name' | 'ipRating' | 'location' | 'manufacturer' | 'model', placeholder = '') => (
    // Full text on hover: long names are cut off in a narrow side panel.
    <input value={board[key] ?? ''} title={board[key] || undefined} placeholder={placeholder} onChange={(e) => set(key, e.target.value || (key === 'name' ? '' : undefined))} />
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
        <label>Vector group
          <input value={board.vectorGroup ?? ''} placeholder="Dyn11" onChange={(e) => set('vectorGroup', e.target.value.trim() || undefined)} />
        </label>
      </div>
    );
  }
  return (
    <div className="form-kv">
      {show('board') && (
        <>
          {head('board')}
          <label>Name{text('name')}</label>
          <label>
            Type
            <select value={board.kind ?? (isMain ? 'MDB' : 'DB')} title={BOARD_KINDS.find((k) => k.value === (board.kind ?? (isMain ? 'MDB' : 'DB')))?.label} onChange={(e) => set('kind', e.target.value as Board['kind'])}>
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
          <label>
            Busbar material
            <select value={board.busbarMaterial ?? ''} onChange={(e) => set('busbarMaterial', (e.target.value || undefined) as Board['busbarMaterial'])}>
              <option value="">—</option>
              <option value="copper">Copper</option>
              <option value="aluminium">Aluminium</option>
            </select>
          </label>
          <label>Diversity factor (DF)
            <input inputMode="decimal" value={board.mdDemandFactor ?? ''} placeholder="from its loads"
              title="This panel's own DF: MDL = TCL × DF on the SLD summary box and the MD form. Blank = its loads' maximum demand ÷ connected load."
              onChange={(e) => set('mdDemandFactor', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : +e.target.value)} />
          </label>
          <label>IP rating{text('ipRating', 'e.g. IP42')}</label>
        </>
      )}
      {show('incomer') && (
        <>
          {head('incomer')}
          <label>Standby generator (kVA, via ATS)
            <input inputMode="decimal" value={board.standby?.kva ?? ''} placeholder="none"
              title="Leave blank for no generator. Everything on and below this board then counts as essential load."
              onChange={(e) => set('standby', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : { kva: +e.target.value })} />
          </label>
          {board.standby && (
            <label>Changeover
              <select value={board.standby.changeover ?? 'ATS'} onChange={(e) => set('standby', { ...board.standby!, changeover: e.target.value === 'ACB' ? 'ACB' : undefined })}>
                <option value="ATS">ATS</option>
                <option value="ACB">Mains + generator ACBs, interlocked</option>
              </select>
            </label>
          )}
          <label>Incomer device (SLD)
            <select value={board.incomerDevice ?? ''} onChange={(e) => set('incomerDevice', e.target.value ? (e.target.value as IncomerDevice) : undefined)}
              title="Drawn on the incoming line above the board name. A non-automatic breaker is the UAE practice for an isolator: breaker body, no trip.">
              <option value="">Default (non-automatic breaker; none on authority-supply boards)</option>
              {INCOMER_DEVICES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <label>Incomer CT ratio
            <input value={board.protection?.ctRatio ?? ''} placeholder={board.supply?.ctRatio ?? 'e.g. 1600/5A'}
              onChange={(e) => setProt({ ctRatio: e.target.value || undefined })} />
          </label>
          <label>Incomer Ir setting (× In)
            <input inputMode="decimal" value={board.protection?.irSetting ?? ''} placeholder={board.supply?.irSetting ? String(board.supply.irSetting) : 'e.g. 0.9'}
              onChange={(e) => setProt({ irSetting: e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : +e.target.value })} />
          </label>
          <fieldset className="relays">
            <legend>Incomer relays (shown on the SLD)</legend>
            {RELAY_TYPES.map((r) => (
              <label key={r.value} className="row">
                <input type="checkbox" checked={!!board.protection?.relays?.includes(r.value)}
                  onChange={(e) => { const cur = board.protection?.relays ?? []; const next = e.target.checked ? [...cur, r.value] : cur.filter((x) => x !== r.value); setProt({ relays: next.length ? next : undefined }); }} />
                {r.label}
              </label>
            ))}
            <label className="row">
              <input type="checkbox" checked={!!board.protection?.apfc} onChange={(e) => setProt({ apfc: e.target.checked || undefined })} />
              APFC relay CT (to the capacitor bank)
            </label>
          </fieldset>
          <label>Surge protection (SPD)
            <select value={board.spd ?? ''} onChange={(e) => set('spd', (e.target.value || undefined) as Board['spd'])}>
              <option value="">None</option>
              {SPD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        </>
      )}
      {show('sld') && (
        <>
          <fieldset className="relays">
            <legend>On the SLD</legend>
            <label className="row">
              <input type="checkbox" checked={board.instruments ?? isMain} onChange={(e) => set('instruments', e.target.checked === isMain ? undefined : e.target.checked)} />
              Ammeter + voltmeter with selector switches, R-Y-B lamps
            </label>
            <label className="row">
              <input type="checkbox" checked={board.earthing?.show ?? isMain} onChange={(e) => setEarth({ show: e.target.checked === isMain ? undefined : e.target.checked })} />
              Earth pit detail{!isMain && ' (main boards only)'}
            </label>
            {(board.earthing?.show ?? isMain) && (
              <div className="earth-kv">
                <label title="Blank: the count from Design ▸ Earth pits">Pits <input inputMode="numeric" value={board.earthing?.pits ?? ''} placeholder="plan" onChange={(e) => setEarth({ pits: numOrU(e.target.value) })} /></label>
                <label>Earth conductor mm² <input inputMode="decimal" value={board.earthing?.conductorMm2 ?? ''} placeholder="auto" onChange={(e) => setEarth({ conductorMm2: numOrU(e.target.value) })} /></label>
                <label title="Blank: the electrode length from Design ▸ Earth pits">Electrode m <input inputMode="decimal" value={board.earthing?.electrodeM ?? ''} placeholder="plan" onChange={(e) => setEarth({ electrodeM: numOrU(e.target.value) })} /></label>
                <label>Spacing m <input inputMode="decimal" value={board.earthing?.spacingM ?? ''} placeholder="6" onChange={(e) => setEarth({ spacingM: numOrU(e.target.value) })} /></label>
              </div>
            )}
          </fieldset>
        </>
      )}
      {show('location') && (
        <>
          {head('location')}
          <label title="The floor, from Building information — the one list of levels used everywhere (SLD summary box, riser diagram, schedules)">Level
            {floors.length ? (
              <select value={board.level && findFloor(building, board.level) ? levelKey(board.level) : ''} onChange={(e) => set('level', floors.find((f) => f.key === e.target.value)?.ref)}>
                <option value="">— not set —</option>
                {(building?.buildings ?? []).map((bd) => (
                  <optgroup key={bd.id} label={bd.name}>
                    {floors.filter((f) => f.buildingId === bd.id).slice().reverse().map((f) => <option key={f.key} value={f.key}>{f.name}{f.elevationM ? ` (${f.elevationM >= 0 ? '+' : ''}${f.elevationM.toFixed(2)})` : ''}</option>)}
                  </optgroup>
                ))}
              </select>
            ) : <span className="m">Add levels in Building information</span>}
          </label>
          {(() => {
            // Earth riser: only where the panel's building has more than one.
            const risers = (earthing?.risers ?? []).filter((r) => r.buildingId === board.level?.building);
            if (risers.length < 2 || !board.upstreamId) return null;
            return (
              <label title="The earth riser whose floor earth bar this panel's earth bar connects to (Design → Earth pits → Settings → Earth risers)">Earth riser
                <select value={board.earthRiser ?? ''} onChange={(e) => set('earthRiser', e.target.value || undefined)}>
                  <option value="">First riser on its level</option>
                  {risers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            );
          })()}
          <label>Room / place{text('location', 'e.g. Elec. room 3.01')}</label>
          <label>Manufacturer{text('manufacturer')}</label>
          <label>Model{text('model')}</label>
        </>
      )}
    </div>
  );
}
