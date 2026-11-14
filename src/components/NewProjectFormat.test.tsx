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
const select = () => [...document.querySelectorAll('label')].find((l) => l.textContent?.startsWith('DB schedule format'))!.querySelector('select')!;
const seed = () => saveFormats(withFormat([], 'Office DB', { ...newSheet(), link: { category: 'db', cells: {}, firstRow: 6, rows: [], columns: { A: 'row.ref' } } }).list);

describe('new project: DB schedule format', () => {
  it('offers General first and each saved format, with the muted line for each case', () => {
    show();
    expect([...select().options].map((o) => o.textContent)).toEqual(["General — the app's load schedule"]);
    expect(select().value).toBe('');
    expect(document.body.textContent).toContain("Save a layout as a format in Sheets (Link columns) to choose it here. SMDB, MDB, MCC and the load summary use the app's own tables.");
    act(() => root.unmount());
    seed();
    root = createRoot(document.body.appendChild(document.createElement('div')));
    show();
    expect([...select().options].map((o) => o.textContent)).toEqual(["General — the app's load schedule", 'Office DB — yours']);
    expect(document.body.textContent).toContain("Your own layout for DB schedules, from My formats in Sheets. SMDB, MDB, MCC and the load summary use the app's own tables.");
  });

  it('creating passes the chosen format as the fifth argument, and none for General', () => {
    seed();
    show();
    const go = () => {
      act(() => document.querySelector<HTMLButtonElement>('.home-act')!.click());
      for (let i = 0; i < 4; i++) act(() => [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent === 'Next')!.click());
      act(() => [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent === 'Create project')!.click());
    };
    act(() => { const sel = select(); sel.value = (JSON.parse(localStorage.getItem(FORMATS_KEY)!) as { id: string }[])[0].id; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    go();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][4]).toMatchObject({ name: 'Office DB' });
    act(() => root.unmount());
    onCreate.mockClear();
    root = createRoot(document.body.appendChild(document.createElement('div')));
    show();
    go();
    expect(onCreate.mock.calls[0][4]).toBeUndefined();
  });
});
