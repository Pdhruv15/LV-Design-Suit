import type { Project } from '../types';
import { runCalculations, type CalcRun } from '../calc/runs';
import { sizeUps, type UpsSystem } from '../calc/ups';
import { buildBom } from '../calc/bom';
import { fallbackPriceEntry, type PriceList } from './priceList';
import { impactBetween, type DesignImpact } from './designImpact';
import { designFingerprint, withProposal, type ModificationRecord } from './designChanges';
import { stableHash } from './proposalRules';
import type { Status } from '../calc/electrical';

/** The preview of a proposal: what applying it would change, with results calculated fresh for both the working design and
 * the design with the proposal applied (never the stored last run), and the effect on drawings and BOQ quantities. It is
 * labelled Proposed, changes nothing, and says when it no longer matches the design it was made from. */
const EPS = 1e-9;
const differs = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? a !== b : Math.abs(a - b) > EPS);

export interface CircuitResultChange { id: string; boardId: string; metric: string; from: number; to: number; unit: string }
export interface StatusChange { what: string; from: Status | 'ok' | 'bad'; to: Status | 'ok' | 'bad' }
export interface UpsChange { id: string; name: string; rows: { metric: string; from: string; to: string }[]; unverified: string[]; issues: string[] }
export interface QuantityEffect {
  key: string; description: string; unit: string; from: number; to: number; delta: number;
  /** Cost of the change at the current rate: a number, "Unpriced" (no rate), or "Not determined" (the route length is not measured). */
  cost: number | 'Unpriced' | 'Not determined';
  note?: string;
}
export interface DocumentEffect { label: string; reason: string; certainty: 'known' | 'manual review'; view?: DesignImpact['documents'][number]['view'] }

export interface ProposalPreview {
  /** Always "Proposed": these are calculated for the proposal, not for the working design. */
  label: 'Proposed';
  /** What this preview was made from; compare with `previewInputs` to find out whether it is stale. */
  inputs: string;
  impact: DesignImpact;
  circuits: CircuitResultChange[];
  statuses: StatusChange[];
  ups: UpsChange[];
  documents: DocumentEffect[];
  quantities: QuantityEffect[];
  /** BOQ quantity adjustments (yours) on keys the proposal moves: to reconcile, never overwritten. */
  adjustments: string[];
  limitations: string[];
  skipped: string[];
}

const KEYS = (rec: ModificationRecord) => rec.ops.map((o) => [o.id, o.target, o.targetId ?? null, o.field, o.after ?? null]);

/** What a preview depends on: the working design's engineering content, the proposal's changes and the price list. */
export const previewInputs = (p: Project, rec: ModificationRecord, list?: PriceList): string =>
  stableHash([designFingerprint(p), p.boq?.overrides ?? null, KEYS(rec), list?.rates ?? null]);
/** The preview was made from different inputs than the design and proposal now have. */
export const isPreviewStale = (p: Project, rec: ModificationRecord, prev: ProposalPreview, list?: PriceList): boolean => prev.inputs !== previewInputs(p, rec, list);

