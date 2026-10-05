import type { Project } from '../types';
import { FEEDER_FIELDS, BOARD_FIELDS, PROJECT_FIELDS } from './revisions';
import { leafLabel, pairText, same } from './datasetDiff';
import { baselineOf } from './designBaseline';
import { impactBetween, type DesignImpact } from './designImpact';

/** Modification records: a proposed change to the design, with why, who, what exactly (each value with the value it
 * replaces), and a decision. Accepting a proposal records a decision; applying it to the working design is a separate,
 * explicit step that is atomic (one undo step) and refuses to overwrite edits made since the proposal. Authors and
 * reviewers are free-text names: the app has no accounts and makes no claim about who someone is. */
export type ModStatus = 'draft' | 'proposed' | 'review' | 'accepted' | 'rejected' | 'superseded';
export type ModTarget = 'feeder' | 'board' | 'ups' | 'project';

export const STATUS_LABEL: Record<ModStatus, string> = { draft: 'Draft', proposed: 'Proposed', review: 'Under review', accepted: 'Accepted', rejected: 'Rejected', superseded: 'Superseded' };

export interface ModOp {
  id: string;
  target: ModTarget;
  /** The circuit, panel or UPS (none for a project setting). */
  targetId?: string;
  field: string;
  /** Readable name of the field, with its unit. */
  label: string;
  /** The value when the proposal was made (undefined = not set). */
  before?: unknown;
  after?: unknown;
}
export interface ModStep { status: ModStatus; at: string; by?: string; note?: string }
export interface ModificationRecord {
  id: string; // MOD-001
  title: string;
  reason: string;
  /** Where it came from: a comment, query or request reference. */
  origin?: string;
  author?: string;
  createdAt: string;
  baselineRevisionId?: string;
  status: ModStatus;
  history: ModStep[];
  ops: ModOp[];
  /** Recorded when accepted or rejected. */
  decision?: { outcome: 'accepted' | 'rejected'; by?: string; at: string; note?: string };
  /** Set when the changes are in the working design (applied, or recorded from edits already made). */
  applied?: { at: string; by?: string; source: 'applied' | 'draft'; opIds: string[]; skipped?: string[]; overwritten?: string[] };
  supersededBy?: string;
}

// ---- What can be proposed ----------------------------------------------------

type Kind = 'number' | 'text' | 'bool';
interface FieldDef { key: string; label: string; kind: Kind }
const labelIn = (table: [string, string][], key: string) => table.find(([k]) => k === key)?.[1] ?? leafLabel(key);
const defs = (table: [string, string][], list: [string, Kind][]): FieldDef[] => list.map(([key, kind]) => ({ key, kind, label: labelIn(table, key) }));

export const PROPOSABLE: Record<ModTarget, FieldDef[]> = {
  feeder: defs(FEEDER_FIELDS as [string, string][], [['loadKw', 'number'], ['demandFactor', 'number'], ['powerFactor', 'number'], ['lengthM', 'number'], ['cableCsaMm2', 'number'], ['parallel', 'number'], ['cores', 'number'],
    ['breakerRatingA', 'number'], ['breakerIcuKa', 'number'], ['breakerType', 'text'], ['breakerImMultiple', 'number'], ['cpcMm2', 'number'], ['rcdMa', 'number'], ['cableType', 'text'], ['device', 'text'],
    ['starter', 'text'], ['kvar', 'number'], ['essential', 'bool'], ['trayRoute', 'text']]),
  board: defs(BOARD_FIELDS as [string, string][], [['ratedCurrentA', 'number'], ['sourceKva', 'number'], ['sourceImpedancePct', 'number'], ['sourceXr', 'number'], ['vectorGroup', 'text'], ['busbarMaterial', 'text'],
    ['ipRating', 'text'], ['manufacturer', 'text'], ['model', 'text'], ['upsKva', 'number'], ['mdDemandFactor', 'number'], ['elcbSensitivityMa', 'number'], ['elcbRatingA', 'number']]),
  ups: ([['autonomyMin', 'number'], ['growthPct', 'number'], ['maxLoadingPct', 'number'], ['outputPf', 'number'], ['inverterEff', 'number'], ['dcVoltage', 'number'], ['blockV', 'number'], ['endCellV', 'number'],
    ['ageing', 'number'], ['tempFactor', 'number'], ['designMargin', 'number'], ['startSocPct', 'number'], ['minSocPct', 'number'], ['endModuleV', 'number'], ['bmsDischargeA', 'number'], ['chargerCurrentA', 'number'],
    ['rechargeLoadA', 'number']] as [string, Kind][]).map(([key, kind]) => ({ key, kind, label: leafLabel(key) })),
  project: defs(PROJECT_FIELDS as [string, string][], [['voltageV', 'number'], ['frequencyHz', 'number'], ['ambientC', 'number'], ['vdLimitPct', 'number'], ['vdTempC', 'number']])
};
const fieldDef = (target: ModTarget, field: string) => PROPOSABLE[target].find((f) => f.key === field);

