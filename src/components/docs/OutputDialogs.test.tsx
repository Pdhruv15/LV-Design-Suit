// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchPlotDialog, OutputHost, PageSetupsDialog, PlotDialog, PrintersDialog } from './OutputDialogs';
import { sampleProject } from '../../data/sampleProject';
import { setOf, type DrawingSheet } from '../../model/drawingSet';
import { saveToSetupLibrary, setupsFile, setupUsers, withSetup } from '../../model/plotSetup';
import { plotPrinter } from '../../util/printers';
import type { Project } from '../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const render = vi.hoisted(() => ({ exportDrawingSet: vi.fn(async () => {}), printSheets: vi.fn(async () => {}) }));
const files = vi.hoisted(() => ({ saveText: vi.fn(async () => 'Saved x') }));
vi.mock('../../util/files', async (orig) => ({ ...(await orig<typeof import('../../util/files')>()), saveText: files.saveText }));
vi.mock('./sheetRender', () => render);
vi.mock('./SheetPdfPreview', () => ({ canPreviewSheetPdf: () => false, SheetPdfPreview: () => null }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); render.exportDrawingSet.mockClear(); render.printSheets.mockClear(); });

const sheets = [
  { id: 's1', kind: 'system', number: 'E-001', title: 'Main SLD', size: 'A3', boards: ['b1'] },
  { id: 's2', kind: 'board', number: 'E-002', title: 'DB-GF1', size: 'auto', boards: ['b2'] },
  { id: 's3', kind: 'plan', number: 'E-201', title: 'GF Lighting', size: 'auto', scale: '1:100', plan: 'lighting', buildingId: 'V', levelId: 'GF', boards: [] }
] as DrawingSheet[];
const p: Project = { ...sampleProject, plot: undefined, drawingSet: { ...setOf(sampleProject), sheets } };
const a1 = { id: 'ps1', name: 'A1 1:100 PDF', size: 'A1' as const, scale: 100, plot: { stamp: true } };
const choose = (label: string, value: string) => {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement | HTMLInputElement;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
};
const button = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t)!;
const tick = (label: string) => act(() => { (document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement).click(); });
const printers = [{ name: 'Office', displayName: 'Office printer', isDefault: true }];
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('Output → Plot', () => {
  it('a named setup fills paper, scale and pens; plotted to PDF with them, and kept as the sheet\'s only when asked', async () => {
    const q = withSetup(p, a1), onChange = vi.fn();
    act(() => root.render(<PlotDialog project={q} sheet={sheets[2]} onChange={onChange} onStatus={() => {}} onClose={() => {}} />));
    choose('Page setup', 'ps1');
    expect((document.querySelector('[aria-label="Paper"]') as HTMLSelectElement).value).toBe('A1');
    await act(async () => { button('Plot PDF').click(); });
    expect(onChange).not.toHaveBeenCalled();
    const [plotted, , , each, , ids] = render.exportDrawingSet.mock.calls[0] as unknown as [Project, unknown, unknown, boolean, unknown, string[]];
    expect([each, ids]).toEqual([false, ['s3']]);
    expect(setOf(plotted).sheets.find((s) => s.id === 's3')).toMatchObject({ size: 'A1', scale: '1:100', plot: { stamp: true, named: 'ps1' } });
  });

  it('to a printer: copies, and the settings kept as the sheet\'s page setup', async () => {
    vi.stubGlobal('lvds', { files: { printers: async () => printers, printHtml: vi.fn() } });
    const onChange = vi.fn();
    act(() => root.render(<PlotDialog project={p} sheet={sheets[0]} onChange={onChange} onStatus={() => {}} onClose={() => {}} />));
    await flush();
    choose('Printer', 'Office');
    choose('Copies', '3');
    choose('Paper', 'A2');
    act(() => { [...document.querySelectorAll('label')].find((l) => /Keep these/.test(l.textContent ?? ''))!.querySelector('input')!.click(); });
    await act(async () => { button('Print').click(); });
    expect(setOf(onChange.mock.calls[0][0] as Project).sheets[0].size).toBe('A2');
    expect(render.printSheets.mock.calls[0].slice(3, 6)).toEqual([['s1'], 'Office', 3]);
  });
});

