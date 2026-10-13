import type { BomItem } from '../calc/bom';
import type { Project } from '../types';
import { boqRevisionsOf, nextBoqRevisionId, type BoqRevision } from './boqRevisions';
import { designQty, validVat, type BoqCustom, type ManualItem, type PricedBom } from './priceList';

/** Variations (VO-001, VO-002…): additions to and omissions from the contract scope, each with
 * its reason, instruction, status and value. The contract sum is a BOQ revision you mark as the
 * contract; approved variations are added on top of it and the contract BOQ itself is not
 * changed — unless you bring approved variations into the working BOQ ("fold in"), which then
 * shows them as △ changes in the next BOQ revision. */

export type VoStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn';
export const VO_STATUS: Record<VoStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn' };
export const INSTRUCTED_BY = ['Client', 'Consultant', 'Authority', 'Main contractor', 'Contractor proposal'];

export interface VoLine {
  id: string;
  /** The BOQ item it adds to or omits from; none for a new item. */
  key?: string;
  /** BOQ item number (B.4), or VO-001/1 for a new item. */
  no: string;
  description: string;
  unit: string;
  add?: number;
  omit?: number;
  rate: number; // per unit, supply + installation
  /** "Contract rate" for BOQ items, "New rate" (and its source) for new items. */
  basis?: string;
  /** Bill a new item goes into when the variation is brought into the BOQ. */
  section?: string;
}

export interface Variation {
  id: string; // VO-001
  title: string;
  reason?: string;
  instructedBy?: string;
  reference?: string; // site instruction, letter, comment sheet…
  raised: string; // YYYY-MM-DD
  submitted?: string;
  decided?: string;
  decisionRef?: string;
  approvedValue?: number; // when the agreed value differs from the lines
  status: VoStatus;
  lines: VoLine[];
  /** The BOQ revision it was brought into (the next one when folded in). */
  foldedInto?: string;
}

export const variationsOf = (p: Project): Variation[] => p.variations ?? [];
export const nextVariationId = (p: Project) => `VO-${String(Math.max(0, ...variationsOf(p).map((v) => Number(v.id.replace(/\D/g, '')) || 0)) + 1).padStart(3, '0')}`;
const finite = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : 0);
export const lineAmount = (l: VoLine) => (finite(l.add) - finite(l.omit)) * finite(l.rate);
export const additionsOf = (v: Variation) => v.lines.reduce((a, l) => a + finite(l.add) * finite(l.rate), 0);
export const omissionsOf = (v: Variation) => v.lines.reduce((a, l) => a + finite(l.omit) * finite(l.rate), 0);
export const netOf = (v: Variation) => additionsOf(v) - omissionsOf(v);
/** The value that counts: the agreed value of an approved variation, else its lines. */
export const valueOf = (v: Variation) => (v.status === 'approved' && v.approvedValue !== undefined && Number.isFinite(v.approvedValue) ? v.approvedValue : netOf(v));

/** The BOQ revision marked as the contract (the latest one marked). */
export const contractRevision = (p: Project): BoqRevision | undefined => [...boqRevisionsOf(p)].reverse().find((r) => r.contract);
export function setContractRevision(p: Project, id: string | undefined): Project {
  return { ...p, boqRevisions: boqRevisionsOf(p).map((r) => ({ ...r, contract: r.id === id || undefined })) };
}

/** Whether an approved variation is already inside the contract BOQ (folded into it, or into an earlier revision). */
const inContract = (v: Variation, contract?: BoqRevision) => !!contract && v.foldedInto !== undefined && Number(v.foldedInto) <= Number(contract.id);

export interface VariationTotals {
  contract?: BoqRevision;
  contractSum: number;
  approved: Variation[];
  approvedSum: number;
  revised: number;
  pending: Variation[];
  pendingSum: number;
  anticipated: number;
  drafts: Variation[];
  closed: Variation[]; // rejected and withdrawn, at nil
  inContract: Variation[];
  vatPct: number;
}

