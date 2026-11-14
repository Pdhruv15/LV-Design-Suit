import { pushLibrary } from '../database/librarySync';
import type { DrawingSheet } from './drawingSet';
import type { Project } from '../types';

/** Design CAD → Output: how sheets print. A pen table gives each kind of line its width (mm on paper) and ink
 * (black, or a grey); each sheet has a page setup (its paper and scale are the sheet's own size and scale), and the set
 * a default. Printing stays black-and-white. A CTB (colour-dependent plot style table) can be imported: the
 * pens then take the widths it gives the colours the app's DXF layers use. */

export type PenKey = 'frame' | 'title' | 'arch' | 'refs' | 'devices' | 'trays' | 'routes' | 'sketch' | 'hatch' | 'sld' | 'bus';
/** A pen: width in mm (0 = as the drawing has it), ink in % of black (100 = black). */
export interface Pen { w: number; grey: number }
export interface PenTable { id: string; name: string; pens: Record<PenKey, Pen>; ctb?: string }
/** A sheet's page setup (blank = the set's default): the pen table, whether lineweights print, the plot stamp, and
 * whether a plan sheet prints the drawn work (Design CAD lines, hatches and text; blank = it does). */
export interface PlotSetup { pens?: string; weights?: 'pens' | 'thin'; stamp?: boolean; drawn?: boolean; /** The named page setup applied (its ID); blank: the sheet's own. */ named?: string }
/** A named page setup (Output → Page setups): paper, scale for plan sheets, how it prints and the printer, kept by name
 * and applied to many sheets at once. A sheet it was applied to follows it when it is edited. */
export interface NamedSetup { id: string; name: string; size: DrawingSheet['size']; /** Plan sheets, e.g. 100 for 1:100. */ scale?: number; plot: Omit<PlotSetup, 'named'>; /** A printer's name; blank: PDF. */ printer?: string }
/** A saved batch plot (Output → Batch plot): the sheets in order, each with its page setup (blank: the sheet's own), and
 * where they go. */
export interface BatchList { id: string; name: string; rows: { sheet: string; setup?: string }[]; output: 'one' | 'each' | 'printer'; printer?: string; copies?: number }
export interface ProjectPlot {
  tables?: PenTable[]; defaults?: PlotSetup; setups?: NamedSetup[]; batches?: BatchList[];
  /** The viewport scales offered (1:n); blank: the standard list. */
  scales?: number[];
}

/** ISO pen widths (mm). */
export const PEN_WIDTHS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2];
export const PEN_INKS = [100, 80, 60, 45, 30];
export const PEN_LABEL: Record<PenKey, string> = {
  frame: 'Sheet frame and title block outline', title: 'Title block, legend and table lines', arch: "Architect's plan (room outlines)", refs: 'References (other drawings under the plan)',
  devices: 'Devices and DBs', trays: 'Cable trays', routes: 'Cable routes and wiring',
  sketch: 'Your drawn lines (text, dimensions, leaders)', hatch: 'Hatch (pattern lines; Solid prints 30 %)', sld: 'SLD and diagram lines', bus: 'Busbars'
};
/** The colour each kind of line has on the app's DXF layers (src/docs/sheetDxf.ts): a CTB's widths go by it. */
export const PEN_ACI: Record<PenKey, number> = { frame: 7, title: 7, arch: 8, refs: 9, devices: 3, trays: 3, routes: 7, sketch: 7, hatch: 8, sld: 7, bus: 1 };

/** What the sheets print today; SLD lines and busbars as drawn. */
export const DEFAULT_PENS: PenTable = {
  id: 'lvds', name: 'LVDS Electrical',
  pens: { frame: { w: 0.7, grey: 100 }, title: { w: 0.25, grey: 100 }, arch: { w: 0.18, grey: 45 }, refs: { w: 0.13, grey: 30 }, devices: { w: 0.25, grey: 100 }, trays: { w: 0.5, grey: 100 }, routes: { w: 0.25, grey: 100 }, sketch: { w: 0.25, grey: 100 }, hatch: { w: 0.13, grey: 60 }, sld: { w: 0, grey: 100 }, bus: { w: 0, grey: 100 } }
};
export const PEN_KEYS = Object.keys(DEFAULT_PENS.pens) as PenKey[];
/** The thinnest pen: "All one thin line". */
const THIN = 0.13;

