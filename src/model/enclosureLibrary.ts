import ExcelJS from 'exceljs';
import type { Project } from '../types';
import { BUILTIN_CATALOGUES, type AllowanceRule, type EnclosureCatalogue, type EnclosureConfig } from '../calc/enclosure';
import { breakerTypeOf } from '../calc/earthing';
import { elcbGroups, scheduleCircuits } from '../calc/loadSchedule';
import { BRAND_DEVICES } from '../data/brandDevices';

/** Enclosure catalogues and device dimensions kept in the user library
 * (this computer, synced to Library.json in the database folder). The
 * built-in supplier chart is read-only: duplicate it to change it or to
 * enter another brand. Panels keep a frozen copy of what they were sized
 * with, so editing the library never resizes a designed panel. */

const CAT_KEY = 'lvds.enclosureCatalogues';
const DEV_KEY = 'lvds.deviceDims';

const read = <T>(key: string): T[] => { try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (key: string, v: unknown): boolean => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { return false; }
  void import('../database/librarySync').then((m) => m.pushLibrary());
  return true;
};

export const isBuiltin = (c: EnclosureCatalogue) => BUILTIN_CATALOGUES.some((b) => b.id === c.id);
export const userCatalogues = () => read<EnclosureCatalogue>(CAT_KEY);
export const allCatalogues = (): EnclosureCatalogue[] => [...BUILTIN_CATALOGUES, ...userCatalogues()];
export const saveUserCatalogues = (list: EnclosureCatalogue[]) => write(CAT_KEY, list.filter((c) => !isBuiltin(c)));

export function duplicateCatalogue(c: EnclosureCatalogue, supplier?: string): EnclosureCatalogue {
  const copy = structuredClone(c);
  return { ...copy, id: `cat-${Date.now().toString(36)}`, supplier: supplier ?? `${c.supplier} (copy)`, revision: '1', source: `Copied from ${c.supplier} — ${c.range} rev. ${c.revision}; enter this supplier's own dimensions and rules`, notes: [...copy.notes] };
}
export const emptyCatalogue = (): EnclosureCatalogue => ({
  id: `cat-${Date.now().toString(36)}`, supplier: 'New supplier', range: 'Modular DB', family: 'modular', source: '', revision: '1', notes: [],
  rules: [{ id: 'r1', label: 'Standard allowance', deductModules: 0 }], overlaps: [], configs: []
});

/** Problems that stop a catalogue being used for selection (bad) or that need a look (warn). */
export function validateCatalogue(c: EnclosureCatalogue): { level: 'bad' | 'warn'; text: string }[] {
  const out: { level: 'bad' | 'warn'; text: string }[] = [];
  if (!c.supplier.trim() || !c.range.trim()) out.push({ level: 'bad', text: 'Supplier and range are required' });
  if (!c.rules.length) out.push({ level: 'bad', text: 'At least one allowance case is needed (deduction 0 if the supplier states none)' });
  const ruleIds = new Set<string>();
  for (const r of c.rules) {
    if (ruleIds.has(r.id)) out.push({ level: 'bad', text: `Case id "${r.id}" is used twice` });
    ruleIds.add(r.id);
    if (!(r.deductModules >= 0)) out.push({ level: 'bad', text: `${r.label}: deduction must be 0 or more` });
    if (r.elcbMin !== undefined && r.elcbMax !== undefined && r.elcbMin > r.elcbMax) out.push({ level: 'bad', text: `${r.label}: ELCB from > to` });
    if (r.incomerMinA !== undefined && r.incomerMaxA !== undefined && r.incomerMinA > r.incomerMaxA) out.push({ level: 'bad', text: `${r.label}: incomer from > to` });
  }
  const refs = new Set<string>();
  for (const k of c.configs) {
    if (refs.has(k.id)) out.push({ level: 'bad', text: `Size "${k.ref}" appears twice` });
    refs.add(k.id);
    if (!(k.grossModules > 0)) out.push({ level: 'bad', text: `${k.ref}: gross modules must be above 0` });
    if (k.rows && k.modulesPerRow && k.rows * k.modulesPerRow !== k.grossModules) out.push({ level: 'warn', text: `${k.ref}: ${k.rows} × ${k.modulesPerRow} ≠ ${k.grossModules} gross` });
    const dims = c.family === 'fabricated' ? [k.dims.fabricated] : [k.dims.surface, k.dims.flush].filter(Boolean);
    if (!dims.length || dims.some((d) => !d || !(d.h > 0 && d.w > 0 && d.d > 0))) out.push({ level: 'bad', text: `${k.ref}: dimensions missing` });
    for (const r of c.rules) {
      const u = k.usable[r.id];
      if (u === null || u === undefined) continue;
      if (u > k.grossModules) out.push({ level: 'bad', text: `${k.ref}: usable ${u} is more than gross ${k.grossModules}` });
      else if (u !== k.grossModules - r.deductModules) out.push({ level: 'warn', text: `${k.ref}, ${r.label}: usable ${u} ≠ ${k.grossModules} − ${r.deductModules} — check the supplier's figure` });
    }
  }
  return out;
}

