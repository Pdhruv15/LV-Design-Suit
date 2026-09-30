import type { BomItem, BomSection } from '../calc/bom';
import { BOM_SECTIONS } from '../calc/bom';
import { breakerRateAed, cableRatePerM, CURRENCY } from '../data/rates';

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
export function loadPriceLists(): PriceList[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function savePriceLists(lists: PriceList[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(lists)); } catch { /* storage full or blocked */ }
}

/** Built-in illustrative rates (cables and breakers only) when the list has none. */
export function fallbackRate(key: string): number | undefined {
  const [kind, ...rest] = key.split(':');
  if (kind === 'cable') return cableRatePerM(Number(rest[2]));
  if (kind === 'mccb' || kind === 'acb') return breakerRateAed(Number(rest[0]));
  if (kind === 'mcb') return breakerRateAed(Number(rest[1]));
  return undefined;
}

export interface PricedItem extends BomItem {
  rate?: number;
  labour: number;
  amount: number; // qty × (rate + labour)
  source: 'list' | 'typical' | 'missing';
}
export interface PricedBom {
  items: PricedItem[];
  sections: { section: BomSection; title: string; amount: number; items: PricedItem[] }[];
  subtotal: number;
  markup: number;
  total: number;
  missing: number;
}

export function priceBom(items: BomItem[], list?: PriceList): PricedBom {
  const priced: PricedItem[] = items.map((it) => {
    const e = list?.rates[it.key];
    const fb = e ? undefined : fallbackRate(it.key);
    const rate = e?.rate ?? fb;
    const labour = e?.labour ?? 0;
    return { ...it, rate, labour, amount: rate === undefined ? 0 : it.qty * (rate + labour), source: e ? 'list' : fb !== undefined ? 'typical' : 'missing' };
  });
  const sections = (Object.keys(BOM_SECTIONS) as BomSection[])
    .map((s) => ({ section: s, title: BOM_SECTIONS[s], items: priced.filter((x) => x.section === s) }))
    .filter((s) => s.items.length)
    .map((s) => ({ ...s, amount: s.items.reduce((a, x) => a + x.amount, 0) }));
  const subtotal = priced.reduce((a, x) => a + x.amount, 0);
  const markup = subtotal * ((list?.markupPct ?? 0) / 100);
  return { items: priced, sections, subtotal, markup, total: subtotal + markup, missing: priced.filter((x) => x.source === 'missing').length };
}

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
