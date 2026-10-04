import { useMemo } from 'react';
import type { Project } from '../types';
import { EARTH_KINDS, earthingLayout, kindInfo, patchEarthing, type EarthLayout } from '../model/earthingPlan';
import { safeFileName, savePdf } from '../util/files';
import { esc } from '../docs/report';
import { Page } from './ui';

const PIT_GAP = 60, LANE_H = 150, X0 = 190, BOX_W = 130;

/** The schematic: one lane per kind of earth, equipment above its pits, links between pits. */
function schematic(L: EarthLayout): string {
  const S = 'currentColor';
  const lanes = EARTH_KINDS.filter((k) => L.items.some((i) => i.kind === k.kind));
  // Each piece of equipment gets a block wide enough for its box and its pits.
  const blockW = (n: number) => Math.max(BOX_W + 20, n * PIT_GAP);
  const laneW = (k: string) => L.items.filter((i) => i.kind === k).reduce((s, i) => s + blockW(i.pits), 0);
  const width = X0 + Math.max(300, ...lanes.map((k) => laneW(k.kind))) + 20;
  const out: string[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  lanes.forEach((k, li) => {
    const y0 = 20 + li * LANE_H, py = y0 + 95;
    out.push(`<text x="10" y="${y0 + 18}" font-weight="bold" fill="${S}">${esc(k.label)}</text><text x="10" y="${y0 + 34}" fill="${S}" opacity=".7">limit ${k.limitOhm} Ω</text>`);
    out.push(`<line x1="0" y1="${y0 + LANE_H - 10}" x2="${width}" y2="${y0 + LANE_H - 10}" stroke="${S}" stroke-opacity=".12"/>`);
    const kp = L.pits.filter((p) => p.kind === k.kind);
    let cx = X0;
    for (const it of L.items.filter((i) => i.kind === k.kind)) {
      const ids = kp.filter((p) => p.itemKey === it.key);
      const w = blockW(ids.length), x = cx + w / 2;
      ids.forEach((p, i) => pos.set(p.id, { x: x + (i - (ids.length - 1) / 2) * PIT_GAP, y: py }));
      cx += w;
      out.push(`<rect x="${x - BOX_W / 2}" y="${y0 + 5}" width="${BOX_W}" height="34" rx="4" fill="${S}" fill-opacity=".05" stroke="${S}"/><text x="${x}" y="${y0 + 20}" text-anchor="middle" font-size="11" fill="${S}">${esc(it.equipment)}</text><text x="${x}" y="${y0 + 33}" text-anchor="middle" font-size="10" fill="${S}" opacity=".7">${esc(it.point)}</text>`);
      for (const p of ids) out.push(`<line x1="${x}" y1="${y0 + 39}" x2="${pos.get(p.id)!.x}" y2="${py - 12}" stroke="${S}"/>`);
      if (!ids.length) out.push(`<text x="${x}" y="${py}" text-anchor="middle" fill="#c0392b">no pit</text>`);
    }
  });
  for (const [a, b] of L.links) {
    const A = pos.get(a)!, B = pos.get(b)!;
    out.push(B.x < A.x
      ? `<path d="M${A.x} ${A.y + 12} Q ${(A.x + B.x) / 2} ${A.y + 45} ${B.x} ${B.y + 12}" fill="none" stroke="${S}" stroke-width="2"/>`
      : `<line x1="${A.x + 12}" y1="${A.y - 3}" x2="${B.x - 12}" y2="${B.y - 3}" stroke="${S}" stroke-width="2"/><line x1="${A.x + 12}" y1="${A.y + 3}" x2="${B.x - 12}" y2="${B.y + 3}" stroke="${S}" stroke-width="2"/>`);
  }
  for (const p of L.pits) {
    const { x, y } = pos.get(p.id)!;
    out.push(`<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="${S}" stroke-width="1.5"/><line x1="${x - 7}" y1="${y - 2}" x2="${x + 7}" y2="${y - 2}" stroke="${S}"/><line x1="${x - 4}" y1="${y + 2}" x2="${x + 4}" y2="${y + 2}" stroke="${S}"/><line x1="${x - 1.5}" y1="${y + 6}" x2="${x + 1.5}" y2="${y + 6}" stroke="${S}"/><text x="${x}" y="${y - 16}" text-anchor="middle" font-size="11" font-weight="bold" fill="${S}">${p.id}</text>${p.measured !== undefined ? `<text x="${x}" y="${y + 28}" text-anchor="middle" font-size="10" fill="${S}">${p.measured} Ω</text>` : ''}`);
  }
  const h = 20 + lanes.length * LANE_H;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" font-family="Arial" font-size="12">${out.join('')}</svg>`;
}

/** Design → Earthing: earth pits of the RMUs, transformers and main boards, and how they are linked. */
export default function EarthingView({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const L = useMemo(() => earthingLayout(project), [project]);
  const svg = useMemo(() => schematic(L), [L]);
  const plan = project.earthingPlan ?? {};
  const setPits = (key: string, def: number, v: string) => {
    const n = Math.max(0, Math.min(20, Math.round(Number(v) || 0)));
    onChange(patchEarthing(project, (p) => { const pits = { ...p.pits }; if (n === def) delete pits[key]; else pits[key] = n; return { ...p, pits }; }));
  };
  const setLinked = (key: string, on: boolean) => onChange(patchEarthing(project, (p) => ({ ...p, unlinked: on ? (p.unlinked ?? []).filter((k) => k !== key) : [...(p.unlinked ?? []), key] })));
  const setMeasured = (id: string, v: string) => onChange(patchEarthing(project, (p) => { const m = { ...p.measured }; const n = Number(v); if (v.trim() === '' || !(n > 0)) delete m[id]; else m[id] = n; return { ...p, measured: m }; }));
  const itemOf = (key: string) => L.items.find((i) => i.key === key)!;

  async function exportPdf() {
    const rows = L.pits.map((p) => { const it = itemOf(p.itemKey); return `<tr><td>${p.id}</td><td>${esc(kindInfo(p.kind).label)}</td><td>${esc(it.equipment)} — ${esc(it.point)}</td><td>${L.electrodeM} m Cu-bonded rod, inspection pit</td><td>${p.measured ?? ''}</td></tr>`; }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Earthing schematic</title><style>@page { size: A3 landscape; margin: 12mm; } body { font: 10px Arial, sans-serif; color: #111; } h1 { font-size: 16px; } table { border-collapse: collapse; width: 100%; margin-top: 8px; } th, td { border: .2mm solid #999; padding: 3px 6px; text-align: left; } th { background: #eef2f7; } svg { width: 100%; max-height: 150mm; }</style></head><body>
      <h1>${esc(project.name)} — Earthing schematic</h1>${svg}
      <table><thead><tr><th>Pit</th><th>Earth</th><th>Equipment</th><th>Electrode</th><th>Measured Ω</th></tr></thead><tbody>${rows}</tbody></table>
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
          {L.pits.length ? <div className="pfcc-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="m">No earth pits yet.</p>}
        </section>

        <section className="card">
          <h4>Checks</h4>
          <ul className="bh-checks">{L.checks.map((c, i) => <li key={i} className={c.level}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} {c.text}</li>)}</ul>
          <h4>Pit schedule</h4>
          <table className="bi-table compact">
            <thead><tr><th>Pit</th><th>Equipment</th><th>Measured Ω</th></tr></thead>
            <tbody>{L.pits.map((p) => (
              <tr key={p.id}><td>{p.id}</td><td>{itemOf(p.itemKey).equipment}<br /><span className="m">{kindInfo(p.kind).label}</span></td>
                <td><input key={`${p.id}-${plan.measured?.[p.id] ?? ''}`} className="bi-num" style={{ width: 56 }} inputMode="decimal" placeholder="test" defaultValue={plan.measured?.[p.id] ?? ''} onBlur={(e) => setMeasured(p.id, e.target.value)} /></td></tr>
            ))}</tbody>
          </table>
          <p className="m">Group value = measured pits in parallel (an estimate; site test governs).</p>
        </section>
      </div>
    </Page>
  );
}
