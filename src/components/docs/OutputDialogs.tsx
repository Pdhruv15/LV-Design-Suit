import { useEffect, useRef, useState } from 'react';
import type { OutputDialog } from './outputHost';
import { Modal } from '../ui';
import type { CalcRun } from '../../calc/runs';
import { drawable, setOf, type DrawingSheet, type SheetSize } from '../../model/drawingSet';
import { planScale } from '../../docs/planLayout';
import {
  applySetup, batchesOf, importSetups, loadSetupLibrary, nextId, plotOf, projectForBatch, readSetups, saveToSetupLibrary, setupsFile, setupsOf, setupUsers, tablesOf, withBatch, withoutBatch, withoutSetup, withSetup,
  type BatchList, type NamedSetup, type PlotSetup
} from '../../model/plotSetup';
import type { Project } from '../../types';
import { safeFileName, saveBinary, saveText } from '../../util/files';
import { canPrint, PDF_PRINTER, plotPrinter, printerLabel, setPlotPrinter, usePrinters, type PrinterInfo } from '../../util/printers';
import { canPreviewSheetPdf, SheetPdfPreview } from './SheetPdfPreview';
import { PenTableDialog } from './PlotDialogs';
import { exportDrawingSet, printSheets } from './sheetRender';

/** Design CAD → Output: Plot, Page setups, Printers and Batch plot. Printing stays black-and-white. */

const SIZES: ('auto' | SheetSize)[] = ['auto', 'A4', 'A3', 'A3 portrait', 'A2', 'A1'];
const SCALES = [50, 100, 200, 500];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sizeLabel = (z: 'auto' | SheetSize) => (z === 'auto' ? 'Auto (the smallest that fits)' : z);
const sheetWith = (p: Project, id: string, patch: Partial<DrawingSheet>): Project => ({ ...p, drawingSet: { ...setOf(p), sheets: setOf(p).sheets.map((x) => (x.id === id ? { ...x, ...patch } : x)) } });

/** Output → Register: the sheet register as an Excel workbook. */
export async function exportRegister(project: Project, onStatus: (m: string) => void): Promise<void> {
  try {
    const [{ workbookBytes }, { buildRegisterWorkbook }] = await Promise.all([import('../../docs/formWorkbook'), import('../../docs/registerWorkbook')]);
    const m = await saveBinary(`${safeFileName(project.name)} - drawing register.xlsx`, await workbookBytes(buildRegisterWorkbook(project, setOf(project))), 'Excel', 'xlsx', XLSX);
    if (m) onStatus(m);
  } catch (e) { onStatus(`Register export failed: ${e instanceof Error ? e.message : String(e)}`); }
}

/** Sends sheets to PDF (one file, or one each) or to a printer. */
async function plotTo(project: Project, run: CalcRun | undefined, ids: string[], to: { printer: string; copies: number; each?: boolean }, onStatus: (m: string) => void) {
  const set = setOf(project);
  const ordered = { ...set, sheets: [...ids.map((id) => set.sheets.find((s) => s.id === id)!).filter(Boolean), ...set.sheets.filter((s) => !ids.includes(s.id))] };
  if (to.printer) await printSheets(project, ordered, run, ids, to.printer, to.copies, onStatus);
  else await exportDrawingSet(project, ordered, run, !!to.each, onStatus, ids, false);
}

function PrinterSelect({ value, onChange, list, label = 'Printer' }: { value: string; onChange: (v: string) => void; list: PrinterInfo[]; label?: string }) {
  const known = !value || list.some((p) => p.name === value);
  return (
    <label>{label}<select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={PDF_PRINTER}>PDF (built in)</option>
      {canPrint() && list.map((p) => <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? ' (system default)' : ''}</option>)}
      {!known && <option value={value}>{value} (not found)</option>}
    </select></label>
  );
}

/** Plot: the open layout or sheet to PDF or a printer, with a named page setup or its own; the settings can be kept as
 * the sheet's page setup. */
