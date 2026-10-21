import { useState } from 'react';
import { buildingInfoOf, roomTypesOf } from '../calc/building';
import { applyRooms, LAYER_ROLES, layerMapFor, proposeRooms, roomsFromPlan } from '../model/cadRooms';
import type { CadPlan } from '../model/cadPlaces';
import { floorLabel, floorList } from '../model/levels';
import type { CadLayerMap, CadLayerRole, Project } from '../types';

const holds = (l: NonNullable<CadPlan['layers']>[number]) => [
  l.outlines && `${l.outlines} outline${l.outlines === 1 ? '' : 's'}`, l.hatches && `${l.hatches} hatch${l.hatches === 1 ? '' : 'es'}`,
  l.curves && `${l.curves} line${l.curves === 1 ? '' : 's'}`, l.texts && `${l.texts} text${l.texts === 1 ? '' : 's'}`, l.blocks && `${l.blocks} block${l.blocks === 1 ? '' : 's'}`
].filter(Boolean).join(' · ');

/** Rooms and areas from an architect's floor plan: the engineer says what each layer is (room outline, room name…),
 * then each closed outline on a room layer becomes a room with its area and the name inside it, for the chosen
 * level of Building information. Nothing changes until the engineer applies. */
export default function CadRoomsDialog({ project, onApply, onClose }: {
  project: Project;
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const cad = window.lvds?.openCadStudio;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState<CadPlan | null>(null);
  const [roles, setRoles] = useState<CadLayerMap[]>([]);
  const floors = floorList(project.building).filter((f) => !f.ref.index); // one entry per level, not per typical floor
  const [levelKey, setLevelKey] = useState(floors[0]?.key ?? '');
  const [names, setNames] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const info = buildingInfoOf(project);
  const roomTypes = roomTypesOf(info);
  const floor = floors.find((f) => f.key === levelKey);
  const read = plan ? roomsFromPlan(plan, roles, project.cadLength) : null;
  const review = read && floor ? proposeRooms(project, read.rooms, floor.ref.building, floor.ref.level) : null;
  const rows = (review?.proposals ?? []).map((r) => ({ ...r, name: names[r.key] ?? r.name, type: types[r.key] ?? r.type }));
  const changing = rows.filter((r) => r.status !== 'same');
  const accepted = changing.filter((r) => !skip.has(r.key));

  async function act(kind: string, run: () => Promise<void>) {
    setBusy(kind);
    setNote('');
    try { await run(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const openPlan = () => act('open', async () => {
    const r = await cad!.openPlan!();
    if (r) { setNote(`Opened ${r.file} in OpenCADStudio. Read the plan when it is ready.`); setPlan(null); }
  });
  const readPlan = () => act('read', async () => {
    const p = await cad!.plan!();
    setPlan(p);
    setRoles(layerMapFor(project, p.layers ?? []));
    setNames({}); setTypes({}); setSkip(new Set());
  });
  const setRole = (layer: string, role: CadLayerRole) => setRoles((m) => m.map((x) => (x.layer === layer ? { ...x, role } : x)));

  function apply() {
    if (!floor) return;
    const next = applyRooms(project, accepted, floor.ref.building, floor.ref.level, roles);
    onApply(next, accepted.length ? `Rooms from CAD: ${accepted.length} room${accepted.length === 1 ? '' : 's'} on ${floorLabel(project.building, floor)} updated` : 'Rooms from CAD: layer mapping saved, no rooms changed');
  }

  if (!cad?.plan || !cad.openPlan) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Rooms and areas from CAD floor plan</h3>
          <p className="m">Reading a floor plan needs the LV Design Studio desktop app and OpenCADStudio.</p>
          <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cad-rooms" onClick={(e) => e.stopPropagation()}>
        <h3>Rooms and areas from CAD floor plan</h3>
        <p className="m">
          Say what each layer of the plan is. Every closed outline or hatch on a <b>room outline</b> layer becomes a room:
          its area is measured, and its name comes from a room tag block or the <b>room name</b> text inside it. An outline
          around other rooms (a flat, a wing) is left out. Nothing changes until you apply.
        </p>
        <div className="modal-actions">
          <button className="chip" disabled={!!busy} onClick={openPlan}>{busy === 'open' ? 'Opening…' : 'Open floor plan…'}</button>
          <span className="sp" />
          <button className="chip primary" disabled={!!busy} onClick={readPlan}>{busy === 'read' ? 'Reading…' : plan ? 'Read again' : 'Read plan'}</button>
        </div>
        {note && <p className="m">{note}</p>}

        {plan && (
          <>
            <h4>Layers</h4>
            <table className="bi-table compact">
              <thead><tr><th>Layer</th><th>Holds</th><th>Is</th></tr></thead>
              <tbody>
                {(plan.layers ?? []).map((l) => (
                  <tr key={l.name}>
                    <td>{l.name}</td>
                    <td>{holds(l) || '—'}</td>
                    <td>
                      <select aria-label={`Layer ${l.name} is`} value={roles.find((m) => m.layer === l.name)?.role ?? 'ignore'} onChange={(e) => setRole(l.name, e.target.value as CadLayerRole)}>
                        {LAYER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!floors.length ? (
              <p className="m">Add the building and its levels in Building information first; rooms are kept per level.</p>
            ) : (
              <div className="ce-grid">
                <label>This plan shows
                  <select aria-label="Level of this plan" value={levelKey} onChange={(e) => setLevelKey(e.target.value)}>
                    {floors.map((f) => <option key={f.key} value={f.key}>{floorLabel(project.building, f)}</option>)}
                  </select>
                </label>
              </div>
            )}

            {read && (
              <p className="m">
                {read.rooms.length} room{read.rooms.length === 1 ? '' : 's'} · {read.units}
                {read.zones ? ` · ${read.zones} outline${read.zones === 1 ? '' : 's'} around other rooms left out` : ''}
                {review ? ` · ${changing.length} to add or update · ${rows.length - changing.length} already match` : ''}
                {!read.rooms.length && ' — mark the layer with the room outlines as Room outline.'}
              </p>
            )}
            {changing.length > 0 && (
              <table className="bi-table compact">
                <thead><tr><th /><th>Room</th><th>No.</th><th>Area (m²)</th><th>Now</th><th>Room type</th></tr></thead>
                <tbody>
                  {changing.map((r) => (
                    <tr key={r.key}>
                      <td><input type="checkbox" aria-label={`Accept ${r.name}`} checked={!skip.has(r.key)} onChange={(e) => setSkip((k) => { const n = new Set(k); if (e.target.checked) n.delete(r.key); else n.add(r.key); return n; })} /></td>
                      <td><input aria-label={`Name of ${r.name}`} value={r.name} disabled={!!r.existingId} onChange={(e) => setNames((x) => ({ ...x, [r.key]: e.target.value }))} /></td>
                      <td>{r.number ?? ''}</td>
                      <td>{r.areaM2}</td>
                      <td>{r.status === 'new' ? <i>new</i> : r.currentAreaM2}</td>
                      <td>
                        <select aria-label={`Room type of ${r.name}`} value={r.type ?? ''} onChange={(e) => setTypes((x) => ({ ...x, [r.key]: e.target.value }))}>
                          <option value="">Choose…</option>
                          {roomTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {review && review.notOnPlan.length > 0 && <p className="m">On this level but not on the plan (kept): {review.notOnPlan.map((r) => r.name).join(', ')}</p>}
            {accepted.some((r) => !r.type) && <p className="m">Rooms without a room type take {roomTypes[0]?.label ?? 'the first type'}.</p>}
          </>
        )}

        <div className="modal-actions">
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!plan || !floor || !!busy} onClick={apply}>Apply {accepted.length} room{accepted.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  );
}
