import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../types';
import type { CalcRun } from '../../calc/runs';
import { LAYER_LABELS, SHEET_LAYERS, type ResultLayers } from '../../diagram/annotations';
import { boardsInSupplyOrder } from '../../calc/summary';
import { subtree } from '../../calc/pfc';
import { evaluateProject } from '../../calc/electrical';
import {
  addRiserSheet, addSheet, applyTemplate, drawable, issueSheets, loadSheetTemplates, nextRev, renumber, saveSheetTemplates, setOf, SHEET_STATUSES, sheetChecks, sheetHash, sheetRev, sheetsByCount, SIZES, statusColor, templateFromSheet,
  type DrawingSet, type DrawingSheet, type SheetCheck, type SheetSize,
  sheetRefs, type SheetRef
} from '../../model/drawingSet';
import { currentRevision } from '../../model/revisions';
import { SHEET_MM } from '../../docs/sldSheet';
import { exportDrawingSet, exportEverythingZip, exportSheetsDxf, sheetHtml } from '../docs/sheetRender';
import { IssueDialog } from '../docs/DrawingsView';
import SheetMarkupLayer, { MarkupToolbar, type MarkupTool } from './SheetMarkupLayer';
import { MARKUP_LABEL, type MarkupColor, type SheetMarkup } from '../../model/sheetMarkup';

/** Colours of the sheet outlines on the design canvas. */
export const OUTLINE_COLORS = ['#2f80ed', '#e2711d', '#27ae60', '#9b51e0', '#d1495b', '#00a6a6', '#b8860b'];
export const sheetOutlines = (p: Project) =>
  setOf(p).sheets.filter((s) => s.kind === 'system' && s.boards.length).map((s, i) => ({ id: s.id, label: s.number, boards: s.boards, color: OUTLINE_COLORS[i % OUTLINE_COLORS.length] }));

/** Values printed — ready-made views for a sheet. */
const VIEWS: [string, ResultLayers][] = [
  ['Load', { current: true, voltage: false, vd: false, fault: false, pf: false, loading: true }],
  ['Fault levels', { current: false, voltage: false, vd: false, fault: true, pf: false, loading: false }],
  ['Voltage drop', { current: true, voltage: true, vd: true, fault: false, pf: false, loading: false }],
  ['Submission', SHEET_LAYERS]
];

/** Tabs below the SLD: Design (the working canvas) and one tab per drawing
 * sheet (the printed page). Right-click a sheet tab for more. */