export function PlotDialog({ project, sheet, run, onChange, onStatus, onClose }: {
  project: Project; sheet: DrawingSheet; run?: CalcRun;
  onChange: (next: Project, message: string) => void; onStatus: (m: string) => void; onClose: () => void;
}) {
  const printers = usePrinters();
  const setups = setupsOf(project), tables = tablesOf(project), plan = sheet.kind === 'plan';
  const named = setups.find((n) => n.id === sheet.plot?.named);
  const [setupId, setSetupId] = useState(named?.id ?? '');
  const [printer, setPrinter] = useState(named?.printer ?? plotPrinter());
  const [size, setSize] = useState(sheet.size);
  const [scale, setScale] = useState(planScale(sheet.scale));
  const [setup, setSetup] = useState<PlotSetup>(() => ({ ...plotOf(project, sheet), named: undefined }));
  const [copies, setCopies] = useState(1);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Project>();
  const pick = (id: string) => {
    setSetupId(id);
    const n = setups.find((x) => x.id === id);
    if (n) { setSize(n.size); if (n.scale) setScale(n.scale); setSetup({ ...n.plot }); setPrinter(n.printer ?? PDF_PRINTER); }
  };
  const edit = (f: () => void) => { f(); setSetupId(''); };
  const plotted = () => sheetWith(project, sheet.id, { size, ...(plan ? { scale: `1:${scale}` } : {}), plot: { ...setup, named: setupId || undefined } });
  async function go() {
    const p = plotted();
    if (keep) onChange(p, `Page setup of ${sheet.number} saved · ⌘Z to undo`);
    setBusy(true);
    try { await plotTo(p, run, [sheet.id], { printer, copies }, onStatus); } finally { setBusy(false); }
    onClose();
  }
  return (<>
    <Modal onClose={onClose} className="modal" style={{ maxWidth: 520 }} label="Plot">
      <h3>Plot <span className="m">{sheet.number} · {sheet.title}</span></h3>
      <div className="cad-devform">
        <PrinterSelect value={printer} onChange={setPrinter} list={printers.list} />
        <label>Page setup<select aria-label="Page setup" value={setupId} onChange={(e) => pick(e.target.value)}>
          <option value="">This sheet's own</option>{setups.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select></label>
        <label>Paper<select aria-label="Paper" value={size} onChange={(e) => edit(() => setSize(e.target.value as DrawingSheet['size']))}>{SIZES.map((z) => <option key={z} value={z}>{sizeLabel(z)}</option>)}</select></label>
        {plan && <label>Scale<select aria-label="Scale" value={scale} onChange={(e) => edit(() => setScale(Number(e.target.value)))}>{SCALES.map((k) => <option key={k} value={k}>1:{k}</option>)}</select></label>}
        <label>Pen table<select aria-label="Pen table" value={setup.pens ?? tables[0].id} onChange={(e) => edit(() => setSetup({ ...setup, pens: e.target.value }))}>{tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {printer && <label>Copies<input aria-label="Copies" type="number" min={1} max={99} value={copies} onChange={(e) => setCopies(Math.min(99, Math.max(1, Math.round(Number(e.target.value)) || 1)))} /></label>}
        <label><input type="checkbox" checked={setup.weights !== 'thin'} onChange={(e) => edit(() => setSetup({ ...setup, weights: e.target.checked ? undefined : 'thin' }))} /> Print lineweights (from the pen table)</label>
        <label><input type="checkbox" checked={!!setup.stamp} onChange={(e) => edit(() => setSetup({ ...setup, stamp: e.target.checked }))} /> Plot stamp in the margin</label>
        <label><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep these as the sheet's page setup</label>
        <span className="m">Printing is always black-and-white.{printer && !canPrint() ? ' Printers need the desktop app.' : ''}</span>
      </div>
      <div className="modal-actions">
        <button className="chip" onClick={onClose}>Cancel</button>
        {canPreviewSheetPdf() && drawable(sheet) && <button className="chip" onClick={() => setPreview(plotted())}>Preview</button>}
        <span className="sp" />
        <button className="chip primary" disabled={busy || !drawable(sheet) || (!!printer && !canPrint())} onClick={() => void go()}>{busy ? 'Plotting…' : printer ? 'Print' : 'Plot PDF'}</button>
      </div>
    </Modal>
    {preview && <SheetPdfPreview project={preview} sheet={sheet} run={run} onClose={() => setPreview(undefined)} />}
  </>);
}

const blankSetup = (p: Project): NamedSetup => ({ id: nextId(p.plot?.setups, 'ps'), name: 'New page setup', size: 'A3', scale: 100, plot: {} });

/** Page setups: the project's named page setups; made, edited, deleted and applied to many sheets at once. Sheets a
 * setup was applied to follow it when it is edited. */
export function PageSetupsDialog({ project, current, onChange, onStatus, onClose }: {
  project: Project; /** The open sheet, ticked first when applying. */ current?: string;
  onChange: (next: Project, message: string) => void; onStatus?: (m: string) => void; onClose: () => void;
}) {
  const printers = usePrinters();
  const setups = setupsOf(project), tables = tablesOf(project), sheets = setOf(project).sheets;
  const [draft, setDraft] = useState<NamedSetup | undefined>(setups[0]);
  const [applying, setApplying] = useState<Set<string>>();
  const [lib, setLib] = useState(loadSetupLibrary);
  const [libPick, setLibPick] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const fresh = lib.setups.filter((n) => !setups.some((x) => x.name.toLowerCase() === n.name.toLowerCase()));
  const libName = fresh.some((n) => n.name === libPick) ? libPick : fresh[0]?.name ?? '';
  const saved = draft && setups.some((n) => n.id === draft.id);
  const users = draft ? setupUsers(project, draft.id) : [];
  const set = (patch: Partial<NamedSetup>) => draft && setDraft({ ...draft, ...patch });
  return (
    <Modal onClose={onClose} className="modal" style={{ maxWidth: 640 }} label="Page setups">
      <h3>Page setups <span className="m">this project</span></h3>
      <table className="sched" aria-label="Named page setups">
        <thead><tr><th>Name</th><th>Paper</th><th>Scale</th><th>Pens</th><th>Printer</th><th>Used by</th></tr></thead>
        <tbody>{setups.length ? setups.map((n) => (
          <tr key={n.id} onClick={() => { setDraft(n); setApplying(undefined); }} aria-selected={draft?.id === n.id} style={{ cursor: 'pointer', fontWeight: draft?.id === n.id ? 600 : undefined }}>
            <td>{n.name}</td><td>{n.size === 'auto' ? 'Auto' : n.size}</td><td>{n.scale ? `1:${n.scale}` : '—'}</td>
            <td>{tables.find((t) => t.id === n.plot.pens)?.name ?? tables[0].name}</td><td>{printerLabel(n.printer ?? '', printers.list)}</td><td>{setupUsers(project, n.id).length}</td>
          </tr>
        )) : <tr><td colSpan={6} className="m">No named page setups yet: New makes one.</td></tr>}</tbody>
      </table>
      {!applying && <div className="cad-devbtns">
        <button className="chip" disabled={!saved} onClick={() => { if (!draft) return; saveToSetupLibrary(setupsFile(project, [draft.id])); setLib(loadSetupLibrary()); onStatus?.(`Page setup ${draft.name} saved to your library`); }}>Save to library</button>
        {fresh.length > 0 && <>
          <select aria-label="Library page setups" value={libName} onChange={(e) => setLibPick(e.target.value)}>{fresh.map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}</select>
          <button className="chip" onClick={() => { const n = fresh.find((x) => x.name === libName); if (n) onChange(importSetups(project, { kind: 'lvds.pageSetups', setups: [n], tables: lib.tables }).project, `Page setup ${n.name} added from your library · ⌘Z to undo`); }}>Add from library</button>
        </>}
      </div>}
      {draft && !applying && <div className="cad-devform">
        <label>Name<input aria-label="Setup name" value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>Paper<select aria-label="Paper" value={draft.size} onChange={(e) => set({ size: e.target.value as NamedSetup['size'] })}>{SIZES.map((z) => <option key={z} value={z}>{sizeLabel(z)}</option>)}</select></label>
        <label>Scale (plans)<select aria-label="Scale" value={draft.scale ?? 100} onChange={(e) => set({ scale: Number(e.target.value) })}>{SCALES.map((k) => <option key={k} value={k}>1:{k}</option>)}</select></label>
        <label>Pen table<select aria-label="Pen table" value={draft.plot.pens ?? tables[0].id} onChange={(e) => set({ plot: { ...draft.plot, pens: e.target.value } })}>{tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <PrinterSelect value={draft.printer ?? ''} onChange={(v) => set({ printer: v || undefined })} list={printers.list} />
        <label><input type="checkbox" checked={draft.plot.weights !== 'thin'} onChange={(e) => set({ plot: { ...draft.plot, weights: e.target.checked ? undefined : 'thin' } })} /> Print lineweights (from the pen table)</label>
        <label><input type="checkbox" checked={!!draft.plot.stamp} onChange={(e) => set({ plot: { ...draft.plot, stamp: e.target.checked } })} /> Plot stamp in the margin</label>
        {saved && <span className="m">{users.length ? `${users.length} sheet${users.length === 1 ? '' : 's'} follow this setup: saving changes them too.` : 'No sheet uses this setup yet: Apply to… gives it to sheets.'}</span>}
      </div>}
      {draft && applying && <>
        <p className="m">Apply {draft.name} to the sheets ticked: their paper, scale (plans) and pens.</p>
        <div className="pub-list" role="group" aria-label="Sheets">
          {sheets.map((x) => <label key={x.id}><input type="checkbox" checked={applying.has(x.id)} onChange={(e) => { const n = new Set(applying); if (e.target.checked) n.add(x.id); else n.delete(x.id); setApplying(n); }} /> {x.number} · {x.title}</label>)}
        </div>
      </>}
      <div className="modal-actions">
        <button className="chip" onClick={onClose}>Close</button>
        <button className="chip" onClick={() => { setDraft(blankSetup(project)); setApplying(undefined); }}>New</button>
        {saved && !applying && <button className="chip" onClick={() => { onChange(withoutSetup(project, draft!.id), `Page setup ${draft!.name} deleted; its sheets keep their settings · ⌘Z to undo`); setDraft(undefined); }}>Delete</button>}
        {!applying && <>
          <button className="chip" onClick={() => file.current?.click()}>Import…</button>
          <input ref={file} type="file" accept=".json,.dss" aria-label="Page setup file" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            let found: ReturnType<typeof readSetups>;
            try { found = readSetups(JSON.parse(await f.text())); } catch { found = undefined; }
            if (!found) { onStatus?.('That file holds no page setups'); return; }
            const { project: next, added, kept } = importSetups(project, found);
            onChange(next, `${added.length} page setup(s) imported${kept.length ? `; ${kept.length} of the same name left as ${kept.length === 1 ? 'it is' : 'they are'}` : ''} · ⌘Z to undo`);
          }} />
          <button className="chip" disabled={!setups.length} onClick={async () => { const m = await saveText(`${safeFileName(project.name)} page setups.json`, JSON.stringify(setupsFile(project), null, 2), 'Page setups', 'json'); if (m) onStatus?.(m); }}>Export…</button>
        </>}
        <span className="sp" />
        {saved && !applying && <button className="chip" onClick={() => setApplying(new Set([...users.map((x) => x.id), ...(current ? [current] : [])]))}>Apply to…</button>}
        {applying && <button className="chip" onClick={() => setApplying(undefined)}>Back</button>}
        {applying && <button className="chip primary" disabled={!applying.size} onClick={() => { onChange(applySetup(project, draft!.id, [...applying]), `${draft!.name} applied to ${applying.size} sheet(s) · ⌘Z to undo`); setApplying(undefined); }}>Apply to {applying.size}</button>}
        {draft && !applying && <button className="chip primary" disabled={!draft.name.trim()} onClick={() => onChange(withSetup(project, { ...draft, name: draft.name.trim() }), `Page setup ${draft.name.trim()} saved · ⌘Z to undo`)}>Save</button>}
      </div>
    </Modal>
  );
}

