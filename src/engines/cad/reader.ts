import { initSync, readDrawing } from './generated/lvds_cad_reader.js';
import wasmDataUrl from './generated/lvds_cad_reader_bg.wasm?inline';
import { parseReaderAnswer, type CadDrawing } from '../../model/cadDrawing';

/** The built-in DWG / DXF reader: acadrust compiled to WebAssembly (engines/cad-reader, rebuilt with
 * `npm run build:cad`). Reads DWG R13–2018 and DXF without any CAD program installed. 2D plan entities only. */

/** Largest drawing read (bytes). Architects' plans are a few MB; this keeps a wrong file from filling memory. */
export const MAX_DRAWING_BYTES = 100 * 1024 * 1024;

let ready = false;
function init(): void {
  if (ready) return;
  const b64 = wasmDataUrl.slice(wasmDataUrl.indexOf(',') + 1);
  initSync({ module: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) });
  ready = true;
}

/** Reads a DWG or DXF drawing from its bytes. Throws with the reader's message when the file is not a drawing it can
 * read (a corrupt file, a DWG older than R13, a DXF with broken sections). */
export function readCadDrawing(bytes: Uint8Array): CadDrawing {
  if (bytes.length > MAX_DRAWING_BYTES) throw new Error(`The drawing is larger than ${MAX_DRAWING_BYTES / 1024 / 1024} MB.`);
  if (!bytes.length) throw new Error('The drawing file is empty.');
  init();
  let json: string;
  try {
    json = readDrawing(bytes);
  } catch (e) {
    throw new Error(`The drawing could not be read (${(e as Error).message}).`);
  }
  return parseReaderAnswer(json);
}
