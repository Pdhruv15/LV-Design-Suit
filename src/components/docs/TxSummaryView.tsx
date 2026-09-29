import { useMemo } from 'react';
import type { Board, Project } from '../../types';
import { acbText, buildTxSummary, rowCtText } from '../../docs/txSummary';
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
  const In = ({ value, onSet, w = 56, ph }: { value?: string | number; onSet: (v: string) => void; w?: number; ph?: string }) => (
    <input className="txs-in" style={{ width: w }} defaultValue={value ?? ''} key={String(value ?? '')} placeholder={ph}
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
      <div className="txs-wrap">
        <table className="txs-table">
          <thead>
            <tr>
              <th rowSpan={2}>TRANSFORMER REFERENCE</th><th rowSpan={2}>SP/TP</th><th colSpan={2}>RATING - AMPS</th><th rowSpan={2}>FAULT DUTY kA</th>
              <th colSpan={3}>CABLE SIZE</th><th rowSpan={2}>ECC SIZE 1C, mm²</th><th colSpan={3}>CONNECTION LOAD - kW</th>
              <th rowSpan={2}>TCL (kW)</th><th rowSpan={2}>D.F</th><th rowSpan={2}>MDL (kW)</th><th colSpan={3}>kWH METER</th><th rowSpan={2}>Remarks</th>
            </tr>
            <tr>
              <th>ACB</th><th>MCCB</th><th>PVC/XLPE/SWA/PVC</th><th>2/4X1C mm²</th><th>2/3/4C mm²</th>
              <th>R-PHASE kW</th><th>Y-PHASE kW</th><th>B-PHASE kW</th><th>1 - 0 (1)</th><th>3 - 0 (2)</th><th>CT (3)</th>
            </tr>
          </thead>
          <tbody>
            {s.groups.map((g) => [
              <tr key={`g-${g.name}`} className="txs-group">
                <td colSpan={19}>
                  <In value={g.name} w={220} onSet={(v) => g.rows.forEach((r) => setBoard(r.board.id, { substation: v.trim() || undefined }))} />
                </td>
              </tr>,
              ...g.rows.map((r) => (
                <tr key={r.board.id}>
                  <td className="txs-ref">{r.board.id}</td>
                  <td>{r.poles}</td>
                  <td colSpan={r.device === 'ACB' ? 1 : 1} className="txs-acb">
                    {r.device === 'ACB' ? <>
                      <In value={r.ratingA} w={52} onSet={(v) => setSupply(r.board, { ratingA: num(v) })} /> @ <In value={r.setting ?? ''} ph="1.0" w={40} onSet={(v) => setSupply(r.board, { irSetting: num(v) })} />
                    </> : ''}
                  </td>
                  <td>{r.device === 'MCCB' ? <In value={r.ratingA} w={52} onSet={(v) => setSupply(r.board, { ratingA: num(v) })} /> : ''}</td>
                  <td><In value={r.faultKa} w={44} onSet={(v) => setSupply(r.board, { faultKa: num(v) })} /></td>
                  <td colSpan={3}><In value={r.cable} w={170} onSet={(v) => setSupply(r.board, { cable: v || undefined })} /></td>
                  <td><In value={r.ecc} w={70} ph="2X150" onSet={(v) => setSupply(r.board, { ecc: v || undefined })} /></td>
                  <td>{kw(r.phases.R)}</td><td>{kw(r.phases.Y)}</td><td>{kw(r.phases.B)}</td>
                  <td><b>{kw(r.tclKw)}</b></td>
                  <td><In value={r.df} w={44} onSet={(v) => setBoard(r.board.id, { mdDemandFactor: num(v) })} /></td>
                  <td><b>{kw(r.mdlKw)}</b></td>
                  <td>{r.meters['1-PH'] || ''}</td><td>{r.meters['3-PH'] || ''}</td><td>{r.meters.CT || ''}</td>
                  <td className="txs-rem">{rowCtText(r)}</td>
                </tr>
              ))
            ])}
            <tr className="txs-total">
              <td colSpan={9} className="txs-right">TOTAL CONNECTED - LOAD PER PHASE</td>
              <td>{kw(s.phases.R)}</td><td>{kw(s.phases.Y)}</td><td>{kw(s.phases.B)}</td>
              <td>{kw(s.tclKw)}</td><td /><td>{kw(s.mdlKw)}</td>
              <td>{s.meters['1-PH'] || ''}</td><td>{s.meters['3-PH'] || ''}</td><td>{s.meters.CT || ''}</td>
              <td className="txs-rem">{s.ctText}</td>
            </tr>
          </tbody>
        </table>
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