/** The project's pen tables: the default (as edited, if it was) and those added or imported. */
export function tablesOf(p: Project): PenTable[] {
  const own = (p.plot?.tables ?? []).map((t) => ({ ...t, pens: { ...DEFAULT_PENS.pens, ...t.pens } })); // a table saved before a pen was added takes its default
  return [own.find((t) => t.id === DEFAULT_PENS.id) ?? DEFAULT_PENS, ...own.filter((t) => t.id !== DEFAULT_PENS.id)];
}
/** A sheet's page setup: its own, else the set's default. */
export const plotOf = (p: Project, s?: Pick<DrawingSheet, 'plot'>): PlotSetup => ({ ...(p.plot?.defaults ?? {}), ...(s?.plot ?? {}) });
/** The pens a sheet prints with. */
export function pensFor(p: Project, s?: Pick<DrawingSheet, 'plot'>): Record<PenKey, Pen> {
  const setup = plotOf(p, s);
  const t = tablesOf(p).find((x) => x.id === setup.pens) ?? tablesOf(p)[0];
  if (setup.weights !== 'thin') return t.pens;
  return Object.fromEntries(PEN_KEYS.map((k) => [k, { ...t.pens[k], w: THIN }])) as Record<PenKey, Pen>;
}
/** A pen's ink as a CSS colour: black, or a grey. */
export function inkOf(pen: Pen): string {
  if (pen.grey >= 100) return '#000';
  const v = Math.round(255 * (1 - Math.max(0, pen.grey) / 100));
  return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
}
const PX_PER_MM = 96 / 25.4;
/** SLD and diagram sheets: their lines and busbars at the pen widths on paper whatever the diagram's scale (none when
 * both print as drawn). */
export function diagramPenCss(pens: Record<PenKey, Pen>): string {
  const rule = (sel: string, pen: Pen) => (pen.w > 0 ? `${sel}{stroke-width:${+(pen.w * PX_PER_MM).toFixed(3)}px!important;vector-effect:non-scaling-stroke;${pen.grey < 100 ? `stroke:${inkOf(pen)}!important;` : ''}}` : '');
  return rule('.drawing svg .ln,.drawing svg .load,.drawing svg .tie-ln,.drawing svg line,.drawing svg path,.drawing svg polyline,.drawing svg rect,.drawing svg circle', pens.sld) + rule('.drawing svg .bus', pens.bus);
}

/** The plot stamp: file, date, revision and user, printed in the sheet's margin. */
export function plotStamp(s: Pick<DrawingSheet, 'number' | 'title'>, rev: string | undefined, user: string | undefined, now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return [`${s.number} - ${s.title}`, d, rev ? `Rev ${rev}` : '', user ?? ''].filter(Boolean).join(' · ');
}

/** The lineweights a CTB file can give (its lineweight index → mm), as CAD programs list them. */
const CTB_WEIGHTS = [0, 0.05, 0.09, 0.1, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.53, 0.6, 0.65, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11];
export interface Ctb { /** By ACI colour 1–255: width in mm (undefined: the object's own) and screening (% ink). */ colours: Record<number, { w?: number; grey: number }> }

/** Reads a CTB file: a short text header, then the plot styles compressed with zlib. */
export async function parseCtb(bytes: Uint8Array): Promise<Ctb> {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 48));
  if (!/^PIAFILEVERSION/.test(head) || !/CTB/i.test(head)) throw new Error('Not a CTB plot style table (colour-dependent). STB files are not read yet.');
  let at = 48;
  while (at < Math.min(bytes.length - 1, 80) && !(bytes[at] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[at + 1]))) at += 1;
  if (at >= Math.min(bytes.length - 1, 80)) throw new Error('The CTB file could not be read (no compressed data).');
  const stream = new Blob([bytes.slice(at) as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const text = await new Response(stream).text();
  const custom = /custom_lineweight_table\s*\{([^}]*)\}/.exec(text)?.[1];
  const table = custom ? [...custom.matchAll(/(\d+)\s*=\s*([\d.]+)/g)].reduce<number[]>((t, m) => { t[Number(m[1])] = Number(m[2]); return t; }, []) : CTB_WEIGHTS;
  const colours: Ctb['colours'] = {};
  const body = /plot_style\s*\{([\s\S]*)\}\s*custom_lineweight_table/.exec(text)?.[1] ?? text;
  for (const m of body.matchAll(/(\d+)\s*\{([^}]*)\}/g)) {
    const i = Number(m[1]) + 1, f = m[2];
    const lw = Number(/lineweight\s*=\s*(\d+)/.exec(f)?.[1] ?? 255), scr = Number(/screening\s*=\s*(\d+)/.exec(f)?.[1] ?? 100);
    if (i >= 1 && i <= 255) colours[i] = { ...(lw !== 255 && table[lw] !== undefined ? { w: table[lw] } : {}), grey: scr };
  }
  if (!Object.keys(colours).length) throw new Error('The CTB file has no plot styles.');
  return { colours };
}
/** A pen table from a CTB: each kind of line takes the width and screening of its layer's colour; a colour that uses the
 * object's own lineweight keeps the default pen. */
