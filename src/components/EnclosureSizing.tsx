import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { BUILTIN_CATALOGUES, selectionFrom, sizeEnclosure, type Candidate, type EnclosureCatalogue, type Mounting, type SizingInput } from '../calc/enclosure';
import { Page } from './ui';

const RESULT: Record<Candidate['result'], string> = { fits: 'Fits', 'too-small': 'Too small', 'not-listed': 'Not in chart', confirm: 'Confirm with supplier' };
const CLS: Record<Candidate['result'], string> = { fits: 'ok', 'too-small': 'bad', 'not-listed': 'm', confirm: 'warn' };

/** Front and side view of the enclosure, dimensioned. Modular boards: rows of modules with
 * equipment, spare and the supplier's allowance marked (illustrative, not a manufacturing drawing). */
function preview(cat: EnclosureCatalogue, c: Candidate | undefined, i: SizingInput): string {
  if (!c?.dims) return '';
  const { h, w, d } = c.dims;
  const k = Math.min(300 / h, 220 / w);
  const W = w * k, H = h * k, D = Math.max(d * k, 10), x0 = 70, y0 = 20, sx = x0 + W + 40;
  const S = 'currentColor';
  const cells: string[] = [];
  const rows = c.config.rows, per = c.config.modulesPerRow;
  if (cat.family === 'modular' && rows && per) {
    const pad = 10, rh = (H - 2 * pad) / rows, mw = (W - 2 * pad) / per;
    const allow = c.rule.deductModules, total = rows * per;
    for (let n = 0; n < total; n++) {
      const r = Math.floor(n / per), m = n % per;
      const kind = n >= total - allow ? 'allow' : n < i.equipmentModules ? 'eq' : n < i.equipmentModules + i.spareModules ? 'spare' : 'free';
      const style = kind === 'eq' ? 'fill="#2a78d6" fill-opacity=".55" stroke="#2a78d6"' : kind === 'spare' ? 'fill="none" stroke="#2a78d6" stroke-dasharray="2 2"' : kind === 'allow' ? 'fill="none" stroke="#c8a000" stroke-dasharray="2 2"' : `fill="none" stroke="${S}" stroke-opacity=".15"`;
      cells.push(`<rect x="${x0 + pad + m * mw + 1}" y="${y0 + pad + r * rh + rh * 0.25}" width="${mw - 2}" height="${rh * 0.5}" ${style}/>`);
    }
  } else {
    cells.push(`<text x="${x0 + W / 2}" y="${y0 + H / 2}" text-anchor="middle" fill="${S}" opacity=".7">${c.config.grossModules} modules · layout by the supplier</text>`);
  }
  const dim = (x1: number, y1: number, x2: number, y2: number, t: string, tx: number, ty: number, rot = 0) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${S}" marker-start="url(#a)" marker-end="url(#a)"/><text x="${tx}" y="${ty}" fill="${S}" text-anchor="middle"${rot ? ` transform="rotate(${rot} ${tx} ${ty})"` : ''}>${t}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sx + D + 70} ${y0 + H + 50}" font-family="Arial" font-size="12">
  <defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 2 L10 5 L0 8" fill="${S}"/></marker></defs>
  <rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="4" fill="${S}" fill-opacity=".04" stroke="${S}" stroke-width="2"/>${cells.join('')}
  ${dim(x0 - 20, y0, x0 - 20, y0 + H, `H ${h} mm`, x0 - 34, y0 + H / 2, -90)}
  ${dim(x0, y0 + H + 18, x0 + W, y0 + H + 18, `W ${w} mm`, x0 + W / 2, y0 + H + 36)}
  <rect x="${sx}" y="${y0}" width="${D}" height="${H}" fill="${S}" fill-opacity=".04" stroke="${S}" stroke-width="2"/>
  ${dim(sx, y0 + H + 18, sx + D, y0 + H + 18, `D ${d} mm`, sx + D / 2, y0 + H + 36)}
  </svg>`;
}

/** Design → Enclosure sizing: physical space of a board from a supplier catalogue (module counting). */
export default function EnclosureSizing({ project, boardId, onChange, onStatus }: { project: Project; boardId?: string; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const [panel, setPanel] = useState(boardId ?? project.boards.find((b) => !b.upstreamId)?.id ?? '');
  const saved = project.boards.find((b) => b.id === panel)?.enclosure;
  const [catId, setCatId] = useState(saved?.catalogueId ?? BUILTIN_CATALOGUES[0].id);
  const [mounting, setMounting] = useState<Mounting>(saved?.mounting ?? 'surface');
  const [input, setInput] = useState<SizingInput>(saved?.input ?? { equipmentModules: 64, spareModules: 8, elcbCount: 10 });
  const cat = BUILTIN_CATALOGUES.find((c) => c.id === catId) ?? BUILTIN_CATALOGUES[0];
  const r = useMemo(() => sizeEnclosure(cat, input, mounting), [cat, input, mounting]);
  const [pick, setPick] = useState<string | null>(null);
  const shown = r.candidates.filter((c) => c.result !== 'not-listed' || r.candidates.every((x) => x.result === 'not-listed'));
  const chosen = shown.find((c) => `${c.config.id}/${c.rule.id}` === pick) ?? shown.find((c) => c.result === 'fits' || c.result === 'confirm');
  const svg = useMemo(() => preview(cat, chosen, input), [cat, chosen, input]);
  const setNum = (k: keyof SizingInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value.trim();
    if (k === 'incomerA' && t === '') { const { incomerA: _x, ...rest } = input; setInput(rest); return; }
    const n = Number(t); if (Number.isFinite(n)) setInput({ ...input, [k]: n });
  };
  const notListed = r.candidates.filter((c) => c.result === 'not-listed').length;

  function use() {
    if (!chosen || chosen.usable === null || chosen.result === 'too-small' || chosen.result === 'not-listed') return;
    const sel = selectionFrom(cat, chosen, input, mounting, r.required);
    onChange({ ...project, boards: project.boards.map((b) => (b.id === panel ? { ...b, enclosure: sel } : b)) });
    onStatus(`${panel}: ${cat.range} ${chosen.config.ref}${sel.dims ? `, H${sel.dims.h} × W${sel.dims.w} × D${sel.dims.d} mm` : ''} — ${cat.supplier} rev. ${cat.revision}${sel.confirmNeeded ? ' (supplier confirmation needed)' : ''}`);
  }

  return (
    <Page title="Enclosure sizing" intro="Physical space of a board from a supplier catalogue: equipment + future spare ≤ the enclosure's usable modules for the case that applies (ELCB count, incomer). Separate from current ratings. A preliminary space fit — depth, wiring access, busbars, compatibility and temperature rise (IEC TR 60890) are separate checks.">
      <div className="enc-cols">
        <section className="card">
          <h4>Sizing inputs</h4>
          <div className="form-kv">
            <label>Panel<select value={panel} onChange={(e) => setPanel(e.target.value)}>{project.boards.map((b) => <option key={b.id} value={b.id}>{b.id}{b.enclosure ? ' ✓' : ''}</option>)}</select></label>
            <label>Catalogue<select value={catId} onChange={(e) => { setCatId(e.target.value); setPick(null); }}>{BUILTIN_CATALOGUES.map((c) => <option key={c.id} value={c.id}>{c.supplier} — {c.range} (rev. {c.revision})</option>)}</select></label>
            {cat.family === 'modular' && <label>Mounting<select value={mounting} onChange={(e) => setMounting(e.target.value as Mounting)}><option value="surface">Surface</option><option value="flush">Flush</option></select></label>}
          </div>
          <div className="seg"><button disabled title="Next batch: the device list from the load schedule, with each device's real module width">From schedule</button><button className="on">Manual</button></div>
          <div className="form-kv">
            <label>Equipment space (incomer, devices, accessories)<span className="pfcc-in"><input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={input.equipmentModules} onChange={setNum('equipmentModules')} /><span className="m">modules</span></span></label>
            <label>Future spare space<span className="pfcc-in"><input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={input.spareModules} onChange={setNum('spareModules')} /><span className="m">modules</span></span></label>
            <label>ELCB count<input className="bi-num" inputMode="numeric" value={input.elcbCount} onChange={setNum('elcbCount')} /></label>
            {cat.rules.some((x) => x.incomerMaxA !== undefined) && <label>Incomer<span className="pfcc-in"><input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={input.incomerA ?? ''} placeholder="A" onChange={setNum('incomerA')} /><span className="m">A</span></span></label>}
          </div>
          <p className="m">Use each device's real module width — pole or circuit counts don't give the physical width.</p>
          <div className="enc-result">
            <b>Calculation</b>
            {r.invalid ? <p className="bad">{r.invalid}</p> : <>
              <div>Required: {input.equipmentModules} + {input.spareModules} = <b>{r.required} modules</b></div>
              {r.rules.map((x) => <div key={x.id} className="m">Case: {x.label} (already off the chart's usable figures)</div>)}
              {chosen && chosen.usable !== null && <div>Available: {chosen.config.grossModules} − {chosen.rule.deductModules} = <b>{chosen.usable} modules</b> · {chosen.spareAfter! >= 0 ? `${chosen.spareAfter} left` : `${-chosen.spareAfter!} short`}</div>}
              {r.why && <p className="warn">{r.why}</p>}
              {r.confirm && <p className="warn">The supplier's cases overlap here — confirm which governs before choosing.</p>}
              {chosen?.rule.extra && <p className="warn">{chosen.rule.extra}.</p>}
            </>}
          </div>
        </section>

        <section className="card">
          <h4>Enclosure preview {chosen && <span className="m">— {chosen.config.ref}{cat.family === 'modular' ? ` (${chosen.config.rows} rows × ${chosen.config.modulesPerRow} modules)` : ''}</span>}</h4>
          {svg ? <div className="pfcc-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="m">No enclosure in the catalogue fits these inputs.</p>}
          {cat.family === 'modular' && <p className="m enc-key"><span className="k eq" /> Equipment <span className="k spare" /> Spare <span className="k allow" /> Supplier allowance (terminals, incoming cable) · illustrative layout, not a manufacturing drawing</p>}
          {chosen?.dims && <p><b>{cat.range} {chosen.config.ref}</b> · {cat.family === 'modular' ? (mounting === 'flush' ? 'Flush' : 'Surface') : 'Fabricated'} · H{chosen.dims.h} × W{chosen.dims.w} × D{chosen.dims.d} mm</p>}
        </section>

        <section className="card">
          <h4>Catalogue matches</h4>
          <table className="bi-table compact">
            <thead><tr><th>Size</th><th>Usable</th><th>Spare left</th><th>Result</th></tr></thead>
            <tbody>{shown.filter((c) => c.result !== 'not-listed').map((c) => {
              const key = `${c.config.id}/${c.rule.id}`;
              return (
                <tr key={key} className={chosen === c ? 'on' : ''} onClick={() => setPick(key)} style={{ cursor: 'pointer' }}>
                  <td>{c.config.ref}{r.rules.length > 1 ? <span className="m"> · {c.rule.id}</span> : null}</td><td>{c.usable}</td><td>{c.spareAfter}</td><td className={CLS[c.result]}>{chosen === c && c.result === 'fits' ? 'Selected' : RESULT[c.result]}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {notListed > 0 && <p className="m">{notListed} size{notListed > 1 ? 's' : ''} blank in the chart for this case — not offered until the supplier confirms.</p>}
          <h4>Catalogue</h4>
          <p className="m">{cat.supplier} · {cat.range} · rev. {cat.revision}<br />{cat.source}</p>
          <ul className="m">{cat.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          {saved && <p className="m">{panel} now: {saved.range} {saved.config.ref} (rev. {saved.revision}, {saved.selectedOn}){saved.revision !== cat.revision && saved.catalogueId === cat.id ? ' — the catalogue has changed since; the panel keeps its selection' : ''}</p>}
        </section>
      </div>
      <div className="modal-actions enc-foot">
        <span className="warn">Preliminary space estimate · depth, wiring, busbar and thermal checks pending · supplier review pending</span>
        <span className="sp" />
        <button className="chip primary" disabled={!panel || !chosen || chosen.result === 'too-small' || chosen.result === 'not-listed' || !!r.invalid} onClick={use} title={chosen?.result === 'confirm' ? 'Saved with "supplier to confirm" — the chart\'s cases overlap here' : undefined}>Use for {panel || 'this panel'}{chosen?.result === 'confirm' ? ' (supplier to confirm)' : ''}</button>
      </div>
    </Page>
  );
}
