import { useMemo, useState } from 'react';
import type { Project, ProjectInfo, ProjectParams } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { filterSheets, issueSheets, moveSheet, nextRev, registerHtml, renumber, setOf, SHEET_STATUSES, sheetNumber, sheetRev, SIZES, statusColor, transmittalHtml, type DrawingIssue, type DrawingSet, type IssueInput, type DrawingSheet, type SheetFilter, type SheetSize, type SheetSort } from '../../model/drawingSet';
import { buildRegisterWorkbook, buildTransmittalWorkbook } from '../../docs/registerWorkbook';
import SheetGrid from './SheetGrid';
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
  const [mode, setMode] = useState<'table' | 'grid'>(() => { try { return localStorage.getItem('lvds.drMode') === 'grid' ? 'grid' : 'table'; } catch { return 'table'; } });
  const [filter, setFilter] = useState<SheetFilter>({});
  const [sort, setSort] = useState<SheetSort>({ key: 'order' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ key: Col; value: string }>({ key: 'status', value: '' });
  const [issuing, setIssuing] = useState(false);
  const company = d.company ?? info.consultant ?? '';
  const visible = useMemo(() => filterSheets(set, filter, sort, rev?.id), [set, filter, sort, rev?.id]);
  const filtered = !!(filter.q || filter.status || filter.rev || filter.type);
  const revs = [...new Set(set.sheets.map((s) => sheetRev(s, rev?.id)).filter(Boolean))].sort();
  const statuses = [...new Set([...SHEET_STATUSES, ...set.sheets.map((s) => s.status || set.status || '').filter(Boolean)])];
  const chosen = set.sheets.filter((s) => selected.has(s.id));
  const targets = chosen.length ? chosen : visible; // what bulk actions apply to
  const toggle = (id: string) => setSelected((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = visible.length > 0 && visible.every((s) => selected.has(s.id));
  const setModeKeep = (m: 'table' | 'grid') => { setMode(m); try { localStorage.setItem('lvds.drMode', m); } catch { /* ignore */ } };
  const sortBy = (key: SheetSort['key']) => setSort((x) => (x.key === key ? (x.desc ? { key: 'order' } : { key, desc: true }) : { key }));
  const arrow = (key: SheetSort['key']) => (sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : '');

  const save = (next: DrawingSet) => onChange({ ...project, drawingSet: next });
  const setSheet = (id: string, patch: Partial<DrawingSheet>) => save({ ...set, sheets: set.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const setInfo = (k: keyof ProjectInfo, v: string) => onChange({ ...project, info: { ...info, [k]: v || undefined } });
  const setParam = (k: keyof ProjectParams, v: string) => onChange({ ...project, params: { ...pp, [k]: v || undefined } });
  const setPerson = (k: 'drawnBy' | 'checkedBy' | 'approvedBy', v: string) =>
    onChange({ ...project, drawing: { ...d, [k]: v || undefined }, params: { ...pp, [k]: undefined } });
  const setNumbering = (patch: Partial<DrawingSet>) => save(renumber({ ...set, ...patch }, !(patch.manualNumbers ?? set.manualNumbers)));
  const setOn = (k: Col, v: string) => {
    const ids = new Set(targets.map((s) => s.id));
    save({ ...set, sheets: set.sheets.map((s) => (ids.has(s.id) ? { ...s, [k]: v || undefined } : s)) });
    onStatus(`Set on ${ids.size === set.sheets.length ? 'all ' : ''}${ids.size} sheet${ids.size === 1 ? '' : 's'}`);
  };
  const applyAll = (k: Col) => setOn(k, fill[k] ?? '');
  const bumpRev = () => {
    const ids = new Set(targets.map((s) => s.id));
    save({ ...set, sheets: set.sheets.map((s) => (ids.has(s.id) ? { ...s, rev: nextRev(sheetRev(s, rev?.id)) } : s)) });
    onStatus(`Next revision on ${ids.size} sheet(s) — use Issue to record it with a date and transmittal`);
  };

  const txt = (value: string | undefined, onSet: (v: string) => void, placeholder = '', w?: number) => (
    <input className="bi-text" style={w ? { width: w } : undefined} defaultValue={value ?? ''} key={value ?? ''} placeholder={placeholder} onBlur={(e) => e.target.value !== (value ?? '') && onSet(e.target.value.trim())} />
  );

  async function exportRegister() {
    const m = await savePdf(`${safeFileName(project.name)} - drawing register.pdf`, registerHtml(project, registerRows(set, [], rev?.id), rev?.id ?? '—', rev?.date ?? new Date().toISOString().slice(0, 10), set.issues, company), { pageSize: 'A4' });
    if (m) onStatus(m);
  }
  async function exportExcel() {
    const m = await saveBinary(`${safeFileName(project.name)} - drawing register.xlsx`, await workbookBytes(buildRegisterWorkbook(project, set)), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  }
  async function exportSet(only?: string[]) {
    setBusy('set');
    try { await exportDrawingSet(project, set, run, false, onStatus, only, true); } finally { setBusy(''); }
  }
  async function transmittalPdf(x: DrawingIssue) {
    const m = await savePdf(`${safeFileName(`${project.name} - transmittal ${x.id}`)}.pdf`, transmittalHtml(project, x, company), { pageSize: 'A4' });
    if (m) onStatus(m);
  }
  async function transmittalExcel(x: DrawingIssue) {
    const m = await saveBinary(`${safeFileName(`${project.name} - transmittal ${x.id}`)}.xlsx`, await workbookBytes(buildTransmittalWorkbook(project, x)), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  }
  async function preview1(s: DrawingSheet) {
    setBusy(s.id);
    try { const r = await sheetHtml(project, set, s, run); if (r) setPreview({ no: s.number, html: r.html, size: r.size }); } finally { setBusy(''); }
  }

  const colHead = (k: Col, label: string, input: React.ReactNode, sortKey?: SheetSort['key']) => (
    <th>
      {sortKey ? <span className="sortable" onClick={() => sortBy(sortKey)}>{label}{arrow(sortKey)}</span> : label}
      <div className="dr-fill">{input}<button className="icon-btn" title={`Set “${fill[k] || '(blank = default)'}” on ${chosen.length ? 'the selected sheets' : 'every sheet shown'}`} onClick={() => applyAll(k)}>⇩</button></div>
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
        <button className="chip primary" onClick={() => exportSet()} disabled={!!busy || !set.sheets.length}>{busy === 'set' ? 'Building…' : 'Export set (one PDF)'}</button>
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

      <div className="dr-tools">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={mode === 'table'} className={mode === 'table' ? 'on' : ''} onClick={() => setModeKeep('table')}>Table</button>
          <button role="tab" aria-selected={mode === 'grid'} className={mode === 'grid' ? 'on' : ''} onClick={() => setModeKeep('grid')}>Sheets</button>
        </div>
        <input className="bi-text dr-search" type="search" placeholder="Search number, title, panel…" value={filter.q ?? ''} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select className="chip" value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}><option value="">All statuses</option>{statuses.map((x) => <option key={x}>{x}</option>)}</select>
        <select className="chip" value={filter.rev ?? ''} onChange={(e) => setFilter({ ...filter, rev: e.target.value || undefined })}><option value="">All revisions</option>{revs.map((x) => <option key={x} value={x}>Rev {x}</option>)}</select>
        <select className="chip" value={filter.type ?? ''} onChange={(e) => setFilter({ ...filter, type: (e.target.value || undefined) as SheetFilter['type'] })}><option value="">All sheet types</option><option value="sld">SLD sheets</option><option value="db">DB circuit diagrams</option></select>
        {(filtered || sort.key !== 'order') && <button className="linkish" onClick={() => { setFilter({}); setSort({ key: 'order' }); }}>Clear filters</button>}
        <span className="sp" />
        <span className="m">{visible.length} of {set.sheets.length} sheets</span>
      </div>

      {set.sheets.length > 0 && (
        <div className={`dr-bulk${chosen.length ? ' on' : ''}`}>
          <b>{chosen.length ? `${chosen.length} selected` : filtered ? `All ${visible.length} shown` : 'All sheets'}</b>
          <select className="chip" value={bulk.key} onChange={(e) => setBulk({ key: e.target.value as Col, value: '' })}>
            <option value="status">Status</option><option value="rev">Revision</option><option value="date">Date</option><option value="drawnBy">Drawn by</option><option value="checkedBy">Checked by</option><option value="approvedBy">Approved by</option><option value="scale">Scale</option>
          </select>
          {bulk.key === 'status'
            ? <select className="chip" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}><option value="">(project default)</option>{SHEET_STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
            : <input className="bi-text" style={{ width: 130 }} type={bulk.key === 'date' ? 'date' : 'text'} placeholder="blank = default" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} />}
          <button className="chip" onClick={() => setOn(bulk.key, bulk.value.trim())}>Set</button>
          <button className="chip" onClick={bumpRev} title="A→B, 0→1, P1→P2">Next revision</button>
          <button className="chip primary" onClick={() => setIssuing(true)}>Issue…</button>
          <button className="chip" disabled={!!busy} onClick={() => exportSet(targets.map((s) => s.id))}>Export these (PDF)</button>
          {chosen.length > 0 && <button className="linkish" onClick={() => setSelected(new Set())}>Clear selection</button>}
        </div>
      )}

      {mode === 'grid' ? (
        <SheetGrid project={project} set={set} sheets={visible} run={run} selected={selected} canDrag={!filtered && sort.key === 'order'}
          onToggle={toggle} onMove={(a, b) => save(moveSheet(set, a, b))} onPreview={(s, t) => setPreview({ no: s.number, html: t.html, size: t.size })} />
      ) : (
      <div className="tw">
        <table className="ds-table dr-table">
          <thead>
            <tr>
              <th><input type="checkbox" title="Select all shown" checked={allOn} onChange={() => setSelected(allOn ? new Set([...selected].filter((id) => !visible.some((s) => s.id === id))) : new Set([...selected, ...visible.map((s) => s.id)]))} /></th>
              <th className="sortable" onClick={() => sortBy('number')}>No.{arrow('number')}</th><th className="sortable" onClick={() => sortBy('title')}>Title{arrow('title')}</th><th>Size</th>
              {colHead('status', 'Status', fillIn('status', set.status ?? 'all…', SHEET_STATUSES), 'status')}
              {colHead('rev', 'Rev', fillIn('rev', rev?.id ?? 'all…'), 'rev')}
              {colHead('date', 'Date', fillIn('date', rev?.date ?? 'all…'), 'date')}
              {colHead('drawnBy', 'Drawn', fillIn('drawnBy', d.drawnBy || 'all…'))}
              {colHead('checkedBy', 'Checked', fillIn('checkedBy', d.checkedBy || 'all…'))}
              {colHead('approvedBy', 'Approved', fillIn('approvedBy', d.approvedBy || 'all…'))}
              {colHead('scale', 'Scale', fillIn('scale', 'NTS'))}
              <th>Remarks</th><th />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const i = set.sheets.indexOf(s);
              const st = s.status || set.status || '';
              const hist = s.history ?? [];
              return (
              <tr key={s.id} className={selected.has(s.id) ? 'dr-sel' : undefined}>
                <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                <td>{set.manualNumbers ? txt(s.number, (v) => setSheet(s.id, { number: v || sheetNumber(set, i) }), '', 110) : <b>{s.number}</b>}</td>
                <td>{txt(s.title, (v) => v && setSheet(s.id, { title: v }), '', 240)}<div className="m dr-panels">{s.kind === 'board' ? `${s.boards[0]} circuit diagram` : s.boards.join(', ') || 'no panels'}</div></td>
                <td><select className="bi-sel" value={s.size} onChange={(e) => setSheet(s.id, { size: e.target.value as DrawingSheet['size'] })}><option value="auto">Auto</option>{SIZES.map((z) => <option key={z}>{z}</option>)}</select></td>
                <td><span className="dr-dot" style={{ background: statusColor(st) }} /><input className="bi-text" list="dl-status-row" style={{ width: 150 }} defaultValue={s.status ?? ''} key={`st${s.status}`} placeholder={set.status ?? '—'} onBlur={(e) => e.target.value !== (s.status ?? '') && setSheet(s.id, { status: e.target.value || undefined })} /></td>
                <td title={hist.length ? hist.map((h) => `Rev ${h.rev} · ${h.date} · ${h.description}`).join('\n') : 'Not issued yet'}>{txt(s.rev, (v) => setSheet(s.id, { rev: v || undefined }), sheetRev(s, rev?.id) || '—', 44)}{hist.length > 0 && <div className="m dr-hist">{hist.length} issue{hist.length > 1 ? 's' : ''}</div>}</td>
                <td>{txt(s.date, (v) => setSheet(s.id, { date: v || undefined }), rev?.date ?? '', 92)}</td>
                <td>{txt(s.drawnBy, (v) => setSheet(s.id, { drawnBy: v || undefined }), pp.drawnBy ?? d.drawnBy ?? '', 90)}</td>
                <td>{txt(s.checkedBy, (v) => setSheet(s.id, { checkedBy: v || undefined }), pp.checkedBy ?? d.checkedBy ?? '', 90)}</td>
                <td>{txt(s.approvedBy, (v) => setSheet(s.id, { approvedBy: v || undefined }), pp.approvedBy ?? d.approvedBy ?? '', 90)}</td>
                <td>{txt(s.scale, (v) => setSheet(s.id, { scale: v || undefined }), 'NTS', 50)}</td>
                <td>{txt(s.remarks, (v) => setSheet(s.id, { remarks: v || undefined }), '', 140)}</td>
                <td className="acts">
                  <button className="chip" disabled={!s.boards.length || !!busy} onClick={() => preview1(s)}>{busy === s.id ? '…' : 'Preview'}</button>
                </td>
              </tr>
              );
            })}
            {!set.sheets.length && <tr><td colSpan={13} className="m">No sheets yet — make them in <button className="linkish" onClick={() => onOpen('drawings')}>Drawing set</button> (e.g. Split by panels).</td></tr>}
            {set.sheets.length > 0 && !visible.length && <tr><td colSpan={13} className="m">No sheets match the filters.</td></tr>}
          </tbody>
        </table>
        <datalist id="dl-status-row">{SHEET_STATUSES.map((x) => <option key={x} value={x} />)}</datalist>
      </div>
      )}

      {(set.issues ?? []).length > 0 && (
        <section className="card dr-issues">
          <h4>Issues and transmittals</h4>
          <table className="ds-table">
            <thead><tr><th>Issue</th><th>Date</th><th>Purpose</th><th>Description</th><th>To</th><th>Sheets</th><th /></tr></thead>
            <tbody>
              {[...(set.issues ?? [])].reverse().map((x) => (
                <tr key={x.id}>
                  <td><b>{x.id}</b></td><td>{x.date}</td><td><span className="dr-dot" style={{ background: statusColor(x.purpose) }} />{x.purpose}</td><td>{x.description}</td><td>{x.to}</td>
                  <td title={x.sheets.map((s) => `${s.number} Rev ${s.rev}`).join('\n')}>{x.sheets.length}</td>
                  <td className="acts"><button className="chip" onClick={() => transmittalPdf(x)}>Transmittal PDF</button><button className="chip" onClick={() => transmittalExcel(x)}>Excel</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="m">Tick sheets to change only those; ⇩ in a column heading puts the value typed above it on the ticked sheets (or every sheet shown); blank clears back to the project's value. Click No., Title, Status, Rev or Date to sort. Issue… moves the sheets to their next revision, records it in each title block's revision table and makes a transmittal. In a custom title block use {'{SheetNo}'}, {'{SheetTitle}'}, {'{SheetIndex}'} of {'{SheetCount}'}, {'{Status}'}, {'{Rev}'}, {'{RevDate}'}, {'{DrawnBy}'}, {'{CheckedBy}'}, {'{ApprovedBy}'}, {'{Scale}'}.</p>

      {issuing && <IssueDialog sheets={targets} projectRev={rev?.id} onClose={() => setIssuing(false)} onIssue={async (o, pdf) => {
        const r = issueSheets(set, targets.map((s) => s.id), o, rev?.id);
        save(r.set);
        setIssuing(false);
        setSelected(new Set());
        onStatus(`Issued ${r.issue.id}: ${r.issue.sheets.length} sheet(s) — ${o.purpose}`);
        if (pdf) {
          await transmittalPdf(r.issue);
          setBusy('set');
          try { await exportDrawingSet({ ...project, drawingSet: r.set }, r.set, run, false, onStatus, r.issue.sheets.map((s) => s.id), true); } finally { setBusy(''); }
        }
      }} />}

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

/** Issue the chosen sheets: date, purpose (becomes their status), what
 * changed, to whom; optionally move each to its next revision. */
function IssueDialog({ sheets, projectRev, onClose, onIssue }: { sheets: DrawingSheet[]; projectRev?: string; onClose: () => void; onIssue: (o: IssueInput, pdf: boolean) => void }) {
  const [o, setO] = useState<IssueInput>({ date: new Date().toISOString().slice(0, 10), purpose: 'FOR APPROVAL', description: '', to: '', bump: sheets.some((s) => s.history?.length || s.rev) });
  const [pdf, setPdf] = useState(true);
  const after = (s: DrawingSheet) => { const cur = sheetRev(s, projectRev); return o.bump && (s.history?.length || s.rev) ? nextRev(cur) : (cur || 'A'); };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onIssue(o, pdf); }}>
        <h3>Issue {sheets.length} sheet{sheets.length === 1 ? '' : 's'}</h3>
        <div className="grid2">
          <label>Date<input type="date" required value={o.date} onChange={(e) => setO({ ...o, date: e.target.value })} /></label>
          <label>Purpose of issue<select value={o.purpose} onChange={(e) => setO({ ...o, purpose: e.target.value })}>{SHEET_STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label style={{ gridColumn: '1 / -1' }}>What changed (revision table and transmittal)<input value={o.description} placeholder="e.g. Updated MDB feeder sizes per DEWA comments" onChange={(e) => setO({ ...o, description: e.target.value })} /></label>
          <label>To<input value={o.to ?? ''} placeholder="e.g. DEWA, client, contractor" onChange={(e) => setO({ ...o, to: e.target.value })} /></label>
          <label className="row"><input type="checkbox" checked={o.bump} onChange={(e) => setO({ ...o, bump: e.target.checked })} /> Move to the next revision</label>
        </div>
        <div className="tw dr-issue-list">
          <table className="ds-table"><thead><tr><th>Drawing no.</th><th>Title</th><th>Rev now</th><th>Issued as</th></tr></thead>
            <tbody>{sheets.map((s) => <tr key={s.id}><td>{s.number}</td><td>{s.title}</td><td>{sheetRev(s, projectRev) || '—'}</td><td><b>{after(s)}</b></td></tr>)}</tbody>
          </table>
        </div>
        <label className="row"><input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} /> Save the transmittal and the issued sheets as PDF now</label>
        <div className="modal-actions"><span className="sp" /><button type="button" className="chip" onClick={onClose}>Cancel</button><button type="submit" className="chip primary" disabled={!sheets.length}>Issue</button></div>
      </form>
    </div>
  );
}
