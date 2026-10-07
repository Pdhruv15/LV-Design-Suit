import { useMemo, useState } from 'react';
import { useStable } from '../util/useStable';
import type { Project } from '../types';
import { DEFAULT_SPARE_PCT, applicableRules, selectionFrom, sizeEnclosure, spareFromPct, type Candidate, type EnclosureCatalogue, type Mounting, type SizingInput } from '../calc/enclosure';
import { allCatalogues, isTypical, loadDevices, neededDevices, saveDevices, scheduleModules, validateCatalogue, type NeededDevice } from '../model/enclosureLibrary';
import CatalogueManager from './CatalogueManager';
import { safeFileName, savePdf } from '../util/files';
import { esc } from '../docs/report';
import { Page } from './ui';
import { roleOf } from '../model/emergency';

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
  // The supplier chart is for distribution boards only (DB, and EDB below an EMDB); SMDB / MDB charts come later.
  const dbs = project.boards.filter((b) => ['DB', 'EDB'].includes(roleOf(project, b)));
  const [panel, setPanel] = useState(dbs.find((b) => b.id === boardId)?.id ?? dbs[0]?.id ?? '');
  const saved = project.boards.find((b) => b.id === panel)?.enclosure;
  const [catalogues, setCatalogues] = useState(() => allCatalogues());
  const [manager, setManager] = useState(false);
  const [method, setMethod] = useState<'manual' | 'schedule'>(saved?.method ?? 'schedule');
  const [catId, setCatId] = useState(saved?.catalogueId ?? catalogues[0].id);
  const [mounting, setMounting] = useState<Mounting>(saved?.mounting ?? 'surface');
  const [manual, setInput] = useState<SizingInput>(saved?.input ?? { equipmentModules: 64, spareModules: spareFromPct(64, DEFAULT_SPARE_PCT), elcbCount: 10, sparePct: DEFAULT_SPARE_PCT });
  const cat = catalogues.find((c) => c.id === catId) ?? catalogues[0];
  const catBad = validateCatalogue(cat).filter((x) => x.level === 'bad');
  // From schedule: the board's physical devices, widths only from device records.
  const [devRev, setDevRev] = useState(0); // bumps when a device record is added here
  const [widths, setWidths] = useState<Record<string, string>>({});
  const needed = useMemo(() => (method === 'schedule' ? neededDevices(project, panel) : []), [method, project, panel, manager, devRev]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A width typed for an unmapped device becomes a device record (this type, poles and rating) — the user's figure, not a guess. */
  const addWidth = (d: NeededDevice) => {
    const w = Number(widths[d.key]);
    if (!(w > 0)) return;
    saveDevices([...loadDevices(), { id: `dv-${Date.now().toString(36)}`, manufacturer: 'Enter manufacturer', model: d.key, kind: d.kind, poles: d.poles, ratingMinA: d.ratingA, ratingMaxA: d.ratingA, modules: w, note: `Added from ${panel}'s schedule` }]);
    setWidths({ ...widths, [d.key]: '' });
    setDevRev((n) => n + 1);
    onStatus(`Device record added: ${d.key} = ${w} module${w === 1 ? '' : 's'} — set the manufacturer and model in Catalogue manager → Device dimensions`);
  };
  const fromSchedule = scheduleModules(needed);
  const incomerA = project.feeders.find((f) => f.feedsBoardId === panel)?.breakerRatingA;
  const base: SizingInput = method === 'schedule'
    ? { equipmentModules: fromSchedule.modules, spareModules: manual.spareModules, elcbCount: fromSchedule.elcb, ...(incomerA !== undefined ? { incomerA } : {}), ...(manual.sparePct !== undefined ? { sparePct: manual.sparePct } : {}) }
    : manual;
  // Spare as a percentage follows the equipment space.
  const input = useStable<SizingInput>(base.sparePct !== undefined ? { ...base, spareModules: spareFromPct(base.equipmentModules, base.sparePct) } : base);
  const incomplete = method === 'schedule' && (fromSchedule.unmapped.length > 0 || !needed.length);
  const r = useMemo(() => sizeEnclosure(cat, input, mounting), [cat, input, mounting]);
  const [pick, setPick] = useState<string | null>(null);
  // Rows and modules per row: Auto picks the nearest size that fits; the user can fix either for a smaller, wider or larger (future) board.
  const [rowsSel, setRowsSel] = useState(0);
  const [perSel, setPerSel] = useState(0);
  const rowOpts = [...new Set(cat.configs.map((c) => c.rows).filter((x): x is number => !!x))].sort((a, b) => a - b);
  const perOpts = [...new Set(cat.configs.map((c) => c.modulesPerRow).filter((x): x is number => !!x))].sort((a, b) => a - b);
  const layoutOk = (c: Candidate) => cat.family !== 'modular' || ((!rowsSel || c.config.rows === rowsSel) && (!perSel || c.config.modulesPerRow === perSel));
  const shown = r.candidates.filter(layoutOk).filter((c, _, all) => c.result !== 'not-listed' || all.every((x) => x.result === 'not-listed'));
  const chosen = shown.find((c) => `${c.config.id}/${c.rule.id}` === pick) ?? shown.find((c) => c.result === 'fits' || c.result === 'confirm') ?? shown.find((c) => c.result === 'too-small');
  const svg = useMemo(() => preview(cat, chosen, input), [cat, chosen, input]);
  const setNum = (k: keyof SizingInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value.trim();
    if (k === 'incomerA' && t === '') { const { incomerA: _x, ...rest } = manual; setInput(rest); return; }
    const n = Number(t); if (Number.isFinite(n)) setInput({ ...manual, [k]: n });
  };
  /** Another panel: start from its own saved size, or from its load schedule. */
  const choosePanel = (id: string) => {
    const sv = project.boards.find((b) => b.id === id)?.enclosure;
    setPanel(id);
    setMethod(sv?.method ?? 'schedule');
    setInput(sv?.input ?? { ...manual, sparePct: manual.sparePct ?? DEFAULT_SPARE_PCT });
    if (sv) { setCatId(sv.catalogueId); if (sv.mounting) setMounting(sv.mounting); }
    setPick(null);
    setWidths({});
  };
  const setSpareMode = (pct: boolean) => {
    if (pct) setInput({ ...manual, sparePct: manual.sparePct ?? DEFAULT_SPARE_PCT });
    else { const { sparePct: _p, ...rest } = manual; setInput({ ...rest, spareModules: input.spareModules }); }
  };
  // Other catalogues that do have a case for these inputs (shown when this one has none).
  const others = r.rules.length ? [] : catalogues.filter((c) => c.id !== cat.id && applicableRules(c, input).rules.length);
  // The saved size, checked against today's schedule / inputs.
  const outgrown = saved && (saved.method ?? 'manual') === method && !r.invalid && r.required > saved.usable && !incomplete;
  const notListed = r.candidates.filter((c) => c.result === 'not-listed').length;

  function use() {
    if (!chosen || chosen.usable === null || chosen.result === 'too-small' || chosen.result === 'not-listed' || incomplete || catBad.length) return;
    const sel = selectionFrom(cat, chosen, input, mounting, r.required, method);
    onChange({ ...project, boards: project.boards.map((b) => (b.id === panel ? { ...b, enclosure: sel } : b)) });
    onStatus(`${panel}: ${cat.range} ${chosen.config.ref}${sel.dims ? `, H${sel.dims.h} × W${sel.dims.w} × D${sel.dims.d} mm` : ''} — ${cat.supplier} rev. ${cat.revision}${sel.confirmNeeded ? ' (supplier confirmation needed)' : ''}`);
  }

  async function exportSheet() {
    if (!chosen?.dims) return;
    const d = chosen.dims;
    const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(panel)} enclosure</title><style>
    @page { size: A4; margin: 14mm; } body { font: 10.5px/1.45 Arial, sans-serif; color: #111; } h1 { font-size: 16px; margin: 0 0 4px; } h2 { font-size: 12px; color: #1d4f8f; border-bottom: 1px solid #1d4f8f; margin: 12px 0 5px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: .2mm solid #999; padding: 3px 6px; text-align: left; } th { background: #eef2f7; width: 34%; } thead th { background: #1d4f8f; color: #fff; width: auto; }
    .warn { color: #a15c00; font-weight: 700; } svg { width: 100%; max-height: 110mm; color: #111; } .m { color: #555; }
    </style></head><body>
    <h1>${esc(project.name)} — ${esc(panel)} enclosure size</h1><p class="m">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · preliminary space estimate</p>
    <h2>Selected enclosure</h2><table>${row('Catalogue', `${cat.supplier} — ${cat.range}, rev. ${cat.revision}`)}${row('Source', cat.source)}${row('Size', `${chosen.config.ref}${cat.family === 'modular' ? ` (${chosen.config.rows} row${chosen.config.rows === 1 ? "" : "s"} × ${chosen.config.modulesPerRow} modules)` : ''}`)}${row('Mounting', cat.family === 'modular' ? mounting : 'fabricated')}${row('Dimensions', `H ${d.h} × W ${d.w} × D ${d.d} mm`)}${row('Allowance case', chosen.rule.label)}${chosen.rule.extra ? row('Add to the estimate', chosen.rule.extra) : ''}</table>
    <h2>Space</h2><table>${row('Method', method === 'schedule' ? 'From the load schedule (device records)' : 'Manual estimate')}${row('Equipment', `${input.equipmentModules} modules`)}${row('Future spare', `${input.spareModules} modules${input.sparePct !== undefined ? ` (${input.sparePct} % of equipment)` : ''}`)}${row('Required', `${r.required} modules`)}${row('Available', `${chosen.config.grossModules} − ${chosen.rule.deductModules} = ${chosen.usable} modules (supplier figure after allowance)`)}${row('Left over', `${chosen.spareAfter} modules`)}${row('ELCB count', String(input.elcbCount))}${input.incomerA !== undefined ? row('Incomer', `${input.incomerA} A`) : ''}</table>
    ${method === 'schedule' ? `<h2>Devices</h2><table><thead><tr><th>Device</th><th>Qty</th><th>Record</th><th>Modules</th></tr></thead><tbody>${needed.map((x) => `<tr><td>${esc(x.key)} — ${esc(x.what)}</td><td>${x.count}</td><td>${x.device ? esc(`${x.device.manufacturer} ${x.device.model}`) : '<span class="warn">needs dimensions</span>'}</td><td>${x.device ? x.device.modules * x.count : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>Preview (illustrative, not a manufacturing drawing)</h2>${svg}
    <h2>Other candidates</h2><table><thead><tr><th>Size</th><th>Usable</th><th>Left</th><th>Result</th></tr></thead><tbody>${shown.filter((c) => c.result !== 'not-listed').map((c) => `<tr><td>${esc(c.config.ref)}</td><td>${c.usable}</td><td>${c.spareAfter}</td><td>${esc(RESULT[c.result])}</td></tr>`).join('')}</tbody></table>
    <p class="warn">Preliminary space fit by module count. Depth, wiring access, busbars, device compatibility and temperature rise (IEC TR 60890) are separate checks${chosen.result === 'confirm' ? '; the supplier must confirm which allowance case governs' : ''}. Supplier review pending.</p>
    </body></html>`;
    const m = await savePdf(`${safeFileName(`${project.name} ${panel} enclosure`)}.pdf`, html, { pageSize: 'A4' });
    if (m) onStatus(m);
  }

  return (
    <Page title="Enclosure sizing" actions={<><button className="chip" onClick={() => setManager(true)}>Catalogue manager</button> <button className="chip" disabled={!chosen?.dims} onClick={exportSheet}>Export size sheet</button></>} intro="Physical space of a board from a supplier catalogue: equipment + future spare ≤ the enclosure's usable modules for the case that applies (ELCB count, incomer). Separate from current ratings. A preliminary space fit — depth, wiring access, busbars, compatibility and temperature rise (IEC TR 60890) are separate checks.">
      <div className="enc-cols">
        <section className="card">
          <h4>Sizing inputs</h4>
          <p className="m">For DBs only (DB / EDB). {boardId && !dbs.some((b) => b.id === boardId) ? <span className="warn">{boardId} is not a DB — SMDB and MDB enclosures will use their own charts (to be added).</span> : 'SMDB and MDB charts to be added.'}</p>
          {!dbs.length && <p className="warn">This project has no DBs yet.</p>}
          <div className="form-kv">
            <label>Panel<select value={panel} onChange={(e) => choosePanel(e.target.value)}>{dbs.map((b) => <option key={b.id} value={b.id}>{b.id}{b.enclosure ? ' ✓' : ''}</option>)}</select></label>
            <label>Catalogue<select value={catId} onChange={(e) => { setCatId(e.target.value); setPick(null); }}>{catalogues.map((c) => <option key={c.id} value={c.id}>{c.supplier} — {c.range} (rev. {c.revision})</option>)}</select></label>
            {cat.family === 'modular' && <>
              <label>Rows<select value={rowsSel} onChange={(e) => { setRowsSel(Number(e.target.value)); setPick(null); }}><option value={0}>Auto (nearest that fits)</option>{rowOpts.map((n) => <option key={n} value={n}>{n} row{n > 1 ? 's' : ''}</option>)}</select></label>
              <label>Modules per row<select value={perSel} onChange={(e) => { setPerSel(Number(e.target.value)); setPick(null); }}><option value={0}>Auto (nearest that fits)</option>{perOpts.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </>}
            {cat.family === 'modular' && <label>Mounting<select value={mounting} onChange={(e) => setMounting(e.target.value as Mounting)}><option value="surface">Surface</option><option value="flush">Flush</option></select></label>}
          </div>
          <div className="seg"><button className={method === 'schedule' ? 'on' : ''} onClick={() => { setMethod('schedule'); setPick(null); }} title="The board's devices from its load schedule, each with its real module width from the device records">From schedule</button><button className={method === 'manual' ? 'on' : ''} onClick={() => { setMethod('manual'); setPick(null); }}>Manual</button></div>
          {method === 'schedule' && (
            <div className="enc-devs">
              {!needed.length && <p className="warn">{panel} has no circuits or incomer to list.</p>}
              <table className="bi-table compact">
                <thead><tr><th>Device</th><th>Qty</th><th>Width</th></tr></thead>
                <tbody>{needed.map((d) => <tr key={d.key}><td>{d.key}<br /><span className="m">{d.what}</span></td><td>{d.count}</td><td className={d.device ? '' : 'warn'}>{d.device ? <>{d.device.modules} × {d.count} = {d.device.modules * d.count}<br /><span className={isTypical(d.device) ? 'warn' : 'm'}>{isTypical(d.device) ? 'Typical width — check manufacturer' : `${d.device.manufacturer} ${d.device.model}`}</span></> : (
                  <span className="enc-w" title="Width of ONE device in 18 mm modules, from the manufacturer's data — saved as a device record">
                    <input className="bi-num" style={{ width: 44 }} inputMode="decimal" placeholder="width" value={widths[d.key] ?? ''} onChange={(e) => setWidths({ ...widths, [d.key]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addWidth(d)} />
                    <button className="chip" disabled={!(Number(widths[d.key]) > 0)} onClick={() => addWidth(d)}>Save</button>
                  </span>
                )}</td></tr>)}</tbody>
              </table>
              {fromSchedule.unmapped.length > 0 && <p className="warn">{fromSchedule.unmapped.length} device type(s) have no dimension record — enter the width above or in Catalogue manager → Device dimensions (MCCBs are chassis-mounted, so they have no typical width).</p>}
            </div>
          )}
          <div className="form-kv">
            {method === 'schedule' && <>
              <label>Equipment space<span className={incomplete ? 'warn' : ''}><b>{input.equipmentModules} modules</b> from {needed.filter((d) => d.device).reduce((n, d) => n + d.count, 0)} of {needed.reduce((n, d) => n + d.count, 0)} devices{fromSchedule.unmapped.length ? ` — ${fromSchedule.unmapped.length} type(s) need a width` : ''}</span></label>
              <label>ELCB count<span><b>{input.elcbCount}</b> from the ELCB groups{incomerA !== undefined ? ` · incomer ${incomerA} A` : ''}</span></label>
            </>}
            {method === 'manual' && <label>Equipment space (incomer, devices, accessories)<span className="pfcc-in"><input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={input.equipmentModules} onChange={setNum('equipmentModules')} /><span className="m">modules</span></span></label>}
            <label>Future spare space<span className="pfcc-in">
              {input.sparePct !== undefined
                ? <><input className="bi-num" style={{ width: 50 }} inputMode="numeric" value={input.sparePct} onChange={setNum('sparePct')} /><span className="m">% = {input.spareModules} modules</span></>
                : <><input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={input.spareModules} onChange={setNum('spareModules')} /><span className="m">modules</span></>}
              <select value={input.sparePct !== undefined ? 'pct' : 'mod'} onChange={(e) => setSpareMode(e.target.value === 'pct')}><option value="pct">%</option><option value="mod">modules</option></select>
            </span></label>
            {method === 'manual' && <label>ELCB count<input className="bi-num" inputMode="numeric" value={input.elcbCount} onChange={setNum('elcbCount')} /></label>}
            {method === 'manual' && cat.rules.some((x) => x.incomerMaxA !== undefined) && <label>Incomer<span className="pfcc-in"><input className="bi-num" style={{ width: 70 }} inputMode="numeric" value={input.incomerA ?? ''} placeholder="A" onChange={setNum('incomerA')} /><span className="m">A</span></span></label>}
          </div>
          <p className="m">Use each device's real module width — pole or circuit counts don't give the physical width.</p>
          <div className="enc-result">
            <b>Calculation</b>
            {r.invalid ? <p className="bad">{r.invalid}</p> : <>
              <div>Required: {input.equipmentModules} + {input.spareModules} = <b>{r.required} modules</b>{method === 'schedule' ? ` · ${input.elcbCount} ELCB${incomerA ? ` · incomer ${incomerA} A` : ''} from the schedule` : ''}</div>
              {incomplete && <p className="warn">Incomplete: devices without a width are not counted — the enclosure can't be chosen until they are.</p>}
              {catBad.length > 0 && <p className="bad">This catalogue has errors (Catalogue manager): {catBad[0].text}</p>}
              {r.rules.map((x) => <div key={x.id} className="m">Case: {x.label} (already off the chart's usable figures)</div>)}
              {chosen && chosen.usable !== null && <div>Available: {chosen.config.grossModules} − {chosen.rule.deductModules} = <b>{chosen.usable} modules</b> · {chosen.spareAfter! >= 0 ? `${chosen.spareAfter} left` : `${-chosen.spareAfter!} short`}</div>}
              {r.why && <p className="warn">{r.why}</p>}
              {others.length > 0 && <p className="warn">Try {others.map((c) => `${c.supplier} — ${c.range}`).join(' or ')}: it has a case for these inputs.</p>}
              {!r.rules.length && !others.length && !r.invalid && <p className="warn">Outside every catalogue — ask the supplier for a size.</p>}
              {r.confirm && <p className="warn">The supplier's cases overlap here — confirm which governs before choosing.</p>}
              {chosen?.rule.extra && <p className="warn">{chosen.rule.extra}.</p>}
            </>}
          </div>
        </section>

        <section className="card">
          <h4>Enclosure preview {chosen && <span className="m">— {chosen.config.ref}{cat.family === 'modular' ? ` (${chosen.config.rows} row${chosen.config.rows === 1 ? "" : "s"} × ${chosen.config.modulesPerRow} modules)` : ''}</span>}</h4>
          {svg ? <div className="pfcc-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="m">No enclosure in the catalogue fits these inputs.</p>}
          {chosen && chosen.result === 'too-small' && <p className="bad">{chosen.config.ref} is too small for {r.required} modules — choose more rows or modules per row, or set them to Auto.</p>}
          {cat.family === 'modular' && <p className="m enc-key"><span className="k eq" /> Equipment <span className="k spare" /> Spare <span className="k allow" /> Supplier allowance (terminals, incoming cable) · illustrative layout, not a manufacturing drawing</p>}
          {chosen?.dims && <p><b>{cat.range} {chosen.config.ref}</b> · {cat.family === 'modular' ? (mounting === 'flush' ? 'Flush' : 'Surface') : 'Fabricated'} · H{chosen.dims.h} × W{chosen.dims.w} × D{chosen.dims.d} mm</p>}
        </section>

        <section className="card">
          <h4>Catalogue matches</h4>
          {incomplete && <p className="warn">Partial count — {fromSchedule.unmapped.length} device type(s) without a width are not included, so these results are not a fit yet.</p>}
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
          {outgrown && <p className="bad">{panel} has outgrown its saved enclosure: needs {r.required} modules, {saved!.config.ref} has {saved!.usable}. Choose a new size.</p>}
          {saved && <p className="m">{panel} now: {saved.range} {saved.config.ref} (rev. {saved.revision}, {saved.selectedOn}){saved.revision !== cat.revision && saved.catalogueId === cat.id ? ' — the catalogue has changed since; the panel keeps its selection' : ''}</p>}
        </section>
      </div>
      <div className="modal-actions enc-foot">
        <span className="warn">Preliminary space estimate · depth, wiring, busbar and thermal checks pending · supplier review pending</span>
        <span className="sp" />
        <button className="chip primary" disabled={!panel || !chosen || chosen.result === 'too-small' || chosen.result === 'not-listed' || !!r.invalid || incomplete || catBad.length > 0} onClick={use} title={chosen?.result === 'confirm' ? 'Saved with "supplier to confirm" — the chart\'s cases overlap here' : undefined}>Use for {panel || 'this panel'}{chosen?.result === 'confirm' ? ' (supplier to confirm)' : ''}</button>
      </div>
      {manager && <CatalogueManager onStatus={onStatus} onClose={() => { setManager(false); const next = allCatalogues(); setCatalogues(next); if (!next.some((c) => c.id === catId)) setCatId(next[0].id); }} />}
    </Page>
  );
}
