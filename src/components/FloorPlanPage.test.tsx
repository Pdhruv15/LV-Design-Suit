// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloorPlanPage from './FloorPlanPage';
import { useFloorPlan, type FloorPlanState } from './floorPlanState';
import { readCadDrawing } from '../engines/cad/reader';
import { sampleProject } from '../data/sampleProject';
import { buildingInfoOf } from '../calc/building';
import type { Project } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no canvas drawing or resize observer: drawing is skipped, the page still works.
class Stub { moveTo() {} lineTo() {} closePath() {} observe() {} disconnect() {} }
Object.assign(globalThis, { Path2D: Stub, ResizeObserver: Stub });
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const drawing = readCadDrawing(new Uint8Array(readFileSync(path.resolve(__dirname, '../../tests/fixtures/cad/plan-2018.dwg'))));
const villa: Project = {
  ...sampleProject, cadLayers: undefined, cadRoomTypes: undefined, cadPlanLinks: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: 40 }] }
};

let root: Root, host: HTMLDivElement;
let state: FloorPlanState;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; delete (window as { lvds?: unknown }).lvds; });
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

/** The page as the app hosts it: its state in the hook, each change applied to the project. */
function Host({ open, onChange }: { open: boolean; onChange: (p: Project, m: string) => void }) {
  const [project, setProject] = useState(villa);
  const fp = useFloorPlan(project.id);
  state = fp;
  useEffect(() => { if (open) fp.setPlan({ file: 'GF.dwg', path: '/plans/GF.dwg', drawing }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <FloorPlanPage project={project} fp={fp} onChange={(p, m) => { setProject(p); onChange(p, m); }} onStatus={() => {}} />;
}

describe('Floor plan page', () => {
  it('offers to open a plan, and to reopen the one the project had', () => {
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan: vi.fn(), readPlan: vi.fn() } };
    localStorage.setItem(`lvds.floorPlan.${villa.id ?? 'new'}`, '/plans/GF.dwg');
    act(() => root.render(<Host open={false} onChange={() => {}} />));
    expect(button('Open plan…')).toBeDefined();
    expect(button('Reopen GF.dwg')).toBeDefined();
  });

  it('shows the plan with the rooms in the model, and adds the found rooms in one change', () => {
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan: vi.fn() } };
    const onChange = vi.fn();
    act(() => root.render(<Host open onChange={onChange} />));
    expect(document.body.textContent).toContain('GF.dwg · DWG ·');
    expect((document.querySelector('select[aria-label="Units of this plan"]') as HTMLSelectElement).value).toBe('mm');
    expect(document.body.textContent).toMatch(/8 rooms on the plan · 8 not added/);
    expect(localStorage.getItem(`lvds.floorPlan.${villa.id ?? 'new'}`)).toBe('/plans/GF.dwg');
    act(() => button('Add found rooms').click());
    const [next, message] = onChange.mock.calls[0] as [Project, string];
    expect(message).toMatch(/^8 rooms from the plan added or updated on Ground/);
    expect(buildingInfoOf(next).rooms).toHaveLength(8);
    expect(document.body.textContent).toMatch(/8 rooms on the plan · 0 not added/);
    expect(document.querySelectorAll('.fp-list tbody tr').length).toBe(8);
  });

  it('moves to the panel of the tool chosen on the ribbon', () => {
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan: vi.fn() } };
    act(() => root.render(<Host open onChange={() => {}} />));
    act(() => state.setTool('link'));
    expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Cables');
    expect(document.body.textContent).toContain('Link clicks to feeder');
    act(() => state.setTool('place'));
    expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Boards');
    act(() => button('Apply plan boards').click());
    expect(document.body.textContent).toMatch(/boards? placed from the plan/);
  });

  it('places ELV devices with a click, lists them per room, and deletes the selected one with the Delete key', () => {
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan: vi.fn() } };
    const onChange = vi.fn();
    act(() => root.render(<Host open onChange={onChange} />));
    act(() => button('Add found rooms').click());
    act(() => state.setTool('elv-place'));
    expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('ELV');
    expect(document.body.textContent).toContain('Fire alarm devices');
    expect(document.querySelector('.fp-readout')?.textContent).toBe('Smoke detector · 7.5 m radius');
    // A click in the middle of the canvas (jsdom: the canvas sits at 0, 0 and the plan is fitted to 800 × 500).
    const canvas = document.querySelector('canvas')!;
    act(() => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 250 }));
      canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 400, clientY: 250 }));
    });
    const [placed, message] = onChange.mock.calls[onChange.mock.calls.length - 1] as [Project, string];
    expect(message).toMatch(/^Smoke detector E1 added/);
    expect(placed.elvDevices).toHaveLength(1);
    expect(document.querySelector('.elv-pal [aria-pressed=true]')?.textContent).toContain('Smoke detector');
    expect(document.querySelector('.elv-pal [aria-pressed=true] b')?.textContent).toBe('1');
    expect(document.body.textContent).toContain('Smoke detector E1');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); });
    const [after, deleted] = onChange.mock.calls[onChange.mock.calls.length - 1] as [Project, string];
    expect(deleted).toBe('Smoke detector E1 deleted · ⌘Z to undo');
    expect(after.elvDevices).toEqual([]);
  });

  it('shows the units the drawing says, and rescales the rooms from the plan when they are changed', () => {
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan: vi.fn() } };
    const onChange = vi.fn();
    act(() => root.render(<Host open onChange={onChange} />));
    const units = document.querySelector('select[aria-label="Units of this plan"]') as HTMLSelectElement;
    expect(units.value).toBe('mm');
    expect(units.selectedOptions[0].textContent).toBe('Millimetres (drawing)');
    act(() => button('Add found rooms').click());
    const area = (p: Project) => buildingInfoOf(p).rooms.find((r) => r.outline)!.areaM2;
    const before = area(onChange.mock.calls[0][0] as Project);
    act(() => { units.value = 'cm'; units.dispatchEvent(new Event('change', { bubbles: true })); });
    const [next, message] = onChange.mock.calls[onChange.mock.calls.length - 1] as [Project, string];
    expect(message).toMatch(/^GF\.dwg is drawn in centimetres — 8 rooms and 0 ELV devices on this level rescaled/);
    expect(area(next)).toBeCloseTo(before * 100, 1);
    expect(next.cadPlanUnits).toEqual({ 'gf.dwg': 'cm' });
    // Taking the rooms recorded the units the plan was read in, before the change.
    expect((onChange.mock.calls[0][0] as Project).cadPlanUnits).toEqual({ 'gf.dwg': 'mm' });
  });

  it('keeps the outlines of the rooms added from the plan, so ELV devices find their room', () => {
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan: vi.fn() } };
    const onChange = vi.fn();
    act(() => root.render(<Host open onChange={onChange} />));
    act(() => button('Add found rooms').click());
    const [next] = onChange.mock.calls[0] as [Project, string];
    expect(buildingInfoOf(next).rooms.filter((r) => r.outline && r.outline.length >= 3)).toHaveLength(8);
  });
});