function circuitChanges(a: CalcRun, b: CalcRun): { circuits: CircuitResultChange[]; statuses: StatusChange[] } {
  const circuits: CircuitResultChange[] = [], statuses: StatusChange[] = [];
  const bm = new Map(b.results.map((r) => [r.feeder.id, r]));
  const metrics: [string, string, (r: CalcRun['results'][number]) => number][] = [
    ['Design current Ib', 'A', (r) => r.ib], ['Cable rating Iz', 'A', (r) => r.ampacity], ['Breaker loading', '%', (r) => r.loadingPct],
    ['Voltage drop to end', '%', (r) => r.vdTotalPct], ['Fault at breaker', 'kA', (r) => r.breakerFaultKA], ['Fault at cable end', 'kA', (r) => r.endFaultKA]
  ];
  for (const x of a.results) {
    const y = bm.get(x.feeder.id);
    if (!y) continue;
    for (const [metric, unit, get] of metrics) if (differs(get(x), get(y))) circuits.push({ id: x.feeder.id, boardId: x.feeder.boardId, metric, from: get(x), to: get(y), unit });
    if (x.status !== y.status) statuses.push({ what: `Circuit ${x.feeder.id}`, from: x.status, to: y.status });
    if (x.protectionStatus !== y.protectionStatus) statuses.push({ what: `Circuit ${x.feeder.id} overload protection`, from: x.protectionStatus, to: y.protectionStatus });
    if (x.icuStatus !== y.icuStatus) statuses.push({ what: `Circuit ${x.feeder.id} breaking capacity`, from: x.icuStatus, to: y.icuStatus });
  }
  const em = new Map(b.earthing.map((r) => [r.feeder.id, r]));
  for (const x of a.earthing) { const y = em.get(x.feeder.id); if (y && x.status !== y.status) statuses.push({ what: `Circuit ${x.feeder.id} earth-fault disconnection`, from: x.status, to: y.status }); }
  const key = (r: CalcRun['selectivity'][number]) => `${r.upstream.id}>${r.downstream.id}`;
  const sm = new Map(b.selectivity.map((r) => [key(r), r]));
  for (const x of a.selectivity) { const y = sm.get(key(x)); if (y && x.status !== y.status) statuses.push({ what: `Selectivity ${x.upstream.id} → ${x.downstream.id}`, from: x.status, to: y.status }); }
  return { circuits, statuses };
}

const num = (v: number | undefined, d = 1, u = '') => (v === undefined ? 'none' : `${(Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-US')}${u}`);

function upsChanges(a: Project, b: Project): UpsChange[] {
  const out: UpsChange[] = [];
  for (const u of a.upsSystems ?? []) {
    const v = (b.upsSystems ?? []).find((x) => x.id === u.id);
    if (!v) continue;
    const r1 = sizeUps(a, u as UpsSystem), r2 = sizeUps(b, v as UpsSystem);
    const rows: UpsChange['rows'] = [];
    const cmp = (metric: string, x: number | undefined, y: number | undefined, d = 1, unit = '') => { if (differs(x, y)) rows.push({ metric, from: num(x, d, unit), to: num(y, d, unit) }); };
    cmp('Load', r1.loadKva, r2.loadKva, 1, ' kVA'); cmp('UPS size', r1.upsKva, r2.upsKva, 0, ' kVA'); cmp('UPS loading', r1.loadingPct, r2.loadingPct, 1, ' %');
    cmp('Battery capacity (C10)', r1.requiredAh, r2.requiredAh, 0, ' Ah'); cmp('Strings', r1.strings, r2.strings, 0); cmp('Blocks', r1.totalBlocks, r2.totalBlocks, 0);
    cmp('Installed energy', r1.energyKwh, r2.energyKwh, 1, ' kWh'); cmp('Usable fraction', r1.usableFraction, r2.usableFraction, 2); cmp('Runtime with this battery', r1.runtimeMin, r2.runtimeMin, 0, ' min');
    cmp('DC breaker', r1.dcBreakerA, r2.dcBreakerA, 0, ' A'); cmp('DC current', r1.dcCurrentMaxA, r2.dcCurrentMaxA, 0, ' A'); cmp('Recharge time', r1.rechargeHours, r2.rechargeHours, 1, ' h');
    if (!rows.length && r1.batteryIssue === r2.batteryIssue && r1.rechargeIssue === r2.rechargeIssue) continue;
    const issues = [r2.batteryIssue, r2.rechargeIssue, r2.sourceIssue, r2.busMismatch].filter((x): x is string => !!x);
    const unverified = [r2.bmsOk === undefined ? 'BMS discharge-current compatibility is not verified (no BMS limit entered).' : '', 'Transient / manufacturer-specific behaviour is not verified by this calculation.'].filter(Boolean);
    out.push({ id: u.id, name: u.name || u.id, rows, unverified, issues });
  }
  return out;
}

