import type { Project, Revision } from '../types';
import { diffProjects, currentRevision, countByClass, type Diff } from './revisions';
import { DESIGN_CLASSES, type ChangeClass } from './changeClass';

/** The design baseline: the issued revision the working draft is measured against — the design as issued to the
 * authority, or as received from the consultant. It points at a revision; the frozen copy stays in that revision,
 * so editing the working draft never changes it, and choosing a different baseline never changes the draft. */
export interface DesignBaseline {
  revisionId: string;
  selectedAt: string;
  selectedBy?: string;
}

/** The revision the draft is compared with: the one chosen, else the latest issued (`chosen` says which). */
export function baselineOf(p: Project): { revision: Revision; chosen: boolean } | undefined {
  const picked = p.baseline && p.revisions?.find((r) => r.id === p.baseline!.revisionId);
  if (picked) return { revision: picked, chosen: true };
  const latest = currentRevision(p);
  return latest ? { revision: latest, chosen: false } : undefined;
}

/** Chooses the baseline. Only the pointer changes: the design, the BOQ and every adjustment in the draft stay as they are. */
export function setBaseline(p: Project, revisionId: string, by?: string, now = new Date()): Project {
  if (!p.revisions?.some((r) => r.id === revisionId)) return p;
  return { ...p, baseline: { revisionId, selectedAt: now.toISOString(), ...(by?.trim() ? { selectedBy: by.trim() } : {}) } };
}

export const clearBaseline = (p: Project): Project => (p.baseline ? { ...p, baseline: undefined } : p);

export interface DraftSummary {
  revision: Revision;
  chosen: boolean;
  counts: Record<ChangeClass, number>;
  /** The engineering values or drawings differ from the baseline. */
  designChanged: boolean;
  diff: Diff;
}

/** How the working draft differs from its baseline (undefined before the first revision is issued). */
export function draftSummary(p: Project): DraftSummary | undefined {
  const b = baselineOf(p);
  if (!b) return undefined;
  const diff = diffProjects(b.revision.snapshot, p);
  const counts = countByClass(diff);
  return { ...b, counts, designChanged: DESIGN_CLASSES.some((c) => counts[c] > 0), diff };
}
