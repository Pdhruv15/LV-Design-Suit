import { useMemo, useState } from 'react';
import type { BuildingInfo, BuildingLevel, BuildingRoom, LevelKind, Project, ProjectBuilding, RoomType } from '../../types';
import {
  buildingInfoOf, dbChecks, DEFAULT_ROOM_TYPES, LEVEL_KINDS, loadRoomTypeLibrary, newBuilding, roomLoad, roomsFromTable, roomTypesOf, saveRoomTypeLibrary, summarizeBuilding
} from '../../calc/building';
import { Page } from '../ui';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const num = (v: string) => (v.trim() === '' || Number.isNaN(+v.replace(/,/g, '')) ? undefined : +v.replace(/,/g, ''));

/** A number cell that saves when you leave it (so typing isn't interrupted). */
function Cell({ value, onSet, placeholder, width = 80 }: { value?: number; onSet: (v: number | undefined) => void; placeholder?: string; width?: number }) {
  return <input className="bi-num" style={{ width }} inputMode="decimal" defaultValue={value ?? ''} key={value ?? ''} placeholder={placeholder}
    onBlur={(e) => { const v = num(e.target.value); if (v !== value) onSet(v); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}
function TextCell({ value, onSet, width = 150 }: { value: string; onSet: (v: string) => void; width?: number }) {
  return <input className="bi-text" style={{ width }} defaultValue={value} key={value}
    onBlur={(e) => e.target.value !== value && onSet(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

/** Architectural information: buildings, levels (typical floors), rooms and
 * room types — entered once, used by space planning, the busbar riser, the
 * DEWA forms and the check of each DB against the rooms it serves. */
export default function BuildingView({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const info = buildingInfoOf(project);
  const set = (next: BuildingInfo) => onChange({ ...project, building: next });
  const [sel, setSel] = useState(info.buildings[0]?.id ?? '');
  const b = info.buildings.find((x) => x.id === sel) ?? info.buildings[0];
  const [levelFilter, setLevelFilter] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [showTypes, setShowTypes] = useState(false);
  const types = roomTypesOf(info);
  const sum = useMemo(() => (b ? summarizeBuilding(info, b) : undefined), [info, b]);
  const checks = useMemo(() => dbChecks(project), [project]);

  const setB = (patch: Partial<ProjectBuilding>) => b && set({ ...info, buildings: info.buildings.map((x) => (x.id === b.id ? { ...x, ...patch } : x)) });
  const setLevel = (id: string, patch: Partial<BuildingLevel>) => b && setB({ levels: b.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const setRoom = (id: string, patch: Partial<BuildingRoom>) => set({ ...info, rooms: info.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const setTypes = (next: RoomType[]) => set({ ...info, roomTypes: next });

  const addBuilding = () => {
    let n = info.buildings.length + 1;
    while (info.buildings.some((x) => x.id === `BLD${n}`)) n++;
    const nb = newBuilding(`BLD${n}`, info.buildings.length ? `Building ${n}` : project.name);
    set({ ...info, buildings: [...info.buildings, nb] });
    setSel(nb.id);
  };
  const addLevel = (kind: LevelKind) => {
    if (!b) return;
    let n = b.levels.length + 1;
    while (b.levels.some((l) => l.id === `${b.id}-L${n}`)) n++;
    const l: BuildingLevel = { id: `${b.id}-L${n}`, name: kind === 'basement' ? `B${b.levels.filter((x) => x.kind === 'basement').length + 1}` : kind === 'typical' ? 'Typical floors' : LEVEL_KINDS.find((k) => k.value === kind)!.label, kind, heightM: kind === 'basement' ? 3.5 : 3.6, count: kind === 'typical' ? 10 : undefined };
    // Basements go at the bottom, the roof at the top, others below the roof.
    const levels = kind === 'basement' ? [l, ...b.levels] : kind === 'roof' ? [...b.levels, l] : (() => { const i = b.levels.findIndex((x) => x.kind === 'roof'); return i < 0 ? [...b.levels, l] : [...b.levels.slice(0, i), l, ...b.levels.slice(i)]; })();
    setB({ levels });
  };
  const moveLevel = (id: string, d: -1 | 1) => {
    if (!b) return;
    const i = b.levels.findIndex((l) => l.id === id);
    const j = i + d;
    if (j < 0 || j >= b.levels.length) return;
    const levels = [...b.levels];
    [levels[i], levels[j]] = [levels[j], levels[i]];
    setB({ levels });
  };
  const addRoom = () => {
    if (!b) return;
    const levelId = levelFilter || b.levels.find((l) => l.kind === 'typical')?.id || b.levels[0]?.id;
    if (!levelId) return;
    let n = info.rooms.length + 1;
    while (info.rooms.some((r) => r.id === `R${n}`)) n++;
    set({ ...info, rooms: [...info.rooms, { id: `R${n}`, buildingId: b.id, levelId, name: 'Room', type: types[0]?.id ?? 'office', areaM2: 50 }] });
  };
  function importRooms() {
    if (!b || !paste) return;
    const r = roomsFromTable(info, b.id, paste);
    if (!r.added) { onStatus('No rooms found — columns: Level, Room, Type, Area (m²), Count, DB'); return; }
    set(r.info);
    setPaste(null);
    onStatus(`Added ${r.added} rooms${r.newLevels.length ? `, new levels: ${r.newLevels.join(', ')}` : ''}${r.newTypes.length ? ` — new room types (set their W/m²): ${r.newTypes.join(', ')}` : ''}`);
    if (r.newTypes.length) setShowTypes(true);
  }

  const rooms = info.rooms.filter((r) => r.buildingId === b?.id && (!levelFilter || r.levelId === levelFilter));
  const levelName = (id: string) => b?.levels.find((l) => l.id === id)?.name ?? id;

  return (
    <Page
      title="Building information"
      intro="The architectural data, entered once: buildings, levels (typical floors counted as many times as they repeat), rooms with their type and area, and the DB serving them. Used by Space planning, the busbar riser, the DEWA forms (built-up area) and the check of each DB against its rooms."
      actions={<>
        <button className="chip" onClick={addBuilding}>+ Building</button>
        {b && <button className="chip" onClick={() => setPaste('')} title="Paste the architect's area schedule from Excel">Paste rooms from Excel</button>}
        <button className="chip" onClick={() => setShowTypes(!showTypes)}>Room types</button>
      </>}
    >
      {!b ? (
        <div className="card"><p>No building yet. Add one, then its levels and rooms — or paste the architect’s area schedule.</p><button className="chip primary" onClick={addBuilding}>Add a building</button></div>
      ) : (
        <>
          {info.buildings.length > 1 && (
            <div className="seg bi-tabs">{info.buildings.map((x) => <button key={x.id} className={x.id === b.id ? 'on' : ''} onClick={() => setSel(x.id)}>{x.name}</button>)}</div>
          )}
          <section className="card bi-head">
            <div className="bi-grid">
              <label>Building<TextCell value={b.name} onSet={(v) => setB({ name: v })} width={200} /></label>
              <label>Use<input className="bi-text" defaultValue={b.use ?? ''} key={b.use ?? ''} placeholder="e.g. Residential tower" onBlur={(e) => setB({ use: e.target.value || undefined })} /></label>
              <label>Plot area (m²)<Cell value={b.plotAreaM2} onSet={(v) => setB({ plotAreaM2: v })} width={110} /></label>
              <label>GFA (m²)<Cell value={b.gfaM2} onSet={(v) => setB({ gfaM2: v })} placeholder={sum ? f0(sum.gfaFromLevels) : ''} width={110} /></label>
              <label>Built-up area (m²)<Cell value={b.buaM2} onSet={(v) => setB({ buaM2: v })} placeholder={sum ? `= GFA ${f0(sum.gfaM2)}` : ''} width={110} /></label>
            </div>
            {sum && (
              <div className="bi-kpis">
                <span><b>{sum.description || '—'}</b> <span className="m">{sum.floors} floors{sum.basements ? ` (${sum.basements} below ground)` : ''}</span></span>
                <span>GFA {sum.gfaM2 ? <b>{f0(sum.gfaM2)} m²</b> : <span className="m">— enter the gross area per floor, or the GFA</span>}{b.gfaM2 !== undefined && sum.gfaFromLevels ? <span className="m"> (levels: {f0(sum.gfaFromLevels)})</span> : null}</span>
                <span>Height <b>{f1(sum.heightM)} m</b></span>
                <span>Rooms <b>{f0(sum.roomsM2)} m²</b></span>
                <span>Load <b>{f0(sum.connectedKw)} kW</b> connected · <b>{f0(sum.demandKw)} kW</b> demand{sum.gfaM2 ? <span className="m"> · {f1((sum.demandKw * 1000) / sum.gfaM2)} W/m² GFA</span> : null}</span>
              </div>
            )}
            <button className="linkish bad" style={{ marginLeft: 0, alignSelf: 'flex-start' }} onClick={() => {
              if (!window.confirm(`Delete ${b.name} and its ${info.rooms.filter((r) => r.buildingId === b.id).length} rooms?`)) return;
              set({ ...info, buildings: info.buildings.filter((x) => x.id !== b.id), rooms: info.rooms.filter((r) => r.buildingId !== b.id) });
              setSel('');
            }}>Delete this building</button>
          </section>

          <h3 className="section-title flush">Levels <span className="m">(bottom to top)</span></h3>
          <table className="bi-table">
            <thead><tr><th /><th>Level</th><th>Kind</th><th>Floors</th><th>Floor height (m)</th><th>Gross area / floor (m²)</th><th>Level (m)</th><th>Rooms</th><th>Rooms area</th><th>Demand</th><th /></tr></thead>
            <tbody>
              {sum?.levels.map((li, i) => {
                const l = li.level;
                return (
                  <tr key={l.id} className={levelFilter === l.id ? 'on' : ''}>
                    <td className="bi-move">
                      <button className="icon-btn" disabled={i === 0} onClick={() => moveLevel(l.id, -1)} title="Down">▼</button>
                      <button className="icon-btn" disabled={i === b.levels.length - 1} onClick={() => moveLevel(l.id, 1)} title="Up">▲</button>
                    </td>
                    <td><TextCell value={l.name} onSet={(v) => setLevel(l.id, { name: v })} /></td>
                    <td>
                      <select className="bi-sel" value={l.kind} onChange={(e) => setLevel(l.id, { kind: e.target.value as LevelKind })}>
                        {LEVEL_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                    </td>
                    <td><Cell value={l.count ?? 1} onSet={(v) => setLevel(l.id, { count: v && v > 1 ? Math.round(v) : undefined })} width={54} /></td>
                    <td><Cell value={l.heightM} onSet={(v) => v && setLevel(l.id, { heightM: v })} width={64} /></td>
                    <td><Cell value={l.grossM2} onSet={(v) => setLevel(l.id, { grossM2: v })} width={90} /></td>
                    <td className="m">{li.elevationM >= 0 ? '+' : ''}{f1(li.elevationM)}{li.count > 1 ? ` … +${f1(li.elevationM + l.heightM * (li.count - 1))}` : ''}</td>
                    <td><button className="linkish" style={{ marginLeft: 0 }} onClick={() => setLevelFilter(levelFilter === l.id ? '' : l.id)}>{info.rooms.filter((r) => r.levelId === l.id).length}</button></td>
                    <td>{li.roomsM2 ? `${f0(li.roomsM2)} m²` : '—'}</td>
                    <td>{li.demandKw ? <>{f0(li.demandKw)} kW{li.count > 1 ? <span className="m"> ({f1(li.perFloorDemandKw)}/floor)</span> : null}</> : '—'}</td>
                    <td><button className="icon-btn" title="Remove the level and its rooms" onClick={() => {
                      const n = info.rooms.filter((r) => r.levelId === l.id).length;
                      if (n && !window.confirm(`Remove ${l.name} and its ${n} rooms?`)) return;
                      set({ ...info, buildings: info.buildings.map((x) => (x.id === b.id ? { ...x, levels: x.levels.filter((y) => y.id !== l.id) } : x)), rooms: info.rooms.filter((r) => r.levelId !== l.id) });
                    }}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="bi-actions">
            <span className="m">Add:</span>
            {LEVEL_KINDS.map((k) => <button key={k.value} className="chip" onClick={() => addLevel(k.value)}>{k.label}</button>)}
          </div>

          <h3 className="section-title flush">
            Rooms {levelFilter && <span className="m">on {levelName(levelFilter)} · <button className="linkish" onClick={() => setLevelFilter('')}>all levels</button></span>}
          </h3>
          <table className="bi-table">
            <thead><tr><th>Level</th><th>Room</th><th>Type</th><th>Area (m²)</th><th>Same rooms</th><th>Total</th><th>Served by</th><th>Connected</th><th>Demand</th><th /></tr></thead>
            <tbody>
              {rooms.map((r) => {
                const x = roomLoad(info, r);
                return (
                  <tr key={r.id}>
                    <td>
                      <select className="bi-sel" value={r.levelId} onChange={(e) => setRoom(r.id, { levelId: e.target.value })}>
                        {b.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </td>
                    <td><TextCell value={r.name} onSet={(v) => setRoom(r.id, { name: v })} /></td>
                    <td>
                      <select className="bi-sel" value={r.type} onChange={(e) => setRoom(r.id, { type: e.target.value })}>
                        {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        {!types.some((t) => t.id === r.type) && <option value={r.type}>{r.type} (unknown)</option>}
                      </select>
                    </td>
                    <td><Cell value={r.areaM2} onSet={(v) => v && setRoom(r.id, { areaM2: v })} width={80} /></td>
                    <td><Cell value={r.count ?? 1} onSet={(v) => setRoom(r.id, { count: v && v > 1 ? Math.round(v) : undefined })} width={54} /></td>
                    <td className="m">{x.total > 1 ? `${x.total} · ${f0(x.areaM2)} m²` : `${f0(x.areaM2)} m²`}</td>
                    <td>
                      <select className="bi-sel" value={r.boardId ?? ''} onChange={(e) => setRoom(r.id, { boardId: e.target.value || undefined })}>
                        <option value="">—</option>
                        {project.boards.map((pb) => <option key={pb.id} value={pb.id}>{pb.id}</option>)}
                      </select>
                    </td>
                    <td>{f1(x.connectedKw)} kW <span className="m">{x.type ? `${x.type.wPerM2} W/m²` : ''}</span></td>
                    <td>{f1(x.demandKw)} kW</td>
                    <td><button className="icon-btn" title="Remove" onClick={() => set({ ...info, rooms: info.rooms.filter((y) => y.id !== r.id) })}>✕</button></td>
                  </tr>
                );
              })}
              {!rooms.length && <tr><td colSpan={10} className="m">No rooms{levelFilter ? ' on this level' : ''} yet — add them, or paste the area schedule from Excel.</td></tr>}
            </tbody>
          </table>
          <div className="bi-actions"><button className="chip" onClick={addRoom}>+ Room</button></div>
        </>
      )}

      {checks.length > 0 && (
        <>
          <h3 className="section-title flush">DBs against the rooms they serve</h3>
          <table className="bi-table">
            <thead><tr><th>DB</th><th>Rooms</th><th>Area</th><th>Expected (room types)</th><th>Designed (load schedule)</th><th>Designed W/m²</th><th>Result</th></tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.boardId}>
                  <td><b>{c.boardId}</b></td>
                  <td className="m">{c.rooms.map((x) => x.room.name).slice(0, 4).join(', ')}{c.rooms.length > 4 ? ` +${c.rooms.length - 4}` : ''}</td>
                  <td>{f0(c.areaM2)} m²</td>
                  <td>{f1(c.expectedKw)} kW</td>
                  <td>{f1(c.scheduledKw)} kW</td>
                  <td>{f1(c.wPerM2)}</td>
                  <td className={c.status}>{c.ratio === undefined ? '—' : c.status === 'ok' ? `OK (${f0(c.ratio * 100)} %)` : `Check — ${f0(c.ratio * 100)} % of expected`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m">Within ± 30 % is fine; outside it, check the load schedule or the room types’ W/m².</p>
        </>
      )}

      {showTypes && (
        <section className="card bi-types">
          <div className="bi-actions" style={{ marginTop: 0 }}>
            <b>Room types</b>
            <span className="m">{info.roomTypes ? 'this project’s' : 'placeholder values — replace with yours'}</span>
            <span className="sp" />
            <button className="chip" onClick={() => { const i = types.length + 1; setTypes([...types, { id: `type${i}`, label: `Type ${i}`, wPerM2: 20, demandFactor: 0.8 }]); }}>+ Type</button>
            <button className="chip" title="Keep these room types on this computer for new projects" onClick={() => onStatus(saveRoomTypeLibrary(types) ? 'Saved as your room type library' : 'Could not store the library on this computer')}>Save as my library</button>
            <button className="chip" onClick={() => { const lib = loadRoomTypeLibrary(); if (!lib) onStatus('No room type library saved on this computer yet'); else { setTypes(lib); onStatus('Loaded your room type library'); } }}>Use my library</button>
            {info.roomTypes && <button className="chip" onClick={() => set({ ...info, roomTypes: undefined })}>Placeholders</button>}
          </div>
          <table className="bi-table">
            <thead><tr><th>Type</th><th>W/m²</th><th>Demand factor</th><th>Lux</th><th>Rooms</th><th /></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td><TextCell value={t.label} onSet={(v) => setTypes(types.map((x) => (x.id === t.id ? { ...x, label: v } : x)))} width={190} /></td>
                  <td><Cell value={t.wPerM2} onSet={(v) => v !== undefined && setTypes(types.map((x) => (x.id === t.id ? { ...x, wPerM2: v } : x)))} width={70} /></td>
                  <td><Cell value={t.demandFactor} onSet={(v) => v !== undefined && setTypes(types.map((x) => (x.id === t.id ? { ...x, demandFactor: v } : x)))} width={70} /></td>
                  <td><Cell value={t.lux} onSet={(v) => setTypes(types.map((x) => (x.id === t.id ? { ...x, lux: v } : x)))} width={70} /></td>
                  <td>{info.rooms.filter((r) => r.type === t.id).length}</td>
                  <td>{!info.rooms.some((r) => r.type === t.id) && <button className="icon-btn" title="Remove" onClick={() => setTypes(types.filter((x) => x.id !== t.id))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!info.roomTypes && <p className="m">The {DEFAULT_ROOM_TYPES.length} starting types are placeholders, not authority figures — edit them for your practice and “Save as my library”.</p>}
        </section>
      )}

      {paste !== null && (
        <div className="modal-backdrop" onClick={() => setPaste(null)}>
          <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3>Paste rooms into {b?.name}</h3>
            <p className="m">Copy the area schedule from Excel with these columns, in this order: <b>Level · Room · Type · Area (m²) · Count · DB</b> (Count and DB optional). A header row is skipped. New levels and room types are added.</p>
            <textarea className="bi-paste" autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Typical floors\t2BR apartment\tApartment\t120\t6\tDB-TYP\nGround\tLobby\tLobby / corridor\t350\t\tSMDB-GF'} />
            <div className="modal-actions">
              <span className="sp" />
              <button className="chip" onClick={() => setPaste(null)}>Cancel</button>
              <button className="chip primary" disabled={!paste.trim()} onClick={importRooms}>Add rooms</button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