function quantityEffects(a: Project, b: Project, affectedFeeders: Set<string>, list?: PriceList): QuantityEffect[] {
  const qa = new Map(buildBom(a).map((i) => [i.key, i])), qb = new Map(buildBom(b).map((i) => [i.key, i]));
  const unmeasured = [...affectedFeeders].some((id) => { const f = b.feeders.find((x) => x.id === id) ?? a.feeders.find((x) => x.id === id); return !!f && (f.lengthToCheck || !(f.lengthM > 0)); });
  const out: QuantityEffect[] = [];
  for (const key of new Set([...qa.keys(), ...qb.keys()])) {
    const x = qa.get(key), y = qb.get(key), from = x?.qty ?? 0, to = y?.qty ?? 0;
    if (Math.abs(from - to) < EPS) continue;
    const it = (y ?? x)!, delta = to - from;
    const quote = list?.rates[key] ?? fallbackPriceEntry(key);
    const rate = (typeof quote?.rate === 'number' && quote.rate >= 0 ? quote.rate : 0) + (typeof quote?.labour === 'number' && quote.labour >= 0 ? quote.labour : 0);
    const priced = !!quote && (quote.rate !== undefined || quote.labour !== undefined);
    const cable = /^(cable|wire|cpc|tray)/.test(key) || /cable|conductor|wiring/i.test(it.description);
    const cost: QuantityEffect['cost'] = cable && unmeasured ? 'Not determined' : priced ? delta * rate : 'Unpriced';
    out.push({ key, description: it.description, unit: it.unit, from, to, delta, cost, note: cost === 'Not determined' ? 'A circuit’s route length is a placeholder or not entered, so the quantity effect is not determined.' : cost === 'Unpriced' ? 'No rate for this item.' : fallbackPriceEntry(key) && !list?.rates[key] ? 'At the built-in typical rate: an estimate, not a quotation.' : undefined });
  }
  return out.sort((p, q) => p.description.localeCompare(q.description));
}

export function previewProposal(p: Project, rec: ModificationRecord, list?: PriceList): ProposalPreview {
  const skipped = rec.ops.filter((o) => (o.target === 'feeder' ? !p.feeders.some((f) => f.id === o.targetId) : o.target === 'board' ? !p.boards.some((x) => x.id === o.targetId) : o.target === 'ups' ? !(p.upsSystems ?? []).some((u) => u.id === o.targetId) : false))
    .map((o) => `${o.targetId} — ${o.label}: the item no longer exists, so this change is not part of the preview.`);
  const after = withProposal(p, rec);
  const impact = impactBetween(p, after);
  // Whole-network calculations for both, then only what differs is shown: an isolated circuit is never calculated alone.
  const { circuits, statuses } = circuitChanges(runCalculations(p), runCalculations(after));
  const ups = upsChanges(p, after);
  const touched = new Set(rec.ops.filter((o) => o.target === 'feeder').map((o) => o.targetId!));
  const quantities = quantityEffects(p, after, touched, list);
  const documents: DocumentEffect[] = impact.documents.map((d) => ({ ...d, certainty: d.reason.startsWith('shows ') ? 'known' : 'manual review' }));
  const keys = new Set(quantities.map((q) => q.key));
  const adjustments = Object.entries(p.boq?.overrides ?? {}).filter(([k, o]) => keys.has(k) && (o.qty !== undefined || o.excluded)).map(([k]) => `${quantities.find((q) => q.key === k)?.description ?? k}: your BOQ quantity adjustment is kept and needs reconciling with the new design quantity.`);
  const limitations = [
    ...impact.assumptions,
    ...(ups.length ? ups.flatMap((u) => u.unverified) : []),
    'Proposed results use the same calculations as the studies; they are not a substitute for running and reviewing the studies after applying.',
    'Cost differences are estimates from the rates in your current price list or the built-in typical rates, not supplier quotations.'
  ];
  return { label: 'Proposed', inputs: previewInputs(p, rec, list), impact, circuits, statuses, ups, documents, quantities, adjustments, limitations: [...new Set(limitations)], skipped };
}
