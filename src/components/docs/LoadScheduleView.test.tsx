// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoadScheduleView from './LoadScheduleView';
import type { RibbonActions } from '../Ribbon';
import type { Project } from '../../types';
import { EMPTY_DATABASE } from '../../database/database';
import { sampleProject } from '../../data/sampleProject';
import { scheduleCircuits } from '../../calc/loadSchedule';
import { spareWaysOf } from '../../model/spareWays';
import { safeFileName, saveBinary, saveCsv, savePdf } from '../../util/files';
import { loadScheduleRows } from '../../docs/loadScheduleDoc';
import { addCircuit, updateCircuit } from '../../model/schedule';
import { withProjectFormat } from '../../model/scheduleFormats';
import { newSheet } from '../../model/sheets';

vi.mock('../../util/files', async (real) => ({
  ...await real<typeof import('../../util/files')>(),
  saveBinary: vi.fn(async () => 'Saved'), saveCsv: vi.fn(async () => 'Saved'), savePdf: vi.fn(async () => 'Saved')
}));
vi.mock('../../docs/formWorkbook', async (real) => ({
  ...await real<typeof import('../../docs/formWorkbook')>(),
  buildFormWorkbook: vi.fn(() => ({})), workbookBytes: vi.fn(async () => new Uint8Array(1))
}));
vi.mock('../../docs/loadScheduleDoc', async (real) => { const m = await real<typeof import('../../docs/loadScheduleDoc')>(); return { ...m, loadScheduleRows: vi.fn(m.loadScheduleRows) }; });
vi.mock('../../docs/sheetPdf', async (real) => ({ ...await real<typeof import('../../docs/sheetPdf')>(), workbookHtml: vi.fn(() => '<p>form</p>') }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Schedule = NonNullable<RibbonActions['schedule']>;
const BOARD = 'DB-GF1';
let shown = BOARD;
let start: Project = sampleProject;
let visited: string[] = [];
let root: Root;
let latest: Project;
let published: Schedule | undefined;
let publishes = 0;
const opened: string[] = [];
const status = vi.fn();

function Harness() {
  const [p, setP] = useState(start);
  const [on, setOn] = useState(shown);
  latest = p;
  return <LoadScheduleView project={p} boardId={on} db={EMPTY_DATABASE} onBoard={(id) => { visited.push(id); setOn(id); }} onChange={setP} onStatus={status} onSettings={() => {}}
    onSchedule={(s) => { published = s; publishes++; }} onOpenSheet={(id) => opened.push(id)} />;
}
const mount = () => act(() => root.render(<Harness />));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const last = <T,>(l: T[]) => l[l.length - 1];
const circuits = () => scheduleCircuits(latest, BOARD);
const buttons = () => [...document.querySelectorAll('button')].map((b) => b.textContent!.trim());
/** The Room inputs of the circuit rows, top row first (the row numbers of the grid). */
const rooms = () => [...document.querySelectorAll<HTMLInputElement>('table.ls input[placeholder="Room"][data-cell]')].sort((a, b) => +a.dataset.cell!.split(':')[0] - +b.dataset.cell!.split(':')[0]);
const press = (el: Element, over: Partial<MouseEventInit> = {}) => act(() => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...over })); window.dispatchEvent(new MouseEvent('mouseup')); });
/** The first two Room cells selected, top to bottom. */
const selectTwo = () => { const [a, b] = rooms(); press(a); press(b, { shiftKey: true }); return [a, b]; };

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  shown = BOARD; start = sampleProject; visited = []; published = undefined; publishes = 0; opened.length = 0; status.mockClear();
  for (const f of [saveBinary, saveCsv, savePdf]) vi.mocked(f).mockClear();
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.mocked(loadScheduleRows).mockClear();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('Load schedule page and the ribbon', () => {
  it('publishes Open in my format: usable with a project format or a sheet linked to this board, and it opens this board', () => {
    mount();
    expect(published!.sheetFormat).toBe(false);
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement('div')));
    const link = { category: 'db' as const, cells: {}, firstRow: 5, rows: [], columns: {} };
    start = withProjectFormat(sampleProject, { id: 'f', name: 'F', category: 'db', sheet: { ...newSheet(), link }, updatedAt: '2026-11-14' });
    mount();
    expect(published!.sheetFormat).toBe(true);
    act(() => published!.onOpenSheet());
    expect(opened).toEqual([BOARD]);
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement('div')));
    start = { ...sampleProject, sheets: { sheets: [{ ...newSheet(), link: { ...link, boardId: BOARD } }] } };
    mount();
    expect(published!.sheetFormat).toBe(true);
  });

  it('no longer has the buttons that moved to the ribbon, and keeps the rest', () => {
    mount();
    const names = buttons();
    for (const gone of ['Add circuit', 'Add 3-phase circuit', 'Spare', 'Space', 'Balance phases', 'Export Excel', 'Export PDF', 'Export CSV', 'Submission pack (Excel)', 'My Excel template…']) expect(names).not.toContain(gone);
    expect(document.querySelector('.ls-spare-add')).toBeNull();
    expect(document.querySelector('.ls-actions')!.textContent).toMatch(/Excel keys.*Phase load \(W\).*imbalance/);
    expect(document.querySelector('select[aria-label="DB"]')).not.toBeNull();
    expect(document.querySelectorAll('table.ls .icon-btn').length).toBeGreaterThan(0); // the row bins stay
  });

  it('publishes what the ribbon needs, and again only when those values change', () => {
    mount();
    expect(published).toMatchObject({ grid: true, row: undefined, canBalance: true, exporting: false });
    expect(published!.imbalancePct).toBeTypeOf('number');
    expect(document.querySelector('.ls-actions b.ok, .ls-actions b.warn')!.textContent).toBe(`${published!.imbalancePct}%`);
    const first = publishes;
    expect(first).toBeLessThan(4); // not once per render
    press(rooms()[0]);
    expect(publishes).toBeLessThan(first + 3);
    const before = publishes;
    act(() => root.render(<Harness />)); // a render with the same values
    expect(publishes).toBe(before);
    act(() => root.unmount());
    expect(published).toBeUndefined(); // the page going away clears it
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });

  it('adds a circuit, a 3-phase circuit, a spare and a space', () => {
    mount();
    const n = circuits().length;
    act(() => published!.onAddCircuit());
    expect(circuits()).toHaveLength(n + 1);
    expect(last(circuits()).phase).not.toBe('RYB');
    act(() => published!.onAddCircuit(true));
    expect(circuits()).toHaveLength(n + 2);
    expect(last(circuits()).phase).toBe('RYB');
    const board = () => latest.boards.find((b) => b.id === BOARD)!;
    act(() => published!.onAddSpare('spare'));
    act(() => published!.onAddSpare('space'));
    expect(spareWaysOf(board()).map((s) => `${s.kind}:${s.phase === 'RYB'}`)).toEqual(['spare:false', 'space:false']);
    act(() => published!.onAddSpare('spare', 'three'));
    act(() => published!.onAddSpare('space', 'three'));
    expect(spareWaysOf(board()).slice(2).map((s) => `${s.kind}:${s.phase === 'RYB'}`)).toEqual(['spare:true', 'space:true']);
    expect(status).toHaveBeenLastCalledWith(expect.stringMatching(/^Added a TP space to DB-GF1/));
  });

  it('balances the phases', () => {
    mount();
    const before = latest;
    act(() => published!.onBalance());
    expect(latest).not.toBe(before);
    expect(latest.feeders.map((f) => f.id).sort()).toEqual(before.feeders.map((f) => f.id).sort());
  });

  it('opens the edit dialog and deletes after asking, for the row of the active cell, which a click elsewhere keeps', async () => {
    mount();
    expect(published!.row).toBeUndefined();
    act(() => published!.onEditRow()); // no active row: nothing
    expect(document.querySelector('.circuit-edit')).toBeNull();
    const top = rooms()[1]; // the room of the second circuit row
    act(() => top.focus());
    const ref = published!.row!;
    expect(ref).toMatch(/^[RYB]\d+$/);
    act(() => top.blur()); // focus moves to a ribbon button
    expect(published!.row).toBe(ref);
    act(() => published!.onEditRow());
    expect(document.querySelector('.circuit-edit')).not.toBeNull();
    // Delete: the same question as the row's bin.
    const n = circuits().length;
    await act(async () => { published!.onDeleteRow(); await Promise.resolve(); });
    expect(window.confirm).toHaveBeenCalledWith(`Delete circuit ${ref}?`);
    expect(circuits()).toHaveLength(n - 1);
  });

  it('does not delete when the question is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    mount();
    act(() => rooms()[0].focus());
    const n = circuits().length;
    await act(async () => { published!.onDeleteRow(); await Promise.resolve(); });
    expect(circuits()).toHaveLength(n);
  });

  it('fills down the selection as Ctrl+D does', () => {
    mount();
    const [a, b] = selectTwo();
    expect(a.value).not.toBe(b.value);
    act(() => published!.onFillDown());
    const byButton = rooms().map((r) => r.value);
    expect(byButton[1]).toBe(byButton[0]);
    // The key, from the same start.
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement('div')));
    mount();
    const [, d] = selectTwo();
    act(() => { d.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true })); });
    expect(rooms().map((r) => r.value)).toEqual(byButton);
  });

  it('pastes the clipboard through the grid, and says what to press when the clipboard cannot be read', async () => {
    mount();
    const [a] = selectTwo();
    act(() => a.blur());
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(async () => 'AAA\nBBB') } });
    await act(async () => { published!.onPaste(); await Promise.resolve(); await Promise.resolve(); });
    expect(rooms().slice(0, 2).map((r) => r.value)).toEqual(['AAA', 'BBB']);
    status.mockClear();
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) } });
    await act(async () => { published!.onPaste(); await Promise.resolve(); await Promise.resolve(); });
    expect(status).toHaveBeenLastCalledWith('Paste: press Ctrl/⌘ V on the schedule');
    status.mockClear();
    vi.stubGlobal('navigator', {});
    await act(async () => { published!.onPaste(); await Promise.resolve(); await Promise.resolve(); });
    expect(status).toHaveBeenLastCalledWith('Paste: press Ctrl/⌘ V on the schedule');
  });

  it('copies the selection to the clipboard', () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount();
    selectTwo();
    act(() => published!.onCopy());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0]).split('\n')).toHaveLength(2);
  });

  it('starts each kind of export, and says so while one runs', async () => {
    mount();
    let finish!: () => void;
    vi.mocked(saveBinary).mockImplementationOnce(() => new Promise<string>((r) => { finish = () => r('Saved'); }));
    act(() => published!.onExport('excel'));
    await flush();
    expect(published!.exporting).toBe(true);
    expect(vi.mocked(saveBinary).mock.calls[0][0]).toBe(`${safeFileName(`${sampleProject.name} ${BOARD} load schedule`)}.xlsx`);
    await act(async () => { finish(); await Promise.resolve(); await Promise.resolve(); });
    expect(published!.exporting).toBe(false);
    await act(async () => { published!.onExport('pack'); await Promise.resolve(); await Promise.resolve(); });
    expect(String(vi.mocked(saveBinary).mock.calls[1][0])).toContain('submission-forms');
    await act(async () => { published!.onExport('pdf'); await Promise.resolve(); });
    expect(vi.mocked(savePdf).mock.calls[0][0]).toBe(`${BOARD}-load-schedule.pdf`); // the DB schedule PDF
    await act(async () => { published!.onExport('csv'); await Promise.resolve(); });
    expect(vi.mocked(saveCsv)).toHaveBeenCalledTimes(1);
    act(() => published!.onExport('template'));
    await flush();
    expect(document.body.textContent).toContain('No template chosen yet');
  });

  it('prints the form on screen as the form PDF on the other forms, and turns the DB-only tools off', async () => {
    shown = sampleProject.boards.find((b) => !b.upstreamId)!.id; // a main board opens on its connected load & MD form
    mount();
    expect(document.body.textContent).toContain('Connected load, maximum demand');
    expect(published).toMatchObject({ grid: false, row: undefined });
    await act(async () => { published!.onExport('pdf'); await Promise.resolve(); await Promise.resolve(); });
    expect(String(vi.mocked(savePdf).mock.calls[0][0])).toContain('connected-load-MD.pdf');
    expect(vi.mocked(saveBinary)).not.toHaveBeenCalled();
  });
});

