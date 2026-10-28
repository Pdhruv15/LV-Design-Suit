// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cadFileApi, readInPage, webCadFile } from './webCadFile';

const root = path.resolve(__dirname, '../../..');
const bytes = (rel: string) => new Uint8Array(readFileSync(path.join(root, rel)));

beforeEach(() => {
  // The page fetches the reader and the samples from the app's own files.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const rel = url.includes('.wasm') ? 'electron/cad/lvds_cad_reader_bg.wasm' : url.includes('sample-villa-gf') ? 'electron/samples/sample-villa-gf.dxf' : url.includes('sample-villa-ff') ? 'electron/samples/sample-villa-ff.dxf' : '';
    return rel ? new Response(bytes(rel)) : new Response('', { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); delete (window as { lvds?: unknown }).lvds; });

describe('floor plans in the web version', () => {
  it('reads the sample plans in the page', async () => {
    const gf = await webCadFile.readSample!('sample-villa-gf.dxf');
    expect(gf?.drawing.format).toBe('DXF');
    expect(gf?.drawing.entities.some((e) => e.k === 'insert' && e.attrs.TAG === 'SMDB-GF')).toBe(true);
    expect((await webCadFile.readSample!('sample-villa-ff.dxf'))?.file).toBe('sample-villa-ff.dxf');
    expect(await webCadFile.readSample!('other.dxf')).toBeNull();
  });

  it('reads a DWG chosen in the browser', async () => {
    expect((await readInPage('GF plan.dwg', bytes('tests/fixtures/cad/plan-2018.dwg'))).format).toBe('DWG');
    await expect(readInPage('notes.txt', new Uint8Array([1]))).rejects.toThrow(/not a DWG or DXF/);
    await expect(readInPage('empty.dwg', new Uint8Array())).rejects.toThrow(/empty/);
  });

  it('opens a plan from the file picker, or nothing when cancelled', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [new File([bytes('tests/fixtures/cad/plan-tagged.dxf')], 'GF plan.dxf')] });
      this.dispatchEvent(new Event('change'));
    });
    const r = await webCadFile.openPlan();
    expect(r?.file).toBe('GF plan.dxf');
    expect(r?.drawing.entities.length).toBeGreaterThan(50);
    click.mockImplementation(function (this: HTMLInputElement) { this.dispatchEvent(new Event('cancel')); });
    expect(await webCadFile.openPlan()).toBeNull();
  });

  it('uses the desktop app\'s reader when there is one', () => {
    expect(cadFileApi()).toBe(webCadFile);
    const desktop = { openPlan: vi.fn() };
    (window as { lvds?: unknown }).lvds = { cadFile: desktop };
    expect(cadFileApi()).toBe(desktop);
  });
});
