/* tslint:disable */
/* eslint-disable */

export class CadDoc {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Drawing facts as JSON: format, units (INSUNITS), origin, extents (most of the drawing), layers, texts, counts.
     */
    info(): string;
    /**
     * Opens a DWG (R13–2018) or DXF drawing.
     */
    constructor(bytes: Uint8Array);
    /**
     * Closed objects of model space (polylines, circles, ellipses, hatches, solids) as JSON — each ObjInfo with its `id`
     * — for rooms from outline layers; their drawn segments are `seg_start..seg_end`.
     */
    outlines(): string;
    /**
     * The object under (x, y) within `tol` (drawing units) on shown layers, as JSON (ObjInfo with its `id`), or "".
     * The nearest drawn line wins; a text wins when the point is on it. `closed_only` considers only objects with an
     * area (closed polylines, circles, hatches…), as for AREA → Object.
     */
    pick(x: number, y: number, tol: number, layers_on: Uint8Array, closed_only: boolean): string;
    /**
     * Colour of each segment: 0xRRGGBB, or 0xFF000007 for the foreground (index 7).
     */
    segment_colors(): Uint32Array;
    segment_layers(): Uint16Array;
    /**
     * Segments x1, y1, x2, y2 relative to the origin (single precision is enough for drawing).
     */
    segments(): Float32Array;
    /**
     * The snap point nearest (x, y) within r (drawing units): [x, y, kind], or empty. `mask` chooses the kinds,
     * `layers_on` (one byte per layer, 1 = shown) leaves out hidden layers.
     */
    snap(x: number, y: number, r: number, mask: number, layers_on: Uint8Array): Float64Array;
}

/**
 * The drawing (DWG or DXF) saved as DXF with the devices placed in the app added on their own layers: each device as a
 * circle with its letters inside and its label (circuit or type) beside it. The architect's entities are kept as read.
 */
export function exportDxf(bytes: Uint8Array, devices_json: string, shapes_json: string): Uint8Array;

/**
 * WebAssembly entry point: the drawing's bytes → JSON (see `read_json`).
 */
export function readDrawing(bytes: Uint8Array): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_caddoc_free: (a: number, b: number) => void;
    readonly caddoc_info: (a: number, b: number) => void;
    readonly caddoc_new: (a: number, b: number, c: number) => void;
    readonly caddoc_outlines: (a: number, b: number) => void;
    readonly caddoc_pick: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly caddoc_segment_colors: (a: number, b: number) => void;
    readonly caddoc_segment_layers: (a: number, b: number) => void;
    readonly caddoc_segments: (a: number, b: number) => void;
    readonly caddoc_snap: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly exportDxf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly readDrawing: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
