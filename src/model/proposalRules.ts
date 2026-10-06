import type { Project } from '../types';
import type { ModificationRecord, ModOp, ModStatus, ModTarget } from './designChanges';
import { PROPOSABLE } from './designChanges';

/** Rules every modification record must satisfy, whether made here, opened from an older file or imported: the shape,
 * the field allowlist, value types, and that the history and decision agree with the status. Nothing here changes a project. */

/** A short stable fingerprint of any JSON value (key order does not matter). For consistency checks, not security. */
export function stableHash(v: unknown): string {
  const canon = (x: unknown): unknown => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x);
  const s = JSON.stringify(canon(v)) ?? 'undefined';
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const TARGETS: ModTarget[] = ['feeder', 'board', 'ups', 'project'];
const STATUSES: ModStatus[] = ['draft', 'proposed', 'review', 'accepted', 'rejected', 'superseded'];
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** Why one change cannot be applied (undefined when it can). Checked for every change before any is applied. */
export function opProblem(op: ModOp): string | undefined {
  if (!TARGETS.includes(op.target)) return `${op.label ?? op.field}: unknown kind of item “${String(op.target)}”`;
  if (UNSAFE.has(op.field) || UNSAFE.has(String(op.targetId))) return 'a forbidden name';
  const def = PROPOSABLE[op.target].find((f) => f.key === op.field);
  if (!def) return `${op.field} cannot be changed by a modification`;
  if ((op.target === 'project') !== (op.targetId === undefined)) return op.target === 'project' ? 'a project setting names no item' : `${def.label} needs an item`;
  const a = op.after;
  if (def.kind === 'number' && (typeof a !== 'number' || !Number.isFinite(a))) return `${def.label} needs a number`;
  if (def.kind === 'bool' && typeof a !== 'boolean') return `${def.label} is yes or no`;
  if (def.kind === 'text' && (typeof a !== 'string' || !a.trim())) return `${def.label} needs a value`;
  return undefined;
}

/** Everything wrong with a record's structure; an empty list means it is sound. */
export function validateRecord(rec: ModificationRecord): string[] {
  const out: string[] = [];
  if (!rec || typeof rec !== 'object') return ['not a record'];
  if (!/^MOD-\d+$/.test(String(rec.id))) out.push('the record number is not MOD-nnn');
  if (!STATUSES.includes(rec.status)) out.push(`unknown status “${String(rec.status)}”`);
  if (!Array.isArray(rec.history) || !rec.history.length) out.push('there is no history');
  else if (rec.history[rec.history.length - 1].status !== rec.status) out.push('the history does not end at the current status');
  if (!Array.isArray(rec.ops)) return [...out, 'the changes are missing'];
  const seen = new Set<string>();
  for (const op of rec.ops) {
    if (!op || typeof op.id !== 'string' || seen.has(op.id)) { out.push('a change has a missing or repeated id'); continue; }
    seen.add(op.id);
    const bad = opProblem(op);
    if (bad) out.push(`${op.id}: ${bad}`);
  }
  if (rec.applied) {
    if (rec.status !== 'accepted' && rec.status !== 'superseded' && rec.applied.source !== 'draft') out.push('it is marked applied but was never accepted');
    for (const id of rec.applied.opIds ?? []) if (!seen.has(id)) out.push(`the applied list names a change (${id}) that is not in the record`);
  }
  if (rec.decision && rec.decision.outcome !== 'accepted' && rec.decision.outcome !== 'rejected') out.push('the decision is neither accepted nor rejected');
  return out;
}

/** Whether the baseline the record was made against is still the same content. 'none' = it was made without a baseline. */
export type BaselineStatus = 'none' | 'ok' | 'unavailable' | 'changed';
export function baselineStatus(p: Project, rec: ModificationRecord): BaselineStatus {
  if (!rec.baselineRevisionId) return 'none';
  const r = p.revisions?.find((x) => x.id === rec.baselineRevisionId);
  if (!r) return 'unavailable';
  return rec.baselineFingerprint && rec.baselineFingerprint !== stableHash(r.snapshot) ? 'changed' : 'ok';
}
export const baselineMessage = (s: BaselineStatus, rec: ModificationRecord): string | undefined =>
  s === 'unavailable' ? `Baseline unavailable: Rev ${rec.baselineRevisionId} is no longer in this project.` : s === 'changed' ? `The content of Rev ${rec.baselineRevisionId} is not what this was proposed against.` : undefined;

