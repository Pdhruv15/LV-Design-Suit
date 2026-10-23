// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EquipmentPalette from './EquipmentPalette';
import SystemDiagram from './SystemDiagram';
import { getArmedItem, setArmedItem, subscribeArmedItem } from '../diagram/dragItem';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from '../calc/electrical';
import { canDrop, dropsOn, itemKey, PALETTE, type DropTarget, type PaletteItem } from '../model/sldEdit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; setArmedItem(null); });

const tile = (name: string) => [...document.querySelectorAll<HTMLElement>('.palette-tile')].find((t) => t.querySelector('.palette-tname')?.textContent === name)!;
const cat = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.palette-cat')].find((b) => b.textContent === name)!;
const click = (el: Element, init: MouseEventInit = {}) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })); });

describe('dropsOn', () => {
  it('covers every target canDrop allows in the sample project', () => {
    const targets: DropTarget[] = [
      { type: 'canvas' },
      ...sampleProject.boards.map((b) => ({ type: 'bus' as const, boardId: b.id })),
      ...sampleProject.feeders.map((f) => ({ type: 'feeder' as const, feederId: f.id }))
    ];
    for (const { entries } of PALETTE) {
      for (const { item } of entries) {
        const where = dropsOn(item);
        expect(where.length, itemKey(item)).toBeGreaterThan(0);
        for (const t of targets) if (canDrop(sampleProject, item, t)) expect(where, `${itemKey(item)} on ${t.type}`).toContain(t.type);
      }
    }
  });
});

describe('armed item store', () => {
  it('notifies on change only', () => {
    const l = vi.fn();
    const off = subscribeArmedItem(l);
    const item: PaletteItem = { kind: 'cable' };
    setArmedItem(item);
    setArmedItem(item);
    setArmedItem(null);
    off();
    setArmedItem(item);
    expect(l).toHaveBeenCalledTimes(2);
  });
});

describe('<EquipmentPalette>', () => {
  const render = (props: Partial<Parameters<typeof EquipmentPalette>[0]> = {}) => {
    const onHint = vi.fn(), onQty = vi.fn();
    act(() => root.render(<EquipmentPalette docked onHint={onHint} onQty={onQty} {...props} />));
    return { onHint, onQty };
  };

  it('shows category tiles and one category of item tiles at a time', () => {
    render();
    expect([...document.querySelectorAll('.palette-cat')].map((b) => b.textContent)).toEqual(['Supply', 'Boards', 'Protection', 'Metering', 'Cable', 'Starters', 'Loads', 'Presets', 'My presets', 'Components']);
    expect(cat('Loads').getAttribute('aria-selected')).toBe('true');
    expect(tile('Fire pump')).toBeTruthy();
    click(cat('Boards'));
    const names = [...document.querySelectorAll('.palette-tname')].map((t) => t.textContent);
    expect(names).toEqual(expect.arrayContaining(['MDB', 'SMDB', 'DB', 'MCC panel'])); // boards and package panels together
    expect(names).not.toContain('Fire pump');
    expect(tile('MDB').querySelectorAll('.palette-dots i')).toHaveLength(2); // busbar (under a meter cabinet) or canvas
  });

  it('click arms an item, a second click or Esc disarms it; shift-click arms × 3', () => {
    const { onHint, onQty } = render();
    click(tile('AHU'));
    expect(getArmedItem()).toEqual({ kind: 'load', preset: 'ahu' });
    expect(tile('AHU').getAttribute('aria-pressed')).toBe('true');
    expect(onQty).toHaveBeenLastCalledWith(1);
    expect(onHint).toHaveBeenLastCalledWith(expect.stringContaining('click a busbar'));
    click(tile('AHU'));
    expect(getArmedItem()).toBeNull();
    click(tile('Chiller'), { shiftKey: true });
    expect(onQty).toHaveBeenLastCalledWith(3);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(getArmedItem()).toBeNull();
    expect(onQty).toHaveBeenLastCalledWith(1);
  });

  it('pins favourites and recently used items in a strip', () => {
    render();
    expect(document.querySelector('.palette-strip')).toBeNull();
    click(tile('EV charger').querySelector('.fav')!);
    click(tile('Lighting'));
    expect(document.querySelectorAll('.palette-strip .palette-mini')).toHaveLength(2);
    expect(document.querySelectorAll('.palette-strip .palette-mini-fav')).toHaveLength(1);
  });

  it('search lists matches from every category', () => {
    render();
    const input = document.querySelector<HTMLInputElement>('.palette-search')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'rcd');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelector('.palette-cats')).toBeNull();
    expect([...document.querySelectorAll('.palette-tname')].map((t) => t.textContent)).toContain('Earth leakage (RCD)');
  });
});

describe('click to place on the drawing', () => {
  const draw = (onDropItem: (i: PaletteItem, t: DropTarget) => void) => {
    const p = sampleProject;
    act(() => root.render(<SystemDiagram project={p} calcProject={p} results={evaluateProject(p)} selectedFeederId={null} selectedBoardId={null} onSelectFeeder={() => {}} onSelectBoard={() => {}} onDropItem={onDropItem} />));
    return host.querySelector<SVGSVGElement>('.sysdiag > svg')!;
  };
  const under = (el: Element | null) => { document.elementFromPoint = () => el; };
  (SVGElement.prototype as unknown as { getScreenCTM: () => null }).getScreenCTM = () => null; // not in jsdom

  it('places the armed item where the drawing is clicked, then disarms', () => {
    const drop = vi.fn();
    const svg = draw(drop);
    under(null);
    setArmedItem({ kind: 'transformer' });
    click(svg);
    expect(drop).toHaveBeenCalledWith({ kind: 'transformer' }, { type: 'canvas' });
    expect(getArmedItem()).toBeNull();
  });

  it('places on a busbar; shift-click keeps it armed; nowhere valid places nothing', () => {
    const drop = vi.fn();
    const svg = draw(drop);
    const bus = svg.querySelector('[data-drop^="bus:"]')!;
    const boardId = bus.getAttribute('data-drop')!.slice(4);
    act(() => setArmedItem({ kind: 'load', preset: 'ahu' }));
    under(null);
    click(svg); // a load can't go on the empty canvas
    expect(drop).not.toHaveBeenCalled();
    expect(getArmedItem()).not.toBeNull();
    under(bus);
    click(bus, { shiftKey: true });
    expect(drop).toHaveBeenCalledWith({ kind: 'load', preset: 'ahu' }, { type: 'bus', boardId });
    expect(getArmedItem()).not.toBeNull();
  });

  it('selects as usual when nothing is armed', () => {
    const drop = vi.fn();
    const svg = draw(drop);
    under(null);
    click(svg);
    expect(drop).not.toHaveBeenCalled();
  });
});
