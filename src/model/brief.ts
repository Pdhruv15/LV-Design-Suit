import type { Project } from '../types';

/** The project brief: who the work is for and by whom, what it covers, and what is to be delivered.
 * Set in the New project wizard (or later from the Overview). A project without a brief (older files,
 * Quick create) behaves as before: everything is in scope. */
export type ProjectRole = 'consultant' | 'contractor';
export type ScopeId = 'sld' | 'loads' | 'studies' | 'earthing' | 'ups' | 'solar' | 'pfc' | 'containment' | 'boq';
export type PartyRole = 'owner' | 'consultant' | 'contractor' | 'authority';

export interface Party { role: PartyRole; name: string; contact?: string; tel?: string; email?: string }
export interface Deliverable { id: string; title: string; scope?: ScopeId; targetDate?: string; done?: boolean }
export interface ProjectBrief {
  role: ProjectRole;
  /** The approving authority, e.g. DEWA. */
  authority: string;
  scope: ScopeId[];
  parties: Party[];
  deliverables: Deliverable[];
  /** Contractor: what kind of installation the BOQ prices (feeds the BOQ scope review). */
  boqType?: 'fit-out' | 'new-installation';
}

export const ROLE_LABEL: Record<ProjectRole, { title: string; blurb: string }> = {
  consultant: { title: 'Consultant — design and submission', blurb: 'Design the LV system, run the studies, and prepare drawings and forms for the authority.' },
  contractor: { title: 'Contractor — build, price and hand over', blurb: 'Price the work (BOQ), coordinate containment and earthing, and hand over schedules and as-built records.' }
};

export const SCOPE_ITEMS: { id: ScopeId; label: string; hint: string }[] = [
  { id: 'sld', label: 'LV distribution and single line diagrams', hint: 'Boards, feeders, the SLD and drawing set' },
  { id: 'loads', label: 'Load schedules', hint: 'DB load schedules and the authority forms' },
  { id: 'studies', label: 'Calculations and studies', hint: 'Voltage drop, fault levels, selection, coordination' },
  { id: 'earthing', label: 'Earthing', hint: 'Earth pits, earthing schematic and checks' },
  { id: 'ups', label: 'UPS and batteries', hint: 'UPS and battery sizing' },
  { id: 'solar', label: 'Solar PV', hint: 'Array and inverter sizing' },
  { id: 'pfc', label: 'Power factor correction', hint: 'Capacitor banks' },
  { id: 'containment', label: 'Cable containment', hint: 'Trays, trunking, conduit' },
  { id: 'boq', label: 'Bill of quantities', hint: 'Quantities, rates and contractor scope' }
];

export const defaultScope = (role: ProjectRole): ScopeId[] => (role === 'consultant' ? ['sld', 'loads', 'studies', 'earthing'] : ['loads', 'boq', 'containment', 'earthing']);

/** Deliverables the app can suggest for a role and scope. Ids are stable so edits survive scope changes. */
export function deliverableCatalog(role: ProjectRole, scope: ScopeId[], authority: string): Deliverable[] {
  const has = (s: ScopeId) => scope.includes(s);
  const d = (id: string, title: string, s?: ScopeId): Deliverable => ({ id, title, ...(s ? { scope: s } : {}) });
  const auth = authority.trim() || 'authority';
  if (role === 'consultant') {
    return [
      has('sld') && d('sld-set', 'Single line diagram set', 'sld'),
      has('loads') && d('load-schedules', 'Load schedules and submission forms', 'loads'),
      has('studies') && d('calc-report', 'Calculation report', 'studies'),
      has('earthing') && d('earthing-schematic', 'Earthing schematic', 'earthing'),
      has('ups') && d('ups-report', 'UPS and battery report', 'ups'),
      has('solar') && d('solar-report', 'Solar PV report', 'solar'),
      has('pfc') && d('pfc-report', 'Power factor correction report', 'pfc'),
      has('containment') && d('containment', 'Cable containment layout and schedule', 'containment'),
      has('boq') && d('boq', 'Bill of quantities', 'boq'),
      d('submission', `${auth} submission package`)
    ].filter((x): x is Deliverable => !!x);
  }
  return [
    has('boq') && d('priced-boq', 'Priced BOQ / tender submission', 'boq'),
    d('material-approvals', 'Material approval submittals'),
    has('sld') && d('shop-drawings', 'Shop drawings (SLD)', 'sld'),
    has('loads') && d('load-schedules', 'Load schedules (as installed)', 'loads'),
    has('containment') && d('containment', 'Containment installation records', 'containment'),
    has('earthing') && d('earthing-tests', 'Earthing test records', 'earthing'),
    d('testing', 'Testing and commissioning records'),
    d('as-built', 'As-built drawings and handover')
  ].filter((x): x is Deliverable => !!x);
}

