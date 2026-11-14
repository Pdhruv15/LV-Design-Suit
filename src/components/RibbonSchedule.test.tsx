// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ribbon, { type RibbonActions, type RibbonTab } from './Ribbon';
import { DEFAULT_LAYERS } from '../diagram/annotations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Schedule = NonNullable<RibbonActions['schedule']>;
const noop = () => {};
const scheduleActions = (over: Partial<Schedule> = {}): Schedule => ({
  form: 'db', grid: true, board: true, prevBoard: 'MDB-1', nextBoard: 'SMDB-FF', onBoardStep: vi.fn(), fails: 0, warns: 0, onCheck: vi.fn(), onDuplicate: vi.fn(),
  onAddCircuit: vi.fn(), onAddSpare: vi.fn(), onAddTransformer: vi.fn(), onFormDetails: vi.fn(), row: undefined, onFillDown: vi.fn(), onEditRow: vi.fn(), onDeleteRow: vi.fn(),
  canBalance: true, imbalancePct: 12, onBalance: vi.fn(), onCopy: vi.fn(), onPaste: vi.fn(), exporting: false, onExport: vi.fn(), sheetFormat: false, onOpenSheet: vi.fn(), ...over
});
const actions = (over: Partial<RibbonActions> = {}): RibbonActions => ({
  view: 'load-schedule', onView: noop, tool: 'select', onTool: noop, boardId: 'DB-GF1', selectedFeederId: null, selection: { kind: 'board', id: 'DB-GF1' },
  onAddFeeder: noop, onAddBoard: noop, onBoardProperties: noop, onEditSelected: noop, onDeleteSelected: noop, onExportDss: noop, onSettings: noop,
  onUndo: noop, onRedo: noop, canUndo: false, canRedo: false, onRun: noop, staleCount: 0,
  onNew: noop, onSave: noop, onSaveAs: noop, onAnonymizedSample: noop, onProfile: noop, onChooseFolder: noop, folderLabel: 'Folder: Projects',
  dirty: false, recent: [], onOpenRecent: noop, dbIssues: 0, inboxCount: 0,
  onBom: noop, hasPriceList: false, stage: 'detailed', nextStage: 'ifc', ifcIssued: false, onAdvanceStage: noop, route: 'from-ifc', onRoute: noop, onConceptReport: noop,
  ...over
});

let root: Root;
beforeEach(() => { localStorage.clear(); root = createRoot(document.body.appendChild(document.createElement('div'))); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });

/** The Load schedule tab with these schedule actions (none: without them); returns the actions given. */
function show(schedule: Partial<Schedule> | null = {}, over: Partial<RibbonActions> = {}, tab: RibbonTab = 'schedule') {
  const s = schedule ? scheduleActions(schedule) : undefined;
  act(() => root.render(<Ribbon tab={tab} onTab={noop} a={actions({ schedule: s, ...over })} />));
  return s!;
}
const click = (el: Element) => act(() => (el as HTMLElement).click());
const row = () => document.getElementById('ribbon-tools')!;
const onRow = () => [...row().children].filter((c) => c.matches('.ribbon-group[role="group"]')).map((g) => g.getAttribute('aria-label'));
const group = (caption: string) => document.querySelector(`.ribbon-group[role="group"][aria-label="${caption}"]`)!;
const names = (caption: string) => [...group(caption).querySelectorAll('button:not(.ribbon-split-arrow)')].map((b) => b.querySelector('span')!.textContent);
const tool = (name: string) => [...row().querySelectorAll<HTMLButtonElement>('.ribbon-group button:not(.ribbon-split-arrow)')].find((b) => b.querySelector('span')?.textContent === name)!;
const arrow = (name: string) => tool(name).closest('.ribbon-split')!.querySelector<HTMLButtonElement>('.ribbon-split-arrow')!;
const items = () => [...document.querySelectorAll<HTMLButtonElement>('.ribbon-split-menu button')];
const item = (label: string) => items().find((b) => b.textContent === label)!;
const more = () => row().querySelector<HTMLButtonElement>('.ribbon-group.more > button') ?? null;
const sub = (name: string) => tool(name).querySelector('.ribbon-sub')?.textContent;
const NEW_TOOLS = ['Check', 'Previous board', 'Next board', 'Add circuit', 'Spare', 'Fill down', 'Duplicate', 'Edit', 'Delete', 'Balance phases', 'Copy', 'Paste', 'Export'];

