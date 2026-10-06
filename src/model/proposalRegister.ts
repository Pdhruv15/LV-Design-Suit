import type { Project } from '../types';
import { currentValue, STATUS_LABEL, type ModificationRecord, type ModOp, type ModStatus } from './designChanges';
import { pairText, same } from './datasetDiff';
import { baselineStatus, type BaselineStatus } from './proposalRules';

/** What the modification register shows for each record, derived from the record and the working design (nothing stored). */
export interface RegisterRow {
  id: string; title: string; status: ModStatus; statusLabel: string;
  /** "Rev A", "No baseline", or why the baseline cannot be used: never silently another revision. */
  baseline: string; baselineState: BaselineStatus;
  equipment: string[]; changes: number; author?: string; date: string;
  applied?: string; follows?: string;
}

/** The equipment a record touches, as ids ("Project" for project settings). */
export const affectedEquipment = (rec: ModificationRecord): string[] => [...new Set(rec.ops.map((o) => o.targetId ?? 'Project'))];

export function registerRow(p: Project, rec: ModificationRecord): RegisterRow {
  const bs = baselineStatus(p, rec);
  return {
    id: rec.id, title: rec.title, status: rec.status, statusLabel: STATUS_LABEL[rec.status],
    baseline: bs === 'none' ? 'No baseline' : bs === 'unavailable' ? `Rev ${rec.baselineRevisionId} unavailable` : bs === 'changed' ? `Rev ${rec.baselineRevisionId} (content differs)` : `Rev ${rec.baselineRevisionId}`,
    baselineState: bs, equipment: affectedEquipment(rec), changes: rec.ops.length, author: rec.author, date: rec.createdAt,
    applied: rec.applied ? rec.applied.at : undefined, follows: rec.follows
  };
}

export interface RegisterFilter { status?: ModStatus | 'open' | 'all'; equipment?: string; text?: string }
/** 'open' = not yet decided or applied (draft, proposed, under review, or accepted but not applied). */
export function filterRegister(p: Project, records: ModificationRecord[], f: RegisterFilter): RegisterRow[] {
  const eq = f.equipment?.trim().toLowerCase(), tx = f.text?.trim().toLowerCase();
  return records.filter((r) => {
    if (f.status && f.status !== 'all') {
      const open = ['draft', 'proposed', 'review'].includes(r.status) || (r.status === 'accepted' && !r.applied);
      if (f.status === 'open' ? !open : r.status !== f.status) return false;
    }
    if (eq && !affectedEquipment(r).some((e) => e.toLowerCase().includes(eq))) return false;
    if (tx && !`${r.id} ${r.title} ${r.reason} ${r.origin ?? ''}`.toLowerCase().includes(tx)) return false;
    return true;
  }).map((r) => registerRow(p, r));
}

/** One change in the editor: what the design has now, what the proposal expected it to have, and what it proposes. */
export interface OpView { op: ModOp; item: string; current: string; expectedBefore: string; proposed: string; state: 'matches' | 'changed' | 'missing' }
export function opView(p: Project, op: ModOp): OpView {
  const cur = currentValue(p, op);
  const [expectedBefore, proposed] = pairText(op.before, op.after);
  return {
    op, item: `${op.targetId ?? 'Project'} — ${op.label}`, expectedBefore, proposed,
    current: cur.exists ? pairText(cur.value, undefined)[0] : '—',
    state: !cur.exists ? 'missing' : same(cur.value, op.before, true) ? 'matches' : 'changed'
  };
}
