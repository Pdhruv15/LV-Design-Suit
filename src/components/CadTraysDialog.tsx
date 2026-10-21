import { useState } from 'react';
import { trayPlanOf } from '../calc/cableTray';
import { autoRoutes, autoTrays } from '../model/cadAutoLink';
import type { CadPlan } from '../model/cadPlaces';
import { withLayerMap } from '../model/cadRooms';
import { applyCadTrays, pullCadTrays, TRAY_MIN_RUN_M, TRAY_TOLERANCE_M, type CadTrayPlan } from '../model/cadTrays';
import type { CadLayerMap, CadLayerRole, Project } from '../types';
import CadLayerTable from './CadLayerTable';
import { readPlanWithCurves } from './cadPlanRead';

/** Tray routes from a CAD floor plan: tray runs on the tray layers are named from their labels ("TRAY A"), and any
 * run can be linked to a tray route by hand; each feeder's cable route (linked by hand, or from the route layers by
 * what its ends touch) then says which trays it runs along, in order, and the runs give each tray route's length.
 * Shown beside the design and applied on accept. */
export default function CadTraysDialog({ project, onApply, onClose }: {
  project: Project;
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const cad = window.lvds?.openCadStudio;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [hand, setHand] = useState<CadTrayPlan | null>(null);
  const [drawing, setDrawing] = useState<CadPlan | null>(null);
  const [roles, setRoles] = useState<CadLayerMap[]>([]);
  const [skipF, setSkipF] = useState<Set<string>>(new Set());
  const [skipL, setSkipL] = useState<Set<string>>(new Set());
  // Runs and routes linked by hand, plus those found on the tray and route layers.
  const auto = drawing ? { trays: autoTrays(project, drawing, roles), routes: autoRoutes(project, drawing, roles) } : null;
  const handRoutes = new Set(hand?.routes.map((r) => r.feederId));
  const plan: CadTrayPlan | null = hand ? {
    units: hand.units ?? drawing?.units,
    trays: [...hand.trays, ...(auto?.trays ?? [])],
    routes: [...hand.routes, ...(auto?.routes.routes ?? []).filter((r) => !handRoutes.has(r.feederId)).flatMap((r) => r.pieces.map((points) => ({ feederId: r.feederId, points })))]
  } : null;
  const pull = plan ? pullCadTrays(project, plan) : null;
  const marked = (role: CadLayerRole) => roles.filter((m) => m.role === role).length;
  const known = trayPlanOf(project).routes.map((r) => r.name);

  async function act(kind: string, run: () => Promise<void>) {
    setBusy(kind);
    setNote('');
    try { await run(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const openPlan = () => act('open', async () => {
    const r = await cad!.openPlan!();
    if (r) { setNote(`Opened ${r.file} in OpenCADStudio. Mark its tray layers below, or select a tray run there, name it here and link it.`); setHand(null); setDrawing(null); }
  });
  const link = (route: string) => act(route ? 'link' : 'unlink', async () => {
    const r = await cad!.traySelection!(route);
    setNote(`${route ? `Linked ${r.linked} object${r.linked === 1 ? '' : 's'} to tray route ${route.toUpperCase()}` : `Unlinked ${r.linked} object${r.linked === 1 ? '' : 's'}`}${r.skipped ? ` (${r.skipped} skipped: only lines, arcs and polylines are tray runs)` : ''}.`);
    if (hand) setHand(await cad!.trays!());
  });
  const read = () => act('pull', async () => {
    const [h, withCurves] = await Promise.all([cad!.trays!(), readPlanWithCurves(cad!, project, roles)]);
    setHand(h); setDrawing(withCurves.plan); setRoles(withCurves.roles); setSkipF(new Set()); setSkipL(new Set());
  });
  const setRole = (layer: string, role: CadLayerRole) => { setRoles((m) => m.map((x) => (x.layer === layer ? { ...x, role } : x))); setNote('Pull again to read the trays and routes on the layers as now marked.'); };
  const toggle = (set: (f: (s: Set<string>) => Set<string>) => void, key: string, on: boolean) => set((s) => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n; });

  function apply() {
    if (!pull) return;
    const feeders = pull.feeders.filter((x) => !skipF.has(x.feederId));
    const lengths = pull.lengths.filter((x) => !skipL.has(x.name));
    const parts = [feeders.length ? `${feeders.length} feeder tray route${feeders.length === 1 ? '' : 's'}` : '', lengths.length ? `${lengths.length} tray length${lengths.length === 1 ? '' : 's'}` : ''].filter(Boolean);
    onApply(applyCadTrays(roles.length ? withLayerMap(project, roles) : project, feeders, lengths), parts.length ? `Tray routes from CAD: updated ${parts.join(' and ')}` : 'Tray routes from CAD: nothing changed');
  }

  if (!cad?.trays || !cad.traySelection || !cad.openPlan) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Tray routes from CAD floor plan</h3>
          <p className="m">Reading a floor plan needs the LV Design Studio desktop app and OpenCADStudio.</p>
          <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
        </div>
      </div>
    );
  }

  const count = pull ? pull.feeders.filter((x) => !skipF.has(x.feederId)).length + pull.lengths.filter((x) => !skipL.has(x.name)).length : 0;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cad-trays" onClick={(e) => e.stopPropagation()}>
        <h3>Tray routes from CAD floor plan</h3>
        <p className="m">
          Tray runs on the layers marked <b>Cable tray</b> are found and named by their labels (TRAY A, CT-2…); runs joined
          to a named run take its name, the rest are T1, T2…. Any run can also be named by hand: select it in
          OpenCADStudio, type its tray route and press Link selection. A feeder is on a tray where its cable route runs
          within {TRAY_TOLERANCE_M} m of the tray for more than {TRAY_MIN_RUN_M} m; the trays are listed in order from its
          board. Nothing changes until you apply.
        </p>
        <div className="modal-actions">
          <button className="chip" disabled={!!busy} onClick={openPlan}>{busy === 'open' ? 'Opening…' : 'Open floor plan…'}</button>
          <span className="sp" />
          <input aria-label="Tray route name" list="cad-tray-names" placeholder="Tray route, e.g. A" style={{ width: '9em' }} value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
          <datalist id="cad-tray-names">{known.map((n) => <option key={n} value={n} />)}</datalist>
          <button className="chip" disabled={!!busy || !name.trim()} onClick={() => link(name.trim())}>{busy === 'link' ? 'Linking…' : 'Link selection'}</button>
          <button className="chip" disabled={!!busy} onClick={() => link('')} title="Remove the tray link from the objects selected in OpenCADStudio">Unlink selection</button>
        </div>
        <div className="modal-actions">
          <span className="sp" />
          <button className="chip primary" disabled={!!busy} onClick={read}>{busy === 'pull' ? 'Reading…' : plan ? 'Pull again' : 'Pull tray routes'}</button>
        </div>
        {note && <p className="m">{note}</p>}

        {pull && (
          <>
            <details>
              <summary className="m">Layers — {marked('tray')} tray layer{marked('tray') === 1 ? '' : 's'}, {marked('route')} cable route layer{marked('route') === 1 ? '' : 's'}{!marked('tray') && ': mark the tray layer as Cable tray to find the runs automatically'}</summary>
              <CadLayerTable layers={drawing?.layers ?? []} roles={roles} onChange={setRole} onApplyMap={(m) => { setRoles(m); setNote('Pull again to read the trays and routes on the layers as now marked.'); }} />
            </details>
            <p className="m">{plan!.trays.length} tray run{plan!.trays.length === 1 ? '' : 's'} ({auto?.trays.length ?? 0} from the tray layers) · {plan!.routes.length} cable route piece{plan!.routes.length === 1 ? '' : 's'} · {pull.units} · {pull.matching} feeder{pull.matching === 1 ? '' : 's'} already match</p>
            {pull.feeders.length > 0 && (
              <table className="bi-table compact">
                <thead><tr><th /><th>Feeder</th><th>Tray route now</th><th>From CAD</th></tr></thead>
                <tbody>
                  {pull.feeders.map((x) => (
                    <tr key={x.feederId}>
                      <td><input type="checkbox" aria-label={`Accept ${x.label}`} checked={!skipF.has(x.feederId)} onChange={(e) => toggle(setSkipF, x.feederId, e.target.checked)} /></td>
                      <td>{x.label}</td>
                      <td>{x.current || '—'}</td>
                      <td title={x.runs.map((r) => `${r.name}: ${r.m} m`).join(', ')}>{x.proposed || <i>on no tray</i>}{x.runs.length > 0 && <span className="m"> ({x.runs.map((r) => `${r.name} ${r.m} m`).join(', ')})</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pull.lengths.length > 0 && (
              <table className="bi-table compact">
                <thead><tr><th /><th>Tray route</th><th>Length now (m)</th><th>From CAD (m)</th></tr></thead>
                <tbody>
                  {pull.lengths.map((x) => (
                    <tr key={x.name}>
                      <td><input type="checkbox" aria-label={`Accept tray ${x.name}`} checked={!skipL.has(x.name)} onChange={(e) => toggle(setSkipL, x.name, e.target.checked)} /></td>
                      <td>{x.name}{x.isNew && <span className="m"> (new)</span>}</td>
                      <td>{x.currentM ?? '—'}</td>
                      <td>{x.proposedM}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pull.unknownFeeders.length > 0 && <p className="m">Cable routes linked to feeders no longer in the design (ignored): {pull.unknownFeeders.join(', ')}</p>}
            {(auto?.routes.unmatched.length ?? 0) > 0 && <p className="m">Cable routes not linked (link them in Cable lengths from CAD floor plan): {auto!.routes.unmatched.map((u) => `${u.lengthM} m on ${u.layer} (${u.reason})`).join('; ')}</p>}
          </>
        )}

        <div className="modal-actions">
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!pull || !!busy} onClick={apply}>Apply {count} change{count === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  );
}
