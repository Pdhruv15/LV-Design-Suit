// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import CadLoadsDialog from './CadLoadsDialog';
import { openDrawing, type CadView } from '../engines/cad/cadEngine';
import { sampleProject } from '../data/sampleProject';
import type { LibraryLoad } from '../database/database';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const root0 = path.resolve(__dirname, '../..');
const bytes = (rel: string) => new Uint8Array(readFileSync(path.join(root0, rel)));
const library = [{ reference: 'L1', name: 'LED downlight', watts: 12, column: 'ltg' }] as unknown as LibraryLoad[];
let gf: CadView, root: Root, host: HTMLDivElement;
beforeAll(async () => {
  (window as { lvds?: unknown }).lvds = { cadFile: { engine: async () => bytes('electron/cad/lvds_cad_reader_bg.wasm') } };
  gf = await openDrawing('sample-villa-gf.dxf', bytes('electron/samples/sample-villa-gf.dxf'));
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
const show = (view: CadView | null, onOpenCad = vi.fn()) => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<CadLoadsDialog project={sampleProject} library={library} view={view} onOpenCad={onOpenCad} onApply={() => {}} onClose={() => {}} />));
  return onOpenCad;
};
const button = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === t)!;

describe('Loads from CAD (the drawing open in Design CAD)', () => {
  it('asks to open Design CAD when no drawing is open', () => {
    const open = show(null);
    expect(document.body.textContent).toContain('Open the floor plan in Design CAD first');
    act(() => button('Open Design CAD').click());
    expect(open).toHaveBeenCalled();
  });

  it('counts the fixture blocks of the drawing per circuit', async () => {
    show(gf);
    expect(document.body.textContent).toContain('sample-villa-gf.dxf');
    await act(async () => { button('Pull loads').click(); });
    expect(document.body.textContent).toMatch(/\d+ blocks read · \d+ circuits? differ/);
  });
});
