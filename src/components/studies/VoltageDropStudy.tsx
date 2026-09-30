import { Fragment, useMemo, useState } from 'react';
import type { Project } from '../../types';
import { cables } from '../../calc/cableTable';
import { cableSizeText } from '../../calc/electrical';
import { boardsInSupplyOrder } from '../../calc/summary';
import { addVdCable, editVdCable, groupByPanel, MOTOR_START_VD_LIMIT_PCT, suggestCable, vdCandidates, vdFormula, vdPath, vdRow, worstFinalCircuits, type VdEdit, type VdRow } from '../../calc/voltageDrop';
import { riserVd, type RiserVd } from '../../calc/busbar';
import { resistanceFactor } from '../../calc/electrical';
import { buildVdReportHtml, scopeLabel, VD_HEADERS, vdCells } from '../../docs/voltageDropReport';
import { saveCsv, savePdf, safeFileName } from '../../util/files';
import EditCell from '../EditCell';
import { Page, StatusCell, StatusCounts } from '../ui';
import type { Status } from '../../calc/electrical';

const TEMPS: { value: string; label: string }[] = [
  { value: '', label: 'Standard (R20 × 1.2)' },
  { value: '20', label: '20 °C (R20)' },
  { value: '70', label: '70 °C — PVC' },
  { value: '90', label: '90 °C — XLPE' }
];

const PHASES = [
  { value: '4', label: '3-ph · 4 core' },
  { value: '3', label: '3-ph · 3 core' },
  { value: '2', label: '1-ph · 2 core' }
];

/** Voltage drop calculation for panel-to-panel and equipment cables. The
 * user picks the cables (whole panels or single cables); final circuits
 * below DBs are left out, and a DB's load comes from its load schedule. */
