import { pushLibrary } from '../database/librarySync';
import type { BomItem, BomSection } from '../calc/bom';
import { BOM_SECTIONS } from '../calc/bom';
import { breakerRateAed, cableRatePerM, CURRENCY } from '../data/rates';
import { catalog, catalogRate } from '../database/catalog';
import { packageTarget, type BoqAction, type BoqLineScope, type BoqResponsibility } from './boqScope';

/** Your supplier rates, by BOM item key. Several catalogues can be kept
 * (e.g. Schneider, ABB, local panel builder); a project uses one and keeps a
 * copy of it, so the estimate travels with the file. */
export interface PriceEntry { rate?: number; labour?: number; description?: string }
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
  const entry = fallbackPriceEntry(key);
  return entry ? (entry.rate ?? 0) + (entry.labour ?? 0) : undefined;
}

/** Preserve supply and installation legs so client-supplied items retain labour only. */
export function fallbackPriceEntry(key: string): PriceEntry | undefined {
  const c = catalogRate(key);
  if (c) return { rate: c.rate, labour: c.install };
  const [kind, ...rest] = key.split(':');
  if (kind === 'cable') return { rate: cableRatePerM(Number(rest[2])) };
  if (kind === 'mccb' || kind === 'acb') return { rate: breakerRateAed(Number(rest[0])) };
  if (kind === 'mcb') return { rate: breakerRateAed(Number(rest[1])) };
  return undefined;
}

/** Your own BOQ lines and adjustments, kept with the project. */
export interface ManualItem extends BoqLineScope { id: string; section: string; description: string; unit: string; qty: number; rate?: number; labour?: number; note?: string }
export interface BoqOverride extends BoqLineScope { qty?: number; description?: string; excluded?: boolean; designQty?: number /* design qty when you set it */ }
export interface BoqCustom {
  projectType?: 'fit-out' | 'new-installation';
  includeSchedulePoints?: boolean;
  scopeReview?: Record<string, 'included' | 'by-others' | 'not-applicable'>;
  scopeNotes?: string;
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
  action: BoqAction;
  supplyBy: BoqResponsibility;
  installBy: BoqResponsibility;
  supplyCharge: boolean;
  installCharge: boolean;
  supplyRateMissing: boolean;
  installRateMissing: boolean;
  missingRate: boolean;
  includedIn?: string;
  evidence?: string;
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
  projectType?: BoqCustom['projectType'];
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
  // An invalid allowance is reported by boqReview; never turn it into a credit.
  return Number.isFinite(w) && w > 0 ? Math.ceil(raw.qty * (1 + w / 100)) : raw.qty;
}

const validRate = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0;

function applyScope(raw: BomItem, scope: BoqLineScope, quote: PriceEntry | undefined, source: PricedItem['source'], excluded = false): PricedItem {
  const action = scope.action ?? 'new';
  const supplyBy = excluded ? 'others' : scope.supplyBy ?? raw.supplyBy ?? 'contractor';
  const installBy = excluded ? 'others' : scope.installBy ?? 'contractor';
  const supplyCharge = !excluded && (action === 'new' || action === 'replace') && supplyBy === 'contractor';
  const installCharge = !excluded && action !== 'retain' && installBy === 'contractor';
  const rate = quote?.rate;
  const labour = quote?.labour ?? 0;
  // Old rate-only quotes remain usable for a complete new/replacement line.
  // Installation-only work requires a distinct labour quote, including quoted zero.
  const bundled = supplyCharge && installCharge && validRate(rate) && quote?.labour === undefined;
  const supplyRateMissing = supplyCharge && !validRate(rate);
  const installRateMissing = installCharge && !validRate(quote?.labour) && !bundled;
  const missingRate = supplyRateMissing || installRateMissing;
  const unitCost = (supplyCharge && validRate(rate) ? rate : 0) + (installCharge && validRate(quote?.labour) ? quote.labour : 0);
  const qtyValid = Number.isFinite(raw.qty) && raw.qty >= 0;
  const omitted = !supplyCharge && !installCharge;
  const note = excluded ? 'By others' : action === 'retain' ? 'Existing retained; no new supply or installation charge.' : omitted ? 'Supply and installation by others.' : undefined;
  return {
    ...raw, action, supplyBy, installBy, supplyCharge, installCharge, rate, labour,
    supplyRateMissing, installRateMissing, missingRate,
    amount: qtyValid ? raw.qty * unitCost : 0,
    source: omitted ? 'excluded' : source === 'manual' ? 'manual' : missingRate ? 'missing' : source,
    includedIn: scope.includedIn?.trim() || undefined, evidence: scope.evidence?.trim() || undefined, note
  };
}

