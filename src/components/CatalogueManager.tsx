import { useRef, useState } from 'react';
import type { EnclosureCatalogue, EnclosureConfig, Dims } from '../calc/enclosure';
import {
  allCatalogues, catalogueWorkbook, duplicateCatalogue, emptyCatalogue, exportLibrary, importLibrary, isBuiltin, loadDevices, readCatalogueWorkbook,
  saveDevices, saveUserCatalogues, userCatalogues, validateCatalogue, type DeviceDim, type DeviceKind
} from '../model/enclosureLibrary';
import { workbookBytes } from '../docs/formWorkbook';
import { safeFileName, saveBinary, saveText } from '../util/files';

import { BRAND_DEVICES } from '../data/brandDevices';
const KINDS: DeviceKind[] = ['MCB', 'RCBO', 'RCCB', 'MCCB', 'ACB', 'Isolator', 'SPD', 'Contactor', 'Meter', 'Pilot light', 'Other'];
const n = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** Catalogue manager: enclosure catalogues (supplier, range, sizes, allowance cases) and device
 * dimensions. The built-in supplier chart is read-only — duplicate it for edits or another brand.
 * Saved in your library (synced in Library.json); panels keep the copy they were sized with. */
export default function CatalogueManager({ onClose, onStatus }: { onClose: () => void; onStatus: (m: string) => void }) {
  const [tab, setTab] = useState<'enclosures' | 'devices'>('enclosures');
  const [cats, setCats] = useState<EnclosureCatalogue[]>(() => allCatalogues());
  const [selId, setSelId] = useState(cats[0]?.id ?? '');
  const [devices, setDevices] = useState<DeviceDim[]>(() => loadDevices());
  const jsonRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);
  const sel = cats.find((c) => c.id === selId);
  const locked = !sel || isBuiltin(sel);
  const issues = sel ? validateCatalogue(sel) : [];

  const persist = (list: EnclosureCatalogue[]) => { setCats(list); if (!saveUserCatalogues(list)) onStatus('Could not save the library on this computer (storage blocked)'); };
  const update = (patch: Partial<EnclosureCatalogue>) => sel && !locked && persist(cats.map((c) => (c.id === sel.id ? { ...c, ...patch } : c)));
  const add = (c: EnclosureCatalogue) => { persist([...cats, c]); setSelId(c.id); };
  const setConfig = (i: number, patch: Partial<EnclosureConfig>) => sel && update({ configs: sel.configs.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const setDim = (i: number, m: 'surface' | 'flush' | 'fabricated', key: keyof Dims, v: string) => {
    if (!sel) return;
    const k = sel.configs[i];
    const d = { h: 0, w: 0, d: 0, ...k.dims[m], [key]: n(v) ?? 0 };
    setConfig(i, { dims: { ...k.dims, [m]: d } });
  };
  const saveDevs = (list: DeviceDim[]) => { setDevices(list); saveDevices(list); };

  async function exportJson() {
    const m = await saveText('LV enclosure library.json', JSON.stringify(exportLibrary(), null, 2), 'JSON', 'json');
    if (m) onStatus(m);
  }
  async function exportXlsx(c?: EnclosureCatalogue) {
    const bytes = await workbookBytes(catalogueWorkbook(c));
    const m = await saveBinary(`${safeFileName(c ? `${c.supplier} ${c.range}` : 'Enclosure catalogue template')}.xlsx`, bytes, 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (m) onStatus(m);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cm" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>Catalogue manager</h3>
          <div className="seg"><button className={tab === 'enclosures' ? 'on' : ''} onClick={() => setTab('enclosures')}>Enclosures</button><button className={tab === 'devices' ? 'on' : ''} onClick={() => setTab('devices')}>Device dimensions</button></div>
          <span className="sp" />
          <button className="chip" onClick={exportJson} title="Your catalogues and device dimensions as one JSON file — backup or share">Export JSON</button>
          <button className="chip" onClick={() => jsonRef.current?.click()}>Import JSON</button>
          <input ref={jsonRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            try { const r = importLibrary(await f.text()); setCats(allCatalogues()); setDevices(loadDevices()); onStatus(`Imported ${r.catalogues} catalogue(s) and ${r.devices} device record(s)`); } catch (err) { onStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`); }
          }} />
        </div>
        <p className="m">Saved in your library on this computer and in Library.json in the database folder. Panels keep the copy and revision they were sized with — editing here never resizes a designed panel.</p>

        {tab === 'enclosures' ? (
          <div className="cm-cols">
            <section className="card">
              <h4>Catalogues</h4>
              {cats.map((c) => (
                <div key={c.id} className={`cm-item${c.id === selId ? ' on' : ''}`} onClick={() => setSelId(c.id)}>
                  <b>{c.supplier}</b> — {c.range} <span className="m">rev. {c.revision} · {c.configs.length} sizes{isBuiltin(c) ? ' · built-in, read-only' : ''}</span>
                </div>
              ))}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="chip" onClick={() => add(emptyCatalogue())}>Add</button>
                <button className="chip" disabled={!sel} onClick={() => sel && add(duplicateCatalogue(sel))} title="Copy, then change the supplier, dimensions and rules">Duplicate</button>
                <button className="chip" disabled={locked} onClick={() => { if (sel && confirm(`Delete ${sel.supplier} — ${sel.range} from your library? Panels sized with it keep their copy.`)) { persist(cats.filter((c) => c.id !== sel.id)); setSelId(cats[0]?.id ?? ''); } }}>Delete</button>
              </div>
              <h4>Excel</h4>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="chip" onClick={() => exportXlsx()}>Blank template</button>
                <button className="chip" disabled={!sel} onClick={() => sel && exportXlsx(sel)}>Export selected</button>
                <button className="chip" onClick={() => xlsxRef.current?.click()}>Import Excel</button>
              </div>
              <input ref={xlsxRef} type="file" accept=".xlsx" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
                try { const c = await readCatalogueWorkbook(await f.arrayBuffer()); add(c); const bad = validateCatalogue(c).filter((x) => x.level === 'bad').length; onStatus(`Imported ${c.supplier} — ${c.range}: ${c.configs.length} sizes${bad ? ` · ${bad} problem(s) to fix` : ''}`); } catch (err) { onStatus(`Excel import failed: ${err instanceof Error ? err.message : String(err)}`); }
              }} />
            </section>

            {sel && (
              <section className="card cm-edit">
                {locked && <p className="warn">Built-in supplier chart — read-only. Duplicate it to edit or to enter another brand.</p>}
                <fieldset disabled={locked}>
                  <div className="form-kv">
                    <label>Supplier / brand<input className="bi-text" value={sel.supplier} onChange={(e) => update({ supplier: e.target.value })} /></label>
                    <label>Product range<input className="bi-text" value={sel.range} onChange={(e) => update({ range: e.target.value })} /></label>
                    <label>Family<select value={sel.family} onChange={(e) => update({ family: e.target.value as EnclosureCatalogue['family'] })}><option value="modular">Modular DB (rows × modules, flush / surface)</option><option value="fabricated">Fabricated enclosure (H × W × D)</option></select></label>
                    <label>Source document<input className="bi-text" value={sel.source} onChange={(e) => update({ source: e.target.value })} /></label>
                    <label>Revision<input className="bi-text" value={sel.revision} onChange={(e) => update({ revision: e.target.value })} /></label>
                    <label>Notes (one per line)<textarea className="bi-text" rows={3} value={sel.notes.join('\n')} onChange={(e) => update({ notes: e.target.value.split('\n') })} /></label>
                  </div>
                  <h4>Allowance cases <span className="m">— what the supplier deducts and when (blank = any)</span></h4>
                  <table className="bi-table compact">
                    <thead><tr><th>Id</th><th>Label</th><th>Deduct</th><th>ELCB from</th><th>to</th><th>Incomer from A</th><th>to</th><th>Extra</th><th /></tr></thead>
                    <tbody>{sel.rules.map((r, i) => {
                      const set = (p: Partial<typeof r>) => update({ rules: sel.rules.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                      const opt = (k: 'elcbMin' | 'elcbMax' | 'incomerMinA' | 'incomerMaxA') => <input className="bi-num" style={{ width: 52 }} value={r[k] ?? ''} onChange={(e) => { const v = n(e.target.value); const { [k]: _x, ...rest } = r; update({ rules: sel.rules.map((x, j) => (j === i ? (v === undefined ? rest : { ...rest, [k]: v }) : x)) }); }} />;
                      return (
                        <tr key={i}>
                          <td><input className="bi-text" style={{ width: 70 }} value={r.id} onChange={(e) => { const id = e.target.value; update({ rules: sel.rules.map((x, j) => (j === i ? { ...x, id } : x)), configs: sel.configs.map((k) => { const { [r.id]: v, ...u } = k.usable; return { ...k, usable: { ...u, [id]: v ?? null } }; }) }); }} /></td>
                          <td><input className="bi-text" value={r.label} onChange={(e) => set({ label: e.target.value })} /></td>
                          <td><input className="bi-num" style={{ width: 52 }} value={r.deductModules} onChange={(e) => set({ deductModules: n(e.target.value) ?? 0 })} /></td>
                          <td>{opt('elcbMin')}</td><td>{opt('elcbMax')}</td><td>{opt('incomerMinA')}</td><td>{opt('incomerMaxA')}</td>
                          <td><input className="bi-text" value={r.extra ?? ''} onChange={(e) => set({ extra: e.target.value || undefined })} /></td>
                          <td><button className="icon-btn" onClick={() => update({ rules: sel.rules.filter((_, j) => j !== i) })}>✕</button></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  <button className="chip" onClick={() => update({ rules: [...sel.rules, { id: `r${sel.rules.length + 1}`, label: 'New case', deductModules: 0 }] })}>+ Case</button>
                  <h4>Sizes <span className="m">— usable = modules left after each case's allowance, as the supplier states it; blank = not offered</span></h4>
                  <div className="cm-scroll">
                    <table className="bi-table compact">
                      <thead><tr><th>Size</th>{sel.family === 'modular' && <><th>Rows</th><th>Per row</th></>}<th>Gross</th>
                        {sel.family === 'modular' ? <><th>Surface H × W × D</th><th>Flush H × W × D</th></> : <th>H × W × D</th>}
                        {sel.rules.map((r) => <th key={r.id} title={r.label}>Usable · {r.id}</th>)}<th /></tr></thead>
                      <tbody>{sel.configs.map((k, i) => {
                        const dims = (m: 'surface' | 'flush' | 'fabricated') => <span className="cm-dims">{(['h', 'w', 'd'] as const).map((x) => <input key={x} className="bi-num" style={{ width: 46 }} value={k.dims[m]?.[x] || ''} placeholder={x.toUpperCase()} onChange={(e) => setDim(i, m, x, e.target.value)} />)}</span>;
                        return (
                          <tr key={k.id}>
                            <td><input className="bi-text" style={{ width: 96 }} value={k.ref} onChange={(e) => setConfig(i, { ref: e.target.value })} /></td>
                            {sel.family === 'modular' && <>
                              <td><input className="bi-num" style={{ width: 38 }} value={k.rows ?? ''} onChange={(e) => setConfig(i, { rows: n(e.target.value) })} /></td>
                              <td><input className="bi-num" style={{ width: 38 }} value={k.modulesPerRow ?? ''} onChange={(e) => setConfig(i, { modulesPerRow: n(e.target.value) })} /></td>
                            </>}
                            <td><input className="bi-num" style={{ width: 46 }} value={k.grossModules} onChange={(e) => setConfig(i, { grossModules: n(e.target.value) ?? 0 })} /></td>
                            {sel.family === 'modular' ? <><td>{dims('surface')}</td><td>{dims('flush')}</td></> : <td>{dims('fabricated')}</td>}
                            {sel.rules.map((r) => <td key={r.id}><input className="bi-num" style={{ width: 46 }} value={k.usable[r.id] ?? ''} onChange={(e) => setConfig(i, { usable: { ...k.usable, [r.id]: n(e.target.value) ?? null } })} /></td>)}
                            <td><button className="icon-btn" onClick={() => update({ configs: sel.configs.filter((_, j) => j !== i) })}>✕</button></td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                  <button className="chip" onClick={() => update({ configs: [...sel.configs, { id: `c-${Date.now().toString(36)}`, ref: 'New size', grossModules: 0, dims: {}, usable: Object.fromEntries(sel.rules.map((r) => [r.id, null])) }] })}>+ Size</button>
                </fieldset>
                {issues.length > 0 && <ul className="bh-checks">{issues.map((x) => <li key={x.text} className={x.level}>{x.level === 'bad' ? '✕' : '!'} {x.text}</li>)}</ul>}
              </section>
            )}
          </div>
        ) : (
          <section className="card">
            <p className="m">Each device's real width, from the manufacturer's data — the schedule's devices are matched by type, poles and rating. Widths are never guessed from pole or circuit counts.</p>
            <div className="cm-scroll">
              <table className="bi-table compact">
                <thead><tr><th>Manufacturer</th><th>Model</th><th>Type</th><th>Poles</th><th>Rating from A</th><th>to A</th><th>Modules (18 mm)</th><th>W × H × D mm</th><th>Mounting</th><th>Accessories</th><th /></tr></thead>
                <tbody>{devices.map((d, i) => {
                  const set = (p: Partial<DeviceDim>) => saveDevs(devices.map((x, j) => (j === i ? { ...x, ...p } : x)));
                  return (
                    <tr key={d.id}>
                      <td><input className="bi-text" value={d.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} /></td>
                      <td><input className="bi-text" value={d.model} onChange={(e) => set({ model: e.target.value })} /></td>
                      <td><select className="bi-sel" value={d.kind} onChange={(e) => set({ kind: e.target.value as DeviceKind })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
                      <td><input className="bi-num" style={{ width: 40 }} value={d.poles} onChange={(e) => set({ poles: n(e.target.value) ?? 1 })} /></td>
                      <td><input className="bi-num" style={{ width: 50 }} value={d.ratingMinA ?? ''} onChange={(e) => set({ ratingMinA: n(e.target.value) })} /></td>
                      <td><input className="bi-num" style={{ width: 50 }} value={d.ratingMaxA ?? ''} onChange={(e) => set({ ratingMaxA: n(e.target.value) })} /></td>
                      <td><input className="bi-num" style={{ width: 50 }} value={d.modules} onChange={(e) => set({ modules: n(e.target.value) ?? 0 })} /></td>
                      <td className="cm-dims">{(['widthMm', 'heightMm', 'depthMm'] as const).map((k) => <input key={k} className="bi-num" style={{ width: 44 }} value={d[k] ?? ''} onChange={(e) => set({ [k]: n(e.target.value) })} />)}</td>
                      <td><input className="bi-text" style={{ width: 80 }} value={d.mounting ?? ''} onChange={(e) => set({ mounting: e.target.value || undefined })} /></td>
                      <td><input className="bi-text" value={d.accessories ?? ''} onChange={(e) => set({ accessories: e.target.value || undefined })} /></td>
                      <td><button className="icon-btn" title="Duplicate" onClick={() => saveDevs([...devices.slice(0, i + 1), { ...d, id: `dv-${Date.now().toString(36)}` }, ...devices.slice(i + 1)])}>⧉</button><button className="icon-btn" onClick={() => saveDevs(devices.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <button className="chip" onClick={() => saveDevs([...devices, { id: `dv-${Date.now().toString(36)}`, manufacturer: '', model: '', kind: 'MCB', poles: 1, modules: 0 }])}>+ Device</button>
            <h4>Manufacturer data (built in)</h4>
            <p className="m">Used after your own records and before the typical widths. Read-only — copy a row to your records to change it.</p>
            <div className="cm-scroll">
              <table className="bi-table compact">
                <thead><tr><th>Manufacturer</th><th>Series / poles</th><th>Type</th><th>Rating A</th><th>Modules</th><th>W × H × D mm</th><th>Mounting</th><th /></tr></thead>
                <tbody>{BRAND_DEVICES.map((d) => (
                  <tr key={d.id}>
                    <td>{d.manufacturer}</td><td>{d.model}</td><td>{d.kind}</td>
                    <td>{d.ratingMinA !== undefined || d.ratingMaxA !== undefined ? `${d.ratingMinA ?? ''}–${d.ratingMaxA ?? ''}` : '—'}</td>
                    <td>{d.modules || '—'}</td><td>{d.widthMm} × {d.heightMm} × {d.depthMm}</td><td>{d.mounting}</td>
                    <td><button className="chip" title="Copy to your records to edit" onClick={() => saveDevs([...devices, { ...d, id: `dv-${Date.now().toString(36)}`, note: `Copied from ${d.manufacturer} ${d.model}` }])}>Copy</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}
        <div className="modal-actions"><span className="sp" /><button className="chip primary" onClick={() => { onClose(); }}>Done</button></div>
      </div>
    </div>
  );
}
