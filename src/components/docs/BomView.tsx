import { useMemo, useRef, useState } from 'react';
import type { Project } from '../../types';
import type { FeederResult } from '../../calc/electrical';
import { buildBom } from '../../calc/bom';
import { compareBom, fallbackRate, loadPriceLists, newPriceList, priceBom, savePriceLists, type PriceList } from '../../model/priceList';
import { buildBoqWorkbook, buildPriceTemplate, readPriceWorkbook } from '../../docs/boqWorkbook';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary } from '../../util/files';
import BoqTable from '../BoqTable';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** BOM / Cost → Bill of quantities: everything in the design rolled up by
 * tender section, priced from your own price list, exported as an Excel
 * BOQ; with the change since an issued revision. */
export default function BomView({ project, results, onChange, onStatus }: { project: Project; results: FeederResult[]; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const [tab, setTab] = useState<'boq' | 'changes' | 'circuits'>('boq');
  const [library, setLibrary] = useState<PriceList[]>(loadPriceLists);
  const [since, setSince] = useState<string>(() => project.revisions?.[project.revisions.length - 1]?.id ?? '');
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const list = project.priceList;
  const items = useMemo(() => buildBom(project), [project]);
  const bom = useMemo(() => priceBom(items, list), [items, list]);
  const rev = project.revisions?.find((r) => r.id === since);
  const changes = useMemo(() => (rev ? compareBom(buildBom(rev.snapshot as Project), items, list) : []), [rev, items, list]);

  const setList = (l: PriceList | undefined) => onChange({ ...project, priceList: l });
  const edit = (patch: Partial<PriceList>) => setList({ ...(list ?? newPriceList()), ...patch });
  const setRate = (key: string, field: 'rate' | 'labour', v: string, description: string) => {
    const l = list ?? newPriceList();
    const cur = l.rates[key] ?? { rate: fallbackRate(key) ?? 0 };
    const n = v.trim() === '' ? undefined : Number(v.replace(/,/g, ''));
    if (n !== undefined && !Number.isFinite(n)) return;
    const rates = { ...l.rates };
    if (field === 'rate' && n === undefined) delete rates[key];
    else rates[key] = { ...cur, description, [field]: n ?? (field === 'rate' ? 0 : undefined) };
    setList({ ...l, rates });
  };
  const saveToLibrary = () => {
    if (!list) return;
    const next = [...library.filter((x) => x.id !== list.id), list];
    setLibrary(next);
    savePriceLists(next);
    onStatus(`Price list “${list.name}” saved — use it on your other projects`);
  };
  const useFromLibrary = (id: string) => {
    const l = library.find((x) => x.id === id);
    if (l) setList(structuredClone(l));
  };

  async function exportBoq() {
    const wb = buildBoqWorkbook(project, bom, list, rev ? { since: rev.id, rows: changes } : undefined);
    const m = await saveBinary(`${safeFileName(project.name)} - BOQ.xlsx`, await workbookBytes(wb), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  }
  async function exportTemplate() {
    const m = await saveBinary(`${safeFileName(list?.name ?? 'Price list')}.xlsx`, await workbookBytes(buildPriceTemplate(items, list)), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(`${m} — fill in the rates and import it back`);
  }
  async function importRates(file: File) {
    try {
      const r = await readPriceWorkbook(await file.arrayBuffer(), items);
      if (!r.read) { onStatus('No rates found — the sheet needs a Key or Description column and a Rate column'); return; }
      const l = list ?? newPriceList(file.name.replace(/\.xlsx$/i, ''));
      setList({ ...l, rates: { ...l.rates, ...r.rates }, date: new Date().toISOString().slice(0, 10) });
      onStatus(`Imported ${r.read} rates${r.unmatched ? ` · ${r.unmatched} rows not matched to an item` : ''}`);
    } catch (e) {
      onStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const q = filter.trim().toLowerCase();
  const cur = list?.currency ?? 'AED';

  return (
    <div className="bom">
      <section className="card bom-bar">
        <div className="bom-tabs">
          <button className={`chip${tab === 'boq' ? ' on' : ''}`} onClick={() => setTab('boq')}>Bill of quantities</button>
          <button className={`chip${tab === 'changes' ? ' on' : ''}`} onClick={() => setTab('changes')}>Changes since a revision</button>
          <button className={`chip${tab === 'circuits' ? ' on' : ''}`} onClick={() => setTab('circuits')}>Per circuit</button>
        </div>
        <span className="sp" />
        <button className="chip primary" onClick={exportBoq}>Excel BOQ</button>
      </section>

      <section className="card bom-prices">
        <label>Price list
          <input className="bi-text" value={list?.name ?? ''} placeholder="Typical rates (cables and breakers only)" onChange={(e) => edit({ name: e.target.value })} />
        </label>
        <label>Rates dated <input className="bi-text" type="date" value={list?.date ?? ''} onChange={(e) => edit({ date: e.target.value })} /></label>
        <label>Currency <input className="bi-text" style={{ width: 60 }} value={cur} onChange={(e) => edit({ currency: e.target.value })} /></label>
        <label>Markup % <input className="bi-text" style={{ width: 60 }} inputMode="decimal" value={list?.markupPct ?? 0} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) edit({ markupPct: n }); }} /></label>
        <select className="chip" value="" onChange={(e) => e.target.value && useFromLibrary(e.target.value)}>
          <option value="">Use a saved price list…</option>
          {library.map((l) => <option key={l.id} value={l.id}>{l.name} ({Object.keys(l.rates).length} rates, {l.date})</option>)}
        </select>
        <button className="chip" disabled={!list} onClick={saveToLibrary} title="Keep this list for your other projects">Save price list</button>
        <button className="chip" onClick={exportTemplate} title="Every item of this project with its key — fill in the rates in Excel">Rates sheet (Excel)</button>
        <button className="chip" onClick={() => fileRef.current?.click()}>Import rates…</button>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importRates(f); e.target.value = ''; }} />
      </section>

      {tab === 'boq' && (
        <>
          <div className="bom-totals">
            {bom.sections.map((s) => <span key={s.section} className="bom-sec"><b>{s.section}</b> {s.title} <span className="m">{money(s.amount)}</span></span>)}
            <span className="sp" />
            {bom.missing > 0 && <span className="warn">⚠ {bom.missing} items without a rate</span>}
            <span>Subtotal <b>{money(bom.subtotal)}</b>{list?.markupPct ? <> · +{list.markupPct} % <b>{money(bom.markup)}</b></> : null} · Total <b>{cur} {money(bom.total)}</b></span>
          </div>
          <input className="bi-text" style={{ width: 260, margin: '6px 0' }} placeholder="Filter items…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="tw">
            <table className="bom-table">
              <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Qty</th><th>Supply rate</th><th>Install rate</th><th>Amount</th><th>Location</th></tr></thead>
              <tbody>
                {bom.sections.map((s) => {
                  const rows = s.items.filter((it) => !q || it.description.toLowerCase().includes(q) || it.where.some((w) => w.toLowerCase().includes(q)));
                  if (!rows.length) return null;
                  return [
                    <tr key={s.section} className="bom-sec-row"><td>{s.section}</td><td colSpan={5}>{s.title.toUpperCase()}</td><td>{money(s.amount)}</td><td /></tr>,
                    ...rows.map((it) => (
                      <tr key={it.key} className={it.source === 'missing' ? 'bom-missing' : undefined}>
                        <td className="m">{s.section}.{s.items.indexOf(it) + 1}</td>
                        <td>{it.description}</td>
                        <td>{it.unit}</td>
                        <td className="num">{qtyText(it.qty)}</td>
                        <td><input className="bom-rate" inputMode="decimal" key={`${it.key}-${list?.rates[it.key]?.rate ?? it.rate ?? ''}`}
                          defaultValue={list?.rates[it.key]?.rate ?? ''} placeholder={it.source === 'typical' ? `${it.rate} typ.` : '—'}
                          onBlur={(e) => e.target.value !== String(list?.rates[it.key]?.rate ?? '') && setRate(it.key, 'rate', e.target.value, it.description)} /></td>
                        <td><input className="bom-rate" inputMode="decimal" key={`${it.key}-l-${list?.rates[it.key]?.labour ?? ''}`}
                          defaultValue={list?.rates[it.key]?.labour ?? ''} placeholder="—" title="Installation per unit"
                          onBlur={(e) => e.target.value !== String(list?.rates[it.key]?.labour ?? '') && setRate(it.key, 'labour', e.target.value, it.description)} /></td>
                        <td className="num">{it.source === 'missing' ? '' : money(it.amount)}</td>
                        <td className="m" title={it.where.join(', ')}>{it.where.slice(0, 3).join(', ')}{it.where.length > 3 ? ` +${it.where.length - 3}` : ''}</td>
                      </tr>
                    ))
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="m">Rates you type are kept in this project's price list; “typ.” are built-in illustrative rates, not market prices. Quantities come from the design: glands and lugs at both ends of every cable, earth conductors with armoured cables, trays and busbar from their studies.</p>
        </>
      )}

      {tab === 'changes' && (
        <section className="card">
          {!project.revisions?.length ? <p className="m">No revision issued yet — issue one (Reports → Revisions) and the changes since then show here.</p> : (
            <>
              <label className="row" style={{ gap: 6 }}>Since revision
                <select className="chip" value={since} onChange={(e) => setSince(e.target.value)}>
                  {project.revisions.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.date} {r.description}</option>)}
                </select>
                {rev && <b style={{ marginLeft: 12 }}>Net change: {changes.reduce((a, c) => a + c.cost, 0) >= 0 ? '+' : '−'}{cur} {money(Math.abs(changes.reduce((a, c) => a + c.cost, 0)))}</b>}
              </label>
              {!changes.length ? <p className="ok">✓ No change in quantities since revision {since}.</p> : (
                <table className="bom-table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Sec.</th><th>Description</th><th>Unit</th><th>Rev {since}</th><th>Now</th><th>Change</th><th>Cost change</th></tr></thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.key}>
                        <td>{c.section}</td><td>{c.description}</td><td>{c.unit}</td>
                        <td className="num">{qtyText(c.before)}</td><td className="num">{qtyText(c.after)}</td>
                        <td className={`num ${c.delta > 0 ? 'ok' : 'bad'}`}>{c.delta > 0 ? '+' : ''}{qtyText(c.delta)}</td>
                        <td className="num">{c.cost ? `${c.cost > 0 ? '+' : '−'}${money(Math.abs(c.cost))}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'circuits' && <BoqTable results={results} projectName={project.name} project={project} />}
    </div>
  );
}