export function priceBom(items: BomItem[], list?: PriceList, custom?: BoqCustom): PricedBom {
  const ov = custom?.overrides ?? {};
  const priced: PricedItem[] = items.map((raw) => {
    const design = designQty(raw, custom);
    const o = ov[raw.key];
    const qty = o?.qty ?? design;
    const it = { ...raw, qty, description: o?.description || raw.description };
    const extra = { designQty: o?.qty !== undefined && o.qty !== design ? design : undefined, changed: o?.designQty !== undefined && o.designQty !== design };
    const e = list?.rates[raw.key];
    const fb = e ? undefined : fallbackPriceEntry(raw.key);
    return { ...applyScope({ ...it, quantitySource: o?.qty !== undefined ? `${raw.quantitySource ?? 'Design model'}; BOQ quantity override` : raw.quantitySource }, o ?? {}, e ?? fb, e ? 'list' : fb ? 'typical' : 'missing', o?.excluded), ...extra };
  });
  for (const m of custom?.manual ?? []) {
    const scoped = applyScope({ key: `manual:${m.id}`, section: m.section, description: m.description, unit: m.unit, qty: m.qty, where: [], quantitySource: 'Manual quantity' }, m, { rate: m.rate, labour: m.labour }, 'manual');
    priced.push({ ...scoped, manualId: m.id, note: [m.note, scoped.note].filter(Boolean).join(' · ') || undefined });
  }
  // Evaluate against the unsuppressed snapshot so package chains are order-independent.
  const packageResults = priced.map((it) => packageTarget(it, priced));
  for (let i = 0; i < priced.length; i++) {
    const parent = packageResults[i].parent;
    if (!parent) continue;
    const it = priced[i];
    priced[i] = { ...it, amount: 0, source: 'excluded', missingRate: false, supplyRateMissing: false, installRateMissing: false,
      supplyCharge: false, installCharge: false, note: [it.note, `Included in package: ${parent.description}`].filter(Boolean).join(' · ') };
  }
  const titles = sectionTitles(custom);
  const order = [...Object.keys(titles), ...new Set(priced.map((x) => x.section).filter((s) => !(s in titles)))];
  const sections = order
    .map((s) => ({ section: s, title: titles[s] ?? s, items: priced.filter((x) => x.section === s) }))
    .filter((s) => s.items.length || (custom?.sections ?? []).some((c) => c.id === s.section))
    .map((s) => ({ ...s, amount: s.items.reduce((a, x) => a + x.amount, 0) }));
  const subtotal = priced.reduce((a, x) => a + x.amount, 0);
  const markupPct = list?.markupPct ?? 0;
  const discountPct = custom?.discountPct ?? 0;
  const markup = subtotal * (Number.isFinite(markupPct) && markupPct >= 0 ? markupPct / 100 : 0);
  const discount = (subtotal + markup) * (Number.isFinite(discountPct) && discountPct >= 0 && discountPct <= 100 ? discountPct / 100 : 0);
  return {
    items: priced, sections, subtotal, markup, discount, total: subtotal + markup - discount,
    missing: priced.filter((x) => x.missingRate).length,
    changed: priced.filter((x) => x.changed).length, projectType: custom?.projectType
  };
}

/** Ready-made extra scope lines (one click to add). */
export const EXTRAS: ({ section: string; description: string; unit: string; qty: number } & BoqLineScope)[] = [
  { section: 'J', description: 'Luminaire: type and product to schedule', unit: 'no', qty: 0 },
  { section: 'J', description: 'Lighting switch / dimmer / occupancy sensor: type to schedule', unit: 'no', qty: 0 },
  { section: 'J', description: 'Socket outlet / switched fused connection unit: type to schedule', unit: 'no', qty: 0 },
  { section: 'J', description: 'Emergency luminaire: type and autonomy to schedule', unit: 'no', qty: 0 },
  { section: 'J', description: 'Exit sign: type and autonomy to schedule', unit: 'no', qty: 0 },
  { section: 'K', description: 'Testing and commissioning of the LV installation, with test certificates', unit: 'LS', qty: 1 },
  { section: 'K', description: 'DEWA inspection, meter application and authority fees', unit: 'LS', qty: 1 },
  { section: 'K', description: 'Insulation resistance and earth loop impedance tests of all circuits', unit: 'LS', qty: 1 },
  { section: 'K', description: 'As-built drawings (SLD, layouts, schedules), 3 hard copies + soft copy', unit: 'set', qty: 1 },
  { section: 'K', description: 'Operation and maintenance manuals', unit: 'set', qty: 1 },
  { section: 'K', description: 'Training of the client\'s maintenance staff', unit: 'LS', qty: 1 },
  { section: 'L', description: 'Cable pulling labour for main feeders', unit: 'LS', qty: 1 },
  { section: 'L', description: 'Scaffolding and access equipment', unit: 'LS', qty: 1 },
  { section: 'L', description: 'Core drilling and fire stopping of wall / slab penetrations', unit: 'no', qty: 0 },
  { section: 'L', description: 'Excavation, sand bedding, cable tiles and backfill for buried cables', unit: 'm', qty: 0 },
  { section: 'L', description: 'Cable trench / duct bank with draw pits', unit: 'm', qty: 0 },
  { section: 'L', description: 'Conduit / local trunking: measured route, fittings basis to confirm', unit: 'm', qty: 0 },
  { section: 'L', description: 'Back box / junction box: type to schedule', unit: 'no', qty: 0 },
  { section: 'M', description: 'Provisional sum for authority requirements', unit: 'PS', qty: 1 },
  { section: 'M', description: 'Contingency', unit: 'LS', qty: 1 },
  { section: 'N', description: 'Existing installation survey and reusable-asset verification', unit: 'LS', qty: 1 },
  { section: 'N', description: 'Controlled shutdown / occupied-site access', unit: 'no', qty: 0, action: 'relocate' },
  { section: 'N', description: 'Temporary electrical supply and protection', unit: 'LS', qty: 1 },
  { section: 'N', description: 'Disconnect and remove existing electrical point / equipment', unit: 'no', qty: 0, action: 'remove' },
  { section: 'N', description: 'Relocate existing electrical point / equipment', unit: 'no', qty: 0, action: 'relocate' },
  { section: 'N', description: 'Make good after removal / relocation: area and finish to confirm', unit: 'm²', qty: 0, action: 'relocate' },
  { section: 'O', description: 'Mechanical equipment local isolator / final connection: type to schedule', unit: 'no', qty: 0 },
  { section: 'O', description: 'Mechanical equipment controls / BMS interface: scope to confirm', unit: 'no', qty: 0 },
  { section: 'O', description: 'Client-supplied plant installation / electrical interface', unit: 'no', qty: 0, supplyBy: 'client' },
  { section: 'P', description: 'Data / structured cabling point: specification to schedule', unit: 'no', qty: 0 },
  { section: 'P', description: 'Fire alarm device / interface: specification to schedule', unit: 'no', qty: 0 },
  { section: 'P', description: 'CCTV / access control point: specification to schedule', unit: 'no', qty: 0 }
];
export const EXTRA_SECTIONS: Record<string, string> = { J: 'Lighting, emergency lighting and wiring devices', K: 'Testing, commissioning and documentation', L: 'Installation works', M: 'Provisional sums', N: 'Existing installation and fit-out works', O: 'Plant and mechanical interfaces', P: 'Optional ELV systems' };