/** A circuit with its breaker sized by hand far too small for its load. */
const tooSmall = (p: Project, id: string) => updateCircuit(p, id, { breakerRatingA: 6 });
/** A lighting circuit with its wire chosen below the 2.5 mm² minimum. */
const thinWire = (p: Project, id: string) => updateCircuit(p, id, { cableCsaMm2: 1.5 });
/** The sample with a second DB on the first floor, with one circuit (a cooker on a 6 A breaker when `broken`). */
const withSecondDb = (broken: boolean) => {
  const db = sampleProject.boards.find((b) => b.id === BOARD)!;
  const added = addCircuit({ ...sampleProject, boards: [...sampleProject.boards, { ...db, id: 'DB-FF1', name: 'First floor DB', upstreamId: 'SMDB-FF', spareWays: undefined }] }, 'DB-FF1');
  const p = updateCircuit(added.project, added.id, { points: { cooker: 1 } });
  return broken ? tooSmall(p, added.id) : p;
};
const barText = () => document.querySelector('[aria-label="Circuit to check"]')?.textContent ?? '';
const feeder = (id: string) => latest.feeders.find((f) => f.id === id)!;
const wait = async () => { await act(async () => { await Promise.resolve(); }); };

describe('the board steps', () => {
  it('give the panels either side in the schedule\'s order, across panel types, none at the ends', () => {
    // MDB, then SMDBs, then DBs, then MCCs.
    mount();
    expect(published).toMatchObject({ board: true, prevBoard: 'SMDB-FF', nextBoard: 'MCC-1' });
    act(() => published!.onBoardStep(1));
    expect(visited).toEqual(['MCC-1']);
    expect(published).toMatchObject({ board: true, prevBoard: 'DB-GF1', nextBoard: undefined }); // the MD form of the last panel
    act(() => published!.onBoardStep(-1));
    expect(visited).toEqual(['MCC-1', 'DB-GF1']);
    act(() => published!.onBoardStep(1)); act(() => published!.onBoardStep(1)); // no next: stays
    expect(visited).toEqual(['MCC-1', 'DB-GF1', 'MCC-1']);
  });

  it('start at the first panel, and are off on the TCL summary and the busbar riser', () => {
    shown = 'MDB-1';
    mount();
    expect(published).toMatchObject({ board: true, prevBoard: undefined, nextBoard: 'SMDB-GF' });
    act(() => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'TCL summary')!.click(); });
    expect(published).toMatchObject({ board: false, prevBoard: undefined, nextBoard: undefined });
  });
});