export function tableFromCtb(id: string, name: string, ctb: Ctb): PenTable {
  const pens = Object.fromEntries(PEN_KEYS.map((k) => {
    const c = ctb.colours[PEN_ACI[k]], d = DEFAULT_PENS.pens[k];
    return [k, { w: c?.w !== undefined && c.w > 0 ? c.w : d.w, grey: c ? Math.min(d.grey, c.grey) : d.grey }];
  })) as Record<PenKey, Pen>;
  return { id, name, pens, ctb: name };
}

/** The project with a pen table saved (added, or in place of the one with its ID); the default saved unchanged drops
 * out again. */
export function withTable(p: Project, t: PenTable): Project {
  const rest = (p.plot?.tables ?? []).filter((x) => x.id !== t.id);
  const same = t.id === DEFAULT_PENS.id && JSON.stringify(t.pens) === JSON.stringify(DEFAULT_PENS.pens) && t.name === DEFAULT_PENS.name;
  return { ...p, plot: { ...(p.plot ?? {}), tables: same ? rest : [...rest, t] } };
}
export const withDefaults = (p: Project, d: PlotSetup): Project => ({ ...p, plot: { ...(p.plot ?? {}), defaults: d } });
/** An ID for a new table. */
export const newTableId = (p: Project) => `pt${(p.plot?.tables ?? []).reduce((m, t) => Math.max(m, Number(/^pt(\d+)$/.exec(t.id)?.[1] ?? 0)), 0) + 1}`;

/** An ID for a new named setup or batch list: `prefix` and the next number. */
export function nextId(list: { id: string }[] | undefined, prefix: string): string {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  return `${prefix}${(list ?? []).reduce((m, x) => Math.max(m, Number(re.exec(x.id)?.[1] ?? 0)), 0) + 1}`;
}
export const setupsOf = (p: Project): NamedSetup[] => p.plot?.setups ?? [];
export const batchesOf = (p: Project): BatchList[] => p.plot?.batches ?? [];
/** The sheets a named setup was applied to (and still follow it). */
export const setupUsers = (p: Project, id: string): DrawingSheet[] => (p.drawingSet?.sheets ?? []).filter((s) => s.plot?.named === id);

const withSheets = (p: Project, f: (s: DrawingSheet) => DrawingSheet): Project => (p.drawingSet ? { ...p, drawingSet: { ...p.drawingSet, sheets: p.drawingSet.sheets.map(f) } } : p);
/** A sheet with a named setup: its paper, its scale when it is a plan, and how it prints. */
export function sheetWithSetup(s: DrawingSheet, n: NamedSetup): DrawingSheet {
  return { ...s, size: n.size, ...(s.kind === 'plan' && n.scale ? { scale: `1:${n.scale}` } : {}), plot: { ...n.plot, named: n.id } };
}
/** The project with a named setup applied to these sheets. */
export function applySetup(p: Project, id: string, sheetIds: string[]): Project {
  const n = setupsOf(p).find((x) => x.id === id);
  return n ? withSheets(p, (s) => (sheetIds.includes(s.id) ? sheetWithSetup(s, n) : s)) : p;
}
/** The project with a named setup saved (added, or in place of the one with its ID); the sheets that follow it take
 * the change. */