export default function VoltageDropStudy({ project, calcProject = project, stale = false, onChange, onStatus }: {
  project: Project;
  /** The project as last calculated: the results columns come from it. */
  calcProject?: Project;
  stale?: boolean;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
}) {
  const [scope, setScope] = useState(''); // '' = entire system, else a board id
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null); // row shown in the profile
  const [formulaId, setFormulaId] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [pickOpen, setPickOpen] = useState(true);
  const candidates = useMemo(() => vdCandidates(project), [project]);
  // Nothing chosen yet: the whole system (the page is never empty).
  const selected = useMemo(() => new Set(project.vdSelection ?? candidates.map((f) => f.id)), [project.vdSelection, candidates]);
  const panels = useMemo(
    () => boardsInSupplyOrder(project).map((b) => ({ board: b, cables: candidates.filter((f) => f.boardId === b.id) })).filter((p) => p.cables.length),
    [project, candidates]
  );
  const rows = useMemo(
    // Inputs (the white cells) are the live values; results come from the
    // last run, so editing a cell doesn't recalculate until Run.
    () => candidates.filter((f) => selected.has(f.id) && (!scope || f.boardId === scope)).map((f) => {
      const calc = calcProject.feeders.find((x) => x.id === f.id);
      return { ...(calc ? vdRow(calcProject, calc) : vdRow(project, f)), feeder: f };
    }),
    [calcProject, project, candidates, selected, scope]
  );
  // Each DB's worst final circuit (optional): shown under the DB, edited on its load schedule.
  const finals = useMemo(() => (project.vdFinalCircuits ? worstFinalCircuits(calcProject).filter((r) => !scope || r.from.id === scope) : []), [calcProject, project.vdFinalCircuits, scope]);
  const allRows = useMemo(() => [...rows, ...finals], [rows, finals]);
  const shown = onlyIssues ? allRows.filter((r) => r.status !== 'ok' || (r.startPct ?? 0) > MOTOR_START_VD_LIMIT_PCT) : allRows;
  const risers = useMemo(() => (project.busRisers ?? []).filter((r) => !scope || r.sourceBoardId === scope).map((r) => riserVd(calcProject, r)), [calcProject, project.busRisers, scope]);
  const worst = allRows.reduce<VdRow | undefined>((w, r) => (!w || r.totalPct > w.totalPct ? r : w), undefined);
  const focus = allRows.find((r) => r.feeder.id === focusId) ?? worst;
  const path = useMemo(() => (focus ? vdPath(calcProject, calcProject.feeders.find((f) => f.id === focus.feeder.id) ?? focus.feeder) : []), [focus, calcProject]);
  const longest = allRows.reduce<VdRow | undefined>((w, r) => (!w || r.feeder.lengthM > w.feeder.lengthM ? r : w), undefined);
  const motors = allRows.filter((r) => r.startPct !== undefined);
  const worstStart = motors.reduce<VdRow | undefined>((w, r) => (!w || r.startPct! > w.startPct! ? r : w), undefined);
  const worstRiser = risers.reduce<RiserVd | undefined>((w, r) => (!w || r.exactTopPct > w.exactTopPct ? r : w), undefined);
  const tempC = project.vdTempC;
  const scopeName = scopeLabel(project, scope);
  const cableSizes = useMemo(() => cables().map((c) => ({ value: String(c.csaMm2), label: `${c.csaMm2} mm²` })), [project]);

  const setSelection = (ids: Set<string>) =>
    onChange({ ...project, vdSelection: candidates.filter((f) => ids.has(f.id)).map((f) => f.id) });
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setSelection(next);
  };
  const edit = (id: string, e: VdEdit) => onChange(editVdCable(project, id, e));

  function addCable() {
    const from = scope || panels[0]?.board.id || project.boards[0]?.id;
    if (!from) return;
    const { project: p, id } = addVdCable(project, from);
    onChange({ ...p, vdSelection: [...(p.vdSelection ?? []), id] });
    onStatus(`Added ${id} on ${from} — double-click its cells to enter the equipment, load and cable`);
  }

  async function exportPdf() {
    setBusy(true);
    try {
      const m = await savePdf(`${safeFileName(`${project.name} voltage drop ${scope || 'system'}`)}.pdf`, buildVdReportHtml(calcProject, allRows, scopeName, risers));
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }
  async function exportCsv() {
    const m = await saveCsv(`${project.name} voltage drop ${scope || 'system'}`, VD_HEADERS, allRows.map(vdCells));
    if (m) onStatus(m);
  }

  const loadCell = (r: VdRow) =>
    r.toBoard ? (
      <EditCell
        kind="text"
        value=""
        onCommit={() => undefined}
        display={r.loadKw.toFixed(1)}
        locked={r.scheduleCircuits
          ? `From the ${r.toBoard.id} load schedule (${r.scheduleCircuits} circuits) — edit it there`
          : `Total demand of everything fed from ${r.toBoard.id}`}
      />
    ) : (
      <EditCell
        kind="number"
        min={0}
        value={+(r.feeder.loadKw * r.feeder.demandFactor).toFixed(3)}
        display={r.loadKw.toFixed(1)}
        title="Demand load (kW) — double-click to edit"
        onCommit={(v) => edit(r.feeder.id, { loadKw: r.feeder.demandFactor ? v / r.feeder.demandFactor : v })}
      />
    );

  return (
    <Page
      title="Voltage drop calculation"
      intro="Source-to-load voltage drop of every panel and equipment cable, and of the busbar risers. A DB's load comes from its load schedule; tick “Worst final circuit of each DB” to include the last circuit too. Double-click a white cell to change it — changes also update the SLD and schedules."
      actions={
        <>
          <select className="chip" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Report scope">
            <option value="">Report: entire system</option>
            {panels.map(({ board }) => <option key={board.id} value={board.id}>Report: panel {board.id}</option>)}
          </select>
          <button className="chip" onClick={addCable} title={`Add a cable to equipment (AHU, isolator, motor…) on ${scope || panels[0]?.board.id}`}>+ Add equipment cable</button>
          <button className="chip" onClick={exportCsv} disabled={!allRows.length || stale} title={stale ? 'Run the calculations first (F5)' : undefined}>Export CSV (Excel)</button>
          <button className="chip primary" onClick={exportPdf} disabled={busy || !allRows.length || stale} title={stale ? 'Run the calculations first (F5)' : undefined}>{busy ? 'Exporting…' : 'Export PDF'}</button>
        </>
      }
    >
      <section className="card vd-settings">
        <label className="row">Limit <input className="bi-text" style={{ width: 52 }} inputMode="decimal" defaultValue={project.vdLimitPct} key={project.vdLimitPct}
          onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== project.vdLimitPct) onChange({ ...project, vdLimitPct: n }); }} /> %</label>
        <label className="row">Conductor temperature
          <select className="chip" value={tempC === undefined ? '' : TEMPS.some((t) => t.value === String(tempC)) ? String(tempC) : 'custom'}
            onChange={(e) => onChange({ ...project, vdTempC: e.target.value === '' ? undefined : e.target.value === 'custom' ? (tempC ?? 80) : Number(e.target.value) })}>
            {TEMPS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            <option value="custom">Other…</option>
          </select>
          {tempC !== undefined && !TEMPS.some((t) => t.value === String(tempC)) && (
            <><input className="bi-text" style={{ width: 52 }} inputMode="decimal" defaultValue={tempC} key={tempC} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > -20 && n < 250) onChange({ ...project, vdTempC: n }); }} /> °C</>
          )}
          <span className="m">R × {resistanceFactor(tempC).toFixed(3)}</span>
        </label>
        <label className="row"><input type="checkbox" checked={!!project.vdFinalCircuits} onChange={(e) => onChange({ ...project, vdFinalCircuits: e.target.checked || undefined })} /> Worst final circuit of each DB</label>
        <label className="row"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only check / fail</label>
        <span className="sp" />
        <button className="chip" onClick={() => setPickOpen(!pickOpen)}>{pickOpen ? '◀ Hide cable list' : '▶ Choose cables'}</button>
      </section>

      <div className="vd-cards">
        <VdCard label="Worst voltage drop" value={worst ? `${worst.totalPct.toFixed(2)} %` : '—'} status={worst?.status} sub={worst ? `${worst.feeder.id} → ${worst.toName}` : 'No cables'} onClick={worst ? () => setFocusId(worst.feeder.id) : undefined} />
        <VdCard label="Limit" value={`${project.vdLimitPct} %`} sub={`source to load · ${tempC === undefined ? 'R20 × 1.2' : `${tempC} °C`}`} />
        <VdCard label="Results" value={`${allRows.length} cables`} sub={<StatusCounts statuses={allRows.map((r) => r.status)} />} />
        <VdCard label="Longest cable" value={longest ? `${longest.feeder.lengthM} m` : '—'} sub={longest ? `${longest.feeder.id} → ${longest.toName} · ${longest.totalPct.toFixed(2)} %` : ''} onClick={longest ? () => setFocusId(longest.feeder.id) : undefined} />
        <VdCard label="Motor starting" value={worstStart ? `${worstStart.startPct!.toFixed(1)} %` : '—'} status={worstStart ? (worstStart.startPct! > MOTOR_START_VD_LIMIT_PCT ? 'bad' : 'ok') : undefined}
          sub={worstStart ? `${worstStart.toName} · limit ${MOTOR_START_VD_LIMIT_PCT} %` : 'No motors selected'} onClick={worstStart ? () => setFocusId(worstStart.feeder.id) : undefined} />
        <VdCard label="Busbar risers" value={worstRiser ? `${worstRiser.exactTopPct.toFixed(2)} %` : '—'} status={worstRiser?.status} sub={worstRiser ? `${worstRiser.riser.name} · top tap-off` : 'None in the project'} />
      </div>

      {focus && path.length > 0 && <VdProfile path={path} limit={project.vdLimitPct} title={`${focus.feeder.id} → ${focus.toName}`} isWorst={focus === worst} />}

      <div className={`vd-layout${pickOpen ? '' : ' closed'}`}>
        {pickOpen && (
        <aside className="vd-pick" aria-label="Cables to calculate">
          <div className="vd-pick-head">
            <b>Cables</b>
            <span>
              <button className="link" onClick={() => setSelection(new Set(candidates.map((f) => f.id)))}>All</button>
              {' · '}
              <button className="link" onClick={() => setSelection(new Set())}>None</button>
            </span>
          </div>
          {panels.map(({ board, cables: fs }) => {
            const n = fs.filter((f) => selected.has(f.id)).length;
            return (
              <div key={board.id} className="vd-panel">
                <label className="vd-panel-row">
                  <input
                    type="checkbox"
                    checked={n === fs.length}
                    ref={(el) => el && (el.indeterminate = n > 0 && n < fs.length)}
                    onChange={(e) => toggle(fs.map((f) => f.id), e.target.checked)}
                  />
                  <b>{board.id}</b> <span className="m">{n}/{fs.length}</span>
                </label>
                {fs.map((f) => (
                  <label key={f.id} className="vd-cable-row">
                    <input type="checkbox" checked={selected.has(f.id)} onChange={(e) => toggle([f.id], e.target.checked)} />
                    → {f.feedsBoardId ?? f.name ?? f.id}
                  </label>
                ))}
              </div>
            );
          })}
        </aside>
        )}

        <div className="vd-main">
          <div className="vd-summary">
            <b>{scopeName}</b> · {shown.length} cable{shown.length === 1 ? '' : 's'} · <StatusCounts statuses={shown.map((r) => r.status)} /> <span className="m">· click a row to see its path above · ƒ shows the calculation</span>
          </div>
          {shown.length === 0 ? (
            <p className="m vd-empty">
              {onlyIssues ? '✓ Nothing to check — every selected cable is within the limit.' : selected.size ? `No selected cables on ${scope}.` : 'No cables selected. Tick a panel or single cables in the list.'}
            </p>
          ) : (
            <table className="schedule vd-table">
              <thead>
                <tr>{VD_HEADERS.map((h) => <th key={h}>{h}</th>)}<th>Fix</th><th /></tr>
              </thead>
              <tbody>
                {groupByPanel(shown).map(({ board, rows: rs }) => [
                  <tr key={`h-${board.id}`} className="vd-group">
                    <td colSpan={VD_HEADERS.length + 2}>{board.id} – {board.name}{board.kind ? ` (${board.kind})` : ''}</td>
                  </tr>,
                  ...rs.map((r) => {
                    const fix = r.status !== 'ok' && !r.finalCircuit ? suggestCable(calcProject, calcProject.feeders.find((f) => f.id === r.feeder.id) ?? r.feeder) : undefined;
                    const fc = r.finalCircuit;
                    return (
                    <Fragment key={r.feeder.id}>
                    <tr className={`${focus?.feeder.id === r.feeder.id ? 'vd-focus' : ''}${fc ? ' vd-final' : ''}`} onClick={() => setFocusId(r.feeder.id)}>
                      <td>{r.feeder.id}{fc && <span className="bom-tag" title="The DB's worst final circuit — edit it on the load schedule">final circuit</span>}</td>
                      <td>{r.from.id}</td>
                      {r.toBoard || fc ? (
                        <EditCell kind="text" value="" onCommit={() => undefined} display={r.toName} locked={fc ? 'Final circuit — edit it on the load schedule' : `Panel ${r.toBoard!.id} – ${r.toBoard!.name}`} />
                      ) : (
                        <EditCell kind="text" value={r.feeder.name} display={r.toName} title="Equipment name (e.g. AHU-01, isolator) — double-click to edit" onCommit={(v) => edit(r.feeder.id, { name: v || r.feeder.id })} />
                      )}
                      <td>{r.toType}{r.startPct !== undefined && <div className={`m ${r.startPct > MOTOR_START_VD_LIMIT_PCT ? 'bad' : ''}`} title={`Drop while starting (running drop × starting current), limit ${MOTOR_START_VD_LIMIT_PCT} %`}>start {r.startPct.toFixed(1)} %</div>}</td>
                      {fc ? <td>{r.loadKw.toFixed(1)}</td> : loadCell(r)}
                      {fc ? <td>{r.pf.toFixed(2)}</td> : <EditCell kind="number" min={0.1} max={1} value={r.pf} display={r.pf.toFixed(2)} onCommit={(v) => edit(r.feeder.id, { powerFactor: v })} />}
                      <td>{r.ib.toFixed(1)}</td>
                      {fc ? <td>{r.threePhase ? '3-ph' : '1-ph'}</td> : <EditCell kind="select" value={String(r.feeder.cores)} options={PHASES} display={r.threePhase ? '3-ph' : '1-ph'} onCommit={(v) => edit(r.feeder.id, { cores: +v as 2 | 3 | 4 })} />}
                      {fc ? <td>{cableSizeText(r.feeder)}</td> : <EditCell kind="select" value={String(r.feeder.cableCsaMm2)} options={cableSizes} display={cableSizeText(r.feeder)} onCommit={(v) => edit(r.feeder.id, { cableCsaMm2: +v })} />}
                      {fc ? <td>{r.feeder.lengthM.toFixed(0)}</td> : <EditCell kind="number" min={1} value={r.feeder.lengthM} display={r.feeder.lengthM.toFixed(0)} onCommit={(v) => edit(r.feeder.id, { lengthM: v })} />}
                      <td>{r.mvPerAm.toFixed(3)}</td>
                      <td>{r.vdV.toFixed(2)}</td>
                      <td>{r.vdPct.toFixed(2)}</td>
                      <td>{r.upstreamPct.toFixed(2)}</td>
                      <td className={r.status}><b>{r.totalPct.toFixed(2)}</b></td>
                      <td>{r.limitPct.toFixed(1)}</td>
                      <StatusCell status={r.status} />
                      {fc ? <td>{r.feeder.remarks ?? ''}</td> : <EditCell kind="text" value={r.feeder.remarks ?? ''} display={r.feeder.remarks ?? ''} className="vd-remarks" onCommit={(v) => edit(r.feeder.id, { remarks: v })} />}
                      <td>{fix ? <button className="chip vd-fix" title={`${fix.csaMm2} mm² gives ${fix.totalPct.toFixed(2)} % — click to apply (updates the SLD and schedules)`} onClick={(e) => { e.stopPropagation(); edit(r.feeder.id, { cableCsaMm2: fix.csaMm2 }); onStatus(`${r.feeder.id}: ${r.feeder.cableCsaMm2} → ${fix.csaMm2} mm² — Run (F5) to update the results`); }}>→ {fix.csaMm2} mm² <span className="m">{fix.totalPct.toFixed(2)} %</span></button> : r.status !== 'ok' && !fc ? <span className="m" title="Even the largest size fails: add parallel runs or shorten the route">runs / route</span> : null}</td>
                      <td><button className="icon-btn" title="Show the calculation" onClick={(e) => { e.stopPropagation(); setFormulaId(formulaId === r.feeder.id ? null : r.feeder.id); }}>ƒ</button></td>
                    </tr>
                    {formulaId === r.feeder.id && <tr className="vd-formula"><td colSpan={VD_HEADERS.length + 2}>{vdFormula(calcProject, r)}</td></tr>}
                    </Fragment>
                    );
                  })
                ])}
              </tbody>
            </table>
          )}

          {risers.map((v) => <RiserVdCard key={v.riser.id} v={v} />)}
        </div>
      </div>
    </Page>
  );
}

