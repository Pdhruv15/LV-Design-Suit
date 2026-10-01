import { useMemo, useState } from 'react';
import type { Project, ProjectInfo, ProjectParams } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { LAYER_LABELS, SHEET_LAYERS } from '../../diagram/annotations';
import { boardsInSupplyOrder } from '../../calc/summary';
import {
  autoSheets, filterSheets, sheetHash, issueSheets, moveSheet, nextRev, registerHtml, renumber, setOf, SHEET_STATUSES, sheetNumber, sheetRev, sheetsByCount, SIZES, statusColor, transmittalHtml,
  type DrawingIssue, type DrawingSet, type DrawingSheet, type IssueInput, type SheetFilter, type SheetSize, type SheetSort
} from '../../model/drawingSet';
import { currentRevision } from '../../model/revisions';
import { loadTemplateLibrary } from '../../model/titleBlock';
import { workbookBytes } from '../../docs/formWorkbook';
import { buildRegisterWorkbook, buildTransmittalWorkbook } from '../../docs/registerWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { exportDrawingSet, registerRows, sheetHtml, SheetPreview } from './sheetRender';
import SheetGrid from './SheetGrid';
import { Page } from '../ui';
import type { MainView } from '../../views';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Col = 'status' | 'rev' | 'date' | 'drawnBy' | 'checkedBy' | 'approvedBy' | 'scale';
export type DrawingsTab = 'sheets' | 'layout' | 'titleblock' | 'issues';
const TABS: [DrawingsTab, string][] = [['sheets', 'Sheets'], ['layout', 'Layout'], ['titleblock', 'Title block & numbering'], ['issues', 'Issues & transmittals']];

/** Reports → Drawings: the SLD sheets in one place. Sheets (the list, with
 * filters, bulk changes, thumbnails and a side panel per sheet), Layout (how
 * sheets are made and what they show), Title block & numbering, and Issues
 * (revisions and transmittals). Export is the same on every tab. */
