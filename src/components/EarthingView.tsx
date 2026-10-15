import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import { earthingLayout, kindInfo, patchEarthing, pitStatus, setPitTest, DEFAULT_BONDING, type EarthPit } from '../model/earthingPlan';
import { earthSheetNo } from '../model/boardEarth';
import { earthingDrawing } from '../diagram/earthingDrawing';
import { buildSldSheetHtml, type SheetInfo } from '../docs/sldSheet';
import { buildSheetDxfPages } from '../docs/sheetDxf';
import { dxfExportNotice, namedDxfFiles } from '../docs/dxfFiles';
import { safeFileName, saveBinary, savePdf, saveText } from '../util/files';
import JSZip from 'jszip';
import MenuButton from './MenuButton';
import { Page } from './ui';

type Tab = 'drawing' | 'pits' | 'checks';
const stored = <T,>(key: string, initial: T): T => { try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; } };
const store = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* preference only */ } };
const PIT_FILL = { pass: '#7cc68d', fail: '#e5736b', untested: '#d5d8de' } as const;

/** The printed drawing (black on white) restyled for the canvas, like the SLD: transparent over the grid,
 * lines and text in the theme's colours, earth conductors in the OK green. Theme variables reach into the
 * shadow root; the exported sheet is built separately and stays black and white. */
const DARK = [
  'svg{width:100%;height:auto;display:block;fill:var(--tx)}',
  'svg>rect:first-child{fill:transparent}',
  '[fill="#111"]{fill:var(--tx)}[stroke="#111"]{stroke:var(--tx)}',
  '[fill="#fff"]{fill:var(--bg)}[stroke="#999"]{stroke:var(--line)}',
  '[fill="#1a7f37"]{fill:var(--ok)}[stroke="#1a7f37"]{stroke:var(--ok)}',
  '[fill="#5b6b82"]{fill:var(--mut)}[stroke="#5b6b82"]{stroke:var(--mut)}',
  '[fill="#1d4f8f"]{fill:var(--acc)}[stroke="#1d4f8f"]{stroke:var(--acc)}'
].join('');

/** The drawing in a shadow root: its own black-on-white text and sizes, untouched by the app's
 * dark-theme SVG styles. A click on a pit reports the pit's group (data-pit); elsewhere, null. */
