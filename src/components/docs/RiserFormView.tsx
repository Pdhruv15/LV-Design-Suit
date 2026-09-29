import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { buildRiserForm, type RiserFormRow } from '../../docs/riserForm';
import { revisionStamp } from '../../model/revisions';

const kw = (v: number) => v.toFixed(2);

/** Bus bar riser — details of connected load / max. demand (DEWA), one riser at a time. */
export default function RiserFormView({ project, onOpenRiser }: { project: Project; onOpenRiser: () => void }) {
  const risers = project.busRisers ?? [];
  const [sel, setSel] = useState(risers[0]?.id ?? '');
  const id = risers.some((r) => r.id === sel) ? sel : risers[0]?.id;
  const f = useMemo(() => (id ? buildRiserForm(project, id) : null), [project, id]);
  if (!f) return <p className="m">No busbar riser in this project. <button className="linkish" onClick={onOpenRiser}>Add one (Calculate → Busbar riser)</button></p>;
  const cells = (r: RiserFormRow) => (
    <>
      <td className="gx-calc">{kw(r.phases.R)}</td><td className="gx-calc">{kw(r.phases.Y)}</td><td className="gx-calc">{kw(r.phases.B)}</td>
      <td className="gx-calc"><b>{kw(r.tcl)}</b></td>
    </>
  );
  return (
    <div className="md-form txs">
      {risers.length > 1 && (
        <div className="seg" style={{ marginBottom: 8 }}>{risers.map((r) => <button key={r.id} className={r.id === id ? 'on' : ''} onClick={() => setSel(r.id)}>{r.name}</button>)}</div>
      )}
      <div className="md-head" style={{ gridTemplateColumns: '1fr 1.6fr 1fr' }}>
        <div><b>BUS BAR RISER</b></div>
        <div className="md-title">DETAILS OF CONNECTED LOAD / MAX. DEMAND</div>
        <div className="md-rev">{revisionStamp(project)}</div>
        <div><span>PROJECT:</span> <b>{project.name}</b></div><div /><div />
        <div><span>BUS BAR RISER REF:</span> <b>{f.ref}</b></div><div /><div />
        <div><span>FED FROM:</span> <b>{f.fedFrom}</b></div>
      </div>
      <div className="gx-wrap txs-wrap">
        <table className="gx txs-table">
          <thead>
            <tr>
              <th className="gx-blank" colSpan={2} /><th className="gx-group" colSpan={2}>RATING - AMPS</th><th className="gx-blank" />
              <th className="gx-group" colSpan={3}>CABLE SIZE, TYPE &amp; No.OF CORES</th><th className="gx-blank" />
              <th className="gx-group" colSpan={3}>CONNECTION LOAD - KW</th><th className="gx-blank" colSpan={3} />
              <th className="gx-group" colSpan={3}>PROPOSED TYPE &amp; No OF kWh METER</th><th className="gx-blank" />
            </tr>
            <tr>
              <th>CIRCUIT FEEDER / SMDB /DB NO.</th><th>SP/TP</th><th>ACB</th><th>MCCB</th><th>FAULT DUTY (kA)</th>
              <th>NO. OF CORES: 1C/2C/4C</th><th>TYPE: XLPE/PVC/SWA</th><th>SIZE</th><th>ECC SIZE 1C mm2</th>
              <th>R-PH kW</th><th>Y-PH kW</th><th>B-PH kW</th><th>TCL (kW)</th><th>D.F</th><th>MD (kW)</th>
              <th>1-PH (1)</th><th>3-PH (2)</th><th>LV/HV-CT (3)</th><th>REMARKS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="gx-calc"><b>INCOMER</b></td><td className="gx-calc">TP</td><td className="gx-calc">{f.incomer.acb ?? ''}</td><td className="gx-calc" />
              <td className="gx-calc">{f.incomer.faultKa ?? ''}</td><td className="gx-calc" colSpan={4}>{f.incomer.busway}</td>
              {cells(f.incomer)}<td className="gx-calc" colSpan={6} /><td className="gx-calc" />
            </tr>
            <tr><td className="gx-label" colSpan={19}>OUTGOINGS</td></tr>
            {f.rows.map((r, k) => (
              <tr key={k}>
                <td className="gx-calc l">{r.name}</td><td className="gx-calc">{r.sptp}</td><td className="gx-calc">{r.acb ?? ''}</td><td className="gx-calc">{r.mccb ?? ''}</td>
                <td className="gx-calc">{r.faultKa ?? ''}</td><td className="gx-calc">{r.cores ?? ''}</td><td className="gx-calc">{r.type ?? ''}</td><td className="gx-calc">{r.size ?? ''}</td><td className="gx-calc">{r.ecc ?? ''}</td>
                {cells(r)}<td className="gx-calc">{r.df?.toFixed(2)}</td><td className="gx-calc"><b>{kw(r.md ?? 0)}</b></td>
                <td className="gx-calc">{r.meters['1-PH']}</td><td className="gx-calc">{r.meters['3-PH']}</td><td className="gx-calc">{r.meters.CT}</td><td className="gx-calc l">{r.remarks ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9} style={{ textAlign: 'right' }}>TOTAL CONNECTED - LOAD PER PHASE</td>
              <td>{kw(f.totals.phases.R)}</td><td>{kw(f.totals.phases.Y)}</td><td>{kw(f.totals.phases.B)}</td><td>{kw(f.totals.tcl)}</td><td /><td>{kw(f.totals.md)}</td>
              <td>{f.totals.meters['1-PH']}</td><td>{f.totals.meters['3-PH']}</td><td>{f.totals.meters.CT}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="txs-foot">
        <div><span>TCL (kW)</span> <b className="txs-box">{kw(f.totals.tcl)}</b></div>
        <div><span>MDL (kW)</span> <b className="txs-box">{kw(f.totals.md)}</b></div>
        <div><span>DF</span> <b className="txs-box">{f.df.toFixed(2)}</b></div>
        <p className="m">From Calculate → Busbar riser: each tap-off feeds the board chosen for that floor (its incomer breaker, cable, loads and meters), or a load entered there. D.F per board as on the TCL summary. <button className="linkish" onClick={onOpenRiser}>Edit the riser</button></p>
      </div>
    </div>
  );
}
