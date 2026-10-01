import { pushLibrary } from '../database/librarySync';
import type { BomItem, BomSection } from '../calc/bom';
import { BOM_SECTIONS } from '../calc/bom';
import { breakerRateAed, cableRatePerM, CURRENCY } from '../data/rates';
import { catalog, catalogRate } from '../database/catalog';

/** Your supplier rates, by BOM item key. Several catalogues can be kept
 * (e.g. Schneider, ABB, local panel builder); a project uses one and keeps a
 * copy of it, so the estimate travels with the file. */
export interface PriceEntry { rate: number; labour?: number; description?: string }
export interface PriceList {
  id: string;
  name: string;
  date: string; // rates valid on
  currency: string;
  markupPct: number; // overheads and profit on supply + install
  rates: Record<string, PriceEntry>;
}

export const newPriceList = (name = 'My rates'): PriceList => ({
  id: `pl-${Date.now().toString(36)}`, name, date: new Date().toISOString().slice(0, 10), currency: CURRENCY, markupPct: 0, rates: {}
});

const KEY = 'lvds.priceLists';
/** Price lists: those in Prices.xlsx, then the ones saved on this computer. */
export function loadPriceLists(): PriceList[] {
  let mine: PriceList[] = [];
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); mine = Array.isArray(v) ? v : []; } catch { /* none */ }
  return [...catalog().priceLists, ...mine.filter((l) => !l.id.startsWith('xl-'))];
}
export function savePriceLists(lists: PriceList[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(lists)); void pushLibrary(); } catch { /* storage full or blocked */ }
}

/** Built-in illustrative rates (cables and breakers only) when the list has none. */
export function fallbackRate(key: string): number | undefined {
  const c = catalogRate(key);
  if (c) return c.rate + (c.install ?? 0);
  const [kind, ...rest] = key.split(':');
  if (kind === 'cable') return cableRatePerM(Number(rest[2]));
  if (kind === 'mccb' || kind === 'acb') return breakerRateAed(Number(rest[0]));
  if (kind === 'mcb') return breakerRateAed(Number(rest[1]));
  return undefined;
}

/** Your own BOQ lines and adjustments, kept with the project. */
export interface ManualItem { id: string; section: string; description: string; unit: string; qty: number; rate?: number; labour?: number; note?: string }
export interface BoqOverride { qty?: number; description?: string; excluded?: boolean; designQty?: number /* design qty when you set it */ }
export interface BoqCustom {
  sections?: { id: string; title: string }[]; // your sections, J, K…
  manual?: ManualItem[];
  overrides?: Record<string, BoqOverride>;
  wastage?: Record<string, number>; // % per section, on design quantities
  discountPct?: number;
}

export interface PricedItem extends BomItem {
  rate?: number;
  labour: number;
  amount: number; // qty × (rate + labour)
  source: 'list' | 'typical' | 'missing' | 'manual' | 'excluded';
  designQty?: number; // quantity from the design, when yours differs
  changed?: boolean; // the design quantity moved since you adjusted it
  note?: string;
  manualId?: string;
}
export interface PricedBom {
  items: PricedItem[];
  sections: { section: BomSection; title: string; amount: number; items: PricedItem[] }[];
  subtotal: number;
  markup: number;
  discount: number;
  total: number;
  missing: number;
  changed: number;
}

export const sectionTitles = (custom?: BoqCustom): Record<string, string> => ({
  ...BOM_SECTIONS, ...Object.fromEntries((custom?.sections ?? []).map((s) => [s.id, s.title]))
});
/** Next free section letter after the design ones. */
export function nextSectionId(custom?: BoqCustom): string {
  const used = new Set(Object.keys(sectionTitles(custom)));
  for (let i = 9; i < 26; i++) { const id = String.fromCharCode(65 + i); if (!used.has(id)) return id; }
  return `S${used.size + 1}`;
}

/** Design quantity with the section's wastage allowance (rounded up). */
export function designQty(raw: BomItem, custom?: BoqCustom): number {
  const w = custom?.wastage?.[raw.section] ?? 0;
  return w ? Math.ceil(raw.qty * (1 + w / 100)) : raw.qty;
}