/** JSON backup / sharing: catalogues and device dimensions. */
export interface LibraryFile { kind: 'lvds-enclosure-library'; version: 1; catalogues: EnclosureCatalogue[]; devices: DeviceDim[] }
export const exportLibrary = (): LibraryFile => ({ kind: 'lvds-enclosure-library', version: 1, catalogues: userCatalogues(), devices: loadDevices() });
/** Reads a library file; same ids are replaced, new ones added. Built-in ids are never overwritten. */
export function importLibrary(text: string): { catalogues: number; devices: number } {
  const f = JSON.parse(text) as Partial<LibraryFile>;
  if (f.kind !== 'lvds-enclosure-library' || !Array.isArray(f.catalogues)) throw new Error('Not an LV Design Studio enclosure library file');
  const cats = f.catalogues.filter((c) => !isBuiltin(c) && Array.isArray(c.configs) && Array.isArray(c.rules));
  const devs = Array.isArray(f.devices) ? f.devices.filter((d) => d && typeof d.modules === 'number') : [];
  const mine = userCatalogues().filter((c) => !cats.some((x) => x.id === c.id));
  saveUserCatalogues([...mine, ...cats]);
  saveDevices([...loadDevices().filter((d) => !devs.some((x) => x.id === d.id)), ...devs]);
  return { catalogues: cats.length, devices: devs.length };
}

// ---- Excel template: one catalogue per workbook ----------------------------

const RULE_HEAD = ['Case id', 'Label', 'Deduct modules', 'ELCB from', 'ELCB to', 'Incomer from (A)', 'Incomer to (A)', 'Extra'];
/** An Excel workbook for a catalogue (a blank template when none): Catalogue, Cases, Sizes sheets. */
export function catalogueWorkbook(c: EnclosureCatalogue = emptyCatalogue()): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet('Catalogue');
  for (const [k, v] of [['Supplier', c.supplier], ['Range', c.range], ['Family (modular / fabricated)', c.family], ['Source document', c.source], ['Revision', c.revision], ['Notes (one per line)', c.notes.join('\n')]]) info.addRow([k, v]);
  info.getColumn(1).width = 30; info.getColumn(2).width = 70;
  const rules = wb.addWorksheet('Cases');
  rules.addRow(RULE_HEAD);
  for (const r of c.rules) rules.addRow([r.id, r.label, r.deductModules, r.elcbMin ?? null, r.elcbMax ?? null, r.incomerMinA ?? null, r.incomerMaxA ?? null, r.extra ?? null]);
  const sizes = wb.addWorksheet('Sizes');
  sizes.addRow(['Size', 'Rows', 'Modules per row', 'Gross modules', 'Surface H', 'Surface W', 'Surface D', 'Flush H', 'Flush W', 'Flush D', 'Fabricated H', 'Fabricated W', 'Fabricated D', ...c.rules.map((r) => `Usable: ${r.id}`)]);
  for (const k of c.configs) {
    const d = k.dims;
    sizes.addRow([k.ref, k.rows ?? null, k.modulesPerRow ?? null, k.grossModules, d.surface?.h ?? null, d.surface?.w ?? null, d.surface?.d ?? null, d.flush?.h ?? null, d.flush?.w ?? null, d.flush?.d ?? null,
      d.fabricated?.h ?? null, d.fabricated?.w ?? null, d.fabricated?.d ?? null, ...c.rules.map((r) => k.usable[r.id] ?? null)]);
  }
  for (const ws of [rules, sizes]) { ws.getRow(1).font = { bold: true }; ws.columns.forEach((col) => { col.width = 16; }); }
  sizes.addRow([]);
  sizes.addRow(['Usable = modules left after that case\'s allowance, as the supplier states it. Leave blank where the supplier gives no figure — the size is then never selected for that case.']);
  return wb;
}

