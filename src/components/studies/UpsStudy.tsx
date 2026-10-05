import { useState } from 'react';
import type { Project } from '../../types';
import { LI_MODULE_AH, sizeUps, UPS_DEFAULTS, VRLA_BLOCK_AH, DC_VOLTAGES, type BatteryChem, type UpsLoad, type UpsSystem } from '../../calc/ups';
import { STANDARD_UPS_KVA } from '../../calc/sizing';
import { boardsInSupplyOrder } from '../../calc/summary';
import { buildUpsReportHtml } from '../../docs/upsSolarReport';
import { safeFileName, savePdf } from '../../util/files';
import { NumField, Page } from '../ui';

const f1 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const f0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** UPS and battery sizing: one card per UPS, fed from a UPS board of the
 * SLD (its demand) or from a list of loads. */
export default function UpsStudy({ project, onChange, onStatus }: {
  project: Project;
  onChange: (p: Project, step?: boolean) => void;
  onStatus: (m: string) => void;
}) {
  const list = project.upsSystems ?? [];
  const set = (next: UpsSystem[], step = false) => onChange({ ...project, upsSystems: next }, step);
  const patch = (id: string, p: Partial<UpsSystem>, step = false) => set(list.map((s) => (s.id === id ? { ...s, ...p } : s)), step);
  const upsBoards = project.boards.filter((b) => b.kind === 'UPS');
  const [busy, setBusy] = useState(false);

  function fromBoards() {
    const missing = upsBoards.filter((b) => !list.some((s) => s.boardId === b.id));
    if (!missing.length) return onStatus(upsBoards.length ? 'Every UPS board already has a UPS here' : 'No UPS boards on the SLD — drop a "UPS" board on a busbar, or add a UPS with a load list');
    set([...list, ...missing.map((b) => ({ ...UPS_DEFAULTS, id: newId('ups'), name: b.id, boardId: b.id }))], true);
    onStatus(`Added ${missing.length} UPS from the SLD: ${missing.map((b) => b.id).join(', ')}`);
  }
  function add() {
    let n = list.length + 1;
    while (list.some((s) => s.name === `UPS-${n}`)) n++;
    set([...list, { ...UPS_DEFAULTS, id: newId('ups'), name: `UPS-${n}`, loads: [{ id: newId('l'), name: 'Load', qty: 1, w: 1000, pf: 0.9 }] }], true);
  }
  async function exportPdf() {
    setBusy(true);
    try {
      const m = await savePdf(`${safeFileName(project.name)} - UPS and battery sizing.pdf`, buildUpsReportHtml(project, list), { pageSize: 'A4', landscape: false });
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="UPS & battery sizing"
      intro="UPS rating from the load (a UPS board's demand on the SLD, or a list of loads) with growth and the design loading — covering both kVA and kW. Battery sizing uses an Ah estimate or entered manufacturer constant-power data, with ageing, temperature and design margin. Lithium options include SOC reserve and BMS current; charger inputs provide a recharge estimate."
      actions={
        <>
          <button className="chip" onClick={fromBoards}>From UPS boards</button>
          <button className="chip" onClick={add}>+ UPS</button>
          <button className="chip primary" disabled={busy || !list.length} onClick={exportPdf}>{busy ? 'Exporting…' : 'Export PDF'}</button>
        </>
      }
    >
      {list.map((s) => <UpsCard key={s.id} project={project} s={s} upsBoardIds={upsBoards.map((b) => b.id)}
        onPatch={(p, step) => patch(s.id, p, step)}
        onRemove={() => window.confirm(`Remove ${s.name}?`) && set(list.filter((x) => x.id !== s.id), true)}
        onApply={(kva) => {
          onChange({ ...project, boards: project.boards.map((b) => (b.id === s.boardId ? { ...b, upsKva: kva } : b)) }, true);
          onStatus(`${s.boardId}: UPS set to ${kva} kVA on the SLD`);
        }} />)}
      {!list.length && (
        <div className="tray-empty">
          <p className="m">No UPS yet. <b>From UPS boards</b> takes each UPS board of the SLD with its load, or add one with a list of loads.</p>
          <button className="chip primary" onClick={fromBoards}>From UPS boards</button> <button className="chip" onClick={add}>+ UPS</button>
        </div>
      )}
    </Page>
  );
}

function UpsCard({ project, s, upsBoardIds, onPatch, onRemove, onApply }: {
  project: Project;
  s: UpsSystem;
  upsBoardIds: string[];
  onPatch: (p: Partial<UpsSystem>, step?: boolean) => void;
  onRemove: () => void;
  onApply: (kva: number) => void;
}) {
  const r = sizeUps(project, s);
  const board = project.boards.find((b) => b.id === s.boardId);
  const setLoad = (id: string, p: Partial<UpsLoad>) => onPatch({ loads: s.loads.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const boards = boardsInSupplyOrder(project);
  const chem = (c: BatteryChem) => onPatch(c === 'vrla' ? { chem: c, blockV: 12, endCellV: 1.75 } : { chem: c, blockV: 51.2, endCellV: undefined, powerTable: undefined }, true);

  return (
    <section className="dm-card">
      <div className="dm-head">
        <label>UPS<input key={`n-${s.name}`} defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && onPatch({ name: e.target.value.trim() }, true)} /></label>
        <label>Load from
          <select value={s.boardId ?? ''} onChange={(e) => onPatch({ boardId: e.target.value || undefined }, true)}>
            <option value="">A list of loads</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.id}{upsBoardIds.includes(b.id) ? ' (UPS board)' : ''} — its demand</option>)}
          </select>
        </label>
        <span className="sp" />
        <button className="icon-btn" title={`Remove ${s.name}`} onClick={onRemove}>✕</button>
      </div>

      {!s.boardId && (
        <table className="schedule ups-loads">
          <thead><tr><th className="l">Load</th><th>Qty</th><th>W each</th><th>VA each</th><th>PF</th><th>Total kW</th><th /></tr></thead>
          <tbody>
            {s.loads.map((l) => {
              const pf = l.pf ?? 0.9;
              return (
                <tr key={l.id}>
                  <td><input key={`ln-${l.name}`} defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && setLoad(l.id, { name: e.target.value })} /></td>
                  <td><NumField label="" value={l.qty} width={50} min={0} onSet={(v) => setLoad(l.id, { qty: v ?? 1 })} /></td>
                  <td><NumField label="" value={l.w} width={70} optional placeholder={l.va ? f0(l.va * pf) : ''} onSet={(v) => setLoad(l.id, { w: v })} /></td>
                  <td><NumField label="" value={l.va} width={70} optional placeholder={l.w ? f0(l.w / pf) : ''} onSet={(v) => setLoad(l.id, { va: v })} /></td>
                  <td><NumField label="" value={l.pf} width={50} optional placeholder="0.9" min={0.1} max={1} onSet={(v) => setLoad(l.id, { pf: v })} /></td>
                  <td>{f1(((l.w ?? (l.va ?? 0) * pf) * l.qty) / 1000)}</td>
                  <td><button className="icon-btn" title="Remove" onClick={() => onPatch({ loads: s.loads.filter((x) => x.id !== l.id) }, true)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!s.boardId && <div><button className="chip" onClick={() => onPatch({ loads: [...s.loads, { id: newId('l'), name: 'Load', qty: 1, w: 500, pf: 0.9 }] }, true)}>+ Load</button></div>}

      <div className="ups-settings">
        <NumField label="Growth" unit="%" value={s.growthPct} width={55} min={0} onSet={(v) => onPatch({ growthPct: v ?? 0 })} />
        <NumField label="Max loading" unit="%" value={s.maxLoadingPct} width={55} min={10} max={100} onSet={(v) => onPatch({ maxLoadingPct: v ?? 80 })} />
        <NumField label="UPS output PF" value={s.outputPf} width={55} min={0.5} max={1} onSet={(v) => onPatch({ outputPf: v ?? 0.9 })} />
        <NumField label="Inverter efficiency" unit="%" value={+(s.inverterEff * 100).toFixed(1)} width={55} min={50} max={100} onSet={(v) => onPatch({ inverterEff: (v ?? 94) / 100 })} />
        <NumField label="Backup time" unit="min" value={s.autonomyMin} width={55} min={1} onSet={(v) => onPatch({ autonomyMin: v ?? 15 })} />
        <label className="nf"><span>Battery</span>
          <select value={s.chem} onChange={(e) => chem(e.target.value as BatteryChem)}>
            <option value="vrla">VRLA lead-acid</option>
            <option value="li-ion">Lithium-ion (LFP)</option>
          </select>
        </label>
        <label className="nf"><span>DC bus</span>
          <select value={s.dcVoltage} onChange={(e) => onPatch({ dcVoltage: +e.target.value }, true)}>
            {[...new Set([...DC_VOLTAGES, s.dcVoltage])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v} V</option>)}
          </select>
        </label>
        <NumField label={s.chem === 'vrla' ? 'Block voltage' : 'Module voltage'} unit="V" value={s.blockV} width={55} min={1} onSet={(v) => onPatch({ blockV: v ?? 12 })} />
        {s.chem === 'vrla' && <NumField label="End voltage / cell" unit="V" value={s.endCellV} width={55} min={1.6} max={1.9} onSet={(v) => onPatch({ endCellV: v ?? 1.75 })} />}
        <NumField label="Capacity at this rate" unit="% C10" value={s.rateCapacityPct} optional placeholder={f0(r.rate * 100)} width={55} title="Blank = typical figure for the backup time; enter the manufacturer's" onSet={(v) => onPatch({ rateCapacityPct: v })} />
        <NumField label="Ageing factor" value={s.ageing} width={55} min={1} onSet={(v) => onPatch({ ageing: v ?? 1.25 })} />
        <NumField label="Temperature factor" value={s.tempFactor} width={55} min={0.8} onSet={(v) => onPatch({ tempFactor: v ?? 1 })} title="1.0 at 25 °C; e.g. 1.11 at 15 °C (IEEE 485)" />
        <NumField label="Design margin" value={s.designMargin} width={55} min={1} onSet={(v) => onPatch({ designMargin: v ?? 1.1 })} />
      </div>

      {s.chem === 'vrla' && <details open={!!s.powerTable}>
        <summary>Manufacturer constant-power table (W per block)</summary>
        <label><input type="checkbox" checked={!!s.powerTable} onChange={e => onPatch({ powerTable: e.target.checked ? { model: '', source: '', blockAh: 100, blockV: s.blockV, endCellV: s.endCellV ?? 1.75, temperatureC: 25, points: [] } : undefined }, true)} /> Use exact model data instead of generic Ah sizing</label>
        {s.powerTable && <>
          <div className="ups-settings">
            <label>Battery model<input value={s.powerTable.model} onChange={e => onPatch({ powerTable: { ...s.powerTable!, model: e.target.value } })} /></label>
            <label>Datasheet source / revision<input value={s.powerTable.source} onChange={e => onPatch({ powerTable: { ...s.powerTable!, source: e.target.value } })} /></label>
            {(['blockAh', 'blockV', 'endCellV', 'temperatureC'] as const).map(key => <NumField key={key} label={{ blockAh: 'Model capacity (Ah)', blockV: 'Table block voltage (V)', endCellV: 'Table end voltage / cell (V)', temperatureC: 'Table temperature (°C)' }[key]} value={s.powerTable![key]} onSet={v => onPatch({ powerTable: { ...s.powerTable!, [key]: v ?? 0 } })} />)}
          </div>
          <table className="schedule"><thead><tr><th>Duration (min)</th><th>Watts per block</th><th /></tr></thead><tbody>{s.powerTable.points.map((point, i) => <tr key={i}><td><NumField label="" value={point.minutes} onSet={v => onPatch({ powerTable: { ...s.powerTable!, points: s.powerTable!.points.map((p, j) => j === i ? { ...p, minutes: v ?? 0 } : p) } })} /></td><td><NumField label="" value={point.wattsPerBlock} onSet={v => onPatch({ powerTable: { ...s.powerTable!, points: s.powerTable!.points.map((p, j) => j === i ? { ...p, wattsPerBlock: v ?? 0 } : p) } })} /></td><td><button className="chip" onClick={() => onPatch({ powerTable: { ...s.powerTable!, points: s.powerTable!.points.filter((_, j) => j !== i) } }, true)}>Remove row</button></td></tr>)}</tbody></table>
          <button className="chip" onClick={() => onPatch({ powerTable: { ...s.powerTable!, points: [...s.powerTable!.points, { minutes: (s.powerTable!.points[s.powerTable!.points.length - 1]?.minutes ?? 0) + 15, wattsPerBlock: 0 }] } }, true)}>+ Discharge row</button>
          <p className="m">Enter at least two rows in increasing duration. Use W/block from one model at the stated end voltage and temperature. Between durations the longer-duration row is used; values outside the table are rejected.</p>
        </>}
      </details>}
      {s.chem === 'li-ion' && <div className="ups-settings">
        <NumField label="Starting SOC" unit="%" value={s.startSocPct ?? 100} min={0} max={100} onSet={v => onPatch({ startSocPct: v ?? 100 })} />
        <NumField label="Minimum SOC reserve" unit="%" value={s.minSocPct ?? 0} min={0} max={100} onSet={v => onPatch({ minSocPct: v ?? 0 })} />
        <NumField label="Module end voltage" unit="V" optional value={s.endModuleV} placeholder={f1(s.blockV * 2.8 / 3.2)} onSet={v => onPatch({ endModuleV: v })} />
        <NumField label="BMS continuous current / string" unit="A" optional value={s.bmsDischargeA} onSet={v => onPatch({ bmsDischargeA: v })} title="Parallel strings share current equally. Verify permitted series and parallel module counts with the manufacturer." />
      </div>}
      <details open={!!s.surge}><summary>Inverter starting-load / overload check</summary>
        <label><input type="checkbox" checked={!!s.surge} onChange={e => onPatch({ surge: e.target.checked ? { source: '' } : undefined }, true)} /> Check coincident starting demand</label>
        {s.surge && <><div className="ups-settings">
          <label>Inverter model / overload datasheet<input value={s.surge.source} onChange={e => onPatch({ surge: { ...s.surge!, source: e.target.value } })} /></label>
          {(['totalKw', 'totalKva', 'durationSeconds', 'ratedKw', 'ratedKva', 'ratedSeconds'] as const).map(key => <NumField key={key} label={{ totalKw: 'Total starting kW', totalKva: 'Total starting kVA', durationSeconds: 'Starting duration (s)', ratedKw: 'Inverter peak kW', ratedKva: 'Inverter peak kVA', ratedSeconds: 'Supported peak duration (s)' }[key]} optional value={s.surge![key]} min={0} onSet={v => onPatch({ surge: { ...s.surge!, [key]: v } })} />)}
        </div><p className="m">Enter the total simultaneous starting demand, including loads already running. Growth is applied once. Use power and duration from the same overload duty for the selected inverter model; this does not change the continuous UPS selection.</p></>}
      </details>
      <details><summary>Charger and recharge estimate</summary><div className="ups-settings">
        <NumField label="Total charger output" unit="A" optional value={s.chargerCurrentA} onSet={v => onPatch({ chargerCurrentA: v })} />
        <NumField label="Concurrent shared DC load" unit="A" value={s.rechargeLoadA ?? 0} onSet={v => onPatch({ rechargeLoadA: v ?? 0 })} />
        <NumField label="Recharge starting SOC" unit="%" value={s.rechargeFromSocPct ?? 20} onSet={v => onPatch({ rechargeFromSocPct: v ?? 20 })} />
        <NumField label="Recharge target SOC" unit="%" value={s.rechargeToSocPct ?? 100} onSet={v => onPatch({ rechargeToSocPct: v ?? 100 })} />
        <NumField label="Charge efficiency" unit="%" value={s.chargeEfficiencyPct ?? 95} onSet={v => onPatch({ chargeEfficiencyPct: v ?? 95 })} />
        <NumField label="Absorption / taper allowance" unit="h" value={s.absorptionHours ?? 0} onSet={v => onPatch({ absorptionHours: v ?? 0 })} />
      </div><p className="m">Bulk estimate at constant current plus your absorption allowance. Confirm battery charging limits and the charger profile.</p></details>
      <div className="plan-cards">
        <div><span>Load{board ? ` (${board.id} demand)` : ''}</span><b>{f1(r.loadKva)} kVA · {f1(r.loadKw)} kW</b><small>with growth, at {s.maxLoadingPct} %: {f1(r.designKva)} kVA · {f1(r.designKw)} kW</small></div>
        <div><span>UPS rating</span><b className={r.upsKva ? '' : 'bad'}>{r.upsKva ? `${r.upsKva} kVA · ${f1(r.upsKw!)} kW` : `> ${STANDARD_UPS_KVA[STANDARD_UPS_KVA.length - 1]} kVA`}</b><small>{r.loadingPct !== undefined ? `${f0(r.loadingPct)} % loaded today (${r.loadingBy} limit) · ${f0(r.loadingKvaPct!)} % of kVA · ${f0(r.loadingKwPct!)} % of kW` : ''}</small></div>
        <div><span>Battery{r.busMismatch ? ` — ${+r.stringV.toFixed(2)} V string, not ${s.dcVoltage} V` : ''}</span><b className={r.busMismatch || r.batteryIssue ? 'bad' : ''}>{r.busMismatch ? 'Not valid: ' : ''}{r.blockAh ? `${r.strings > 1 ? `${r.strings} × ` : ''}${r.blocksPerString} × ${s.blockV} V ${r.blockAh} Ah` : '—'}</b><small>{r.totalBlocks} {s.chem === 'vrla' ? 'blocks' : 'modules'} · {f1(r.energyKwh)} kWh · {r.batteryBasis === 'manufacturer table' ? `${r.tableWattsPerBlock ?? '—'} W/block at ${r.tableMinutes ?? '—'} min` : `needs ${f1(r.requiredAh)} Ah`}</small></div>
        <div><span>Backup with this battery</span><b className={!r.busMismatch && !r.batteryIssue && r.runtimeMin !== undefined && r.runtimeMin >= s.autonomyMin ? 'ok' : 'bad'}>{r.runtimeMin !== undefined ? `${f0(r.runtimeMin)} min` : '—'}</b><small>required {s.autonomyMin} min</small></div>
        <div><span>DC side</span><b>{f0(r.dcCurrentMaxA)} A max</b><small className={r.dcBreakerNoFit ? 'bad' : ''}>{f1(r.dcKw)} kW from the battery · {r.dcBreakerNoFit ? `No suitable DC breaker in the list — ${f0(r.dcBreakerRequiredA)} A needed, largest ${r.dcBreakerMaxA} A` : r.dcBreakerA ? `battery-bus DC breaker ${r.dcBreakerA} A` : 'no DC breaker (no load)'}</small></div>
        {s.surge && <div><span>Inverter surge check</span><b className={r.surge.status === 'pass' ? 'ok' : r.surge.status === 'fail' ? 'bad' : ''}>{r.surge.status}</b><small>{r.surge.kw !== undefined ? `${f1(r.surge.kw)} kW · ${f1(r.surge.kva!)} kVA with growth · ` : ''}{r.surge.issue}</small></div>}
        {s.chem === 'li-ion' && <div><span>Usable SOC / BMS</span><b>{f0(r.usableFraction * 100)} % · {f1(r.usableEnergyKwh)} kWh nominal</b><small>{f1(r.stringCurrentA)} A per string · {r.bmsOk === undefined ? 'BMS not checked' : r.bmsOk ? 'continuous current within limit' : 'BMS check failed'}</small></div>}
        {s.chargerCurrentA !== undefined && <div><span>Recharge estimate</span><b className={r.rechargeIssue ? 'bad' : ''}>{r.rechargeHours !== undefined ? `${f1(r.rechargeHours)} h` : '—'}</b><small>{f1(r.rechargeNetA ?? 0)} A available · bulk + {s.absorptionHours ?? 0} h absorption allowance</small></div>}
      </div>
      {r.notes.length > 0 && <p className="m">{r.notes.join(' · ')}</p>}
      {r.busMismatch && <div><button className="chip" onClick={() => onPatch({ dcVoltage: +r.stringV.toFixed(2) }, true)} title="Only if the UPS, charger and BMS accept this voltage — check the manufacturer's data">Set the DC bus to {+r.stringV.toFixed(2)} V ({r.blocksPerString} × {s.blockV} V)</button></div>}
      {board && r.upsKva && board.upsKva !== r.upsKva && (
        <div><button className="chip" onClick={() => onApply(r.upsKva!)}>Set {board.id} to {r.upsKva} kVA on the SLD{board.upsKva ? ` (now ${board.upsKva} kVA)` : ''}</button></div>
      )}
      <p className="m ups-foot" hidden={!!s.powerTable}>Block sizes considered: {(s.chem === 'vrla' ? VRLA_BLOCK_AH : LI_MODULE_AH).join(', ')} Ah. Capacity at {s.autonomyMin} min: {f0(r.rate * 100)} % of C10 ({s.rateCapacityPct ? 'your figure' : 'typical'}).</p>
    </section>
  );
}
