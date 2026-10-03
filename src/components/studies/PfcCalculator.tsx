import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { calcPfc, PFC_CALC_DEFAULT, phasorSvg, powerTriangleSvg, type PfcCalcInput, type PfcInputMode } from '../../calc/pfcCalc';
import { capacitorFeeder } from '../../calc/pfc';
import { pfcReportHtml } from '../../docs/pfcReport';
import { safeFileName, savePdf } from '../../util/files';

const MODES: [PfcInputMode, string][] = [['kw-pf', 'kW + PF'], ['kva-pf', 'kVA + PF'], ['vi-pf', 'V, A + PF'], ['bill', 'DEWA bill'], ['loads', 'List of loads']];
const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

function Num({ label, value, onSet, unit, step = 'any', title }: { label: string; value?: number; onSet: (v: number | undefined) => void; unit?: string; step?: string; title?: string }) {
  return (
    <label title={title}>{label}
      <span className="pfcc-in"><input inputMode="decimal" value={value ?? ''} step={step} onChange={(e) => { const t = e.target.value.trim(); if (t === '') return onSet(undefined); const n = Number(t); if (Number.isFinite(n)) onSet(n); }} />{unit && <span className="m">{unit}</span>}</span>
    </label>
  );
}

/** Power factor correction for an existing installation: measured values, a bill or a load list → bank, diagrams and report. */
export default function PfcCalculator({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const input: PfcCalcInput = { ...PFC_CALC_DEFAULT, voltageV: project.voltageV, ...project.pfcCalc };
  const set = (patch: Partial<PfcCalcInput>) => onChange({ ...project, pfcCalc: { ...input, ...patch } });
  const r = useMemo(() => calcPfc(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [board, setBoard] = useState(project.boards.find((b) => !b.upstreamId)?.id ?? '');
  const loads = input.loads ?? [];

  async function report() {
    const m = await savePdf(`${safeFileName(`${project.name} power factor correction${input.title ? ` ${input.title}` : ''}`)}.pdf`, pfcReportHtml(project, input, r), { pageSize: 'A4' });
    if (m) onStatus(m);
  }
  function toDesign() {
    if (!board || !r.bankKvar) return;
    let n = 1;
    while (project.feeders.some((f) => f.id === `${board}-PFC${n}`)) n++;
    const f = capacitorFeeder(project, board, `${board}-PFC${n}`, `Capacitor bank ${r.bankKvar} kvar`, r.bankKvar, r.steps, r.detunedPct);
    onChange({ ...project, feeders: [...project.feeders, f] });
    onStatus(`Added ${f.id}: ${r.bankKvar} kvar installed, ${r.steps} × ${r.stepKvar} kvar${r.detunedPct ? `, ${r.detunedPct} % detuned` : ''} on ${board}${r.targetReached ? '' : ` — note: these steps don't reach PF ${r.targetPf} at the entered load`} — Run (F5)`);
  }

  return (
    <div className="pfcc">
      <section className="card pfcc-inputs">
        <h4>Custom calculation</h4>
        <label>Name / location<input className="bi-text" value={input.title ?? ''} placeholder="e.g. MDB-1, Warehouse 3" onChange={(e) => set({ title: e.target.value || undefined })} /></label>
        <div className="seg pfcc-modes">{MODES.map(([m, l]) => <button key={m} className={input.mode === m ? 'on' : ''} onClick={() => set({ mode: m })}>{l}</button>)}</div>
        <div className="form-kv">
          {input.mode === 'kw-pf' && <><Num label="Active power" unit="kW" value={input.kw} onSet={(v) => set({ kw: v })} /><Num label="Power factor now" value={input.pf} onSet={(v) => set({ pf: v })} /></>}
          {input.mode === 'kva-pf' && <><Num label="Apparent power" unit="kVA" value={input.kva} onSet={(v) => set({ kva: v })} /><Num label="Power factor now" value={input.pf} onSet={(v) => set({ pf: v })} /></>}
          {input.mode === 'vi-pf' && <><Num label="Current (per phase)" unit="A" value={input.currentA} onSet={(v) => set({ currentA: v })} /><Num label="Power factor now" value={input.pf} onSet={(v) => set({ pf: v })} /></>}
          {input.mode === 'bill' && <><Num label="Active energy" unit="kWh" value={input.kwh} onSet={(v) => set({ kwh: v })} /><Num label="Reactive energy" unit="kvarh" value={input.kvarh} onSet={(v) => set({ kvarh: v })} /><Num label="Operating hours in the period" unit="h" value={input.hours} onSet={(v) => set({ hours: v })} title="e.g. 720 for a month running 24 h; fewer for an office" /></>}
          <Num label="Voltage" unit="V" value={input.voltageV} onSet={(v) => v && set({ voltageV: v })} />
          <Num label="Target power factor" value={input.targetPf} onSet={(v) => v && set({ targetPf: v })} title="DEWA minimum 0.90; 0.95 is usual" />
          <label>Step size<select value={input.stepKvar} onChange={(e) => set({ stepKvar: Number(e.target.value) })}>{[5, 10, 12.5, 25, 50].map((s) => <option key={s} value={s}>{s} kvar</option>)}</select></label>
          <label>Harmonics<select value={input.harmonics} onChange={(e) => set({ harmonics: e.target.value as PfcCalcInput['harmonics'] })}>
            <option value="none">None — mostly linear loads</option><option value="some">Some — VFDs, UPS, LED (≤ 25 %)</option><option value="high">High — mostly VFD / UPS / IT</option>
          </select></label>
          <Num label="Measured current THD (optional)" unit="%" value={input.thdIPct} onSet={(v) => set({ thdIPct: v })} />
          <Num label="Transformer (optional)" unit="kVA" value={input.transformerKva} onSet={(v) => set({ transformerKva: v })} />
          <Num label="Present losses (optional)" unit="kW" value={input.lossesKw} onSet={(v) => set({ lossesKw: v })} title="Cable / transformer copper losses now, to estimate the saving" />
        </div>
        {input.mode === 'loads' && (
          <table className="bi-table compact pfcc-loads">
            <thead><tr><th>Load</th><th>kW</th><th>PF</th><th>Qty</th><th /></tr></thead>
            <tbody>
              {loads.map((l, i) => (
                <tr key={i}>
                  <td><input className="bi-text" style={{ width: 120 }} value={l.name} onChange={(e) => set({ loads: loads.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} /></td>
                  {(['kw', 'pf', 'qty'] as const).map((k) => <td key={k}><input className="bi-num" style={{ width: 56 }} inputMode="decimal" value={l[k]} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set({ loads: loads.map((x, j) => (j === i ? { ...x, [k]: n } : x)) }); }} /></td>)}
                  <td><button className="icon-btn" onClick={() => set({ loads: loads.filter((_, k) => k !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {input.mode === 'loads' && <button className="chip" onClick={() => set({ loads: [...loads, { name: 'Load', kw: 10, pf: 0.85, qty: 1 }] })}>+ Load</button>}
      </section>

      <div className="pfcc-out">
        {r.p <= 0 ? <section className="card"><p className="m">Enter the {input.mode === 'bill' ? 'kWh, kvarh and hours from the bill' : input.mode === 'loads' ? 'loads' : 'measured values'} on the left — the bank, diagrams and report appear here.</p></section> : <>
        <div className="vd-cards">
          <div className="dash-tile"><span className="dash-label">Power factor</span><span className="dash-value"><span className={r.pf1 < input.targetPf ? 'warn' : 'ok'}>{r.pf1.toFixed(2)}</span> → <span className={r.pf2 >= input.targetPf - 1e-9 ? 'ok' : 'warn'}>{r.pf2.toFixed(3)}</span></span><span className="dash-sub">target {input.targetPf}</span></div>
          <div className="dash-tile"><span className="dash-label">Capacitor bank</span><span className="dash-value">{r.bankKvar ? `${r.bankKvar} kvar` : 'None'}</span><span className={`dash-sub${r.bankKvar && !r.targetReached ? ' warn' : ''}`}>{r.bankKvar ? `installed ${r.steps} × ${r.stepKvar} kvar · ${r.activeSteps} switched in (${r.activeKvar} kvar)${r.targetReached ? '' : ' · target not reachable'}${r.detunedPct ? ` · ${r.detunedPct} % detuned` : ''} · need ${f1(r.requiredKvar)}` : 'already at target'}</span></div>
          <div className="dash-tile"><span className="dash-label">Load</span><span className="dash-value">{f0(r.p)} kW</span><span className="dash-sub">{f0(r.s1)} → {f0(r.s2)} kVA · frees {f0(r.releasedKva)} kVA</span></div>
          <div className="dash-tile"><span className="dash-label">Current</span><span className="dash-value">{f0(r.i1)} → {f0(r.i2)} A</span><span className="dash-sub">−{f0(r.currentReductionPct)} % · losses −{f0(r.lossReductionPct)} %{r.lossSavedKw !== undefined ? ` (${r.lossSavedKw.toFixed(2)} kW)` : ''}</span></div>
          {r.transformer && <div className="dash-tile"><span className="dash-label">Transformer</span><span className="dash-value">{f0(r.transformer.before)} → {f0(r.transformer.after)} %</span><span className="dash-sub">of {r.transformer.kva} kVA</span></div>}
        </div>
        {r.warnings.map((w) => <p key={w} className="warn">⚠ {w}</p>)}
        <div className="pfcc-diagrams">
          <section className="card"><h4>Power triangle <span className="m">— before (red), after (green), to scale</span></h4><div className="pfcc-svg" dangerouslySetInnerHTML={{ __html: powerTriangleSvg(r) }} /></section>
          <section className="card"><h4>Current phasors</h4><div className="pfcc-svg" dangerouslySetInnerHTML={{ __html: phasorSvg(r, input.voltageV) }} /></section>
        </div>
        <section className="card pfcc-bank">
          <h4>Bank</h4>
          <div className="pfc-kpi">
            <span>{r.detuneReason}</span>
            <span>Capacitors rated <b>{r.capVoltageV} V</b> · bank current <b>{f0(r.bankCurrentA)} A</b>{r.breakerA ? <> · breaker <b>{r.breakerA} A</b> MCCB</> : null}</span>
            <span className="m">Other targets (with {r.stepKvar} kvar steps): {r.compare.map((c) => `PF ${c.pf.toFixed(2)} → ${c.bank} kvar${c.reached ? '' : ` (gives ${c.achievedPf.toFixed(3)}, not reached)`}`).join(' · ')}</span>
          </div>
          <details><summary>Method</summary>{r.derivation.map((d) => <div key={d}><code>{d}</code></div>)}</details>
          <div className="pfc-actions">
            <button className="chip primary" onClick={report}>Report (PDF)</button>
            {project.boards.length > 0 && <>
              <span className="sp" />
              <label className="row">Add to the design on <select className="bi-sel" value={board} onChange={(e) => setBoard(e.target.value)}>{project.boards.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select></label>
              <button className="chip" disabled={!r.bankKvar} onClick={toDesign} title={r.bankKvar && !r.targetReached ? `Adds the ${r.bankKvar} kvar bank as a design option — with ${r.stepKvar} kvar steps it does not reach PF ${r.targetPf} at this load` : undefined}>Add bank{r.bankKvar && !r.targetReached ? ' (target not reached)' : ''}</button>
            </>}
          </div>
        </section>
        </>}
      </div>
    </div>
  );
}
