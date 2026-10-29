import { CadDoc, exportDwg, exportDxf, initSync } from '../../../electron/cad/lvds_cad_reader.js';
import type { CadBlock } from '../../model/cadLoads';
import wasmUrl from '../../../electron/cad/lvds_cad_reader_bg.wasm?url';
import sampleGf from '../../../electron/samples/sample-villa-gf.dxf?url';
import sampleFf from '../../../electron/samples/sample-villa-ff.dxf?url';

/** The CAD view's engine: the Rust document (engines/cad-reader/src/doc.rs, WebAssembly) run in the app window, in the
 * desktop app and the web version alike. It opens DWG / DXF and gives the drawing flattened for display (segments with
 * layer and colour, texts) and snapping. Files come from the desktop app's dialog, or the browser's file picker. */

export interface CadLayer { name: string; rgb: number; on: boolean; count: number }
export interface CadText { x: number; y: number; h: number; rot: number; s: string; layer: number; rgb: number; align: number }
export interface CadInfo {
  format: 'DWG' | 'DXF';
  units: number; // INSUNITS
  origin: [number, number];
  extents: [number, number, number, number];
  layers: CadLayer[];
  texts: CadText[];
  segments: number;
  snaps: number;
  truncated: boolean;
  /** Dash patterns in drawing units (dash > 0, gap < 0, dot 0); the first is continuous (empty). */
  linetypes: number[][];
  /** Filled areas: solid hatches and 2D solids, or pattern hatches with their pattern lines (absolute drawing units). */
  fills: CadFill[];
}
/** A filled area; its loops are ranges of drawn segments, each one closed boundary. */
export interface CadFill {
  layer: number;
  rgb: number;
  solid: boolean;
  loops: [number, number][];
  lines: { angle: number; base: [number, number]; offset: [number, number]; dashes: number[] }[];
}
/** One object of model space under a click: its kind, layer, handle, block and attributes, length / area (drawing
 * units), and the range of its drawn segments. */
export interface CadObject {
  id: number;
  kind: string;
  layer: number;
  handle: string;
  block?: string;
  attrs?: Record<string, string>;
  length?: number;
  area?: number;
  radius?: number;
  text?: string;
  vertices?: number;
  closed: boolean;
  seg_start: number;
  seg_end: number;
}
/** An open drawing. Segment coordinates are relative to `info.origin` (drawing units). */
export interface CadView {
  file: string;
  path?: string;
  /** The file as opened, for saving it again with the devices added. */
  bytes: Uint8Array;
  info: CadInfo;
  segs: Float32Array;
  segLayers: Uint16Array;
  segColors: Uint32Array;
  /** The dash pattern of each segment: an index into info.linetypes (0 continuous). */
  segLinetypes: Uint16Array;
  /** Nearest snap point within `r` of (x, y) (drawing units, absolute): [x, y, kind] or empty. */
  snap: (x: number, y: number, r: number, mask: number, layersOn: Uint8Array) => Float64Array;
  /** The object under (x, y) within `tol` (drawing units, absolute) on shown layers; null when none. `closedOnly`:
   * only objects with an area (as for AREA → Object). */
  pick: (x: number, y: number, tol: number, layersOn: Uint8Array, closedOnly?: boolean) => CadObject | null;
  /** Closed objects of model space (polylines, circles, hatches…), for rooms from outline layers. */
  outlines: () => CadObject[];
  /** Blocks inserted in model space with their attributes (fixtures with a CCT attribute: Loads from CAD). */
  blocks: () => (CadBlock & { layer: string; handle: string })[];
}

/** Snap kinds, as the engine numbers them. */
export const SNAP = { endpoint: 1, midpoint: 2, center: 4, intersection: 8, insertion: 16, node: 32, quadrant: 64 } as const;
export const SNAP_NAMES: Record<number, string> = { 1: 'Endpoint', 2: 'Midpoint', 4: 'Centre', 8: 'Intersection', 16: 'Insertion', 32: 'Node', 64: 'Quadrant' };
/** Colour of "foreground" lines (index 7): white on a dark model space, black on a light one. */
export const INK = 0xff000007;