export function SheetTabs({ project, active, selectedBoardId, outlinesOn, onActive, onChange, onStatus, onToggleOutlines, run }: {
  project: Project; active: string | null; selectedBoardId: string | null; outlinesOn: boolean; run?: CalcRun;
  onActive: (id: string | null) => void; onChange: (p: Project) => void; onStatus: (m: string) => void; onToggleOutlines: () => void;
}) {
  const set = setOf(project);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const save = (next: DrawingSet) => onChange({ ...project, drawingSet: next });
  const idx = (id: string) => set.sheets.findIndex((s) => s.id === id);
  const close = () => { setMenu(null); setAddOpen(false); };

  const act = (what: string, id: string) => {
    const s = set.sheets.find((x) => x.id === id)!;
    const i = idx(id);
    close();
    if (what === 'rename') { const t = window.prompt('Sheet title', s.title); if (t?.trim()) save({ ...set, sheets: set.sheets.map((x) => (x.id === id ? { ...x, title: t.trim() } : x)) }); }
    if (what === 'number') { const n = window.prompt('Drawing number (typed numbers are kept when sheets move)', s.number); if (n?.trim()) save({ ...set, manualNumbers: true, sheets: set.sheets.map((x) => (x.id === id ? { ...x, number: n.trim() } : x)) }); }
    if (what === 'dup') { const copy = { ...s, id: `sh-${Date.now().toString(36)}`, number: '', title: `${s.title} (copy)`, history: undefined, issuedHash: undefined, rev: undefined }; const sheets = [...set.sheets]; sheets.splice(i + 1, 0, copy); save(renumber({ ...set, sheets })); onActive(copy.id); }
    if (what === 'del' && window.confirm(`Delete ${s.number}?`)) { save(renumber({ ...set, sheets: set.sheets.filter((x) => x.id !== id) })); if (active === id) onActive(null); }
    if (what === 'left' || what === 'right') { const j = what === 'left' ? i - 1 : i + 1; if (j < 0 || j >= set.sheets.length) return; const sheets = [...set.sheets]; [sheets[i], sheets[j]] = [sheets[j], sheets[i]]; save(renumber({ ...set, sheets })); }
    if (what === 'pdf') void exportDrawingSet(project, set, run, false, onStatus, [id], false);
    if (what === 'dxf') void exportSheetsDxf(project, set, run, onStatus, [id]);
    if (SHEET_STATUSES.includes(what)) save({ ...set, sheets: set.sheets.map((x) => (x.id === id ? { ...x, status: what } : x)) });
    if (what === 'nextrev') save({ ...set, sheets: set.sheets.map((x) => (x.id === id ? { ...x, rev: nextRev(sheetRev(x, currentRevision(project)?.id)) } : x)) });
  };

  const newFromSelection = () => {
    close();
    if (!selectedBoardId) { onStatus('Select a panel on the design first (its branch goes on the new sheet)'); return; }
    const branch = boardsInSupplyOrder(project).filter((b) => subtree(project, selectedBoardId).has(b.id)).map((b) => b.id);
    const r = addSheet(set, branch, `SLD — ${selectedBoardId}`);
    save(r.set);
    onActive(r.id);
    onStatus(`New sheet with ${selectedBoardId} and its ${branch.length - 1} sub-panel(s)`);
  };

  return (
    <div className="sheet-tabs" onMouseLeave={() => setAddOpen(false)}>
      <button className={`st-tab${active === null ? ' on' : ''}`} onClick={() => onActive(null)} title="The working SLD: every panel, editing and calculations">Design</button>
      {set.sheets.map((s) => (
        <button key={s.id} className={`st-tab${active === s.id ? ' on' : ''}`} onClick={() => onActive(s.id)} title={`${s.title} — right-click for more`}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ id: s.id, x: e.clientX, y: e.clientY }); }}>
          <span className="dr-dot" style={{ background: statusColor(s.status || set.status) }} />{s.number}
        </button>
      ))}
      <div className="st-add">
        <button className="st-tab" onClick={() => setAddOpen(!addOpen)} title="Add a sheet">+</button>
        {addOpen && (
          <div className="dw-menu st-menu-up">
            <button onClick={newFromSelection}>Selected panel and its branch{selectedBoardId ? ` (${selectedBoardId})` : ''}</button>
            <button onClick={() => { close(); const r = addSheet(set, [], `SLD — sheet ${set.sheets.length + 1}`); save(r.set); onActive(r.id); }}>Empty sheet (tick panels)</button>
            {(project.building?.buildings ?? []).map((b) => (
              <button key={b.id} onClick={() => { close(); const r = addRiserSheet(set, b.id, b.name); save(r.set); onActive(r.id); }}>Riser diagram — {b.name}</button>
            ))}
            <button onClick={() => { close(); const n = Number(window.prompt('Panels per sheet', '10')); if (!n) return; if (set.sheets.length && !window.confirm('Replace all sheets?')) return; save({ ...sheetsByCount(project, n, set.prefix), register: set.register, tags: set.tags, status: set.status, issues: set.issues }); }}>Split all panels into sheets…</button>
          </div>
        )}
      </div>
      <span className="sp" />
      <label className="row st-outline" title="Outline each sheet's panels on the design canvas"><input type="checkbox" checked={outlinesOn} onChange={onToggleOutlines} /> Show sheets on Design</label>
      {menu && (
        <>
          <div className="st-cover" onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
          <div className="dw-menu st-ctx" style={{ left: menu.x, top: Math.max(8, menu.y - 330) }}>
            <button onClick={() => act('rename', menu.id)}>Rename…</button>
            <button onClick={() => act('number', menu.id)}>Drawing number…</button>
            <button onClick={() => act('dup', menu.id)}>Duplicate</button>
            <button onClick={() => act('left', menu.id)}>Move left</button>
            <button onClick={() => act('right', menu.id)}>Move right</button>
            <button onClick={() => act('nextrev', menu.id)}>Next revision</button>
            <div className="st-sub">Status: {SHEET_STATUSES.slice(0, 5).map((x) => <button key={x} onClick={() => act(x, menu.id)} style={{ color: statusColor(x) }}>{x.replace('FOR ', '')}</button>)}</div>
            <button onClick={() => act('pdf', menu.id)}>Export this sheet (PDF)</button>
            <button onClick={() => act('dxf', menu.id)}>Export this sheet (DXF)</button>
            <button className="danger" onClick={() => act('del', menu.id)}>Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

/** One sheet as it prints, live, with its settings beside it. */
export function SheetWorkspace({ project, run, sheetId, design, onChange, onStatus, onActive }: {
  project: Project; run?: CalcRun; sheetId: string; design: React.ReactNode;
  onChange: (p: Project) => void; onStatus: (m: string) => void; onActive: (id: string | null) => void;
}) {
  const set = setOf(project);
  const s = set.sheets.find((x) => x.id === sheetId);
  const [page, setPage] = useState<{ html: string; size: SheetSize; fits: boolean; refs: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [side, setSide] = useState(() => { try { return localStorage.getItem('lvds.sheetSide') === '1'; } catch { return false; } });
  const [publish, setPublish] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [hostW, setHostW] = useState(900);
  const [hostH, setHostH] = useState(600);
  const save = (next: DrawingSet) => onChange({ ...project, drawingSet: next });
  const patch = (p: Partial<DrawingSheet>) => s && save({ ...set, sheets: set.sheets.map((x) => (x.id === s.id ? { ...x, ...p } : x)) });
  const [tool, setTool] = useState<MarkupTool>('select');
  const [mColor, setMColor] = useState<MarkupColor>('red');
  const [mSize, setMSize] = useState(3.5);
  const [selId, setSelId] = useState<string | null>(null);
  const markups = s?.markups ?? [];
  const setMarkups = (next: SheetMarkup[]) => patch({ markups: next.length ? next : undefined });
  const selected = markups.find((m) => m.id === selId);
  const removeSelected = () => { if (selected) { setMarkups(markups.filter((m) => m.id !== selected.id)); setSelId(null); } };
  const restyle = (p: Partial<SheetMarkup>) => selected && setMarkups(markups.map((m) => (m.id === selected.id ? { ...m, ...p } : m)));
  useEffect(() => { setSelId(null); setTool('select'); }, [sheetId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeSelected(); }
      else if (e.key === 'Escape') { setTool('select'); setSelId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Redraw the page when the design or this sheet changes (debounced).
  const key = useMemo(() => (s ? sheetHash(project, set, { ...s, markups: undefined }) + JSON.stringify([s.arrows, s.size, s.cableLabels, s.status, s.rev, s.number, project.drawing, project.info, set.sheets.length]) : ''), [project, set, s]);
  useEffect(() => {
    if (!s || !drawable(s)) { setPage(null); return; }
    let stop = false;
    const t = setTimeout(async () => {
      setBusy(true);
      try { const r = await sheetHtml(project, set, s, run, false, false); if (!stop && r) setPage(r); } finally { if (!stop) setBusy(false); }
    }, 350);
    return () => { stop = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setHostW(el.clientWidth); setHostH(el.clientHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [side]);

  if (!s) return <p className="m">This sheet no longer exists.</p>;
  const mm = SHEET_MM[page?.size ?? (s.size === 'auto' ? 'A3' : s.size)];
  const pxW = mm.w * 3.78, pxH = mm.h * 3.78;
  const fit = Math.min((hostW - 24) / pxW, (hostH - 24) / pxH);
  const scale = zoom === 'fit' ? fit : zoom;
  const boards = boardsInSupplyOrder(project);
  const depth = (id: string) => { let n = 0, x = project.boards.find((b) => b.id === id); while (x?.upstreamId && n < 20) { n++; x = project.boards.find((b) => b.id === x!.upstreamId); } return n; };
  const tags = s.tags ?? set.tags ?? SHEET_LAYERS;
  const templates = loadSheetTemplates();
  const rev = currentRevision(project);

  return (
    <div className={`sheet-ws${side ? ' side' : ''}`}>
      <div className="sheet-bar">
        <b>{s.number}</b> <span className="m">{s.title}</span>
        {page && <span className="chip-lite">{page.size}{page.refs ? ' · cable numbers' : ''}{!page.fits ? ' · crowded' : ''}</span>}
        {busy && <span className="m">Updating…</span>}
        {(() => {
          const { outgoing, incoming } = sheetRefs(project, set, s);
          const chip = (r: SheetRef, dir: 'From' | 'To') => (
            <button key={`${dir}-${r.boardId}-${r.feederId ?? ''}`} className={`chip${r.sheet ? '' : ' bad-btn'}`} disabled={!r.sheet || r.sheet.id === s.id}
              title={r.sheet ? `Open ${r.sheet.number} — ${r.sheet.title}` : `${r.boardId} is on no sheet — add it to a sheet`} onClick={() => r.sheet && onActive(r.sheet.id)}>
              {dir === 'From' ? '←' : '→'} {dir} {r.boardId}{r.sheet ? ` · ${r.sheet.number}` : ' · no sheet'}
            </button>
          );
          return incoming.length + outgoing.length ? <span className="sheet-refs">{incoming.map((r) => chip(r, 'From'))}{outgoing.map((r) => chip(r, 'To'))}</span> : null;
        })()}
        <span className="sp" />
        <button className="icon-btn" title="Zoom out" onClick={() => setZoom(Math.max(0.15, (zoom === 'fit' ? fit : zoom) / 1.25))}>−</button>
        <button className="chip" onClick={() => setZoom('fit')}>{zoom === 'fit' ? 'Fit' : `${Math.round(scale * 100)} %`}</button>
        <button className="icon-btn" title="Zoom in" onClick={() => setZoom(Math.min(3, (zoom === 'fit' ? fit : zoom) * 1.25))}>+</button>
        <label className="row" title="The design on the left, this sheet on the right"><input type="checkbox" checked={side} onChange={(e) => { setSide(e.target.checked); try { localStorage.setItem('lvds.sheetSide', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} /> Side by side</label>
        <button className="chip primary" onClick={() => setPublish(true)}>Publish…</button>
      </div>
      {s.kind !== 'earthing' && drawable(s) && (
        <MarkupToolbar tool={tool} color={selected?.color ?? mColor} size={mSize} selected={selected} count={markups.length}
          onTool={(t) => { setTool(t); if (t !== 'select') setSelId(null); }}
          onColor={(c) => { setMColor(c); restyle({ color: c }); }}
          onSize={(z) => { setMSize(z); restyle({ size: z }); }} onDelete={removeSelected} />
      )}
      <div className="sheet-body">
        {side && <div className="sheet-design">{design}</div>}
        <div className="sheet-page" ref={host}>
          {!drawable(s) ? <p className="m">Tick the panels for this sheet on the right.</p> : page ? (
            <div style={{ width: pxW * scale, height: pxH * scale, position: 'relative' }} className="sheet-paper">
              <iframe title={s.number} srcDoc={page.html} sandbox="" style={{ width: pxW, height: pxH, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, background: '#fff' }} />
              {s.kind !== 'earthing' && (
                <SheetMarkupLayer markups={markups} mmW={mm.w} mmH={mm.h} width={pxW * scale} height={pxH * scale} tool={tool} color={mColor} size={mSize}
                  selected={selId} rev={nextRev(sheetRev(s, rev?.id))} onSelect={setSelId} onChange={setMarkups} onTool={setTool} />
              )}
            </div>
          ) : <p className="m">Drawing the sheet…</p>}
        </div>
        <aside className="sheet-side">
          <details open><summary>Sheet</summary>
            <div className="form-kv">
              <label>Title<input className="bi-text" defaultValue={s.title} key={`t${s.title}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.title && patch({ title: e.target.value.trim() })} /></label>
              <label>Paper<select value={s.size} onChange={(e) => patch({ size: e.target.value as DrawingSheet['size'] })}><option value="auto">Auto (smallest readable)</option>{SIZES.map((z) => <option key={z}>{z}</option>)}</select></label>
              <label>Status<select value={s.status ?? ''} onChange={(e) => patch({ status: e.target.value || undefined })}><option value="">{set.status ? `(${set.status})` : '—'}</option>{SHEET_STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label>Revision<input className="bi-text" defaultValue={s.rev ?? ''} key={`r${s.rev}`} placeholder={sheetRev(s, rev?.id) || '—'} onBlur={(e) => e.target.value !== (s.rev ?? '') && patch({ rev: e.target.value.trim() || undefined })} /></label>
              <label>Cable text<select value={s.cableLabels ?? ''} onChange={(e) => patch({ cableLabels: (e.target.value || undefined) as DrawingSheet['cableLabels'] })}>
                <option value="">As the project ({project.drawing?.cableLabels ?? 'auto'})</option><option value="auto">Auto (numbers when crowded)</option><option value="ref">Numbers + cable schedule</option><option value="full">Full description</option>
              </select></label>
            </div>
          </details>
          {s.kind === 'riser' && (
            <details open><summary>Building</summary>
              <select value={s.buildingId ?? ''} onChange={(e) => patch({ buildingId: e.target.value })}>
                {(project.building?.buildings ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <p className="m">Each panel is drawn on its Level (panel properties). Levels and floor heights come from Building information.</p>
            </details>
          )}
          {s.kind === 'system' && (
            <details open><summary>Panels on this sheet ({s.boards.length})</summary>
              <div className="ds-pick">
                {boards.map((b) => {
                  const on = s.boards.includes(b.id);
                  const other = !on && set.sheets.find((x) => x.id !== s.id && x.kind === 'system' && x.boards.includes(b.id));
                  return (
                    <label key={b.id} className="row" style={{ paddingLeft: depth(b.id) * 12 }}>
                      <input type="checkbox" checked={on} onChange={() => patch({ boards: on ? s.boards.filter((y) => y !== b.id) : boards.filter((y) => y.id === b.id || s.boards.includes(y.id)).map((y) => y.id) })} />
                      {b.id}{other && <button className="linkish m" onClick={(e) => { e.preventDefault(); onActive(other.id); }}> on {other.number}</button>}
                    </label>
                  );
                })}
              </div>
            </details>
          )}
          <details><summary>Values printed (view)</summary>
            <div className="ds-tools">
              {VIEWS.map(([name, v]) => <button key={name} className={`chip${JSON.stringify(tags) === JSON.stringify(v) ? ' on' : ''}`} onClick={() => patch({ tags: v })}>{name}</button>)}
              {s.tags && <button className="linkish" onClick={() => patch({ tags: undefined })}>As the set</button>}
            </div>
            {LAYER_LABELS.map(([k, label]) => <label key={k} className="row"><input type="checkbox" checked={tags[k]} onChange={(e) => patch({ tags: { ...tags, [k]: e.target.checked } })} /> {label}</label>)}
          </details>
          <details><summary>Notes on this sheet ({(s.notes ?? []).length})</summary>
            <textarea className="sheet-notes" rows={4} defaultValue={(s.notes ?? []).join('\n')} key={(s.notes ?? []).join('|')} placeholder={'One note per line, e.g.\nRefer to E-SLD-002 for SMDB-FF.'}
              onBlur={(e) => { const n = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (n.join('|') !== (s.notes ?? []).join('|')) patch({ notes: n.length ? n : undefined }); }} />
            <p className="m">Printed in the NOTES box after the project's SLD notes.</p>
          </details>
          {s.kind === 'system' && (
            <details><summary>Revision clouds ({(s.clouds ?? []).length})</summary>
              {(s.clouds ?? []).map((c, i) => (
                <div key={i} className="row">△{c.rev} around {c.boards.join(', ')} <button className="icon-btn" title="Remove" onClick={() => patch({ clouds: (s.clouds ?? []).filter((_, k) => k !== i) || undefined })}>✕</button></div>
              ))}
              <CloudAdd boards={s.boards} rev={nextRev(sheetRev(s, rev?.id))} onAdd={(c) => patch({ clouds: [...(s.clouds ?? []), c] })} />
            </details>
          )}
          {s.kind !== 'earthing' && (
            <details open={markups.length > 0}><summary>Markups ({markups.length})</summary>
              {markups.map((m) => (
                <div key={m.id} className={`row markup-row${m.id === selId ? ' on' : ''}`}>
                  <button className="linkish" onClick={() => { setTool('select'); setSelId(m.id); }}>{MARKUP_LABEL[m.kind]}{m.kind === 'cloud' && m.rev ? ` △${m.rev}` : ''}{m.text ? `: ${m.text.split('\n')[0].slice(0, 28)}` : ''}</button>
                  <button className="icon-btn" title="Remove" onClick={() => { setMarkups(markups.filter((x) => x.id !== m.id)); if (m.id === selId) setSelId(null); }}>✕</button>
                </div>
              ))}
              {markups.length > 0 && <button className="linkish" onClick={() => { if (window.confirm(`Remove all ${markups.length} markups from ${s.number}?`)) { setMarkups([]); setSelId(null); } }}>Remove all</button>}
              <p className="m">Draw on the sheet with the Markup tools above. They stay on this sheet when the design changes and print in the PDF and DXF.</p>
            </details>
          )}
          <details><summary>Arrows and callouts ({(s.arrows ?? []).length})</summary>
            {(s.arrows ?? []).map((a, i) => (
              <div key={i} className="row">→ {a.target.replace(/^f:/, '')}: “{a.text}” <button className="icon-btn" title="Remove" onClick={() => patch({ arrows: (s.arrows ?? []).filter((_, k) => k !== i) })}>✕</button></div>
            ))}
            <ArrowAdd project={project} boards={s.boards} onAdd={(a) => patch({ arrows: [...(s.arrows ?? []), a] })} />
          </details>
          <details><summary>Template</summary>
            <div className="ds-tools">
              <select className="chip" value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) { save({ ...set, sheets: set.sheets.map((x) => (x.id === s.id ? applyTemplate(x, t) : x)) }); onStatus(`Template “${t.name}” applied`); } }}>
                <option value="">Apply a template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="chip" onClick={() => { const n = window.prompt('Template name (paper, cable text, values printed, notes, status, scale)', s.title); if (!n?.trim()) return; saveSheetTemplates([...templates, templateFromSheet(s, n.trim())]); onStatus(`Saved template “${n.trim()}”`); }}>Save this sheet as a template</button>
              {templates.length > 0 && (
                <button className="chip" onClick={() => { const t = templates.find((x) => x.name === window.prompt(`Apply which template to all sheets? (${templates.map((x) => x.name).join(', ')})`)); if (t) { save({ ...set, sheets: set.sheets.map((x) => applyTemplate(x, t)) }); onStatus(`Template “${t.name}” applied to all sheets`); } }}>Apply to all sheets…</button>
              )}
            </div>
          </details>
        </aside>
      </div>
      {publish && <PublishDialog project={project} run={run} onClose={() => setPublish(false)} onChange={onChange} onStatus={onStatus} onOpen={(id) => { setPublish(false); onActive(id); }} />}
    </div>
  );
}

function ArrowAdd({ project, boards, onAdd }: { project: Project; boards: string[]; onAdd: (a: { target: string; text: string; dir: 'ne' | 'nw' | 'se' | 'sw'; len?: number }) => void }) {
  const [target, setTarget] = useState(boards[0] ?? '');
  const [text, setText] = useState('');
  const [dir, setDir] = useState<'ne' | 'nw' | 'se' | 'sw'>('ne');
  const [len, setLen] = useState(80);
  const circuits = project.feeders.filter((f) => boards.includes(f.boardId));
  return (
    <div className="cloud-add form-kv">
      <label>Points at<select value={target} onChange={(e) => setTarget(e.target.value)}>
        <optgroup label="Panels">{boards.map((b) => <option key={b} value={b}>{b}</option>)}</optgroup>
        <optgroup label="Circuits (cable)">{circuits.map((f) => <option key={f.id} value={`f:${f.id}`}>{f.boardId} · {f.name || f.id}</option>)}</optgroup>
      </select></label>
      <label>Text<input className="bi-text" value={text} placeholder="e.g. Existing — not in scope" onChange={(e) => setText(e.target.value)} /></label>
      <label>Direction<select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}><option value="ne">Up right ↗</option><option value="nw">Up left ↖</option><option value="se">Down right ↘</option><option value="sw">Down left ↙</option></select></label>
      <label>Length<input className="bi-text" type="number" min={30} max={300} value={len} onChange={(e) => setLen(Number(e.target.value) || 80)} /></label>
      <button className="chip" disabled={!target || !text.trim()} onClick={() => { onAdd({ target, text: text.trim(), dir, len }); setText(''); }}>Add arrow</button>
    </div>
  );
}

function CloudAdd({ boards, rev, onAdd }: { boards: string[]; rev: string; onAdd: (c: { boards: string[]; rev: string }) => void }) {
  const [pick, setPick] = useState<string[]>([]);
  const [r, setR] = useState(rev);
  return (
    <div className="cloud-add">
      <div className="ds-tools">{boards.map((b) => <label key={b} className="row"><input type="checkbox" checked={pick.includes(b)} onChange={() => setPick(pick.includes(b) ? pick.filter((x) => x !== b) : [...pick, b])} /> {b}</label>)}</div>
      <label className="row">Rev <input className="bi-text" style={{ width: 44 }} value={r} onChange={(e) => setR(e.target.value)} />
        <button className="chip" disabled={!pick.length || !r.trim()} onClick={() => { onAdd({ boards: pick, rev: r.trim() }); setPick([]); }}>Add cloud</button></label>
    </div>
  );
}

/** Readiness checks, then publish: the whole set as one PDF, or issue it. */
function PublishDialog({ project, run, onClose, onChange, onStatus, onOpen }: { project: Project; run?: CalcRun; onClose: () => void; onChange: (p: Project) => void; onStatus: (m: string) => void; onOpen: (id: string) => void }) {
  const set = setOf(project);
  const [crowded, setCrowded] = useState<SheetCheck[] | null>(null);
  const [busy, setBusy] = useState('');
  const [issuing, setIssuing] = useState(false);
  const failing = useMemo(() => (run?.results ?? evaluateProject(project)).map((r) => ({ feederId: r.feeder.id, boardId: r.feeder.boardId, status: r.status })), [project, run]);
  const checks = useMemo(() => sheetChecks(project, set, failing), [project, set, failing]);
  useEffect(() => {
    let stop = false;
    (async () => {
      const out: SheetCheck[] = [];
      for (const s of set.sheets) {
        if (!drawable(s)) continue;
        const r = await sheetHtml(project, set, s, run).catch(() => undefined);
        if (r && !r.fits) out.push({ level: 'warn', text: `${s.number} is crowded even on A1 — split it`, sheetId: s.id });
      }
      if (!stop) setCrowded(out);
    })();
    return () => { stop = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const all = [...checks, ...(crowded ?? [])];
  const bad = all.filter((c) => c.level === 'bad').length;
  const rev = currentRevision(project);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <h3>Publish the drawings</h3>
        <p className="m">{set.sheets.length} sheet(s). {crowded === null ? 'Checking sheet sizes…' : all.length ? `${bad} problem(s), ${all.length - bad} warning(s):` : 'No issues found by the checks — engineering review still required.'}</p>
        <ul className="pub-checks">
          {all.map((c, i) => (
            <li key={i} className={c.level}>
              <span>{c.level === 'bad' ? '✕' : '!'}</span> {c.text}
              {c.sheetId && <button className="linkish" onClick={() => onOpen(c.sheetId!)}>Open</button>}
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="chip" onClick={onClose}>Close</button>
          <span className="sp" />
          <button className="chip" disabled={!!busy || !set.sheets.length} onClick={async () => { setBusy('dxf'); try { await exportSheetsDxf(project, set, run, onStatus); } finally { setBusy(''); } }}>{busy === 'dxf' ? 'Building…' : 'DXF per sheet'}</button>
          <button className="chip" disabled={!!busy || !set.sheets.length} onClick={async () => { setBusy('zip'); try { await exportEverythingZip(project, set, run, onStatus); } finally { setBusy(''); } }}>{busy === 'zip' ? 'Building…' : 'Everything (ZIP)'}</button>
          <button className="chip" disabled={!!busy || !set.sheets.length} onClick={async () => { setBusy('set'); try { await exportDrawingSet(project, set, run, false, onStatus); } finally { setBusy(''); } }}>{busy === 'set' ? 'Building…' : 'Export set (one PDF)'}</button>
          <button className="chip primary" disabled={!set.sheets.length} onClick={() => setIssuing(true)}>Issue all sheets…</button>
        </div>
        {issuing && <IssueDialog sheets={set.sheets} projectRev={rev?.id} onClose={() => setIssuing(false)} onIssue={async (o, pdf) => {
          const r = issueSheets(set, set.sheets.map((s) => s.id), o, rev?.id, (s) => sheetHash(project, set, s));
          const next = { ...project, drawingSet: r.set };
          onChange(next);
          setIssuing(false);
          onStatus(`Issued ${r.issue.id}: ${r.issue.sheets.length} sheet(s) — ${o.purpose}`);
          if (pdf) { setBusy('set'); try { await exportDrawingSet(next, r.set, run, false, onStatus); } finally { setBusy(''); } }
          onClose();
        }} />}
      </div>
    </div>
  );
}
