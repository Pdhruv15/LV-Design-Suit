import { useState } from 'react';
import type { BomItem } from '../../calc/bom';
import type { Project } from '../../types';
import type { PricedBom } from '../../model/priceList';
import { boqRevisionsOf } from '../../model/boqRevisions';
import {
  contractRate, deleteVariation, foldVariations, INSTRUCTED_BY, lineAmount, netOf, NEXT_STATUS, nextVariationId, saveVariation, setContractRevision, valueOf,
  variationsOf, variationTotals, VO_SECTION, VO_STATUS, type Variation, type VoLine, type VoStatus
} from '../../model/variations';
import { buildVariationHtml, buildVariationWorkbook } from '../../docs/variationReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { offerSubmission } from '../../model/submissions';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => { const t = v.trim().replace(/,/g, ''); if (!t) return undefined; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : undefined; };

/** BOM / Cost → Variations: the variation account against the contract BOQ — each variation's
 * lines, status and value, the contract sum, and the register and VO sheets as PDF or Excel. */
export default function VariationsView({ project, items, bom, cur, onChange, onStatus }: { project: Project; items: BomItem[]; bom: PricedBom; cur: string; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const [editing, setEditing] = useState<Variation | null>(null);
  const vos = variationsOf(project);
  const t = variationTotals(project);
  const revisions = boqRevisionsOf(project);
  const foldable = vos.filter((v) => v.status === 'approved' && v.foldedInto === undefined);
  const base = safeFileName([project.name, project.boq?.document?.docNo].filter(Boolean).join(' '));

  async function pdf(sheets?: string[]) {
    try {
      const single = sheets?.length === 1;
      const html = buildVariationHtml(project, single ? { register: false, sheets } : {});
      const m = await savePdf(`${base} - ${single ? sheets![0] : 'Variation register'}.pdf`, html, { pageSize: 'A4', cssPages: true, selfNumbered: true });
      if (m) {
        onStatus(m);
        const v = single ? vos.find((x) => x.id === sheets![0]) : undefined;
        offerSubmission(v ? { kind: 'Variation', title: `${v.id} — ${v.title}`, purpose: 'For approval', docs: [{ number: v.id, title: v.title, rev: '—' }] }
          : { kind: 'Variation', title: 'Variation register', purpose: 'For information', docs: [{ number: project.boq?.document?.docNo ? `${project.boq.document.docNo} VOR` : 'Variation register', title: 'Variation register', rev: '—' }] });
      }
    } catch (e) { onStatus(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function excel() {
    const m = await saveBinary(`${base} - Variation register.xlsx`, await workbookBytes(buildVariationWorkbook(project)), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  }
  function fold() {
    const ids = foldable.map((v) => v.id);
    if (!window.confirm(`Bring ${ids.join(', ')} into the working BOQ? Quantities of the BOQ items change and new items are added to the bill; the next BOQ revision marks them △. The contract sum is not changed.`)) return;
    onChange(foldVariations(project, items, bom, ids));
    onStatus(`${ids.join(', ')} brought into the BOQ — issue BOQ Rev ${revisions.length} to record them`);
  }

  if (editing) return <VoEditor key={editing.id} vo={editing} project={project} bom={bom} cur={cur} isNew={!vos.some((v) => v.id === editing.id)}
    onSave={(v) => { onChange(saveVariation(project, v)); setEditing(null); onStatus(`${v.id} saved`); }}
    onDelete={() => { onChange(deleteVariation(project, editing.id)); setEditing(null); onStatus(`${editing.id} deleted`); }}
    onClose={() => setEditing(null)} />;

  return (
    <section className="card">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <label className="row" style={{ gap: 6 }}>Contract BOQ
          <select className="chip" value={t.contract?.id ?? ''} onChange={(e) => onChange(setContractRevision(project, e.target.value || undefined))} disabled={!revisions.length}>
            <option value="">{revisions.length ? 'Not marked' : 'Issue a BOQ revision first'}</option>
            {revisions.map((r) => <option key={r.id} value={r.id}>Rev {r.id} — {r.description} ({money(r.total)})</option>)}
          </select>
        </label>
        <span className="sp" />
        <button className="chip" onClick={() => setEditing({ id: nextVariationId(project), title: '', raised: today(), status: 'draft', lines: [] })}>+ Variation</button>
        {foldable.length > 0 && <button className="chip" onClick={fold} title="Change the working BOQ by the approved variations, to re-issue it">Bring {foldable.length} approved into BOQ</button>}
        <button className="chip" onClick={excel}>Excel</button>
        <button className="chip primary" onClick={() => pdf()}>Register PDF</button>
      </div>

      <table className="bom-table vo-account">
        <tbody>
          <tr><td>Original contract sum{t.contract ? ` — BOQ Rev ${t.contract.id}` : ''}</td><td className="num">{t.contract ? money(t.contractSum) : '—'}</td></tr>
          <tr><td>Approved variations{t.approved.length ? ` (${t.approved.map((v) => v.id).join(', ')})` : ''}</td><td className="num">{signed(t.approvedSum) || '0.00'}</td></tr>
          <tr><td><b>Revised contract sum</b></td><td className="num"><b>{money(t.revised)}</b></td></tr>
          <tr><td>Submitted, awaiting decision{t.pending.length ? ` (${t.pending.map((v) => v.id).join(', ')})` : ''}</td><td className="num">{signed(t.pendingSum) || '0.00'}</td></tr>
          <tr><td><b>Anticipated final contract sum</b> <span className="m">(excluding VAT)</span></td><td className="num"><b>{cur} {money(t.anticipated)}</b></td></tr>
        </tbody>
      </table>
      {!t.contract && <p className="m">Mark the BOQ revision that is the contract to state the original contract sum.</p>}

      {!vos.length ? <p className="m" style={{ marginTop: 10 }}>No variations yet. Record each addition or omission to the contract scope as a variation (VO-001…), with the instruction that asked for it; approved ones are added to the contract sum.</p> : (
        <table className="bom-table" style={{ marginTop: 10 }}>
          <thead><tr><th>VO</th><th>Title</th><th>Instructed by</th><th>Reference</th><th>Status</th><th>Value (submitted)</th><th>Value (approved)</th><th /></tr></thead>
          <tbody>{vos.map((v) => (
            <tr key={v.id}>
              <td><b>{v.id}</b></td>
              <td>{v.title}{v.foldedInto !== undefined && <span className="bom-tag">in BOQ Rev {v.foldedInto}</span>}</td>
              <td>{v.instructedBy ?? ''}</td>
              <td className="m">{v.reference ?? ''}</td>
              <td>{VO_STATUS[v.status]}{v.decided ? <span className="m"> · {v.decided}</span> : v.submitted ? <span className="m"> · {v.submitted}</span> : null}</td>
              <td className="num">{signed(netOf(v)) || '0.00'}</td>
              <td className="num">{v.status === 'approved' ? signed(valueOf(v)) || '0.00' : v.status === 'rejected' || v.status === 'withdrawn' ? <i>Nil</i> : '—'}</td>
              <td className="acts">
                <button className="icon-btn" title="Edit" onClick={() => setEditing(v)}>✎</button>
                <button className="icon-btn" title="Variation sheet as PDF" onClick={() => pdf([v.id])}>⎙</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

function VoEditor({ vo, project, bom, cur, isNew, onSave, onDelete, onClose }: { vo: Variation; project: Project; bom: PricedBom; cur: string; isNew: boolean; onSave: (v: Variation) => void; onDelete: () => void; onClose: () => void }) {
  const [v, setV] = useState<Variation>(vo);
  const [pick, setPick] = useState('');
  const set = (patch: Partial<Variation>) => setV({ ...v, ...patch });
  const setLine = (id: string, patch: Partial<VoLine>) => set({ lines: v.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const lineId = () => String(Math.max(0, ...v.lines.map((l) => Number(l.id) || 0)) + 1);
  const newCount = v.lines.filter((l) => !l.key).length;
  const addBoqItem = (key: string) => {
    const it = bom.items.find((x) => x.key === key);
    if (!it) return;
    set({ lines: [...v.lines, { id: lineId(), key, no: it.no ?? '', description: it.description, unit: it.unit, add: 1, rate: contractRate(project, bom, key), basis: 'Contract rate' }] });
    setPick('');
  };
  const addNew = () => set({ lines: [...v.lines, { id: lineId(), no: `${v.id}/${newCount + 1}`, description: '', unit: 'no', add: 1, rate: 0, basis: 'New rate', section: VO_SECTION.id }] });
  const changeStatus = (s: VoStatus) => set({
    status: s,
    submitted: s === 'submitted' && !v.submitted ? today() : v.submitted,
    decided: (s === 'approved' || s === 'rejected' || s === 'withdrawn') ? v.decided ?? today() : s === 'draft' || s === 'submitted' ? undefined : v.decided
  });
  const sections = bom.sections.map((s) => ({ id: s.section, title: s.title }));
  const ok = !!v.title.trim() && !!v.raised && v.lines.every((l) => l.description.trim() && Number.isFinite(l.rate));
  return (
    <section className="card">
      <h3>{isNew ? 'New variation' : 'Variation'} {v.id}</h3>
      <div className="form-kv">
        <label>Title <input className="bi-text" autoFocus value={v.title} placeholder="e.g. Additional socket outlets in the majlis" onChange={(e) => set({ title: e.target.value })} /></label>
        <label>Reason <input className="bi-text" value={v.reason ?? ''} placeholder="Why the scope changes" onChange={(e) => set({ reason: e.target.value || undefined })} /></label>
        <label>Instructed by <input className="bi-text" list="vo-by" value={v.instructedBy ?? ''} onChange={(e) => set({ instructedBy: e.target.value || undefined })} /></label>
        <label>Instruction reference <input className="bi-text" value={v.reference ?? ''} placeholder="Site instruction, letter, comment sheet…" onChange={(e) => set({ reference: e.target.value || undefined })} /></label>
        <label>Raised <input className="bi-text" type="date" value={v.raised} onChange={(e) => set({ raised: e.target.value })} /></label>
      </div>
      <datalist id="vo-by">{INSTRUCTED_BY.map((x) => <option key={x} value={x} />)}</datalist>

      <table className="bom-table">
        <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Add (+)</th><th>Omit (−)</th><th>Rate ({cur})</th><th>Amount</th><th>Basis / bill</th><th /></tr></thead>
        <tbody>
          {v.lines.map((l) => (
            <tr key={l.id}>
              <td className="m">{l.no}</td>
              <td>{l.key ? l.description : <input className="bi-text" style={{ width: '100%' }} value={l.description} placeholder="New item description" onChange={(e) => setLine(l.id, { description: e.target.value })} />}</td>
              <td>{l.key ? l.unit : <input className="bi-text" style={{ width: 50 }} value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} />}</td>
              <td><input className="bom-rate" inputMode="decimal" defaultValue={l.add ?? ''} onBlur={(e) => setLine(l.id, { add: num(e.target.value) })} /></td>
              <td><input className="bom-rate" inputMode="decimal" defaultValue={l.omit ?? ''} onBlur={(e) => setLine(l.id, { omit: num(e.target.value) })} /></td>
              <td><input className="bom-rate" inputMode="decimal" defaultValue={l.rate} onBlur={(e) => setLine(l.id, { rate: num(e.target.value) ?? 0 })} /></td>
              <td className="num">{signed(lineAmount(l)) || '0.00'}</td>
              <td>{l.key ? <span className="m">{l.basis ?? 'Contract rate'}</span> : (
                <>
                  <input className="bi-text" style={{ width: 120 }} value={l.basis ?? ''} placeholder="New rate (source)" onChange={(e) => setLine(l.id, { basis: e.target.value || undefined })} />
                  <select className="chip" value={l.section ?? VO_SECTION.id} title="Bill it goes into when brought into the BOQ" onChange={(e) => setLine(l.id, { section: e.target.value })}>
                    <option value={VO_SECTION.id}>{VO_SECTION.id} — {VO_SECTION.title}</option>
                    {sections.filter((s) => s.id !== VO_SECTION.id).map((s) => <option key={s.id} value={s.id}>{s.id} — {s.title}</option>)}
                  </select>
                </>
              )}</td>
              <td className="acts"><button className="icon-btn" title="Remove line" onClick={() => set({ lines: v.lines.filter((x) => x.id !== l.id) })}>✕</button></td>
            </tr>
          ))}
          <tr><td /><td colSpan={5}><b>Net value</b> <span className="m">(excluding VAT)</span></td><td className="num"><b>{signed(netOf(v)) || '0.00'}</b></td><td colSpan={2} /></tr>
        </tbody>
      </table>
      <div className="row" style={{ gap: 8, margin: '8px 0 12px' }}>
        <select className="chip" value={pick} onChange={(e) => addBoqItem(e.target.value)}>
          <option value="">+ BOQ item (add to or omit from)…</option>
          {bom.sections.map((s) => <optgroup key={s.section} label={`${s.section} — ${s.title}`}>{s.items.map((it) => <option key={it.key} value={it.key}>{it.no} — {it.description}</option>)}</optgroup>)}
        </select>
        <button className="chip" onClick={addNew}>+ New item</button>
      </div>

      <div className="form-kv">
        <label>Status
          <select className="chip" value={v.status} onChange={(e) => changeStatus(e.target.value as VoStatus)}>
            {[v.status, ...NEXT_STATUS[v.status]].map((s) => <option key={s} value={s}>{VO_STATUS[s]}</option>)}
          </select>
        </label>
        {v.status !== 'draft' && <label>Submitted <input className="bi-text" type="date" value={v.submitted ?? ''} onChange={(e) => set({ submitted: e.target.value || undefined })} /></label>}
        {(v.status === 'approved' || v.status === 'rejected' || v.status === 'withdrawn') && <>
          <label>Decided <input className="bi-text" type="date" value={v.decided ?? ''} onChange={(e) => set({ decided: e.target.value || undefined })} /></label>
          <label>Decision reference <input className="bi-text" value={v.decisionRef ?? ''} placeholder="Letter or comment that decided it" onChange={(e) => set({ decisionRef: e.target.value || undefined })} /></label>
        </>}
        {v.status === 'approved' && <label>Approved value ({cur}) <input className="bi-text" inputMode="decimal" defaultValue={v.approvedValue ?? ''} placeholder={`${money(netOf(v))} (as submitted)`}
          onBlur={(e) => { const t = e.target.value.trim().replace(/,/g, '').replace('−', '-'); const n = Number(t); set({ approvedValue: t && Number.isFinite(n) ? n : undefined }); }} /></label>}
      </div>
      <p className="m">BOQ items use their contract rate; new items are numbered {v.id}/1, /2 … with an agreed rate. Approved variations are added to the contract sum; the contract BOQ itself changes only when you bring them in.</p>
      <div className="modal-actions">
        {!isNew && v.status === 'draft' && <button className="chip" onClick={() => { if (window.confirm(`Delete ${v.id}?`)) onDelete(); }}>Delete</button>}
        <span className="sp" />
        <button className="chip" onClick={onClose}>Cancel</button>
        <button className="chip primary" disabled={!ok} onClick={() => onSave({ ...v, title: v.title.trim() })}>Save</button>
      </div>
    </section>
  );
}