const MAX_BYTES = 100 * 1024 * 1024;
const SAMPLES: Record<string, string> = { 'sample-villa-gf.dxf': sampleGf, 'sample-villa-ff.dxf': sampleFf };

let ready: Promise<void> | null = null;
function engine(): Promise<void> {
  ready ??= (async () => {
    const desktop = window.lvds?.cadFile?.engine;
    const bytes = desktop ? await desktop() : new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
    initSync({ module: bytes });
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/** Opens a drawing from its bytes. */
export async function openDrawing(file: string, bytes: Uint8Array, path?: string): Promise<CadView> {
  if (!/\.(dwg|dxf)$/i.test(file)) throw new Error(`${file} is not a DWG or DXF file.`);
  if (!bytes.length) throw new Error(`${file} is empty.`);
  if (bytes.length > MAX_BYTES) throw new Error(`${file} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  await engine();
  let doc: CadDoc;
  try {
    doc = new CadDoc(bytes);
  } catch (e) {
    throw new Error(`${file} could not be read (${e instanceof Error ? e.message : String(e)}).`);
  }
  const info = JSON.parse(doc.info()) as CadInfo;
  let outlines: CadObject[] | undefined;
  return {
    file, path, info, bytes,
    segs: doc.segments(), segLayers: doc.segment_layers(), segColors: doc.segment_colors(), segLinetypes: doc.segment_linetypes(),
    snap: (x, y, r, mask, layersOn) => doc.snap(x, y, r, mask, layersOn),
    pick: (x, y, tol, layersOn, closedOnly = false) => { const j = doc.pick(x, y, tol, layersOn, closedOnly); return j ? (JSON.parse(j) as CadObject) : null; },
    outlines: () => (outlines ??= JSON.parse(doc.outlines()) as CadObject[]),
    blocks: () => JSON.parse(doc.blocks()) as (CadBlock & { layer: string; handle: string })[]
  };
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

/** Asks for a drawing (desktop dialog or browser picker) and opens it; null when cancelled. */
export async function chooseDrawing(): Promise<CadView | null> {
  const desktop = window.lvds?.cadFile?.openBytes;
  if (desktop) {
    const r = await desktop();
    return r ? openDrawing(r.file, r.bytes, r.path) : null;
  }
  const f = await pickFile();
  return f ? openDrawing(f.name, new Uint8Array(await f.arrayBuffer())) : null;
}

/** Reopens a drawing opened before (desktop only: by its path); null when it is no longer there. */
export async function reopenDrawing(path: string): Promise<CadView | null> {
  const r = await window.lvds?.cadFile?.readBytes?.(path);
  return r ? openDrawing(r.file, r.bytes, r.path) : null;
}

/** One of the sample plans shipped with the app (a test aid). */
export async function sampleDrawing(name: string): Promise<CadView | null> {
  const desktop = window.lvds?.cadFile?.sampleBytes;
  if (desktop) {
    const r = await desktop(name);
    return r ? openDrawing(r.file, r.bytes) : null;
  }
  const url = SAMPLES[name];
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The sample plan ${name} could not be loaded.`);
  return openDrawing(name, new Uint8Array(await res.arrayBuffer()));
}

/** A device written into the saved drawing: position (drawing units), radius, the letters inside and its label. */
export interface DeviceOut { layer: string; x: number; y: number; r: number; text: string; label: string }

/** The drawing saved as DXF with the devices and what was drawn in the app added on their own layers (the architect's
 * entities kept as read). */
export async function drawingWithDevices(view: CadView, devices: DeviceOut[], shapes: unknown[] = [], as: 'dxf' | 'dwg' = 'dxf'): Promise<Uint8Array> {
  await engine();
  try {
    // DWG: in the version the drawing came in, else AutoCAD 2018 (engines/cad-reader/src/doc.rs dwg_bytes).
    return (as === 'dwg' ? exportDwg : exportDxf)(view.bytes, JSON.stringify(devices), JSON.stringify(shapes));
  } catch (e) {
    throw new Error(`The drawing could not be saved (${e instanceof Error ? e.message : String(e)}).`);
  }
}
