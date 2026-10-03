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
      intro="UPS rating from the load (a UPS board's demand on the SLD, or a list of loads) with growth and the design loading — covering both kVA and kW. Battery for the backup time by the constant-power method: DC power ÷ inverter efficiency, the capacity a battery gives at that discharge rate, ageing (1.25), temperature and design margin. Check the final battery against the manufacturer's constant-power table."
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
  const chem = (c: BatteryChem) => onPatch(c === 'vrla' ? { chem: c, blockV: 12, endCellV: 1.75 } : { chem: c, blockV: 51.2, endCellV: undefined }, true);

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

      <div className="plan-cards">
        <div><span>Load{board ? ` (${board.id} demand)` : ''}</span><b>{f1(r.loadKva)} kVA · {f1(r.loadKw)} kW</b><small>with growth, at {s.maxLoadingPct} %: {f1(r.designKva)} kVA · {f1(r.designKw)} kW</small></div>
        <div><span>UPS rating</span><b className={r.upsKva ? '' : 'bad'}>{r.upsKva ? `${r.upsKva} kVA · ${f1(r.upsKw!)} kW` : `> ${STANDARD_UPS_KVA[STANDARD_UPS_KVA.length - 1]} kVA`}</b><small>{r.loadingPct !== undefined ? `${f0(r.loadingPct)} % loaded today (${r.loadingBy} limit) · ${f0(r.loadingKvaPct!)} % of kVA · ${f0(r.loadingKwPct!)} % of kW` : ''}</small></div>
        <div><span>Battery</span><b>{r.blockAh ? `${r.strings > 1 ? `${r.strings} × ` : ''}${r.blocksPerString} × ${s.blockV} V ${r.blockAh} Ah` : '—'}</b><small>{r.totalBlocks} {s.chem === 'vrla' ? 'blocks' : 'modules'} · {f1(r.energyKwh)} kWh · needs {f1(r.requiredAh)} Ah</small></div>
        <div><span>Backup with this battery</span><b className={r.runtimeMin !== undefined && r.runtimeMin >= s.autonomyMin ? 'ok' : 'bad'}>{r.runtimeMin !== undefined ? `${f0(r.runtimeMin)} min` : '—'}</b><small>required {s.autonomyMin} min</small></div>
        <div><span>DC side</span><b>{f0(r.dcCurrentMaxA)} A max</b><small>{f1(r.dcKw)} kW from the battery · DC breaker {r.dcBreakerA} A</small></div>
      </div>
      {r.notes.length > 0 && <p className="m">{r.notes.join(' · ')}</p>}
      {board && r.upsKva && board.upsKva !== r.upsKva && (
        <div><button className="chip" onClick={() => onApply(r.upsKva!)}>Set {board.id} to {r.upsKva} kVA on the SLD{board.upsKva ? ` (now ${board.upsKva} kVA)` : ''}</button></div>
      )}
      <p className="m ups-foot">Block sizes considered: {(s.chem === 'vrla' ? VRLA_BLOCK_AH : LI_MODULE_AH).join(', ')} Ah. Capacity at {s.autonomyMin} min: {f0(r.rate * 100)} % of C10 ({s.rateCapacityPct ? 'your figure' : 'typical'}).</p>
    </section>
  );
}