describe('Duplicate', () => {
  it('copies the circuit of the active row and says which way it went into', () => {
    mount();
    act(() => published!.onDuplicate()); // no active row
    expect(latest).toBe(sampleProject);
    act(() => rooms()[0].focus());
    const ref = published!.row!;
    const n = circuits().length;
    act(() => published!.onDuplicate());
    expect(circuits()).toHaveLength(n + 1);
    expect(status).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`^Circuit [RYB]\\d+ added as a copy of ${ref}$`)));
  });
});

describe('Check', () => {
  it('counts the failing circuits of the board on screen, not off the DB form', () => {
    start = thinWire(tooSmall(sampleProject, 'DB-GF1-R3'), 'DB-GF1-R1');
    mount();
    expect(published).toMatchObject({ fails: 2, warns: 0 });
    shown = 'MDB-1';
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement('div')));
    mount();
    expect(published).toMatchObject({ fails: 0, warns: 0 });
  });

  it('walks the problem rows in order, selects each, and wraps round', async () => {
    start = thinWire(tooSmall(sampleProject, 'DB-GF1-R3'), 'DB-GF1-R1');
    mount();
    expect(barText()).toBe('');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      act(() => published!.onCheck());
      await wait();
      seen.push(`${barText().match(/Problem (\d) of (\d)/)![0]} ${published!.row}`);
    }
    expect(seen).toEqual(['Problem 1 of 2 R1', 'Problem 2 of 2 R3', 'Problem 1 of 2 R1']);
    expect(barText()).toContain('DB-GF1');
  });

  it('says why and offers the fixes: a wire below the minimum', async () => {
    start = thinWire(sampleProject, 'DB-GF1-R1');
    mount();
    act(() => published!.onCheck());
    expect(barText()).toContain('Wire below the 2.5 mm² minimum for lighting circuits');
    expect(barText()).toContain('Living lighting');
    const fix = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Circuit to check"] button')].find((b) => b.textContent === '2.5 mm² wire')!;
    act(() => fix.click());
    expect(feeder('DB-GF1-R1')).toMatchObject({ cableCsaMm2: 2.5, manualSize: true });
    expect(barText()).toBe(''); // it passes now
    expect(status).toHaveBeenLastCalledWith('R1: 2.5 mm² wire applied');
  });

  it('applies a quick fix as the SLD does, sized by hand; the bar stays while the row still needs checking', () => {
    start = tooSmall(sampleProject, 'DB-GF1-R3');
    mount();
    act(() => published!.onCheck());
    expect(barText()).toContain('Breaker too small');
    const fixes = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Circuit to check"] button.chip')].filter((b) => /^Breaker \d+ A/.test(b.textContent!));
    expect(fixes.length).toBeGreaterThan(0);
    act(() => fixes[0].click());
    expect(feeder('DB-GF1-R3').breakerRatingA).toBeGreaterThan(6);
    expect(feeder('DB-GF1-R3').manualSize).toBe(true);
    // The breaker is right now, but it is near its rating: the bar stays on the circuit and says so.
    expect(barText()).toMatch(/^Problem 1 of 1 · DB-GF1 R3 · Cooker\s*WARNING — Breaker loading \d+ % of In \d+ A\s*Next problem\s*$/);
    expect(status).not.toHaveBeenCalledWith(expect.stringMatching(/applied$/));
  });

  it('closes the bar with its button, when the circuit is deleted, and when the board changes', async () => {
    start = tooSmall(sampleProject, 'DB-GF1-R3');
    mount();
    act(() => published!.onCheck());
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Circuit to check"] [aria-label="Close"]')!.click());
    expect(barText()).toBe('');
    act(() => published!.onCheck());
    expect(barText()).not.toBe('');
    await act(async () => { published!.onDeleteRow(); await Promise.resolve(); });
    expect(barText()).toBe('');
    act(() => published!.onCheck());
    expect(barText()).toBe(''); // nothing left to show on this board
  });

  it('on a clean board goes to the next board with a problem and shows it', async () => {
    start = withSecondDb(true);
    mount();
    expect(published).toMatchObject({ fails: 0, warns: 0 });
    act(() => published!.onCheck());
    await wait();
    expect(visited).toEqual(['DB-FF1']);
    expect(barText()).toMatch(/Problem 1 of 1 · DB-FF1/);
    expect(published!.grid).toBe(true);
    expect(published!.row).toBeDefined();
  });

  it('says so when every schedule is clean', () => {
    mount();
    act(() => published!.onCheck());
    expect(status).toHaveBeenLastCalledWith('Every circuit in every schedule is within limits');
    expect(visited).toEqual([]);
  });

  it('works out other boards\' rows only when Check looks for them', () => {
    start = withSecondDb(false);
    mount();
    const boards = () => new Set(vi.mocked(loadScheduleRows).mock.calls.map((c) => c[1]));
    expect(boards()).toEqual(new Set([BOARD]));
    act(() => rooms()[0].focus());
    expect(boards()).toEqual(new Set([BOARD]));
    act(() => published!.onCheck());
    expect(boards().size).toBeGreaterThan(1);
  });
});

