import type { Project } from '../types';
import type { DrawingIssue } from './drawingSet';

/** Submissions: every document sent out for approval, review, tender or information — BOQ, drawing
 * sets, study reports, variations, schedules — with its recipient, due date, the response and the
 * comments that came with it. Drawing transmittals (Drawings → issues) appear here by themselves;
 * recording a response for one keeps it under its transmittal number. */

export type SubStatus = 'submitted' | 'review' | 'approved' | 'approved-comments' | 'resubmit' | 'rejected' | 'info' | 'superseded';
export const SUB_STATUS: Record<SubStatus, string> = {
  submitted: 'Submitted', review: 'Under review', approved: 'Approved', 'approved-comments': 'Approved with comments',
  resubmit: 'Revise and resubmit', rejected: 'Rejected', info: 'For information', superseded: 'Superseded'
};
export const SUB_KINDS = ['BOQ', 'Drawings', 'Report', 'Variation', 'Schedule', 'Forms', 'Other'] as const;
export type SubKind = (typeof SUB_KINDS)[number];
export const PURPOSES = ['For approval', 'For review', 'For tender', 'For construction', 'For information', 'For record'];
export const RECIPIENTS = ['Client', 'Consultant', 'Authority (DEWA)', 'Main contractor'];

export interface SubDoc { number: string; title: string; rev: string; format?: string; copies?: number }
export interface SubComment { id: string; from?: string; text: string; action?: string; closed?: string /* YYYY-MM-DD */ }
export interface Submission {
  id: string; // SUB-001, or the transmittal number (T-001) for a drawing issue
  kind: SubKind;
  title: string;
  docs: SubDoc[];
  to: string;
  attention?: string;
  address?: string;
  purpose: string;
  date: string; // YYYY-MM-DD
  due?: string; // response due; else from the recipient's default response time
  yourRef?: string;
  sentBy?: string;
  remarks?: string;
  status: SubStatus;
  responseDate?: string;
  responseRef?: string;
  comments: SubComment[];
  resubmissionOf?: string;
  resubmittedAs?: string;
  /** The drawing transmittal it records the response for. */
  transmittal?: string;
}

/** Default response time (days) by kind of recipient; your own per project in `submissionDays`. */
export const DEFAULT_DAYS: Record<string, number> = { Client: 7, Consultant: 7, Authority: 14, 'Main contractor': 7, Other: 7 };
export function recipientGroup(to: string): string {
  const t = to.toLowerCase();
  if (/(dewa|addc|aadc|sewa|fewa|etihad|authority|municipality|civil defence)/.test(t)) return 'Authority';
  if (t.includes('consult')) return 'Consultant';
  if (t.includes('client') || t.includes('owner') || t.includes('employer')) return 'Client';
  if (t.includes('contractor')) return 'Main contractor';
  return 'Other';
}
export const responseDays = (p: Project, to: string) => p.submissionDays?.[recipientGroup(to)] ?? DEFAULT_DAYS[recipientGroup(to)];

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Waiting for a response. */
export const isOpen = (s: Submission) => s.status === 'submitted' || s.status === 'review';
/** The response due date: the one entered, else the date sent plus the recipient's response time (none for information). */
export const dueOf = (p: Project, s: Submission): string | undefined => (s.status === 'info' || s.purpose === 'For information' ? undefined : s.due ?? (s.date ? addDays(s.date, responseDays(p, s.to)) : undefined));
export const isOverdue = (p: Project, s: Submission, today: string) => { const due = dueOf(p, s); return isOpen(s) && !!due && due < today; };
/** "6 d" to respond, "13 d open", "Overdue 4 d", or "—". */
export function timeText(p: Project, s: Submission, today: string): string {
  if (s.responseDate && s.date) return `${daysBetween(s.date, s.responseDate)} d`;
  if (!isOpen(s) || !s.date) return '—';
  const due = dueOf(p, s);
  return due && due < today ? `Overdue ${daysBetween(due, today)} d` : `${daysBetween(s.date, today)} d open`;
}

/** A drawing issue as a submission: the record the register lists and the transmittal prints. */
export const issueAsSubmission = (t: DrawingIssue): Submission => ({
  id: t.id, kind: 'Drawings', title: t.description || `Drawing issue ${t.id}`, to: t.to ?? '', purpose: purposeOf(t.purpose), date: t.date, status: 'submitted',
  docs: t.sheets.map((x) => ({ number: x.number, title: x.title, rev: x.rev, format: 'PDF' })), comments: [], transmittal: t.id
});

