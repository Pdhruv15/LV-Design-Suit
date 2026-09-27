import { boardDemandKw } from '../calc/electrical';
import { circuitRef, isScheduleCircuit } from '../calc/loadSchedule';
import type { Board, Feeder, Project, Revision } from '../types';

/** Revisions: an issued copy of the project (Rev A, B, C…) kept inside the
 * project file, to compare with the current design or go back to. */

/** The project as frozen in a revision: everything except the revision
 * history itself. */
export type Snapshot = Omit<Project, 'revisions'>;

export const snapshotOf = (p: Project): Snapshot => {
  const { revisions: _omit, ...rest } = p;
  return JSON.parse(JSON.stringify(rest));
};

/** A, B, … Z, then AA, AB… */
export function nextRevisionId(project: Project): string {
  const n = project.revisions?.length ?? 0;
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

export function issueRevision(project: Project, r: { description: string; by?: string; date?: string }): Project {
  const rev: Revision = {
    id: nextRevisionId(project),
    date: r.date ?? new Date().toISOString().slice(0, 10),
    description: r.description.trim(),
    by: r.by?.trim() || undefined,
    snapshot: snapshotOf(project)
  };
  return { ...project, revisions: [...(project.revisions ?? []), rev] };
}

/** The latest issued revision, or undefined before the first issue. */
export const currentRevision = (p: Project): Revision | undefined => p.revisions?.[p.revisions.length - 1];

/** Whether the design changed since the latest revision was issued. */
export function changedSinceRevision(p: Project): boolean {
  const rev = currentRevision(p);
  if (!rev) return false;
  return diffProjects(rev.snapshot, p).changes.length > 0;
}

/** Replaces the design with a revision's copy; the revision history is kept
 * (restoring is itself undoable by restoring a later revision). */
export function restoreRevision(project: Project, id: string): Project {
  const rev = project.revisions?.find((r) => r.id === id);
  if (!rev) return project;
  return { ...JSON.parse(JSON.stringify(rev.snapshot)), revisions: project.revisions };
}

/** Text for the form headers, e.g. "REV B · 2026-09-27". */
export function revisionStamp(p: Project): string {
  const rev = currentRevision(p);
  return rev ? `REV ${rev.id} · ${rev.date}` : 'REV —';
}

// ---- Comparison ----

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface Change {
  kind: 'added' | 'removed' | 'changed';
  what: 'project' | 'board' | 'feeder' | 'circuit';
  id: string;
  /** e.g. "DB-GF1 R3 (Cooker)" */
  label: string;
  /** Board it belongs to, for grouping. */
  boardId?: string;
  fields: FieldChange[];
}

export interface Diff {
  changes: Change[];
  /** Connected demand (kW) per board that exists in either, before → after. */
  boardKw: { boardId: string; from: number; to: number }[];
}

const FEEDER_FIELDS: [keyof Feeder, string][] = [
  ['name', 'Name'], ['room', 'Room'], ['points', 'Points'], ['loadKw', 'Load (kW)'], ['demandFactor', 'Demand factor'],
  ['powerFactor', 'PF'], ['breakerRatingA', 'Breaker (A)'], ['breakerType', 'Breaker type'], ['breakerIcuKa', 'Breaking capacity (kA)'],
  ['device', 'Device'], ['cableCsaMm2', 'Cable (mm²)'], ['cores', 'Cores'], ['cableType', 'Cable type'], ['cpcMm2', 'ECC (mm²)'],
  ['lengthM', 'Length (m)'], ['phase', 'Phase'], ['way', 'Way'], ['kwhMeter', 'kWh meter'], ['feedsBoardId', 'Feeds'], ['remarks', 'Remarks']
];

const BOARD_FIELDS: [keyof Board, string][] = [
  ['name', 'Name'], ['kind', 'Type'], ['upstreamId', 'Fed from'], ['ratedCurrentA', 'Rating (A)'], ['sourceKva', 'Transformer (kVA)'],
  ['sourceImpedancePct', 'Transformer Z (%)'], ['location', 'Location'], ['pointWatts', 'WATT / UNIT'], ['elcbGroupSize', 'Circuits per ELCB'],
  ['elcbSensitivityMa', 'ELCB sensitivity'], ['supply', 'Incoming supply']
];

const PROJECT_FIELDS: [keyof Snapshot, string][] = [
  ['name', 'Project name'], ['voltageV', 'Voltage (V)'], ['ambientC', 'Ambient (°C)'], ['vdLimitPct', 'VD limit (%)'],
  ['pointTemplate', 'Schedule columns'], ['info', 'Form details'], ['studySettings', 'Design settings']
];

/** Plain text for a field value; objects list their non-empty entries. */
function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'number') return String(+v.toFixed(3));
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== '' && x !== 0).map(([k, x]) => `${k} ${show(x)}`);
    return parts.length ? parts.join(', ') : '—';
  }
  return String(v);
}

