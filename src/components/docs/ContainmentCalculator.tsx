import { useMemo } from 'react';
import type { Project } from '../../types';
import { calcContainment, CONTAINMENT_DEFAULT, CONTAINMENT_LABEL, containmentSvg, type ContainmentInput, type ContainmentType } from '../../calc/containment';
import { containmentReportHtml } from '../../docs/containmentReport';
import { safeFileName, savePdf } from '../../util/files';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f2 = (n: number) => n.toFixed(2);
const SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630];

function Num({ label, value, onSet, unit, title }: { label: string; value?: number; onSet: (v: number | undefined) => void; unit?: string; title?: string }) {
  return (
    <label title={title}>{label}
      <span className="pfcc-in"><input className="bi-text" inputMode="decimal" value={value ?? ''} onChange={(e) => { const t = e.target.value.trim(); if (t === '') return onSet(undefined); const n = Number(t); if (Number.isFinite(n)) onSet(n); }} />{unit && <span className="m">{unit}</span>}</span>
    </label>
  );
}

/** Custom containment: cables → tray / ladder / basket / trunking / conduit / trench / duct bank. */
export default function ContainmentCalculator({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const input: ContainmentInput = { ...CONTAINMENT_DEFAULT, ...project.containmentCalc };
  const set = (patch: Partial<ContainmentInput>) => onChange({ ...project, containmentCalc: { ...input, ...patch } });
  const r = useMemo(() => calcContainment(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const svg = useMemo(() => containmentSvg(r, input), [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const cables = input.cables;
  const t = input.type;
  const tray = t === 'tray' || t === 'ladder' || t === 'basket';
  const buried = t === 'trench' || t === 'ducts';

  async function report() {
    const m = await savePdf(`${safeFileName(`${project.name} containment${input.title ? ` ${input.title}` : ''}`)}.pdf`, containmentReportHtml(project, input, r), { pageSize: 'A4' });
    if (m) onStatus(m);
  }

  return (
    <div className="pfcc">
      <section className="card pfcc-inputs">
        <h4>Custom calculation</h4>
        <label>Name / location<input className="bi-text" value={input.title ?? ''} placeholder="e.g. Route from MDB to riser" onChange={(e) => set({ title: e.target.value || undefined })} /></label>
        <div className="seg pfcc-modes">{(Object.keys(CONTAINMENT_LABEL) as ContainmentType[]).map((k) => <button key={k} className={t === k ? 'on' : ''} onClick={() => set({ type: k })}>{CONTAINMENT_LABEL[k]}</button>)}</div>
        <div className="form-kv">
          {tray && <>
            <label>Laying<select value={input.layout} onChange={(e) => set({ layout: e.target.value as ContainmentInput['layout'] })}>
              <option value="spaced">Spaced (one diameter apart)</option><option value="touching">Touching, single layer</option><option value="fill">By fill %</option>
            </select></label>
            {input.layout === 'fill' && <Num label="Fill limit" unit="%" value={input.fillPct} onSet={(v) => v && set({ fillPct: v })} />}
            <label>Side height<select value={input.depthMm} onChange={(e) => set({ depthMm: Number(e.target.value) })}>{[25, 50, 75, 100, 150].map((d) => <option key={d} value={d}>{d} mm</option>)}</select></label>
            <label>Widest single tier<select value={input.maxWidthMm} onChange={(e) => set({ maxWidthMm: Number(e.target.value) })}>{[300, 450, 600, 750, 900].map((d) => <option key={d} value={d}>{d} mm</option>)}</select></label>
          </>}
          {t === 'trunking' && <Num label="Space factor" unit="%" value={input.fillPct} onSet={(v) => v && set({ fillPct: v })} title="BS 7671 / IET On-Site Guide: 45 %" />}
          {t === 'conduit' && <Num label="Fill limit (blank = 53 / 31 / 40 %)" unit="%" value={input.conduitFillPct} onSet={(v) => set({ conduitFillPct: v })} />}
          {buried && <>
            <Num label="Burial depth" unit="m" value={input.burialDepthM} onSet={(v) => v && set({ burialDepthM: v })} />
            <Num label="Soil thermal resistivity" unit="K·m/W" value={input.soilResistivity} onSet={(v) => v && set({ soilResistivity: v })} title="Typical: 1.0 moist, 1.5 average, 2.5 dry sand (UAE)" />
            <Num label="Ground temperature" unit="°C" value={input.groundTempC} onSet={(v) => v !== undefined && set({ groundTempC: v })} />
            {t === 'trench' && <label>Spacing<select value={input.spacing} onChange={(e) => set({ spacing: e.target.value as ContainmentInput['spacing'] })}><option value="touching">Touching</option><option value="one-d">One diameter</option><option value="250mm">250 mm</option></select></label>}
          </>}
          {t !== 'conduit' && <Num label={buried && t === 'ducts' ? 'Spare ducts' : 'Spare'} unit="%" value={input.sparePct} onSet={(v) => v !== undefined && set({ sparePct: v })} />}
        </div>
        <table className="bi-table compact pfcc-loads">
          <thead><tr><th>Cable</th><th>Cores</th><th>mm²</th><th>Qty</th><th title="Blank = from the cable data (DUCAB)">OD mm</th><th /></tr></thead>
          <tbody>
            {cables.map((c, i) => (
              <tr key={i}>
                <td><input className="bi-text" style={{ width: 96 }} value={c.name} onChange={(e) => set({ cables: cables.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} /></td>
                <td><select className="bi-sel" value={c.cores} onChange={(e) => set({ cables: cables.map((x, k) => (k === i ? { ...x, cores: Number(e.target.value) } : x)) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}C</option>)}</select></td>
                <td><select className="bi-sel" value={c.csaMm2} onChange={(e) => set({ cables: cables.map((x, k) => (k === i ? { ...x, csaMm2: Number(e.target.value) } : x)) })}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></td>
                <td><input className="bi-num" style={{ width: 44 }} inputMode="numeric" value={c.qty} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set({ cables: cables.map((x, k) => (k === i ? { ...x, qty: Math.max(0, Math.round(n)) } : x)) }); }} /></td>
                <td><input className="bi-num" style={{ width: 50 }} inputMode="decimal" value={c.odMm ?? ''} placeholder={r.lines.find((l) => l.name === c.name && l.csaMm2 === c.csaMm2)?.od.toFixed(1) ?? ''} onChange={(e) => { const n = e.target.value === '' ? undefined : Number(e.target.value); if (n === undefined || Number.isFinite(n)) set({ cables: cables.map((x, k) => (k === i ? { ...x, odMm: n } : x)) }); }} /></td>
                <td><button className="icon-btn" onClick={() => set({ cables: cables.filter((_, k) => k !== i) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="chip" onClick={() => set({ cables: [...cables, { name: 'Cable', cores: 4, csaMm2: 16, qty: 1 }] })}>+ Cable</button>
      </section>

      <div className="pfcc-out">
        {!r.count ? <section className="card"><p className="m">Add cables on the left — the containment, its cross-section and the report appear here.</p></section> : <>
          <div className="vd-cards">
            <div className="dash-tile"><span className="dash-label">{CONTAINMENT_LABEL[t]}</span><span className="dash-value">{r.size}</span><span className="dash-sub">{r.fillPct ? `fill ${f0(r.fillPct)} %` : ''}{r.sparePct !== undefined ? ` · spare ${f0(r.sparePct)} %` : ''}</span></div>
            <div className="dash-tile"><span className="dash-label">Cables</span><span className="dash-value">{r.count}</span><span className="dash-sub">Σ OD {f0(r.sumOdMm)} mm · area {f0(r.areaMm2)} mm²</span></div>
            <div className="dash-tile"><span className="dash-label">Weight</span><span className="dash-value">{f0(r.kgPerM)} kg/m</span><span className="dash-sub">for the supports</span></div>
            {r.groupFactor !== undefined && <div className="dash-tile"><span className="dash-label">Grouping factor</span><span className="dash-value">{f2(r.groupFactor)}</span><span className="dash-sub">IEC 60364-5-52 B.52.20</span></div>}
            {r.soil && <div className="dash-tile"><span className="dash-label">Derating</span><span className={`dash-value ${r.status === 'warn' ? 'warn' : ''}`}>× {f2(r.soil.total)}</span><span className="dash-sub">ground {f2(r.soil.temp)} · soil {f2(r.soil.resistivity)} · group {f2(r.soil.group)}</span></div>}
          </div>
          <section className="card"><h4>Cross-section <span className="m">— to scale</span></h4><div className="pfcc-svg" dangerouslySetInnerHTML={{ __html: svg }} /></section>
          <section className="card">
            <h4>Cables</h4>
            <table className="bi-table compact">
              <thead><tr><th>Cable</th><th>Size</th><th>Qty</th><th>OD (mm)</th><th>kg/m each</th></tr></thead>
              <tbody>{r.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.cores}C × {l.csaMm2} mm²</td><td>{l.qty}</td><td>{l.od.toFixed(1)}{l.estimated ? ' *' : ''}</td><td>{l.kg.toFixed(2)}</td></tr>)}</tbody>
            </table>
            {r.notes.map((n) => <p key={n} className="m">• {n}</p>)}
            {r.soil && <p className="m">• Multiply each cable's buried current rating by × {f2(r.soil.total)} (ground {input.groundTempC} °C, soil {input.soilResistivity} K·m/W, {r.count} circuits). Typical IEC 60364-5-52 values.</p>}
            <div className="pfc-actions"><button className="chip primary" onClick={report}>Report (PDF)</button></div>
          </section>
        </>}
      </div>
    </div>
  );
}