type Bag = Record<string, unknown>;
/** The current value of what an op names, and whether it exists. */
export function currentValue(p: Project, op: Pick<ModOp, 'target' | 'targetId' | 'field'>): { exists: boolean; value: unknown } {
  if (op.target === 'project') return { exists: true, value: (p as unknown as Bag)[op.field] };
  const list: (Bag & { id: string })[] = op.target === 'feeder' ? (p.feeders as never) : op.target === 'board' ? (p.boards as never) : ((p.upsSystems ?? []) as never);
  const item = list.find((x) => x.id === op.targetId);
  return item ? { exists: true, value: item[op.field] } : { exists: false, value: undefined };
}

function withValue(p: Project, op: Pick<ModOp, 'target' | 'targetId' | 'field'>, value: unknown): Project {
  const put = (o: object): never => { const c: Bag = { ...(o as Bag) }; if (value === undefined) delete c[op.field]; else c[op.field] = value; return c as never; };
  if (op.target === 'project') return put(p);
  if (op.target === 'feeder') return { ...p, feeders: p.feeders.map((f) => (f.id === op.targetId ? put(f) : f)) };
  if (op.target === 'board') return { ...p, boards: p.boards.map((b) => (b.id === op.targetId ? put(b) : b)) };
  return { ...p, upsSystems: (p.upsSystems ?? []).map((u) => (u.id === op.targetId ? put(u) : u)) };
}

// ---- Creating and editing ----------------------------------------------------

export interface ModInput { title: string; reason: string; origin?: string; author?: string }
const nextId = (p: Project) => `MOD-${String(Math.max(0, ...(p.modifications ?? []).map((m) => Number(m.id.replace(/\D/g, '')) || 0)) + 1).padStart(3, '0')}`;
let opSeq = 0;
const opId = () => `op-${Date.now().toString(36)}${(opSeq++).toString(36)}`;

export function newModification(p: Project, i: ModInput, now = new Date()): ModificationRecord {
  const at = now.toISOString();
  return { id: nextId(p), title: i.title.trim(), reason: i.reason.trim(), origin: i.origin?.trim() || undefined, author: i.author?.trim() || undefined, createdAt: at,
    baselineRevisionId: baselineOf(p)?.revision.id, status: 'draft', history: [{ status: 'draft', at, by: i.author?.trim() || undefined }], ops: [] };
}

export class ModificationError extends Error {}

/** Adds a proposed change (or replaces the one for the same item and field), capturing the current value as "before". */
export function addOp(p: Project, rec: ModificationRecord, target: ModTarget, targetId: string | undefined, field: string, after: unknown): ModificationRecord {
  if (rec.status !== 'draft') throw new ModificationError('Only a draft can be edited.');
  const def = fieldDef(target, field);
  if (!def) throw new ModificationError(`${field} cannot be proposed as a change.`);
  if (def.kind === 'number' && (typeof after !== 'number' || !Number.isFinite(after))) throw new ModificationError(`${def.label} needs a number.`);
  if (def.kind === 'bool' && typeof after !== 'boolean') throw new ModificationError(`${def.label} is yes or no.`);
  if (def.kind === 'text' && (typeof after !== 'string' || !after.trim())) throw new ModificationError(`${def.label} needs a value.`);
  const cur = currentValue(p, { target, targetId, field });
  if (!cur.exists) throw new ModificationError(`${targetId ?? target} does not exist.`);
  const op: ModOp = { id: opId(), target, targetId, field, label: def.label, before: cur.value, after: typeof after === 'string' ? after.trim() : after };
  const rest = rec.ops.filter((o) => !(o.target === target && o.targetId === targetId && o.field === field));
  return { ...rec, ops: [...rest, op] };
}

export function removeOp(rec: ModificationRecord, opIdToRemove: string): ModificationRecord {
  if (rec.status !== 'draft') throw new ModificationError('Only a draft can be edited.');
  return { ...rec, ops: rec.ops.filter((o) => o.id !== opIdToRemove) };
}

// ---- Conflicts and the hypothetical design ---------------------------------------

export interface OpConflict { op: ModOp; kind: 'changed' | 'missing'; current?: unknown }
/** Where the working design no longer matches what the proposal was made against. */
export function conflictsOf(p: Project, rec: ModificationRecord): OpConflict[] {
  const out: OpConflict[] = [];
  for (const op of rec.ops) {
    const cur = currentValue(p, op);
    if (!cur.exists) out.push({ op, kind: 'missing' });
    else if (!same(cur.value, op.before, true)) out.push({ op, kind: 'changed', current: cur.value });
  }
  return out;
}

