const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** The built-in DWG / DXF reader (acadrust compiled to WebAssembly, electron/cad; rebuilt with `npm run build:cad`),
 * run in the main process: a floor plan the engineer opens is read here and its plan entities go to the window. */

const CAD_DIR = path.join(__dirname, 'cad');
const MAX_BYTES = 100 * 1024 * 1024;
let generation = 0;
let reader;

/** The reader module, set up once. After a read that crashed inside the WebAssembly, a fresh copy is loaded. */
async function load() {
  if (reader) return reader;
  const module = await import(`${pathToFileURL(path.join(CAD_DIR, 'lvds_cad_reader.js')).href}?v=${generation}`);
  module.initSync({ module: fs.readFileSync(path.join(CAD_DIR, 'lvds_cad_reader_bg.wasm')) });
  reader = module;
  return reader;
}

/** Reads a DWG (R13–2018) or DXF file: { format, units, entities } — see src/model/cadDrawing.ts. */
async function readDrawingFile(file) {
  if (!/\.(dwg|dxf)$/i.test(file)) throw new Error(`${path.basename(file)} is not a DWG or DXF file.`);
  const size = fs.statSync(file).size;
  if (!size) throw new Error(`${path.basename(file)} is empty.`);
  if (size > MAX_BYTES) throw new Error(`${path.basename(file)} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const bytes = fs.readFileSync(file);
  const m = await load();
  let answer;
  try {
    answer = JSON.parse(m.readDrawing(bytes));
  } catch (e) {
    reader = undefined;
    generation += 1;
    throw new Error(`${path.basename(file)} could not be read (${e && e.message ? e.message : e}).`);
  }
  if (!answer.ok) throw new Error(`${path.basename(file)} could not be read: ${answer.error}`);
  return answer.drawing;
}

/** A drawing file's bytes for the CAD view (read in the window by the same engine), after the same checks. */
function readDrawingBytes(file) {
  if (!/\.(dwg|dxf)$/i.test(file)) throw new Error(`${path.basename(file)} is not a DWG or DXF file.`);
  const size = fs.statSync(file).size;
  if (!size) throw new Error(`${path.basename(file)} is empty.`);
  if (size > MAX_BYTES) throw new Error(`${path.basename(file)} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  return new Uint8Array(fs.readFileSync(file));
}

/** The engine itself (WebAssembly), for the CAD view in the window. */
const engineBytes = () => new Uint8Array(fs.readFileSync(path.join(CAD_DIR, 'lvds_cad_reader_bg.wasm')));

module.exports = { readDrawingFile, readDrawingBytes, engineBytes, MAX_BYTES };