export function withSetup(p: Project, n: NamedSetup): Project {
  const list = setupsOf(p);
  const next: Project = { ...p, plot: { ...(p.plot ?? {}), setups: list.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? n : x)) : [...list, n] } };
  return withSheets(next, (s) => (s.plot?.named === n.id ? sheetWithSetup(s, n) : s));
}
/** The project without a named setup; its sheets keep what it gave them as their own. Batch rows using it go back to the
 * sheet's own setup. */
export function withoutSetup(p: Project, id: string): Project {
  const batches = p.plot?.batches?.map((b) => ({ ...b, rows: b.rows.map((r) => (r.setup === id ? { sheet: r.sheet } : r)) }));
  const next: Project = { ...p, plot: { ...(p.plot ?? {}), setups: setupsOf(p).filter((x) => x.id !== id), ...(batches ? { batches } : {}) } };
  return withSheets(next, (s) => (s.plot?.named === id ? { ...s, plot: { ...s.plot, named: undefined } } : s));
}
/** The project with a batch list saved (added, or in place of the one with its ID), or without it. */
export function withBatch(p: Project, b: BatchList): Project {
  const list = batchesOf(p);
  return { ...p, plot: { ...(p.plot ?? {}), batches: list.some((x) => x.id === b.id) ? list.map((x) => (x.id === b.id ? b : x)) : [...list, b] } };
}
export const withoutBatch = (p: Project, id: string): Project => ({ ...p, plot: { ...(p.plot ?? {}), batches: batchesOf(p).filter((x) => x.id !== id) } });
/** The project as a batch plots it: each row's sheet with the row's named setup, for this run only. */
export function projectForBatch(p: Project, rows: BatchList['rows']): Project {
  const by = new Map(setupsOf(p).map((n) => [n.id, n]));
  const of = new Map(rows.filter((r) => r.setup && by.has(r.setup)).map((r) => [r.sheet, by.get(r.setup!)!]));
  return withSheets(p, (s) => (of.has(s.id) ? sheetWithSetup(s, of.get(s.id)!) : s));
}

