// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloorPlanView from './FloorPlanView';
import { readCadDrawing } from '../engines/cad/reader';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no canvas drawing or resize observer: drawing is skipped, the window still works.
class Stub { moveTo() {} lineTo() {} closePath() {} observe() {} disconnect() {} }
Object.assign(globalThis, { Path2D: Stub, ResizeObserver: Stub });
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const drawing = readCadDrawing(new Uint8Array(readFileSync(path.resolve(__dirname, '../../tests/fixtures/cad/plan-2018.dwg'))));
const villa: Project = {
  ...sampleProject, cadLayers: undefined, cadRoomTypes: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: 40 }] }
};

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; delete (window as { lvds?: unknown }).lvds; });
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('Floor plan window', () => {
  it('says the desktop app is needed in the browser version', () => {
    act(() => root.render(<FloorPlanView project={villa} onApply={() => {}} onClose={() => {}} />));
    expect(document.body.textContent).toContain('needs the LV Design Studio desktop app');
  });

  it('opens a DWG, lists the rooms it finds and adds them to Building information', async () => {
    const openPlan = vi.fn(async () => ({ file: 'GF plan.dwg', drawing }));
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan } };
    const onApply = vi.fn();
    act(() => root.render(<FloorPlanView project={villa} onApply={onApply} onClose={() => {}} />));
    expect(button('Find rooms').disabled).toBe(true);
    await act(async () => { button('Open floor plan…').click(); });
    expect(openPlan).toHaveBeenCalled();
    const text = document.body.textContent!;
    expect(text).toContain('GF plan.dwg · DWG · drawing in mm');
    expect(text).toMatch(/Rooms found: 8/);
    expect(text).toMatch(/Majlis.*40\.00 →/);
    const rows = document.querySelectorAll('.fp-list tbody tr');
    expect(rows.length).toBe(8);
    act(() => (rows[1] as HTMLElement).click());
    expect((document.querySelector('.fp-form input') as HTMLInputElement).value).toBeTruthy();
    act(() => button('Add to Building information').click());
    const [next, message] = onApply.mock.calls[0] as [Project, string];
    expect(message).toMatch(/^Floor plan: \d+ rooms on Ground updated$/);
    expect(next.building!.rooms.length).toBe(8);
    expect(next.building!.rooms.find((r) => r.id === 'R1')!.source).toMatchObject({ app: 'cad', file: 'GF plan.dwg' });
  });

  it('shows the layers for mapping', async () => {
    (window as { lvds?: unknown }).lvds = { cadFile: { openPlan: async () => ({ file: 'GF plan.dwg', drawing }) } };
    act(() => root.render(<FloorPlanView project={villa} onApply={() => {}} onClose={() => {}} />));
    await act(async () => { button('Open floor plan…').click(); });
    act(() => button('Layers…').click());
    expect(document.querySelector('.fp-layers')?.textContent).toContain('A-ROOM-NAME');
  });
});
