import type { Project } from '../types';
import type { PricedBom, PricedItem } from './priceList';
import { currentRevision } from './revisions';

/** BOQ revisions: the bill as issued (Rev 0, 1, 2…), kept inside the project file and numbered
 * separately from the design revisions. A revision stores the issued lines themselves — not a
 * copy of the project — so later price-list or design changes never alter what was issued.
 *
 * Item numbers are fixed once issued: an item keeps its number (B.4) in every later revision,
 * new items are numbered after the last one of their bill, and an omitted item's number is not
 * reused. */

export interface BoqLine {
  key: string;
  no: string; // e.g. "B.4"
  section: string;
  description: string;
  unit: string;
  qty: number;
  rate?: number; // supply rate, when charged and quoted
  labour?: number; // installation rate, when charged and quoted
  amount: number;
  excluded?: boolean; // by others, retained or included in a package
  supplyBy?: string;
  installBy?: string;
  action?: string;
}

export interface BoqRevision {
  id: string; // "0", "1", …
  date: string; // YYYY-MM-DD
  description: string;
  by?: string;
  /** The design revision the BOQ was priced from, when one had been issued. */
  designRev?: string;
  currency: string;
  lines: BoqLine[];
  sections: { section: string; title: string; amount: number }[];
  subtotal: number;
  total: number; // excluding VAT
  vat: number;
  grandTotal: number;
}

export type BoqChangeKind = 'added' | 'omitted' | 'quantity' | 'rate' | 'description' | 'scope';
export interface BoqLineChange { key: string; no: string; section: string; description: string; unit: string; kinds: BoqChangeKind[]; before?: BoqLine; after?: BoqLine; delta: number }

export const CHANGE_LABEL: Record<BoqChangeKind, string> = { added: 'Added', omitted: 'Omitted', quantity: 'Quantity', rate: 'Rate', description: 'Description', scope: 'Scope' };

export const boqRevisionsOf = (p: Project): BoqRevision[] => p.boqRevisions ?? [];
export const nextBoqRevisionId = (p: Project): string => String(boqRevisionsOf(p).length);
const itemIndex = (no: string) => Number(no.split('.').pop()) || 0;
const byNumber = (a: { section: string; no: string }, b: { section: string; no: string }) => a.section.localeCompare(b.section) || itemIndex(a.no) - itemIndex(b.no);

/** The bill with fixed item numbers: numbers issued before are kept, new items follow the
 * highest number used in their bill (issued or current), and each bill lists its items in
 * number order. Before the first issue this is plain 1, 2, 3… in the bill's own order. */
export function numberBom(bom: PricedBom, revisions: BoqRevision[] = []): PricedBom {
  const issued = new Map<string, BoqLine>();
  for (const r of revisions) for (const l of r.lines) issued.set(l.key, l);
  const top = new Map<string, number>();
  for (const l of issued.values()) top.set(l.section, Math.max(top.get(l.section) ?? 0, itemIndex(l.no)));
  const numbered = new Map<PricedItem, string>();
  for (const s of bom.sections) {
    const taken = new Set<string>();
    for (const it of s.items) {
      const was = issued.get(it.key);
      if (was && was.section === s.section && !taken.has(was.no)) { numbered.set(it, was.no); taken.add(was.no); }
    }
    for (const it of s.items) {
      if (numbered.has(it)) continue;
      const n = (top.get(s.section) ?? 0) + 1;
      top.set(s.section, n);
      numbered.set(it, `${s.section}.${n}`);
    }
  }
  const withNo = (it: PricedItem): PricedItem => ({ ...it, no: numbered.get(it) });
  const sections = bom.sections.map((s) => ({ ...s, items: s.items.map(withNo).sort((a, b) => byNumber({ section: s.section, no: a.no! }, { section: s.section, no: b.no! })) }));
  const items = sections.flatMap((s) => s.items);
  return { ...bom, sections, items: bom.items.map((it) => items.find((x) => x.key === it.key) ?? it) };
}

/** One issued line of a numbered item. */
export function lineOf(it: PricedItem, no = it.no ?? ''): BoqLine {
  const excluded = it.source === 'excluded';
  return {
    key: it.key, no, section: it.section, description: it.description, unit: it.unit,
    qty: Number.isFinite(it.qty) ? it.qty : 0,
    rate: !excluded && it.supplyCharge && !it.supplyRateMissing ? it.rate : undefined,
    labour: !excluded && it.installCharge && !it.installRateMissing ? it.labour : undefined,
    amount: it.amount, excluded: excluded || undefined,
    supplyBy: it.supplyBy, installBy: it.installBy, action: it.action
  };
}
export const linesOf = (bom: PricedBom): BoqLine[] => bom.sections.flatMap((s) => s.items.map((it) => lineOf(it)));