/** Reads a catalogue from a workbook made from the template. */
export async function readCatalogueWorkbook(bytes: ArrayBuffer): Promise<EnclosureCatalogue> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const sheet = (n: string) => { const ws = wb.getWorksheet(n); if (!ws) throw new Error(`Sheet "${n}" missing — use the template`); return ws; };
  const val = (v: ExcelJS.CellValue) => (v && typeof v === 'object' && 'result' in v ? (v as { result: unknown }).result : v);
  const num = (v: ExcelJS.CellValue) => { const x = val(v); return x === null || x === undefined || x === '' ? undefined : Number(x); };
  const str = (v: ExcelJS.CellValue) => { const x = val(v); return x === null || x === undefined ? '' : String(x).trim(); };
  const info = new Map<string, string>();
  sheet('Catalogue').eachRow((r) => info.set(str(r.getCell(1).value).split(' (')[0], str(r.getCell(2).value)));
  const rules: AllowanceRule[] = [];
  sheet('Cases').eachRow((r, i) => {
    if (i === 1 || !str(r.getCell(1).value)) return;
    const o = (n: number) => num(r.getCell(n).value);
    rules.push({ id: str(r.getCell(1).value), label: str(r.getCell(2).value) || str(r.getCell(1).value), deductModules: o(3) ?? 0,
      ...(o(4) !== undefined ? { elcbMin: o(4) } : {}), ...(o(5) !== undefined ? { elcbMax: o(5) } : {}), ...(o(6) !== undefined ? { incomerMinA: o(6) } : {}), ...(o(7) !== undefined ? { incomerMaxA: o(7) } : {}),
      ...(str(r.getCell(8).value) ? { extra: str(r.getCell(8).value) } : {}) });
  });
  const ws = sheet('Sizes');
  const head = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => str(v));
  const configs: EnclosureConfig[] = [];
  ws.eachRow((r, i) => {
    const ref = str(r.getCell(1).value);
    const gross = num(r.getCell(4).value);
    if (i === 1 || !ref || gross === undefined) return;
    const c = (n: number) => num(r.getCell(n).value);
    const dim = (a: number) => (c(a) && c(a + 1) && c(a + 2) ? { h: c(a)!, w: c(a + 1)!, d: c(a + 2)! } : undefined);
    const usable: Record<string, number | null> = {};
    for (const rule of rules) { const col = head.indexOf(`Usable: ${rule.id}`); usable[rule.id] = col > 0 ? c(col) ?? null : null; }
    const dims: EnclosureConfig['dims'] = {};
    if (dim(5)) dims.surface = dim(5); if (dim(8)) dims.flush = dim(8); if (dim(11)) dims.fabricated = dim(11);
    configs.push({ id: `c-${ref.replace(/[^a-z0-9]+/gi, '')}`, ref, ...(c(2) ? { rows: c(2) } : {}), ...(c(3) ? { modulesPerRow: c(3) } : {}), grossModules: gross, dims, usable });
  });
  const family = info.get('Family') === 'fabricated' ? 'fabricated' : 'modular';
  return { id: `cat-${Date.now().toString(36)}`, supplier: info.get('Supplier') || 'Imported supplier', range: info.get('Range') || 'Range', family, source: info.get('Source document') ?? '', revision: info.get('Revision') || '1',
    notes: (info.get('Notes') ?? '').split('\n').map((s) => s.trim()).filter(Boolean), rules, overlaps: [], configs };
}

// ---- Device dimensions ------------------------------------------------------

export type DeviceKind = 'MCB' | 'RCBO' | 'RCCB' | 'MCCB' | 'ACB' | 'Isolator' | 'SPD' | 'Contactor' | 'Meter' | 'Pilot light' | 'Other';
export interface DeviceDim {
  id: string;
  manufacturer: string;
  model: string;
  kind: DeviceKind;
  poles: number; // physical poles of the device (incl. N where the device switches it)
  ratingMinA?: number;
  ratingMaxA?: number;
  modules: number; // width in 18 mm DIN modules, from the manufacturer's data
  mounting?: string; // DIN rail, chassis …
  accessories?: string;
  note?: string;
  /** Overall size from the manufacturer's data (mm). */
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
}
export const loadDevices = () => read<DeviceDim>(DEV_KEY);

/** Typical DIN-rail widths (18 mm modules), used only when no record of your own matches.
 * Shown as "Typical" so they can be replaced with the manufacturer's figure. MCCBs have no
 * typical width — they are chassis-mounted and need their own record. */
export const TYPICAL_DEVICES: DeviceDim[] = ([
  ['MCB', 1, 1, 63], ['MCB', 2, 2, 63], ['MCB', 3, 3, 63], ['MCB', 4, 4, 63],
  ['RCBO', 1, 2, 63], ['RCBO', 2, 2, 63], ['RCBO', 3, 4, 63], ['RCBO', 4, 4, 63],
  ['RCCB', 2, 2, 100], ['RCCB', 4, 4, 100],
  ['Isolator', 2, 2, 125], ['Isolator', 3, 3, 125], ['Isolator', 4, 4, 125]
] as [DeviceKind, number, number, number][]).map(([kind, poles, modules, max]) => ({
  id: `typ-${kind}-${poles}`, manufacturer: 'Typical', model: `${kind} ${poles}P (check manufacturer)`, kind, poles, ratingMaxA: max, modules, note: 'Built-in typical width'
}));
export const isTypical = (d?: DeviceDim) => !!d?.id.startsWith('typ-');
export const isBrand = (d?: DeviceDim) => !!d?.id.startsWith('brand-');
export const saveDevices = (list: DeviceDim[]) => write(DEV_KEY, list);

