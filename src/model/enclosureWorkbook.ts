import ExcelJS from 'exceljs';
import type { AllowanceRule, EnclosureCatalogue, EnclosureConfig } from '../calc/enclosure';
import { emptyCatalogue } from './enclosureLibrary';

/** The enclosure catalogue as Excel (template, export and import) — kept apart from
 * enclosureLibrary so the calculations don't load ExcelJS. */

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