function fieldChanges<T>(a: T, b: T, fields: [keyof T, string][]): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [k, label] of fields) {
    const from = show(a[k]);
    const to = show(b[k]);
    if (from !== to) out.push({ field: label, from, to });
  }
  return out;
}

const feederLabel = (f: Feeder) => {
  const ref = circuitRef(f);
  const name = f.room || f.name;
  return ref ? `${f.boardId} ${ref}${name ? ` (${name})` : ''}` : `${f.id}${name && name !== f.id ? ` (${name})` : ''}`;
};

/** Everything that differs between two versions of a project. */
export function diffProjects(before: Snapshot, after: Snapshot): Diff {
  const changes: Change[] = [];
  const p = fieldChanges(before, after, PROJECT_FIELDS);
  if (p.length) changes.push({ kind: 'changed', what: 'project', id: 'project', label: 'Project', fields: p });

  const bBefore = new Map(before.boards.map((b) => [b.id, b]));
  const bAfter = new Map(after.boards.map((b) => [b.id, b]));
  for (const b of after.boards) {
    const old = bBefore.get(b.id);
    if (!old) changes.push({ kind: 'added', what: 'board', id: b.id, label: `${b.id} (${b.name})`, boardId: b.id, fields: [] });
    else {
      const f = fieldChanges(old, b, BOARD_FIELDS);
      if (f.length) changes.push({ kind: 'changed', what: 'board', id: b.id, label: `${b.id} (${b.name})`, boardId: b.id, fields: f });
    }
  }
  for (const b of before.boards) if (!bAfter.has(b.id)) changes.push({ kind: 'removed', what: 'board', id: b.id, label: `${b.id} (${b.name})`, boardId: b.id, fields: [] });

  const fBefore = new Map(before.feeders.map((f) => [f.id, f]));
  const fAfter = new Map(after.feeders.map((f) => [f.id, f]));
  const what = (f: Feeder) => (isScheduleCircuit(f) ? 'circuit' : 'feeder') as Change['what'];
  for (const f of after.feeders) {
    const old = fBefore.get(f.id);
    if (!old) changes.push({ kind: 'added', what: what(f), id: f.id, label: feederLabel(f), boardId: f.boardId, fields: [] });
    else {
      const fc = fieldChanges(old, f, FEEDER_FIELDS);
      if (fc.length) changes.push({ kind: 'changed', what: what(f), id: f.id, label: feederLabel(f), boardId: f.boardId, fields: fc });
    }
  }
  for (const f of before.feeders) if (!fAfter.has(f.id)) changes.push({ kind: 'removed', what: what(f), id: f.id, label: feederLabel(f), boardId: f.boardId, fields: [] });

  const ids = [...new Set([...before.boards.map((b) => b.id), ...after.boards.map((b) => b.id)])];
  const kw = (s: Snapshot, id: string) => (s.boards.some((b) => b.id === id) ? boardDemandKw(s as Project, id) : 0);
  const boardKw = ids.map((id) => ({ boardId: id, from: kw(before, id), to: kw(after, id) }));
  return { changes, boardKw };
}