function ShadowSvg({ svg, css, width, onPit }: { svg: string; css: string; width: string; onPit: (pit: Element | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onPit);
  cb.current = onPit;
  useEffect(() => {
    const root = host.current?.shadowRoot ?? host.current?.attachShadow({ mode: 'open' });
    if (!root) return;
    root.innerHTML = `<style>${DARK}[data-pit]{cursor:pointer}[data-pit]:hover>rect:first-child{stroke:var(--acc);stroke-width:2.5}${css}</style>${svg}`;
  }, [svg, css]);
  useEffect(() => {
    const root = host.current?.shadowRoot;
    if (!root) return;
    const click = (e: Event) => cb.current((e.target as Element).closest?.('[data-pit]') ?? null);
    root.addEventListener('click', click);
    return () => root.removeEventListener('click', click);
  }, [svg]);
  return <div ref={host} className="earth-svg-host" style={{ width }} />;
}

const STATUS_LABEL = { pass: 'pass', fail: 'over limit', untested: 'not tested' } as const;

/** Design → Earth pits: the earthing schematic of the RMUs, transformers,
 * generators and main boards at full width — each pit shown by its test
 * result, click a pit to record its test — with the pit test schedule and the
 * checks on their own tabs, the plan's settings in a side drawer, and the
 * schematic as a titled A3 sheet (PDF, DXF; black and white). */
export default function EarthingView({ project, onChange, onStatus, embedded = false }: {
  project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void;
  /** Inside the SLD workspace (Design ▸ SLD ▸ Earthing tab): no page title or intro. */
  embedded?: boolean;
}) {
  const L = useMemo(() => earthingLayout(project), [project]);
  // Working view: the schematic only — legend, notes and pit schedule are on the exported sheet.
  const svg = useMemo(() => earthingDrawing(project, L, false, { working: true }).svg, [project, L]);
  const plan = project.earthingPlan ?? {};
  const [tab, setTabState] = useState<Tab>(() => stored('earth.tab', 'drawing'));
  const setTab = (t: Tab) => { setTabState(t); store('earth.tab', t); };
  const [drawer, setDrawerState] = useState<boolean>(() => stored('earth.settings', false));
  const setDrawer = (v: boolean) => { setDrawerState(v); store('earth.settings', v); };
  const [zoom, setZoom] = useState(1);
  const [edit, setEdit] = useState<{ id: string; x: number; y: number; n: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const setPits = (key: string, def: number, v: string) => {
    const n = Math.max(0, Math.min(20, Math.round(Number(v) || 0)));
    onChange(patchEarthing(project, (p) => { const pits = { ...p.pits }; if (n === def) delete pits[key]; else pits[key] = n; return { ...p, pits }; }));
  };
  const setLinked = (key: string, on: boolean) => onChange(patchEarthing(project, (p) => ({ ...p, unlinked: on ? (p.unlinked ?? []).filter((k) => k !== key) : [...(p.unlinked ?? []), key] })));
  const test = (id: string, t: { measured?: string; date?: string; by?: string }) => {
    const next = setPitTest(project, id, t);
    if (next !== project) onChange(next);
  };
  const itemOf = (key: string) => L.items.find((i) => i.key === key)!;
  const netOf = (id: string) => L.nets.find((n) => n.pits.includes(id));
  const counts = { tested: L.pits.filter((p) => p.measured !== undefined).length, fail: L.pits.filter((p) => pitStatus(p) === 'fail').length };
  const issues = L.checks.filter((c) => c.level !== 'ok').length;

  // Pit status on the drawing (screen only): the inspection pit square filled pass / fail / untested.
  const statusCss = L.pits.map((p) => `[data-pit="${p.id}"] > rect:first-child{fill:${PIT_FILL[pitStatus(p)]}}`).join('');

  const openPit = (g: Element | null) => {
    const box = canvas.current?.getBoundingClientRect();
    if (!g || !box) return setEdit(null);
    const r = g.getBoundingClientRect();
    setEdit({ n: Date.now(), id: g.getAttribute('data-pit')!, x: r.right - box.left + canvas.current!.scrollLeft + 8, y: r.top - box.top + canvas.current!.scrollTop });
  };

  async function exportSheet(kind: 'pdf' | 'dxf') {
    const sheet = earthingDrawing(project, L, true, { mono: true }).svg;
    const info: SheetInfo = { no: earthSheetNo(project), title: 'EARTHING SCHEMATIC', count: 1, index: 1 };
    const name = safeFileName(`${project.name} ${info.no}`);
    try {
      let m: string | null;
      if (kind === 'pdf') m = await savePdf(`${name}.pdf`, buildSldSheetHtml(project, sheet, 'A3', info), { pageSize: 'A3', landscape: true });
      else {
        const files = namedDxfFiles(name, buildSheetDxfPages(project, sheet, 'A3', info));
        if (files.length === 1) m = await saveText(files[0].name, files[0].data, 'DXF drawing (AutoCAD R12)', 'dxf');
        else {
          const zip = new JSZip();
          files.forEach((f) => zip.file(f.name, f.data));
          m = await saveBinary(`${name}-DXF.zip`, await zip.generateAsync({ type: 'uint8array' }), 'ZIP', 'zip', 'application/zip');
        }
        const notice = dxfExportNotice(files);
        if (m && notice) m += ` — ${notice}`;
      }
      if (m) onStatus(m);
    } catch (e) {
      onStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const editing = edit ? L.pits.find((p) => p.id === edit.id) : undefined;
  const pitRow = (p: EarthPit) => {
    const it = itemOf(p.itemKey), k = kindInfo(p.kind), net = netOf(p.id), st = pitStatus(p);
    return (
      <tr key={`${p.id}-${p.measured ?? ''}-${p.date ?? ''}-${p.by ?? ''}`}>
        <td><b>{p.id}</b></td>
        <td>{it.equipment}<br /><span className="m">{k.label}</span></td>
        <td className="num">≤ {k.limitOhm}</td>
        <td><input className="bi-num" style={{ width: 60 }} inputMode="decimal" placeholder="Ω" defaultValue={p.measured ?? ''} onBlur={(e) => test(p.id, { measured: e.target.value })} /></td>
        <td className="num">{net?.effectiveOhm !== undefined ? <span className={net.ok ? 'ok' : 'bad'}>{net.effectiveOhm.toFixed(2)}</span> : <span className="m">—</span>}</td>
        <td><input type="date" defaultValue={p.date ?? ''} onBlur={(e) => test(p.id, { date: e.target.value })} /></td>
        <td><input style={{ width: 110 }} placeholder="name" defaultValue={p.by ?? ''} onBlur={(e) => test(p.id, { by: e.target.value })} /></td>
        <td className={`earth-st ${st}`}>{STATUS_LABEL[st]}</td>
      </tr>
    );
  };

  const actions = (<>
        <button className={`chip${drawer ? ' on' : ''}`} aria-pressed={drawer} onClick={() => setDrawer(!drawer)} title="Pits per equipment, electrode, conductor and bonding">Settings {drawer ? '◂' : '▸'}</button>
        <MenuButton label="Export sheet" title={`Earthing schematic as drawing sheet ${earthSheetNo(project)} (A3, black and white, with the pit schedule)`} align="right">
          {(close) => (
            <>
              <button disabled={!L.pits.length} onClick={() => { close(); void exportSheet('pdf'); }}>PDF — {earthSheetNo(project)}</button>
              <button disabled={!L.pits.length} onClick={() => { close(); void exportSheet('dxf'); }}>DXF — {earthSheetNo(project)}</button>
            </>
          )}
        </MenuButton>
      </>);
  const body = (
      <div className={`earth-ws${drawer ? ' with-drawer' : ''}`}>
        <div className="earth-main">
          <div className="earth-bar">
            <div className="seg" role="tablist" aria-label="Earthing">
              <button role="tab" aria-selected={tab === 'drawing'} className={tab === 'drawing' ? 'on' : ''} onClick={() => setTab('drawing')}>Drawing</button>
              <button role="tab" aria-selected={tab === 'pits'} className={tab === 'pits' ? 'on' : ''} onClick={() => setTab('pits')}>Pits and tests <span className="m">{counts.tested}/{L.pits.length}</span></button>
              <button role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'on' : ''} onClick={() => setTab('checks')}>Checks{issues > 0 && <span className="earth-badge">{issues}</span>}</button>
            </div>
            <span className="m">{L.pits.length} pits · {counts.tested} tested{counts.fail > 0 && <> · <span className="bad">{counts.fail} over limit</span></>}</span>
            <span className="sp" />
            {actions}
            {tab === 'drawing' && <>
              <button className="chip" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z / 1.25).toFixed(2)))}>−</button>
              <button className="chip" onClick={() => setZoom(1)}>Fit</button>
              <button className="chip" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, +(z * 1.25).toFixed(2)))}>+</button>
            </>}
          </div>

          {tab === 'drawing' && (L.pits.length ? (
            <>
              <div className="earth-canvas" ref={canvas}>
                <ShadowSvg svg={svg} css={statusCss} width={`${zoom * 100}%`} onPit={openPit} />
                {editing && edit && (
                  <div className="earth-pop" style={{ left: edit.x, top: edit.y }} onClick={(e) => e.stopPropagation()} key={`${editing.id}-${edit.n}`}>
                    <div className="earth-pop-h"><b>{editing.id}</b> <span className="m">{itemOf(editing.itemKey).equipment} · {kindInfo(editing.kind).label} · ≤ {kindInfo(editing.kind).limitOhm} Ω</span>
                      <button className="icon-btn" aria-label="Close" onClick={() => setEdit(null)}>✕</button></div>
                    <label>Measured Ω<input autoFocus inputMode="decimal" defaultValue={editing.measured ?? ''} onBlur={(e) => test(editing.id, { measured: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
                    <label>Test date<input type="date" defaultValue={editing.date ?? ''} onBlur={(e) => test(editing.id, { date: e.target.value })} /></label>
                    <label>Tested by<input defaultValue={editing.by ?? ''} placeholder="name" onBlur={(e) => test(editing.id, { by: e.target.value })} /></label>
                    <p className={`earth-st ${pitStatus(editing)}`}>{STATUS_LABEL[pitStatus(editing)]}</p>
                  </div>
                )}
              </div>
              <p className="m earth-key">Click a pit to record its test. Pit: <span className="earth-dot pass" /> pass · <span className="earth-dot fail" /> over its limit · <span className="earth-dot untested" /> not tested — screen only; the exported sheet is black and white.</p>
            </>
          ) : <p className="m">No earth pits yet — add transformers or main boards first.</p>)}

          {tab === 'pits' && (
            <div className="earth-table">
              <table className="bi-table compact">
                <thead><tr><th>Pit</th><th>Equipment / earth</th><th className="num">Limit Ω</th><th>Measured Ω</th><th className="num" title="Linked pits of the same kind in parallel — an estimate; the site test governs">Group Ω</th><th>Test date</th><th>Tested by</th><th>Result</th></tr></thead>
                <tbody>{L.pits.map(pitRow)}</tbody>
              </table>
              <p className="m">Pit IDs are kept when equipment or pit counts change; retired IDs stay reserved for their test records. Group value = measured pits in parallel (an estimate; the site test governs).</p>
            </div>
          )}

          {tab === 'checks' && (
            <ul className="bh-checks earth-checks">{L.checks.map((c, i) => <li key={i} className={c.level}>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'} {c.text}</li>)}</ul>
          )}
        </div>

        {drawer && (
          <aside className="earth-drawer" aria-label="Earthing settings">
            <h4>Pits per equipment</h4>
            <table className="bi-table compact">
              <thead><tr><th>Equipment</th><th>Earth</th><th>Pits</th><th title="Link these pits with the others of the same kind">Linked</th></tr></thead>
              <tbody>{L.items.map((it) => (
                <tr key={it.key}>
                  <td>{it.equipment}<br /><span className="m">{it.point}</span></td>
                  <td>{kindInfo(it.kind).label.replace(' earth', '')}</td>
                  <td><input className="bi-num" style={{ width: 46 }} inputMode="numeric" value={it.pits} onChange={(e) => setPits(it.key, it.defaultPits, e.target.value)} />{it.pits !== it.defaultPits && <span className="m"> (default {it.defaultPits})</span>}</td>
                  <td><input type="checkbox" checked={it.linked} onChange={(e) => setLinked(it.key, e.target.checked)} /></td>
                </tr>
              ))}</tbody>
            </table>
            <div className="form-kv">
              <label>Electrode<span className="pfcc-in"><input className="bi-num" style={{ width: 50 }} inputMode="decimal" value={L.electrodeM} onChange={(e) => onChange(patchEarthing(project, (p) => ({ ...p, electrodeM: Number(e.target.value) || undefined })))} /><span className="m">m Cu-bonded rod</span></span></label>
              <label>Link conductor<span className="pfcc-in"><input className="bi-num" style={{ width: 50 }} inputMode="numeric" value={L.conductorMm2} onChange={(e) => onChange(patchEarthing(project, (p) => ({ ...p, conductorMm2: Number(e.target.value) || undefined })))} /><span className="m">mm² Cu</span></span></label>
            </div>
            <label className="earth-bonding">Bonded to each main earth bar <span className="m">(one per line; shown on the schematic)</span>
              <textarea rows={4} key={L.bonding.join('\n')} defaultValue={L.bonding.join('\n')}
                onBlur={(e) => { const v = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (v.join('\n') !== L.bonding.join('\n')) onChange(patchEarthing(project, (p) => ({ ...p, bonding: v.join('\n') === DEFAULT_BONDING.join('\n') ? undefined : v }))); }} /></label>
            <p className="m">Defaults: RMU 2 pits · transformer 1 neutral + 1 body · main board 2 pits (one MDB) or 1 each (several). The SLD's earth pit detail follows these counts. Measured values: {Object.keys(plan.measured ?? {}).length}.</p>
          </aside>
        )}
      </div>
  );
  if (embedded) return <div className="earth-embedded">{body}</div>;
  return (
    <Page title="Earthing schematic" intro="Earth pits of the RMUs, transformers, generators and main boards (DEWA practice). HV body (RMU with the transformer tanks bonded to it, sharing its pits), transformer neutral and LV earths are separate systems; pits of the same kind are linked. Lightning protection is not part of this schematic.">
      {body}
    </Page>
  );
}
