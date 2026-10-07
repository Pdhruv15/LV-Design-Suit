import { STATUS_TEXT } from '../../calc/statusText';
import { useMemo, useRef, useState } from 'react';
import type { Feeder, Project, TrayCable, TrayMethod, TrayPlan, TrayRoute, TraySettings, TraySpacing } from '../../types';
import {
  addFeedersToRoute, deleteRoute, newTrayId, nextRouteName, odsOf, onRoute as isOnRoute, panelCables, removeFeederFromRoute,
  renameRoute, routeSettings, sizeAll, SPACING_LABEL, TRAY_DEPTHS, trayFeeders, trayPlanOf, trayQuantities, unroutedFeeders, type TrayResult
} from '../../calc/cableTray';
import { boardsInSupplyOrder } from '../../calc/summary';
import { brandOf, CABLE_BRANDS, DEFAULT_CABLE_BRAND } from '../../data/cableBrands';
import { applyOdEdits, applyRoutingEdits, buildOdSheet, buildRoutingSheet } from '../../docs/traySheet';
import { lineNumbers, traySectionSvg } from '../../docs/traySection';
import { buildTrayWorkbook } from '../../docs/trayWorkbook';
import { buildTrayReportHtml } from '../../docs/trayReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { saveBinary, savePdf, safeFileName } from '../../util/files';
import ClassicGrid from '../grid/ClassicGrid';
import { Page } from '../ui';
import ContainmentCalculator from './ContainmentCalculator';

const f0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const SPACINGS = Object.keys(SPACING_LABEL) as TraySpacing[];
const ARRANGEMENT = { touching: 'touching', spaced: 'spaced ≥ 1 D', bunched: 'bunched' };