/** A device the panel needs, from its load schedule — what it is, not how wide (that comes from a record). */
export interface NeededDevice { key: string; kind: DeviceKind; poles: number; ratingA: number; count: number; what: string; device?: DeviceDim }

/** Physical devices of a DB from its schedule: incomer, one breaker per circuit (RCBO when the
 * circuit has its own earth leakage), one RCCB per ELCB group. Poles: 1 for a single-phase
 * circuit, 3 for a three-phase one, 4 for an RCCB on a three-phase group, 2 otherwise — the
 * actual device may differ (e.g. 1P+N); your own dimension records come first, typical widths fill the rest. */
export function neededDevices(project: Project, boardId: string, devices: DeviceDim[] = [...loadDevices(), ...BRAND_DEVICES, ...TYPICAL_DEVICES]): NeededDevice[] {
  const board = project.boards.find((b) => b.id === boardId);
  if (!board) return [];
  const list: Omit<NeededDevice, 'count' | 'key'>[] = [];
  const inc = project.feeders.find((f) => f.feedsBoardId === boardId);
  if (inc) list.push({ kind: breakerTypeOf(inc) === 'MCCB' || breakerTypeOf(inc) === 'ACB' ? 'MCCB' : 'Isolator', poles: inc.cores >= 4 ? 4 : inc.cores === 3 ? 3 : 2, ratingA: inc.breakerRatingA, what: 'Incomer' });
  const circuits = scheduleCircuits(project, boardId);
  const groups = elcbGroups(project, board);
  const inGroup = new Set(groups.flatMap((g) => g.circuits.map((c) => c.id)));
  for (const f of circuits.length ? circuits : project.feeders.filter((x) => x.boardId === boardId)) {
    const own = !!f.rcdMa && !inGroup.has(f.id);
    const t = breakerTypeOf(f);
    list.push({ kind: own ? 'RCBO' : t === 'MCCB' || t === 'ACB' ? 'MCCB' : 'MCB', poles: f.cores === 2 ? 1 : 3, ratingA: f.breakerRatingA, what: own ? 'Circuit with RCBO' : 'Circuit breaker' });
  }
  // An ELCB group covers ways across R, Y and B, so on a three-phase board its RCCB is 4-pole.
  const threePhase = (inc ? inc.cores >= 3 : false) || circuits.some((c) => c.cores !== 2 || c.phase === 'RYB') || new Set(circuits.map((c) => c.phase)).size > 1;
  for (const g of groups) list.push({ kind: 'RCCB', poles: threePhase || g.circuits.some((c) => c.cores !== 2) ? 4 : 2, ratingA: g.ratingA, what: `ELCB group ${g.index} (${g.sensitivityMa} mA)` });
  const grouped = new Map<string, NeededDevice>();
  for (const d of list) {
    const key = `${d.kind} ${d.poles}P ${d.ratingA}A`;
    const g = grouped.get(key);
    if (g) g.count++; else grouped.set(key, { ...d, key, count: 1, device: matchDevice(devices, d.kind, d.poles, d.ratingA) });
  }
  return [...grouped.values()];
}

/** First record for this kind and pole count whose rating range covers the rating (blank range = any).
 * A record with no module width (0, e.g. a chassis-mounted MCCB) doesn't map: that device needs a compartment layout. */
export function matchDevice(devices: DeviceDim[], kind: DeviceKind, poles: number, ratingA: number): DeviceDim | undefined {
  return devices.find((d) => d.modules > 0 && d.kind === kind && d.poles === poles && (d.ratingMinA === undefined || ratingA >= d.ratingMinA) && (d.ratingMaxA === undefined || ratingA <= d.ratingMaxA));
}

/** Equipment modules from the schedule; complete only when every device has a dimension record. */
export function scheduleModules(needed: NeededDevice[]): { modules: number; unmapped: NeededDevice[]; elcb: number } {
  return {
    modules: needed.reduce((s, d) => s + (d.device ? d.device.modules * d.count : 0), 0),
    unmapped: needed.filter((d) => !d.device),
    elcb: needed.filter((d) => d.kind === 'RCCB').reduce((s, d) => s + d.count, 0)
  };
}