describe('Output → Page setups', () => {
  it('new, saved, applied to the sheets ticked; deleting leaves them as they were', () => {
    let q = p;
    const onChange = vi.fn((next: Project) => { q = next; act(() => root.render(<PageSetupsDialog project={q} current="s3" onChange={onChange} onClose={() => {}} />)); });
    act(() => root.render(<PageSetupsDialog project={q} current="s3" onChange={onChange} onClose={() => {}} />));
    act(() => { button('New').click(); });
    choose('Setup name', 'A1 check');
    choose('Paper', 'A1');
    act(() => { button('Save').click(); });
    expect(q.plot?.setups).toEqual([{ id: 'ps1', name: 'A1 check', size: 'A1', scale: 100, plot: {} }]);
    act(() => { button('Apply to…').click(); });
    act(() => { [...document.querySelectorAll('.pub-list label')].find((l) => /E-001/.test(l.textContent ?? ''))!.querySelector('input')!.click(); });
    act(() => { button('Apply to 2').click(); });
    expect(setupUsers(q, 'ps1').map((s) => s.id)).toEqual(['s1', 's3']);
    expect(setOf(q).sheets[2].size).toBe('A1');
    act(() => { button('Delete').click(); });
    expect(q.plot?.setups).toEqual([]);
    expect(setOf(q).sheets[2]).toMatchObject({ size: 'A1', plot: { named: undefined } });
  });
});

describe('Output → Printers', () => {
  it('lists the computer\'s printers beside the built-in PDF and keeps the one plots go to', async () => {
    vi.stubGlobal('lvds', { files: { printers: async () => printers, printHtml: vi.fn() } });
    const onStatus = vi.fn();
    act(() => root.render(<PrintersDialog onStatus={onStatus} onClose={() => {}} />));
    await flush();
    expect([...document.querySelectorAll('tbody tr td:nth-child(2)')].map((t) => t.textContent)).toEqual(['PDF (built in)', 'Office printer']);
    tick('Plot to Office printer');
    act(() => { button('Save').click(); });
    expect(plotPrinter()).toBe('Office');
    expect(onStatus).toHaveBeenCalledWith('Plots go to Office printer');
  });
});

describe('Output → Pen tables', () => {
  it('opens with no sheet open (model space) and saves the table to the project', () => {
    const onChange = vi.fn();
    act(() => root.render(<OutputHost which="pens" project={p} onChange={onChange} onStatus={() => {}} onClose={() => {}} />));
    act(() => { button('Save').click(); });
    expect(onChange.mock.calls[0][1]).toMatch(/^Pen table .* saved/);
  });
});

describe('Output → Batch plot', () => {
  it('the sheets ticked, in the order set, each with its row\'s setup; the list saved with the project', async () => {
    let q = withSetup(p, a1);
    const onChange = vi.fn((next: Project) => { q = next; });
    act(() => root.render(<BatchPlotDialog project={q} onChange={onChange} onStatus={() => {}} onClose={() => {}} />));
    tick('Plot E-002');
    tick('Move E-201 up'); // E-001, E-201, E-002
    choose('Page setup of E-201', 'ps1');
    choose('Output', 'each');
    choose('List name', 'Tender set');
    act(() => { button('Save list').click(); });
    expect(q.plot?.batches).toEqual([{ id: 'bp1', name: 'Tender set', rows: [{ sheet: 's1' }, { sheet: 's3', setup: 'ps1' }], output: 'each' }]);
    await act(async () => { button('Plot 2').click(); });
    const [plotted, set, , each, , ids] = render.exportDrawingSet.mock.calls[0] as unknown as [Project, { sheets: DrawingSheet[] }, unknown, boolean, unknown, string[]];
    expect([each, ids, set.sheets.map((s) => s.id)]).toEqual([true, ['s1', 's3'], ['s1', 's3', 's2']]);
    expect(setOf(plotted).sheets.find((s) => s.id === 's3')!.size).toBe('A1');
    expect(setOf(q).sheets.find((s) => s.id === 's3')!.size).toBe('auto'); // for that run only
  });
});