const PARTIES: PartyRole[] = ['owner', 'consultant', 'contractor', 'authority'];
export const PARTY_LABEL: Record<PartyRole, string> = { owner: 'Owner / client', consultant: 'Consultant', contractor: 'Contractor', authority: 'Authority' };

/** A new brief with the role's default scope and deliverables; the user's own company fills their side. */
export function newBrief(role: ProjectRole, opts: { authority?: string; company?: string } = {}): ProjectBrief {
  const authority = opts.authority ?? 'DEWA';
  const scope = defaultScope(role);
  return {
    role, authority, scope,
    parties: PARTIES.map((r) => ({ role: r, name: r === 'authority' ? authority : r === role ? opts.company ?? '' : '' })),
    deliverables: deliverableCatalog(role, scope, authority),
    ...(role === 'contractor' ? { boqType: 'new-installation' as const } : {})
  };
}

const isCustom = (d: Deliverable) => d.id.startsWith('custom-');

/** Changes the scope: suggested deliverables for what was added appear, those for what was removed go
 * (unless already done), the user's own and the edits to dates and ticks are kept. */
export function withScope(b: ProjectBrief, scope: ScopeId[]): ProjectBrief {
  const wanted = deliverableCatalog(b.role, scope, b.authority);
  const have = new Map(b.deliverables.map((d) => [d.id, d]));
  const kept = b.deliverables.filter((d) => isCustom(d) || d.done || wanted.some((w) => w.id === d.id));
  const added = wanted.filter((w) => !have.has(w.id));
  const order = new Map(wanted.map((w, i) => [w.id, i]));
  const merged = [...kept, ...added].sort((x, y) => (isCustom(x) ? 1e6 : order.get(x.id) ?? 1e5) - (isCustom(y) ? 1e6 : order.get(y.id) ?? 1e5));
  return { ...b, scope, deliverables: merged };
}

/** Changing the role starts from that role's scope and deliverables but keeps the parties' details. */
export function withRole(b: ProjectBrief, role: ProjectRole, company?: string): ProjectBrief {
  if (b.role === role) return b;
  const fresh = newBrief(role, { authority: b.authority, company });
  return { ...fresh, parties: fresh.parties.map((p) => ({ ...(b.parties.find((x) => x.role === p.role) ?? p), ...(p.name && !b.parties.find((x) => x.role === p.role)?.name ? { name: p.name } : {}) })) };
}

/** Whether a part of the app is in this project's scope (everything is, without a brief). */
export const inScope = (p: Pick<Project, 'brief'>, id: ScopeId): boolean => !p.brief || p.brief.scope.includes(id);

export function deliverableProgress(b?: ProjectBrief): { done: number; total: number } {
  const list = b?.deliverables ?? [];
  return { done: list.filter((d) => d.done).length, total: list.length };
}

/** The project with this brief, and the header details (owner, consultant, contractor, phone) filled from the parties;
 * blank party names never erase what is already there. */
export function applyBrief(p: Project, b: ProjectBrief): Project {
  const name = (r: PartyRole) => b.parties.find((x) => x.role === r)?.name.trim() || undefined;
  const owner = b.parties.find((x) => x.role === 'owner');
  const info = { ...p.info };
  if (name('owner')) info.owner = name('owner');
  if (name('consultant')) info.consultant = name('consultant');
  if (name('contractor')) info.contractor = name('contractor');
  if (owner?.tel?.trim()) info.tel = owner.tel.trim();
  const next: Project = { ...p, brief: b, info };
  if (b.role === 'contractor' && b.scope.includes('boq') && b.boqType) next.boq = { ...p.boq, projectType: b.boqType };
  return next;
}
