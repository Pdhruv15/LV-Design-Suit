// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewProjectWizard } from './BriefEditor';
import { BUILT_IN_REFERENCES } from '../model/designReference';
import { FORMATS_KEY, saveFormats, withFormat } from '../model/scheduleFormats';
import { newSheet } from '../model/sheets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const onCreate = vi.fn();
beforeEach(() => { localStorage.removeItem(FORMATS_KEY); onCreate.mockClear(); root = createRoot(document.body.appendChild(document.createElement('div'))); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; localStorage.removeItem(FORMATS_KEY); });

const show = () => act(() => root.render(<NewProjectWizard initialName="Villa" references={BUILT_IN_REFERENCES} onQuick={() => {}} onCreate={onCreate} onCancel={() => {}} />));
const select = (label = 'DB') => [...document.querySelectorAll('label')].find((l) => l.textContent?.startsWith(`${label} schedule format`))!.querySelector('select')!;
const texts = (label: string) => [...select(label).options].map((o) => o.textContent);
const dbSheet = { ...newSheet(), link: { category: 'db' as const, cells: {}, firstRow: 6, rows: [], columns: { A: 'row.ref' } } };
const mdSheet = { ...newSheet(), link: { category: 'md' as const, cells: {}, firstRow: 6, rows: [], columns: { A: 'row.name' } } };
const seed = () => saveFormats(withFormat(withFormat([], 'Office DB', dbSheet).list, 'Office panel', mdSheet).list);
const idOf = (name: string) => (JSON.parse(localStorage.getItem(FORMATS_KEY)!) as { id: string; name: string }[]).find((f) => f.name === name)!.id;
const choose = (label: string, value: string) => act(() => { const sel = select(label); sel.value = value; sel.dispatchEvent(new Event('change', { bubbles: true })); });

describe('new project: schedule formats', () => {
  it('has four selects, General first, each listing only the formats of its kind, with the muted line for each case', () => {
    show();
    expect(texts('DB')).toEqual(["General — the app's load schedule"]);
    for (const c of ['SMDB', 'MDB', 'MCC']) expect(texts(c)).toEqual(["General — the app's panel form"]);
    expect(select('DB').value).toBe('');
    expect(document.body.textContent).toContain("Save a layout as a format in Sheets (Link columns) to choose it here. The load summary uses the app's own table.");
    act(() => root.unmount());
    seed();
    root = createRoot(document.body.appendChild(document.createElement('div')));
    show();
    expect(texts('DB')).toEqual(["General — the app's load schedule", 'Office DB — yours']);
    for (const c of ['SMDB', 'MDB', 'MCC']) expect(texts(c)).toEqual(["General — the app's panel form", 'Office panel — yours']);
    expect(document.body.textContent).toContain("Your own layouts, from My formats in Sheets. The load summary uses the app's own table.");
  });

  it('creating passes the chosen formats by category as the fifth argument, and none for General', () => {
    seed();
    show();
    const go = () => {
      act(() => document.querySelector<HTMLButtonElement>('.home-act')!.click());
      for (let i = 0; i < 4; i++) act(() => [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent === 'Next')!.click());
      act(() => [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent === 'Create project')!.click());
    };
    choose('DB', idOf('Office DB'));
    choose('SMDB', idOf('Office panel'));
    choose('MCC', idOf('Office panel'));
    go();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const chosen = onCreate.mock.calls[0][4];
    expect(Object.keys(chosen).sort()).toEqual(['db', 'mcc', 'smdb']);
    expect([chosen.db.name, chosen.smdb.name, chosen.mcc.name]).toEqual(['Office DB', 'Office panel', 'Office panel']);
    act(() => root.unmount());
    onCreate.mockClear();
    root = createRoot(document.body.appendChild(document.createElement('div')));
    show();
    go();
    expect(onCreate.mock.calls[0][4]).toEqual({});
  });
});
