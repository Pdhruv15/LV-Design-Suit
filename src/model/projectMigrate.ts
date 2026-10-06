import type { Project } from '../types';

/** Project identity, file-format version and copying.
 *
 * Every project has a stable `id` (so recovery, history and copies can refer
 * to it whatever its file is called), a `schemaVersion`, and a `createdAt`.
 * Older files get these when they are opened; nothing is written until the
 * user saves. */
export const CURRENT_SCHEMA = 1;

const fnv = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export function newProjectId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** The same file always gets the same legacy ID, so two opens before a save agree. */
export const legacyIdFor = (file: string): string => `legacy-${fnv(file.toLowerCase())}${fnv(`${file.length}:${file}`)}`;

/** A project saved by a newer version of the app than this one. */
export const isFutureSchema = (p: Project): boolean => (p.schemaVersion ?? 0) > CURRENT_SCHEMA;

/** The project with an id, version and creation date (the same object when it already has them). */
export function migrateProject(p: Project, file?: string): Project {
  if (isFutureSchema(p)) return p; // never rewrite what this version does not understand
  if (p.id && p.schemaVersion === CURRENT_SCHEMA && p.createdAt) return p;
  const firstRevision = p.revisions?.[0]?.date;
  const created = p.createdAt ?? (firstRevision && !Number.isNaN(Date.parse(firstRevision)) ? new Date(firstRevision).toISOString() : p.updatedAt);
  return { ...p, id: p.id ?? (file ? legacyIdFor(file) : newProjectId()), schemaVersion: CURRENT_SCHEMA, createdAt: created };
}

export type CopyKind = 'save-as' | 'duplicate';

/** The one rule for "a copy of this project".
 *  - Save as: a branch of the same job — everything is kept, including revision history and transmittals.
 *  - Duplicate: a similar new job — the design is kept, but not the revision history, issued drawing
 *    history, transmittals or delivered ticks and dates, and the status starts again at Design.
 * Both get their own id, creation date and a note of where they came from. */
export function copyProject(p: Project, kind: CopyKind, name: string, by?: string, now = new Date()): Project {
  const at = now.toISOString();
  const copy: Project = {
    ...p,
    id: newProjectId(),
    schemaVersion: CURRENT_SCHEMA,
    createdAt: at,
    createdBy: by || p.createdBy,
    updatedAt: at,
    updatedBy: by || p.updatedBy,
    name,
    status: undefined,
    origin: { copiedFromId: p.id, copiedFromName: p.name, copiedAt: at, kind }
  };
  if (kind === 'duplicate') {
    copy.revisions = undefined;
    // Decisions and applications belong to the old job; the intended changes are kept as fresh drafts against nothing.
    copy.baseline = undefined;
    if (p.modifications) copy.modifications = p.modifications.map((m) => ({ ...m, status: 'draft' as const, decision: undefined, applied: undefined, supersededBy: undefined, baselineRevisionId: undefined, baselineFingerprint: undefined, history: [{ status: 'draft' as const, at, note: `Copied from ${p.name} (${m.id}, was ${m.status})` }] }));
    // A similar new job starts with nothing delivered and no dates.
    if (p.brief) copy.brief = { ...p.brief, deliverables: p.brief.deliverables.map((d) => ({ ...d, done: undefined, targetDate: undefined })) };
    if (p.drawingSet) {
      copy.drawingSet = {
        ...p.drawingSet,
        issues: undefined,
        sheets: p.drawingSet.sheets.map((s) => ({ ...s, history: undefined, issuedHash: undefined, rev: undefined }))
      };
    }
  }
  return copy;
}
