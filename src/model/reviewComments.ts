import type { Project } from '../types';
import { BOARD_CLASS, FEEDER_CLASS } from './changeClass';

/** Design review comments: a person's finding about the design, kept apart from the app's own calculation findings.
 * A response never closes a comment; the reviewer closes it explicitly. A closed comment is flagged for re-review only when
 * the engineering values of what it refers to change afterwards (not for a rename or a note). Names are typed text: the app
 * has no accounts and says nothing about who anyone is, or that anything has been professionally approved. */
export type CommentStatus = 'open' | 'responded' | 'awaiting-evidence' | 'closed' | 'withdrawn';
export type CommentSeverity = 'critical' | 'major' | 'minor' | 'observation';
export type CommentCategory = 'calculation' | 'protection' | 'earthing' | 'drawing' | 'equipment' | 'documentation' | 'other';
export type RefKind = 'feeder' | 'board' | 'sheet';

export const STATUS_LABEL: Record<CommentStatus, string> = { open: 'Open', responded: 'Responded', 'awaiting-evidence': 'Awaiting evidence', closed: 'Closed', withdrawn: 'Withdrawn' };
export const SEVERITY_LABEL: Record<CommentSeverity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', observation: 'Observation' };
export const CATEGORY_LABEL: Record<CommentCategory, string> = { calculation: 'Calculation', protection: 'Protection', earthing: 'Earthing', drawing: 'Drawing', equipment: 'Equipment', documentation: 'Documentation', other: 'Other' };

export interface CommentRef { kind: RefKind; id: string; /** The item's engineering values when the comment was raised, or when it was last closed. */ stamp: string }
export interface CommentStep { status: CommentStatus; at: string; by?: string; note?: string }
export interface ReviewComment {
  id: string; // RC-001
  /** A finding about the design, or a question put to its author (default: finding). */
  kind?: 'finding' | 'question';
  category: CommentCategory;
  severity: CommentSeverity;
  finding: string;
  /** The rule or reference it is judged against, e.g. "BS 7671 §411.3.2". */
  criterion?: string;
  requiredAction?: string;
  assignedTo?: string;
  /** Drawing sheet and revision the comment was made on. */
  sheet?: string;
  revisionId?: string;
  ref?: CommentRef;
  raisedBy?: string;
  createdAt: string;
  status: CommentStatus;
  history: CommentStep[];
  response?: string;
  evidence?: string;
  /** The link to the app's own finding or a related comment, so the same issue is not worked twice. */
  related?: string;
}

export class CommentError extends Error {}

type Bag = Record<string, unknown>;
/** The values of an item that matter to the design (never names, labels or notes). */
export function stampOf(p: Project, kind: RefKind, id: string): string | undefined {
  if (kind === 'sheet') return p.drawingSet?.sheets.some((s) => s.id === id) ? 'sheet' : undefined;
  const item = (kind === 'feeder' ? p.feeders : p.boards).find((x) => x.id === id) as Bag | undefined;
  if (!item) return undefined;
  const table = (kind === 'feeder' ? FEEDER_CLASS : BOARD_CLASS) as Record<string, string>;
  const eng = Object.keys(item).filter((k) => table[k] === 'engineering').sort();
  return JSON.stringify(eng.map((k) => [k, item[k]]));
}

const nextId = (p: Project) => `RC-${String(Math.max(0, ...(p.reviewComments ?? []).map((c) => Number(c.id.replace(/\D/g, '')) || 0)) + 1).padStart(3, '0')}`;

export interface CommentInput { kind?: 'finding' | 'question'; category: CommentCategory; severity: CommentSeverity; finding: string; criterion?: string; requiredAction?: string; assignedTo?: string; sheet?: string; revisionId?: string; ref?: { kind: RefKind; id: string }; raisedBy?: string; related?: string }

