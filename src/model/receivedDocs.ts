import type { Project } from '../types';

/** The register of documents received from others (a consultant's drawings, specifications, datasheets, authority
 * comments). It records what was received and which revision; it does not read or import the file, and it never makes the
 * document part of the electrical model. Choosing a document as the project baseline records where the work started from:
 * provenance, not proof that the design is approved or correct. */
export type DocUse = 'reference' | 'baseline';
export type DocDiscipline = 'electrical' | 'architectural' | 'mechanical' | 'structural' | 'fire' | 'authority' | 'other';

export const DISCIPLINE_LABEL: Record<DocDiscipline, string> = { electrical: 'Electrical', architectural: 'Architectural', mechanical: 'Mechanical / HVAC', structural: 'Structural', fire: 'Fire / life safety', authority: 'Authority', other: 'Other' };

export interface ReceivedDoc {
  id: string; // RD-001
  title: string;
  number: string;
  revision: string;
  dateReceived?: string; // YYYY-MM-DD
  originator?: string;
  purpose?: string;
  discipline: DocDiscipline;
  use: DocUse;
  /** Optional path or link to where the file is kept. Not part of a project backup. */
  link?: string;
  /** Replaced by a later revision or document (its id). */
  supersededBy?: string;
  note?: string;
}

export class DocError extends Error {}

const nextId = (p: Project) => `RD-${String(Math.max(0, ...(p.receivedDocs ?? []).map((d) => Number(d.id.replace(/\D/g, '')) || 0)) + 1).padStart(3, '0')}`;
export const docsOf = (p: Project): ReceivedDoc[] => p.receivedDocs ?? [];

export type DocInput = Omit<ReceivedDoc, 'id' | 'supersededBy'>;

export function addDoc(p: Project, i: DocInput): { project: Project; doc: ReceivedDoc } {
  const title = i.title.trim(), number = i.number.trim(), revision = i.revision.trim();
  if (!title) throw new DocError('Give the document a title.');
  if (!number) throw new DocError('Give the document number.');
  if (!revision) throw new DocError('Give the revision (use "-" if it has none).');
  if (i.dateReceived && !/^\d{4}-\d{2}-\d{2}$/.test(i.dateReceived)) throw new DocError('Use the date as YYYY-MM-DD.');
  const clash = docsOf(p).find((d) => d.number.toLowerCase() === number.toLowerCase() && d.revision.toLowerCase() === revision.toLowerCase());
  if (clash) throw new DocError(`${clash.id} is already ${number} revision ${revision}.`);
  const doc: ReceivedDoc = { ...i, id: nextId(p), title, number, revision, originator: i.originator?.trim() || undefined, purpose: i.purpose?.trim() || undefined, link: i.link?.trim() || undefined, note: i.note?.trim() || undefined };
  // A later revision of the same document number supersedes the earlier ones.
  const docs = docsOf(p).map((d) => (d.number.toLowerCase() === number.toLowerCase() && !d.supersededBy ? { ...d, supersededBy: doc.id } : d));
  return { project: { ...p, receivedDocs: [...docs, doc] }, doc };
}

export function updateDoc(p: Project, id: string, patch: Partial<DocInput>): Project {
  if (!docsOf(p).some((d) => d.id === id)) throw new DocError('No such document.');
  return { ...p, receivedDocs: docsOf(p).map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

export function removeDoc(p: Project, id: string): Project {
  const left = docsOf(p).filter((d) => d.id !== id).map((d) => (d.supersededBy === id ? { ...d, supersededBy: undefined } : d));
  return { ...p, receivedDocs: left.length ? left : undefined };
}

/** Only one document is the baseline the work started from; marking another moves the label. A superseded document cannot be it. */
export function setBaselineDoc(p: Project, id: string | undefined): Project {
  const d = id ? docsOf(p).find((x) => x.id === id) : undefined;
  if (id && !d) throw new DocError('No such document.');
  if (d?.supersededBy) throw new DocError('That revision has been superseded; choose the current one.');
  return { ...p, receivedDocs: docsOf(p).map((x) => ({ ...x, use: x.id === id ? 'baseline' : 'reference' })) };
}

export const baselineDoc = (p: Project): ReceivedDoc | undefined => docsOf(p).find((d) => d.use === 'baseline');
export const isSuperseded = (d: ReceivedDoc) => !!d.supersededBy;

/** What deserves attention: the baseline was superseded or is missing while documents exist, and documents with no link. */
export function docIssues(p: Project): string[] {
  const docs = docsOf(p), out: string[] = [];
  if (!docs.length) return out;
  const b = baselineDoc(p);
  if (!b) out.push('No document is marked as the baseline the work started from.');
  else if (b.supersededBy) { const n = docs.find((d) => d.id === b.supersededBy); out.push(`The baseline (${b.number} rev ${b.revision}) has been superseded by ${n ? `rev ${n.revision}` : 'a later document'}: check what changed.`); }
  const unlinked = docs.filter((d) => !d.link && !d.supersededBy).length;
  if (unlinked) out.push(`${unlinked} current document${unlinked === 1 ? ' has' : 's have'} no link to the file.`);
  return out;
}