/** Change between two BOMs (e.g. revision A and now), priced with the same list. */
export interface BomChange { key: string; section: BomSection; description: string; unit: string; before: number; after: number; delta: number; cost: number }
export function compareBom(before: BomItem[], after: BomItem[], list?: PriceList): BomChange[] {
  const a = new Map(before.map((x) => [x.key, x]));
  const b = new Map(after.map((x) => [x.key, x]));
  const rateOf = (k: string) => {
    const quote = list?.rates[k] ?? fallbackPriceEntry(k);
    return (validRate(quote?.rate) ? quote.rate : 0) + (validRate(quote?.labour) ? quote.labour : 0);
  };
  const out: BomChange[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = b.get(k) ?? a.get(k)!;
    const before = a.get(k)?.qty ?? 0, after = b.get(k)?.qty ?? 0;
    if (before === after) continue;
    out.push({ key: k, section: x.section, description: x.description, unit: x.unit, before, after, delta: after - before, cost: (after - before) * rateOf(k) });
  }
  return out.sort((p, q) => p.section.localeCompare(q.section) || Math.abs(q.cost) - Math.abs(p.cost));
}

/** How the BOQ total is made up, for the reader of the PDF / Excel:
 * items priced from the list, at the built-in typical rates, with no rate
 * (left out of the total), by others, and quantities you changed. */
export interface PricingBasis { list: number; typical: number; missing: number; manual: number; excluded: number; qtyChanged: number; designMoved: number; lines: string[] }
export function pricingBasis(bom: PricedBom, list?: PriceList): PricingBasis {
  const n = (f: (x: PricedItem) => boolean) => bom.items.filter(f).length;
  const b = {
    list: n((x) => x.source === 'list'), typical: n((x) => x.source === 'typical'), missing: bom.missing,
    manual: n((x) => x.source === 'manual' && !x.missingRate), excluded: n((x) => x.source === 'excluded'),
    qtyChanged: n((x) => x.designQty !== undefined), designMoved: bom.changed
  };
  const lines = [
    list ? `${b.list} item(s) priced from ${list.name}${list.date ? ` (${list.date})` : ''}.` : 'No price list selected.',
    ...(b.typical ? [`${b.typical} item(s) at built-in typical rates — illustrative, replace with quoted rates.`] : []),
    ...(b.manual ? [`${b.manual} item(s) with rates entered by hand.`] : []),
    ...(b.missing ? [`${b.missing} item(s) have an unquoted supply or installation charge — the total is incomplete; known charges remain included.`] : []),
    ...(b.excluded ? [`${b.excluded} item(s) retained, by others or included in priced packages (not separately charged).`] : []),
    ...(b.qtyChanged ? [`${b.qtyChanged} quantity(ies) changed from the design${b.designMoved ? `; ${b.designMoved} of them where the design has moved since — review` : ''}.`] : [])
  ];
  return { ...b, lines };
}