const same = (a: number | undefined, b: number | undefined) => (a ?? null) === (b ?? null) || (a !== undefined && b !== undefined && Math.abs(a - b) < 0.005);

/** What changed from one set of lines to another, in bill and item order. */
export function compareLines(before: BoqLine[], after: BoqLine[]): BoqLineChange[] {
  const old = new Map(before.map((l) => [l.key, l]));
  const now = new Map(after.map((l) => [l.key, l]));
  const out: BoqLineChange[] = [];
  for (const l of after) {
    const b = old.get(l.key);
    const kinds: BoqChangeKind[] = [];
    if (!b) kinds.push('added');
    else {
      if (!same(b.qty, l.qty)) kinds.push('quantity');
      if (!same(b.rate, l.rate) || !same(b.labour, l.labour)) kinds.push('rate');
      if (b.description !== l.description || b.unit !== l.unit) kinds.push('description');
      if (!!b.excluded !== !!l.excluded || b.supplyBy !== l.supplyBy || b.installBy !== l.installBy || b.action !== l.action) kinds.push('scope');
    }
    if (kinds.length) out.push({ key: l.key, no: l.no, section: l.section, description: l.description, unit: l.unit, kinds, before: b, after: l, delta: l.amount - (b?.amount ?? 0) });
  }
  for (const b of before) if (!now.has(b.key)) out.push({ key: b.key, no: b.no, section: b.section, description: b.description, unit: b.unit, kinds: ['omitted'], before: b, delta: -b.amount });
  return out.sort(byNumber);
}

/** Where the bill stands against its issued revisions — what a PDF or Excel export shows:
 * - nothing issued: a draft;
 * - unchanged since the latest issue: that revision, marked against the one before;
 * - changed since: the next revision as a draft, marked against the latest issue. */
export interface BoqRevisionState {
  /** The revision shown ("1"), undefined before the first issue. */
  rev?: string;
  draft: boolean;
  date?: string;
  designRev?: string;
  /** The revision the marks compare with. */
  previous?: BoqRevision;
  changes: BoqLineChange[];
}

export function boqRevisionState(project: Project, bom: PricedBom): BoqRevisionState {
  const revs = boqRevisionsOf(project);
  const latest = revs[revs.length - 1];
  if (!latest) return { draft: true, changes: [] };
  const lines = linesOf(bom);
  const pending = compareLines(latest.lines, lines);
  if (!pending.length && same(latest.grandTotal, bom.grandTotal)) {
    const previous = revs[revs.length - 2];
    return { rev: latest.id, draft: false, date: latest.date, designRev: latest.designRev, previous, changes: previous ? compareLines(previous.lines, latest.lines) : [] };
  }
  return { rev: nextBoqRevisionId(project), draft: true, designRev: currentRevision(project)?.id, previous: latest, changes: pending };
}

/** Records the bill as issued: the next BOQ revision. */
export function issueBoqRevision(project: Project, bom: PricedBom, r: { description: string; by?: string; date?: string }, currency: string): Project {
  const rev: BoqRevision = {
    id: nextBoqRevisionId(project),
    date: r.date ?? new Date().toISOString().slice(0, 10),
    description: r.description.trim(),
    by: r.by?.trim() || undefined,
    designRev: currentRevision(project)?.id,
    currency,
    lines: linesOf(bom),
    sections: bom.sections.map((s) => ({ section: s.section, title: s.title, amount: s.amount })),
    subtotal: bom.subtotal, total: bom.total, vat: bom.vat, grandTotal: bom.grandTotal
  };
  return { ...project, boqRevisions: [...boqRevisionsOf(project), rev] };
}

/** "qty 4 → 6 · rate 98,000.00 → 95,000.00" — the short note of a changed line. */
export function changeNote(c: BoqLineChange, money: (n: number) => string, qty: (n: number) => string): string {
  if (c.kinds.includes('added')) return 'added';
  if (c.kinds.includes('omitted')) return `omitted (was ${qty(c.before!.qty)} ${c.before!.unit}${c.before!.amount ? `, ${money(c.before!.amount)}` : ''})`;
  const b = c.before!, a = c.after!;
  const rate = (l: BoqLine) => (l.rate ?? 0) + (l.labour ?? 0);
  return c.kinds.map((k) => k === 'quantity' ? `qty ${qty(b.qty)} → ${qty(a.qty)}` : k === 'rate' ? `rate ${money(rate(b))} → ${money(rate(a))}` : k === 'description' ? 'description changed' : 'scope changed').join(' · ');
}
