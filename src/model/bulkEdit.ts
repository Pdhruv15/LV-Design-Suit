import type { Board, Feeder, Project } from '../types';
import { addOp, currentValue, newModification, PROPOSABLE, withProposal, type ModInput, type ModificationRecord, type ModTarget } from './designChanges';
import { boardLocation } from './levels';
import { checkReferences, type RefIssue } from './integrity';

/** Safe bulk editing. A bulk edit never touches anything but the items named in `ids`: it is built as a draft
 * modification record (each item with its before and after), previewed, and only then applied through the same atomic,
 * undoable path as any other modification. Cancelling the preview changes nothing because nothing is applied until then. */

// ---- Search ----------------------------------------------------------------------

export interface EquipmentQuery {
  text?: string;
  type?: 'feeder' | 'board';
  /** Circuits on this panel, or the panel and the panels fed from it. */
  boardId?: string;
  /** Matches the level text of a panel, or of the panel a circuit is on. */
  level?: string;
  /** Circuit load type or panel kind. */
  kind?: string;
  /** Circuits set by hand (not auto-sized). */
  manualOnly?: boolean;
  essentialOnly?: boolean;
}
export interface EquipmentHit { target: 'feeder' | 'board'; id: string; label: string; where: string; kind?: string; manual?: boolean }

const has = (hay: string | undefined, needle: string) => (hay ?? '').toLowerCase().includes(needle.toLowerCase());

export function searchEquipment(p: Project, q: EquipmentQuery): EquipmentHit[] {
  const text = q.text?.trim() ?? '';
  const board = (id: string): Board | undefined => p.boards.find((b) => b.id === id);
  const levelOf = (b?: Board) => (b ? boardLocation(p, b) : '');
  const out: EquipmentHit[] = [];
  if (!q.type || q.type === 'board') {
    for (const b of p.boards) {
      if (q.manualOnly || q.essentialOnly) continue;
      if (q.boardId && b.id !== q.boardId && b.upstreamId !== q.boardId) continue;
      if (q.kind && b.kind !== q.kind) continue;
      if (q.level && !has(levelOf(b), q.level)) continue;
      if (text && ![b.id, b.name, b.location, b.manufacturer, b.model].some((s) => has(s, text))) continue;
      out.push({ target: 'board', id: b.id, label: b.name || b.id, where: levelOf(b) || (b.location ?? ''), kind: b.kind });
    }
  }
  if (!q.type || q.type === 'feeder') {
    for (const f of p.feeders) {
      if (q.boardId && f.boardId !== q.boardId) continue;
      if (q.kind && (f.loadType ?? 'general') !== q.kind) continue;
      if (q.manualOnly && !f.manualSize) continue;
      if (q.essentialOnly && !f.essential) continue;
      const b = board(f.boardId);
      if (q.level && !has(levelOf(b), q.level)) continue;
      if (text && ![f.id, f.name, f.room, f.remarks].some((s) => has(s, text))) continue;
      out.push({ target: 'feeder', id: f.id, label: f.name || f.id, where: `${f.boardId}${f.room ? ` · ${f.room}` : ''}`, kind: f.loadType ?? 'general', manual: !!f.manualSize });
    }
  }
  return out;
}

// ---- Bulk edit -------------------------------------------------------------------

export type BulkMode = 'set' | 'scale' | 'add';
export interface BulkEdit { target: Exclude<ModTarget, 'project'>; field: string; mode: BulkMode; value: number | string | boolean }
export interface BulkRow { id: string; label: string; before: unknown; after: unknown; /** Why this item is not changed. */ skipped?: string; /** Worth knowing before applying. */ warning?: string }
export interface BulkPreview { rows: BulkRow[]; record: ModificationRecord; changed: number; skipped: number; error?: string }

const MODE_LABEL: Record<BulkMode, string> = { set: 'set to', scale: 'multiplied by', add: 'increased by' };

