import { BOARD_KINDS, INCOMER_DEVICES, RELAY_TYPES, SPD_TYPES, type Board, type IncomerDevice, type BuildingInfo, type EarthingPlan, type OtherBuilding } from '../types';
import { othersKva } from '../model/existing';
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
          <fieldset className="relays">
            <legend>Existing installation</legend>
            <label className="row" title="Already installed (an extension / retrofit): drawn dashed and tagged EXISTING, left out of the BOQ, checked against its recorded demand plus the new load">
              <input type="checkbox" checked={!!board.existing} onChange={(e) => set('existing', e.target.checked ? {} : undefined)} />
              Existing board{!board.upstreamId && board.sourceKva ? ' and transformer' : ''}
            </label>
            {board.existing && (() => {
              const ex = board.existing;
              const setEx = (patch: Partial<NonNullable<Board['existing']>>) => set('existing', { ...ex, ...patch });
              const n = (v: string) => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);
              const others = ex.others ?? [];
              const setOthers = (list: OtherBuilding[]) => setEx({ others: list.length ? list : undefined });
              const setOther = (i: number, patch: Partial<OtherBuilding>) => setOthers(others.map((o, j) => (j === i ? { ...o, ...patch } : o)));
              const kept = othersKva(board);
              return (
                <div className="earth-kv" title="The recorded maximum demand covers all existing load on and below this board; new load is added on top">
                  <label>Recorded MD (kVA)<input inputMode="decimal" value={ex.recordedKva ?? ''} placeholder="from DEWA / logger" onChange={(e) => setEx({ recordedKva: n(e.target.value) })} /></label>
                  <label>or as current (A)<input inputMode="decimal" value={ex.recordedA ?? ''} placeholder="if read in A" onChange={(e) => setEx({ recordedA: n(e.target.value) })} /></label>
                  <label>Power factor<input inputMode="decimal" value={ex.powerFactor ?? ''} placeholder="0.9" onChange={(e) => setEx({ powerFactor: n(e.target.value) })} /></label>
                  <label>Margin (%)<input inputMode="decimal" value={ex.marginPct ?? ''} placeholder="0" onChange={(e) => setEx({ marginPct: n(e.target.value) })} /></label>
                  <label>Recorded on<input value={ex.recordedOn ?? ''} placeholder="e.g. 2026-08-12" onChange={(e) => setEx({ recordedOn: e.target.value || undefined })} /></label>
                  <label>Source<input value={ex.source ?? ''} placeholder="DEWA reading / logger 7 days" onChange={(e) => setEx({ source: e.target.value || undefined })} /></label>
                  <label>Spare ways at survey<input inputMode="numeric" value={ex.spareWays ?? ''} placeholder="count" onChange={(e) => setEx({ spareWays: n(e.target.value) })} /></label>
                  <fieldset className="relays" title="Buildings supplied from this board that are not drawn in the project: the higher of allocated and recorded load is kept for each">
                    <legend>Other buildings on this supply</legend>
                    {others.map((o, i) => (
                      <div key={i} className="earth-kv">
                        <label>Name<input value={o.name} placeholder="e.g. Block B" aria-label={`Other building ${i + 1} name`} onChange={(e) => setOther(i, { name: e.target.value })} /></label>
                        <label>Reference<input value={o.ref ?? ''} placeholder="DEWA NOC / load letter" aria-label={`Other building ${i + 1} reference`} onChange={(e) => setOther(i, { ref: e.target.value || undefined })} /></label>
                        <label>Allocated (kVA)<input inputMode="decimal" value={o.allocatedKva ?? ''} aria-label={`Other building ${i + 1} allocated kVA`} onChange={(e) => setOther(i, { allocatedKva: n(e.target.value) })} /></label>
                        <label>Recorded (kVA)<input inputMode="decimal" value={o.recordedKva ?? ''} aria-label={`Other building ${i + 1} recorded kVA`} onChange={(e) => setOther(i, { recordedKva: n(e.target.value) })} /></label>
                        <button type="button" className="icon-btn" title="Remove building" aria-label={`Remove other building ${i + 1}`} onClick={() => setOthers(others.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                    <button type="button" className="chip" onClick={() => setOthers([...others, { name: '' }])}>+ Add building</button>
                    {kept > 0 && <span className="m">Kept for them: {+kept.toFixed(1)} kVA (the higher of allocated and recorded, each)</span>}
                  </fieldset>
                </div>
              );
            })()}
          </fieldset>
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
          <label>Standby generator (kVA)
            <input inputMode="decimal" value={board.standby?.kva ?? ''} placeholder="none"
              title="Leave blank for no generator. Everything on and below this board then counts as essential load."
              onChange={(e) => set('standby', e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : { kva: +e.target.value })} />
          </label>
          {board.standby && (
            <label>Changeover
              <select value={board.standby.changeover ?? 'ATS'} onChange={(e) => set('standby', { ...board.standby!, changeover: e.target.value === 'ACB' ? 'ACB' : undefined })}
                title="Interlocked: mains and generator incomers into the busbar, each with its own breaker and instruments, electro-mechanically interlocked">
                <option value="ATS">ATS (4P, switched neutral)</option>
                <option value="ACB">Mains + generator breakers, electro-mechanically interlocked</option>
              </select>
            </label>
          )}
          {board.standby && board.standby.changeover !== 'ACB' && (
            <>
              <label>ATS rating (A)
                <input inputMode="decimal" value={board.standby.atsRatingA ?? ''} placeholder={board.ratedCurrentA ? `${board.ratedCurrentA} (board)` : 'board rating'}
                  onChange={(e) => set('standby', { ...board.standby!, atsRatingA: e.target.value === '' || Number.isNaN(+e.target.value) ? undefined : +e.target.value })} />
              </label>
              <label>ATS transfer
                <select value={board.standby.transition ?? 'open'} onChange={(e) => set('standby', { ...board.standby!, transition: e.target.value === 'closed' ? 'closed' : undefined })}>
                  <option value="open">Open transition (break before make)</option>
                  <option value="closed">Closed transition (make before break)</option>
                </select>
              </label>
              <label>ATS category (IEC 60947-6-1)
                <select value={board.standby.category ?? 'AC-33B'} onChange={(e) => set('standby', { ...board.standby!, category: e.target.value === 'AC-31B' ? 'AC-31B' : undefined })}>
                  <option value="AC-33B">AC-33B — mixed loads with motors</option>
                  <option value="AC-31B">AC-31B — resistive loads only</option>
                </select>
              </label>
            </>
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
            <label className="row" title="Power meter on the incomer, linked to the BMS — one per incomer on a mains / generator changeover; counted in the BOQ">
              <input type="checkbox" checked={!!board.pmu} onChange={(e) => set('pmu', e.target.checked || undefined)} />
              Power meter (PMU) to BMS
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