/** Drawing transmittals as submissions, unless one is already recorded for them. */
function fromTransmittals(p: Project, stored: Submission[]): Submission[] {
  const taken = new Set(stored.map((s) => s.transmittal).filter(Boolean));
  return (p.drawingSet?.issues ?? []).filter((t) => !taken.has(t.id)).map(issueAsSubmission);
}

/** The submission a drawing issue is printed from: the one recorded for it (with its address,
 * attention and remarks) or, if none, the issue itself. */
export function submissionForIssue(p: Project, issue: DrawingIssue): Submission {
  const stored = (p.submissions ?? []).find((s) => s.transmittal === issue.id);
  return stored ? { ...stored, docs: stored.docs.length ? stored.docs : issueAsSubmission(issue).docs } : issueAsSubmission(issue);
}
const purposeOf = (s: string) => PURPOSES.find((x) => x.toLowerCase() === s.trim().toLowerCase()) ?? (s.trim() ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1).toLowerCase() : 'For approval');

/** Every submission, recorded ones and drawing transmittals, by date sent. */
export function submissionsOf(p: Project): Submission[] {
  const stored = p.submissions ?? [];
  return [...stored, ...fromTransmittals(p, stored)].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export const nextSubmissionId = (p: Project) => `SUB-${String(Math.max(0, ...(p.submissions ?? []).map((s) => (/^SUB-\d+$/.test(s.id) ? Number(s.id.slice(4)) : 0))) + 1).padStart(3, '0')}`;

export function saveSubmission(p: Project, s: Submission): Project {
  const list = p.submissions ?? [];
  return { ...p, submissions: list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s] };
}
export function deleteSubmission(p: Project, id: string): Project {
  const left = (p.submissions ?? []).filter((s) => s.id !== id).map((s) => (s.resubmittedAs === id ? { ...s, resubmittedAs: undefined } : s));
  return { ...p, submissions: left.length ? left : undefined };
}

/** A resubmission of `s`: the same documents and recipient, linked both ways. A submission still
 * waiting for its response is superseded by it; one already answered keeps its response. */
export function resubmit(p: Project, s: Submission, date: string): { project: Project; next: Submission } {
  const next: Submission = { id: nextSubmissionId(p), kind: s.kind, title: s.title, docs: s.docs.map((d) => ({ ...d })), to: s.to, attention: s.attention, address: s.address, purpose: s.purpose, date, status: 'submitted', comments: [], resubmissionOf: s.id, yourRef: s.responseRef, sentBy: s.sentBy };
  const old: Submission = { ...s, resubmittedAs: next.id, status: isOpen(s) ? 'superseded' : s.status };
  return { project: saveSubmission(saveSubmission(p, old), next), next };
}

export interface SubmissionCounts { total: number; open: number; overdue: number; approved: number; withComments: number; resubmit: number; rejected: number; openComments: number }
export function submissionCounts(p: Project, today: string): SubmissionCounts {
  const all = submissionsOf(p);
  const n = (f: (s: Submission) => boolean) => all.filter(f).length;
  return {
    total: all.length, open: n(isOpen), overdue: n((s) => isOverdue(p, s, today)), approved: n((s) => s.status === 'approved'), withComments: n((s) => s.status === 'approved-comments'),
    resubmit: n((s) => s.status === 'resubmit'), rejected: n((s) => s.status === 'rejected'), openComments: all.reduce((a, s) => a + s.comments.filter((c) => !c.closed).length, 0)
  };
}

/** A submission ready to record after an export: the document filled in, the rest to complete. */
export interface SubmissionOffer { kind: SubKind; title: string; docs: SubDoc[]; purpose?: string }
const OFFER = 'lvds:offer-submission';
/** Asks the app to offer "Record as submission" for a document just saved. */
export function offerSubmission(o: SubmissionOffer): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SubmissionOffer>(OFFER, { detail: o }));
}
export function onSubmissionOffer(fn: (o: SubmissionOffer) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<SubmissionOffer>).detail);
  window.addEventListener(OFFER, h);
  return () => window.removeEventListener(OFFER, h);
}
export function draftFromOffer(p: Project, o: SubmissionOffer, today: string): Submission {
  return { id: nextSubmissionId(p), kind: o.kind, title: o.title, docs: o.docs, to: '', purpose: o.purpose ?? 'For approval', date: today, status: 'submitted', comments: [] };
}
