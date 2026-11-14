// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ribbon, { type RibbonActions } from './Ribbon';
import { NO_SHEET_ACTIONS, type SheetUi } from './sld/sheetUi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

const noop = () => {};
type Cad = NonNullable<RibbonActions['cad']>;
const BASE = {
  view: 'cad', onView: noop, tool: 'select', onTool: noop, boardId: 'MDB-1', selectedFeederId: null, selection: null,
  onAddFeeder: noop, onAddBoard: noop, onBoardProperties: noop, onEditSelected: noop, onDeleteSelected: noop, onExportDss: noop, onSettings: noop,
  onUndo: noop, onRedo: noop, canUndo: false, canRedo: false, onRun: noop, staleCount: 0,
  onNew: noop, onSave: noop, onSaveAs: noop, onAnonymizedSample: noop, onProfile: noop, onChooseFolder: noop, folderLabel: 'Folder: Projects',
  dirty: false, recent: [], onOpenRecent: noop, dbIssues: 0, inboxCount: 0,
  onBom: noop, hasPriceList: false, stage: 'detailed', nextStage: 'ifc', ifcIssued: false, onAdvanceStage: noop, route: 'from-ifc', onRoute: noop, onConceptReport: noop
};
const sheetUi = (over: Partial<SheetUi> = {}): SheetUi => ({ tool: 'select', setTool: noop, color: 'black', setColor: noop, size: 3.5, setSize: noop, selId: null, setSelId: noop,
  zoom: 'fit', setZoom: noop, pct: '64 %', setPct: noop, side: false, setSide: noop, actions: { current: NO_SHEET_ACTIONS }, ...over });
const sheets = (over: Partial<NonNullable<RibbonActions['sheets']>> = {}): RibbonActions['sheets'] => ({ tab: 'sheets', open: true, onTab: noop, ui: sheetUi(), kind: 'system',
  publish: { label: 'Rev C…', title: 'Changed since Rev B was issued', changed: true }, legend: { on: true, shown: true }, onLegend: noop, ...over });

/** The ribbon on Design CAD with a drawing open; `over` changes Design CAD's actions, `a` the rest. */
function show(over: Partial<Cad> = {}, a: Partial<RibbonActions> = {}) {
  const cad = {
    tool: 'none', onTool: vi.fn(), onOpen: vi.fn(), onSave: vi.fn(), onSaveDwg: vi.fn(), onClose: vi.fn(), onDelete: noop, hasSelection: false, onLayers: noop, layersOn: true, hasDrawing: true,
    file: { plans: [{ label: 'Ground floor · gf.dwg', title: 'Open gf.dwg', onClick: vi.fn() }], level: 'Ground floor', levelTitle: 'The level', levels: [{ label: 'Ground floor', title: '', onClick: noop }], unit: 'mm', unitTitle: 'The units', units: [{ label: 'Millimetres ✓', title: '', onClick: noop }] },
    onRoles: noop, rolesOn: false, onAddFound: noop, onSchedules: noop, onPlaceBoard: noop, placingBoard: false, onCoverage: noop, coverageOn: false, copyLevels: [], onWireAll: noop, onTags: noop, tagsOn: false,
    onCommand: vi.fn(), onLayoutCmd: vi.fn(), onLabels: vi.fn(), onProps: vi.fn(), onLayerManager: vi.fn(), onSetProps: vi.fn(), info: INFO, ...over
  } as Cad;
  let props = { ...BASE, cad, ...a } as unknown as RibbonActions;
  act(() => root.render(<Ribbon tab="cad" onTab={noop} a={props} />));
  return { cad, rerender: (more: Partial<Cad> = {}, moreA: Partial<RibbonActions> = {}) => { props = { ...props, ...moreA, cad: { ...props.cad!, ...more } }; act(() => root.render(<Ribbon tab="cad" onTab={noop} a={props} />)); } };
}
const tab = (label: string) => [...document.querySelectorAll('[aria-label="Design CAD"] [role="tab"]')].find((b) => b.textContent === label) as HTMLButtonElement;
const pick = (label: string) => act(() => { tab(label).click(); });
const selected = () => document.querySelector('[aria-label="Design CAD"] [aria-selected="true"]')!.textContent;
/** The groups shown, in order, and the tools (their names) in one. */
const groups = () => [...document.querySelectorAll('#ribbon-tools > [role="group"]')].sort((x, y) => Number((x as HTMLElement).style.order) - Number((y as HTMLElement).style.order)).map((g) => g.getAttribute('aria-label'));
const group = (name: string) => document.querySelector(`[role="group"][aria-label="${name}"]`) as HTMLElement;
const tools = (name: string) => [...group(name).querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label'));
const tool = (name: string) => document.querySelector(`#ribbon-tools button[aria-label="${name}"]`) as HTMLButtonElement;
/** Every tool shown, by name (icons only: its name for screen readers; with labels: the name under it). */
const names = () => [...document.querySelectorAll('#ribbon-tools button')].map((b) => b.getAttribute('aria-label') ?? b.querySelector('span')?.textContent).filter((x): x is string => !!x);
const DRAFTING = ['Draw', 'Modify', 'Blocks', 'Layers', 'Properties', 'Measure and view'];
const ELEC = 'Electrical, ELV & sheets';
/** The drawing's layers as the page tells the ribbon: two drawn layers, one frozen; nothing picked. */
const INFO = { blocks: ['DB-A', 'DB-B'], layers: [{ name: 'LV-SKETCH', color: '#ffffff', on: true, freeze: false, lock: false }, { name: 'E-POWER', color: '#00ffff', on: false, freeze: false, lock: true }, { name: 'E-OLD', on: true, freeze: true, lock: false }], current: 'LV-SKETCH', picked: 0, props: {} };
/** A split tool's arrow, then an item of its list. */
const fromList = (tool: string, item: string) => { click(document.querySelector(`#ribbon-tools button[title="${tool}: more options"]`)!); click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === item)!); };
const click = (b: Element) => act(() => { (b as HTMLButtonElement).click(); });
const fileButton = () => document.querySelector('.ribbon-file > button') as HTMLButtonElement;
const items = () => [...document.querySelectorAll('[role="menu"][aria-label="File"] > button, [role="menu"][aria-label="File"] > .ribbon-file-sub > button')].map((b) => b.querySelector('span')!.textContent);
const item = (label: string) => [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.querySelector('span')?.textContent ?? b.textContent) === label) as HTMLButtonElement;