/** Number box that commits on Enter / leaving; blank = undefined (default). */
function Num({ value, placeholder, onSet, width = 70, title }: { value?: number; placeholder?: string; onSet: (v: number | undefined) => void; width?: number; title?: string }) {
  const commit = (t: string) => {
    const s = t.trim().replace(',', '.');
    if (s === '') return value !== undefined && onSet(undefined);
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0 && n !== value) onSet(n);
  };
  return (
    <input
      key={`${value ?? ''}`}
      className="tray-num"
      style={{ width }}
      inputMode="decimal"
      title={title}
      defaultValue={value ?? ''}
      placeholder={placeholder}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

const trayText = (r: TrayResult) => `${r.tiers > 1 ? `${r.tiers} × ` : ''}${r.widthMm} × ${r.depthMm}`;

/** Cable tray schedule: each SLD cable gets a route path (A-B-C) once and
 * appears on every route along it; routes are sized from the cables'
 * diameters, spacing and spare, drawn in cross-section, and give the
 * grouping factor back to the cable ratings. */
/** Cable tray page: the design's routes, or a custom calculation. */
export default function TrayScheduleView(props: { project: Project; onChange: (p: Project, step?: boolean) => void; onStatus: (m: string) => void }) {
  const [mode, setMode] = useState<'design' | 'calc'>(() => (props.project.feeders.length ? 'design' : 'calc'));
  const modeSwitch = <div className="seg">{([['design', 'From the design'], ['calc', 'Custom calculation']] as const).map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div>;
  if (mode === 'calc') {
    return (
      <Page title="Cable containment" intro="A custom calculation, no design needed: list the cables (size and cores, or the diameter) and choose the containment — tray, ladder, basket, trunking, conduit, or buried in a trench or duct bank." actions={modeSwitch}>
        <ContainmentCalculator project={props.project} onChange={(p) => props.onChange(p, true)} onStatus={props.onStatus} />
      </Page>
    );
  }
  return <TrayDesignView {...props} modeSwitch={modeSwitch} />;
}

function TrayDesignView({ project, onChange, onStatus, modeSwitch }: {
  project: Project;
  onChange: (p: Project, step?: boolean) => void;
  onStatus: (m: string) => void;
  modeSwitch: React.ReactNode;
}) {
  const plan = useMemo(() => trayPlanOf(project), [project]);
  const s = plan.settings;
  const setPlan = (next: TrayPlan, step = false) => onChange({ ...project, trays: next }, step);
  const setSettings = (patch: Partial<TraySettings>) => setPlan({ ...plan, settings: { ...s, ...patch } });
  const setRoute = (id: string, patch: Partial<TrayRoute>, step = false) =>
    setPlan({ ...plan, routes: plan.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, step);
  const results = useMemo(() => sizeAll(project, plan), [project, plan]);
  const quantities = useMemo(() => trayQuantities(results, s), [results, s]);
  const [showOds, setShowOds] = useState(false);
  const odSheet = useMemo(() => buildOdSheet(odsOf(plan)), [plan]);
  const boards = boardsInSupplyOrder(project);
  const [busy, setBusy] = useState(false);
  const [withFinal, setWithFinal] = useState(false);
  const [onlyUnrouted, setOnlyUnrouted] = useState(false);
  const [showRouting, setShowRouting] = useState(true);
  const unrouted = useMemo(() => unroutedFeeders(project, withFinal), [project, withFinal]);
  // Rows stay put while you type a path (a cable must not vanish from "only unrouted" mid-typing): the
  // list is taken again only when the filter, the final-circuit option or the number of cables changes.
  const rowsKey = `${onlyUnrouted}|${withFinal}|${project.feeders.length}`;
  const rowsSnapshot = useRef<{ key: string; rows: Feeder[] } | null>(null);
  if (rowsSnapshot.current?.key !== rowsKey) rowsSnapshot.current = { key: rowsKey, rows: onlyUnrouted ? unrouted : trayFeeders(project, withFinal) };
  const routingRows = rowsSnapshot.current.rows;
  const routingSheet = useMemo(() => {
    const live = routingRows.map((f) => project.feeders.find((x) => x.id === f.id)).filter((f): f is NonNullable<typeof f> => !!f);
    return buildRoutingSheet(project, live);
  }, [project, routingRows]);

  function addRoute() {
    const name = nextRouteName(plan);
    setPlan({ ...plan, routes: [...plan.routes, { id: newTrayId('r'), name, cables: [] }] }, true);
    onStatus(`Added route ${name} — give cables a path through it in the routing table, or add them on the route`);
  }

  async function exportExcel() {
    setBusy(true);
    try {
      const bytes = await workbookBytes(buildTrayWorkbook(project, plan, results));
      const m = await saveBinary(`${safeFileName(project.name)}-cable-tray-schedule.xlsx`, bytes, 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }
  async function exportPdf() {
    setBusy(true);
    try {
      const m = await savePdf(`${safeFileName(project.name)}-cable-tray-schedule.pdf`, buildTrayReportHtml(project, plan, results));
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Cable tray schedule"
      intro="Give each cable its tray route path once (e.g. A-B-C) in the routing table — type, paste or fill down (⌘D) like Excel — and it appears on every route along the way. New route names create the route. Each route is sized from the cable diameters, the spacing and the spare, drawn in cross-section, and its grouping factor derates the cables on it."
      actions={
        <>
          {modeSwitch}
          <button className="chip" onClick={addRoute}>+ Route</button>
          <button className="chip" disabled={busy || !plan.routes.length} onClick={exportPdf}>Export PDF</button>
          <button className="chip primary" disabled={busy || !plan.routes.length} onClick={exportExcel}>{busy ? 'Exporting…' : 'Export Excel'}</button>
        </>
      }
    >
      <div className="plan-settings">
        <label>Method
          <select value={s.method} onChange={(e) => setSettings({ method: e.target.value as TrayMethod })}>
            <option value="spacing">Single layer, spaced</option>
            <option value="fill">Fill % (bunched)</option>
          </select>
        </label>
        {s.method === 'spacing' && (
          <label>Spacing between cables
            <select value={s.spacing} onChange={(e) => setSettings({ spacing: e.target.value as TraySpacing })}>
              {SPACINGS.map((k) => <option key={k} value={k}>{SPACING_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        {s.method === 'spacing' && s.spacing === 'mm' && <label>Spacing (mm)<Num value={s.spacingMm} onSet={(v) => setSettings({ spacingMm: v ?? 0 })} /></label>}
        {s.method === 'fill' && <label>Max fill %<Num value={s.fillPct} onSet={(v) => v && setSettings({ fillPct: Math.min(100, v) })} /></label>}
        <label>Spare %<Num value={s.sparePct} onSet={(v) => setSettings({ sparePct: v ?? 0 })} /></label>
        <label>Tray depth
          <select value={s.depthMm} onChange={(e) => setSettings({ depthMm: +e.target.value })}>
            {TRAY_DEPTHS.map((d) => <option key={d} value={d}>{d} mm</option>)}
          </select>
        </label>
        <label>Max width (then tiers)
          <select value={s.maxWidthMm} onChange={(e) => setSettings({ maxWidthMm: +e.target.value })}>
            {s.widths.map((w) => <option key={w} value={w}>{w} mm</option>)}
          </select>
        </label>
        <label>Construction
          <select value={s.kind} onChange={(e) => setSettings({ kind: e.target.value as 'perforated' | 'ladder' })}>
            <option value="perforated">Perforated tray</option>
            <option value="ladder">Cable ladder</option>
          </select>
        </label>
        <label>Tray type (text)<input key={s.trayType} defaultValue={s.trayType} style={{ width: 170 }} onBlur={(e) => e.target.value !== s.trayType && setSettings({ trayType: e.target.value })} /></label>
        <label>Supports every (m)<Num value={s.supportSpacingM} onSet={(v) => v && setSettings({ supportSpacingM: v })} /></label>
        <label>Tray length (m)<Num value={s.lengthM} onSet={(v) => v && setSettings({ lengthM: v })} title="Standard length: one coupler set per joint" /></label>
        <label className="tray-check"><input type="checkbox" checked={s.includeEcc} onChange={(e) => setSettings({ includeEcc: e.target.checked })} /> Separate 1C ECC with each feeder</label>
        <label className="tray-check"><input type="checkbox" checked={s.covers} onChange={(e) => setSettings({ covers: e.target.checked })} /> Tray covers</label>
        <label className="tray-check" title="Derate the cables on each route for grouping (IEC 60364-5-52 Table B.52.20); the cable checks use it after the next Run (F5)">
          <input type="checkbox" checked={s.applyGrouping} onChange={(e) => setSettings({ applyGrouping: e.target.checked })} /> Apply grouping to cable ratings
        </label>
        <label>Cable data (brand)
          <select
            value={plan.ods ? 'custom' : brandOf(plan.brand).id}
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              if (plan.ods && !window.confirm('Replace your edited cable data with the brand\'s?')) return;
              setPlan({ ...plan, brand: e.target.value, ods: undefined }, true);
            }}
          >
            {CABLE_BRANDS.map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === DEFAULT_CABLE_BRAND ? ' (default)' : ''}</option>)}
            {plan.ods && <option value="custom">Edited ({brandOf(plan.brand).name} based)</option>}
          </select>
        </label>
        <button className="chip" onClick={() => setShowOds(!showOds)}>{showOds ? 'Hide' : 'View / edit'} cable sizes (OD)</button>
      </div>

      {showOds && (
        <div className="plan-uses">
          <p className="warn m">
            {plan.ods ? `Your edited cable data (started from ${brandOf(plan.brand).name}).` : `${brandOf(plan.brand).note}.`} Outer diameter and minimum bending radius in mm, weight in kg/m; blank weight = typical, blank bending radius = 8 × D. Sizes missing from the table use the next bigger size. Editing makes a project copy; paste from Excel works (select the first cell, ⌘V).
          </p>
          <ClassicGrid
            model={odSheet}
            className="tray-od-grid"
            onStatus={onStatus}
            onEdits={(edits) => {
              const { ods, rejected } = applyOdEdits(odsOf(plan), odSheet, edits);
              if (ods !== odsOf(plan)) setPlan({ ...plan, ods }, true);
              return { changed: ods !== odsOf(plan), rejected };
            }}
          />
          {plan.ods && <button className="chip" onClick={() => setPlan({ ...plan, ods: undefined }, true)}>Back to the {brandOf(plan.brand).name} data</button>}
        </div>
      )}

      {unrouted.length > 0 && (
        <div className="tray-unrouted">
          <b>{unrouted.length} cable{unrouted.length === 1 ? ' is' : 's are'} not on any tray</b>
          <span className="m">{unrouted.slice(0, 8).map((f) => f.id).join(', ')}{unrouted.length > 8 ? ` … +${unrouted.length - 8}` : ''}</span>
          <button className="chip" onClick={() => { setShowRouting(true); setOnlyUnrouted(true); }}>Show them</button>
        </div>
      )}

      <h3 className="section-title">
        1 · Cable routing
        <button className="chip" onClick={() => setShowRouting(!showRouting)}>{showRouting ? 'Hide' : 'Show'}</button>
      </h3>
      {showRouting && (
        <>
          <div className="tray-add">
            <label className="tray-check"><input type="checkbox" checked={onlyUnrouted} onChange={(e) => setOnlyUnrouted(e.target.checked)} /> Only cables not on a tray</label>
            <label className="tray-check"><input type="checkbox" checked={withFinal} onChange={(e) => setWithFinal(e.target.checked)} /> Include final circuits (load schedules)</label>
            <span className="m">Path = the routes in order, e.g. <b>A-B-C</b>. Select a column block and ⌘D fills the top path down.</span>
          </div>
          {routingSheet.feeders.length ? (
            <ClassicGrid
              model={routingSheet}
              className="tray-routing-grid"
              onStatus={onStatus}
              onEdits={(edits) => {
                const r = applyRoutingEdits(project, routingSheet, edits);
                if (r.project !== project) onChange(r.project, true);
                if (r.created.length) onStatus(`Created route${r.created.length === 1 ? '' : 's'} ${r.created.join(', ')}`);
                return { changed: r.project !== project, rejected: r.rejected };
              }}
            />
          ) : (
            <p className="m">{onlyUnrouted ? 'Every cable is on a tray.' : 'No cables in the design yet.'}</p>
          )}
        </>
      )}

      <h3 className="section-title">2 · Routes <button className="chip" onClick={addRoute}>+ Route</button></h3>
      {results.map((res) => (
        <RouteCard
          key={res.route.id}
          project={project}
          plan={plan}
          res={res}
          boards={boards.map((b) => b.id)}
          onProject={(p) => onChange(p, true)}
          onRoute={(patch, step) => setRoute(res.route.id, patch, step)}
          onRemove={() => window.confirm(`Remove route ${res.route.name}? It is also taken off the cables' paths.`) && onChange(deleteRoute(project, res.route.id), true)}
          onStatus={onStatus}
        />
      ))}
      {!plan.routes.length && (
        <div className="tray-empty">
          <p className="m">No routes yet — type paths in the routing table above (e.g. A, A-B), or:</p>
          <button className="chip primary" onClick={addRoute}>+ Route A</button>
        </div>
      )}

      {plan.routes.length > 0 && (
        <>
          <h3 className="section-title">3 · Summary</h3>
          <table className="schedule tray-summary">
            <thead>
              <tr><th>Route</th><th>From</th><th>To</th><th>Panels (cables from)</th><th>Cables</th><th>Required width (mm)</th><th>Tray W × D (mm)</th><th>Spare</th><th>Grouping</th><th>Weight (kg/m)</th><th>Length (m)</th><th>Status</th></tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.route.id}>
                  <td><b>{r.route.name}</b></td>
                  <td className="l">{r.route.from ?? ''}</td>
                  <td className="l">{r.route.to ?? ''}</td>
                  <td className="l">{r.panels.join(', ') || '—'}</td>
                  <td>{r.cableCount}</td>
                  <td>{f0(r.requiredMm)}</td>
                  <td><b>{r.cableCount ? trayText(r) : '—'}</b>{r.manual && <span className="m"> (chosen)</span>}</td>
                  <td>{r.cableCount ? `${f0(r.sparePctActual)} %` : '—'}</td>
                  <td>{r.cableCount ? r.groupFactor.toFixed(2) : '—'}</td>
                  <td>{f1(r.kgPerM)}</td>
                  <td>{r.route.lengthM ?? '—'}</td>
                  <td className={r.status}>{STATUS_TEXT[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {quantities.length > 0 && (
            <>
              <h3 className="section-title">4 · Tray BOQ ({s.trayType})</h3>
              <table className="schedule tray-summary">
                <thead><tr><th>Size W × D (mm)</th><th>Tray (m)</th><th>Bends</th><th>Tees</th><th>Reducers</th><th>Risers</th><th>Supports</th><th>Coupler sets</th>{s.covers && <th>Cover (m)</th>}<th>Bend radius ≥ (mm)</th><th>Routes</th></tr></thead>
                <tbody>
                  {quantities.map((q) => (
                    <tr key={q.size}>
                      <td><b>{q.size}</b></td><td>{q.lengthM ? f0(q.lengthM) : '— enter route lengths'}</td>
                      <td>{q.bends}</td><td>{q.tees}</td><td>{q.reducers}</td><td>{q.risers}</td><td>{q.supports}</td><td>{q.couplers}</td>
                      {s.covers && <td>{f0(q.coverM)}</td>}
                      <td>{q.bendRadiusMm || '—'}</td>
                      <td className="l">{q.routes.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="m">Tiers counted. Supports every {s.supportSpacingM} m (both ends included); one coupler set per joint of {s.lengthM} m lengths. Enter each route's fittings on the route.</p>
            </>
          )}
        </>
      )}
    </Page>
  );
}

function RouteCard({ project, plan, res, boards, onProject, onRoute, onRemove, onStatus }: {
  project: Project;
  plan: ReturnType<typeof trayPlanOf>;
  res: TrayResult;
  boards: string[];
  onProject: (p: Project) => void;
  onRoute: (patch: Partial<TrayRoute>, step?: boolean) => void;
  onRemove: () => void;
  onStatus: (m: string) => void;
}) {
  const r = res.route;
  const s = plan.settings;
  const eff = routeSettings(plan, r);
  const [panel, setPanel] = useState(boards[0] ?? '');
  const [withFinal, setWithFinal] = useState(false);
  const [showSection, setShowSection] = useState(true);
  const nums = lineNumbers(res.lines);
  const svg = useMemo(() => (res.cableCount ? traySectionSvg(res, plan) : ''), [res, plan]);
  /** A manual cable's fields, or a feeder's overrides on this route. */
  const setCable = (id: string | undefined, feederId: string | undefined, patch: Partial<TrayCable>) => {
    if (id) onRoute({ cables: r.cables.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    else if (feederId) onRoute({ cables: [...r.cables, { id: newTrayId('c'), feederId, ...patch }] });
  };
  const fit = r.fittings ?? {};
  const setFit = (k: keyof NonNullable<TrayRoute['fittings']>, v: number | undefined) => onRoute({ fittings: { ...fit, [k]: v === undefined ? undefined : Math.round(v) } }, true);
  const text = (key: 'from' | 'to', width: number, placeholder: string) => (
    <input
      key={`${key}-${r[key] ?? ''}`}
      style={{ width }}
      defaultValue={r[key] ?? ''}
      placeholder={placeholder}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r[key] ?? '')) onRoute({ [key]: v || undefined }, true); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );

  function addPanel() {
    const fs = panelCables(project, panel, withFinal);
    const { project: next, added } = addFeedersToRoute(project, r.name, fs.map((f) => f.id));
    if (added) onProject(next);
    onStatus(fs.length ? `Route ${r.name}: added ${added} cable${added === 1 ? '' : 's'} from ${panel}${added < fs.length ? ` (${fs.length - added} already on it)` : ''}` : `${panel} has no outgoing cables${withFinal ? '' : ' (final circuits are not included)'}`);
  }

  return (
    <section className="tray-route">
      <div className="tray-head">
        <label>Route
          <input
            key={`name-${r.name}`}
            style={{ width: 60 }}
            defaultValue={r.name}
            title="Renaming also renames it in every cable's path"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v || v.toUpperCase() === r.name.toUpperCase()) { e.target.value = r.name; return; }
              const next = renameRoute(project, r.id, v);
              if (next === project) { e.target.value = r.name; onStatus(`Route ${v.toUpperCase()} already exists`); return; }
              onProject(next);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </label>
        <label>From {text('from', 170, 'e.g. Substation')}</label>
        <label>To {text('to', 170, 'e.g. Block A riser')}</label>
        <label>Length (m) <Num value={r.lengthM} onSet={(v) => onRoute({ lengthM: v }, true)} /></label>
        <span className="tray-fit">
          Fittings: <label>bends <Num value={fit.bends} width={40} placeholder="0" onSet={(v) => setFit('bends', v)} /></label>
          <label>tees <Num value={fit.tees} width={40} placeholder="0" onSet={(v) => setFit('tees', v)} /></label>
          <label>reducers <Num value={fit.reducers} width={40} placeholder="0" onSet={(v) => setFit('reducers', v)} /></label>
          <label>risers <Num value={fit.risers} width={40} placeholder="0" onSet={(v) => setFit('risers', v)} /></label>
        </span>
        <span className="sp" />
        <button className="icon-btn" title={`Remove route ${r.name}`} onClick={onRemove}>✕</button>
      </div>

      <div className="tray-add">
        <span className="m">Add cables:</span>
        <select value={panel} onChange={(e) => setPanel(e.target.value)} title="Panel the cables come from">
          {boards.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button className="chip" onClick={addPanel} disabled={!panel}>All cables from {panel || '…'}</button>
        <label className="tray-check"><input type="checkbox" checked={withFinal} onChange={(e) => setWithFinal(e.target.checked)} /> incl. final circuits</label>
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            onProject(addFeedersToRoute(project, r.name, [e.target.value]).project);
            onStatus(`Route ${r.name}: added ${e.target.value}`);
          }}
        >
          <option value="">One cable…</option>
          {boards.map((b) => (
            <optgroup key={b} label={`From ${b}`}>
              {project.feeders.filter((f) => f.boardId === b && !isOnRoute(r, f)).map((f) => (
                <option key={f.id} value={f.id}>{f.id} → {f.feedsBoardId ?? f.name} ({f.parallel && f.parallel > 1 ? `${f.parallel} × ` : ''}{f.cores}C × {f.cableCsaMm2})</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="chip" onClick={() => onRoute({ cables: [...r.cables, { id: newTrayId('c'), cores: 4, qty: 1 }] }, true)}>+ Manual cable</button>
      </div>

      <div className={`tray-body${showSection && svg ? ' with-section' : ''}`}>
        <table className="schedule tray-table">
          <thead>
            <tr><th>#</th><th>From</th><th>To</th><th>Cable</th><th>Path</th><th>No.</th><th>OD (mm)</th><th>kg/m</th><th>Σ D</th><th /></tr>
          </thead>
          <tbody>
            {res.lines.map((l) => {
              const c = l.cableId ? r.cables.find((x) => x.id === l.cableId) : undefined;
              const manual = !l.feederId;
              return (
                <tr key={l.id} className={l.ecc ? 'tray-ecc' : undefined}>
                  <td>{nums.get(l.id)}</td>
                  {l.ecc ? (
                    <><td className="m l">{l.from}</td><td className="m l">{l.to}</td></>
                  ) : manual && c ? (
                    <>
                      <td><input key={`f-${c.from ?? ''}`} defaultValue={c.from ?? ''} placeholder="Panel" onBlur={(e) => setCable(c.id, undefined, { from: e.target.value.trim() || undefined })} /></td>
                      <td><input key={`t-${c.to ?? ''}`} defaultValue={c.to ?? ''} placeholder="To" onBlur={(e) => setCable(c.id, undefined, { to: e.target.value.trim() || undefined })} /></td>
                    </>
                  ) : (
                    <><td className="l">{l.from}</td><td className="l">{l.to}</td></>
                  )}
                  <td className={`l${l.missing ? ' bad' : ''}`}>
                    {manual && c && !l.ecc ? (
                      <span className="tray-size">
                        <select value={c.cores ?? 4} onChange={(e) => setCable(c.id, undefined, { cores: +e.target.value })}>
                          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}C</option>)}
                        </select>
                        ×
                        <Num value={c.csaMm2} placeholder="mm²" width={56} onSet={(v) => setCable(c.id, undefined, { csaMm2: v })} />
                        mm²
                      </span>
                    ) : (
                      <>{l.description}{l.feederId && !l.ecc && <span className="m"> · {l.feederId}</span>}{l.missing && ` — ${l.missing}`}</>
                    )}
                  </td>
                  <td className="m">{l.ecc ? '' : manual ? `${r.name} only` : l.path ?? r.name}</td>
                  <td>{l.ecc ? l.qty : <Num value={c?.qty} placeholder={String(l.qty)} width={44} title={manual ? 'Number of cables' : 'Blank = the parallel runs of the design'} onSet={(v) => setCable(c?.id, l.feederId, { qty: v === undefined ? undefined : Math.max(1, Math.round(v)) })} />}</td>
                  <td className={l.unknownSize ? 'warn' : undefined} title={l.unknownSize ? 'Size not in the cable data — next size up' : undefined}>
                    {l.ecc ? f1(l.odMm) : <Num value={c?.odMm} placeholder={f1(l.odMm)} width={52} title="Blank = from the cable data" onSet={(v) => setCable(c?.id, l.feederId, { odMm: v || undefined })} />}
                  </td>
                  <td>{f1(l.kgPerM)}</td>
                  <td>{f0(l.qty * l.odMm)}</td>
                  <td>
                    {!l.ecc && (
                      <button
                        className="icon-btn"
                        title={manual ? 'Remove this cable' : `Take ${l.feederId} off route ${r.name} (and its path)`}
                        onClick={() => (manual ? onRoute({ cables: r.cables.filter((x) => x.id !== l.cableId) }, true) : onProject(removeFeederFromRoute(project, r.id, l.feederId!)))}
                      >✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!res.lines.length && <tr><td colSpan={10} className="m">No cables on this route yet — give cables the path {r.name} in the routing table, or add them here.</td></tr>}
          </tbody>
        </table>
        {showSection && svg && (
          <figure className="tray-section" title={`Cross-section of route ${r.name}, to scale`}>
            <div dangerouslySetInnerHTML={{ __html: svg }} />
            <figcaption className="m">Route {r.name} — to scale; numbers as in the table, hatched = spare</figcaption>
          </figure>
        )}
      </div>

      <div className="tray-calc">
        <div className="tray-opts">
          <label>Method
            <select value={r.method ?? ''} onChange={(e) => onRoute({ method: (e.target.value || undefined) as TrayMethod | undefined })}>
              <option value="">Default ({s.method === 'spacing' ? 'spaced' : 'fill %'})</option>
              <option value="spacing">Single layer, spaced</option>
              <option value="fill">Fill % (bunched)</option>
            </select>
          </label>
          {eff.method === 'spacing' ? (
            <label>Spacing
              <select value={r.spacing ?? ''} onChange={(e) => onRoute({ spacing: (e.target.value || undefined) as TraySpacing | undefined })}>
                <option value="">Default ({SPACING_LABEL[s.spacing]}{s.spacing === 'mm' ? ` ${s.spacingMm}` : ''})</option>
                {SPACINGS.map((k) => <option key={k} value={k}>{SPACING_LABEL[k]}</option>)}
              </select>
              {eff.spacing === 'mm' && <Num value={r.spacingMm} placeholder={String(s.spacingMm)} width={50} onSet={(v) => onRoute({ spacingMm: v })} />}
            </label>
          ) : (
            <label>Fill % <Num value={r.fillPct} placeholder={String(s.fillPct)} width={50} onSet={(v) => onRoute({ fillPct: v })} /></label>
          )}
          <label>Spare % <Num value={r.sparePct} placeholder={String(s.sparePct)} width={50} onSet={(v) => onRoute({ sparePct: v })} /></label>
          <label>Depth
            <select value={r.depthMm ?? ''} onChange={(e) => onRoute({ depthMm: e.target.value ? +e.target.value : undefined })}>
              <option value="">Default ({s.depthMm})</option>
              {TRAY_DEPTHS.map((d) => <option key={d} value={d}>{d} mm</option>)}
            </select>
          </label>
          {svg && <button className="chip" onClick={() => setShowSection(!showSection)}>{showSection ? 'Hide' : 'Show'} cross-section</button>}
        </div>
        <div className="tray-result">
          <span className="m">
            {eff.method === 'spacing'
              ? <>Σ D {f0(res.sumOdMm)} + spacing {f0(res.clearanceMm)} = <b>{f0(res.occupiedMm)} mm</b></>
              : <>Cable area {f0(res.cableAreaMm2)} mm² ÷ ({eff.fillPct} % × {eff.depthMm} mm) = <b>{f0(res.occupiedMm)} mm</b></>}
            {' '}+ {eff.sparePct} % spare → required <b>{f0(res.requiredMm)} mm</b>
          </span>
          <span className="tray-pick">
            Tray
            <select
              value={r.widthMm ?? ''}
              onChange={(e) => onRoute({ widthMm: e.target.value ? +e.target.value : undefined, ...(e.target.value ? {} : { tiers: undefined }) }, true)}
            >
              <option value="">Auto ({res.autoTiers > 1 ? `${res.autoTiers} × ` : ''}{res.autoWidthMm})</option>
              {s.widths.map((w) => <option key={w} value={w}>{w} mm</option>)}
            </select>
            ×
            <select value={r.tiers ?? ''} onChange={(e) => onRoute({ tiers: e.target.value ? +e.target.value : undefined }, true)} title="Tiers">
              <option value="">{r.widthMm !== undefined || r.tiers !== undefined ? `${res.tiers} tier${res.tiers > 1 ? 's' : ''} (auto)` : 'Auto tiers'}</option>
              {[1, 2, 3, 4, 5, 6].map((t) => <option key={t} value={t}>{t} tier{t > 1 ? 's' : ''}</option>)}
            </select>
          </span>
          <b className={`tray-answer ${res.status}`}>
            {res.cableCount ? `${trayText(res)} mm · spare ${f0(res.sparePctActual)} % · ${f1(res.kgPerM)} kg/m` : '—'}
          </b>
          {res.notes.length > 0 && <span className="m">{res.notes.join(' · ')}</span>}
        </div>
        {res.cableCount > 0 && (
          <div className="m">
            Grouping <b>× {res.groupFactor.toFixed(2)}</b> — {res.loadedPerTier} loaded cable{res.loadedPerTier === 1 ? '' : 's'} per tier, {ARRANGEMENT[res.arrangement]}, {res.tiers} tier{res.tiers === 1 ? '' : 's'}, {s.kind === 'ladder' ? 'cable ladder' : 'perforated tray'} (IEC 60364-5-52 {res.arrangement === 'bunched' ? 'B.52.17' : 'B.52.20'})
            {s.applyGrouping ? ' — applied to the cable ratings (Run / F5)' : ' — not applied (switched off)'}
            {res.bendMm > 0 && <> · Bends and tees: inside radius ≥ <b>{res.bendMm} mm</b>{res.bendEstimated ? ' (8 × D, estimated)' : ''}</>}
          </div>
        )}
      </div>
    </section>
  );
}
