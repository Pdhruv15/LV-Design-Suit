import { useMemo, useState, type ReactNode } from 'react';
import type { Project } from '../types';
import { FORM4_COLUMNS, FORM4_GROUPS, FORM4_REVISION, FORM4_SOURCE, FORM4_STACK, form4Selection, form4SizeText, sizeForm4, stackSections, type Form4Counts, type Form4Result } from '../calc/form4';
import { form4FromSld, isForm4Board } from '../model/form4Count';
import { safeFileName, savePdf } from '../util/files';
import { esc } from '../docs/report';
import { Page } from './ui';

const CONFIRM = [
  'Height and depth are fixed by the worksheet (H2100 + 100 plinth, D800) whatever the ratings.',
  'With no riser and more than 1800 mm of stacked outgoings, the worksheet drops the 300 mm cable chamber after the first section — confirm with the panel builder.',
  'No shipping-split limit is applied: a long board is shown as one line-up.'
];

/** Front view of the line-up, dimensioned: cubicles, stacked outgoing sections, cable chambers and plinth.
 * Illustrative, not a manufacturing drawing. mono: black and white for the PDF. */
export function form4Svg(counts: Form4Counts, r: Form4Result, mono = false): string {
  if (!r.widthMm) return '';
  const k = Math.min(0.11, 760 / r.widthMm), H = r.dims.h * k, P = r.dims.plinth * k, x0 = 20, y0 = 16;
  const S = 'currentColor', dev = mono ? '#000' : 'var(--acc)';
  const stacks = stackSections(counts, r.sections);
  const out: string[] = [];
  let x = x0, sec = 0;
  for (const p of r.parts) {
    const w = p.mm * k;
    out.push(`<rect x="${x}" y="${y0}" width="${w}" height="${H}" fill="${S}" fill-opacity="${p.kind === 'chamber' ? '.02' : '.05'}" stroke="${S}" stroke-width="1.2"/>`);
    if (p.kind === 'device' && p.column && p.qty) {
      const each = w / p.qty;
      for (let i = 0; i < p.qty; i++) {
        const cx = x + each * i + each / 2;
        if (i) out.push(`<line x1="${x + each * i}" y1="${y0}" x2="${x + each * i}" y2="${y0 + H}" stroke="${S}" stroke-opacity=".5"/>`);
        out.push(`<rect x="${cx - each * 0.3}" y="${y0 + H * 0.35}" width="${each * 0.6}" height="${H * 0.22}" fill="none" stroke="${dev}"/>`);
        out.push(`<text x="${cx}" y="${y0 + H * 0.48}" text-anchor="middle" font-size="8" fill="${S}">${esc(p.column.short)}</text>`);
      }
    } else if (p.kind === 'section') {
      let y = y0 + 6;
      for (const c of stacks[sec++] ?? []) {
        const h = c.heightMm! * k;
        out.push(`<rect x="${x + 4}" y="${y}" width="${w - 8}" height="${h - 2}" fill="none" stroke="${dev}"/><text x="${x + w / 2}" y="${y + h / 2 + 3}" text-anchor="middle" font-size="7" fill="${S}">${esc(c.short)}</text>`);
        y += h;
      }
    } else {
      out.push(`<text x="${x + w / 2}" y="${y0 + H / 2}" text-anchor="middle" font-size="8" fill="${S}" opacity=".6" transform="rotate(-90 ${x + w / 2} ${y0 + H / 2})">cable chamber</text>`);
    }
    x += w;
  }
  const W = x - x0;
  out.push(`<rect x="${x0}" y="${y0 + H}" width="${W}" height="${P}" fill="${S}" fill-opacity=".15" stroke="${S}"/>`);
  out.push(`<line x1="${x0}" y1="${y0 + H + P + 14}" x2="${x}" y2="${y0 + H + P + 14}" stroke="${S}"/><text x="${x0 + W / 2}" y="${y0 + H + P + 28}" text-anchor="middle" font-size="11" fill="${S}">W ${r.widthMm} mm</text>`);
  out.push(`<text x="${x + 8}" y="${y0 + H / 2}" font-size="11" fill="${S}">H ${r.dims.h}</text><text x="${x + 8}" y="${y0 + H + P - 1}" font-size="9" fill="${S}" opacity=".7">+${r.dims.plinth} plinth</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(W + 90, 300)} ${y0 + H + P + 40}" font-family="Arial">${out.join('')}</svg>`;
}

/** Design → Enclosure sizing, MDB / SMDB tab: Form-4 line-up width from the owner's worksheet. */
export default function Form4Sizing({ project, boardId, tabs, onChange, onStatus }: { project: Project; boardId?: string; tabs: ReactNode; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const boards = project.boards.filter((b) => isForm4Board(project, b));
  const [panel, setPanel] = useState(boards.find((b) => b.id === boardId)?.id ?? boards[0]?.id ?? '');
  const saved = project.boards.find((b) => b.id === panel)?.form4;
  // Quantities changed by hand; null = as counted from the SLD.
  const [manual, setManual] = useState<Form4Counts | null>(saved?.method === 'manual' ? saved.counts : null);
  const sld = useMemo(() => form4FromSld(project, panel), [project, panel]);
  const counts = manual ?? sld.counts;
  const r = useMemo(() => sizeForm4(counts), [counts]);
  const svg = useMemo(() => form4Svg(counts, r), [counts, r]);
  const changed = saved && saved.dims.w !== r.widthMm;

  const choosePanel = (id: string) => {
    setPanel(id);
    const sv = project.boards.find((b) => b.id === id)?.form4;
    setManual(sv?.method === 'manual' ? sv.counts : null);
  };
  const setQty = (id: string, v: string) => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    setManual({ ...counts, [id]: n });
  };

  function use() {
    if (!panel || !r.widthMm) return;
    const sel = form4Selection(counts, manual ? 'manual' : 'sld');
    onChange({ ...project, boards: project.boards.map((b) => (b.id === panel ? { ...b, form4: sel } : b)) });
    onStatus(`${panel}: Form-4 enclosure ${form4SizeText(sel.dims)} — worksheet rev. ${FORM4_REVISION}`);
  }

  async function exportSheet() {
    if (!r.widthMm) return;
    const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
    const qtyRows = FORM4_GROUPS.map((g) => {
      const cols = FORM4_COLUMNS.filter((c) => c.group === g.id && (counts[c.id] ?? 0) > 0);
      return cols.length ? `<tr><td colspan="4"><b>${esc(g.label)}</b></td></tr>` + cols.map((c) => `<tr><td>${esc(c.label)}</td><td>${counts[c.id]}</td><td>${c.widthMm ? `${c.widthMm} mm wide` : `${c.heightMm} mm high`}</td><td>${(counts[c.id] ?? 0) * (c.widthMm ?? c.heightMm!)} mm</td></tr>`).join('') : '';
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(panel)} Form-4 enclosure</title><style>
    @page { size: A4; margin: 14mm; } body { font: 10.5px/1.45 Arial, sans-serif; color: #111; } h1 { font-size: 16px; margin: 0 0 4px; } h2 { font-size: 12px; color: #000; border-bottom: 1px solid #000; margin: 12px 0 5px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: .2mm solid #999; padding: 3px 6px; text-align: left; } th { background: #f2f2f2; width: 34%; } thead th { background: #f2f2f2; color: #000; width: auto; }
    .warn { color: #000; font-weight: 700; } svg { width: 100%; max-height: 90mm; color: #111; } .m { color: #555; } ul { margin: 4px 0; padding-left: 16px; }
    </style></head><body>
    <h1>${esc(project.name)} — ${esc(panel)} Form-4 enclosure size</h1><p class="m">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · preliminary space estimate</p>
    <h2>Enclosure</h2><table>${row('Form of separation', 'Form 4, incoming and outgoing bottom entry')}${row('Size', form4SizeText(r.dims))}${row('Rules', `${FORM4_SOURCE}, rev. ${FORM4_REVISION}`)}${row('Quantities', manual ? 'Entered or changed by hand' : 'Counted from the SLD')}${row('Stacked outgoings', `${r.stackMm} mm in ${r.sections} section${r.sections === 1 ? '' : 's'} of ${FORM4_STACK} mm`)}</table>
    <h2>Breakers</h2><table><thead><tr><th>Breaker</th><th>Qty</th><th>Each</th><th>Total</th></tr></thead><tbody>${qtyRows}</tbody></table>
    <h2>Width</h2><table><thead><tr><th>Item</th><th>mm</th></tr></thead><tbody>${r.parts.map((p) => `<tr><td>${esc(p.label)}</td><td>${p.mm}</td></tr>`).join('')}<tr><td><b>Total width</b></td><td><b>${r.widthMm}</b></td></tr></tbody></table>
    <h2>Front view (illustrative, not a manufacturing drawing)</h2>${form4Svg(counts, r, true)}
    <h2>To confirm with the panel builder</h2><ul>${CONFIRM.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <p class="warn">Preliminary space estimate. Busbar sizing, shipping splits, temperature rise (IEC 61439) and the panel builder's layout are separate checks.</p>
    </body></html>`;
    const m = await savePdf(`${safeFileName(`${project.name} ${panel} Form-4 enclosure`)}.pdf`, html, { pageSize: 'A4' });
    if (m) onStatus(m);
  }

  return (
    <Page title="Enclosure sizing" actions={<button className="chip" disabled={!r.widthMm} onClick={exportSheet}>Export size sheet</button>} intro="Form-4 MDB / SMDB line-up (incoming and outgoing bottom entry) from the owner's worksheet: cubicle widths for incomers, risers, capacitor bank and large outgoings, plus stacked sections of 1800 mm for the smaller outgoings and their cable chambers. Height H2100 + 100 plinth and depth D800 are fixed. A preliminary space estimate.">
      {tabs}
      {!boards.length ? <p className="warn">This project has no MDB or SMDB yet.</p> : <>
        <div className="enc-cols">
          <section className="card">
            <h4>Breakers</h4>
            <div className="form-kv"><label>Panel<select value={panel} onChange={(e) => choosePanel(e.target.value)}>{boards.map((b) => <option key={b.id} value={b.id}>{b.id}{b.form4 ? ' ✓' : ''}</option>)}</select></label></div>
            <div className="seg"><button className={manual ? '' : 'on'} onClick={() => setManual(null)} title="Count the board's breakers on the SLD">Count from SLD</button><button className={manual ? 'on' : ''} onClick={() => setManual(manual ?? { ...sld.counts })}>Enter manually</button></div>
            {FORM4_GROUPS.map((g) => (
              <div key={g.id}>
                <p className="m f4-group">{g.label}</p>
                <table className="bi-table compact f4-qty">
                  <tbody>{FORM4_COLUMNS.filter((c) => c.group === g.id).map((c) => (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td><input className="bi-num" style={{ width: 48 }} inputMode="numeric" aria-label={`${g.label}: ${c.label}`} value={counts[c.id] ?? 0} onChange={(e) => setQty(c.id, e.target.value)} /></td>
                      <td className="m">{c.widthMm ? `${c.widthMm} wide` : `${c.heightMm} high`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
            {manual && <p className="m">Quantities changed by hand — <button className="chip" onClick={() => setManual(null)}>Count from SLD again</button></p>}
          </section>

          <section className="card">
            <h4>Result</h4>
            {r.widthMm ? <p className="f4-size"><b>W {r.widthMm} × H {r.dims.h} (+{r.dims.plinth} plinth) × D {r.dims.d} mm</b></p> : <p className="warn">No breakers counted — enter the quantities.</p>}
            {r.sections > 0 && <p className="m">Stacked outgoings: {r.stackMm} mm → {r.sections} section{r.sections === 1 ? '' : 's'} of {FORM4_STACK} mm ({Math.round((r.stackMm / (r.sections * FORM4_STACK)) * 100)} % of the height used)</p>}
            {svg && <div className="pfcc-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
            <p className="m">Illustrative front view, not a manufacturing drawing.</p>
            {changed && <p className="warn">{panel}'s saved size is W{saved.dims.w} — the breakers have changed since. Save the new size.</p>}
            {saved && !changed && <p className="m">{panel} now: Form-4 {form4SizeText(saved.dims)} (rev. {saved.revision}, {saved.selectedOn})</p>}
          </section>

          <section className="card">
            <h4>How the width is built up</h4>
            <table className="bi-table compact">
              <tbody>{r.parts.map((p, i) => <tr key={i}><td>{p.label}</td><td className="num">{p.mm}</td></tr>)}<tr><td><b>Total width</b></td><td className="num"><b>{r.widthMm}</b></td></tr></tbody>
            </table>
            {!manual && sld.items.length > 0 && <>
              <h4>Counted from the SLD</h4>
              <table className="bi-table compact">
                <tbody>{sld.items.map((x, i) => <tr key={i}><td>{x.what}<br /><span className="m">{x.ratingA} A → {FORM4_COLUMNS.find((c) => c.id === x.column)!.label}</span>{x.note && <><br /><span className="warn">{x.note}</span></>}</td></tr>)}</tbody>
              </table>
            </>}
            {!manual && sld.notes.map((n) => <p key={n} className="m">{n}</p>)}
            <p className="m">Harmonic feeders are not marked on the SLD — enter them by hand.</p>
            <h4>To confirm with the panel builder</h4>
            <ul className="m">{CONFIRM.map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="m">{FORM4_SOURCE}, rev. {FORM4_REVISION}</p>
          </section>
        </div>
        <div className="modal-actions enc-foot">
          <span className="warn">Preliminary space estimate · busbar, shipping split and thermal checks pending · panel builder review pending</span>
          <span className="sp" />
          <button className="chip primary" disabled={!panel || !r.widthMm} onClick={use}>Use for {panel || 'this panel'}</button>
        </div>
      </>}
    </Page>
  );
}
