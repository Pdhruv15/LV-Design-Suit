import wasmUrl from '../../../electron/cad/lvds_cad_reader_bg.wasm?url';
import sampleGf from '../../../electron/samples/sample-villa-gf.dxf?url';
import sampleFf from '../../../electron/samples/sample-villa-ff.dxf?url';
import { parseReaderAnswer, type CadDrawing } from '../../model/cadDrawing';

/** Floor plans in the web version (no desktop app): the same built-in reader (acadrust, WebAssembly) run in the page,
 * plans chosen with the browser's file picker, and the sample plans served with the app. Nothing leaves the computer. */

export type CadFileApi = NonNullable<NonNullable<Window['lvds']>['cadFile']>;

/** Largest drawing read (bytes), as in the desktop app. */
const MAX_BYTES = 100 * 1024 * 1024;
const SAMPLES: Record<string, string> = { 'sample-villa-gf.dxf': sampleGf, 'sample-villa-ff.dxf': sampleFf };

let reader: Promise<{ readDrawing: (bytes: Uint8Array) => string }> | null = null;
async function load() {
  const m = await import('../../../electron/cad/lvds_cad_reader.js');
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error('The floor plan reader could not be loaded.');
  m.initSync({ module: new Uint8Array(await res.arrayBuffer()) });
  return m;
}

/** Reads a DWG (R13–2018) or DXF drawing from its bytes. */
export async function readInPage(name: string, bytes: Uint8Array): Promise<CadDrawing> {
  if (!/\.(dwg|dxf)$/i.test(name)) throw new Error(`${name} is not a DWG or DXF file.`);
  if (!bytes.length) throw new Error(`${name} is empty.`);
  if (bytes.length > MAX_BYTES) throw new Error(`${name} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const m = await (reader ??= load().catch((e) => { reader = null; throw e; }));
  let json: string;
  try {
    json = m.readDrawing(bytes);
  } catch (e) {
    throw new Error(`${name} could not be read (${(e as Error).message}). Reload the page before opening another plan.`);
  }
  return parseReaderAnswer(json);
}

/** The browser's file picker for one DWG / DXF; null when cancelled. */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dwg,.dxf';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

export const webCadFile: CadFileApi = {
  openPlan: async () => {
    const f = await pickFile();
    if (!f) return null;
    return { file: f.name, drawing: await readInPage(f.name, new Uint8Array(await f.arrayBuffer())) };
  },
  readSample: async (name) => {
    const url = SAMPLES[name];
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`The sample plan ${name} could not be loaded.`);
    return { file: name, drawing: await readInPage(name, new Uint8Array(await res.arrayBuffer())) };
  }
};

/** The floor plan reader: the desktop app's, else the page's own in a browser that runs WebAssembly. */
export const cadFileApi = (): CadFileApi | undefined =>
  window.lvds?.cadFile ?? (typeof WebAssembly === 'object' ? webCadFile : undefined);
