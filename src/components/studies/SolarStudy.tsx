import { useState } from 'react';
import type { Project } from '../../types';
import { INVERTER_KW, PV_DEFAULTS, acConnection, sizePv, type PvInverter, type PvMode, type PvPanel, type PvSystem } from '../../calc/solar';
import { pvToSld } from '../../model/pvFeeder';
import { boardsInSupplyOrder } from '../../calc/summary';
import { buildPvReportHtml } from '../../docs/upsSolarReport';
import { safeFileName, savePdf } from '../../util/files';
import { NumField, Page } from '../ui';

const f1 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const f0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f2 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Solar PV: array size (by kWp, roof area or daily energy), panels, string
 * design against the inverter's voltage and current limits at the site's
 * temperature extremes, inverters, yield and savings — and the PV feeder
 * on the SLD. */
export default function SolarStudy({ project, onChange, onStatus }: {
  project: Project;
  onChange: (p: Project, step?: boolean) => void;
  onStatus: (m: string) => void;
}) {
  const s: PvSystem = { ...PV_DEFAULTS, ...project.pv, panel: { ...PV_DEFAULTS.panel, ...project.pv?.panel }, inverter: { ...PV_DEFAULTS.inverter, ...project.pv?.inverter } };
  const set = (p: Partial<PvSystem>, step = false) => onChange({ ...project, pv: { ...s, ...p } }, step);
  const setPanel = (p: Partial<PvPanel>) => set({ panel: { ...s.panel, ...p } });
  const setInv = (p: Partial<PvInverter>) => set({ inverter: { ...s.inverter, ...p } });
  const r = sizePv(s, project.voltageV);
  const boards = boardsInSupplyOrder(project);
  const target = s.boardId ?? boards[0]?.id ?? '';
  const pvId = `PV-${target}`;
  const existing = project.feeders.find((f) => f.id === pvId);
  const acKw = r.inverters * s.inverter.acKw;
  const [busy, setBusy] = useState(false);

  function addToSld() {
    const res = pvToSld(project, s, r, target);
    if (!res) return;
    if (res.unresolved) {
      onStatus(`Not ${res.existing ? 'updated' : 'added'}: ${pvId} on ${target} can't be sized as one ${f1(acKw)} kW connection — ${res.unresolved}. Configure separate inverter groups / feeders explicitly.`);
      return;
    }
    const sized = res.feeder;
    onChange(res.project, true);
    onStatus(`${res.existing ? 'Updated' : 'Added'} ${pvId} on ${target}: ${f1(acKw)} kW ${s.inverter.phases === 1 ? `one-phase${sized.phase ? ` on ${sized.phase}` : ' (phase not set)'}` : 'three-phase'}, ${sized.breakerRatingA} A, ${sized.cores}C × ${sized.cableCsaMm2} mm² — press Run (F5)`);
  }
  async function exportPdf() {
    setBusy(true);
    try {
      const m = await savePdf(`${safeFileName(project.name)} - Solar PV sizing.pdf`, buildPvReportHtml(project, s, r), { pageSize: 'A4', landscape: false });
      if (m) onStatus(m);
    } finally {
      setBusy(false);
    }
  }

  const check = (ok: boolean) => <td className={ok ? 'ok' : 'bad'}>{ok ? 'OK' : 'Fail'}</td>;

  return (
    <Page
      title="Solar PV — panels and inverter"
      intro="Size the array by kWp, by roof area or by daily energy; the string length comes from the panel voltages at the site's coldest and hottest cell temperatures against the inverter's DC and MPPT limits (IEC 62548). Yield = kWp × peak sun hours × performance ratio. Enter the chosen panel's and inverter's datasheet values — the defaults are generic."
      actions={<button className="chip primary" disabled={busy || !r.panels} onClick={exportPdf}>{busy ? 'Exporting…' : 'Export PDF'}</button>}
    >
      <div className="sr-grid">
        <section className="sr-box">
          <h4>Array</h4>
          <label className="nf"><span>Size by</span>
            <select value={s.mode} onChange={(e) => set({ mode: e.target.value as PvMode }, true)}>
              <option value="kwp">Target kWp</option>
              <option value="area">Roof area</option>
              <option value="energy">Daily energy</option>
            </select>
          </label>
          {s.mode === 'kwp' && <NumField label="Target" unit="kWp" value={s.targetKwp} min={0} onSet={(v) => set({ targetKwp: v })} />}
          {s.mode === 'area' && <NumField label="Roof area" unit="m²" value={s.roofAreaM2} min={0} onSet={(v) => set({ roofAreaM2: v })} />}
          {s.mode === 'energy' && <NumField label="Energy" unit="kWh/day" value={s.dailyKwh} min={0} onSet={(v) => set({ dailyKwh: v })} />}
          <NumField label="Roof usable for panels" unit="%" value={s.roofUsePct} min={10} max={100} onSet={(v) => set({ roofUsePct: v ?? 60 })} title="Access paths, setbacks, row spacing and shading" />
          <NumField label="DC / AC ratio" value={s.dcAcRatio} min={0.8} max={1.6} onSet={(v) => set({ dcAcRatio: v ?? 1.2 })} />
          <h4 className="sr-sub">Site (Dubai defaults)</h4>
          <NumField label="Peak sun hours" unit="kWh/m²/day" value={s.peakSunHours} min={1} onSet={(v) => set({ peakSunHours: v ?? 5.8 })} />
          <NumField label="Min ambient" unit="°C" value={s.tMinC} onSet={(v) => set({ tMinC: v ?? 10 })} />
          <NumField label="Max ambient" unit="°C" value={s.tMaxC} onSet={(v) => set({ tMaxC: v ?? 48 })} />
          <NumField label="Average daytime ambient" unit="°C" value={s.tAvgC} onSet={(v) => set({ tAvgC: v ?? 35 })} />
          <h4 className="sr-sub">Losses</h4>
          <NumField label="Soiling" unit="%" value={s.soilingPct} min={0} onSet={(v) => set({ soilingPct: v ?? 0 })} />
          <NumField label="Mismatch" unit="%" value={s.mismatchPct} min={0} onSet={(v) => set({ mismatchPct: v ?? 0 })} />
          <NumField label="DC cable" unit="%" value={s.dcCablePct} min={0} onSet={(v) => set({ dcCablePct: v ?? 0 })} />
          <NumField label="AC cable" unit="%" value={s.acCablePct} min={0} onSet={(v) => set({ acCablePct: v ?? 0 })} />
          <NumField label="Tariff" unit="per kWh" value={s.tariff} optional onSet={(v) => set({ tariff: v })} />
          <NumField label="Grid emission factor" unit="kg CO₂/kWh" value={s.gridKgPerKwh} min={0} onSet={(v) => set({ gridKgPerKwh: v ?? 0.4 })} />
        </section>

        <section className="sr-box">
          <h4>Panel (datasheet)</h4>
          <label className="nf"><span>Model</span><input key={s.panel.name} defaultValue={s.panel.name} onBlur={(e) => e.target.value !== s.panel.name && setPanel({ name: e.target.value })} /></label>
          <NumField label="Pmax" unit="W" value={s.panel.pmaxW} min={1} onSet={(v) => setPanel({ pmaxW: v ?? 550 })} />
          <NumField label="Voc" unit="V" value={s.panel.vocV} min={1} onSet={(v) => setPanel({ vocV: v ?? 49.6 })} />
          <NumField label="Vmp" unit="V" value={s.panel.vmpV} min={1} onSet={(v) => setPanel({ vmpV: v ?? 41.7 })} />
          <NumField label="Isc" unit="A" value={s.panel.iscA} min={0.1} onSet={(v) => setPanel({ iscA: v ?? 14 })} />
          <NumField label="Imp" unit="A" value={s.panel.impA} min={0.1} onSet={(v) => setPanel({ impA: v ?? 13.2 })} />
          <NumField label="Voc temp. coefficient" unit="%/°C" value={s.panel.betaVocPct} onSet={(v) => setPanel({ betaVocPct: v ?? -0.27 })} />
          <NumField label="Pmax temp. coefficient" unit="%/°C" value={s.panel.gammaPmaxPct} onSet={(v) => setPanel({ gammaPmaxPct: v ?? -0.35 })} />
          <NumField label="NOCT" unit="°C" value={s.panel.noctC} onSet={(v) => setPanel({ noctC: v ?? 45 })} />
          <NumField label="Length" unit="m" value={s.panel.lengthM} min={0.1} onSet={(v) => setPanel({ lengthM: v ?? 2.278 })} />
          <NumField label="Width" unit="m" value={s.panel.widthM} min={0.1} onSet={(v) => setPanel({ widthM: v ?? 1.134 })} />
        </section>

        <section className="sr-box">
          <h4>Inverter (datasheet)</h4>
          <label className="nf"><span>Model</span><input key={s.inverter.name} defaultValue={s.inverter.name} onBlur={(e) => e.target.value !== s.inverter.name && setInv({ name: e.target.value })} /></label>
          <label className="nf"><span>AC rating</span>
            <select value={s.inverter.acKw} onChange={(e) => setInv({ acKw: +e.target.value })}>
              {[...new Set([...INVERTER_KW, s.inverter.acKw])].sort((a, b) => a - b).map((k) => <option key={k} value={k}>{k} kW</option>)}
            </select>
          </label>
          <label className="nf"><span>Phases</span>
            <select value={s.inverter.phases} onChange={(e) => setInv({ phases: +e.target.value as 1 | 3 })}>
              <option value={3}>3-phase</option><option value={1}>1-phase</option>
            </select>
          </label>
          {s.inverter.phases === 1 && (
            <label className="nf" title="Which phase the one-phase connection uses. Not set: the generation is spread evenly over R / Y / B in the board's phase totals.">
              <span>Connected to</span>
              <select value={s.acPhase ?? ''} onChange={(e) => set({ acPhase: (e.target.value || undefined) as PvSystem['acPhase'] })}>
                <option value="">Phase not set</option><option value="R">R</option><option value="Y">Y</option><option value="B">B</option>
              </select>
            </label>
          )}
          <NumField label="Max DC voltage" unit="V" value={s.inverter.maxDcV} min={100} onSet={(v) => setInv({ maxDcV: v ?? 1100 })} />
          <NumField label="MPPT min" unit="V" value={s.inverter.mpptMinV} min={10} onSet={(v) => setInv({ mpptMinV: v ?? 200 })} />
          <NumField label="MPPT max" unit="V" value={s.inverter.mpptMaxV} min={10} onSet={(v) => setInv({ mpptMaxV: v ?? 1000 })} />
          <NumField label="MPPTs" value={s.inverter.mppts} min={1} onSet={(v) => setInv({ mppts: Math.round(v ?? 4) })} />
          <NumField label="Max input current / MPPT" unit="A" value={s.inverter.maxInputA} min={1} onSet={(v) => setInv({ maxInputA: v ?? 40 })} />
          <NumField label="Efficiency" unit="%" value={s.inverter.efficiencyPct} min={80} max={100} onSet={(v) => setInv({ efficiencyPct: v ?? 98 })} />
        </section>
      </div>

      <div className="plan-cards">
        <div><span>Array</span><b>{r.panels} × {s.panel.pmaxW} W = {f2(r.kwp)} kWp</b><small>{r.strings} strings × {r.perString} panels</small></div>
        <div><span>Inverters</span><b>{r.inverters} × {s.inverter.acKw} kW = {f1(acKw)} kW</b><small>DC/AC {r.dcAcRatio.toFixed(2)} · {r.stringsPerMppt} string{r.stringsPerMppt === 1 ? '' : 's'} per MPPT</small></div>
        <div><span>Area</span><b>{f0(r.arrayAreaM2)} m² of panels</b><small>≈ {f0(r.roofNeededM2)} m² of roof at {s.roofUsePct} % use</small></div>
        <div><span>Energy</span><b>{f0(r.dailyKwh)} kWh/day · {f0(r.annualKwh / 1000)} MWh/yr</b><small>{f0(r.specificYield)} kWh/kWp · PR {f1(r.prPct)} %</small></div>
        <div><span>Savings / CO₂</span><b>{r.savings !== undefined ? `${f0(r.savings)} per year` : '—'}</b><small>{f1(r.co2Tonnes)} t CO₂ avoided per year</small></div>
        <div><span>AC connection</span><b className={r.acBreakerNoFit ? 'bad' : ''}>{f0(r.acCurrentA)} A · {r.acBreakerNoFit ? 'No suitable breaker in the available list' : r.acBreakerA ? `${r.acBreakerA} A breaker` : 'no breaker (no generation)'}</b>{r.acBreakerNoFit && <small className="bad">needs {f0(r.acBreakerRequiredA)} A (1.25 × I); largest available {r.acBreakerMaxA} A</small>}<small>{acConnection(s, project.voltageV).text}{s.inverter.phases === 1 && r.inverters > 1 ? ` · ${r.inverters} inverters counted together on one phase connection` : ''}</small></div>
      </div>

      <h3 className="section-title">String design check</h3>
      <table className="schedule pv-check">
        <thead><tr><th className="l">Check</th><th>Value</th><th>Limit</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td className="l">String Voc at {s.tMinC} °C ({r.perString} × {f2(r.vocColdV)} V)</td><td>{f0(r.perString * r.vocColdV)} V</td><td>≤ {s.inverter.maxDcV} V max DC</td>{check(r.perString * r.vocColdV <= s.inverter.maxDcV)}</tr>
          <tr><td className="l">String Vmp at {f0(r.tCellMaxC)} °C cell ({r.perString} × {f2(r.vmpHotV)} V)</td><td>{f0(r.perString * r.vmpHotV)} V</td><td>≥ {s.inverter.mpptMinV} V MPPT min</td>{check(r.perString * r.vmpHotV >= s.inverter.mpptMinV)}</tr>
          <tr><td className="l">String Vmp at {s.tMinC} °C ({r.perString} × {f2(r.vmpColdV)} V)</td><td>{f0(r.perString * r.vmpColdV)} V</td><td>≤ {s.inverter.mpptMaxV} V MPPT max</td>{check(r.perString * r.vmpColdV <= s.inverter.mpptMaxV)}</tr>
          <tr><td className="l">MPPT input current ({r.stringsPerMppt} × 1.25 × Isc)</td><td>{f1(r.mpptCurrentA)} A</td><td>≤ {s.inverter.maxInputA} A</td>{check(r.mpptCurrentA <= s.inverter.maxInputA)}</tr>
          <tr><td className="l">Panels per string that fit</td><td>{r.minPerString} – {r.maxPerString}</td><td>chosen {r.perString}</td>{check(r.perString >= r.minPerString && r.perString <= r.maxPerString && r.perString > 0)}</tr>
        </tbody>
      </table>
      {r.notes.length > 0 && <p className={r.status === 'bad' ? 'bad' : 'm'}>{r.notes.join(' · ')}</p>}

      <h3 className="section-title">On the SLD</h3>
      <div className="dm-head">
        <label>Connect to board
          <select value={target} onChange={(e) => set({ boardId: e.target.value }, true)}>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
        </label>
        <button className="chip primary" disabled={!r.inverters} onClick={addToSld}>{existing ? `Update ${pvId}` : `Add ${pvId} to the SLD`}</button>
        <span className="m">A generation feeder of {f1(acKw)} kW with its breaker and cable sized — it then appears in the studies and schedules.</span>
      </div>
    </Page>
  );
}
