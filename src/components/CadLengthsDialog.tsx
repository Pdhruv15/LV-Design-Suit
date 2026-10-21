import { useState } from 'react';
import { autoRoutes } from '../model/cadAutoLink';
import { applyCadLengths, CAD_LENGTH_DEFAULTS, lengthBreakdown, pullCadLengths, type CadRoute } from '../model/cadLengths';
import type { CadPlan } from '../model/cadPlaces';
import { withLayerMap } from '../model/cadRooms';
import type { CadLayerMap, CadLayerRole, CadLengthSettings, Feeder, Project } from '../types';
import CadLayerTable from './CadLayerTable';
import { readPlanWithCurves } from './cadPlanRead';

const feederLabel = (f: Feeder) => (f.feedsBoardId ? `${f.boardId} → ${f.feedsBoardId}` : `${f.boardId} ${f.phase && f.way ? `${f.phase}${f.way}` : ''} ${f.name}`.replace(/\s+/g, ' ').trim());
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : undefined; };

/** Cable lengths from a CAD floor plan: routes on the cable route layers are linked to their feeders by the boards
 * and fixtures their ends touch, and any route can be linked by hand (selected curves in OpenCADStudio). A pull
 * measures the routes, adds the allowances and shows the lengths beside the design. Nothing changes until the
 * engineer applies. */