export function priceBom(items: BomItem[], list?: PriceList, custom?: BoqCustom): PricedBom {
  const ov = custom?.overrides ?? {};
  const priced: PricedItem[] = items.map((raw) => {
    const design = designQty(raw, custom);
    const o = ov[raw.key];
    const qty = o?.qty ?? design;
    const it = { ...raw, qty, description: o?.description || raw.description };
    const extra = { designQty: o?.qty !== undefined && o.qty !== design ? design : undefined, changed: o?.designQty !== undefined && o.designQty !== design };
    if (o?.excluded) return { ...it, ...extra, labour: 0, amount: 0, source: 'excluded' as const, note: 'By others' };
    const e = list?.rates[raw.key];
    const fb = e ? undefined : fallbackRate(raw.key);
    const rate = e?.rate ?? fb;
    const labour = e?.labour ?? 0;
    return { ...it, ...extra, rate, labour, amount: rate === undefined ? 0 : qty * (rate + labour), source: e ? 'list' as const : fb !== undefined ? 'typical' as const : 'missing' as const };
  });
  for (const m of custom?.manual ?? []) {
    const labour = m.labour ?? 0;
    priced.push({ key: `manual:${m.id}`, manualId: m.id, section: m.section, description: m.description, unit: m.unit, qty: m.qty, where: [], note: m.note,
      rate: m.rate, labour, amount: m.rate === undefined && !labour ? 0 : m.qty * ((m.rate ?? 0) + labour), source: 'manual' });
  }
  const titles = sectionTitles(custom);
  const order = [...Object.keys(titles), ...new Set(priced.map((x) => x.section).filter((s) => !(s in titles)))];
  const sections = order
    .map((s) => ({ section: s, title: titles[s] ?? s, items: priced.filter((x) => x.section === s) }))
    .filter((s) => s.items.length || (custom?.sections ?? []).some((c) => c.id === s.section))
    .map((s) => ({ ...s, amount: s.items.reduce((a, x) => a + x.amount, 0) }));
  const subtotal = priced.reduce((a, x) => a + x.amount, 0);
  const markup = subtotal * ((list?.markupPct ?? 0) / 100);
  const discount = (subtotal + markup) * ((custom?.discountPct ?? 0) / 100);
  return {
    items: priced, sections, subtotal, markup, discount, total: subtotal + markup - discount,
    missing: priced.filter((x) => x.source === 'missing' || (x.source === 'manual' && x.rate === undefined && !x.labour)).length,
    changed: priced.filter((x) => x.changed).length
  };
}

/** Ready-made extra scope lines (one click to add). */
export const EXTRAS: { section: string; description: string; unit: string; qty: number }[] = [
  { section: 'K', description: 'Testing and commissioning of the LV installation, with test certificates', unit: 'LS', qty: 1 },
  { section: 'K', description: 'DEWA inspection, meter application and authority fees', unit: 'LS', qty: 1 },
  { section: 'K', description: 'Insulation resistance and earth loop impedance tests of all circuits', unit: 'LS', qty: 1 },
  { section: 'K', description: 'As-built drawings (SLD, layouts, schedules), 3 hard copies + soft copy', unit: 'set', qty: 1 },
  { section: 'K', description: 'Operation and maintenance manuals', unit: 'set', qty: 1 },
  { section: 'K', description: 'Training of the client\'s maintenance staff', unit: 'LS', qty: 1 },
  { section: 'L', description: 'Cable pulling labour for main feeders', unit: 'LS', qty: 1 },
  { section: 'L', description: 'Scaffolding and access equipment', unit: 'LS', qty: 1 },
  { section: 'L', description: 'Core drilling and fire stopping of wall / slab penetrations', unit: 'no', qty: 1 },
  { section: 'L', description: 'Excavation, sand bedding, cable tiles and backfill for buried cables', unit: 'm', qty: 1 },
  { section: 'L', description: 'Cable trench / duct bank with draw pits', unit: 'm', qty: 1 },
  { section: 'M', description: 'Provisional sum for authority requirements', unit: 'PS', qty: 1 },
  { section: 'M', description: 'Contingency', unit: 'LS', qty: 1 }
];
export const EXTRA_SECTIONS: Record<string, string> = { K: 'Testing, commissioning and documentation', L: 'Installation works', M: 'Provisional sums' };

/** Change between two BOMs (e.g. revision A and now), priced with the same list. */
export interface BomChange { key: string; section: BomSection; description: string; unit: string; before: number; after: number; delta: number; cost: number }
export function compareBom(before: BomItem[], after: BomItem[], list?: PriceList): BomChange[] {
  const a = new Map(before.map((x) => [x.key, x]));
  const b = new Map(after.map((x) => [x.key, x]));
  const rateOf = (k: string) => (list?.rates[k] ? list.rates[k].rate + (list.rates[k].labour ?? 0) : fallbackRate(k) ?? 0);
  const out: BomChange[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = b.get(k) ?? a.get(k)!;
    const before = a.get(k)?.qty ?? 0, after = b.get(k)?.qty ?? 0;
    if (before === after) continue;
    out.push({ key: k, section: x.section, description: x.description, unit: x.unit, before, after, delta: after - before, cost: (after - before) * rateOf(k) });
  }
  return out.sort((p, q) => p.section.localeCompare(q.section) || Math.abs(q.cost) - Math.abs(p.cost));
}
