import { useState } from 'react';
import ExcelJS from 'exceljs';
import type { Project, ProjectInfo, ProjectParams } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { registerHtml, renumber, setOf, SHEET_STATUSES, sheetNumber, SIZES, type DrawingSet, type DrawingSheet, type SheetSize } from '../../model/drawingSet';
import { currentRevision } from '../../model/revisions';
import { loadTemplateLibrary } from '../../model/titleBlock';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { exportDrawingSet, registerRows, sheetHtml, SheetPreview } from './sheetRender';
import { Page } from '../ui';
import type { MainView } from '../../views';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Col = 'status' | 'rev' | 'date' | 'drawnBy' | 'checkedBy' | 'approvedBy' | 'scale';

/** Reports → Drawing register: every sheet's number, title, status,
 * revision, date and people, and the title block values shared by all
 * sheets, managed in one table — no need to open each sheet. */
export default function DrawingRegisterView({ project, run, onChange, onStatus, onOpen }: { project: Project; run?: CalcRun; onChange: (p: Project) => void; onStatus: (m: string) => void; onOpen: (v: MainView) => void }) {
  const set = setOf(project);
  const d = project.drawing ?? {};
  const info = project.info ?? {};
  const pp = project.params ?? {};
  const rev = currentRevision(project);
  const [fill, setFill] = useState<Partial<Record<Col, string>>>({});
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<{ no: string; html: string; size: SheetSize } | null>(null);
  const templates = loadTemplateLibrary();

  const save = (next: DrawingSet) => onChange({ ...project, drawingSet: next });
  const setSheet = (id: string, patch: Partial<DrawingSheet>) => save({ ...set, sheets: set.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const setInfo = (k: keyof ProjectInfo, v: string) => onChange({ ...project, info: { ...info, [k]: v || undefined } });
  const setParam = (k: keyof ProjectParams, v: string) => onChange({ ...project, params: { ...pp, [k]: v || undefined } });
  const setPerson = (k: 'drawnBy' | 'checkedBy' | 'approvedBy', v: string) =>
    onChange({ ...project, drawing: { ...d, [k]: v || undefined }, params: { ...pp, [k]: undefined } });
  const setNumbering = (patch: Partial<DrawingSet>) => save(renumber({ ...set, ...patch }, !(patch.manualNumbers ?? set.manualNumbers)));
  const applyAll = (k: Col) => { save({ ...set, sheets: set.sheets.map((s) => ({ ...s, [k]: fill[k] || undefined })) }); onStatus(`Set on all ${set.sheets.length} sheets`); };

  const txt = (value: string | undefined, onSet: (v: string) => void, placeholder = '', w?: number) => (
    <input className="bi-text" style={w ? { width: w } : undefined} defaultValue={value ?? ''} key={value ?? ''} placeholder={placeholder} onBlur={(e) => e.target.value !== (value ?? '') && onSet(e.target.value.trim())} />
  );

  async function exportRegister() {
    const m = await savePdf(`${safeFileName(project.name)} - drawing register.pdf`, registerHtml(project, registerRows(set), rev?.id ?? '—', rev?.date ?? new Date().toISOString().slice(0, 10)), { pageSize: 'A4' });
    if (m) onStatus(m);
  }
  async function exportExcel() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Drawing register');
    ws.addRow([project.name]).font = { bold: true, size: 13 };
    ws.addRow([`${info.owner ?? ''}${info.plotNo ? ` · Plot ${info.plotNo}` : ''}`]);
    ws.addRow([]);
    const h = ws.addRow(['Drawing no.', 'Title', 'Size', 'Rev', 'Date', 'Status', 'Drawn', 'Checked', 'Approved', 'Remarks']);
    h.font = { bold: true };
    for (const s of set.sheets) ws.addRow([s.number, s.title, s.size === 'auto' ? 'Auto' : s.size, s.rev || rev?.id || '', s.date || rev?.date || '', s.status || set.status || '', s.drawnBy || d.drawnBy || '', s.checkedBy || d.checkedBy || '', s.approvedBy || d.approvedBy || '', s.remarks ?? '']);
    ws.columns = [16, 48, 8, 6, 12, 24, 14, 14, 14, 30].map((width) => ({ width }));
    const m = await saveBinary(`${safeFileName(project.name)} - drawing register.xlsx`, await workbookBytes(wb), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  }
  async function exportSet() {
    setBusy('set');
    try { await exportDrawingSet(project, set, run, false, onStatus); } finally { setBusy(''); }
  }

  const colHead = (k: Col, label: string, input: React.ReactNode) => (
    <th>
      {label}
      <div className="dr-fill">{input}<button className="icon-btn" title={`Set “${fill[k] || '(blank = default)'}” on every sheet`} onClick={() => applyAll(k)}>⇩</button></div>
    </th>
  );
  const fillIn = (k: Col, placeholder = 'all…', list?: string[]) => (
    <>
      <input className="bi-text" list={list ? `dl-${k}` : undefined} style={{ width: '100%' }} placeholder={placeholder} value={fill[k] ?? ''} onChange={(e) => setFill({ ...fill, [k]: e.target.value })} />
      {list && <datalist id={`dl-${k}`}>{list.map((x) => <option key={x} value={x} />)}</datalist>}
    </>
  );

  return (
    <Page
      title="Drawing register"
      intro="Numbers, titles, status and title block details of every sheet in one place. Blank cells use the project's value (shown in grey). Which panels go on each sheet is set in Drawing set."
      actions={<>
        <button className="chip" onClick={() => onOpen('drawings')}>Panels on sheets…</button>
        <button className="chip" onClick={exportExcel} disabled={!set.sheets.length}>Register (Excel)</button>
        <button className="chip" onClick={exportRegister} disabled={!set.sheets.length}>Register (PDF)</button>
        <button className="chip primary" onClick={exportSet} disabled={!!busy || !set.sheets.length}>{busy ? 'Building…' : 'Export set (one PDF)'}</button>
      </>}
    >
      <div className="dr-top">
        <section className="card">
          <h4>Title block — same on every sheet</h4>
          <div className="form-kv">
            <label>Company / consultant{txt(d.company, (v) => onChange({ ...project, drawing: { ...d, company: v || undefined } }), info.consultant)}</label>
            <label>Project{txt(project.name, (v) => v && onChange({ ...project, name: v }))}</label>
            <label>Owner / client{txt(info.owner, (v) => setInfo('owner', v))}</label>
            <label>Consultant{txt(info.consultant, (v) => setInfo('consultant', v))}</label>
            <label>Contractor{txt(info.contractor, (v) => setInfo('contractor', v))}</label>
            <label>Plot no.{txt(info.plotNo, (v) => setInfo('plotNo', v))}</label>
            <label>Area / location{txt(info.area, (v) => setInfo('area', v))}</label>
            <label>Discipline{txt(pp.discipline, (v) => setParam('discipline', v), 'ELECTRICAL')}</label>
            <label>Designed by{txt(pp.designedBy, (v) => setParam('designedBy', v))}</label>
            <label>Drawn by{txt(pp.drawnBy ?? d.drawnBy, (v) => setPerson('drawnBy', v))}</label>
            <label>Checked by{txt(pp.checkedBy ?? d.checkedBy, (v) => setPerson('checkedBy', v))}</label>
            <label>Approved by{txt(pp.approvedBy ?? d.approvedBy, (v) => setPerson('approvedBy', v))}</label>
            <label>Submission date{txt(pp.submissionDate, (v) => setParam('submissionDate', v), 'e.g. 15 Oct 2026')}</label>
            <label>Authority ref.{txt(pp.authorityRef, (v) => setParam('authorityRef', v), 'DEWA / DM reference')}</label>
          </div>
          <div className="dr-line">
            <span>Revision: <b>{rev ? `${rev.id} — ${rev.date}` : 'not issued'}</b> <button className="linkish" onClick={() => onOpen('revisions')}>Revisions…</button></span>
            <label className="row">Title block
              <select className="chip" value={d.titleTemplateId ?? ''} onChange={(e) => onChange({ ...project, drawing: { ...d, titleTemplateId: e.target.value || undefined } })}>
                <option value="">Standard</option>
                {[...(project.titleTemplates ?? []), ...templates.filter((t) => !(project.titleTemplates ?? []).some((x) => x.id === t.id))].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="linkish" onClick={() => onOpen('titleblock')}>Design…</button>
            </label>
          </div>
        </section>

        <section className="card">
          <h4>Numbering</h4>
          <div className="form-kv">
            <label>Prefix{txt(set.prefix, (v) => setNumbering({ prefix: v || 'E-SLD-' }), 'E-SLD-')}</label>
            <label>First number<input className="bi-text" inputMode="numeric" defaultValue={set.start ?? 1} key={`s${set.start}`} onBlur={(e) => { const n = Math.max(0, Math.round(Number(e.target.value))); if (Number.isFinite(n) && n !== (set.start ?? 1)) setNumbering({ start: n }); }} /></label>
            <label>Digits<select value={set.digits ?? 3} onChange={(e) => setNumbering({ digits: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} ({'0'.repeat(n - 1)}1)</option>)}</select></label>
            <label>Suffix{txt(set.suffix, (v) => setNumbering({ suffix: v || undefined }), 'e.g. -EL')}</label>
          </div>
          <p className="m">Example: <b>{sheetNumber(set, 0)}</b>, {sheetNumber(set, 1)} …</p>
          <label className="row"><input type="checkbox" checked={!!set.manualNumbers} onChange={(e) => save({ ...set, manualNumbers: e.target.checked || undefined })} /> Type numbers by hand (keep them when sheets move)</label>
          <div className="dr-line">
            <button className="chip" onClick={() => { save(renumber(set, true)); onStatus('Sheets renumbered in order'); }} disabled={!set.sheets.length}>Renumber all in order</button>
            <label className="row">Default status
              <select className="chip" value={set.status ?? ''} onChange={(e) => save({ ...set, status: e.target.value || undefined })}>
                <option value="">—</option>{SHEET_STATUSES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="row"><input type="checkbox" checked={!!set.register} onChange={(e) => save({ ...set, register: e.target.checked })} /> Register as the first page of the set</label>
          </div>
        </section>
      </div>

      <div className="tw">
        <table className="ds-table dr-table">
          <thead>
            <tr>
              <th>No.</th><th>Title</th><th>Size</th>
              {colHead('status', 'Status', fillIn('status', set.status ?? 'all…', SHEET_STATUSES))}
              {colHead('rev', 'Rev', fillIn('rev', rev?.id ?? 'all…'))}
              {colHead('date', 'Date', fillIn('date', rev?.date ?? 'all…'))}
              {colHead('drawnBy', 'Drawn', fillIn('drawnBy', d.drawnBy || 'all…'))}
              {colHead('checkedBy', 'Checked', fillIn('checkedBy', d.checkedBy || 'all…'))}
              {colHead('approvedBy', 'Approved', fillIn('approvedBy', d.approvedBy || 'all…'))}
              {colHead('scale', 'Scale', fillIn('scale', 'NTS'))}
              <th>Remarks</th><th />
            </tr>
          </thead>
          <tbody>
            {set.sheets.map((s, i) => (
              <tr key={s.id}>
                <td>{set.manualNumbers ? txt(s.number, (v) => setSheet(s.id, { number: v || sheetNumber(set, i) }), '', 110) : <b>{s.number}</b>}</td>
                <td>{txt(s.title, (v) => v && setSheet(s.id, { title: v }), '', 240)}<div className="m dr-panels">{s.kind === 'board' ? `${s.boards[0]} circuit diagram` : s.boards.join(', ') || 'no panels'}</div></td>
                <td><select className="bi-sel" value={s.size} onChange={(e) => setSheet(s.id, { size: e.target.value as DrawingSheet['size'] })}><option value="auto">Auto</option>{SIZES.map((z) => <option key={z}>{z}</option>)}</select></td>
                <td><input className="bi-text" list="dl-status-row" style={{ width: 150 }} defaultValue={s.status ?? ''} key={`st${s.status}`} placeholder={set.status ?? '—'} onBlur={(e) => e.target.value !== (s.status ?? '') && setSheet(s.id, { status: e.target.value || undefined })} /></td>
                <td>{txt(s.rev, (v) => setSheet(s.id, { rev: v || undefined }), rev?.id ?? '—', 44)}</td>
                <td>{txt(s.date, (v) => setSheet(s.id, { date: v || undefined }), rev?.date ?? '', 92)}</td>
                <td>{txt(s.drawnBy, (v) => setSheet(s.id, { drawnBy: v || undefined }), pp.drawnBy ?? d.drawnBy ?? '', 90)}</td>
                <td>{txt(s.checkedBy, (v) => setSheet(s.id, { checkedBy: v || undefined }), pp.checkedBy ?? d.checkedBy ?? '', 90)}</td>
                <td>{txt(s.approvedBy, (v) => setSheet(s.id, { approvedBy: v || undefined }), pp.approvedBy ?? d.approvedBy ?? '', 90)}</td>
                <td>{txt(s.scale, (v) => setSheet(s.id, { scale: v || undefined }), 'NTS', 50)}</td>
                <td>{txt(s.remarks, (v) => setSheet(s.id, { remarks: v || undefined }), '', 140)}</td>
                <td className="acts">
                  <button className="chip" disabled={!s.boards.length || !!busy} onClick={async () => { setBusy(s.id); try { const r = await sheetHtml(project, set, s, run); if (r) setPreview({ no: s.number, html: r.html, size: r.size }); } finally { setBusy(''); } }}>{busy === s.id ? '…' : 'Preview'}</button>
                </td>
              </tr>
            ))}
            {!set.sheets.length && <tr><td colSpan={12} className="m">No sheets yet — make them in <button className="linkish" onClick={() => onOpen('drawings')}>Drawing set</button> (e.g. Split by panels).</td></tr>}
          </tbody>
        </table>
        <datalist id="dl-status-row">{SHEET_STATUSES.map((x) => <option key={x} value={x} />)}</datalist>
      </div>
      <p className="m">⇩ in a column heading puts the value typed above it on every sheet (blank clears them back to the project's value). In a custom title block use {'{SheetNo}'}, {'{SheetTitle}'}, {'{SheetIndex}'} of {'{SheetCount}'}, {'{Status}'}, {'{Rev}'}, {'{RevDate}'}, {'{DrawnBy}'}, {'{CheckedBy}'}, {'{ApprovedBy}'}, {'{Scale}'}.</p>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal ds-preview" onClick={(e) => e.stopPropagation()}>
            <h3>{preview.no} — {preview.size}</h3>
            <SheetPreview html={preview.html} size={preview.size} />
            <div className="modal-actions"><span className="sp" /><button className="chip" onClick={() => setPreview(null)}>Close</button></div>
          </div>
        </div>
      )}
    </Page>
  );
}