/** Named page setups as a file (Output → Page setups → Export…) or in the library: the setups and the pen tables they use. */
export interface SetupsFile { kind: 'lvds.pageSetups'; setups: NamedSetup[]; tables: PenTable[] }
/** The project's named page setups (all, or those with these ids) with the pen tables they use (never the built-in one). */
export function setupsFile(p: Project, ids?: string[]): SetupsFile {
  const setups = setupsOf(p).filter((n) => !ids || ids.includes(n.id));
  const used = new Set(setups.map((n) => n.plot.pens).filter((x): x is string => !!x && x !== DEFAULT_PENS.id));
  return { kind: 'lvds.pageSetups', setups, tables: tablesOf(p).filter((t) => t.id !== DEFAULT_PENS.id && used.has(t.id)) };
}
const SETUP_SIZES = ['auto', 'A4', 'A3', 'A3 portrait', 'A2', 'A1'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Page setups read from a file: one exported here, or a project file (its plot.setups and plot.tables). Undefined when it holds none. */
export function readSetups(v: unknown): SetupsFile | undefined {
  if (!isObj(v)) return undefined;
  const src = v.kind === 'lvds.pageSetups' ? v : isObj(v.plot) ? v.plot : isObj((v.project as Record<string, unknown> | undefined)?.plot) ? (v.project as { plot: Record<string, unknown> }).plot : undefined;
  if (!src || !Array.isArray(src.setups)) return undefined;
  const setups: NamedSetup[] = [];
  for (const raw of src.setups) {
    if (!isObj(raw) || typeof raw.name !== 'string' || !raw.name.trim() || !SETUP_SIZES.includes(raw.size as string)) continue;
    const scale = typeof raw.scale === 'number' && raw.scale > 0 ? raw.scale : undefined;
    setups.push({
      id: typeof raw.id === 'string' ? raw.id : '', name: raw.name.trim(), size: raw.size as NamedSetup['size'], ...(scale ? { scale } : {}),
      plot: plotFrom(raw.plot), ...(typeof raw.printer === 'string' && raw.printer ? { printer: raw.printer } : {})
    });
  }
  if (!setups.length) return undefined;
  const tables = Array.isArray(src.tables) ? src.tables.filter(isPenTable) : [];
  return { kind: 'lvds.pageSetups', setups, tables };
}
/** How a setup prints, as read from a file: only what a page setup holds, so nothing else gets into the project. */
function plotFrom(v: unknown): NamedSetup['plot'] {
  if (!isObj(v)) return {};
  return {
    ...(typeof v.pens === 'string' && v.pens ? { pens: v.pens } : {}), ...(v.weights === 'pens' || v.weights === 'thin' ? { weights: v.weights } : {}),
    ...(typeof v.stamp === 'boolean' ? { stamp: v.stamp } : {}), ...(typeof v.drawn === 'boolean' ? { drawn: v.drawn } : {})
  };
}
/** A whole pen table: a width (0: as drawn) and an ink for every kind of line (one with a pen missing could not print). */
const isPenTable = (t: unknown): t is PenTable => isObj(t) && typeof t.id === 'string' && typeof t.name === 'string' && !!t.name.trim() && isObj(t.pens)
  && PEN_KEYS.every((k) => { const pen = (t.pens as Record<string, unknown>)[k]; return isObj(pen) && typeof pen.w === 'number' && pen.w >= 0 && typeof pen.grey === 'number'; });
/** The project with page setups brought in. A setup whose name is here already (any case) is left as it is; the others get new ids. A pen table they use is matched by name, else added. */
export function importSetups(p: Project, f: SetupsFile): { project: Project; added: string[]; kept: string[] } {
  let project = p;
  const added: string[] = [], kept: string[] = [];
  const idOf = new Map<string, string>();
  const tableFor = (old: string): string | undefined => {
    if (idOf.has(old)) return idOf.get(old);
    const t = f.tables.find((x) => x.id === old);
    if (!t) return old === DEFAULT_PENS.id ? old : undefined;
    const same = tablesOf(project).find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    if (same) { idOf.set(old, same.id); return same.id; }
    const id = newTableId(project);
    project = withTable(project, { ...t, id });
    idOf.set(old, id);
    return id;
  };
  for (const n of f.setups) {
    if (setupsOf(project).some((x) => x.name.toLowerCase() === n.name.toLowerCase())) { kept.push(n.name); continue; }
    const { pens, ...rest } = n.plot;
    const mapped = pens ? tableFor(pens) : undefined;
    project = withSetup(project, { ...n, id: nextId(setupsOf(project), 'ps'), plot: { ...rest, ...(mapped ? { pens: mapped } : {}) } });
    added.push(n.name);
  }
  return { project, added, kept };
}
export const SETUPS_LIBRARY_KEY = 'lvds.pageSetups';
export function loadSetupLibrary(): SetupsFile {
  const none: SetupsFile = { kind: 'lvds.pageSetups', setups: [], tables: [] };
  try { return readSetups(JSON.parse(localStorage.getItem(SETUPS_LIBRARY_KEY) ?? 'null')) ?? none; } catch { return none; }
}
/** A pen table's id in the library: its name. Projects number their tables alike (pt1 in each), so their own ids would
 * make one project's table stand for another's. */
const libTableId = (name: string) => `lib:${name.trim().toLowerCase()}`;
/** The library with these page setups saved (same name, any case: replaced) and their pen tables (same name: replaced). */
export function saveToSetupLibrary(f: SetupsFile): boolean {
  const lib = loadSetupLibrary();
  const idOf = new Map(f.tables.map((t) => [t.id, libTableId(t.name)]));
  const mine = f.setups.map((n): NamedSetup => {
    const { pens, ...rest } = n.plot, id = pens ? idOf.get(pens) ?? (pens === DEFAULT_PENS.id ? pens : undefined) : undefined;
    return { ...n, plot: { ...rest, ...(id ? { pens: id } : {}) } };
  });
  const mineTables = f.tables.map((t) => ({ ...t, id: libTableId(t.name) }));
  const setups = [...lib.setups.filter((x) => !mine.some((n) => n.name.toLowerCase() === x.name.toLowerCase())), ...mine];
  const tables = [...lib.tables.filter((x) => !mineTables.some((t) => t.id === x.id)), ...mineTables];
  try { localStorage.setItem(SETUPS_LIBRARY_KEY, JSON.stringify({ kind: 'lvds.pageSetups', setups, tables })); void pushLibrary(); return true; } catch { return false; }
}
