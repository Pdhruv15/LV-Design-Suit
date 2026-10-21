import { useState } from 'react';
import { trayPlanOf } from '../calc/cableTray';
import { applyCadTrays, pullCadTrays, TRAY_MIN_RUN_M, TRAY_TOLERANCE_M, type CadTrayPlan } from '../model/cadTrays';
import type { Project } from '../types';

/** Tray routes from a CAD floor plan: tray runs are linked to a tray route by name (A, B…); each feeder's linked
 * cable route then says which trays it runs along, in order, and the runs give each tray route's length. Shown
 * beside the design and applied on accept. */
export default function CadTraysDialog({ project, onApply, onClose }: {
  project: Project;
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const cad = window.lvds?.openCadStudio;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<CadTrayPlan | null>(null);
  const [skipF, setSkipF] = useState<Set<string>>(new Set());
  const [skipL, setSkipL] = useState<Set<string>>(new Set());
  const pull = plan ? pullCadTrays(project, plan) : null;
  const known = trayPlanOf(project).routes.map((r) => r.name);

  async function act(kind: string, run: () => Promise<void>) {
    setBusy(kind);
    setNote('');
    try { await run(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const openPlan = () => act('open', async () => {
    const r = await cad!.openPlan!();
    if (r) { setNote(`Opened ${r.file} in OpenCADStudio. Select a tray run there, name its route here and link it.`); setPlan(null); }
  });
  const link = (route: string) => act(route ? 'link' : 'unlink', async () => {
    const r = await cad!.traySelection!(route);
    setNote(`${route ? `Linked ${r.linked} object${r.linked === 1 ? '' : 's'} to tray route ${route.toUpperCase()}` : `Unlinked ${r.linked} object${r.linked === 1 ? '' : 's'}`}${r.skipped ? ` (${r.skipped} skipped: only lines, arcs and polylines are tray runs)` : ''}.`);
    if (plan) setPlan(await cad!.trays!());
  });
  const read = () => act('pull', async () => { setPlan(await cad!.trays!()); setSkipF(new Set()); setSkipL(new Set()); });
  const toggle = (set: (f: (s: Set<string>) => Set<string>) => void, key: string, on: boolean) => set((s) => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n; });

  function apply() {
    if (!pull) return;
    const feeders = pull.feeders.filter((x) => !skipF.has(x.feederId));
    const lengths = pull.lengths.filter((x) => !skipL.has(x.name));
    const parts = [feeders.length ? `${feeders.length} feeder tray route${feeders.length === 1 ? '' : 's'}` : '', lengths.length ? `${lengths.length} tray length${lengths.length === 1 ? '' : 's'}` : ''].filter(Boolean);
    onApply(applyCadTrays(project, feeders, lengths), parts.length ? `Tray routes from CAD: updated ${parts.join(' and ')}` : 'Tray routes from CAD: nothing changed');
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
          Link each tray run once: select its lines or polylines in OpenCADStudio, type its tray route (A, B…) and press
          Link selection. A feeder is on a tray where its linked cable route runs within {TRAY_TOLERANCE_M} m of the tray
          for more than {TRAY_MIN_RUN_M} m; the trays are listed in order from its board. Link the cable routes in Cable
          lengths from CAD floor plan. Nothing changes until you apply.
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
            <p className="m">{plan!.trays.length} tray run{plan!.trays.length === 1 ? '' : 's'} · {plan!.routes.length} cable route piece{plan!.routes.length === 1 ? '' : 's'} · {pull.units} · {pull.matching} feeder{pull.matching === 1 ? '' : 's'} already match</p>
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