describe('the ribbon\'s tools on the connected load & MD form', () => {
  const MDB = 'MDB-1';
  const feedersOf = () => latest.feeders.filter((f) => f.boardId === MDB);
  /** The first input of the row of this outgoing feeder, found by its bin. */
  const feederCell = (id: string) => document.querySelector(`button[aria-label="Delete feeder ${id}"]`)!.closest('tr')!.querySelector<HTMLInputElement>('input[data-cell]')!;

  it('adds a feeder and 3-phase or 1-phase spares and spaces', () => {
    shown = MDB;
    mount();
    expect(published).toMatchObject({ form: 'md', grid: false, row: undefined });
    const n = feedersOf().length;
    act(() => published!.onAddCircuit());
    expect(feedersOf()).toHaveLength(n + 1);
    const ways = () => spareWaysOf(latest.boards.find((b) => b.id === MDB)!).map((w) => `${w.kind}:${w.phase}`);
    act(() => published!.onAddSpare('spare', 'three'));
    act(() => published!.onAddSpare('space', 'one'));
    act(() => published!.onAddSpare('spare', 'one'));
    expect(ways()).toEqual(['spare:RYB', 'space:R', 'spare:R']);
  });

  it('duplicates and deletes the active feeder, and says why a feeder to a panel cannot be', async () => {
    shown = MDB;
    mount();
    act(() => feederCell('DB-EV').focus());
    expect(published).toMatchObject({ row: 'DB-EV', rowBlock: undefined, dupBlock: undefined });
    const n = feedersOf().length;
    act(() => published!.onDuplicate());
    expect(feedersOf()).toHaveLength(n + 1);
    expect(status).toHaveBeenLastCalledWith(expect.stringMatching(/^Added .+ as a copy of DB-EV$/));
    await act(async () => { published!.onDeleteRow(); await Promise.resolve(); });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Delete outgoing feeder DB-EV /));
    expect(feedersOf()).toHaveLength(n);
    expect(feedersOf().some((f) => f.id === 'DB-EV')).toBe(false);
    // A feeder to a panel: published with its reasons, and Duplicate does nothing.
    act(() => feederCell('INC-GF').focus());
    expect(published!.row).toBe('INC-GF → SMDB-GF');
    expect(published!.rowBlock).toMatch(/supplies SMDB-GF/);
    expect(published!.dupBlock).toBe('INC-GF supplies SMDB-GF — copy the board on the SLD tab');
    const before = latest;
    act(() => published!.onDuplicate());
    expect(latest).toBe(before);
  });

  it('deletes a spare way after asking, and opens the row dialog for Edit', async () => {
    shown = MDB;
    mount();
    act(() => published!.onAddSpare('spare', 'three'));
    const bin = document.querySelector('button[aria-label="Delete spare"]')!;
    act(() => bin.closest('tr')!.querySelector<HTMLInputElement>('input[data-cell]')!.focus());
    expect(published!.row).toMatch(/^SPARE/);
    expect(published!.dupBlock).toBe('Add another one from Spare');
    act(() => published!.onEditRow());
    expect(document.querySelector('.circuit-edit, [role="dialog"]')).not.toBeNull();
    await act(async () => { published!.onDeleteRow(); await Promise.resolve(); });
    expect(window.confirm).toHaveBeenCalledWith(`Delete this spare from ${MDB}?`);
    expect(spareWaysOf(latest.boards.find((b) => b.id === MDB)!)).toHaveLength(0);
  });

  it('fills down, copies and pastes on the form\'s grid, and opens the form details', async () => {
    const onSettings = vi.fn();
    shown = MDB;
    act(() => root.render(<LoadScheduleView project={sampleProject} boardId={MDB} db={EMPTY_DATABASE} onBoard={() => {}} onChange={() => {}} onStatus={status} onSettings={onSettings} onSchedule={(s) => { published = s; }} />));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText, readText: vi.fn(async () => '1') } });
    act(() => feederCell('DB-EV').focus());
    act(() => published!.onCopy());
    expect(writeText).toHaveBeenCalledTimes(1);
    act(() => published!.onFormDetails());
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});

