import { pushLibrary } from '../database/librarySync';
import { drawingAreaMm, layoutExtent, layoutPaper, layoutViewports, planScale } from '../docs/planLayout';
import { SHEET_MM } from '../docs/sldSheet';
import type { Project } from '../types';
import { fitScale, VIEWPORT_INSET_MM, type DrawingLayout } from './drawingLayouts';
import type { DrawingSheet, PlanType, SheetSize } from './drawingSet';
import type { PlanViewport } from './planViewports';
import { setupsOf, sheetWithSetup } from './plotSetup';
import { tableId, tablesOf, type PlacedTable, type TableKind } from './sheetTables';

/** A layout saved as a template (Output → Layout → Save as template): its paper, where its viewports sit and their scales, and a plan sheet's legend and notes tables. Kept in the LV Database (Library.json) for every project; what the viewports show comes from the drawing a new layout is made on. */
export interface LayoutTemplate {
  id: string; name: string; savedAt: string;
  /** Paper (mm): width, height. */
  paper: [number, number];
  /** The sheet size of a plan sheet made from it. */
  size: SheetSize;
  /** Viewport frames as fractions of the working area (left, top, width, height; the drawing area of a plan sheet, the paper inside its margin on a layout of the drawing) and their scale 1:n (blank: the scale the drawing fits at). */
  viewports: { box: [number, number, number, number]; scale?: number; locked?: boolean; frame?: boolean; shows?: PlanType }[];
  /** A plan sheet's tables: the top left corner as fractions of the drawing area. */
  tables?: { kind: TableKind; at: [number, number]; widthMm: number; textMm?: 2.5 | 3.5; cols?: 1 | 2; title?: string }[];
  /** The named page setup it was saved with (its name). */
  setup?: string;
}

