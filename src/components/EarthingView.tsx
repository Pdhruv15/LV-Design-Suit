import { useMemo } from 'react';
import type { Project } from '../types';
import { earthingLayout, kindInfo, patchEarthing } from '../model/earthingPlan';
import { earthingDrawing } from '../diagram/earthingDrawing';
import { safeFileName, savePdf } from '../util/files';
import { esc } from '../docs/report';
import { Page } from './ui';

/** Design → Earthing: earth pits of the RMUs, transformers and main boards, and how they are linked. */
export default function EarthingView({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const L = useMemo(() => earthingLayout(project), [project]);
  const svg = useMemo(() => earthingDrawing(project, L).svg, [project, L]);
  const plan = project.earthingPlan ?? {};
  const setPits = (key: string, def: number, v: string) => {
    const n = Math.max(0, Math.min(20, Math.round(Number(v) || 0)));
    onChange(patchEarthing(project, (p) => { const pits = { ...p.pits }; if (n === def) delete pits[key]; else pits[key] = n; return { ...p, pits }; }));
  };
  const setLinked = (key: string, on: boolean) => onChange(patchEarthing(project, (p) => ({ ...p, unlinked: on ? (p.unlinked ?? []).filter((k) => k !== key) : [...(p.unlinked ?? []), key] })));
  const setMeasured = (id: string, v: string) => onChange(patchEarthing(project, (p) => { const m = { ...p.measured }; const n = Number(v); if (v.trim() === '' || !(n > 0)) delete m[id]; else m[id] = n; return { ...p, measured: m }; }));
  const itemOf = (key: string) => L.items.find((i) => i.key === key)!;

  async function exportPdf() {
    const drawingSvg = earthingDrawing(project, L, false).svg;
    const rows = L.pits.map((p) => { const it = itemOf(p.itemKey); return `<tr><td>${p.id}</td><td>${esc(it.equipment)} / ${esc(it.point)}</td><td>${esc(kindInfo(p.kind).label)} / ${esc(it.group)}</td><td>1C ${L.conductorMm2} mm² Cu/PVC</td><td>${L.electrodeM} m Cu-bonded rod</td><td>${p.measured === undefined ? 'Not tested' : `${p.measured} ohm`}</td></tr>`; }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Earthing schematic</title><style>@page { size: A3 landscape; margin: 12mm; } body { font: 10px Arial, sans-serif; color: #111; } h1 { font-size: 16px; } table { border-collapse: collapse; width: 100%; margin-top: 8px; } th, td { border: .2mm solid #999; padding: 3px 6px; text-align: left; } th { background: #eef2f7; } svg { width: 100%; max-height: 150mm; }</style></head><body>
      <h1>${esc(project.name)} — Earthing schematic</h1>${drawingSvg}
      <h2>Earth pit schedule</h2><table><thead><tr><th>Pit</th><th>Equipment / connection</th><th>Earth / substation</th><th>Conductor</th><th>Electrode</th><th>Measured</th></tr></thead><tbody>${rows}</tbody></table>
      <p>Pit links and earth conductors 1C × ${L.conductorMm2} mm² Cu. Transformer neutral and body earths are not interconnected. Limits: substation earths below 2 Ω, LV earth 1 Ω per incoming supply / MDB (DEWA). Pits at least 6 m apart.</p></body></html>`;
    const m = await savePdf(`${safeFileName(`${project.name} earthing schematic`)}.pdf`, html, { pageSize: 'A3', landscape: true });
    if (m) onStatus(m);
  }

  return (
    <Page title="Earthing schematic" actions={<button className="chip" disabled={!L.pits.length} onClick={exportPdf}>Export PDF</button>}
      intro="Earth pits of the RMUs, transformers and main boards (DEWA practice). RMU, transformer neutral, transformer body and LV earths are separate systems; pits of the same kind are linked in a loop. Lightning protection is not part of this schematic.">
      <div className="pp-cols earth-cols">
        <section className="card">
          <h4>Pits per equipment</h4>
          <table className="bi-table compact">
            <thead><tr><th>Equipment</th><th>Earth</th><th>Pits</th><th title="Link these pits with the others of the same kind">Linked</th></tr></thead>
            <tbody>{L.items.map((it) => (
              <tr key={it.key}>
                <td>{it.equipment}<br /><span className="m">{it.point}</span></td>
                <td>{kindInfo(it.kind).label.replace(' earth', '')}</td>
                <td><input className="bi-num" style={{ width: 46 }} inputMode="numeric" value={it.pits} onChange={(e) => setPits(it.key, it.defaultPits, e.target.value)} />{it.pits !== it.defaultPits && <span className="m"> (default {it.defaultPits})</span>}</td>
                <td><input type="checkbox" checked={it.linked} onChange={(e) => setLinked(it.key, e.target.checked)} /></td>
              </tr>
            ))}</tbody>
          </table>
          <div className="form-kv">
            <label>Electrode<span className="pfcc-in"><input className="bi-num" style={{ width: 50 }} inputMode="decimal" value={L.electrodeM} onChange={(e) => onChange(patchEarthing(project, (p) => ({ ...p, electrodeM: Number(e.target.value) || undefined })))} /><span className="m">m Cu-bonded rod</span></span></label>
            <label>Link conductor<span className="pfcc-in"><input className="bi-num" style={{ width: 50 }} inputMode="numeric" value={L.conductorMm2} onChange={(e) => onChange(patchEarthing(project, (p) => ({ ...p, conductorMm2: Number(e.target.value) || undefined })))} /><span className="m">mm² Cu</span></span></label>
          </div>
          <p className="m">Defaults: RMU 2 pits · transformer 1 neutral + 1 body · main board 2 pits (one MDB) or 1 each (several). Change any number for a company standard.</p>
        </section>

        <section className="card earth-svg">
          <h4>Schematic</h4>
          {L.pits.length ? <img className="earth-drawing" alt="Earthing schematic diagram" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /> : <p className="m">No earth pits yet.</p>}
        </section>

        <section className="card">
          <h4>Checks</h4>
          <ul className="bh-checks">{L.checks.map((c, i) => <li key={i} className={c.level}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} {c.text}</li>)}</ul>
          <h4>Pit schedule</h4>
          <table className="bi-table compact">
            <thead><tr><th>Pit</th><th>Equipment / earth</th><th>Conductor / electrode</th><th>Measured Ω</th></tr></thead>
            <tbody>{L.pits.map((p) => (
              <tr key={p.id}><td>{p.id}</td><td>{itemOf(p.itemKey).equipment}<br /><span className="m">{kindInfo(p.kind).label}</span></td>
                <td>1C {L.conductorMm2} mm² Cu/PVC<br /><span className="m">{L.electrodeM} m Cu-bonded rod</span></td>
                <td><input key={`${p.id}-${plan.measured?.[p.id] ?? ''}`} className="bi-num" style={{ width: 56 }} inputMode="decimal" placeholder="test" defaultValue={plan.measured?.[p.id] ?? ''} onBlur={(e) => setMeasured(p.id, e.target.value)} /></td></tr>
            ))}</tbody>
          </table>
          <p className="m">Pit IDs are retained when equipment or pit counts change; retired IDs remain reserved for their test records.</p>
          <p className="m">Group value = measured pits in parallel (an estimate; site test governs).</p>
        </section>
      </div>
    </Page>
  );
}