describe('the ribbon\'s tools on the TCL summary', () => {
  const openTx = () => { shown = 'MDB-1'; mount(); act(() => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'TCL summary')!.click(); }); };
  const mains = () => latest.boards.filter((b) => !b.upstreamId);

  it('adds a transformer in the selected substation, and a new substation', () => {
    openTx();
    expect(published).toMatchObject({ form: 'tx', grid: false, row: undefined });
    const n = mains().length;
    act(() => published!.onAddTransformer(false));
    expect(mains()).toHaveLength(n + 1);
    const added = mains()[n];
    expect(added.substation).toBe(published!.substation); // the last substation on the form
    // Select the first transformer: its substation is what Add transformer uses.
    const tr = document.querySelector('tr[title^="Double-click to edit this transformer"]')!;
    act(() => { tr.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(published!.row).toBe(mains()[0].txRef ?? mains()[0].id);
    const groups = new Set(mains().map((b) => b.substation));
    act(() => published!.onAddTransformer(true));
    expect(mains()).toHaveLength(n + 2);
    expect(new Set(mains().map((b) => b.substation)).size).toBe(groups.size + 1);
  });

  it('edits and removes the selected transformer', async () => {
    openTx();
    act(() => published!.onAddTransformer(false)); // a new one with nothing below it, so it can go
    const id = mains()[mains().length - 1].id;
    const trs = [...document.querySelectorAll('tr[title^="Double-click to edit this transformer"]')];
    act(() => published!.onEditRow()); // none selected: nothing
    expect(document.querySelector('.row-edit')).toBeNull();
    act(() => { trs[trs.length - 1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(published!.row).toBe(id);
    act(() => published!.onEditRow());
    expect(document.querySelector('.row-edit')).not.toBeNull();
    act(() => { document.querySelector<HTMLButtonElement>('.row-edit button[type="button"]')?.click(); });
    await act(async () => { published!.onDeleteRow(); await Promise.resolve(); });
    expect(window.confirm).toHaveBeenCalledWith(`Remove ${id}?`);
    expect(latest.boards.some((b) => b.id === id)).toBe(false);
    expect(published!.row).toBeUndefined(); // the selected transformer is gone
  });
});