describe('the Load schedule tab', () => {
  it('has seven groups: Run and check, Schedule, Circuits and loads, Rows, Balance, Copy and undo, Output', () => {
    show();
    expect(onRow()).toEqual(['Run and check', 'Schedule', 'Circuits and loads', 'Rows', 'Balance', 'Copy and undo', 'Output']);
    expect(names('Run and check')).toEqual(['Run', 'Check']);
    expect(names('Schedule')).toEqual(['Load schedule', 'Boards', 'Board', 'Enclosure', 'Previous board', 'Next board']);
    expect(names('Circuits and loads')).toEqual(['Add circuit', 'Spare', 'Add load']);
    expect(names('Rows')).toEqual(['Fill down', 'Duplicate', 'Edit', 'Delete']);
    expect(names('Balance')).toEqual(['Balance phases']);
    expect(names('Copy and undo')).toEqual(['Copy', 'Paste', 'Undo', 'Redo']);
    expect(names('Output')).toEqual(['Export']);
    // Fill down and Duplicate, then Edit and Delete; Previous and Next board; Copy and Paste, then Undo and Redo.
    expect([...group('Rows').querySelectorAll('.ribbon-stack')].map((c) => c.children.length)).toEqual([2, 2]);
    expect([...group('Schedule').querySelectorAll('.ribbon-stack')].map((c) => c.children.length)).toEqual([2]);
    expect([...group('Copy and undo').querySelectorAll('.ribbon-stack')].map((c) => c.children.length)).toEqual([2, 2]);
    expect(more()).toBeNull(); // nothing under More on a wide window
  });

  it('has Boards (add a board) in the Schedule group, with its list', () => {
    const onAddBoard = vi.fn();
    show({}, { onAddBoard });
    click(tool('Boards'));
    expect(onAddBoard).toHaveBeenCalledTimes(1);
    click(arrow('Boards'));
    expect(items().map((b) => b.textContent)).toEqual(['DB · 63 A', 'EDB · 63 A', 'SMDB · 250 A', 'MCC · 400 A', 'EMCC · 400 A', 'EMDB · 400 A', 'Build hierarchy…']);
    click(item('SMDB · 250 A'));
    expect(onAddBoard).toHaveBeenLastCalledWith({ kind: 'SMDB', ratingA: 250 });
    show(null);
    expect(tool('Boards').disabled).toBe(false); // as on the SLD tab
  });

  it('steps to the board before and after, named in the tip, greyed at the ends and off a board\'s form', () => {
    let s = show();
    expect(tool('Previous board').title).toBe('Previous board: MDB-1');
    expect(tool('Next board').title).toBe('Next board: SMDB-FF');
    click(tool('Previous board'));
    expect(s.onBoardStep).toHaveBeenLastCalledWith(-1);
    click(tool('Next board'));
    expect(s.onBoardStep).toHaveBeenLastCalledWith(1);
    s = show({ prevBoard: undefined });
    expect(tool('Previous board').disabled).toBe(true);
    expect(tool('Previous board').title).toBe('First board of the schedule');
    expect(tool('Next board').disabled).toBe(false);
    show({ nextBoard: undefined });
    expect(tool('Next board').title).toBe('Last board of the schedule');
    show({ board: false, prevBoard: undefined, nextBoard: undefined });
    for (const n of ['Previous board', 'Next board']) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('On a board\'s schedule'); }
    show({ grid: false, board: true }); // the MD form: the steps work
    expect(tool('Next board').disabled).toBe(false);
    show(null);
    expect(tool('Next board').title).toBe('On the Load schedule page');
  });

  it('checks: the count beside it, what a press does, and a title that says what is there', () => {
    let s = show({ fails: 2, warns: 3 });
    expect(sub('Check')).toBe('2 fail');
    expect(tool('Check').title).toBe('Show the next failing circuit in this schedule — 2 failing, 3 to check');
    click(tool('Check'));
    expect(s.onCheck).toHaveBeenCalledTimes(1);
    s = show({ warns: 3 });
    expect(sub('Check')).toBe('3 to check');
    expect(tool('Check').title).toBe('Show the next circuit to check in this schedule — 0 failing, 3 to check');
    s = show();
    expect(sub('Check')).toBeUndefined();
    expect(tool('Check').title).toBe('No problem in this schedule — press to look in the other boards');
    expect(tool('Check').disabled).toBe(false);
    click(tool('Check'));
    expect(s.onCheck).toHaveBeenCalledTimes(1);
    show(null, { view: 'enclosure' });
    expect(tool('Check').title).toBe('On the Load schedule page');
  });

  it('duplicates the circuit of the active row', () => {
    let s = show({ row: 'Y3' });
    expect(tool('Duplicate').title).toBe('Duplicate circuit Y3 in the next free way');
    click(tool('Duplicate'));
    expect(s.onDuplicate).toHaveBeenCalledTimes(1);
    s = show();
    expect(tool('Duplicate').disabled).toBe(true);
    expect(tool('Duplicate').title).toBe('Click a circuit row on the schedule first');
  });

  it('shows what is out of date under Run, as the SLD tab does', () => {
    show({}, { staleCount: 3 });
    expect(sub('Run')).toBe('3 out of date');
    show();
    expect(sub('Run')).toBeUndefined();
  });

  it('adds a circuit, or a 3-phase circuit from the list', () => {
    const s = show();
    click(tool('Add circuit'));
    expect(s.onAddCircuit).toHaveBeenLastCalledWith();
    click(arrow('Add circuit'));
    expect(items().map((b) => b.textContent)).toEqual(['Circuit', '3-phase circuit']);
    click(item('3-phase circuit'));
    expect(s.onAddCircuit).toHaveBeenLastCalledWith(true);
    expect(items()).toEqual([]);
    click(arrow('Add circuit'));
    click(item('Circuit'));
    expect(s.onAddCircuit).toHaveBeenLastCalledWith();
    expect(s.onAddCircuit).toHaveBeenCalledTimes(3);
  });

  it('adds a spare way, a space, and the 3-phase ones', () => {
    const s = show();
    click(tool('Spare'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('spare');
    click(arrow('Spare'));
    expect(items().map((b) => b.textContent)).toEqual(['Spare', 'Space', '3-phase spare', '3-phase space']);
    expect(item('3-phase spare').previousElementSibling?.tagName).toBe('HR'); // a line above the 3-phase pair
    click(item('Space'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('space');
    click(arrow('Spare')); click(item('3-phase spare'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('spare', 'three');
    click(arrow('Spare')); click(item('3-phase space'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('space', 'three');
  });

  it('keeps Add load as it was', () => {
    const onAddFeeder = vi.fn();
    show({}, { onAddFeeder });
    click(tool('Add load'));
    expect(onAddFeeder).toHaveBeenLastCalledWith({ loadType: 'general' });
    click(arrow('Add load'));
    click(item('Motor'));
    expect(onAddFeeder).toHaveBeenLastCalledWith({ loadType: 'motor', powerFactor: 0.86, demandFactor: 1 });
    show(null);
    expect(tool('Add load').disabled).toBe(false);
  });

  it('fills down, and edits or deletes the circuit of the active row, greyed until there is one', () => {
    let s = show();
    click(tool('Fill down'));
    expect(s.onFillDown).toHaveBeenCalledTimes(1);
    expect(tool('Fill down').title).toContain('Ctrl/⌘ D');
    for (const n of ['Edit', 'Delete']) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('Click a circuit row on the schedule first'); }
    s = show({ row: 'Y3' });
    expect(tool('Edit').title).toContain('Edit circuit Y3');
    expect(tool('Delete').title).toBe('Delete circuit Y3');
    click(tool('Edit'));
    expect(s.onEditRow).toHaveBeenCalledTimes(1);
    click(tool('Delete'));
    expect(s.onDeleteRow).toHaveBeenCalledTimes(1);
  });

  it('balances the phases and shows the imbalance; greyed with fewer than two circuits', () => {
    let s = show({ imbalancePct: 27 });
    expect(sub('Balance phases')).toBe('27 % apart');
    click(tool('Balance phases'));
    expect(s.onBalance).toHaveBeenCalledTimes(1);
    expect(tool('Balance phases').title).toContain('Lighting circuits first');
    s = show({ canBalance: false, imbalancePct: 0 });
    expect(tool('Balance phases').disabled).toBe(true);
    expect(sub('Balance phases')).toBe('0 % apart');
    show({ canBalance: false, imbalancePct: undefined });
    expect(sub('Balance phases')).toBeUndefined();
  });

  it('copies, pastes, undoes and redoes', () => {
    const onUndo = vi.fn(), onRedo = vi.fn();
    let s = show({}, { onUndo, onRedo, canUndo: true });
    click(tool('Copy'));
    expect(s.onCopy).toHaveBeenCalledTimes(1);
    click(tool('Paste'));
    expect(s.onPaste).toHaveBeenCalledTimes(1);
    click(tool('Undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(tool('Redo').disabled).toBe(true);
    s = show({}, { onRedo, canRedo: true });
    click(tool('Redo'));
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('exports: Excel on the press, then the list', () => {
    const s = show();
    click(tool('Export'));
    expect(s.onExport).toHaveBeenLastCalledWith('excel');
    click(arrow('Export'));
    expect(items().map((b) => b.textContent)).toEqual(['Excel: this form', 'PDF: this form', 'CSV', 'Submission pack (Excel)', 'My Excel template…', 'Open in my format', 'Form details…']);
    expect(item('Submission pack (Excel)').previousElementSibling?.tagName).toBe('HR');
    for (const [label, kind] of [['Excel: this form', 'excel'], ['PDF: this form', 'pdf'], ['CSV', 'csv'], ['Submission pack (Excel)', 'pack'], ['My Excel template…', 'template']] as const) {
      if (!items().length) click(arrow('Export'));
      click(item(label));
      expect(s.onExport, label).toHaveBeenLastCalledWith(kind);
    }
    expect(s.onExport).toHaveBeenCalledTimes(6);
    expect(item('Form details…') ?? null).toBeNull(); // the panel closed after the last pick
  });

  it('Open in my format needs the DB form and a format, then opens the DB as a sheet', () => {
    let s = show();
    click(arrow('Export'));
    expect(item('Open in my format').disabled).toBe(true);
    expect(item('Open in my format').title).toBe('Choose a DB format in Sheets → My formats first');
    click(arrow('Export'));
    s = show({ grid: false, form: 'riser' });
    click(arrow('Export'));
    expect(item('Open in my format').title).toBe('On the DB load schedule form');
    click(arrow('Export'));
    s = show({ sheetFormat: true });
    click(arrow('Export'));
    expect(item('Open in my format').disabled).toBe(false);
    expect(item('Open in my format').title).toBe('This DB as a sheet in your own format, in Sheets');
    click(item('Open in my format'));
    expect(s.onOpenSheet).toHaveBeenCalledTimes(1);
    expect(s.onExport).not.toHaveBeenCalled();
  });

  it('says Exporting… and greys Export while one runs', () => {
    show({ exporting: true });
    expect(sub('Export')).toBe('Exporting…');
    expect(tool('Export').disabled).toBe(true);
    show();
    expect(sub('Export')).toBeUndefined();
    expect(tool('Export').disabled).toBe(false);
  });

  it('greys every new tool away from the Load schedule page (the Enclosure page)', () => {
    show(null, { view: 'enclosure' });
    for (const n of NEW_TOOLS) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('On the Load schedule page'); }
    expect(arrow('Export').disabled).toBe(true);
    for (const n of ['Run', 'Load schedule', 'Board', 'Enclosure', 'Add load']) expect(tool(n).disabled, n).toBe(false);
  });

  it('greys what does not apply on the busbar riser, and keeps Export; CSV and the template are DB-only', () => {
    show({ form: 'riser', grid: false, row: undefined });
    for (const n of ['Check', 'Balance phases']) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('On the DB load schedule form'); }
    expect(tool('Add circuit').disabled).toBe(true);
    expect(tool('Add circuit').title).toBe('On a DB, a panel\'s form or the TCL summary');
    expect(tool('Spare').disabled).toBe(true);
    expect(tool('Spare').title).toBe('On a DB or a panel\'s form');
    for (const n of ['Fill down', 'Duplicate', 'Copy', 'Paste']) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('On a DB load schedule or a panel\'s form'); }
    expect(tool('Delete').disabled).toBe(true);
    expect(sub('Balance phases')).toBeUndefined();
    expect(tool('Export').disabled).toBe(false);
    click(tool('Export'));
    click(arrow('Export'));
    expect(item('PDF: this form').disabled).toBe(false);
    expect(item('Submission pack (Excel)').disabled).toBe(false);
    expect(item('CSV').disabled).toBe(true);
    expect(item('My Excel template…').disabled).toBe(true);
    expect(item('Form details…').disabled).toBe(true);
    expect(item('Form details…').title).toBe('On a panel\'s form or the TCL summary');
    expect(tool('Undo').disabled).toBe(true); // Undo and Redo follow the project history, not the form
    show({ form: 'riser', grid: false }, { canUndo: true });
    expect(tool('Undo').disabled).toBe(false);
  });
});

describe('the Load schedule tab on a panel\'s connected load & MD form', () => {
  const md = (over: Partial<Schedule> = {}) => show({ form: 'md', grid: false, ...over });

  it('adds a feeder, or a board fed from the panel from the list', () => {
    const onAddBoard = vi.fn();
    const s = show({ form: 'md', grid: false }, { onAddBoard });
    expect(names('Circuits and loads')).toEqual(['Add feeder', 'Spare', 'Add load']);
    expect(tool('Add feeder').title).toContain('DB-GF1');
    click(tool('Add feeder'));
    expect(s.onAddCircuit).toHaveBeenLastCalledWith();
    click(arrow('Add feeder'));
    expect(items().map((b) => b.textContent)).toEqual(['Feeder (equipment load)', 'DB · 63 A', 'EDB · 63 A', 'SMDB · 250 A', 'MCC · 400 A', 'EMCC · 400 A', 'EMDB · 400 A', 'Build hierarchy…']);
    expect(item('DB · 63 A').previousElementSibling?.tagName).toBe('HR');
    click(item('SMDB · 250 A'));
    expect(onAddBoard).toHaveBeenLastCalledWith({ kind: 'SMDB', ratingA: 250 });
    click(arrow('Add feeder')); click(item('Feeder (equipment load)'));
    expect(s.onAddCircuit).toHaveBeenCalledTimes(2);
  });

  it('adds 3-phase spares and spaces, and 1-phase ones from the list', () => {
    const s = md();
    click(tool('Spare'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('spare', 'three');
    click(arrow('Spare'));
    expect(items().map((b) => b.textContent)).toEqual(['Spare', 'Space', '1-phase spare', '1-phase space']);
    click(item('Space'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('space', 'three');
    click(arrow('Spare')); click(item('1-phase spare'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('spare', 'one');
    click(arrow('Spare')); click(item('1-phase space'));
    expect(s.onAddSpare).toHaveBeenLastCalledWith('space', 'one');
  });

  it('fills down, copies and pastes', () => {
    const s = md();
    for (const [n, fn] of [['Fill down', s.onFillDown], ['Copy', s.onCopy], ['Paste', s.onPaste]] as const) {
      expect(tool(n).disabled, n).toBe(false);
      click(tool(n));
      expect(fn, n).toHaveBeenCalledTimes(1);
    }
  });

  it('needs a row for Edit, Delete and Duplicate, and names it', () => {
    let s = md();
    for (const n of ['Edit', 'Delete', 'Duplicate']) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('Click a row on the form first'); }
    s = md({ row: 'DB-EV' });
    expect(tool('Edit').title).toBe('Edit DB-EV (or double-click the row)');
    expect(tool('Delete').title).toBe('Delete DB-EV');
    expect(tool('Duplicate').title).toBe('Duplicate feeder DB-EV in DB-GF1');
    for (const [n, fn] of [['Edit', s.onEditRow], ['Delete', s.onDeleteRow], ['Duplicate', s.onDuplicate]] as const) { click(tool(n)); expect(fn, n).toHaveBeenCalledTimes(1); }
  });

  it('greys Delete with its reason when the feeder supplies a panel, and Duplicate with its own', () => {
    const s = md({ row: 'INC-GF → SMDB-GF', rowBlock: 'INC-GF supplies SMDB-GF — delete it on the SLD', dupBlock: 'INC-GF supplies SMDB-GF — copy the board on the SLD tab' });
    expect(tool('Delete').disabled).toBe(true);
    expect(tool('Delete').title).toBe('INC-GF supplies SMDB-GF — delete it on the SLD');
    expect(tool('Duplicate').disabled).toBe(true);
    expect(tool('Duplicate').title).toBe('INC-GF supplies SMDB-GF — copy the board on the SLD tab');
    expect(tool('Edit').disabled).toBe(false);
    click(tool('Delete'));
    expect(s.onDeleteRow).not.toHaveBeenCalled();
  });

  it('greys Duplicate on a spare way, and keeps Check and Balance phases DB-only', () => {
    md({ row: 'SPARE', dupBlock: 'Add another one from Spare' });
    expect(tool('Duplicate').disabled).toBe(true);
    expect(tool('Duplicate').title).toBe('Add another one from Spare');
    expect(tool('Delete').disabled).toBe(false);
    for (const n of ['Check', 'Balance phases']) expect(tool(n).disabled, n).toBe(true);
  });

  it('has Form details… last under Export, on this form', () => {
    const s = md();
    click(arrow('Export'));
    expect(items().map((b) => b.textContent).slice(-1)).toEqual(['Form details…']);
    expect(item('Form details…').previousElementSibling?.tagName).toBe('HR');
    expect(item('Form details…').disabled).toBe(false);
    expect(item('Form details…').title).toBe('Project, area, owner, plot, consultant and contractor on the authority forms');
    click(item('Form details…'));
    expect(s.onFormDetails).toHaveBeenCalledTimes(1);
  });

  it('keeps Form details… greyed on a DB load schedule', () => {
    show();
    click(arrow('Export'));
    expect(item('Form details…').disabled).toBe(true);
  });
});

describe('the Load schedule tab on the TCL summary', () => {
  const tx = (over: Partial<Schedule> = {}) => show({ form: 'tx', grid: false, board: false, substation: 'Substation 1', ...over });

  it('adds a transformer to the substation, or in a new one from the list', () => {
    const s = tx();
    expect(names('Circuits and loads')).toEqual(['Add transformer', 'Spare', 'Add load']);
    expect(tool('Add transformer').title).toBe('Add a transformer to Substation 1 — the arrow beside it for a new substation');
    click(tool('Add transformer'));
    expect(s.onAddTransformer).toHaveBeenLastCalledWith(false);
    click(arrow('Add transformer'));
    expect(items().map((b) => b.textContent)).toEqual(['Transformer in Substation 1', 'New substation']);
    click(item('New substation'));
    expect(s.onAddTransformer).toHaveBeenLastCalledWith(true);
    click(arrow('Add transformer')); click(item('Transformer in Substation 1'));
    expect(s.onAddTransformer).toHaveBeenLastCalledWith(false);
  });

  it('edits and deletes the selected transformer, greyed until one is', () => {
    let s = tx();
    for (const n of ['Edit', 'Delete']) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('Click a row on the form first'); }
    s = tx({ row: 'TX-1' });
    expect(tool('Edit').title).toBe('Edit transformer TX-1 (or double-click the row)');
    expect(tool('Delete').title).toBe('Delete transformer TX-1');
    click(tool('Edit')); click(tool('Delete'));
    expect(s.onEditRow).toHaveBeenCalledTimes(1);
    expect(s.onDeleteRow).toHaveBeenCalledTimes(1);
  });

  it('greys Spare and the grid tools, and has Form details… under Export', () => {
    const s = tx({ row: 'TX-1' });
    expect(tool('Spare').disabled).toBe(true);
    expect(tool('Spare').title).toBe('On a DB or a panel\'s form');
    for (const n of ['Fill down', 'Duplicate', 'Copy', 'Paste']) { expect(tool(n).disabled, n).toBe(true); expect(tool(n).title, n).toBe('On a DB load schedule or a panel\'s form'); }
    click(arrow('Export'));
    expect(item('Form details…').disabled).toBe(false);
    click(item('Form details…'));
    expect(s.onFormDetails).toHaveBeenCalledTimes(1);
  });
});

describe('the Load schedule tab on the busbar riser', () => {
  it('has Edit always on, opening the riser; the other row tools are greyed', () => {
    const s = show({ form: 'riser', grid: false, board: false, row: undefined });
    expect(tool('Edit').disabled).toBe(false);
    expect(tool('Edit').title).toBe('Edit the busbar riser (Calculate → Busbar riser)');
    click(tool('Edit'));
    expect(s.onEditRow).toHaveBeenCalledTimes(1);
    for (const n of ['Delete', 'Duplicate', 'Spare', 'Add circuit', 'Fill down', 'Copy', 'Paste']) expect(tool(n).disabled, n).toBe(true);
  });
});

describe('the Load schedule tab on a narrow window', () => {
  /** A row that needs 400 px and 200 px for each group on it, in a window `width` wide. */
  let width = 2400;
  beforeEach(() => {
    width = 2400;
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.id === 'ribbon-tools' ? 400 + [...this.children].filter((c) => c.matches('.ribbon-group[role="group"]')).length * 200 : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.id === 'ribbon-tools' ? width : 0; });
  });
  const resize = (w: number) => act(() => { width = w; window.dispatchEvent(new Event('resize')); });
  const under = () => [...document.querySelectorAll('.ribbon-over > .ribbon-group')].map((g) => g.getAttribute('aria-label'));

  it('moves Output, Copy and undo, Balance and Rows under More, from the right, and brings them back', () => {
    show();
    expect(onRow()).toHaveLength(7);
    expect(more()).toBeNull();
    resize(1500); // room for five
    expect(onRow()).toEqual(['Run and check', 'Schedule', 'Circuits and loads', 'Rows', 'Balance']);
    expect(more()!.title).toBe('More tools: Copy and undo, Output');
    click(more()!);
    expect(under()).toEqual(['Copy and undo', 'Output']);
    expect(document.querySelector('.ribbon-over-list')).toBeNull(); // no list of other tools on this tab
    resize(2400);
    expect(onRow()).toHaveLength(7);
    expect(more()).toBeNull();
  });

  it('never moves the first three groups', () => {
    show();
    resize(900);
    expect(onRow()).toEqual(['Run and check', 'Schedule', 'Circuits and loads']);
    click(more()!);
    expect(under()).toEqual(['Rows', 'Balance', 'Copy and undo', 'Output']);
  });

  it('works the tools under More, and puts the panel away after one, keeping it while a list is open', () => {
    const s = show();
    resize(900);
    click(more()!);
    click(tool('Balance phases'));
    expect(s.onBalance).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ribbon-over')).toBeNull();
    click(more()!);
    click(arrow('Export'));
    expect(document.querySelector('.ribbon-over')).not.toBeNull();
    click(item('CSV'));
    expect(s.onExport).toHaveBeenLastCalledWith('csv');
    click(more()!);
    click(tool('Fill down'));
    expect(s.onFillDown).toHaveBeenCalledTimes(1);
  });

  it('measures again when the imbalance or an export is written on the row', () => {
    show({ imbalancePct: 5 });
    expect(onRow()).toHaveLength(7);
    width = 1500; // the row is now too wide, though nothing resized the window
    show({ imbalancePct: 6 });
    expect(onRow()).toHaveLength(5);
  });

  it('keeps the SLD tab\'s overflow, with its list of other tools', () => {
    show({}, { sld: { fails: 0, warns: 0, onCheck: noop, onArm: noop, onHvSupply: noop, system: true, layers: DEFAULT_LAYERS, onLayers: noop, colorBy: 'none', onColorBy: noop, supply: 'normal', onSupply: noop, hasGenerator: false, outages: [], canCopy: false, onCopy: noop, canPaste: false, onPaste: noop, onShowOnPlan: noop, onFit: noop, onExport: noop }, view: 'design' }, 'sld');
    expect(onRow()).toHaveLength(9);
    resize(1900);
    expect(onRow()).toHaveLength(7);
    expect(more()!.title).toBe('More tools: View, Output and the other tools');
    click(more()!);
    expect(under()).toEqual(['View', 'Output']);
    expect(document.querySelector('.ribbon-over-list')).not.toBeNull();
  });
});
