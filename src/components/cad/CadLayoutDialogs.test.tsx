// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutPaperDialog, LayoutTemplatesDialog, ScaleListDialog } from './CadLayoutDialogs';
import { loadLayoutTemplates, saveLayoutTemplates, templateFromPaper } from '../../model/layoutTemplates';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const files = vi.hoisted(() => ({ saveText: vi.fn(async () => 'Saved x') }));
vi.mock('../../util/files', async (orig) => ({ ...(await orig<typeof import('../../util/files')>()), saveText: files.saveText }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; files.saveText.mockClear(); });

const button = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;
const click = (b: Element) => act(() => { (b as HTMLElement).click(); });
const type = (label: string, value: string) => {
  const el = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement | HTMLInputElement;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const rows = () => [...document.querySelectorAll('[aria-label="Layout templates"] tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
const std = (name: string, scale?: number) => templateFromPaper(name, [420, 297], [{ x: 10, y: 10, w: 400, h: 277, scale }]);
const setFile = (text: string) => {
  const input = document.querySelector('[aria-label="Layout template file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => text }] });
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
};

describe('Layout templates dialog', () => {
  const props = () => ({ canSheet: true, onNew: vi.fn(), onStatus: vi.fn(), onClose: vi.fn() });

  it('says so when the library is empty; without a layout showing it cannot save', () => {
    act(() => root.render(<LayoutTemplatesDialog {...props()} />));
    expect(document.body.textContent).toContain('No layout templates yet: open a layout and save it as one.');
    expect(document.body.textContent).toContain('Open a layout tab to save it as a template.');
    expect(button('Save as template')).toBeUndefined();
    expect(button('New layout').disabled).toBe(true);
  });

  it('saves the layout showing under a name (the same name replaces it), lists it, and keeps it in the library', () => {
    const p = props(), make = vi.fn((n: string) => std(n, 100));
    act(() => root.render(<LayoutTemplatesDialog {...p} current={{ name: 'Layout2', make }} />));
    expect((document.querySelector('[aria-label="Template name"]') as HTMLInputElement).value).toBe('Layout2');
    type('Template name', 'Standard A3');
    click(button('Save as template'));
    expect(p.onStatus).toHaveBeenLastCalledWith('Layout template Standard A3 saved to your library');
    expect(rows()).toEqual([['Standard A3', 'A3 landscape', '1 · 1:100', '—']]);
    expect(loadLayoutTemplates().map((t) => t.name)).toEqual(['Standard A3']);
    const id = loadLayoutTemplates()[0].id;
    type('Template name', 'standard a3');
    click(button('Save as template'));
    expect(loadLayoutTemplates().map((t) => [t.name, t.id])).toEqual([['standard a3', id]]);
    type('Template name', ' ');
    expect(button('Save as template').disabled).toBe(true);
  });

  it('makes a layout of the drawing or a plan sheet from the one picked, then closes', () => {
    saveLayoutTemplates([std('Alpha', 50), std('Beta')]);
    const p = props();
    act(() => root.render(<LayoutTemplatesDialog {...p} />));
    expect(rows().map((r) => [r[0], r[2]])).toEqual([['Alpha', '1 · 1:50'], ['Beta', '1 · fit']]);
    click(document.querySelectorAll('[aria-label="Layout templates"] tbody tr')[1]);
    click(button('New layout'));
    expect(p.onNew).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Beta' }), 'drawing');
    expect(p.onClose).toHaveBeenCalledTimes(1);
    type('New layout as', 'power');
    click(button('New layout'));
    expect(p.onNew).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Beta' }), 'power');
  });

  it('plan sheets are not offered when the drawing has no level', () => {
    saveLayoutTemplates([std('Alpha')]);
    act(() => root.render(<LayoutTemplatesDialog {...props()} canSheet={false} />));
    expect([...document.querySelectorAll('[aria-label="New layout as"] option')].map((o) => [o.textContent, (o as HTMLOptionElement).disabled])).toEqual([['Layout of this drawing', false], ['Lighting layout', true], ['Power layout', true], ['ELV layout', true], ['Containment layout', true]]);
  });

  it('imports a good file, refuses a bad one, exports the one picked and deletes it', async () => {
    const p = props();
    act(() => root.render(<LayoutTemplatesDialog {...p} />));
    setFile('{"nope":1}');
    await flush();
    expect(p.onStatus).toHaveBeenLastCalledWith('That file is not a layout template');
    setFile('not json at all');
    await flush();
    expect(p.onStatus).toHaveBeenLastCalledWith('That file is not a layout template');
    setFile(JSON.stringify(std('From a colleague', 200)));
    await flush();
    expect(p.onStatus).toHaveBeenLastCalledWith('Layout template From a colleague imported');
    expect(rows()).toEqual([['From a colleague', 'A3 landscape', '1 · 1:200', '—']]);
    expect(loadLayoutTemplates()).toHaveLength(1);
    await act(async () => { button('Export…').click(); });
    const [name, text, filter, ext] = files.saveText.mock.calls[0] as unknown as [string, string, string, string];
    expect([name, filter, ext, JSON.parse(text).name]).toEqual(['From-a-colleague.layout.json', 'Layout template', 'json', 'From a colleague']);
    expect(p.onStatus).toHaveBeenLastCalledWith('Saved x');
    click(button('Delete'));
    expect(p.onStatus).toHaveBeenLastCalledWith('Layout template From a colleague deleted');
    expect(loadLayoutTemplates()).toEqual([]);
    expect(button('Delete').disabled).toBe(true);
  });
});

describe('Layout page setup dialog', () => {
  const layout = { name: 'Layout2', paper: [420, 297] as [number, number], viewports: [{ x: 10, y: 10, w: 400, h: 277, cx: 0, cy: 0, vh: 20000 }] };
  it('picks a paper and an orientation; the current paper is preselected', () => {
    const onSave = vi.fn(), onClose = vi.fn();
    act(() => root.render(<LayoutPaperDialog layout={layout} onSave={onSave} onClose={onClose} />));
    expect((document.querySelector('[aria-label="Paper"]') as HTMLSelectElement).value).toBe('A3');
    expect(document.querySelector('[aria-label="Orientation"] .on')!.textContent).toBe('Landscape');
    expect(document.body.textContent).toContain('Its viewport keeps its place and scale.');
    type('Paper', 'A1');
    click(button('Portrait'));
    click(button('Save'));
    expect(onSave).toHaveBeenCalledWith([594, 841]);
    expect(onClose).toHaveBeenCalled();
  });
  it('reads a portrait paper, and offers one that is not in the list as it is', () => {
    const onSave = vi.fn();
    act(() => root.render(<LayoutPaperDialog layout={{ ...layout, paper: [297, 420] }} onSave={onSave} onClose={() => {}} />));
    expect(document.querySelector('[aria-label="Orientation"] .on')!.textContent).toBe('Portrait');
    click(button('Save'));
    expect(onSave).toHaveBeenCalledWith([297, 420]);
    act(() => root.unmount()); root = createRoot(host);
    act(() => root.render(<LayoutPaperDialog layout={{ ...layout, paper: [500, 300] }} onSave={onSave} onClose={() => {}} />));
    expect([...document.querySelectorAll('[aria-label="Paper"] option')].map((o) => o.textContent)[0]).toBe('500 × 300 mm');
    click(button('Save'));
    expect(onSave).toHaveBeenLastCalledWith([500, 300]);
    click(button('Portrait')); // a paper of its own turns too
    click(button('Save'));
    expect(onSave).toHaveBeenLastCalledWith([300, 500]);
  });
});

describe('Scale list dialog', () => {
  const ticked = () => [...document.querySelectorAll('[aria-label="Scales"] label')].filter((l) => l.querySelector('input')!.checked).map((l) => l.textContent!.trim());
  it('ticks more standard scales, adds your own, and goes back to the standard list', () => {
    const onSave = vi.fn(), onClose = vi.fn();
    act(() => root.render(<ScaleListDialog scales={[20, 50, 100, 200, 500, 1000]} onSave={onSave} onClose={onClose} />));
    expect(ticked()).toEqual(['1:20', '1:50', '1:100', '1:200', '1:500', '1:1000']);
    const all = [...document.querySelectorAll('[aria-label="Scales"] label')].map((l) => l.textContent!.trim());
    expect(all).toContain('1:75');
    click([...document.querySelectorAll('[aria-label="Scales"] label')].find((l) => l.textContent!.trim() === '1:75')!.querySelector('input')!);
    type('New scale', '33');
    click(button('Add'));
    expect((document.querySelector('[aria-label="New scale"]') as HTMLInputElement).value).toBe('');
    type('New scale', '100'); // already there: nothing is added twice
    click(button('Add'));
    expect(ticked()).toEqual(['1:20', '1:33', '1:50', '1:75', '1:100', '1:200', '1:500', '1:1000']);
    click(button('Save'));
    expect(onSave).toHaveBeenCalledWith([20, 33, 50, 75, 100, 200, 500, 1000]);
    expect(onClose).toHaveBeenCalled();
    click(button('Standard list'));
    expect(ticked()).toEqual(['1:20', '1:50', '1:100', '1:200', '1:500', '1:1000']);
  });
  it('cannot save with none ticked', () => {
    act(() => root.render(<ScaleListDialog scales={[100]} onSave={vi.fn()} onClose={() => {}} />));
    click(document.querySelector('[aria-label="Scales"] input:checked')!);
    expect(button('Save').disabled).toBe(true);
  });
});
