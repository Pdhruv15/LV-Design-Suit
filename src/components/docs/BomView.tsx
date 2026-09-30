import { useEffect, useMemo, useRef, useState } from 'react';
import type { BomCommand } from '../Ribbon';
import type { Project } from '../../types';
import type { FeederResult } from '../../calc/electrical';
import { buildBom, BOM_SECTIONS } from '../../calc/bom';
import {
  compareBom, designQty, EXTRA_SECTIONS, EXTRAS, fallbackRate, loadPriceLists, newPriceList, nextSectionId, priceBom, savePriceLists, sectionTitles,
  type BoqCustom, type BoqOverride, type ManualItem, type PriceList, type PricedItem
} from '../../model/priceList';
import { buildBoqHtml, buildBoqWorkbook, buildPriceTemplate, readPriceWorkbook } from '../../docs/boqWorkbook';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import BoqTable from '../BoqTable';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const UNITS = ['no', 'm', 'set', 'lot', 'LS', 'PS', 'm²', 'kg'];
const numOr = (v: string) => { const t = v.trim().replace(/,/g, ''); if (t === '') return undefined; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

type Dialog =
  | { kind: 'item'; item: ManualItem; isNew: boolean }
  | { kind: 'design'; it: PricedItem; design: number }
  | { kind: 'section' }
  | { kind: 'extras' }
  | { kind: 'wastage' }
  | { kind: 'markup' };

/** BOM / Cost → Bill of quantities: everything in the design rolled up by
 * tender section, your own lines and sections, quantity adjustments,
 * wastage and pricing from your price list; Excel and PDF output, and the
 * change since an issued revision. */
export default function BomView({ command, project, results, onChange, onStatus }: { command?: { cmd: BomCommand; n: number }; project: Project; results: FeederResult[]; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const [tab, setTab] = useState<'boq' | 'changes' | 'circuits'>('boq');
  const [library, setLibrary] = useState<PriceList[]>(loadPriceLists);
  const [since, setSince] = useState<string>(() => project.revisions?.[project.revisions.length - 1]?.id ?? '');
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = project.priceList;
  const custom = project.boq;
  const items = useMemo(() => buildBom(project), [project]);
  const bom = useMemo(() => priceBom(items, list, custom), [items, list, custom]);
  const rev = project.revisions?.find((r) => r.id === since);
  const changes = useMemo(() => (rev ? compareBom(buildBom(rev.snapshot as Project), items, list) : []), [rev, items, list]);
  const titles = sectionTitles(custom);
  const cur = list?.currency ?? 'AED';

  const setList = (l: PriceList | undefined) => onChange({ ...project, priceList: l });
  const edit = (patch: Partial<PriceList>) => setList({ ...(list ?? newPriceList()), ...patch });
  const setCustom = (patch: Partial<BoqCustom>) => onChange({ ...project, boq: { ...custom, ...patch } });
  const setOverride = (key: string, o: BoqOverride | undefined) => {
    const overrides = { ...custom?.overrides };
    if (o && (o.qty !== undefined || o.description || o.excluded)) overrides[key] = o; else delete overrides[key];
    setCustom({ overrides });
  };
  const saveManual = (m: ManualItem) => setCustom({ manual: [...(custom?.manual ?? []).filter((x) => x.id !== m.id), m] });
  const deleteManual = (id: string) => setCustom({ manual: (custom?.manual ?? []).filter((x) => x.id !== id) });
  const ensureSection = (id: string, c: BoqCustom = custom ?? {}): BoqCustom['sections'] =>
    id in BOM_SECTIONS || (c.sections ?? []).some((s) => s.id === id) ? c.sections : [...(c.sections ?? []), { id, title: EXTRA_SECTIONS[id] ?? `Section ${id}` }];

  const setRate = (key: string, field: 'rate' | 'labour', v: string, description: string) => {
    const l = list ?? newPriceList();
    const curE = l.rates[key] ?? { rate: fallbackRate(key) ?? 0 };
    const n = numOr(v);
    if (Number.isNaN(n)) return;
    const rates = { ...l.rates };
    if (field === 'rate' && n === undefined) delete rates[key];
    else rates[key] = { ...curE, description, [field]: n ?? (field === 'rate' ? 0 : undefined) };
    setList({ ...l, rates });
  };
  const setManualRate = (id: string, field: 'rate' | 'labour', v: string) => {
    const m = custom?.manual?.find((x) => x.id === id);
    const n = numOr(v);
    if (!m || Number.isNaN(n)) return;
    saveManual({ ...m, [field]: n });
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
  const newItem = (section = nextManualSection()): ManualItem => ({ id: `m${Date.now().toString(36)}`, section, description: '', unit: 'no', qty: 1 });
  function nextManualSection() { return custom?.sections?.[custom.sections.length - 1]?.id ?? 'K'; }

  async function exportBoq() {
    const wb = buildBoqWorkbook(project, bom, list, rev ? { since: rev.id, rows: changes } : undefined);
    const m = await saveBinary(`${safeFileName(project.name)} - BOQ.xlsx`, await workbookBytes(wb), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  }
  async function exportPdf(summaryOnly: boolean) {
    const m = await savePdf(`${safeFileName(project.name)} - BOQ${summaryOnly ? ' summary' : ''}.pdf`, buildBoqHtml(project, bom, list, summaryOnly), { pageSize: 'A4' });
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

  // Ribbon commands (BOM / Cost tab).
  const last = useRef(0);
  useEffect(() => {
    if (!command || command.n === last.current) return;
    last.current = command.n;
    const c = command.cmd;
    if (c === 'boq' || c === 'changes' || c === 'circuits') setTab(c);
    else if (c === 'excel') exportBoq();
    else if (c === 'pdf') exportPdf(false);
    else if (c === 'summary-pdf') exportPdf(true);
    else if (c === 'rates-sheet') exportTemplate();
    else if (c === 'import') fileRef.current?.click();
    else if (c === 'save-list') saveToLibrary();
    else if (c === 'add-item') { setTab('boq'); setDialog({ kind: 'item', item: newItem(), isNew: true }); }
    else if (c === 'add-section') setDialog({ kind: 'section' });
    else if (c === 'extras') setDialog({ kind: 'extras' });
    else if (c === 'wastage') setDialog({ kind: 'wastage' });
    else if (c === 'markup') setDialog({ kind: 'markup' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const q = filter.trim().toLowerCase();
  const openRow = (it: PricedItem) => {
    if (it.manualId) { const m = custom?.manual?.find((x) => x.id === it.manualId); if (m) setDialog({ kind: 'item', item: m, isNew: false }); return; }
    const raw = items.find((x) => x.key === it.key);
    if (raw) setDialog({ kind: 'design', it, design: designQty(raw, custom) });
  };

  return (
    <div className="bom">
      <section className="card bom-bar">
        <div className="bom-tabs">
          <button className={`chip${tab === 'boq' ? ' on' : ''}`} onClick={() => setTab('boq')}>Bill of quantities</button>
          <button className={`chip${tab === 'changes' ? ' on' : ''}`} onClick={() => setTab('changes')}>Changes since a revision</button>
          <button className={`chip${tab === 'circuits' ? ' on' : ''}`} onClick={() => setTab('circuits')}>Per circuit</button>
        </div>
        <span className="sp" />
        <button className="chip" onClick={() => setDialog({ kind: 'item', item: newItem(), isNew: true })}>+ Item</button>
        <button className="chip" onClick={() => setDialog({ kind: 'extras' })}>+ Extras</button>
        <button className="chip primary" onClick={exportBoq}>Excel BOQ</button>
      </section>

      <section className="card bom-prices">
        <label>Price list
          <input className="bi-text" value={list?.name ?? ''} placeholder="Typical rates (cables and breakers only)" onChange={(e) => edit({ name: e.target.value })} />
        </label>
        <label>Rates dated <input className="bi-text" type="date" value={list?.date ?? ''} onChange={(e) => edit({ date: e.target.value })} /></label>
        <label>Currency <input className="bi-text" style={{ width: 60 }} value={cur} onChange={(e) => edit({ currency: e.target.value })} /></label>
        <button className="chip" onClick={() => setDialog({ kind: 'markup' })}>Markup {list?.markupPct ?? 0} % · Discount {custom?.discountPct ?? 0} %</button>
        <select className="chip" value="" onChange={(e) => e.target.value && useFromLibrary(e.target.value)}>
          <option value="">Use a saved price list…</option>
          {library.map((l) => <option key={l.id} value={l.id}>{l.name} ({Object.keys(l.rates).length} rates, {l.date})</option>)}
        </select>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importRates(f); e.target.value = ''; }} />
      </section>

      {tab === 'boq' && (
        <>
          <div className="bom-totals">
            {bom.sections.map((s) => <span key={s.section} className="bom-sec"><b>{s.section}</b> {s.title} <span className="m">{money(s.amount)}</span></span>)}
            <span className="sp" />
            {bom.changed > 0 && <span className="warn">⚠ {bom.changed} adjusted items: design changed — check</span>}
            {bom.missing > 0 && <span className="warn">⚠ {bom.missing} items without a rate</span>}
            <span>Subtotal <b>{money(bom.subtotal)}</b>{list?.markupPct ? <> · +{list.markupPct} % <b>{money(bom.markup)}</b></> : null}{bom.discount ? <> · −{custom?.discountPct} % <b>{money(bom.discount)}</b></> : null} · Total <b>{cur} {money(bom.total)}</b></span>
          </div>
          <input className="bi-text" style={{ width: 260, margin: '6px 0' }} placeholder="Filter items…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="tw">
            <table className="bom-table">
              <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Qty</th><th>Supply rate</th><th>Install rate</th><th>Amount</th><th>Location / note</th></tr></thead>
              <tbody>
                {bom.sections.map((s) => {
                  const rows = s.items.filter((it) => !q || it.description.toLowerCase().includes(q) || it.where.some((w) => w.toLowerCase().includes(q)));
                  const own = (custom?.sections ?? []).some((c) => c.id === s.section);
                  if (!rows.length && !own) return null;
                  return [
                    <tr key={s.section} className="bom-sec-row">
                      <td>{s.section}</td>
                      <td colSpan={5}>{s.title.toUpperCase()}{custom?.wastage?.[s.section] ? <span className="m"> · +{custom.wastage[s.section]} % wastage</span> : null}</td>
                      <td className="num">{money(s.amount)}</td>
                      <td className="acts">
                        <button className="icon-btn" title={`Add an item to section ${s.section}`} onClick={() => setDialog({ kind: 'item', item: newItem(s.section), isNew: true })}>＋</button>
                        {own && <button className="icon-btn" title="Rename section" onClick={() => { const t = window.prompt('Section title', s.title); if (t) setCustom({ sections: (custom?.sections ?? []).map((c) => (c.id === s.section ? { ...c, title: t } : c)) }); }}>✎</button>}
                        {own && !s.items.length && <button className="icon-btn" title="Remove the empty section" onClick={() => setCustom({ sections: (custom?.sections ?? []).filter((c) => c.id !== s.section) })}>✕</button>}
                      </td>
                    </tr>,
                    ...rows.map((it) => {
                      const manual = !!it.manualId;
                      const m = manual ? custom?.manual?.find((x) => x.id === it.manualId) : undefined;
                      const cls = [it.source === 'missing' || (manual && it.rate === undefined && !it.labour) ? 'bom-missing' : '', it.source === 'excluded' ? 'bom-excluded' : '', it.changed ? 'bom-changed' : ''].filter(Boolean).join(' ');
                      return (
                        <tr key={it.key} className={cls || undefined}>
                          <td className="m bom-no">{s.section}.{s.items.indexOf(it) + 1}<button className="icon-btn" title={manual ? 'Edit this item' : 'Change quantity or description, or mark by others'} onClick={() => openRow(it)}>✎</button></td>
                          <td>
                            {it.description || <span className="m">(no description)</span>}
                            {manual && <span className="bom-tag">manual</span>}
                            {it.source === 'excluded' && <span className="bom-tag">by others</span>}
                            {it.changed && <span className="bom-tag warn" title="The design quantity changed since you adjusted this line">design changed</span>}
                          </td>
                          <td>{it.unit}</td>
                          <td className="num">{qtyText(it.qty)}{it.designQty !== undefined && <div className="m" title="Quantity from the design">design {qtyText(it.designQty)}</div>}</td>
                          <td>{it.source !== 'excluded' && <input className="bom-rate" inputMode="decimal" key={`${it.key}-${manual ? m?.rate : list?.rates[it.key]?.rate}`}
                            defaultValue={(manual ? m?.rate : list?.rates[it.key]?.rate) ?? ''} placeholder={it.source === 'typical' ? `${it.rate} typ.` : '—'}
                            onBlur={(e) => { const old = String((manual ? m?.rate : list?.rates[it.key]?.rate) ?? ''); if (e.target.value !== old) manual ? setManualRate(it.manualId!, 'rate', e.target.value) : setRate(it.key, 'rate', e.target.value, it.description); }} />}</td>
                          <td>{it.source !== 'excluded' && <input className="bom-rate" inputMode="decimal" key={`${it.key}-l-${manual ? m?.labour : list?.rates[it.key]?.labour}`}
                            defaultValue={(manual ? m?.labour : list?.rates[it.key]?.labour) ?? ''} placeholder="—" title="Installation per unit"
                            onBlur={(e) => { const old = String((manual ? m?.labour : list?.rates[it.key]?.labour) ?? ''); if (e.target.value !== old) manual ? setManualRate(it.manualId!, 'labour', e.target.value) : setRate(it.key, 'labour', e.target.value, it.description); }} />}</td>
                          <td className="num">{it.source === 'excluded' ? <span className="m">By others</span> : it.amount ? money(it.amount) : ''}</td>
                          <td className="m" title={it.where.join(', ')}>{it.note ? <i>{it.note}</i> : null}{it.note && it.where.length ? ' · ' : ''}{it.where.slice(0, 3).join(', ')}{it.where.length > 3 ? ` +${it.where.length - 3}` : ''}</td>
                        </tr>
                      );
                    })
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="m">Lines A–I come from the design; ✎ changes a quantity or description (the design quantity stays beside it) or marks a line “by others”. Your own lines and sections (+ Item, + Extras, + Section) are kept with the project. “typ.” rates are built-in illustrative rates, not market prices.</p>
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
              {!changes.length ? <p className="ok">✓ No change in design quantities since revision {since}.</p> : (
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

      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal bom-dialog" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === 'item' && <ItemForm item={dialog.item} isNew={dialog.isNew} titles={titles}
              onSave={(m) => { onChange({ ...project, boq: { ...custom, sections: ensureSection(m.section), manual: [...(custom?.manual ?? []).filter((x) => x.id !== m.id), m] } }); setDialog(null); }}
              onDelete={() => { deleteManual(dialog.item.id); setDialog(null); }} onClose={() => setDialog(null)} />}
            {dialog.kind === 'design' && <DesignForm it={dialog.it} design={dialog.design} o={custom?.overrides?.[dialog.it.key]} raw={items.find((x) => x.key === dialog.it.key)?.description ?? ''}
              onSave={(o) => { setOverride(dialog.it.key, o); setDialog(null); }} onClose={() => setDialog(null)} />}
            {dialog.kind === 'section' && <SectionForm id={nextSectionId(custom)}
              onSave={(id, title) => { setCustom({ sections: [...(custom?.sections ?? []).filter((c) => c.id !== id), { id, title }] }); setDialog(null); }} onClose={() => setDialog(null)} />}
            {dialog.kind === 'extras' && <ExtrasForm have={new Set((custom?.manual ?? []).map((m) => m.description))}
              onSave={(picked) => {
                let c: BoqCustom = { ...custom };
                const manual = [...(c.manual ?? [])];
                picked.forEach((x, i) => { c = { ...c, sections: ensureSection(x.section, c) }; manual.push({ id: `m${Date.now().toString(36)}${i}`, ...x }); });
                onChange({ ...project, boq: { ...c, manual } });
                onStatus(`Added ${picked.length} items — enter their rates`);
                setDialog(null);
              }} onClose={() => setDialog(null)} />}
            {dialog.kind === 'wastage' && <WastageForm titles={Object.fromEntries(Object.entries(BOM_SECTIONS))} value={custom?.wastage ?? {}}
              onSave={(w) => { setCustom({ wastage: w }); setDialog(null); }} onClose={() => setDialog(null)} />}
            {dialog.kind === 'markup' && <MarkupForm markup={list?.markupPct ?? 0} discount={custom?.discountPct ?? 0}
              onSave={(mk, d) => { onChange({ ...project, priceList: { ...(list ?? newPriceList()), markupPct: mk }, boq: { ...custom, discountPct: d || undefined } }); setDialog(null); }} onClose={() => setDialog(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Actions({ onClose, onSave, ok = true, extra }: { onClose: () => void; onSave: () => void; ok?: boolean; extra?: React.ReactNode }) {
  return <div className="modal-actions">{extra}<span className="sp" /><button className="chip" onClick={onClose}>Cancel</button><button className="chip primary" disabled={!ok} onClick={onSave}>Save</button></div>;
}

function ItemForm({ item, isNew, titles, onSave, onDelete, onClose }: { item: ManualItem; isNew: boolean; titles: Record<string, string>; onSave: (m: ManualItem) => void; onDelete: () => void; onClose: () => void }) {
  const [m, setM] = useState(item);
  const [qty, setQty] = useState(String(item.qty));
  const [rate, setRate] = useState(item.rate === undefined ? '' : String(item.rate));
  const [labour, setLabour] = useState(item.labour === undefined ? '' : String(item.labour));
  const q = numOr(qty), r = numOr(rate), l = numOr(labour);
  const ok = !!m.description.trim() && q !== undefined && !Number.isNaN(q) && !Number.isNaN(r) && !Number.isNaN(l);
  const sections = { ...titles, ...(m.section in titles ? {} : { [m.section]: EXTRA_SECTIONS[m.section] ?? `Section ${m.section}` }) };
  return (
    <>
      <h3>{isNew ? 'Add a BOQ item' : 'Edit item'}</h3>
      <div className="form-kv">
        <label>Section
          <select value={m.section} onChange={(e) => setM({ ...m, section: e.target.value })}>
            {Object.entries(sections).map(([id, t]) => <option key={id} value={id}>{id} — {t}</option>)}
          </select>
        </label>
        <label style={{ gridColumn: '1 / -1' }}>Description <textarea autoFocus rows={2} value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} placeholder="e.g. Supply and install LED downlight 12 W, IP44" /></label>
        <label>Unit <select value={m.unit} onChange={(e) => setM({ ...m, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label>Quantity <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>Supply rate <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" /></label>
        <label>Install rate <input inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} placeholder="—" /></label>
        <label style={{ gridColumn: '1 / -1' }}>Note <input value={m.note ?? ''} onChange={(e) => setM({ ...m, note: e.target.value || undefined })} placeholder="e.g. as per spec clause 16.4" /></label>
      </div>
      <Actions onClose={onClose} ok={ok} onSave={() => onSave({ ...m, description: m.description.trim(), qty: q!, rate: r, labour: l })}
        extra={!isNew && <button className="chip bad" onClick={onDelete}>Delete item</button>} />
    </>
  );
}

function DesignForm({ it, design, o, raw, onSave, onClose }: { it: PricedItem; design: number; o?: BoqOverride; raw: string; onSave: (o: BoqOverride | undefined) => void; onClose: () => void }) {
  const [qty, setQty] = useState(o?.qty === undefined ? '' : String(o.qty));
  const [desc, setDesc] = useState(o?.description ?? '');
  const [excluded, setExcluded] = useState(!!o?.excluded);
  const n = numOr(qty);
  return (
    <>
      <h3>{it.section} — design item</h3>
      <p className="m">{raw}<br />Design quantity: <b>{qtyText(design)} {it.unit}</b>{it.where.length ? ` · ${it.where.join(', ')}` : ''}</p>
      {o?.designQty !== undefined && o.designQty !== design && <p className="warn">⚠ The design quantity was {qtyText(o.designQty)} when you adjusted it; now {qtyText(design)}. Saving marks it checked.</p>}
      <div className="form-kv">
        <label>Your quantity <input autoFocus inputMode="decimal" value={qty} placeholder={`${qtyText(design)} (design)`} onChange={(e) => setQty(e.target.value)} /></label>
        <label style={{ gridColumn: '1 / -1' }}>Your description <textarea rows={2} value={desc} placeholder={raw} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="row" style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} style={{ width: 'auto' }} /> By others — not priced (e.g. supplied by DEWA / the client)</label>
      </div>
      <Actions onClose={onClose} ok={!Number.isNaN(n)}
        onSave={() => onSave({ qty: n, description: desc.trim() || undefined, excluded: excluded || undefined, designQty: design })}
        extra={o && <button className="chip" onClick={() => onSave(undefined)}>Back to the design</button>} />
    </>
  );
}

function SectionForm({ id: id0, onSave, onClose }: { id: string; onSave: (id: string, title: string) => void; onClose: () => void }) {
  const [id, setId] = useState(id0);
  const [title, setTitle] = useState('');
  return (
    <>
      <h3>Add a section</h3>
      <div className="form-kv">
        <label>Letter <input value={id} onChange={(e) => setId(e.target.value.toUpperCase().slice(0, 3))} /></label>
        <label style={{ gridColumn: '1 / -1' }}>Title <input autoFocus value={title} placeholder="e.g. Lighting fixtures" onChange={(e) => setTitle(e.target.value)} /></label>
      </div>
      <p className="m">Suggestions: Lighting fixtures · Wiring devices · Fire alarm · ELV / data · Civil works · Testing and commissioning · Provisional sums</p>
      <Actions onClose={onClose} ok={!!id.trim() && !!title.trim() && !(id in BOM_SECTIONS)} onSave={() => onSave(id.trim(), title.trim())} />
    </>
  );
}

function ExtrasForm({ have, onSave, onClose }: { have: Set<string>; onSave: (x: typeof EXTRAS) => void; onClose: () => void }) {
  const [on, setOn] = useState<Set<number>>(new Set());
  return (
    <>
      <h3>Add extra scope</h3>
      <p className="m">Common items that aren't in the design. They go in sections K–M; enter their quantities and rates after.</p>
      {Object.entries(EXTRA_SECTIONS).map(([sec, title]) => (
        <div key={sec} className="bom-extras">
          <b>{sec} — {title}</b>
          {EXTRAS.map((x, i) => x.section === sec && (
            <label key={i} className="row">
              <input type="checkbox" disabled={have.has(x.description)} checked={on.has(i) || have.has(x.description)} onChange={() => setOn((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
              {x.description} <span className="m">({x.unit})</span>{have.has(x.description) && <span className="m"> — added</span>}
            </label>
          ))}
        </div>
      ))}
      <Actions onClose={onClose} ok={on.size > 0} onSave={() => onSave([...on].map((i) => EXTRAS[i]))} />
    </>
  );
}

function WastageForm({ titles, value, onSave, onClose }: { titles: Record<string, string>; value: Record<string, number>; onSave: (w: Record<string, number>) => void; onClose: () => void }) {
  const [w, setW] = useState<Record<string, string>>(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)])));
  return (
    <>
      <h3>Wastage allowance</h3>
      <p className="m">Added to the design quantities of each section and rounded up (e.g. cables 5 %, trays 10 %). Your own quantities are not changed.</p>
      <div className="form-kv">
        {Object.entries(titles).map(([id, t]) => (
          <label key={id}>{id} — {t} <input inputMode="decimal" value={w[id] ?? ''} placeholder="0 %" onChange={(e) => setW({ ...w, [id]: e.target.value })} /></label>
        ))}
      </div>
      <Actions onClose={onClose} onSave={() => onSave(Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number) && (v as number) > 0)))} />
    </>
  );
}

function MarkupForm({ markup, discount, onSave, onClose }: { markup: number; discount: number; onSave: (m: number, d: number) => void; onClose: () => void }) {
  const [m, setM] = useState(String(markup));
  const [d, setD] = useState(String(discount));
  const mn = numOr(m) ?? 0, dn = numOr(d) ?? 0;
  return (
    <>
      <h3>Markup and discount</h3>
      <div className="form-kv">
        <label>Overheads and profit (%) <input autoFocus inputMode="decimal" value={m} onChange={(e) => setM(e.target.value)} /></label>
        <label>Discount (%) <input inputMode="decimal" value={d} onChange={(e) => setD(e.target.value)} /></label>
      </div>
      <p className="m">Total = subtotal + overheads and profit − discount (on the total with markup).</p>
      <Actions onClose={onClose} ok={!Number.isNaN(mn) && !Number.isNaN(dn)} onSave={() => onSave(mn, dn)} />
    </>
  );
}
