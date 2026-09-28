import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { cables } from '../../calc/cableTable';
import { cableSizeText } from '../../calc/electrical';
import { boardsInSupplyOrder } from '../../calc/summary';
import { addVdCable, editVdCable, groupByPanel, vdCandidates, vdRow, type VdEdit, type VdRow } from '../../calc/voltageDrop';
import { buildVdReportHtml, scopeLabel, VD_HEADERS, vdCells } from '../../docs/voltageDropReport';
import { saveCsv, savePdf, safeFileName } from '../../util/files';
import EditCell from '../EditCell';
import { Page, StatusCell, StatusCounts } from '../ui';

const PHASES = [
  { value: '4', label: '3-ph · 4 core' },
  { value: '3', label: '3-ph · 3 core' },
  { value: '2', label: '1-ph · 2 core' }
];

/** Voltage drop calculation for panel-to-panel and equipment cables. The
 * user picks the cables (whole panels or single cables); final circuits
 * below DBs are left out, and a DB's load comes from its load schedule. */
export default function VoltageDropStudy({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const [scope, setScope] = useState(''); // '' = entire system, else a board id
  const [busy, setBusy] = useState(false);
  const candidates = useMemo(() => vdCandidates(project), [project]);
  const selected = useMemo(() => new Set(project.vdSelection ?? []), [project.vdSelection]);
  const panels = useMemo(
    () => boardsInSupplyOrder(project).map((b) => ({ board: b, cables: candidates.filter((f) => f.boardId === b.id) })).filter((p) => p.cables.length),
    [project, candidates]
  );
  const rows = useMemo(
    () => candidates.filter((f) => selected.has(f.id) && (!scope || f.boardId === scope)).map((f) => vdRow(project, f)),
    [project, candidates, selected, scope]
  );
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
      const m = await savePdf(`${safeFileName(`${project.name} voltage drop ${scope || 'system'}`)}.pdf`, buildVdReportHtml(project, rows, scopeName));
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }
  async function exportCsv() {
    const m = await saveCsv(`${project.name} voltage drop ${scope || 'system'}`, VD_HEADERS, rows.map(vdCells));
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
      intro="Choose the cables to calculate on the left: a whole panel or single cables. Final circuits below each DB are not included — a DB's load comes from its load schedule. Double-click a white cell to change it; changes also update the SLD and schedules."
      actions={
        <>
          <select className="chip" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Report scope">
            <option value="">Report: entire system</option>
            {panels.map(({ board }) => <option key={board.id} value={board.id}>Report: panel {board.id}</option>)}
          </select>
          <button className="chip" onClick={addCable} title={`Add a cable to equipment (AHU, isolator, motor…) on ${scope || panels[0]?.board.id}`}>+ Add equipment cable</button>
          <button className="chip" onClick={exportCsv} disabled={!rows.length}>Export CSV (Excel)</button>
          <button className="chip primary" onClick={exportPdf} disabled={busy || !rows.length}>{busy ? 'Exporting…' : 'Export PDF'}</button>
        </>
      }
    >
      <div className="vd-layout">
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
                  <b>{board.id}</b> <span className="m">entire panel · {n}/{fs.length}</span>
                </label>
                {fs.map((f) => {
                  const to = f.feedsBoardId ?? f.name ?? f.id;
                  return (
                    <label key={f.id} className="vd-cable-row">
                      <input type="checkbox" checked={selected.has(f.id)} onChange={(e) => toggle([f.id], e.target.checked)} />
                      → {to} <span className="m">{f.id}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </aside>

        <div className="vd-main">
          <div className="vd-summary">
            <b>{scopeName}</b> · {rows.length} cable{rows.length === 1 ? '' : 's'} · <StatusCounts statuses={rows.map((r) => r.status)} />
          </div>
          {rows.length === 0 ? (
            <p className="m vd-empty">
              {selected.size ? `No selected cables on ${scope}.` : 'No cables selected yet. Tick a panel or single cables on the left to start the calculation.'}
            </p>
          ) : (
            <table className="schedule vd-table">
              <thead>
                <tr>{VD_HEADERS.map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {groupByPanel(rows).map(({ board, rows: rs }) => [
                  <tr key={`h-${board.id}`} className="vd-group">
                    <td colSpan={VD_HEADERS.length}>{board.id} – {board.name}{board.kind ? ` (${board.kind})` : ''}</td>
                  </tr>,
                  ...rs.map((r) => (
                    <tr key={r.feeder.id}>
                      <td>{r.feeder.id}</td>
                      <td>{r.from.id}</td>
                      {r.toBoard ? (
                        <EditCell kind="text" value="" onCommit={() => undefined} display={r.toName} locked={`Panel ${r.toBoard.id} – ${r.toBoard.name}`} />
                      ) : (
                        <EditCell kind="text" value={r.feeder.name} display={r.toName} title="Equipment name (e.g. AHU-01, isolator) — double-click to edit" onCommit={(v) => edit(r.feeder.id, { name: v || r.feeder.id })} />
                      )}
                      <td>{r.toType}</td>
                      {loadCell(r)}
                      <EditCell kind="number" min={0.1} max={1} value={r.pf} display={r.pf.toFixed(2)} onCommit={(v) => edit(r.feeder.id, { powerFactor: v })} />
                      <td>{r.ib.toFixed(1)}</td>
                      <EditCell kind="select" value={String(r.feeder.cores)} options={PHASES} display={r.threePhase ? '3-ph' : '1-ph'} onCommit={(v) => edit(r.feeder.id, { cores: +v as 2 | 3 | 4 })} />
                      <EditCell kind="select" value={String(r.feeder.cableCsaMm2)} options={cableSizes} display={cableSizeText(r.feeder)} onCommit={(v) => edit(r.feeder.id, { cableCsaMm2: +v })} />
                      <EditCell kind="number" min={1} value={r.feeder.lengthM} display={r.feeder.lengthM.toFixed(0)} onCommit={(v) => edit(r.feeder.id, { lengthM: v })} />
                      <td>{r.mvPerAm.toFixed(3)}</td>
                      <td>{r.vdV.toFixed(2)}</td>
                      <td>{r.vdPct.toFixed(2)}</td>
                      <td>{r.upstreamPct.toFixed(2)}</td>
                      <td className={r.status}><b>{r.totalPct.toFixed(2)}</b></td>
                      <td>{r.limitPct.toFixed(1)}</td>
                      <StatusCell status={r.status} />
                      <EditCell kind="text" value={r.feeder.remarks ?? ''} display={r.feeder.remarks ?? ''} className="vd-remarks" onCommit={(v) => edit(r.feeder.id, { remarks: v })} />
                    </tr>
                  ))
                ])}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Page>
  );
}