export default function DrawingsView({ project, run, initialTab = 'sheets', onChange, onStatus, onOpen }: {
  project: Project; run?: CalcRun; initialTab?: DrawingsTab; onChange: (p: Project) => void; onStatus: (m: string) => void; onOpen: (v: MainView) => void;
}) {
  const set = setOf(project);
  const d = project.drawing ?? {};
  const info = project.info ?? {};
  const pp = project.params ?? {};
  const rev = currentRevision(project);
  const company = d.company ?? info.consultant ?? '';
  const [tab, setTab] = useState<DrawingsTab>(initialTab);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<{ no: string; html: string; size: SheetSize; fits?: boolean } | null>(null);
  const [mode, setMode] = useState<'table' | 'grid'>(() => { try { return localStorage.getItem('lvds.drMode') === 'grid' ? 'grid' : 'table'; } catch { return 'table'; } });
  const [filter, setFilter] = useState<SheetFilter>({});
  const [sort, setSort] = useState<SheetSort>({ key: 'order' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ key: Col; value: string }>({ key: 'status', value: '' });
  const [issuing, setIssuing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dbSheets, setDbSheets] = useState(false);
  const [perSheet, setPerSheet] = useState(10);
  const boards = boardsInSupplyOrder(project);
  const dbs = boards.filter((b) => (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')) === 'DB');
  const dewa = d.sldStyle !== 'standard';

  const save = (next: DrawingSet) => onChange({ ...project, drawingSet: next });
  const setSheet = (id: string, patch: Partial<DrawingSheet>) => save({ ...set, sheets: set.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const setInfo = (k: keyof ProjectInfo, v: string) => onChange({ ...project, info: { ...info, [k]: v || undefined } });
  const setParam = (k: keyof ProjectParams, v: string) => onChange({ ...project, params: { ...pp, [k]: v || undefined } });
  const setPerson = (k: 'drawnBy' | 'checkedBy' | 'approvedBy', v: string) => onChange({ ...project, drawing: { ...d, [k]: v || undefined }, params: { ...pp, [k]: undefined } });
  const setNumbering = (patch: Partial<DrawingSet>) => save(renumber({ ...set, ...patch }, !(patch.manualNumbers ?? set.manualNumbers)));

  const visible = useMemo(() => filterSheets(set, filter, sort, rev?.id), [set, filter, sort, rev?.id]);
  const filtered = !!(filter.q || filter.status || filter.rev || filter.type);
  const revs = [...new Set(set.sheets.map((s) => sheetRev(s, rev?.id)).filter(Boolean))].sort();
  const statuses = [...new Set([...SHEET_STATUSES, ...set.sheets.map((s) => s.status || set.status || '').filter(Boolean)])];
  const chosen = set.sheets.filter((s) => selected.has(s.id));
  const targets = chosen.length ? chosen : visible;
  const toggle = (id: string) => setSelected((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = visible.length > 0 && visible.every((s) => selected.has(s.id));
  const setModeKeep = (m: 'table' | 'grid') => { setMode(m); try { localStorage.setItem('lvds.drMode', m); } catch { /* ignore */ } };
  const sortBy = (key: SheetSort['key']) => setSort((x) => (x.key === key ? (x.desc ? { key: 'order' } : { key, desc: true }) : { key }));
  const arrow = (key: SheetSort['key']) => (sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : '');
  const canMove = !filtered && sort.key === 'order';

  const setOn = (k: Col, v: string) => {
    const ids = new Set(targets.map((s) => s.id));
    save({ ...set, sheets: set.sheets.map((s) => (ids.has(s.id) ? { ...s, [k]: v || undefined } : s)) });
    onStatus(`Set on ${ids.size} sheet${ids.size === 1 ? '' : 's'}`);
  };
  const bumpRev = () => {
    const ids = new Set(targets.map((s) => s.id));
    save({ ...set, sheets: set.sheets.map((s) => (ids.has(s.id) ? { ...s, rev: nextRev(sheetRev(s, rev?.id)) } : s)) });
    onStatus(`Next revision on ${ids.size} sheet(s) — use Issue to record it with a date and transmittal`);
  };
  const replaceSet = (next: DrawingSet) => {
    if (set.sheets.length && !window.confirm('Replace the sheets with a new automatic set? (Status, revisions and issues of the old sheets are dropped.)')) return;
    save({ ...next, register: set.register, tags: set.tags, status: set.status, start: set.start, digits: set.digits, suffix: set.suffix, issues: set.issues });
    setTab('sheets');
  };
  const add = (kind: DrawingSheet['kind'], boardId?: string) => {
    const id = `sh-${Date.now().toString(36)}`;
    save(renumber({ ...set, sheets: [...set.sheets, { id, number: '', title: kind === 'board' ? `${boardId} — circuit diagram` : `SLD — sheet ${set.sheets.length + 1}`, kind, boards: boardId ? [boardId] : [], size: 'auto' }] }));
    if (kind === 'system') setEditing(id);
  };
  const remove = (id: string) => { save(renumber({ ...set, sheets: set.sheets.filter((x) => x.id !== id) })); setEditing(null); };

  const txt = (value: string | undefined, onSet: (v: string) => void, placeholder = '', w?: number) => (
    <input className="bi-text" style={w ? { width: w } : undefined} defaultValue={value ?? ''} key={value ?? ''} placeholder={placeholder} onBlur={(e) => e.target.value !== (value ?? '') && onSet(e.target.value.trim())} />
  );

  async function run1(key: string, f: () => Promise<void>) { setBusy(key); setExportOpen(false); try { await f(); } finally { setBusy(''); } }
  const exportSet = (each: boolean, only?: string[]) => run1('set', () => exportDrawingSet(project, set, run, each, onStatus, only, true));
  const exportRegisterPdf = () => run1('reg', async () => { const m = await savePdf(`${safeFileName(project.name)} - drawing register.pdf`, registerHtml(project, registerRows(set, [], rev?.id), rev?.id ?? '—', rev?.date ?? new Date().toISOString().slice(0, 10), set.issues, company), { pageSize: 'A4' }); if (m) onStatus(m); });
  const exportRegisterXlsx = () => run1('reg', async () => { const m = await saveBinary(`${safeFileName(project.name)} - drawing register.xlsx`, await workbookBytes(buildRegisterWorkbook(project, set)), 'Excel', 'xlsx', XLSX); if (m) onStatus(m); });
  async function transmittalPdf(x: DrawingIssue) { const m = await savePdf(`${safeFileName(`${project.name} - transmittal ${x.id}`)}.pdf`, transmittalHtml(project, x, company), { pageSize: 'A4' }); if (m) onStatus(m); }
  async function transmittalExcel(x: DrawingIssue) { const m = await saveBinary(`${safeFileName(`${project.name} - transmittal ${x.id}`)}.xlsx`, await workbookBytes(buildTransmittalWorkbook(project, x)), 'Excel', 'xlsx', XLSX); if (m) onStatus(m); }
  async function preview1(s: DrawingSheet) {
    setBusy(s.id);
    try { const r = await sheetHtml(project, set, s, run); if (r) setPreview({ no: s.number, html: r.html, size: r.size, fits: r.fits }); } finally { setBusy(''); }
  }

  const editSheet = set.sheets.find((s) => s.id === editing);
  const none = !set.sheets.length;

  return (
    <Page
      title="Drawings — SLD sheets"
      intro="Every SLD sheet in one place: what's on it, its number, status and revision, the title block, and issues to the authority or client."
      actions={
        <div className="dw-export">
          <button className="chip primary" disabled={!!busy || none} onClick={() => exportSet(false)}>{busy === 'set' ? 'Building…' : 'Export set (one PDF)'}</button>
          <button className="chip" disabled={none} onClick={() => setExportOpen(!exportOpen)} aria-expanded={exportOpen}>More exports ▾</button>
          {exportOpen && (
            <div className="dw-menu" onMouseLeave={() => setExportOpen(false)}>
              <button onClick={() => exportSet(true)}>PDF per sheet</button>
              <button onClick={exportRegisterXlsx}>Drawing register (Excel)</button>
              <button onClick={exportRegisterPdf}>Drawing register (PDF)</button>
              {chosen.length > 0 && <button onClick={() => exportSet(false, chosen.map((s) => s.id))}>Selected sheets only ({chosen.length})</button>}
            </div>
          )}
        </div>
      }
    >
      <div className="tabs feeder-tabs dw-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {k === 'sheets' && <span className="m"> ({set.sheets.length})</span>}
            {k === 'issues' && (set.issues ?? []).length > 0 && <span className="m"> ({set.issues!.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'sheets' && (<>
        {none ? (
          <section className="card dw-empty">
            <b>No sheets yet.</b> Make them automatically:
            <div className="ds-tools">
              <button className="chip primary" onClick={() => replaceSet(sheetsByCount(project, perSheet, set.prefix))}>Split by panels ({perSheet} per sheet)</button>
              <button className="chip" onClick={() => replaceSet(autoSheets(project, 'perMdb', false, set.prefix))}>One sheet per MDB</button>
              <button className="chip" onClick={() => replaceSet(autoSheets(project, 'perSmdb', false, set.prefix))}>Overview + one per SMDB</button>
              <button className="linkish" onClick={() => setTab('layout')}>More options in Layout…</button>
            </div>
          </section>
        ) : (<>
          <div className="dr-tools">
            <div className="seg" role="tablist">
              <button role="tab" aria-selected={mode === 'table'} className={mode === 'table' ? 'on' : ''} onClick={() => setModeKeep('table')}>Table</button>
              <button role="tab" aria-selected={mode === 'grid'} className={mode === 'grid' ? 'on' : ''} onClick={() => setModeKeep('grid')}>Thumbnails</button>
            </div>
            <input className="bi-text dr-search" type="search" placeholder="Search number, title, panel…" value={filter.q ?? ''} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
            <select className="chip" value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}><option value="">All statuses</option>{statuses.map((x) => <option key={x}>{x}</option>)}</select>
            <select className="chip" value={filter.rev ?? ''} onChange={(e) => setFilter({ ...filter, rev: e.target.value || undefined })}><option value="">All revisions</option>{revs.map((x) => <option key={x} value={x}>Rev {x}</option>)}</select>
            <select className="chip" value={filter.type ?? ''} onChange={(e) => setFilter({ ...filter, type: (e.target.value || undefined) as SheetFilter['type'] })}><option value="">All sheet types</option><option value="sld">SLD sheets</option><option value="db">DB circuit diagrams</option></select>
            {(filtered || sort.key !== 'order') && <button className="linkish" onClick={() => { setFilter({}); setSort({ key: 'order' }); }}>Clear filters</button>}
            <span className="sp" />
            <span className="m">{visible.length} of {set.sheets.length} sheets</span>
          </div>

          <div className={`dr-bulk${chosen.length ? ' on' : ''}`}>
            <b>{chosen.length ? `${chosen.length} selected` : filtered ? `All ${visible.length} shown` : 'All sheets'}</b>
            <select className="chip" value={bulk.key} onChange={(e) => setBulk({ key: e.target.value as Col, value: '' })}>
              <option value="status">Status</option><option value="rev">Revision</option><option value="date">Date</option><option value="drawnBy">Drawn by</option><option value="checkedBy">Checked by</option><option value="approvedBy">Approved by</option><option value="scale">Scale</option>
            </select>
            {bulk.key === 'status'
              ? <select className="chip" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}><option value="">(default)</option>{SHEET_STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
              : <input className="bi-text" style={{ width: 130 }} type={bulk.key === 'date' ? 'date' : 'text'} placeholder="blank = default" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} />}
            <button className="chip" onClick={() => setOn(bulk.key, bulk.value.trim())}>Set</button>
            <button className="chip" onClick={bumpRev} title="A→B, 0→1, P1→P2">Next revision</button>
            <button className="chip primary" onClick={() => setIssuing(true)}>Issue…</button>
            {chosen.length > 0 && <button className="linkish" onClick={() => setSelected(new Set())}>Clear selection</button>}
          </div>

          {mode === 'grid' ? (
            <SheetGrid project={project} set={set} sheets={visible} run={run} selected={selected} canDrag={canMove}
              onToggle={toggle} onMove={(a, b) => save(moveSheet(set, a, b))} onPreview={(s, t) => setPreview({ no: s.number, html: t.html, size: t.size })} onEdit={(s) => setEditing(s.id)} />
          ) : (
            <div className="tw">
              <table className="ds-table dr-table dw-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" title="Select all shown" checked={allOn} onChange={() => setSelected(allOn ? new Set([...selected].filter((id) => !visible.some((s) => s.id === id))) : new Set([...selected, ...visible.map((s) => s.id)]))} /></th>
                    <th />
                    <th className="sortable" onClick={() => sortBy('number')}>No.{arrow('number')}</th>
                    <th className="sortable" onClick={() => sortBy('title')}>Title / panels{arrow('title')}</th>
                    <th>Size</th>
                    <th className="sortable" onClick={() => sortBy('status')}>Status{arrow('status')}</th>
                    <th className="sortable" onClick={() => sortBy('rev')}>Rev{arrow('rev')}</th>
                    <th className="sortable" onClick={() => sortBy('date')}>Date{arrow('date')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const i = set.sheets.indexOf(s);
                    const st = s.status || set.status || '';
                    const hist = s.history ?? [];
                    return (
                      <tr key={s.id} className={`${selected.has(s.id) ? 'dr-sel' : ''}${editing === s.id ? ' dw-editing' : ''}`}>
                        <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                        <td className="bi-move">
                          <button className="icon-btn" disabled={!canMove || i === 0} onClick={() => save(moveSheet(set, i, i - 1))}>▲</button>
                          <button className="icon-btn" disabled={!canMove || i === set.sheets.length - 1} onClick={() => save(moveSheet(set, i, i + 1))}>▼</button>
                        </td>
                        <td><b>{s.number}</b></td>
                        <td>
                          {txt(s.title, (v) => v && setSheet(s.id, { title: v }), '', 260)}
                          <div className="m dr-panels">{s.kind === 'board' ? `${s.boards[0]} circuit diagram` : s.boards.length ? s.boards.join(', ') : <span className="warn">no panels — Edit to tick them</span>}</div>
                        </td>
                        <td><select className="bi-sel" value={s.size} onChange={(e) => setSheet(s.id, { size: e.target.value as DrawingSheet['size'] })}><option value="auto">Auto</option>{SIZES.map((z) => <option key={z}>{z}</option>)}</select></td>
                        <td><span className="dr-dot" style={{ background: statusColor(st) }} />{st || <span className="m">—</span>}</td>
                        <td title={hist.length ? hist.map((h) => `Rev ${h.rev} · ${h.date} · ${h.description}`).join('\n') : 'Not issued yet'}><b>{sheetRev(s, rev?.id) || '—'}</b>{hist.length > 0 && <span className="m dr-hist"> · {hist.length} issue{hist.length > 1 ? 's' : ''}</span>}</td>
                        <td>{s.date || hist[hist.length - 1]?.date || <span className="m">{rev?.date ?? '—'}</span>}</td>
                        <td className="acts">
                          <button className="chip" onClick={() => setEditing(s.id)}>Edit</button>
                          <button className="chip" disabled={!s.boards.length || !!busy} onClick={() => preview1(s)}>{busy === s.id ? '…' : 'Preview'}</button>
                        </td>
                      </tr>
                    );
                  })}
                  {!visible.length && <tr><td colSpan={9} className="m">No sheets match the filters.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>)}
        <div className="ds-tools" style={{ marginTop: 8 }}>
          <button className="chip" onClick={() => add('system')}>+ Sheet</button>
          <select className="chip" value="" onChange={(e) => e.target.value && add('board', e.target.value)}>
            <option value="">+ DB circuit diagram sheet…</option>
            {dbs.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
          </select>
          <span className="m">Tick sheets to change only those; with none ticked, Set / Next revision / Issue apply to every sheet shown.</span>
        </div>
      </>)}

      {tab === 'layout' && (<>
        <section className="card">
          <h4>Make the sheets automatically</h4>
          <div className="ds-tools">
            <button className="chip" onClick={() => replaceSet(sheetsByCount(project, perSheet, set.prefix))}>Split by panels</button>
            <label className="row">max <input className="bi-text" style={{ width: 44 }} inputMode="numeric" value={perSheet} onChange={(e) => setPerSheet(Math.max(1, Number(e.target.value) || 1))} /> panels per sheet</label>
            <span className="sp" style={{ flex: 'none', width: 12 }} />
            <button className="chip" onClick={() => replaceSet(autoSheets(project, 'perMdb', dbSheets, set.prefix))}>One sheet per MDB</button>
            <button className="chip" onClick={() => replaceSet(autoSheets(project, 'perSmdb', dbSheets, set.prefix))}>Overview + one per SMDB</button>
            <label className="row"><input type="checkbox" checked={dbSheets} onChange={(e) => setDbSheets(e.target.checked)} /> Also a circuit diagram for every DB</label>
          </div>
          <p className="m">The size of each sheet is chosen from what's drawn (the smallest of A4 → A1 that stays readable). DBs show as a box with their circuit count and kW. Feeders to a panel on another sheet end in “to X — sheet N”.</p>
        </section>
        <section className="card">
          <h4>Drawing style</h4>
          <div className="ds-tools">
            <label className="row" title="A frame around each panel with its summary box (LOC, TCL, DF, MDL), way numbers and DEWA wording"><input type="checkbox" checked={dewa} onChange={(e) => onChange({ ...project, drawing: { ...d, sldStyle: e.target.checked ? undefined : 'standard' } })} /> Panel frames and summary boxes (DEWA style)</label>
            <label className="row" title="Cable text on the drawing sheets. Reference numbers keep a large SLD readable: each cable shows its size and a number; the CABLE SCHEDULE on every sheet gives the full description.">Cable text
              <select className="chip" value={d.cableLabels ?? 'auto'} onChange={(e) => onChange({ ...project, drawing: { ...d, cableLabels: e.target.value === 'auto' ? undefined : e.target.value as 'ref' | 'full' } })}>
                <option value="auto">Auto — reference numbers when the sheet is crowded</option>
                <option value="ref">Always reference numbers + cable schedule</option>
                <option value="full">Always full cable description</option>
              </select>
            </label>
            <label className="row"><input type="checkbox" checked={d.abbreviations !== false} onChange={(e) => onChange({ ...project, drawing: { ...d, abbreviations: e.target.checked ? undefined : false } })} /> Abbreviations table</label>
            <label className="row"><input type="checkbox" checked={!!set.register} onChange={(e) => save({ ...set, register: e.target.checked })} /> Drawing register as the first page of the set</label>
          </div>
        </section>
        <section className="card">
          <h4>Values printed on the sheets</h4>
          <div className="ds-tools">
            {LAYER_LABELS.map(([k, label]) => {
              const tags = set.tags ?? SHEET_LAYERS;
              return <label key={k} className="row"><input type="checkbox" checked={tags[k]} onChange={(e) => save({ ...set, tags: { ...tags, [k]: e.target.checked } })} /> {label}</label>;
            })}
          </div>
          <p className="m">Failures print in red (e.g. breaker Icu below the fault level).</p>
        </section>
      </>)}

      {tab === 'titleblock' && (
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
              <span>Project revision: <b>{rev ? `${rev.id} — ${rev.date}` : 'not issued'}</b> <button className="linkish" onClick={() => onOpen('revisions')}>Revisions…</button></span>
              <label className="row">Title block
                <select className="chip" value={d.titleTemplateId ?? ''} onChange={(e) => onChange({ ...project, drawing: { ...d, titleTemplateId: e.target.value || undefined } })}>
                  <option value="">Standard</option>
                  {[...(project.titleTemplates ?? []), ...loadTemplateLibrary().filter((t) => !(project.titleTemplates ?? []).some((x) => x.id === t.id))].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
              <button className="chip" onClick={() => { save(renumber(set, true)); onStatus('Sheets renumbered in order'); }} disabled={none}>Renumber all in order</button>
              <label className="row">Default status
                <select className="chip" value={set.status ?? ''} onChange={(e) => save({ ...set, status: e.target.value || undefined })}>
                  <option value="">—</option>{SHEET_STATUSES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
            </div>
            <p className="m">In a custom title block use {'{SheetNo}'}, {'{SheetTitle}'}, {'{SheetIndex}'} of {'{SheetCount}'}, {'{Status}'}, {'{Rev}'}, {'{RevDate}'}, {'{DrawnBy}'}, {'{CheckedBy}'}, {'{ApprovedBy}'}, {'{Scale}'}.</p>
          </section>
        </div>
      )}

      {tab === 'issues' && (<>
        <div className="ds-tools">
          <button className="chip primary" disabled={none} onClick={() => setIssuing(true)}>Issue {chosen.length ? `${chosen.length} selected sheet(s)` : 'all sheets'}…</button>
          <span className="m">Pick sheets in the Sheets tab to issue only those. Issuing moves each sheet to its next revision, records it in the sheet's revision table and makes a transmittal.</span>
        </div>
        <section className="card dr-issues">
          <h4>Transmittals</h4>
          {(set.issues ?? []).length === 0 ? <p className="m">Nothing issued yet.</p> : (
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
          )}
        </section>
        <section className="card dr-issues">
          <h4>Revision history by sheet</h4>
          <table className="ds-table">
            <thead><tr><th>Drawing no.</th><th>Title</th><th>Revisions</th></tr></thead>
            <tbody>
              {set.sheets.map((s) => (
                <tr key={s.id}><td><b>{s.number}</b></td><td>{s.title}</td>
                  <td>{(s.history ?? []).length ? s.history!.map((h) => <div key={`${h.rev}${h.date}`}><b>{h.rev}</b> · {h.date} · {h.description}{h.issueId ? <span className="m"> ({h.issueId})</span> : null}</div>) : <span className="m">not issued</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>)}

      {editSheet && (
        <SheetPanel key={editSheet.id} sheet={editSheet} set={set} project={project} boards={boards} rev={rev}
          onPatch={(patch) => setSheet(editSheet.id, patch)} onClose={() => setEditing(null)} onRemove={() => remove(editSheet.id)} onPreview={() => preview1(editSheet)} busy={busy === editSheet.id} />
      )}

      {issuing && <IssueDialog sheets={targets} projectRev={rev?.id} onClose={() => setIssuing(false)} onIssue={async (o, pdf) => {
        const r = issueSheets(set, targets.map((s) => s.id), o, rev?.id, (s) => sheetHash(project, set, s));
        save(r.set);
        setIssuing(false);
        setSelected(new Set());
        onStatus(`Issued ${r.issue.id}: ${r.issue.sheets.length} sheet(s) — ${o.purpose}`);
        if (pdf) {
          await transmittalPdf(r.issue);
          await run1('set', () => exportDrawingSet({ ...project, drawingSet: r.set }, r.set, run, false, onStatus, r.issue.sheets.map((s) => s.id), true));
        }
      }} />}

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal ds-preview" onClick={(e) => e.stopPropagation()}>
            <h3>{preview.no} — {preview.size}{preview.fits === false && <span className="warn"> · crowded even on A1: split this sheet</span>}</h3>
            <SheetPreview html={preview.html} size={preview.size} />
            <div className="modal-actions"><span className="sp" /><button className="chip" onClick={() => setPreview(null)}>Close</button></div>
          </div>
        </div>
      )}
    </Page>
  );
}

/** Side panel: everything about one sheet — panels on it, size, title
 * block values and its revision history. */
function SheetPanel({ sheet: s, set, project, boards, rev, onPatch, onClose, onRemove, onPreview, busy }: {
  sheet: DrawingSheet; set: DrawingSet; project: Project; boards: ReturnType<typeof boardsInSupplyOrder>; rev?: { id: string; date: string };
  onPatch: (p: Partial<DrawingSheet>) => void; onClose: () => void; onRemove: () => void; onPreview: () => void; busy: boolean;
}) {
  const d = project.drawing ?? {};
  const pp = project.params ?? {};
  const field = (label: string, k: keyof DrawingSheet, placeholder = '', list?: string) => (
    <label>{label}
      <input className="bi-text" list={list} defaultValue={String(s[k] ?? '')} key={`${k}${String(s[k] ?? '')}`} placeholder={placeholder}
        onBlur={(e) => e.target.value.trim() !== String(s[k] ?? '') && onPatch({ [k]: e.target.value.trim() || undefined } as Partial<DrawingSheet>)} />
    </label>
  );
  const depth = (id: string) => { let n = 0, x = project.boards.find((b) => b.id === id); while (x?.upstreamId && n < 20) { n++; x = project.boards.find((b) => b.id === x!.upstreamId); } return n; };
  return (
    <div className="dw-panel-backdrop" onClick={onClose}>
      <aside className="dw-panel" onClick={(e) => e.stopPropagation()} aria-label={`Sheet ${s.number}`}>
        <div className="dw-panel-head">
          <span className="dr-dot" style={{ background: statusColor(s.status || set.status) }} />
          <h3>{s.number}</h3>
          <span className="sp" />
          <button className="icon-btn" title="Close" onClick={onClose}>✕</button>
        </div>
        <div className="dw-panel-body">
          <div className="form-kv">
            {set.manualNumbers && field('Drawing no.', 'number')}
            <label>Title<input className="bi-text" defaultValue={s.title} key={`t${s.title}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.title && onPatch({ title: e.target.value.trim() })} /></label>
            <label>Size<select value={s.size} onChange={(e) => onPatch({ size: e.target.value as DrawingSheet['size'] })}><option value="auto">Auto (smallest readable)</option>{SIZES.map((z) => <option key={z}>{z}</option>)}</select></label>
            {field('Status', 'status', set.status ?? '—', 'dw-status')}
            {field('Revision', 'rev', sheetRev(s, rev?.id) || '—')}
            {field('Date', 'date', rev?.date ?? '')}
            {field('Drawn by', 'drawnBy', pp.drawnBy ?? d.drawnBy ?? '')}
            {field('Checked by', 'checkedBy', pp.checkedBy ?? d.checkedBy ?? '')}
            {field('Approved by', 'approvedBy', pp.approvedBy ?? d.approvedBy ?? '')}
            {field('Scale', 'scale', 'NTS')}
            {field('Remarks (register only)', 'remarks')}
          </div>
          <datalist id="dw-status">{SHEET_STATUSES.map((x) => <option key={x} value={x} />)}</datalist>
          <p className="m">Blank fields use the project's value (shown in grey).</p>

          <h4>Panels on this sheet</h4>
          {s.kind === 'board' ? <p>{s.boards[0]} <span className="m">— circuit diagram of this DB</span></p> : (<>
            <p className="m">Panels not ticked are drawn on their own sheet; feeders to them end in “to … — sheet N”.</p>
            <div className="ds-pick">
              {boards.map((b) => {
                const on = s.boards.includes(b.id);
                const other = !on && set.sheets.find((x) => x.id !== s.id && x.kind === 'system' && x.boards.includes(b.id));
                return (
                  <label key={b.id} className="row" style={{ paddingLeft: depth(b.id) * 14 }}>
                    <input type="checkbox" checked={on} onChange={() => onPatch({ boards: on ? s.boards.filter((y) => y !== b.id) : boards.filter((y) => y.id === b.id || s.boards.includes(y.id)).map((y) => y.id) })} />
                    {b.id} <span className="m">{b.kind}{other ? ` · on ${other.number}` : ''}</span>
                  </label>
                );
              })}
            </div>
          </>)}

          <h4>Revision history</h4>
          {(s.history ?? []).length ? (
            <table className="ds-table"><thead><tr><th>Rev</th><th>Date</th><th>Description</th></tr></thead>
              <tbody>{[...s.history!].reverse().map((h) => <tr key={`${h.rev}${h.date}`}><td><b>{h.rev}</b></td><td>{h.date}</td><td>{h.description}{h.issueId ? <span className="m"> ({h.issueId})</span> : null}</td></tr>)}</tbody>
            </table>
          ) : <p className="m">Not issued yet — the title block shows the project's revisions.</p>}
        </div>
        <div className="dw-panel-foot">
          <button className="chip danger" onClick={() => window.confirm(`Remove ${s.number}?`) && onRemove()}>Remove sheet</button>
          <span className="sp" />
          <button className="chip" disabled={!s.boards.length || busy} onClick={onPreview}>{busy ? '…' : 'Preview'}</button>
          <button className="chip primary" onClick={onClose}>Done</button>
        </div>
      </aside>
    </div>
  );
}

/** Issue the chosen sheets: date, purpose (becomes their status), what
 * changed, to whom; optionally move each to its next revision. */
export function IssueDialog({ sheets, projectRev, onClose, onIssue }: { sheets: DrawingSheet[]; projectRev?: string; onClose: () => void; onIssue: (o: IssueInput, pdf: boolean) => void }) {
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
