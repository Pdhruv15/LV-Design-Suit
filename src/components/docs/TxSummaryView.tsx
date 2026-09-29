import { useMemo } from 'react';
import type { Board, Project } from '../../types';
import { addTransformerRow, buildTxSummary, nextSubstationName, rowCtText } from '../../docs/txSummary';
import { deleteBoard } from '../../model/edit';
import { revisionStamp } from '../../model/revisions';

const kw = (v: number) => v.toFixed(2);
const num = (v: string) => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);

/** Summary of the TCL at transformer level (DEWA form), one row per
 * transformer grouped by substation. White cells are typed; the loads and
 * meters come from everything each transformer feeds. */
export default function TxSummaryView({ project, onChange, onSettings }: { project: Project; onChange: (p: Project) => void; onSettings: () => void }) {
  const s = useMemo(() => buildTxSummary(project), [project]);
  const h = s.header;
  const setBoard = (id: string, patch: Partial<Board>) => onChange({ ...project, boards: project.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const setSupply = (b: Board, patch: NonNullable<Board['supply']>) => setBoard(b.id, { supply: { ...b.supply, ...patch } });
  const addRow = (substation: string) => onChange(addTransformerRow(project, substation).project);
  const removeRow = (id: string, manual: boolean) => {
    if (!window.confirm(manual ? `Remove ${id}?` : `Remove ${id} and every board and circuit below it?`)) return;
    try { onChange(deleteBoard(project, id)); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); }
  };
  const In = ({ value, onSet, w = '100%', ph }: { value?: string | number; onSet: (v: string) => void; w?: number | string; ph?: string }) => (
    <input style={{ width: w }} defaultValue={value ?? ''} key={String(value ?? '')} placeholder={ph}
      onBlur={(e) => e.target.value !== String(value ?? '') && onSet(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
  const blank = (v: string) => v || <span className="md-blank" title="Set in Project settings">—</span>;

  return (
    <div className="md-form txs">
      <div className="md-head">
        <div><span>PROJECT:</span> <b>{h.project}</b></div>
        <div className="md-title">DETAILS OF CONNECTED LOAD, MAX DEMAND &amp; kWh METERING</div>
        <div><span>AREA:</span> {blank(h.area)} <span className="md-rev">{revisionStamp(project)}</span></div>
        <div><span>PLANNED COMPLETION DATE:</span> {blank(h.completion)}</div>
        <div><span>OWNER:</span> {blank(h.owner)}</div>
        <div><span>PLOT No:</span> {blank(h.plotNo)}</div>
        <div><b>SUMMARY OF THE TCL AT TRANSFORMER LEVEL</b></div>
        <div><span>CONSULTANT:</span> {blank(h.consultant)}</div>
        <div><span>LOC:</span> {blank(h.location.toUpperCase())}</div>
      </div>
      <div className="gx-wrap txs-wrap">
        <table className="gx txs-table">
          <thead>
            <tr>
              <th className="gx-blank" colSpan={2} /><th className="gx-group" colSpan={2}>RATING - AMPS</th><th className="gx-blank" />
              <th className="gx-group" colSpan={3}>CABLE SIZE</th><th className="gx-blank" /><th className="gx-group" colSpan={3}>CONNECTION LOAD - kW</th>
              <th className="gx-blank" colSpan={3} /><th className="gx-group" colSpan={3}>kWH METER</th><th className="gx-blank" colSpan={2} />
            </tr>
            <tr>
              <th>TRANSFORMER REFERENCE</th><th>SP/TP</th><th>ACB</th><th>MCCB</th><th>FAULT DUTY kA</th>
              <th>PVC/XLPE/SWA/PVC</th><th>2/4X1C mm²</th><th>2/3/4C mm²</th><th>ECC SIZE 1C, mm²</th>
              <th>R-PHASE kW</th><th>Y-PHASE kW</th><th>B-PHASE kW</th><th>TCL (kW)</th><th>D.F</th><th>MDL (kW)</th>
              <th>1 - 0 (1)</th><th>3 - 0 (2)</th><th>CT (3)</th><th>REMARKS</th><th />
            </tr>
          </thead>
          <tbody>
            {s.groups.map((g) => [
              <tr key={`g-${g.name}`}>
                <td className="gx-label gx-in l" colSpan={18}>
                  <In value={g.name} w="100%" onSet={(v) => g.rows.forEach((r) => setBoard(r.board.id, { substation: v.trim() || undefined }))} />
                </td>
                <td className="gx-label" colSpan={2} style={{ textAlign: 'right' }}>
                  <button className="chip txs-add" onClick={() => addRow(g.name)} title={`Add a transformer to ${g.name}`}>+ Transformer</button>
                </td>
              </tr>,
              ...g.rows.map((r) => (
                <tr key={r.board.id}>
                  <td className="gx-in l txs-ref"><In value={r.board.txRef ?? r.board.id} w="100%" onSet={(v) => setBoard(r.board.id, { txRef: v.trim() && v.trim() !== r.board.id ? v.trim() : undefined })} /></td>
                  <td className="gx-calc">{r.poles}</td>
                  {r.device === 'ACB'
                    ? <td className="gx-in txs-acb"><In value={r.ratingA} w={52} onSet={(v) => setSupply(r.board, { ratingA: num(v) })} /><span>@</span><In value={r.setting ?? ''} ph="1.0" w={42} onSet={(v) => setSupply(r.board, { irSetting: num(v) })} /></td>
                    : <td className="gx-calc" />}
                  {r.device === 'MCCB'
                    ? <td className="gx-in"><In value={r.ratingA} onSet={(v) => setSupply(r.board, { ratingA: num(v) })} /></td>
                    : <td className="gx-calc" />}
                  <td className="gx-in"><In value={r.faultKa} onSet={(v) => setSupply(r.board, { faultKa: num(v) })} /></td>
                  <td className="gx-in" colSpan={3}><In value={r.cable} w="100%" onSet={(v) => setSupply(r.board, { cable: v || undefined })} /></td>
                  <td className="gx-in"><In value={r.ecc} ph="2X150" onSet={(v) => setSupply(r.board, { ecc: v || undefined })} /></td>
                  {(['R', 'Y', 'B'] as const).map((ph) => r.manual
                    ? <td key={ph} className="gx-in"><In value={r.phases[ph] ? kw(r.phases[ph]) : ''} ph="0.00" onSet={(v) => setBoard(r.board.id, { summaryLoad: { ...{ R: 0, Y: 0, B: 0 }, ...r.board.summaryLoad, [ph]: num(v) ?? 0 } })} /></td>
                    : <td key={ph} className="gx-calc" title="From the boards and load schedules below">{kw(r.phases[ph])}</td>)}
                  <td className="gx-calc"><b>{kw(r.tclKw)}</b></td>
                  <td className="gx-in"><In value={r.df} onSet={(v) => setBoard(r.board.id, { mdDemandFactor: num(v) })} /></td>
                  <td className="gx-calc"><b>{kw(r.mdlKw)}</b></td>
                  {(['1-PH', '3-PH', 'CT'] as const).map((m) => r.manual
                    ? <td key={m} className="gx-in"><In value={r.meters[m] || ''} onSet={(v) => setBoard(r.board.id, { summaryMeters: { ...r.board.summaryMeters, [m]: num(v) ?? 0 } })} /></td>
                    : <td key={m} className="gx-calc" title="kWh meters of everything below">{r.meters[m] || ''}</td>)}
                  <td className="gx-in l txs-rem"><In value={r.board.supply?.ctRatio ? `${r.board.supply.ctRatio} CT` : rowCtText(r)} w="100%" onSet={(v) => setSupply(r.board, { ctRatio: v.replace(/\s*CT\s*$/i, '').trim() || undefined })} /></td>
                  <td className="txs-act">
                    <button className="icon-btn" title={r.manual ? 'Remove this transformer' : `Remove ${r.board.id} and everything below it`} onClick={() => removeRow(r.board.id, r.manual)}>✕</button>
                  </td>
                </tr>
              ))
            ])}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9} style={{ textAlign: 'right' }}>TOTAL CONNECTED - LOAD PER PHASE</td>
              <td>{kw(s.phases.R)}</td><td>{kw(s.phases.Y)}</td><td>{kw(s.phases.B)}</td>
              <td>{kw(s.tclKw)}</td><td /><td>{kw(s.mdlKw)}</td>
              <td>{s.meters['1-PH'] || ''}</td><td>{s.meters['3-PH'] || ''}</td><td>{s.meters.CT || ''}</td>
              <td className="l txs-rem">{s.ctText}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="txs-under">
        <button className="chip" onClick={() => addRow(nextSubstationName(s))}>+ Substation</button>
        <span className="m">White cells are typed. A new transformer takes its loads and meters as typed here until boards are drawn below it on the SLD — then they come from there.</span>
      </div>
      <div className="txs-foot">
        <div><span>DIVERSITY FACTOR</span> <b className="txs-box">{s.diversity.toFixed(2)}</b> <span>TOTAL</span></div>
        <div><span>MAX. DEMAND - 3 PHASE</span> <b className="txs-box">{s.mdlKw.toFixed(1)}</b> <span>kW</span>
          <span className="txs-gap">TCL =</span> <b className="txs-box">{s.tclKw.toFixed(1)}</b> <span>kW</span></div>
        <div><span className="txs-gap2">TCL (DUTY) =</span> <b className="txs-box">{s.tclDutyKw.toFixed(1)}</b> <span>kW</span>
          <span className="m"> — TCL without the standby units (tick “Standby unit” on a feeder, e.g. a standby pump)</span></div>
        <p className="m">
          One row per transformer (main board), from everything it feeds. Breaker setting = transformer full-load current ÷ breaker rating, rounded up to 0.05, unless typed.
          Meters: the transformer’s own (CT above 125 A) and every kWh meter below it; CT ratio from the breaker (× setting).
          D.F per transformer (blank = the project’s). <button className="chip" onClick={onSettings}>Edit form details…</button>
        </p>
      </div>
    </div>
  );
}