/** The contract sum account, excluding VAT: contract BOQ + approved = revised; + submitted = anticipated final. */
export function variationTotals(p: Project): VariationTotals {
  const contract = contractRevision(p);
  const vos = variationsOf(p);
  const counted = vos.filter((v) => !inContract(v, contract));
  const approved = counted.filter((v) => v.status === 'approved');
  const pending = counted.filter((v) => v.status === 'submitted');
  const contractSum = contract?.total ?? 0;
  const approvedSum = approved.reduce((a, v) => a + valueOf(v), 0);
  const pendingSum = pending.reduce((a, v) => a + valueOf(v), 0);
  return {
    contract, contractSum, approved, approvedSum, revised: contractSum + approvedSum, pending, pendingSum, anticipated: contractSum + approvedSum + pendingSum,
    drafts: vos.filter((v) => v.status === 'draft'), closed: vos.filter((v) => v.status === 'rejected' || v.status === 'withdrawn'),
    inContract: vos.filter((v) => v.status === 'approved' && inContract(v, contract)), vatPct: validVat(p.boq?.vatPct)
  };
}

export function saveVariation(p: Project, v: Variation): Project {
  const list = variationsOf(p);
  return { ...p, variations: list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v] };
}
export function deleteVariation(p: Project, id: string): Project {
  const left = variationsOf(p).filter((v) => v.id !== id);
  return { ...p, variations: left.length ? left : undefined };
}

/** Which status a variation can move to from its current one. */
export const NEXT_STATUS: Record<VoStatus, VoStatus[]> = {
  draft: ['submitted', 'withdrawn'], submitted: ['approved', 'rejected', 'withdrawn', 'draft'], approved: ['submitted'], rejected: ['draft'], withdrawn: ['draft']
};

/** The contract rate of a BOQ item (supply + installation) from the contract revision, else the bill as it is. */
export function contractRate(p: Project, bom: PricedBom, key: string): number {
  const l = contractRevision(p)?.lines.find((x) => x.key === key);
  if (l) return finite(l.rate) + finite(l.labour);
  const it = bom.items.find((x) => x.key === key);
  return it ? finite(it.rate) + finite(it.labour) : 0;
}

export const VO_SECTION = { id: 'V', title: 'Variations' };

/** Brings approved variations into the working BOQ: BOQ items get their quantity changed (your
 * quantity, kept with the design quantity it was set against), new items become your own lines
 * with the variation's rate. The next BOQ revision then marks them △. */
export function foldVariations(p: Project, items: BomItem[], bom: PricedBom, ids: string[]): Project {
  const target = nextBoqRevisionId(p);
  let custom: BoqCustom = { ...p.boq };
  const manual = [...(custom.manual ?? [])];
  const overrides = { ...custom.overrides };
  const sections = [...(custom.sections ?? [])];
  for (const v of variationsOf(p).filter((x) => ids.includes(x.id) && x.status === 'approved' && x.foldedInto === undefined)) {
    for (const l of v.lines) {
      const delta = finite(l.add) - finite(l.omit);
      if (l.key?.startsWith('manual:')) {
        const i = manual.findIndex((m) => `manual:${m.id}` === l.key);
        if (i >= 0) manual[i] = { ...manual[i], qty: Math.max(0, manual[i].qty + delta) };
      } else if (l.key) {
        const raw = items.find((x) => x.key === l.key);
        const now = bom.items.find((x) => x.key === l.key)?.qty ?? 0;
        if (raw) overrides[l.key] = { ...overrides[l.key], qty: Math.max(0, now + delta), designQty: designQty(raw, custom) };
      } else {
        const section = l.section || VO_SECTION.id;
        if (section === VO_SECTION.id && !sections.some((s) => s.id === section)) sections.push(VO_SECTION);
        const m: ManualItem = { id: `${v.id.toLowerCase()}-${l.id}`, section, description: l.description, unit: l.unit, qty: Math.max(0, delta), rate: finite(l.rate), labour: 0, note: `${v.id}` };
        manual.push(m);
      }
    }
  }
  custom = { ...custom, manual, overrides, sections: sections.length ? sections : undefined };
  return { ...p, boq: custom, variations: variationsOf(p).map((v) => (ids.includes(v.id) && v.status === 'approved' && v.foldedInto === undefined ? { ...v, foldedInto: target } : v)) };
}