/** The working design with every proposed change applied (not saved anywhere): for previewing impact. */
export function withProposal(p: Project, rec: ModificationRecord): Project {
  return rec.ops.reduce((acc, op) => (currentValue(acc, op).exists ? withValue(acc, op, op.after) : acc), p);
}

/** What the proposal touches, from the model alone. */
export const impactOfProposal = (p: Project, rec: ModificationRecord): DesignImpact => impactBetween(p, withProposal(p, rec));

export const describeOp = (op: ModOp): { item: string; from: string; to: string } => {
  const [from, to] = pairText(op.before, op.after);
  return { item: `${op.targetId ?? 'Project'} — ${op.label}`, from, to };
};

// ---- Lifecycle -----------------------------------------------------------------

const NEXT: Record<ModStatus, ModStatus[]> = { draft: ['proposed', 'superseded'], proposed: ['review', 'accepted', 'rejected', 'superseded'], review: ['accepted', 'rejected', 'superseded'], accepted: ['superseded'], rejected: [], superseded: [] };
export const allowedNext = (rec: ModificationRecord): ModStatus[] => NEXT[rec.status];

export type TransitionResult = { ok: true; record: ModificationRecord } | { ok: false; error: string; conflicts?: OpConflict[] };
export interface TransitionOpts { by?: string; note?: string; now?: Date; supersededBy?: string }

/** Moves a record on. Accepting a proposal whose values no longer match the working design is refused until it is
 * reconciled (`reconcile`). Rejecting and superseding never touch the design. */
export function transition(p: Project, rec: ModificationRecord, to: ModStatus, o: TransitionOpts = {}): TransitionResult {
  if (!NEXT[rec.status].includes(to)) return { ok: false, error: `A ${STATUS_LABEL[rec.status].toLowerCase()} modification cannot become ${STATUS_LABEL[to].toLowerCase()}.` };
  if (to === 'proposed' && !rec.ops.length) return { ok: false, error: 'Add at least one change before proposing.' };
  if (to === 'proposed' && (!rec.title.trim() || !rec.reason.trim())) return { ok: false, error: 'A title and a reason are needed before proposing.' };
  if (to === 'accepted') {
    const c = conflictsOf(p, rec);
    if (c.length) return { ok: false, error: `${c.length} value${c.length === 1 ? ' has' : 's have'} changed since this was proposed — reconcile it before accepting.`, conflicts: c };
  }
  if (to === 'superseded' && !o.supersededBy && !o.note?.trim()) return { ok: false, error: 'Say what supersedes it (or why).' };
  const at = (o.now ?? new Date()).toISOString();
  const step: ModStep = { status: to, at, by: o.by?.trim() || undefined, note: o.note?.trim() || undefined };
  const next: ModificationRecord = { ...rec, status: to, history: [...rec.history, step] };
  if (to === 'accepted' || to === 'rejected') next.decision = { outcome: to, by: step.by, at, note: step.note };
  if (to === 'superseded') next.supersededBy = o.supersededBy;
  return { ok: true, record: next };
}

/** Re-bases a proposal on the values the working design has now (an explicit step, recorded in its history). */
export function reconcile(p: Project, rec: ModificationRecord, by?: string, now = new Date()): ModificationRecord {
  const c = conflictsOf(p, rec);
  if (!c.length) return rec;
  const ids = new Set(c.filter((x) => x.kind === 'changed').map((x) => x.op.id));
  const ops = rec.ops.filter((o) => !c.some((x) => x.kind === 'missing' && x.op.id === o.id)).map((o) => (ids.has(o.id) ? { ...o, before: currentValue(p, o).value } : o));
  const dropped = rec.ops.length - ops.length;
  return { ...rec, ops, history: [...rec.history, { status: rec.status, at: now.toISOString(), by: by?.trim() || undefined, note: `Reconciled: ${ids.size} value${ids.size === 1 ? '' : 's'} re-based on the current design${dropped ? `, ${dropped} change${dropped === 1 ? '' : 's'} dropped (item no longer exists)` : ''}` }] };
}

// ---- Applying ------------------------------------------------------------------

export type ApplyResult = { ok: true; project: Project; applied: string[]; skipped: string[]; overwritten: string[] } | { ok: false; error: string; conflicts?: OpConflict[] };
export interface ApplyOpts { by?: string; now?: Date; /** What to do where the design changed since the proposal. Default: stop. */ onConflict?: 'stop' | 'overwrite' | 'skip' }

/** Applies an accepted modification to the working design as one transaction: all of it or none of it, with the
 * record updated in the same step (so one undo reverses both). Only an accepted, not yet applied modification can be
 * applied; a rejected, draft, proposed or superseded one never changes the design. Values that changed since the proposal
 * are never overwritten silently: stop (default), overwrite them on purpose, or skip them. */