describe('Design CAD ribbon: sub-tabs by use', () => {
  it('opens on Drafting the first time, then on the sub-tab used last; a running tool shows its sub-tab', () => {
    show();
    expect(selected()).toBe('LVCAD');
    pick(ELEC);
    expect(localStorage.getItem('lvds.cadSub')).toBe('elec');
    act(() => root.unmount());
    root = createRoot(host);
    const again = show();
    expect(selected()).toBe(ELEC);
    again.rerender({ tool: 'text' });
    expect(selected()).toBe('Annotate'); // Text is on Annotate, the sub-tab beside LVCAD
    again.rerender({ tool: 'line' });
    expect(selected()).toBe('LVCAD');
    again.rerender({ tool: 'tray' });
    expect(selected()).toBe(ELEC);
    localStorage.setItem('lvds.cadSub', 'page'); // a sub-tab of v2.053: the one with the sheet set now
    act(() => root.unmount());
    root = createRoot(host);
    show();
    expect(selected()).toBe(ELEC);
    pick('Annotate');
    expect(localStorage.getItem('lvds.cadSub')).toBe('annotate');
  });

  it('has the drafting panels in the order the user chose, Annotate on its own sub-tab; with labels the panels take six sub-tabs; each tool is on one', () => {
    const { rerender } = show();
    expect(['Draw', 'Measure and view'].map(tools)).toEqual([['Line', 'Polyline', 'Circle', 'Arc', 'Hatch', 'Rectangle', 'Polygon', 'Ellipse'],
      ['Distance', 'Area', 'Room area', 'Inspect', 'Zoom extents', 'Drafting settings']]);
    expect(group('Annotate')).toBeNull(); // the LVCAD row had grown wider than a laptop's window
    pick('Annotate');
    expect(tools('Annotate')).toEqual(['Text', 'Dimension', 'Leader', 'Room tag', 'Keynote', 'North arrow', 'Revision cloud', 'Text style', 'Dim style']);
    expect(document.querySelector('.ribbon')!.className).toContain('small-named'); // named beside their icons, as on LVCAD
    const look = (subTabs: string[]) => {
      const seen: string[] = [];
      const panels: Record<string, (string | null)[]> = {};
      for (const label of subTabs) { pick(label); panels[label] = groups(); seen.push(...names()); }
      expect(seen.filter((x, i) => seen.indexOf(x) !== i)).toEqual([]); // no tool twice
      return { panels, seen };
    };
    const shown = look(['LVCAD', 'Annotate', ELEC, 'Output']);
    expect(shown.panels).toEqual({ LVCAD: DRAFTING, Annotate: ['Annotate'], [ELEC]: ['Rooms', 'Cables and boards', 'Devices', 'Edit devices', 'Wiring', 'Reference', 'Sheet set'], Output: ['Layout', 'Plot', 'Publish', 'Export'] });
    expect(shown.seen).not.toContain('Object snap'); // the status bar's toggles stay on the status bar
    rerender({ labels: true });
    const all = look(['LVCAD', 'Annotate', 'Layers & properties', 'Electrical & ELV', 'Sheets', 'Layout', 'Output']);
    expect(all.panels).toEqual({
      LVCAD: ['Draw', 'Modify', 'Blocks'], Annotate: ['Annotate'], 'Layers & properties': ['Layers', 'Properties', 'Measure and view'],
      'Electrical & ELV': ['Rooms', 'Cables and boards', 'Devices', 'Edit devices', 'Wiring'], Sheets: ['Reference', 'Sheet set'], Layout: ['Layout'], Output: ['Plot', 'Publish', 'Export']
    });
    expect([...all.seen].sort()).toEqual([...shown.seen].sort()); // the same tools, only arranged otherwise
    // The place is kept: Layers & properties with labels is Drafting as shown, and back.
    pick('Layers & properties');
    rerender({ labels: false });
    expect(selected()).toBe('LVCAD');
    rerender({ labels: true });
    expect(selected()).toBe('Layers & properties');
  });

  it('runs each tool\'s command; a tool\'s other forms are under its arrow, the panel\'s less used tools under its caption', () => {
    const { cad } = show();
    click(tool('Offset'));
    expect(cad.onTool).toHaveBeenLastCalledWith('offset');
    for (const [t, id] of [['Extend', 'extend'], ['Chamfer', 'chamfer'], ['Break', 'break'], ['Join', 'join'], ['Polygon', 'polygon'], ['Distance', 'dist'], ['Area', 'area'], ['Room area', 'room']]) {
      click(tool(t));
      expect(cad.onTool, t).toHaveBeenLastCalledWith(id);
    }
    // The other forms of Circle and Arc are under their arrows.
    for (const [t, form, id] of [['Circle', '2 points', 'circle2p'], ['Circle', '3 points', 'circle3p'], ['Circle', 'Centre, diameter', 'circled'], ['Arc', 'Start, centre, end', 'arcsce']]) {
      fromList(t, form);
      expect(cad.onTool, form).toHaveBeenLastCalledWith(id);
    }
    click(tool('Ellipse'));
    expect(cad.onTool).toHaveBeenLastCalledWith('ellipse');
    // Annotate: Keynote and Revision cloud; the other forms of Text and Dimension under their arrows.
    pick('Annotate');
    for (const [t, id] of [['Keynote', 'keynote'], ['Revision cloud', 'revcloud']]) {
      click(tool(t));
      expect(cad.onTool, t).toHaveBeenLastCalledWith(id);
    }
    for (const [t, form, id] of [['Text', 'Notes (MT)', 'mtext'], ['Text', 'Numbered text (TCOUNT)', 'tcount'], ['Text', 'Justify (TJ)', 'tjust'], ['Text', 'Copy words (TCOPY)', 'tcopy'], ['Dimension', 'Linear (DLI)', 'dimlin']]) {
      fromList(t, form);
      expect(cad.onTool, form).toHaveBeenLastCalledWith(id);
    }
    for (const t of ['Text style', 'Dim style']) click(tool(t));
    pick('LVCAD');
    for (const t of ['Inspect', 'Zoom extents', 'Drafting settings']) click(tool(t));
    for (const t of ['Off', 'Freeze', 'Lock', 'Isolate', 'Make current', 'All on', 'Thaw all', 'Unlock', 'Unisolate']) click(tool(t));
    click(document.querySelector('button[title="More layers tools: Layer roles, New layer, Layers panel"]')!);
    click(item('New layer'));
    pick(ELEC);
    click(tool('Attach'));
    click(tool('Clip'));
    expect((cad.onCommand as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['STYLE', 'DIMSTYLE', 'LIST', 'FIT', 'DSETTINGS', 'LAYOFF', 'LAYFRZ', 'LAYLCK', 'LAYISO', 'LAYMCUR', 'LAYON', 'LAYTHW', 'LAYULK', 'LAYUNISO', 'LAYER N', 'XATTACH', 'XCLIP']);
    pick('Output');
    const layout = tool('New layout');
    expect(layout.getAttribute('aria-haspopup')).toBe('menu');
    click(layout);
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.querySelector('span')?.textContent ?? b.textContent)).toEqual(['New layout', 'From template…', 'Lighting layout', 'Power layout', 'ELV layout', 'Containment layout']);
    for (const [label, cmd] of [['New layout', 'LAYOUT'], ['From template…', 'LAYOUT T'], ['Power layout', 'LAYOUT POWER']]) {
      if (label !== 'New layout') click(tool('New layout'));
      click(item(label));
      expect(cad.onLayoutCmd, label).toHaveBeenLastCalledWith(cmd);
    }
    expect(tool('Plot').disabled).toBe(true); // no layout or sheet open
    expect(tool('Page setup').disabled).toBe(true); // nor a layout showing
    expect(tool('Save as template').disabled).toBe(true);
  });

  it('shows the current layer and lists the drawn layers to make another current (not a frozen one)', () => {
    const { cad } = show();
    const list = document.querySelector('.ribbon-layer') as HTMLButtonElement;
    expect(list.querySelector('.nm')!.textContent).toBe('LV-SKETCH');
    click(list);
    const rows = [...document.querySelectorAll('[role="menu"][aria-label="Layers"] [role="menuitemradio"]')] as HTMLButtonElement[];
    expect(rows.map((b) => [b.textContent, b.getAttribute('aria-checked'), b.disabled])).toEqual([['LV-SKETCH', 'true', false], ['E-POWER', 'false', false], ['E-OLD', 'false', true]]);
    click(rows[1]);
    expect(cad.onCommand).toHaveBeenLastCalledWith('CLAYER E-POWER');
    click(list);
    click(item('Layer palette… (LM)'));
    expect(cad.onLayerManager).toHaveBeenCalledTimes(1);
  });

  it('sets the colour, linetype and lineweight of new objects, or of the objects picked; the palette from beside the caption', () => {
    const { cad, rerender } = show();
    const lt = document.querySelector('select[aria-label="Linetype of new objects"]') as HTMLSelectElement;
    expect(lt.value).toBe('');
    act(() => { lt.value = 'dashed'; lt.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(cad.onSetProps).toHaveBeenLastCalledWith({ lt: 'dashed' });
    rerender({ info: { ...INFO, picked: 2, props: { lw: 'varies', lt: 'center' } } });
    const lw = document.querySelector('select[aria-label="Lineweight of the 2 objects picked"]') as HTMLSelectElement;
    expect(lw.value).toBe('__varies');
    expect((document.querySelector('select[aria-label="Linetype of the 2 objects picked"]') as HTMLSelectElement).value).toBe('center');
    act(() => { lw.value = ''; lw.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(cad.onSetProps).toHaveBeenLastCalledWith({ lw: undefined }); // ByLayer
    const launch = document.querySelector('.ribbon-launch') as HTMLButtonElement;
    expect(launch.getAttribute('aria-pressed')).toBe('false');
    click(launch);
    expect(cad.onProps).toHaveBeenCalledTimes(1);
  });
});

describe('Design CAD ribbon: the main tools named, every tool\'s name on hover', () => {
  it('shows a tool\'s name, command and what it does after a short rest, and hides it when the mouse leaves', () => {
    vi.useFakeTimers();
    show();
    const offset = tool('Offset');
    expect(offset.textContent).toBe('Offset'); // a small tool on Drafting: its name beside the icon
    expect(tool('Line').textContent).toBe('Line'); // a main tool: its name under it
    act(() => { offset.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(399); });
    expect(document.querySelector('#ribbon-tip')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    const tip = document.querySelector('#ribbon-tip')!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.querySelector('b')!.textContent).toBe('Offset (O)');
    expect(tip.textContent).toBe('Offset (O)The distance on the right, click the object, then the side; a tray is copied as a tray of the same width and route');
    expect(offset.getAttribute('aria-describedby')).toBe('ribbon-tip');
    act(() => { offset.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    expect(document.querySelector('#ribbon-tip')).toBeNull();
  });

  it('shows the tooltip of a greyed tool too; running along the icons, the next shows at once', () => {
    vi.useFakeTimers();
    show({ hasDrawing: false });
    const line = tool('Line'), pline = tool('Polyline');
    expect(line.disabled).toBe(true); // no drawing open
    act(() => { line.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(document.querySelector('#ribbon-tip b')!.textContent).toBe('Line (L)');
    act(() => { line.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: pline })); });
    act(() => { pline.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: line })); });
    expect(document.querySelector('#ribbon-tip b')!.textContent).toBe('Polyline (PL)'); // no wait
    act(() => { pline.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(600); }); // a pause: the next waits again
    act(() => { line.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(document.querySelector('#ribbon-tip')).toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    expect(document.querySelector('#ribbon-tip b')!.textContent).toBe('Line (L)');
  });

  it('Show labels names every tool; three small tools to a column either way', () => {
    const { cad, rerender } = show();
    const box = document.querySelector('.ribbon-labels input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    act(() => { box.click(); });
    expect(cad.onLabels).toHaveBeenLastCalledWith(true);
    rerender({ labels: true });
    const cols = () => [...group('Modify').querySelectorAll('.ribbon-stack')].map((c) => [...c.querySelectorAll('button')].filter((b) => !b.classList.contains('ribbon-split-arrow')).map((b) => b.getAttribute('aria-label') ?? b.querySelector('span')?.textContent));
    expect(cols()).toEqual([['Move', 'Copy', 'Stretch'], ['Rotate', 'Mirror', 'Scale'], ['Trim', 'Extend', 'Break'], ['Fillet', 'Chamfer', 'Join'], ['Offset', 'Array', 'Explode'], ['Erase']]);
    expect(group('Modify').querySelector('button[title^="Offset (O)"]')).not.toBeNull();
    rerender({ labels: false });
    expect(cols()).toEqual([['Move', 'Copy', 'Stretch'], ['Rotate', 'Mirror', 'Scale'], ['Trim', 'Extend', 'Break'], ['Fillet', 'Chamfer', 'Join'], ['Offset', 'Array', 'Explode'], ['Erase']]);
    expect(group('Modify').querySelector('button[title^="Offset (O)"]')).toBeNull(); // the app's own tooltip instead
  });
});

describe('Design CAD ribbon: File', () => {
  const sub = (label: string) => document.querySelector(`[role="menu"][aria-label="${label}"]`);
  const subItems = (label: string) => [...sub(label)!.querySelectorAll('button')].map((b) => b.textContent);
  const hover = (label: string) => act(() => { item(label).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });

  it('holds New, Open, Close, Save, Save As, Export and Publish; greyed with no drawing but New, Open and Publish', () => {
    const { cad } = show({ hasDrawing: false, onNew: vi.fn(), onSaveAs: vi.fn(), onExport: vi.fn(), onPublish: vi.fn(), onCloseOthers: vi.fn() });
    click(fileButton());
    expect(items()).toEqual(['New', 'Open', 'Close', 'Save', 'Save As…', 'Export', 'Publish…']);
    const off = ['Close', 'Save', 'Save As…', 'Export'];
    for (const label of items()) expect(item(label!).disabled, label!).toBe(off.includes(label!));
    click(item('New'));
    expect(cad.onNew).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"][aria-label="File"]')).toBeNull();
  });

  it('runs what is picked and closes; Open, Close and Export are lists beside it; Esc closes it, not the command', () => {
    const { cad } = show({ reopen: { label: 'Reopen gf.dwg', title: 'Open it again', onClick: vi.fn() }, onSaveAs: vi.fn(), onExport: vi.fn(), onPublish: vi.fn(), onCloseOthers: vi.fn() });
    click(fileButton());
    hover('Open');
    expect(subItems('Open')).toEqual(['Drawing file… (DWG / DXF)', 'Reopen gf.dwg', 'Ground floor · gf.dwg']);
    click(item('Ground floor · gf.dwg'));
    expect(cad.file.plans![0].onClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"][aria-label="File"]')).toBeNull();
    click(fileButton());
    hover('Close');
    expect(subItems('Close')).toEqual(['This drawing', 'All drawings', 'All but this one']);
    click(item('All drawings'));
    expect(cad.onCommand).toHaveBeenLastCalledWith('CLOSEALL');
    click(fileButton()); hover('Close'); click(item('All but this one'));
    expect(cad.onCloseOthers).toHaveBeenCalledTimes(1);
    click(fileButton()); click(item('Save'));
    expect(cad.onSave).toHaveBeenCalledTimes(1);
    click(fileButton()); click(item('Save As…'));
    expect(cad.onSaveAs).toHaveBeenCalledTimes(1);
    click(fileButton()); click(item('Publish…'));
    expect(cad.onPublish).toHaveBeenCalledTimes(1);
    click(fileButton());
    hover('Export');
    expect(subItems('Export')).toEqual(['PDF of this view…', 'PDF of this layout…', 'Image (PNG)…', 'Selected objects as DXF…', 'Device list (Excel)…', 'Cable route lengths (Excel)…', 'Block attributes (Excel)…']);
    expect(item('PDF of this layout…').disabled).toBe(true); // no layout tab showing
    click(item('Device list (Excel)…'));
    expect(cad.onExport).toHaveBeenLastCalledWith('devices');
    click(fileButton());
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(esc); });
    expect(esc.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"][aria-label="File"]')).toBeNull();
  });
});

describe('Design CAD ribbon: sheets and layouts', () => {
  it('Output: plot and publish one sheet or many, and export; the project-wide tools work with no sheet open', () => {
    const output = { onPlot: vi.fn(), onSetups: vi.fn(), onPrinters: vi.fn(), onPens: vi.fn(), onBatch: vi.fn(), onRegister: vi.fn() };
    const pens = vi.fn();
    show({}, { view: 'drawings', output, sheets: sheets({ ui: sheetUi({ actions: { current: { ...NO_SHEET_ACTIONS, pens } } }) }) });
    pick('Output');
    expect(selected()).toBe('Output');
    for (const [l, f] of [['Plot', output.onPlot], ['Page setups', output.onSetups], ['Printers', output.onPrinters], ['Batch plot', output.onBatch], ['Register', output.onRegister], ['Pen tables', pens]] as const) {
      click(tool(l));
      expect(f, l).toHaveBeenCalledOnce();
    }
    act(() => root.unmount());
    root = createRoot(host);
    show({}, { view: 'drawings', output, sheets: sheets({ open: false }) });
    pick('Output');
    expect(tool('Plot').disabled).toBe(true);
    for (const l of ['Page setups', 'Pen tables', 'Printers', 'Batch plot', 'Register']) expect(tool(l).disabled, l).toBe(false);
    click(tool('Pen tables'));
    expect(output.onPens).toHaveBeenCalledOnce();
  });

  it('Output in model space: the drawing\'s view plotted and saved as PDF, DXF and DWG through Save As, its layouts published', () => {
    const output = { onPlot: vi.fn(), onSetups: vi.fn(), onPrinters: vi.fn(), onPens: vi.fn(), onBatch: vi.fn(), onRegister: vi.fn() };
    const { cad, rerender } = show({ onExport: vi.fn(), onSaveAs: vi.fn(), onPublish: vi.fn() }, { output });
    pick('Output');
    for (const l of ['Plot', 'PDF']) { click(tool(l)); expect(cad.onExport, l).toHaveBeenLastCalledWith('pdfView'); }
    click(tool('DXF'));
    expect(cad.onSaveAs).toHaveBeenCalledOnce();
    click(tool('DWG'));
    expect(cad.onSaveDwg).toHaveBeenCalledOnce();
    click(tool('Publish'));
    expect(cad.onPublish).toHaveBeenCalledOnce();
    click(tool('Pen tables'));
    expect(output.onPens).toHaveBeenCalledOnce();
    expect([tool('Preview').disabled, output.onPlot.mock.calls.length]).toEqual([true, 0]);
    rerender({ inLayout: true }); // a layout tab: Plot with its page setup
    click(tool('Plot'));
    expect(output.onPlot).toHaveBeenCalledOnce();
    rerender({ inLayout: false, hasDrawing: false }); // nothing open
    for (const l of ['Plot', 'Publish', 'PDF', 'DXF', 'DWG']) expect(tool(l).disabled, l).toBe(true);
    for (const l of ['Page setups', 'Pen tables', 'Printers', 'Batch plot', 'Register']) expect(tool(l).disabled, l).toBe(false);
  });

  it('opens the active sheet PDF preview in the desktop app', () => {
    const previewPdf = vi.fn();
    vi.stubGlobal('lvds', { files: { pdfBytes: vi.fn() } });
    try {
      show({}, { view: 'drawings', sheets: sheets({ ui: sheetUi({ actions: { current: { ...NO_SHEET_ACTIONS, previewPdf } } }) }) });
      pick('Output');
      expect(tool('Preview').disabled).toBe(false);
      click(tool('Preview'));
      expect(previewPdf).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it('on the sheets pages: every sheet tool on the sheets\' sub-tab, and LVCAD goes back to the drawing; with labels, Sheets and Annotate', () => {
    const onView = vi.fn();
    const { rerender } = show({}, { view: 'drawings', onView, sheets: sheets({ ui: sheetUi({ tool: 'cloud' }) }) });
    expect(selected()).toBe(ELEC);
    expect(groups()).toEqual(['Markup', 'On panels', 'Sheet', 'Sheet set']);
    pick('Output');
    expect(groups()).toEqual(['Plot', 'Publish', 'Export']);
    expect(tool('Publish').className).toContain('stale');
    for (const l of ['PDF', 'DXF', 'DWG']) expect(tool(l).disabled, l).toBe(false);
    pick(ELEC);
    expect(tool('Cloud').getAttribute('aria-pressed')).toBe('true');
    expect(tool('Panel cloud').disabled).toBe(false);
    expect(tool('Delete').disabled).toBe(true); // nothing selected
    expect(tool('Side by side').disabled).toBe(false);
    rerender({ labels: true });
    expect(selected()).toBe('Sheets');
    expect(groups()).toEqual(['Sheet', 'Sheet set']);
    pick('Annotate');
    expect(groups()).toEqual(['Markup', 'On panels']); // drawing on a sheet is its markup
    rerender({ labels: false });
    expect(selected()).toBe(ELEC);
    expect(onView).not.toHaveBeenCalled();
    pick('LVCAD');
    expect(onView).toHaveBeenLastCalledWith('cad'); // the drafting sub-tab shows the drawing
  });

  it('greys the sheet tools with no sheet open, and keeps panel tools to system SLD sheets', () => {
    show({}, { view: 'drawings', sheets: sheets({ open: false }) });
    expect(tool('All sheets').disabled).toBe(false);
    for (const l of ['Cloud', 'Colour']) expect(tool(l).disabled, l).toBe(true);
    pick('Output');
    for (const l of ['Plot', 'Publish', 'Pen tables', 'DWG']) expect(tool(l).disabled, l).toBe(true);
    pick(ELEC);
    act(() => root.unmount());
    root = createRoot(host);
    show({}, { view: 'drawings', sheets: sheets({ kind: 'earthing' }) });
    expect(tool('Panel cloud').disabled).toBe(true);
  });

  it('on a layout: the paper\'s markup on Annotate, the drawing\'s annotation in the model; layouts and viewports beside the sheet set', () => {
    const { rerender } = show({ inLayout: true, onPaper: true }, { sheets: sheets({ open: false, kind: 'plan' }) });
    expect(groups()).toEqual(DRAFTING.filter((g) => g !== 'Blocks')); // blocks are the model's
    pick('Annotate');
    expect(groups()).toEqual(['Markup']);
    expect(tool('Cloud').disabled).toBe(false);
    rerender({ onPaper: false }); // working in the model through a viewport
    expect(groups()).toEqual(['Annotate']);
    pick('LVCAD');
    expect(groups()).toEqual(DRAFTING);
    pick(ELEC);
    expect(groups().slice(-2)).toEqual(['Reference', 'Sheet set']); // the layout tools are on Output
    pick('Output');
    expect(groups()).toEqual(['Layout', 'Layout viewports', 'Plot', 'Publish', 'Export']);
    rerender({ labels: true, onPaper: true });
    pick('Sheets');
    expect(groups()).toEqual(['Reference', 'Sheet set']);
    pick('Layout');
    expect(groups()).toEqual(['Layout', 'Layout viewports']);
    pick('Output');
    expect(groups()).toEqual(['Plot', 'Publish', 'Export']); // with labels they have their own sub-tab
    pick('LVCAD');
    expect(groups()).toEqual(['Draw', 'Modify']);
    pick('Annotate');
    expect(groups()).toEqual(['Markup']);
  });

  it('a window too narrow for the row folds its panels from the right, one at a time, each to one tool named for it', () => {
    vi.useFakeTimers();
    let wide = 2900;
    const SHUT = 'button[aria-label$=": its tools"], button[title$=": its tools"]';
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.id === 'ribbon-tools' ? wide - (this.querySelectorAll(SHUT).length * 300) : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.id === 'ribbon-tools' ? 1600 : 0; });
    const { cad, rerender } = show({ inLayout: true });
    pick('Output');
    const shut = () => [...document.querySelectorAll(SHUT)].map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(shut()).toEqual(['Layout: its tools', 'Layout viewports: its tools', 'Plot: its tools', 'Publish: its tools', 'Export: its tools']);
    // One tool with the panel's name under its icon, no caption under it; the panel's tools on hover.
    expect(group('Layout viewports').querySelector('.ribbon-caption')).toBeNull();
    expect(tool('Layout viewports: its tools').textContent).toBe('Layout viewports');
    act(() => { tool('Layout viewports: its tools').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(document.querySelector('#ribbon-tip')!.textContent).toBe('Layout viewportsIts tools: Viewport, Arrange, Legend, Notes, Scale, Lock, Fit, Copy, Align, Maximise, Frame prints');
    // A tool that only opens a list is there as its list.
    click(tool('Layout: its tools'));
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['New layout: New layout', 'New layout: From template…', 'New layout: Lighting layout', 'New layout: Power layout', 'New layout: ELV layout', 'New layout: Containment layout', 'Page setup', 'Save as template']);
    click(item('New layout: Power layout'));
    expect(cad.onLayoutCmd).toHaveBeenLastCalledWith('LAYOUT POWER');
    wide = 1500;
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(shut()).toEqual([]);
    // A window made narrower with none folded: measured anew, so the panels fold (they keep their width, never squeezed).
    wide = 2900;
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(shut()).toHaveLength(5);
    // With labels: the panel's name on the button and under it.
    wide = 2000;
    pick(ELEC);
    rerender({ labels: true });
    expect(selected()).toBe('Electrical & ELV');
    expect(shut()).toEqual(['Edit devices', 'Wiring']);
    expect(group('Wiring').querySelector('.ribbon-caption')!.textContent).toBe('Wiring');
    click(document.querySelector('button[title="Wiring: its tools"]')!);
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Wire circuits', 'Wire one', 'Tags']);
  });
});

describe('Output: layout, viewports, plot, publish, export', () => {
  const cmds = (cad: Cad) => (cad.onLayoutCmd as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
  it('reads Layout, Layout viewports, Plot, Publish, Export on a layout; the model has no viewports; the sheets pages only the last three', () => {
    show();
    pick('Output');
    expect(groups()).toEqual(['Layout', 'Plot', 'Publish', 'Export']);
    act(() => root.unmount()); root = createRoot(host);
    show({ inLayout: true });
    pick('Output');
    expect(groups()).toEqual(['Layout', 'Layout viewports', 'Plot', 'Publish', 'Export']);
    // Every tool of Output is named, the small ones beside their icons (it fits a 1,366 px window: 1,281 px).
    expect(document.querySelector('.ribbon')!.className).toContain('small-named');
    expect([...group('Layout viewports').querySelectorAll('button')].map((b) => b.querySelector('span')?.textContent).filter(Boolean)).toEqual(['Viewport', 'Arrange', 'Legend', 'Notes', 'Scale', 'Lock', 'Fit', 'Copy', 'Align', 'Maximise', 'Frame prints']);
    act(() => root.unmount()); root = createRoot(host);
    show({}, { sheets: sheets({ open: false, kind: 'plan' }), view: 'drawings' });
    pick('Output');
    expect(groups()).toEqual(['Plot', 'Publish', 'Export']);
  });

  it('Layout: Page setup and Save as template run their commands on a layout; the viewport tools run theirs', () => {
    const { cad } = show({ inLayout: true });
    pick('Output');
    expect(tool('Page setup').disabled).toBe(false);
    click(tool('Page setup')); click(tool('Save as template'));
    expect(tools('Layout viewports')).toEqual(['Viewport', 'Arrange', 'Legend', 'Notes', 'Scale', 'Lock', 'Fit', 'Copy', 'Align', 'Maximise', 'Frame prints']);
    for (const t of ['Fit', 'Copy', 'Maximise', 'Frame prints', 'Viewport', 'Legend', 'Notes', 'Lock']) click(tool(t));
    click(tool('Align')); click(item('Side by side'));
    click(tool('Align')); click(item('Stacked'));
    expect(cmds(cad)).toEqual(['PAGESETUP', 'LAYOUT S', 'VPFIT', 'VPCOPY', 'VPMAX', 'VPFRAME', 'MV', 'LEGEND', 'NOTES', 'VPLOCK', 'VPALIGN H', 'VPALIGN V']);
  });

  it('Arrange lists the nine arrangements; Scale lists the project\'s scales and the scale list', () => {
    const { cad, rerender } = show({ inLayout: true });
    pick('Output');
    click(tool('Arrange'));
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(labels).toHaveLength(9);
    expect(labels[0]).toBe('Single');
    click(item('Two: side by side'));
    expect(cad.onLayoutCmd).toHaveBeenLastCalledWith('VPORTS 2V');
    click(tool('Scale'));
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['1:20', '1:50', '1:100', '1:200', '1:500', '1:1000', 'Scale list…']);
    click(item('Scale list…'));
    expect(cad.onLayoutCmd).toHaveBeenLastCalledWith('SCALELISTEDIT');
    rerender({ info: { ...INFO, scales: [50, 75, 100] } });
    click(tool('Scale'));
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['1:50', '1:75', '1:100', 'Scale list…']);
    click(item('1:75'));
    expect(cad.onLayoutCmd).toHaveBeenLastCalledWith('VPSCALE 75');
  });

  it('Lock and Frame prints show the viewport picked', () => {
    const { rerender } = show({ inLayout: true, info: { ...INFO, vp: { locked: true, frame: false } } });
    pick('Output');
    expect([tool('Lock'), tool('Frame prints')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    rerender({ info: { ...INFO, vp: { locked: false, frame: true } } });
    expect([tool('Lock'), tool('Frame prints')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });
});

describe('Draw order (S7 of the Design CAD 2D gap plan)', () => {
  it('lists Draw order\'s entries under Modify ▾ after a separator; each runs its command', () => {
    const { cad } = show();
    click(document.querySelector('button[title^="More modify tools"]')!);
    const items = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[];
    expect(items().map((b) => b.textContent)).toEqual(['Quick select…', 'Draw order: Bring to front', 'Draw order: Send to back', 'Draw order: Above object', 'Draw order: Under object', 'Draw order: Text to front (TEXTTOFRONT)']);
    expect(document.querySelectorAll('.ribbon-split-menu hr')).toHaveLength(1);
    click(items()[2]);
    expect(cad.onCommand).toHaveBeenLastCalledWith('DRAWORDER B');
    click(document.querySelector('button[title^="More modify tools"]')!);
    click(items()[5]);
    expect(cad.onCommand).toHaveBeenLastCalledWith('TEXTTOFRONT');
  });
});

describe('Points (S8 of the Design CAD 2D gap plan)', () => {
  it('lists Point, Divide, Measure out and Point style… under Draw ▾', () => {
    const { cad } = show();
    click(document.querySelector('button[title^="More draw tools"]')!);
    const items = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[];
    expect(items().map((b) => b.textContent)).toEqual(['Point', 'Divide', 'Measure out', 'Point style…']);
    click(items()[0]);
    expect(cad.onTool).toHaveBeenLastCalledWith('point');
    click(document.querySelector('button[title^="More draw tools"]')!);
    click(items()[2]);
    expect(cad.onTool).toHaveBeenLastCalledWith('measure');
    click(document.querySelector('button[title^="More draw tools"]')!);
    click(items()[3]);
    expect(cad.onCommand).toHaveBeenLastCalledWith('PTYPE');
  });
});

describe('Blocks (S9 of the Design CAD 2D gap plan)', () => {
  it('has a Blocks panel between Modify and Layers with Create, which opens the Block definition', () => {
    const { cad } = show();
    expect(tools('Blocks')).toEqual(['Insert', 'Create', 'Attribute']);
    click(tool('Attribute'));
    expect(cad.onCommand).toHaveBeenLastCalledWith('ATTDEF');
    click(document.querySelector('button[title^="More blocks tools"]')!);
    click([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Edit attributes')!);
    expect(cad.onCommand).toHaveBeenLastCalledWith('EATTEDIT');
    click(tool('Insert'));
    expect(cad.onCommand).toHaveBeenLastCalledWith('INSERT');
    fromList('Insert', 'DB-A');
    expect(cad.onCommand).toHaveBeenLastCalledWith('-INSERT DB-A');
    fromList('Insert', 'More blocks…');
    expect(cad.onCommand).toHaveBeenLastCalledWith('INSERT');
    click(tool('Create'));
    expect(cad.onCommand).toHaveBeenLastCalledWith('BLOCK');
  });
});
