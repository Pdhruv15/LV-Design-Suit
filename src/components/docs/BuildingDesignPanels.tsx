import { useMemo, useState } from 'react';
import type { BuildingInfo, MeterType, Project, ProjectBuilding, RoomType, UnitType } from '../../types';
import { METER_TYPES } from '../../types';
import { roomTypesOf } from '../../calc/building';
import { catalog } from '../../database/catalog';
import { addServices, benchOf, defaultServices, floorLoads, generateBuildingDbs, plannedDbs, roomDensities, rulesOf, lpdOf, unitLoads, type ServiceItem } from '../../calc/buildingDesign';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const num = (v: string) => (v.trim() === '' || Number.isNaN(+v.replace(/,/g, '')) ? undefined : +v.replace(/,/g, ''));

function N({ value, onSet, width = 60, placeholder }: { value?: number; onSet: (v: number | undefined) => void; width?: number; placeholder?: string }) {
  return <input className="bi-num" style={{ width }} inputMode="decimal" defaultValue={value ?? ''} key={value ?? ''} placeholder={placeholder}
    onBlur={(e) => { const v = num(e.target.value); if (v !== value) onSet(v); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

/** Room type rules: how many points per m², fixed points, A/C, LPD limit. */
export function RoomRulesTable({ types, onChange }: { types: RoomType[]; onChange: (t: RoomType[]) => void }) {
  const set = (id: string, patch: Partial<NonNullable<RoomType['rules']>> | { lpdMax?: number } | { benchWPerM2?: number }) =>
    onChange(types.map((t) => {
      if (t.id !== id) return t;
      if ('lpdMax' in patch) return { ...t, lpdMax: patch.lpdMax };
      if ('benchWPerM2' in patch) return { ...t, benchWPerM2: (patch as { benchWPerM2?: number }).benchWPerM2 };
      return { ...t, rules: { ...rulesOf(t), ...patch } };
    }));
  return (
    <table className="bi-table">
      <thead><tr><th>Type</th><th title="One lighting point per … m²">Lighting m²/pt</th><th title="One 13 A socket per … m²">13A S/O m²/pt</th><th title="One split A/C per … m² (blank = none)">A/C m²/unit</th><th>A/C kW</th><th>W/H</th><th>Cooker</th><th>Exh. fan</th><th title="Lighting power density limit, W/m² (e.g. ASHRAE 90.1)">LPD max W/m²</th><th title="Typical total W/m² — rooms far from it are flagged">Typical W/m²</th></tr></thead>
      <tbody>
        {types.map((t) => {
          const r = rulesOf(t);
          return (
            <tr key={t.id}>
              <td>{t.label}</td>
              <td><N value={r.ltgM2PerPoint} onSet={(v) => set(t.id, { ltgM2PerPoint: v })} /></td>
              <td><N value={r.s13M2PerPoint} onSet={(v) => set(t.id, { s13M2PerPoint: v })} /></td>
              <td><N value={r.acM2PerUnit} onSet={(v) => set(t.id, { acM2PerUnit: v })} /></td>
              <td><N value={r.acKwPerUnit} onSet={(v) => set(t.id, { acKwPerUnit: v })} /></td>
              <td><N value={r.wh} onSet={(v) => set(t.id, { wh: v })} width={44} /></td>
              <td><N value={r.cooker} onSet={(v) => set(t.id, { cooker: v })} width={44} /></td>
              <td><N value={r.exfan} onSet={(v) => set(t.id, { exfan: v })} width={44} /></td>
              <td><N value={lpdOf(t)} onSet={(v) => set(t.id, { lpdMax: v })} /></td>
              <td><N value={benchOf(t)} onSet={(v) => set(t.id, { benchWPerM2: v })} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Flat / tenant layouts: rooms of each unit type and its meter. */
export function UnitTypesCard({ info, onChange }: { info: BuildingInfo; onChange: (i: BuildingInfo) => void }) {
  const types = roomTypesOf(info);
  const units = info.unitTypes ?? [];
  const set = (next: UnitType[]) => onChange({ ...info, unitTypes: next });
  const setU = (id: string, patch: Partial<UnitType>) => set(units.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  const add = () => {
    let n = units.length + 1;
    while (units.some((u) => u.id === `U${n}`)) n++;
    const t = (id: string) => types.find((x) => x.id === id)?.id ?? types.find((x) => x.id === 'apartment')?.id ?? types[0]?.id ?? 'apartment';
    set([...units, { id: `U${n}`, name: n === 1 ? '2BR apartment' : `Unit type ${n}`, rooms: [
      { name: 'Living / dining', type: t('living'), areaM2: 35 }, { name: 'Bedroom 1', type: t('bedroom'), areaM2: 16 }, { name: 'Bedroom 2', type: t('bedroom'), areaM2: 14 },
      { name: 'Kitchen', type: t('kitchen'), areaM2: 10 }, { name: 'Bathroom 1', type: t('bathroom'), areaM2: 5 }, { name: 'Bathroom 2', type: t('bathroom'), areaM2: 4 }] }]);
  };
  const used = (id: string) => info.buildings.some((b) => b.levels.some((l) => l.units?.some((x) => x.unitTypeId === id)));
  return (
    <section className="card bi-units">
      <div className="bi-actions" style={{ marginTop: 0 }}>
        <b>Flats / tenants</b><span className="m">a layout entered once, placed on levels (Levels → Flats). Each flat gets its own DB and meter.</span>
        <span className="sp" />
        {catalog().unitTypes.length > 0 && <button className="chip" title="Add the layouts from UnitTypes.xlsx (database)" onClick={() => set([...units, ...catalog().unitTypes.filter((u) => !units.some((x) => x.id === u.id)).map((u) => ({ ...u, rooms: u.rooms.map((r) => ({ ...r })) }))])}>From library ({catalog().unitTypes.length})</button>}
        <button className="chip" onClick={add}>+ Unit type</button>
      </div>
      {!units.length && <p className="m">No unit types yet — e.g. Studio, 1BR, 2BR, 3BR, shop.</p>}
      <div className="bi-unit-grid">
        {units.map((u) => {
          const area = u.rooms.reduce((s, r) => s + r.areaM2, 0);
          return (
            <div key={u.id} className="bi-unit">
              <div className="bi-unit-head">
                <input className="bi-text" style={{ width: 150, fontWeight: 600 }} defaultValue={u.name} key={u.name} onBlur={(e) => e.target.value && setU(u.id, { name: e.target.value })} />
                <span className="m">{f0(area)} m²</span>
                <select className="bi-sel" value={u.meter ?? ''} onChange={(e) => setU(u.id, { meter: (e.target.value || undefined) as MeterType | undefined })} title="kWh meter on the unit's incomer">
                  <option value="">Meter: by load</option>{METER_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <button className="icon-btn" disabled={used(u.id)} title={used(u.id) ? 'Placed on a level — remove it there first' : 'Remove'} onClick={() => set(units.filter((x) => x.id !== u.id))}>✕</button>
              </div>
              <table className="bi-table compact">
                <tbody>
                  {u.rooms.map((r, i) => (
                    <tr key={i}>
                      <td><input className="bi-text" style={{ width: 120 }} defaultValue={r.name} key={r.name} onBlur={(e) => setU(u.id, { rooms: u.rooms.map((x, k) => (k === i ? { ...x, name: e.target.value || x.name } : x)) })} /></td>
                      <td><select className="bi-sel" value={r.type} onChange={(e) => setU(u.id, { rooms: u.rooms.map((x, k) => (k === i ? { ...x, type: e.target.value } : x)) })}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></td>
                      <td><N value={r.areaM2} onSet={(v) => v && setU(u.id, { rooms: u.rooms.map((x, k) => (k === i ? { ...x, areaM2: v } : x)) })} width={54} /> m²</td>
                      <td><button className="icon-btn" onClick={() => setU(u.id, { rooms: u.rooms.filter((_, k) => k !== i) })}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="linkish" style={{ marginLeft: 0 }} onClick={() => setU(u.id, { rooms: [...u.rooms, { name: 'Room', type: u.rooms[0]?.type ?? types[0]?.id ?? 'apartment', areaM2: 12 }] })}>+ room</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Flats on one level: unit type and how many per floor. */
export function LevelUnitsDialog({ info, b, levelId, onSave, onClose }: { info: BuildingInfo; b: ProjectBuilding; levelId: string; onSave: (u: { unitTypeId: string; count: number }[]) => void; onClose: () => void }) {
  const l = b.levels.find((x) => x.id === levelId)!;
  const [rows, setRows] = useState(l.units ?? []);
  const units = info.unitTypes ?? [];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h3>Flats on {l.name}{(l.count ?? 1) > 1 ? ` (each of ${l.count} floors)` : ''}</h3>
        {!units.length ? <p className="m">Add unit types first (Flats / tenants, below the rooms).</p> : (
          <>
            {rows.map((r, i) => (
              <div key={i} className="row" style={{ gap: 8, margin: '4px 0' }}>
                <select className="bi-sel" value={r.unitTypeId} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, unitTypeId: e.target.value } : x)))}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                ×<input className="bi-num" style={{ width: 54 }} inputMode="numeric" value={r.count} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, count: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} /> per floor
                <button className="icon-btn" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>
              </div>
            ))}
            <button className="chip" onClick={() => setRows([...rows, { unitTypeId: units[0].id, count: 4 }])}>+ Unit type</button>
          </>
        )}
        <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Cancel</button><button className="chip primary" onClick={() => onSave(rows.filter((r) => r.count > 0))}>Save</button></div>
      </div>
    </div>
  );
}

/** Generate the DBs and load schedules from the rooms and flats. */
export function GenerateDialog({ project, b, onDone, onClose }: { project: Project; b: ProjectBuilding; onDone: (p: Project, msg: string) => void; onClose: () => void }) {
  const plan = useMemo(() => plannedDbs(project, b.id), [project, b.id]);
  const [src, setSrc] = useState(b.riser?.fromBoardId ?? project.boards.find((x) => !x.upstreamId)?.id ?? '');
  const existing = plan.filter((d) => project.boards.some((x) => x.id === d.id)).length;
  const flats = plan.filter((d) => d.unit).length;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>Generate DBs and load schedules — {b.name}</h3>
        <p>From the rooms and flats: <b>{plan.length} DBs</b> ({plan.length - flats} common, {flats} flats), each with lighting, socket, A/C, water heater and cooker circuits by the room type rules, phases balanced, incomer sized with its length from the riser{flats ? ' and a kWh meter per flat' : ''}.</p>
        {existing > 0 && <p className="warn">{existing} of these DBs already exist: their generated circuits are replaced; circuits you added yourself are kept.</p>}
        <label className="row" style={{ gap: 8 }}>Fed from
          <select className="bi-sel" value={src} onChange={(e) => setSrc(e.target.value)}>{project.boards.filter((x) => (x.kind ?? (x.upstreamId ? 'DB' : 'MDB')) !== 'DB').map((x) => <option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select>
        </label>
        <p className="m">Rooms with a DB chosen in “Served by” are left on that DB. Watts per point are placeholders (lighting 40 W, 13A socket 200 W, water heater 1.5 kW, cooker 3 kW, A/C by the rule) — edit them on each load schedule.</p>
        <div className="bi-plan">{plan.slice(0, 40).map((d) => <span key={d.id} className={project.boards.some((x) => x.id === d.id) ? 'm' : ''}>{d.id}</span>)}{plan.length > 40 && <span className="m">+{plan.length - 40} more</span>}</div>
        <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!plan.length || !src} onClick={() => {
            const r = generateBuildingDbs({ ...project, building: { ...project.building!, buildings: project.building!.buildings.map((x) => (x.id === b.id ? { ...x, riser: { ...x.riser, fromBoardId: src } } : x)) } }, b.id, src);
            onDone(r.project, `${r.dbs.length} DBs, ${r.circuits} circuits${r.replaced ? ` (${r.replaced} earlier generated circuits replaced)` : ''} — check the load schedules`);
          }}>Generate {plan.length} DBs</button>
        </div>
      </div>
    </div>
  );
}

/** Common area services checklist: lifts, pumps, fans, lighting, EV… */
export function ServicesDialog({ project, b, onDone, onClose }: { project: Project; b: ProjectBuilding; onDone: (p: Project, msg: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<ServiceItem[]>(() => defaultServices(project, b.id));
  const [board, setBoard] = useState(b.riser?.fromBoardId ?? project.boards.find((x) => !x.upstreamId)?.id ?? '');
  const set = (id: string, patch: Partial<ServiceItem>) => setItems(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const total = items.reduce((s, x) => s + x.kw * x.qty, 0);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <h3>Common area services — {b.name}</h3>
        <p className="m">Typical starting values from the building (floors, car park area) — placeholders, set your own kW. Each unit becomes a feeder; standby units are left out of the TCL duty; life-safety loads are marked essential.</p>
        <table className="bi-table">
          <thead><tr><th>Service</th><th>Qty</th><th>kW each</th><th>Standby</th><th>Essential</th></tr></thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className={x.qty ? '' : 'm'}>
                <td>{x.label}</td>
                <td><input className="bi-num" style={{ width: 48 }} inputMode="numeric" value={x.qty} onChange={(e) => set(x.id, { qty: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></td>
                <td><input className="bi-num" style={{ width: 60 }} inputMode="decimal" value={x.kw} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set(x.id, { kw: v }); }} /></td>
                <td><input className="bi-num" style={{ width: 40 }} inputMode="numeric" value={x.standby ?? 0} onChange={(e) => set(x.id, { standby: Math.max(0, Math.round(Number(e.target.value) || 0)) || undefined })} /></td>
                <td><input type="checkbox" checked={!!x.essential} onChange={(e) => set(x.id, { essential: e.target.checked || undefined })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <label className="row" style={{ gap: 6 }}>On board <select className="bi-sel" value={board} onChange={(e) => setBoard(e.target.value)}>{project.boards.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}</select></label>
          <span className="m">{f1(total)} kW in {items.reduce((s, x) => s + x.qty, 0)} feeders</span>
          <span className="sp" /><button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!board || !items.some((x) => x.qty)} onClick={() => { const r = addServices(project, board, items.filter((x) => x.qty > 0)); onDone(r.project, `Added ${r.added} service feeders on ${board}`); }}>Add to {board}</button>
        </div>
      </div>
    </div>
  );
}

/** Load density: W/m² per floor (chart), rooms outside their benchmarks, flats. */
export function DensityPanel({ project, b }: { project: Project; b: ProjectBuilding }) {
  const floors = useMemo(() => floorLoads(project, b.id), [project, b.id]);
  const rooms = useMemo(() => roomDensities(project, b.id), [project, b.id]);
  const units = useMemo(() => unitLoads(project, b.id), [project, b.id]);
  const [all, setAll] = useState(false);
  const flagged = rooms.filter((r) => r.status === 'warn');
  const shownRooms = all ? rooms : flagged;
  const data = floors.filter((f) => f.connectedKw > 0);
  if (!data.length && !rooms.length) return <p className="m">No designed load on this building's floors yet — generate the DBs, or choose the DB serving each room.</p>;
  const max = Math.max(1, ...data.map((f) => (f.grossM2 ? (f.connectedKw * 1000) / f.grossM2 : 0)), ...data.map((f) => f.connectedKw));
  const useDensity = data.some((f) => f.grossM2 > 0);
  return (
    <>
      <div className="bi-density">
        <div className="bi-chart" role="img" aria-label="Load per floor">
          {[...data].reverse().map((f) => {
            const v = useDensity ? (f.grossM2 ? (f.connectedKw * 1000) / f.grossM2 : 0) : f.connectedKw;
            const top = useDensity ? Math.max(...data.map((x) => (x.grossM2 ? (x.connectedKw * 1000) / x.grossM2 : 0)), 1) : max;
            return (
              <div key={f.floor.tag} className="bi-bar-row" title={`${f.floor.name}: ${f1(f.connectedKw)} kW connected, ${f1(f.demandKw)} kW demand${f.grossM2 ? `, ${f1((f.connectedKw * 1000) / f.grossM2)} W/m²` : ''}`}>
                <span className="bi-bar-lbl">{f.floor.tag}</span>
                <span className="bi-bar-track"><span className="bi-bar-fill" style={{ width: `${Math.max(1, (v / top) * 100)}%` }} /><span className="bi-bar-dem" style={{ width: `${Math.max(0, (useDensity ? (f.grossM2 ? (f.demandKw * 1000) / f.grossM2 : 0) : f.demandKw) / top * 100)}%` }} /></span>
                <span className="bi-bar-val">{useDensity ? `${f1(v)} W/m²` : `${f1(v)} kW`}</span>
              </div>
            );
          })}
          <p className="m">{useDensity ? 'Connected W/m² of each floor’s gross area (darker: demand).' : 'Connected kW per floor (enter the gross area per floor for W/m²).'}</p>
        </div>
        <div className="bi-density-side">
          <div className="bi-kpis">
            <span>Rooms checked <b>{rooms.length}</b></span>
            <span className={flagged.length ? 'warn' : 'ok'}>{flagged.length ? `⚠ ${flagged.length} outside the benchmark` : '✓ all within the benchmarks'}</span>
          </div>
          {units.length > 0 && (
            <table className="bi-table compact">
              <thead><tr><th>Flat</th><th>DB</th><th>Meter</th><th>kW</th></tr></thead>
              <tbody>{units.slice(0, 12).map((u) => <tr key={u.db}><td>{u.unit} <span className="m">{u.type}</span></td><td>{u.db}</td><td>{u.meter ?? '—'}</td><td>{f1(u.connectedKw)}</td></tr>)}</tbody>
            </table>
          )}
          {units.length > 12 && <p className="m">+ {units.length - 12} more flats · meters: {Object.entries(units.reduce<Record<string, number>>((a, u) => { if (u.meter) a[u.meter] = (a[u.meter] ?? 0) + 1; return a; }, {})).map(([m, n]) => `${n} × ${m}`).join(', ')}</p>}
        </div>
      </div>
      {rooms.length > 0 && (
        <>
          <div className="bi-actions"><b>Rooms</b><label className="row"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show all ({rooms.length})</label></div>
          {shownRooms.length > 0 && (
            <table className="bi-table">
              <thead><tr><th>Room</th><th>Floor</th><th>DB</th><th>Area</th><th>Lighting W/m²</th><th>LPD max</th><th>Power W</th><th>A/C W</th><th>Total W/m²</th><th>Type W/m²</th><th>Check</th></tr></thead>
              <tbody>
                {shownRooms.slice(0, 80).map((r) => (
                  <tr key={r.key}>
                    <td>{r.name}</td><td>{r.floor}</td><td>{r.db}</td><td>{f0(r.areaM2)} m²</td>
                    <td className={r.lpdMax && r.lpd > r.lpdMax ? 'warn' : ''}>{f1(r.lpd)}</td><td className="m">{r.lpdMax ?? '—'}</td>
                    <td>{f0(r.powerW)}</td><td>{f0(r.acW)}</td><td>{f1(r.wPerM2)}</td><td className="m">{r.expectedWPerM2 ?? '—'}</td>
                    <td className={r.status}>{r.note ?? 'OK'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="m">Lighting against the room type's LPD limit (e.g. ASHRAE 90.1); total against the room type's W/m² (½× to 1½×). Benchmarks are placeholders — set yours in Room types.</p>
        </>
      )}
    </>
  );
}