export function newComment(p: Project, i: CommentInput, now = new Date()): ReviewComment {
  if (!i.finding.trim()) throw new CommentError('Describe the finding.');
  let ref: CommentRef | undefined;
  if (i.ref) {
    const stamp = stampOf(p, i.ref.kind, i.ref.id);
    if (stamp === undefined) throw new CommentError(`${i.ref.id} does not exist.`);
    ref = { ...i.ref, stamp };
  }
  const at = now.toISOString(), by = i.raisedBy?.trim() || undefined;
  return { id: nextId(p), ...(i.kind === 'question' ? { kind: 'question' as const } : {}), category: i.category, severity: i.severity, finding: i.finding.trim(), criterion: i.criterion?.trim() || undefined, requiredAction: i.requiredAction?.trim() || undefined,
    assignedTo: i.assignedTo?.trim() || undefined, sheet: i.sheet?.trim() || undefined, revisionId: i.revisionId, ref, raisedBy: by, createdAt: at, status: 'open', history: [{ status: 'open', at, by }], related: i.related?.trim() || undefined };
}

export const withComment = (p: Project, c: ReviewComment): Project => ({ ...p, reviewComments: p.reviewComments?.some((x) => x.id === c.id) ? p.reviewComments.map((x) => (x.id === c.id ? c : x)) : [...(p.reviewComments ?? []), c] });

/** Where the comment's subject stands now: unchanged, changed since the comment was raised or closed, or gone. */
export type RefState = 'none' | 'same' | 'changed' | 'missing';
export function refState(p: Project, c: ReviewComment): RefState {
  if (!c.ref) return 'none';
  const now = stampOf(p, c.ref.kind, c.ref.id);
  return now === undefined ? 'missing' : now === c.ref.stamp ? 'same' : 'changed';
}

/** Closed, but what it was about has changed or gone since: the closure evidence is out of date. */
export const needsReReview = (p: Project, c: ReviewComment): boolean => c.status === 'closed' && (refState(p, c) === 'changed' || refState(p, c) === 'missing');

const NEXT: Record<CommentStatus, CommentStatus[]> = {
  open: ['responded', 'awaiting-evidence', 'closed', 'withdrawn'],
  responded: ['awaiting-evidence', 'open', 'closed', 'withdrawn'],
  'awaiting-evidence': ['responded', 'open', 'closed', 'withdrawn'],
  closed: ['open'],
  withdrawn: ['open']
};
export const allowedNext = (c: ReviewComment): CommentStatus[] => NEXT[c.status];

export interface MoveOpts { by?: string; note?: string; response?: string; evidence?: string; now?: Date }
/** Moves a comment on. Responding records the response but leaves the decision to the reviewer; closing is explicit and
 * restamps what the comment refers to; withdrawing needs a reason; reopening needs a note. */
export function moveComment(p: Project, c: ReviewComment, to: CommentStatus, o: MoveOpts = {}): ReviewComment {
  if (!NEXT[c.status].includes(to)) throw new CommentError(`A ${STATUS_LABEL[c.status].toLowerCase()} comment cannot become ${STATUS_LABEL[to].toLowerCase()}.`);
  const note = o.note?.trim() || undefined;
  if (to === 'withdrawn' && !note) throw new CommentError('Say why it is withdrawn.');
  if (to === 'open' && c.status !== 'responded' && c.status !== 'awaiting-evidence' && !note) throw new CommentError('Say why it is reopened.');
  if (to === 'responded' && !(o.response?.trim() || c.response)) throw new CommentError('Write the response.');
  if (to === 'closed' && !o.by?.trim()) throw new CommentError('Closing needs the reviewer’s name.');
  const at = (o.now ?? new Date()).toISOString();
  let ref = c.ref;
  if (to === 'closed' && ref) { const stamp = stampOf(p, ref.kind, ref.id); if (stamp !== undefined) ref = { ...ref, stamp }; }
  return { ...c, status: to, response: o.response?.trim() || c.response, evidence: o.evidence?.trim() || c.evidence, ref, history: [...c.history, { status: to, at, by: o.by?.trim() || undefined, note }] };
}

/** The comments still needing work: open critical or major, anything awaiting evidence, and closed comments to re-review. */
export interface ReviewSummary { open: number; critical: number; major: number; awaiting: number; reReview: number; stale: number }
export function reviewSummary(p: Project): ReviewSummary {
  const list = p.reviewComments ?? [];
  const live = list.filter((c) => c.status !== 'closed' && c.status !== 'withdrawn');
  return {
    open: live.length, critical: live.filter((c) => c.severity === 'critical').length, major: live.filter((c) => c.severity === 'major').length,
    awaiting: list.filter((c) => c.status === 'awaiting-evidence').length, reReview: list.filter((c) => needsReReview(p, c)).length,
    stale: live.filter((c) => refState(p, c) === 'missing').length
  };
}