function VdCard({ label, value, sub, status, onClick }: { label: string; value: string; sub?: React.ReactNode; status?: Status; onClick?: () => void }) {
  return (
    <button className={`dash-tile vd-card${onClick ? ' link' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="dash-label">{label}</span>
      <span className={`dash-value ${status ?? ''}`}>{value}</span>
      {sub && <span className="dash-sub">{sub}</span>}
    </button>
  );
}

/** Cumulative voltage drop along the supply path, each cable a step, against the limit. */
function VdProfile({ path, limit, title, isWorst }: { path: VdRow[]; limit: number; title: string; isWorst: boolean }) {
  const W = 760, H = 190, L = 44, R = 16, T = 18, B = 46;
  const total = path[path.length - 1].totalPct;
  const top = Math.max(limit * 1.15, total * 1.1, 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const step = (W - L - R) / path.length;
  let cum = path[0].upstreamPct;
  const ticks = [0, limit / 2, limit].concat(top > limit * 1.4 ? [Math.round(top)] : []);
  return (
    <section className="card vd-profile">
      <h4>Voltage drop profile — {title} <span className="m">{isWorst ? '(worst path)' : ''} · source → load</span></h4>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Voltage drop profile">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="vd-grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="vd-ax">{t.toFixed(1)}%</text></g>)}
        <line x1={L} x2={W - R} y1={y(limit)} y2={y(limit)} className="vd-limit" />
        <text x={W - R} y={y(limit) - 4} textAnchor="end" className="vd-ax bad">limit {limit} %</text>
        {path.map((r, i) => {
          const x = L + i * step;
          const from = cum;
          cum += r.vdPct;
          return (
            <g key={r.feeder.id}>
              <rect x={x + 6} y={y(cum)} width={step - 12} height={Math.max(1, y(from) - y(cum))} className={`vd-bar ${r.status}`}><title>{`${r.feeder.id}: +${r.vdPct.toFixed(2)} % → ${cum.toFixed(2)} %`}</title></rect>
              <rect x={x + 6} y={y(from)} width={step - 12} height={Math.max(0, y(0) - y(from))} className="vd-base" />
              <text x={x + step / 2} y={y(cum) - 5} textAnchor="middle" className="vd-val">{cum.toFixed(2)}%</text>
              <text x={x + step / 2} y={H - B + 16} textAnchor="middle" className="vd-lbl">{r.from.id} → {r.toName.length > 16 ? r.toName.slice(0, 15) + '…' : r.toName}</text>
              <text x={x + step / 2} y={H - B + 30} textAnchor="middle" className="vd-sub">{cableSizeText(r.feeder)} · {r.feeder.lengthM} m · +{r.vdPct.toFixed(2)}%</text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

/** A busbar riser: concentrated and distributed lengths, section by section, and the quick check. */
function RiserVdCard({ v }: { v: RiserVd }) {
  const diff = v.uniformTopPct - v.exactTopPct;
  return (
    <section className="card vd-riser">
      <h4>{v.riser.name} <span className="m">from {v.riser.sourceBoardId ?? '—'} · {v.designA.toFixed(0)} A · z = {(v.zOhmPerM * 1000).toFixed(3)} mΩ/m</span></h4>
      <div className="vd-riser-sum">
        <span>Concentrated length <b>{v.concentratedM.toFixed(1)} m</b> <span className="m">(feed + up to the first tap-off, full current)</span></span>
        <span>Distributed length <b>{v.distributedM.toFixed(1)} m</b> <span className="m">(first to last tap-off)</span></span>
        <span>Upstream <b>{v.upstreamPct.toFixed(2)} %</b></span>
        <span>Top tap-off, floor by floor <b className={v.status}>{v.exactTopPct.toFixed(2)} %</b></span>
        <span title="ΔV = √3 · I · z · (Lc + Ld / 2): the load taken as spread evenly along the distributed length">Uniform-load check <b>{v.uniformTopPct.toFixed(2)} %</b> <span className="m">({diff >= 0 ? '+' : ''}{diff.toFixed(2)})</span></span>
      </div>
      <table className="schedule vd-table">
        <thead><tr><th>Section</th><th>Part</th><th>Length (m)</th><th>Current (A)</th><th>Vd (%)</th><th>Total at end (%)</th><th>Limit</th><th>Result</th></tr></thead>
        <tbody>
          {v.segments.map((s, i) => {
            const st: Status = s.cumPct > v.limitPct ? 'bad' : s.cumPct > v.limitPct * 0.85 ? 'warn' : 'ok';
            return (
              <tr key={i}>
                <td>{s.label}</td>
                <td className="m">{s.kind === 'concentrated' ? 'concentrated' : 'distributed'}</td>
                <td>{s.lengthM.toFixed(1)}</td>
                <td>{s.currentA.toFixed(0)}</td>
                <td>{s.vdPct.toFixed(3)}</td>
                <td className={st}><b>{s.cumPct.toFixed(2)}</b></td>
                <td>{v.limitPct.toFixed(1)}</td>
                <StatusCell status={st} />
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="m">Each riser section carries only the tap-offs above it. Quick check for a uniformly distributed load: ΔV = √3 · I · z · (Lc + Ld/2). The tap-off cable to each floor's DB is added on top when that DB's incomer is in the list.</p>
    </section>
  );
}