export function applyModification(p: Project, id: string, o: ApplyOpts = {}): ApplyResult {
  const rec = p.modifications?.find((m) => m.id === id);
  if (!rec) return { ok: false, error: 'No such modification.' };
  if (rec.status !== 'accepted') return { ok: false, error: `Only an accepted modification can be applied (this one is ${STATUS_LABEL[rec.status].toLowerCase()}).` };
  if (rec.applied) return { ok: false, error: 'It has already been applied.' };
  const conflicts = conflictsOf(p, rec);
  const mode = o.onConflict ?? 'stop';
  if (conflicts.length && mode === 'stop') return { ok: false, error: `${conflicts.length} value${conflicts.length === 1 ? ' has' : 's have'} changed since this was proposed.`, conflicts };
  const skipIds = new Set(conflicts.filter((c) => c.kind === 'missing' || mode === 'skip').map((c) => c.op.id));
  const overwritten = conflicts.filter((c) => c.kind === 'changed' && mode === 'overwrite').map((c) => c.op.id);
  const toApply = rec.ops.filter((op) => !skipIds.has(op.id));
  if (!toApply.length) return { ok: false, error: 'Nothing can be applied.', conflicts };
  let next = toApply.reduce((acc, op) => withValue(acc, op, op.after), p);
  const at = (o.now ?? new Date()).toISOString();
  const applied = { at, by: o.by?.trim() || undefined, source: 'applied' as const, opIds: toApply.map((x) => x.id), ...(skipIds.size ? { skipped: [...skipIds] } : {}), ...(overwritten.length ? { overwritten } : {}) };
  next = { ...next, modifications: (p.modifications ?? []).map((m) => (m.id === id ? { ...m, applied } : m)) };
  return { ok: true, project: next, applied: applied.opIds, skipped: [...skipIds], overwritten };
}

// ---- From edits already made -----------------------------------------------------

/** A record for the engineering changes already made in the working draft against its baseline ("this is what I changed
 * and why"). Their "before" values are the baseline's. Changes the app cannot express as a field edit (added or removed
 * equipment, other fields) are counted in `unsupported`. */
export function recordFromDraft(p: Project, i: ModInput, now = new Date()): { record: ModificationRecord; unsupported: number } | undefined {
  const base = baselineOf(p);
  if (!base) return undefined;
  const snap = base.revision.snapshot as unknown as Project;
  let rec = newModification(p, i, now);
  let unsupported = 0;
  /** Field edits become ops; any other difference in the compared fields is counted as unsupported. */
  const scan = (target: ModTarget, targetId: string | undefined, before: Bag, after: Bag, keys: string[]) => {
    for (const key of keys) {
      if (same(before[key], after[key], true)) continue;
      const def = fieldDef(target, key);
      if (def) rec = { ...rec, ops: [...rec.ops, { id: opId(), target, targetId, field: key, label: def.label, before: before[key], after: after[key] }] };
      else unsupported++;
    }
  };
  const feederKeys = FEEDER_FIELDS.map(([k]) => k as string), boardKeys = BOARD_FIELDS.map(([k]) => k as string);
  for (const f of p.feeders) { const o = snap.feeders.find((x) => x.id === f.id); if (o) scan('feeder', f.id, o as never, f as never, feederKeys); else unsupported++; }
  for (const o of snap.feeders) if (!p.feeders.some((f) => f.id === o.id)) unsupported++;
  for (const b of p.boards) { const o = snap.boards.find((x) => x.id === b.id); if (o) scan('board', b.id, o as never, b as never, boardKeys); else unsupported++; }
  for (const o of snap.boards) if (!p.boards.some((b) => b.id === o.id)) unsupported++;
  for (const u of p.upsSystems ?? []) { const o = (snap.upsSystems ?? []).find((x) => x.id === u.id); if (o) scan('ups', u.id, o as never, u as never, Object.keys(u).filter((k) => k !== 'id')); else unsupported++; }
  for (const o of snap.upsSystems ?? []) if (!(p.upsSystems ?? []).some((u) => u.id === o.id)) unsupported++;
  scan('project', undefined, snap as never, p as never, PROPOSABLE.project.map((f) => f.key));
  if (!rec.ops.length) return undefined;
  const at = (now).toISOString();
  rec = { ...rec, applied: { at, by: i.author?.trim() || undefined, source: 'draft', opIds: rec.ops.map((x) => x.id) } };
  return { record: rec, unsupported };
}

/** Replaces or adds a record in the project. */
export const withRecord = (p: Project, rec: ModificationRecord): Project => ({ ...p, modifications: p.modifications?.some((m) => m.id === rec.id) ? p.modifications.map((m) => (m.id === rec.id ? rec : m)) : [...(p.modifications ?? []), rec] });