export default function CadLengthsDialog({ project, onApply, onClose }: {
  project: Project;
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const cad = window.lvds?.openCadStudio;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [feederId, setFeederId] = useState('');
  const [read, setRead] = useState<{ units?: number; routes: CadRoute[] } | null>(null);
  const [plan, setPlan] = useState<CadPlan | null>(null);
  const [roles, setRoles] = useState<CadLayerMap[]>([]);
  const [settings, setSettings] = useState<CadLengthSettings>(project.cadLength ?? {});
  const [vertical, setVertical] = useState<Record<string, number | undefined>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const s = { ...CAD_LENGTH_DEFAULTS, ...settings };
  const working: Project = {
    ...project,
    cadLength: settings,
    feeders: project.feeders.map((f) => (f.id in vertical ? { ...f, cadVerticalM: vertical[f.id] } : f))
  };
  // Routes linked by hand, plus routes on the route layers linked by what their ends touch.
  const auto = plan ? autoRoutes(project, plan, roles) : null;
  const handLinked = new Set(read?.routes.map((r) => r.feederId));
  const autoIds = new Set((auto?.routes ?? []).filter((r) => !handLinked.has(r.feederId)).map((r) => r.feederId));
  const routes: CadRoute[] = read ? [...read.routes, ...(auto?.routes ?? []).filter((r) => autoIds.has(r.feederId)).map((r) => ({ feederId: r.feederId, length: r.length, pieces: r.pieces.length }))] : [];
  const pull = read ? pullCadLengths(working, routes, read.units ?? plan?.units) : null;
  const routeLayers = roles.filter((m) => m.role === 'route').length;
  const feeders = [...project.feeders].filter((f) => !f.generation).sort((a, b) => feederLabel(a).localeCompare(feederLabel(b)));

  async function act(kind: string, run: () => Promise<void>) {
    setBusy(kind);
    setNote('');
    try { await run(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const openPlan = () => act('open', async () => {
    const r = await cad!.openPlan!();
    if (r) { setNote(`Opened ${r.file} in OpenCADStudio. Routes on the cable route layers link themselves; select any other route there and link it here.`); setRead(null); setPlan(null); }
  });
  const link = (id: string) => act(id ? 'link' : 'unlink', async () => {
    const r = await cad!.linkSelection!(id);
    const what = id ? `Linked ${r.linked} object${r.linked === 1 ? '' : 's'} to ${feederLabel(project.feeders.find((f) => f.id === id)!)}` : `Unlinked ${r.linked} object${r.linked === 1 ? '' : 's'}`;
    setNote(`${what}${r.skipped ? ` (${r.skipped} skipped: only lines, arcs and polylines are routes)` : ''}.`);
    if (read) setRead(await cad!.routes!());
  });
  const measure = () => act('pull', async () => {
    const [hand, withCurves] = await Promise.all([cad!.routes!(), readPlanWithCurves(cad!, project, roles)]);
    setRead(hand); setPlan(withCurves.plan); setRoles(withCurves.roles); setSkip(new Set());
  });
  const setRole = (layer: string, role: CadLayerRole) => { setRoles((m) => m.map((x) => (x.layer === layer ? { ...x, role } : x))); setNote('Pull again to read the routes on the layers as now marked.'); };

  function apply() {
    if (!pull) return;
    const accepted = pull.proposals.filter((x) => !skip.has(x.feederId));
    const changedSettings = JSON.stringify(settings) !== JSON.stringify(project.cadLength ?? {});
    const withSettings = { ...working, ...(changedSettings ? { cadLength: Object.keys(settings).length ? settings : undefined } : { cadLength: project.cadLength }) };
    const base = roles.length ? withLayerMap(withSettings, roles) : withSettings;
    onApply(applyCadLengths(base, accepted), accepted.length
      ? `Cable lengths from CAD: ${accepted.length} feeder${accepted.length === 1 ? '' : 's'} updated — run the calculations to check voltage drop`
      : 'Cable lengths from CAD: allowances saved, no lengths changed');
  }

  if (!cad?.routes || !cad.linkSelection || !cad.openPlan) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Cable lengths from CAD floor plan</h3>
          <p className="m">Measuring cable routes needs the LV Design Studio desktop app and OpenCADStudio.</p>
          <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
        </div>
      </div>
    );
  }

  const setting = (k: 'verticalM' | 'terminationM' | 'wastePct', v: string) => setSettings((x) => ({ ...x, [k]: num(v) }));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cad-lengths" onClick={(e) => e.stopPropagation()}>
        <h3>Cable lengths from CAD floor plan</h3>
        <p className="m">
          Cable routes on the layers marked <b>Cable route</b> link themselves: a route from one board to another is the
          feeder between them, a route from a board to a light or socket is that fixture’s circuit (its CCT attribute).
          Any other route can be linked by hand: select it in OpenCADStudio, choose the feeder here and press Link
          selection. Pull lengths measures the routes and adds the allowances. Nothing changes until you apply.
        </p>
        <div className="modal-actions">
          <button className="chip" disabled={!!busy} onClick={openPlan}>{busy === 'open' ? 'Opening…' : 'Open floor plan…'}</button>
          <span className="sp" />
          <select aria-label="Feeder to link" value={feederId} onChange={(e) => setFeederId(e.target.value)}>
            <option value="">Choose a feeder…</option>
            {feeders.map((f) => <option key={f.id} value={f.id}>{feederLabel(f)}</option>)}
          </select>
          <button className="chip" disabled={!!busy || !feederId} onClick={() => link(feederId)}>{busy === 'link' ? 'Linking…' : 'Link selection'}</button>
          <button className="chip" disabled={!!busy} onClick={() => link('')} title="Remove the route link from the objects selected in OpenCADStudio">Unlink selection</button>
        </div>

        <div className="ce-grid">
          <label>Vertical per run (m)<input inputMode="decimal" value={settings.verticalM ?? ''} placeholder={String(CAD_LENGTH_DEFAULTS.verticalM)} onChange={(e) => setting('verticalM', e.target.value)} /></label>
          <label>Terminations, both ends (m)<input inputMode="decimal" value={settings.terminationM ?? ''} placeholder={String(CAD_LENGTH_DEFAULTS.terminationM)} onChange={(e) => setting('terminationM', e.target.value)} /></label>
          <label>Waste (%)<input inputMode="decimal" value={settings.wastePct ?? ''} placeholder={String(CAD_LENGTH_DEFAULTS.wastePct)} onChange={(e) => setting('wastePct', e.target.value)} /></label>
          <label>Units if the drawing has none
            <select value={s.units} onChange={(e) => setSettings((x) => ({ ...x, units: e.target.value as CadLengthSettings['units'] }))}>
              <option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <span className="sp" />
          <button className="chip primary" disabled={!!busy} onClick={measure}>{busy === 'pull' ? 'Measuring…' : read ? 'Pull again' : 'Pull lengths'}</button>
        </div>
        {note && <p className="m">{note}</p>}

        {pull && (
          <>
            <details>
              <summary className="m">Layers — {routeLayers ? `${routeLayers} cable route layer${routeLayers === 1 ? '' : 's'}` : 'mark the layer with the cable routes as Cable route to link them automatically'}</summary>
              <CadLayerTable layers={plan?.layers ?? []} roles={roles} onChange={setRole} />
            </details>
            <p className="m">{read!.routes.length} linked by hand · {autoIds.size} linked from the route layers · {pull.units} · {pull.proposals.length} differ · {pull.matching} already match</p>
            {pull.proposals.length > 0 && (
              <table className="bi-table compact">
                <thead><tr><th /><th>Feeder</th><th>Now (m)</th><th>From CAD</th><th>Vertical (m)</th></tr></thead>
                <tbody>
                  {pull.proposals.map((x) => (
                    <tr key={x.feederId}>
                      <td><input type="checkbox" aria-label={`Accept ${x.label}`} checked={!skip.has(x.feederId)} onChange={(e) => setSkip((k) => { const n = new Set(k); if (e.target.checked) n.delete(x.feederId); else n.add(x.feederId); return n; })} /></td>
                      <td>{x.label}{autoIds.has(x.feederId) && <span className="m" title="Linked from the route layer by the boards / fixture its ends touch"> · auto</span>}</td>
                      <td>{x.currentM}</td>
                      <td title={`${x.pieces} linked object${x.pieces === 1 ? '' : 's'}`}>{lengthBreakdown(x)}</td>
                      <td><input aria-label={`Vertical allowance for ${x.label}`} inputMode="decimal" style={{ width: '4.5em' }} value={vertical[x.feederId] ?? project.feeders.find((f) => f.id === x.feederId)?.cadVerticalM ?? ''} placeholder={String(s.verticalM)} onChange={(e) => setVertical((v) => ({ ...v, [x.feederId]: num(e.target.value) }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pull.unknownFeeders.length > 0 && <p className="m">Routes linked to feeders no longer in the design (ignored): {pull.unknownFeeders.join(', ')}</p>}
            {(auto?.unmatched.length ?? 0) > 0 && (
              <p className="m">Not linked — link by hand: {auto!.unmatched.map((u) => `${u.lengthM} m on ${u.layer} (${u.reason})`).join('; ')}</p>
            )}
          </>
        )}

        <div className="modal-actions">
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!pull || !!busy} onClick={apply}>
            Apply {pull ? pull.proposals.filter((x) => !skip.has(x.feederId)).length : 0} lengths
          </button>
        </div>
      </div>
    </div>
  );
}