/** The proposed result for each selected item. Only `ids` are ever touched; unknown ids are reported, not ignored. */
export function previewBulkEdit(p: Project, ids: string[], edit: BulkEdit, meta: ModInput): BulkPreview {
  const def = PROPOSABLE[edit.target].find((d) => d.key === edit.field);
  let record = newModification(p, meta);
  const fail = (error: string): BulkPreview => ({ rows: [], record, changed: 0, skipped: 0, error });
  if (!def) return fail(`${edit.field} cannot be edited in bulk.`);
  if (!ids.length) return fail('Select at least one item.');
  if (def.kind !== 'number' && edit.mode !== 'set') return fail(`${def.label} can only be set to a value.`);
  if (def.kind === 'number' && (typeof edit.value !== 'number' || !Number.isFinite(edit.value))) return fail(`${def.label} needs a number.`);
  const label = (id: string) => edit.target === 'feeder' ? (p.feeders.find((f) => f.id === id)?.name || id) : (p.boards.find((b) => b.id === id)?.name || id);
  const rows: BulkRow[] = [];
  for (const id of [...new Set(ids)]) {
    const cur = currentValue(p, { target: edit.target, targetId: id, field: edit.field });
    if (!cur.exists) { rows.push({ id, label: id, before: undefined, after: undefined, skipped: 'no longer exists' }); continue; }
    let after: unknown = edit.value;
    if (def.kind === 'number' && edit.mode !== 'set') {
      if (typeof cur.value !== 'number') { rows.push({ id, label: label(id), before: cur.value, after: undefined, skipped: `${def.label} is not set` }); continue; }
      after = Math.round((edit.mode === 'scale' ? cur.value * (edit.value as number) : cur.value + (edit.value as number)) * 1e6) / 1e6;
    }
    if (after === cur.value) { rows.push({ id, label: label(id), before: cur.value, after, skipped: 'already this value' }); continue; }
    if (def.kind === 'number' && typeof after === 'number' && after <= 0 && edit.field !== 'loadKw' && edit.field !== 'kvar') { rows.push({ id, label: label(id), before: cur.value, after, skipped: 'would be zero or negative' }); continue; }
    const f = edit.target === 'feeder' ? p.feeders.find((x) => x.id === id) : undefined;
    const warning = f && !f.manualSize && ['cableCsaMm2', 'breakerRatingA', 'cpcMm2'].includes(edit.field) ? 'Automatic sizing may overwrite this the next time the load changes' : undefined;
    rows.push({ id, label: label(id), before: cur.value, after, warning });
    record = addOp(p, record, edit.target, id, edit.field, after);
  }
  return { rows, record, changed: record.ops.length, skipped: rows.length - record.ops.length };
}

export const describeBulk = (edit: BulkEdit, label: string) => `${label} ${MODE_LABEL[edit.mode]} ${String(edit.value)}`;

/** The design as it would be with the bulk edit applied (for the impact preview); the working design is untouched. */
export const bulkResult = (p: Project, prev: BulkPreview): Project => withProposal(p, prev.record);

// ---- Identity and topology checks ---------------------------------------------------

/** Ambiguity that matters: two circuits on a panel with the same name or the same phase and way, and any broken or
 * looping panel link (the checks every move, copy or bulk edit must leave clean). */
export function identityIssues(p: Project): RefIssue[] {
  const out: RefIssue[] = [...checkReferences(p)];
  const by = new Map<string, Feeder[]>();
  for (const f of p.feeders) by.set(f.boardId, [...(by.get(f.boardId) ?? []), f]);
  for (const [boardId, list] of by) {
    const names = new Map<string, number>(), ways = new Map<string, number>();
    for (const f of list) {
      const n = f.name?.trim().toLowerCase();
      if (n) names.set(n, (names.get(n) ?? 0) + 1);
      if (f.phase && f.way != null) ways.set(`${f.phase}${f.way}`, (ways.get(`${f.phase}${f.way}`) ?? 0) + 1);
    }
    for (const [n, c] of names) if (c > 1) out.push({ where: `Panel ${boardId}`, ref: n, problem: `has ${c} circuits named "${n}"`, view: 'design' });
    for (const [w, c] of ways) if (c > 1) out.push({ where: `Panel ${boardId}`, ref: w, problem: `has ${c} circuits on way ${w}`, view: 'load-schedule' });
  }
  return out;
}

/** What a change introduces: issues present after but not before (so existing problems are not blamed on the edit). */
export function introducedIssues(before: Project, after: Project): RefIssue[] {
  const key = (i: RefIssue) => `${i.where}|${i.ref}|${i.problem}`;
  const had = new Set(identityIssues(before).map(key));
  return identityIssues(after).filter((i) => !had.has(key(i)));
}
