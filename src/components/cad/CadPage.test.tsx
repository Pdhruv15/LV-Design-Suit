// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CadPage from './CadPage';
import { useCad, type CadState } from './cadState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no canvas drawing or resize observer: drawing is skipped, the page still works.
class Stub { moveTo() {} lineTo() {} closePath() {} observe() {} disconnect() {} }
Object.assign(globalThis, { Path2D: Stub, ResizeObserver: Stub });
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const root0 = path.resolve(__dirname, '../../..');
const bytes = (rel: string) => new Uint8Array(readFileSync(path.join(root0, rel)));
let root: Root, host: HTMLDivElement, state: CadState;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear();
  (window as { lvds?: unknown }).lvds = { cadFile: {
    engine: async () => bytes('electron/cad/lvds_cad_reader_bg.wasm'),
    sampleBytes: vi.fn(async (name: string) => ({ file: name, bytes: bytes(`electron/samples/${name}`) })),
    openBytes: vi.fn(async () => ({ file: 'plan.dwg', path: '/plans/plan.dwg', bytes: bytes('tests/fixtures/cad/plan-2018.dwg') }))
  } };
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; delete (window as { lvds?: unknown }).lvds; });

function Host() { const cad = useCad('p1'); state = cad; return <CadPage cad={cad} projectId="p1" onStatus={() => {}} />; }
const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const command = async (text: string) => {
  const input = document.querySelector('input[aria-label="Command"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { input.form!.requestSubmit(); });
};

describe('CAD view', () => {
  it('opens the sample villa by default, with its layers, a command line and a status bar', async () => {
    act(() => root.render(<Host />));
    await flush();
    expect(state.view?.file).toBe('sample-villa-gf.dxf');
    expect(document.body.textContent).toContain('Sample plan for testing');
    expect(document.body.textContent).toMatch(/sample-villa-gf\.dxf · DXF · mm · 1 : 1/);
    expect(button('A-WALLon')).toBeDefined();
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/^Command: OPEN {2}sample-villa-gf\.dxf — DXF/);
  });

  it('turns layers off and on, and toggles snaps from the status bar, the command line and the function keys', async () => {
    act(() => root.render(<Host />));
    await flush();
    const wall = state.view!.info.layers.findIndex((l) => l.name === 'A-WALL');
    act(() => button('A-WALLon').click());
    expect(state.layersOn[wall]).toBe(0);
    act(() => button('All on').click());
    expect(state.layersOn[wall]).toBe(1);
    expect(state.toggles.osnap).toBe(true);
    act(() => button('OSNAP').click());
    expect(state.toggles.osnap).toBe(false);
    await command('grid');
    expect(state.toggles.grid).toBe(true);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })); });
    expect(state.toggles.ortho).toBe(true);
    await command('xyz');
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/Unknown command "XYZ"/);
  });

  it('opens a DWG from the desktop dialog with OPEN', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('open');
    await flush();
    expect(state.view?.file).toBe('plan.dwg');
    expect(state.view?.info.format).toBe('DWG');
    expect(localStorage.getItem('lvds.cad.p1')).toBe('/plans/plan.dwg');
  });
});