export const LAYOUT_TEMPLATES_KEY = 'lvds.layoutTemplates';
const SIZES: SheetSize[] = ['A4', 'A3', 'A3 portrait', 'A2', 'A1'];
const PLANS: PlanType[] = ['lighting', 'power', 'elv', 'containment'];
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const newId = (now: Date) => `lt-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The sheet size nearest a paper: the one matching within 2 mm, else by width (portrait papers other than A3: the landscape size). */
export function sizeOfPaper(paper: [number, number]): SheetSize {
  const hit = SIZES.find((z) => Math.abs(SHEET_MM[z].w - paper[0]) <= 2 && Math.abs(SHEET_MM[z].h - paper[1]) <= 2);
  if (hit) return hit;
  const w = Math.max(paper[0], paper[1]);
  return (['A4', 'A3', 'A2', 'A1'] as const).find((z) => SHEET_MM[z].w >= w - 2) ?? 'A1';
}

/** A template read from a file or the library: undefined when it is not one. */
export function parseLayoutTemplate(v: unknown): LayoutTemplate | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const t = v as Record<string, unknown>;
  if (typeof t.name !== 'string' || !t.name.trim()) return undefined;
  if (!Array.isArray(t.paper) || t.paper.length !== 2 || !t.paper.every((n) => num(n) && n > 0)) return undefined;
  if (!Array.isArray(t.viewports)) return undefined;
  const paper = [t.paper[0], t.paper[1]] as [number, number];
  const viewports: LayoutTemplate['viewports'] = [];
  for (const raw of t.viewports) {
    const b = (raw as { box?: unknown })?.box;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(num) || !(b[2] > 0) || !(b[3] > 0)) continue;
    const o = raw as Record<string, unknown>;
    viewports.push({
      box: [b[0], b[1], b[2], b[3]],
      ...(num(o.scale) && o.scale > 0 ? { scale: o.scale } : {}),
      ...(o.locked === false ? { locked: false } : {}), ...(o.frame === true ? { frame: true } : {}),
      ...(typeof o.shows === 'string' && PLANS.includes(o.shows as PlanType) ? { shows: o.shows as PlanType } : {})
    });
  }
  const tables: NonNullable<LayoutTemplate['tables']> = [];
  if (Array.isArray(t.tables)) for (const raw of t.tables) {
    const o = raw as Record<string, unknown>, at = o?.at;
    if (!o || (o.kind !== 'legend' && o.kind !== 'notes') || !Array.isArray(at) || at.length !== 2 || !at.every(num) || !num(o.widthMm) || o.widthMm <= 0) continue;
    tables.push({ kind: o.kind, at: [at[0], at[1]], widthMm: o.widthMm, ...(o.textMm === 2.5 || o.textMm === 3.5 ? { textMm: o.textMm } : {}), ...(o.cols === 1 || o.cols === 2 ? { cols: o.cols } : {}), ...(typeof o.title === 'string' && o.title ? { title: o.title } : {}) });
  }
  return {
    id: typeof t.id === 'string' && t.id ? t.id : newId(new Date()), name: t.name.trim(), savedAt: typeof t.savedAt === 'string' ? t.savedAt : new Date().toISOString(),
    paper, size: SIZES.includes(t.size as SheetSize) ? (t.size as SheetSize) : sizeOfPaper(paper), viewports,
    ...(tables.length ? { tables } : {}), ...(typeof t.setup === 'string' && t.setup ? { setup: t.setup } : {})
  };
}

export function loadLayoutTemplates(): LayoutTemplate[] {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_TEMPLATES_KEY) ?? '[]');
    return Array.isArray(v) ? v.map(parseLayoutTemplate).filter((t): t is LayoutTemplate => !!t).sort((a, b) => a.name.localeCompare(b.name)) : [];
  } catch { return []; }
}
export function saveLayoutTemplates(list: LayoutTemplate[]): boolean {
  try { localStorage.setItem(LAYOUT_TEMPLATES_KEY, JSON.stringify(list)); void pushLibrary(); return true; } catch { return false; }
}
/** The list with a template saved; one of the same name (any case) is replaced and keeps its id. Sorted by name. */
export function withLayoutTemplate(list: LayoutTemplate[], t: LayoutTemplate): LayoutTemplate[] {
  const old = list.find((x) => x.name.toLowerCase() === t.name.trim().toLowerCase());
  return [...list.filter((x) => x !== old), { ...t, name: t.name.trim(), id: old?.id ?? t.id }].sort((a, b) => a.name.localeCompare(b.name));
}

/** A plan sheet as a template. */
export function templateFromSheet(p: Project, s: DrawingSheet, name: string, now = new Date()): LayoutTemplate {
  const size = layoutPaper(p, s)?.size ?? (s.size !== 'auto' ? s.size : 'A3'), area = drawingAreaMm(p, size);
  const { w, h } = SHEET_MM[size];
  const viewports = layoutViewports(p, s).map((v) => ({
    box: [r4(v.box[0] / area.w), r4(v.box[1] / area.h), r4(v.box[2] / area.w), r4(v.box[3] / area.h)] as [number, number, number, number], scale: v.scale,
    ...(v.locked === false ? { locked: false } : {}), ...(v.frame ? { frame: true } : {}), ...(v.shows ? { shows: v.shows } : {})
  }));
  const tables = tablesOf(s).map((t) => ({
    kind: t.kind, at: [r4(t.at[0] / area.w), r4(t.at[1] / area.h)] as [number, number], widthMm: t.widthMm,
    ...(t.textMm ? { textMm: t.textMm } : {}), ...(t.cols ? { cols: t.cols } : {}), ...(t.title ? { title: t.title } : {})
  }));
  const setup = setupsOf(p).find((n) => n.id === s.plot?.named)?.name;
  return { id: newId(now), name: name.trim(), savedAt: now.toISOString(), paper: [w, h], size, viewports, ...(tables.length ? { tables } : {}), ...(setup ? { setup } : {}) };
}

/** A layout of the drawing (made with +, or the file's own) as a template: frames in mm from the paper's lower left corner, with their scales. */
export function templateFromPaper(name: string, paper: [number, number], vps: { x: number; y: number; w: number; h: number; scale?: number }[], now = new Date()): LayoutTemplate {
  const [pw, ph] = paper, I = VIEWPORT_INSET_MM, aw = pw - 2 * I, ah = ph - 2 * I;
  return {
    id: newId(now), name: name.trim(), savedAt: now.toISOString(), paper, size: sizeOfPaper(paper),
    viewports: vps.map((v) => ({ box: [r4((v.x - I) / aw), r4((ph - (v.y + v.h) - I) / ah), r4(v.w / aw), r4(v.h / ah)] as [number, number, number, number], ...(v.scale && v.scale > 0 ? { scale: v.scale } : {}) }))
  };
}

/** A new layout of the drawing from a template: its paper and frames; each viewport centred on the drawing at the template's scale, or the scale the drawing fits at. */
export function drawingLayoutFromTemplate(t: LayoutTemplate, name: string, ext: [number, number, number, number], mmPerUnit: number): DrawingLayout {
  const [pw, ph] = t.paper, I = VIEWPORT_INSET_MM, aw = pw - 2 * I, ah = ph - 2 * I, mpu = mmPerUnit > 0 ? mmPerUnit : 1;
  const ok = Number.isFinite(ext[0]) && ext[2] >= ext[0];
  return {
    name, paper: [pw, ph],
    viewports: t.viewports.map((v) => {
      const w = r1(v.box[2] * aw), h = r1(v.box[3] * ah), x = r1(I + v.box[0] * aw), y = r1(ph - I - (v.box[1] + v.box[3]) * ah);
      const n = v.scale && v.scale > 0 ? v.scale : fitScale(ext, w, h, mmPerUnit);
      return { x, y, w, h, cx: ok ? (ext[0] + ext[2]) / 2 : 0, cy: ok ? (ext[1] + ext[3]) / 2 : 0, vh: (h * n) / mpu };
    })
  };
}

/** A plan sheet (already in the project) given a template: its size, viewports (centred on the level, at the template's scales, the first one's as the sheet's scale) and tables. With a page setup of the template's name in the project, the sheet follows it. */
export function sheetWithTemplate(p: Project, s: DrawingSheet, t: LayoutTemplate): DrawingSheet {
  const setup = t.setup ? setupsOf(p).find((n) => n.name.toLowerCase() === t.setup!.toLowerCase()) : undefined;
  const base = setup ? sheetWithSetup(s, setup) : s;
  const size: SheetSize = base.size !== 'auto' ? base.size : t.size;
  const area = drawingAreaMm(p, size), ext = layoutExtent(p, { ...base, size });
  const at: [number, number] = ext ? [(ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2] : [0, 0];
  const viewports: PlanViewport[] = t.viewports.map((v, i) => ({
    id: `vp${i + 1}`, box: [r1(v.box[0] * area.w), r1(v.box[1] * area.h), r1(v.box[2] * area.w), r1(v.box[3] * area.h)], at, scale: v.scale ?? planScale(base.scale),
    ...(v.locked === false ? { locked: false } : {}), ...(v.frame ? { frame: true } : {}), ...(v.shows ? { shows: v.shows } : {})
  }));
  const tables: PlacedTable[] = [];
  for (const x of t.tables ?? []) tables.push({ id: tableId(tables), kind: x.kind, at: [r1(x.at[0] * area.w), r1(x.at[1] * area.h)], widthMm: x.widthMm, ...(x.textMm ? { textMm: x.textMm } : {}), ...(x.cols ? { cols: x.cols } : {}), ...(x.title ? { title: x.title } : {}) });
  const { viewports: _v, tables: _t, ...rest } = base;
  return { ...rest, size, ...(viewports.length ? { viewports, scale: `1:${viewports[0].scale}` } : {}), ...(tables.length ? { tables } : {}) };
}
