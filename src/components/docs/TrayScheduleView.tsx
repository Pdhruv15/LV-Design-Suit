import { useMemo, useState } from 'react';
import type { Project, TrayCable, TrayMethod, TrayPlan, TrayRoute, TraySettings, TraySpacing } from '../../types';
import {
  addFeeders, DEFAULT_CABLE_ODS, emptyTrayPlan, newTrayId, nextRouteName, odsOf, panelCables, routeSettings, sizeAll,
  SPACING_LABEL, TRAY_DEPTHS, trayQuantities, type TrayResult
} from '../../calc/cableTray';
import { boardsInSupplyOrder } from '../../calc/summary';
import { buildOdSheet, applyOdEdits } from '../../docs/traySheet';
import { buildTrayWorkbook } from '../../docs/trayWorkbook';
import { workbookBytes } from '../../docs/formWorkbook';
import { saveBinary, safeFileName } from '../../util/files';
import ClassicGrid from '../grid/ClassicGrid';
import { Page } from '../ui';

const f0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const SPACINGS = Object.keys(SPACING_LABEL) as TraySpacing[];

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

/** Cable tray schedule: routes A, B, C… each carrying cables from one or
 * more panels, sized from the cables' diameters, spacing and spare. */
export default function TrayScheduleView({ project, onChange, onStatus }: {
  project: Project;
  onChange: (p: Project, step?: boolean) => void;
  onStatus: (m: string) => void;
}) {
  const plan = project.trays ?? emptyTrayPlan();
  const s = plan.settings;
  const setPlan = (next: TrayPlan, step = false) => onChange({ ...project, trays: next }, step);
  const setSettings = (patch: Partial<TraySettings>) => setPlan({ ...plan, settings: { ...s, ...patch } });
  const setRoute = (id: string, patch: Partial<TrayRoute>, step = false) =>
    setPlan({ ...plan, routes: plan.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, step);
  const results = useMemo(() => sizeAll(project, plan), [project, plan]);
  const quantities = useMemo(() => trayQuantities(results), [results]);
  const [showOds, setShowOds] = useState(false);
  const odSheet = useMemo(() => buildOdSheet(odsOf(plan)), [plan]);
  const boards = boardsInSupplyOrder(project);
  const [busy, setBusy] = useState(false);

  function addRoute() {
    const name = nextRouteName(plan);
    setPlan({ ...plan, routes: [...plan.routes, { id: newTrayId('r'), name, cables: [] }] }, true);
    onStatus(`Added route ${name} — add the cables that run on it`);
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

  return (
    <Page
      title="Cable tray schedule"
      intro="Make a route (A, B, C…) for each tray run, then add the cables on it — all outgoing cables of a panel at once, single cables, or manual ones. Cables from several panels can share a route. The tray width comes from the cable diameters, the spacing and the spare; leave a route's settings blank to use the defaults, or choose the tray yourself."
      actions={
        <>
          <button className="chip" onClick={addRoute}>+ Route</button>
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
        <label>Tray type<input key={s.trayType} defaultValue={s.trayType} style={{ width: 170 }} onBlur={(e) => e.target.value !== s.trayType && setSettings({ trayType: e.target.value })} /></label>
        <label className="tray-check"><input type="checkbox" checked={s.includeEcc} onChange={(e) => setSettings({ includeEcc: e.target.checked })} /> Separate 1C earth cable (ECC) with each feeder</label>
        <button className="chip" onClick={() => setShowOds(!showOds)}>{showOds ? 'Hide' : 'Edit'} cable sizes (OD)</button>
      </div>

      {showOds && (
        <div className="plan-uses">
          <p className="warn m">
            {plan.ods ? 'Your cable data.' : 'ROUGH values (typical XLPE/SWA/PVC catalogue sizes) — replace with your manufacturer\'s data.'} Outer diameter in mm, weight in kg/m. Paste from Excel works (select the first cell, ⌘V).
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
          {plan.ods && <button className="chip" onClick={() => setPlan({ ...plan, ods: undefined }, true)}>Back to the rough values ({DEFAULT_CABLE_ODS.length} sizes)</button>}
        </div>
      )}

      {results.map((res) => (
        <RouteCard
          key={res.route.id}
          project={project}
          plan={plan}
          res={res}
          boards={boards.map((b) => b.id)}
          onRoute={(patch, step) => setRoute(res.route.id, patch, step)}
          onRemove={() => window.confirm(`Remove route ${res.route.name}?`) && setPlan({ ...plan, routes: plan.routes.filter((r) => r.id !== res.route.id) }, true)}
          onStatus={onStatus}
        />
      ))}
      {!plan.routes.length && (
        <div className="tray-empty">
          <p className="m">No routes yet.</p>
          <button className="chip primary" onClick={addRoute}>+ Route A</button>
        </div>
      )}

      {plan.routes.length > 0 && (
        <>
          <h3 className="section-title">Summary</h3>
          <table className="schedule tray-summary">
            <thead>
              <tr><th>Route</th><th>From</th><th>To</th><th>Panels (cables from)</th><th>Cables</th><th>Required width (mm)</th><th>Tray W × D (mm)</th><th>Spare</th><th>Weight (kg/m)</th><th>Length (m)</th><th>Status</th></tr>
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
                  <td>{f1(r.kgPerM)}</td>
                  <td>{r.route.lengthM ?? '—'}</td>
                  <td className={r.status}>{r.status === 'ok' ? 'OK' : r.status === 'warn' ? 'Check' : 'Too small'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {quantities.length > 0 && (
            <>
              <h3 className="section-title">Tray quantities ({s.trayType})</h3>
              <table className="schedule tray-summary">
                <thead><tr><th>Size W × D (mm)</th><th>Length (m, all tiers)</th><th>Routes</th></tr></thead>
                <tbody>
                  {quantities.map((q) => (
                    <tr key={q.size}><td><b>{q.size}</b></td><td>{q.lengthM ? f0(q.lengthM) : '— enter route lengths'}</td><td className="l">{q.routes.join(', ')}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Page>
  );
}

function RouteCard({ project, plan, res, boards, onRoute, onRemove, onStatus }: {
  project: Project;
  plan: TrayPlan;
  res: TrayResult;
  boards: string[];
  onRoute: (patch: Partial<TrayRoute>, step?: boolean) => void;
  onRemove: () => void;
  onStatus: (m: string) => void;
}) {
  const r = res.route;
  const s = plan.settings;
  const eff = routeSettings(plan, r);
  const [panel, setPanel] = useState(boards[0] ?? '');
  const [withFinal, setWithFinal] = useState(false);
  const setCable = (id: string, patch: Partial<TrayCable>) => onRoute({ cables: r.cables.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const onRouteIds = new Set(r.cables.map((c) => c.feederId));
  const text = (key: 'name' | 'from' | 'to', width: number, placeholder: string) => (
    <input
      key={`${key}-${r[key] ?? ''}`}
      style={{ width }}
      defaultValue={r[key] ?? ''}
      placeholder={placeholder}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r[key] ?? '')) onRoute({ [key]: key === 'name' ? v || r.name : v || undefined }, true); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );

  function addPanel() {
    const fs = panelCables(project, panel, withFinal);
    const next = addFeeders(r, fs.map((f) => f.id));
    const added = next.cables.length - r.cables.length;
    onRoute(next, true);
    onStatus(fs.length ? `Route ${r.name}: added ${added} cable${added === 1 ? '' : 's'} from ${panel}${added < fs.length ? ` (${fs.length - added} already on it)` : ''}` : `${panel} has no outgoing cables${withFinal ? '' : ' (final circuits are not included)'}`);
  }

  return (
    <section className="tray-route">
      <div className="tray-head">
        <label>Route {text('name', 60, 'A')}</label>
        <label>From {text('from', 170, 'e.g. Substation')}</label>
        <label>To {text('to', 170, 'e.g. Block A riser')}</label>
        <label>Length (m) <Num value={r.lengthM} onSet={(v) => onRoute({ lengthM: v }, true)} /></label>
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
            onRoute(addFeeders(r, [e.target.value]), true);
            onStatus(`Route ${r.name}: added ${e.target.value}`);
          }}
        >
          <option value="">One cable…</option>
          {boards.map((b) => (
            <optgroup key={b} label={`From ${b}`}>
              {project.feeders.filter((f) => f.boardId === b && !onRouteIds.has(f.id)).map((f) => (
                <option key={f.id} value={f.id}>{f.id} → {f.feedsBoardId ?? f.name} ({f.parallel && f.parallel > 1 ? `${f.parallel} × ` : ''}{f.cores}C × {f.cableCsaMm2})</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="chip" onClick={() => onRoute({ cables: [...r.cables, { id: newTrayId('c'), cores: 4, qty: 1 }] }, true)}>+ Manual cable</button>
      </div>

      <table className="schedule tray-table">
        <thead>
          <tr><th>#</th><th>From</th><th>To</th><th>Cable</th><th>No. of cables</th><th>OD (mm)</th><th>kg/m</th><th>Σ D (mm)</th><th /></tr>
        </thead>
        <tbody>
          {res.lines.map((l, i) => {
            const c = r.cables.find((x) => x.id === l.cableId)!;
            const manual = !l.feederId;
            return (
              <tr key={l.id} className={l.ecc ? 'tray-ecc' : undefined}>
                <td>{l.ecc ? '' : r.cables.indexOf(c) + 1}</td>
                {l.ecc ? (
                  <><td className="m l">{l.from}</td><td className="m l">{l.to}</td></>
                ) : manual ? (
                  <>
                    <td><input key={`f-${c.from ?? ''}`} defaultValue={c.from ?? ''} placeholder="Panel" onBlur={(e) => setCable(c.id, { from: e.target.value.trim() || undefined })} /></td>
                    <td><input key={`t-${c.to ?? ''}`} defaultValue={c.to ?? ''} placeholder="To" onBlur={(e) => setCable(c.id, { to: e.target.value.trim() || undefined })} /></td>
                  </>
                ) : (
                  <><td className="l">{l.from}</td><td className="l">{l.to}</td></>
                )}
                <td className={`l${l.missing ? ' bad' : ''}`}>
                  {manual && !l.ecc ? (
                    <span className="tray-size">
                      <select value={c.cores ?? 4} onChange={(e) => setCable(c.id, { cores: +e.target.value })}>
                        {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}C</option>)}
                      </select>
                      ×
                      <Num value={c.csaMm2} placeholder="mm²" width={56} onSet={(v) => setCable(c.id, { csaMm2: v })} />
                      mm²
                    </span>
                  ) : (
                    <>{l.description}{l.feederId && !l.ecc && <span className="m"> · {l.feederId}</span>}{l.missing && ` — ${l.missing}`}</>
                  )}
                </td>
                <td>{l.ecc ? l.qty : <Num value={c.qty} placeholder={String(l.qty)} width={50} title={manual ? 'Number of cables' : 'Blank = the parallel runs of the design'} onSet={(v) => setCable(c.id, { qty: v === undefined ? undefined : Math.max(1, Math.round(v)) })} />}</td>
                <td className={l.unknownSize ? 'warn' : undefined} title={l.unknownSize ? 'Size not in the cable data — next size up' : undefined}>
                  {l.ecc ? f1(l.odMm) : <Num value={c.odMm} placeholder={f1(l.odMm)} width={56} title="Blank = from the cable data" onSet={(v) => setCable(c.id, { odMm: v || undefined })} />}
                </td>
                <td>{f1(l.kgPerM)}</td>
                <td>{f0(l.qty * l.odMm)}</td>
                <td>{!l.ecc && <button className="icon-btn" title="Remove from the route" onClick={() => onRoute({ cables: r.cables.filter((x) => x.id !== c.id) }, true)}>✕</button>}</td>
              </tr>
            );
          })}
          {!res.lines.length && <tr><td colSpan={9} className="m">No cables on this route yet.</td></tr>}
        </tbody>
      </table>

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
      </div>
    </section>
  );
}