/** Printers: the computer's printers and the built-in PDF, and the one plots go to on this computer. */
export function PrintersDialog({ onStatus, onClose }: { onStatus: (m: string) => void; onClose: () => void }) {
  const printers = usePrinters();
  const [chosen, setChosen] = useState(plotPrinter());
  const rows: PrinterInfo[] = [{ name: PDF_PRINTER, displayName: 'PDF (built in)', isDefault: false }, ...printers.list];
  return (
    <Modal onClose={onClose} className="modal" style={{ maxWidth: 520 }} label="Printers">
      <h3>Printers <span className="m">this computer</span></h3>
      <table className="sched" aria-label="Printers">
        <thead><tr><th>Plots go to</th><th>Printer</th><th>System default</th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.name || 'pdf'}>
            <td><input type="radio" name="plot-printer" aria-label={`Plot to ${p.displayName}`} checked={chosen === p.name} onChange={() => setChosen(p.name)} /></td>
            <td>{p.displayName}</td><td>{p.isDefault ? 'Yes' : ''}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="m">{!canPrint() ? 'Printers need the desktop app; plots go to PDF.' : printers.loaded && !printers.list.length ? 'No printers are installed on this computer; plots go to PDF.' : 'The printers installed on this computer (the app stays offline). Paper sizes come from each sheet; a printer that cannot take A1 or A2 prints on its largest paper.'}</p>
      <div className="modal-actions">
        <button className="chip" onClick={onClose}>Cancel</button>
        <span className="sp" />
        <button className="chip primary" onClick={() => { setPlotPrinter(chosen); onStatus(`Plots go to ${printerLabel(chosen, printers.list)}`); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

type Row = { sheet: string; setup?: string; on: boolean };
const rowsOf = (sheets: DrawingSheet[], list?: BatchList): Row[] => {
  const listed = (list?.rows ?? []).filter((r) => sheets.some((s) => s.id === r.sheet)).map((r) => ({ ...r, on: true }));
  return [...listed, ...sheets.filter((s) => !listed.some((r) => r.sheet === s.id)).map((s) => ({ sheet: s.id, on: !list && drawable(s) }))];
};

/** Batch plot: many layouts and sheets in one run, each with its page setup, to one PDF, a PDF each or a printer. The
 * list can be saved with the project and run again. */
export function BatchPlotDialog({ project, run, onChange, onStatus, onClose }: {
  project: Project; run?: CalcRun;
  onChange: (next: Project, message: string) => void; onStatus: (m: string) => void; onClose: () => void;
}) {
  const printers = usePrinters();
  const sheets = setOf(project).sheets, setups = setupsOf(project), lists = batchesOf(project);
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  const list = lists.find((b) => b.id === listId);
  const [name, setName] = useState(list?.name ?? 'Batch 1');
  const [rows, setRows] = useState<Row[]>(() => rowsOf(sheets, list));
  const [output, setOutput] = useState<BatchList['output']>(list?.output ?? 'one');
  const [printer, setPrinter] = useState(list?.printer ?? plotPrinter());
  const [copies, setCopies] = useState(list?.copies ?? 1);
  const [busy, setBusy] = useState(false);
  const choose = (id: string) => {
    const b = lists.find((x) => x.id === id);
    setListId(id); setName(b?.name ?? `Batch ${lists.length + 1}`); setRows(rowsOf(sheets, b)); setOutput(b?.output ?? 'one'); setPrinter(b?.printer ?? plotPrinter()); setCopies(b?.copies ?? 1);
  };
  const on = rows.filter((r) => r.on);
  const byId = (id: string) => sheets.find((s) => s.id === id)!;
  const patchRow = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setRows(n); };
  const toSave = (): BatchList => ({ id: listId || nextId(project.plot?.batches, 'bp'), name: name.trim() || 'Batch', rows: on.map(({ sheet, setup }) => (setup ? { sheet, setup } : { sheet })), output, ...(output === 'printer' ? { printer, copies } : {}) });
  async function go() {
    const ids = on.map((r) => r.sheet).filter((id) => drawable(byId(id)));
    setBusy(true);
    try { await plotTo(projectForBatch(project, on), run, ids, { printer: output === 'printer' ? printer : PDF_PRINTER, copies, each: output === 'each' }, onStatus); } finally { setBusy(false); }
  }
  const printable = on.filter((r) => drawable(byId(r.sheet))).length;
  return (
    <Modal onClose={onClose} className="modal" style={{ maxWidth: 720 }} label="Batch plot">
      <h3>Batch plot</h3>
      <div className="cad-devform">
        <label>List<select aria-label="Saved list" value={listId} onChange={(e) => choose(e.target.value)}>
          <option value="">New list</option>{lists.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>
        <label>Name<input aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table className="sched" aria-label="Sheets to plot">
          <thead><tr><th /><th>Layout / sheet</th><th>Page setup</th><th>Check</th><th>Order</th></tr></thead>
          <tbody>{rows.map((r, i) => { const s = byId(r.sheet); return (
            <tr key={r.sheet}>
              <td><input type="checkbox" aria-label={`Plot ${s.number}`} checked={r.on} onChange={(e) => patchRow(i, { on: e.target.checked })} /></td>
              <td>{s.number} · {s.title}</td>
              <td><select aria-label={`Page setup of ${s.number}`} value={r.setup ?? ''} onChange={(e) => patchRow(i, { setup: e.target.value || undefined })}>
                <option value="">The sheet's own</option>{setups.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select></td>
              <td className="m">{drawable(s) ? 'ok' : 'nothing to print'}</td>
              <td><button className="chip" aria-label={`Move ${s.number} up`} disabled={!i} onClick={() => move(i, -1)}>↑</button><button className="chip" aria-label={`Move ${s.number} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button></td>
            </tr>
          ); })}</tbody>
        </table>
      </div>
      <div className="cad-devform">
        <label>Output<select aria-label="Output" value={output} onChange={(e) => setOutput(e.target.value as BatchList['output'])}>
          <option value="one">One PDF for all</option><option value="each">A PDF for each sheet</option>{canPrint() && <option value="printer">A printer</option>}
        </select></label>
        {output === 'printer' && <PrinterSelect value={printer} onChange={setPrinter} list={printers.list.length ? printers.list : []} />}
        {output === 'printer' && <label>Copies<input aria-label="Copies" type="number" min={1} max={99} value={copies} onChange={(e) => setCopies(Math.min(99, Math.max(1, Math.round(Number(e.target.value)) || 1)))} /></label>}
        <span className="m">Each sheet prints with the page setup on its row, for this run only. Printing is always black-and-white.</span>
      </div>
      <div className="modal-actions">
        <button className="chip" onClick={onClose}>Close</button>
        {list && <button className="chip" onClick={() => { onChange(withoutBatch(project, list.id), `Batch list ${list.name} deleted · ⌘Z to undo`); choose(''); }}>Delete list</button>}
        <span className="sp" />
        <button className="chip" disabled={!on.length} onClick={() => { const b = toSave(); onChange(withBatch(project, b), `Batch list ${b.name} saved · ⌘Z to undo`); setListId(b.id); }}>Save list</button>
        <button className="chip primary" disabled={busy || !printable || (output === 'printer' && !printer)} onClick={() => void go()}>{busy ? 'Plotting…' : `Plot ${printable}`}</button>
      </div>
    </Modal>
  );
}

/** The Output dialog the app has open: Plot on the given sheet, or the others for the whole project. */
export function OutputHost({ which, project, run, sheetId, onChange, onStatus, onClose }: {
  which: OutputDialog; project: Project; run?: CalcRun; sheetId?: string;
  onChange: (next: Project, message: string) => void; onStatus: (m: string) => void; onClose: () => void;
}) {
  const sheet = sheetId ? setOf(project).sheets.find((s) => s.id === sheetId) : undefined;
  useEffect(() => {
    if (which === 'register') { void exportRegister(project, onStatus); onClose(); }
    else if (which === 'plot' && !sheet) { onStatus('Open a layout or sheet first'); onClose(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on opening
  if (which === 'plot') return sheet ? <PlotDialog project={project} sheet={sheet} run={run} onChange={onChange} onStatus={onStatus} onClose={onClose} /> : null;
  if (which === 'setups') return <PageSetupsDialog project={project} current={sheetId} onChange={onChange} onStatus={onStatus} onClose={onClose} />;
  if (which === 'printers') return <PrintersDialog onStatus={onStatus} onClose={onClose} />;
  if (which === 'pens') return <PenTableDialog project={project} onSave={onChange} onClose={onClose} />;
  if (which === 'batch') return <BatchPlotDialog project={project} run={run} onChange={onChange} onStatus={onStatus} onClose={onClose} />;
  return null;
}