describe('Output → Page setups: import, export and the library', () => {
  const two = withSetup(withSetup(p, a1), { id: 'ps2', name: 'A3 draft', size: 'A3', scale: 50, plot: {} });
  const setFile = (label: string, text: string) => {
    const input = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => text }] });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  const open = (q: Project, onChange = vi.fn(), onStatus = vi.fn()) => { act(() => root.render(<PageSetupsDialog project={q} onChange={onChange} onStatus={onStatus} onClose={() => {}} />)); return { onChange, onStatus }; };

  it('Export… writes the setups as a file; disabled with none', async () => {
    const { onStatus } = open(two);
    await act(async () => { button('Export…').click(); });
    const [name, text, filter, ext] = files.saveText.mock.calls[files.saveText.mock.calls.length - 1] as unknown as [string, string, string, string];
    expect([name, filter, ext]).toEqual([`${two.name.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '')} page setups.json`, 'Page setups', 'json']);
    expect(JSON.parse(text)).toMatchObject({ kind: 'lvds.pageSetups', setups: [{ id: 'ps1' }, { id: 'ps2' }] });
    expect(onStatus).toHaveBeenCalledWith('Saved x');
    open(p);
    expect((button('Export…') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Import… brings in a file\'s setups (those of the same name stay) and says what it did; a file with none says so', async () => {
    const { onChange, onStatus } = open(p);
    setFile('Page setup file', 'not json');
    await flush();
    expect(onStatus).toHaveBeenLastCalledWith('That file holds no page setups');
    setFile('Page setup file', JSON.stringify(setupsFile(two)));
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    const [next, message] = onChange.mock.calls[0] as unknown as [Project, string];
    expect(next.plot?.setups?.map((x) => x.name)).toEqual(['A1 1:100 PDF', 'A3 draft']);
    expect(message).toBe('2 page setup(s) imported · ⌘Z to undo');
    const { onChange: again } = open(next);
    setFile('Page setup file', JSON.stringify(setupsFile(two)));
    await flush();
    expect((again.mock.calls[0] as unknown as [Project, string])[1]).toBe('0 page setup(s) imported; 2 of the same name left as they are · ⌘Z to undo');
  });

  it('Save to library keeps the setup picked; Add from library offers those the project lacks', async () => {
    const { onStatus } = open(two);
    act(() => { button('Save to library').click(); });
    expect(onStatus).toHaveBeenLastCalledWith('Page setup A1 1:100 PDF saved to your library');
    expect(JSON.parse(localStorage.getItem('lvds.pageSetups')!).setups.map((x: { name: string }) => x.name)).toEqual(['A1 1:100 PDF']);
    expect(document.querySelector('[aria-label="Library page setups"]')).toBeNull(); // the project has it already
    saveToSetupLibrary(setupsFile(two, ['ps2']));
    act(() => root.unmount()); root = createRoot(host);
    const r = open(withSetup(p, a1));
    const opts = [...document.querySelectorAll('[aria-label="Library page setups"] option')].map((o) => o.textContent);
    expect(opts).toEqual(['A3 draft']);
    act(() => { button('Add from library').click(); });
    const [next, message] = r.onChange.mock.calls[r.onChange.mock.calls.length - 1] as unknown as [Project, string];
    expect(next.plot?.setups?.map((x) => x.name)).toEqual(['A1 1:100 PDF', 'A3 draft']);
    expect(message).toBe('Page setup A3 draft added from your library · ⌘Z to undo');
  });
});
