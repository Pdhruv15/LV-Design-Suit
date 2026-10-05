import { boardDemandKw } from '../calc/electrical';
import { circuitRef, isScheduleCircuit } from '../calc/loadSchedule';
import type { Board, Feeder, Project, Revision } from '../types';
import { BOARD_CLASS, CLASS_LABEL, DESIGN_CLASSES, FEEDER_CLASS, INFO_ENGINEERING, PROJECT_CLASS, type ChangeClass } from './changeClass';
import { leafChanges, pairText, same, type FieldChange } from './datasetDiff';
import { withEarthPitIds } from './earthingPlan';

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

/** Whether the design (engineering values or drawings and documents) changed since the latest revision was
 * issued. Pricing, project details and numbers the app assigns by itself do not count. */
export function changedSinceRevision(p: Project): boolean {
  const rev = currentRevision(p);
  if (!rev) return false;
  return diffProjects(rev.snapshot, p).changes.some((c) => DESIGN_CLASSES.includes(c.class));
}

/** How many changes of each kind there are since the latest revision (for "what changed" summaries). */
export function changeCountsSinceRevision(p: Project): Record<ChangeClass, number> | undefined {
  const rev = currentRevision(p);
  return rev ? countByClass(diffProjects(rev.snapshot, p)) : undefined;
}

/** Replaces the design with a revision's copy; the revision history is kept (restoring is itself undoable by
 * restoring a later revision). What belongs to the project rather than to the design is kept as it is now: its
 * name, status, tags, notes, scope, baseline, identity, dates and the app's own bookkeeping — restoring Rev A must
 * not turn an approved job back into "design" or change which project it is. Engineering inputs held in the form
 * details (demand factor, built-up area) are restored. */
export function restoreRevision(project: Project, id: string): Project {
  const rev = project.revisions?.find((r) => r.id === id);
  if (!rev) return project;
  const snap = JSON.parse(JSON.stringify(rev.snapshot)) as Record<string, unknown>;
  const now = project as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...snap };
  for (const k of Object.keys(PROJECT_CLASS) as (keyof Project)[]) if (PROJECT_CLASS[k] === 'admin' || PROJECT_CLASS[k] === 'bookkeeping') out[k] = now[k];
  const info: Record<string, unknown> = { ...(project.info ?? {}) };
  const was = (snap.info ?? {}) as Record<string, unknown>;
  for (const k of INFO_ENGINEERING) { if (was[k] === undefined) delete info[k]; else info[k] = was[k]; }
  out.info = Object.keys(info).length ? info : undefined;
  out.revisions = project.revisions;
  return out as unknown as Project;
}

/** Text for the form headers, e.g. "REV B · 2026-09-27". */
export function revisionStamp(p: Project): string {
  const rev = currentRevision(p);
  return rev ? `REV ${rev.id} · ${rev.date}` : 'REV —';
}

// ---- Comparison ----

export type { FieldChange };

export interface Change {
  kind: 'added' | 'removed' | 'changed';
  what: 'project' | 'board' | 'feeder' | 'circuit' | 'ups' | 'earthing' | 'sheet' | 'drawing' | 'commercial' | 'details';
  id: string;
  /** e.g. "DB-GF1 R3 (Cooker)" */
  label: string;
  /** Board it belongs to, for grouping. */
  boardId?: string;
  fields: FieldChange[];
  /** What kind of change it is (engineering, drawings, commercial, project details). */
  class: ChangeClass;
}

export interface Diff {
  changes: Change[];
  /** Connected demand (kW) per board that exists in either, before → after. */
  boardKw: { boardId: string; from: number; to: number }[];
}

export const countByClass = (d: Diff): Record<ChangeClass, number> => {
  const out: Record<ChangeClass, number> = { engineering: 0, drawing: 0, commercial: 0, admin: 0, bookkeeping: 0 };
  for (const c of d.changes) out[c.class]++;
  return out;
};

type Fields<T> = [keyof T & string, string][];

/** Circuit fields compared, with the name shown. Every field of the model that is not an identifier or app bookkeeping
 * has a line here (a test checks this against the classification in changeClass.ts). */
export const FEEDER_FIELDS: Fields<Feeder> = [
  ['name', 'Name'], ['room', 'Room'], ['points', 'Points'], ['loadKw', 'Load (kW)'], ['demandFactor', 'Demand factor'],
  ['powerFactor', 'PF'], ['breakerRatingA', 'Breaker (A)'], ['breakerType', 'Breaker type'], ['breakerIcuKa', 'Breaking capacity (kA)'],
  ['device', 'Device'], ['cableCsaMm2', 'Cable (mm²)'], ['cores', 'Cores'], ['cableType', 'Cable type'], ['cpcMm2', 'ECC (mm²)'],
  ['lengthM', 'Length (m)'], ['parallel', 'Parallel runs'], ['trayRoute', 'Tray route'], ['breakerImMultiple', 'Instantaneous (× In)'],
  ['rcdMa', 'RCD (mA)'], ['essential', 'Essential (generator)'], ['standbyUnit', 'Standby unit'], ['kvar', 'Capacitor (kvar)'], ['starter', 'Starter'],
  ['loadType', 'Load type'], ['phase', 'Phase'], ['way', 'Way'], ['kwhMeter', 'kWh meter'], ['feedsBoardId', 'Feeds'], ['remarks', 'Remarks'],
  ['boardId', 'On board'], ['generation', 'Generation (PV / generator)'], ['componentId', 'Component'], ['componentValues', 'Component values'], ['fromRoom', 'Standby unit from'],
  ['manualSize', 'Sizes set by hand'], ['circuitPurpose', 'Circuit purpose'], ['localIsolator', 'Local isolator'], ['capSteps', 'Capacitor steps'], ['detunedPct', 'Detuning (%)']
];

export const BOARD_FIELDS: Fields<Board> = [
  ['name', 'Name'], ['kind', 'Type'], ['upstreamId', 'Fed from'], ['ratedCurrentA', 'Rating (A)'], ['sourceKva', 'Transformer (kVA)'],
  ['sourceImpedancePct', 'Transformer Z (%)'], ['location', 'Location'], ['pointWatts', 'WATT / UNIT'], ['elcbGroupSize', 'Circuits per ELCB'],
  ['elcbSensitivityMa', 'ELCB sensitivity'], ['supply', 'Incoming supply'], ['standby', 'Standby generator'], ['level', 'Level'],
  ['sourceXr', 'Transformer X/R'], ['vectorGroup', 'Vector group'], ['protection', 'Incomer protection'], ['upsKva', 'UPS (kVA)'],
  ['busbarMaterial', 'Busbar material'], ['ipRating', 'IP rating'], ['manufacturer', 'Manufacturer'], ['model', 'Model'], ['instruments', 'Instruments on the SLD'],
  ['earthing', 'Earth pit detail on the SLD'], ['rmu', 'RMU'], ['spd', 'Surge protection'], ['enclosure', 'Enclosure'], ['substation', 'Substation'],
  ['mdDemandFactor', 'MD demand factor'], ['txRef', 'Transformer reference'], ['summaryLoad', 'Summary load'], ['summaryMeters', 'Summary meters'],
  ['pointItems', 'Library item per column'], ['spareNames', 'Spare names'], ['elcbRatingA', 'ELCB rating (A)']
];

/** Single project settings. */
export const PROJECT_FIELDS: Fields<Snapshot> = [
  ['name', 'Project name'], ['voltageV', 'Voltage (V)'], ['frequencyHz', 'Frequency (Hz)'], ['ambientC', 'Ambient (°C)'], ['vdLimitPct', 'VD limit (%)'],
  ['pointTemplate', 'Schedule columns'], ['studySettings', 'Design settings'], ['vdTempC', 'Cable temperature for voltage drop (°C)'],
  ['strictFinalDisconnection', 'Strict final-circuit disconnection'], ['vdFinalCircuits', 'Voltage drop: include final circuits'], ['status', 'Status'], ['archivedAt', 'Archived']
];

/** Larger data sets: a summary line (with a count where it helps) and then the individual differences. */
export const DATA_SETS: Fields<Snapshot> = [
  ['building', 'Building information (levels, rooms)'], ['trays', 'Cable trays'], ['busRisers', 'Busbar risers'], ['busbarData', 'Busbar data'],
  ['ties', 'Bus couplers'], ['pv', 'Solar PV'], ['substations', 'Substation rooms'], ['txGen', 'Transformer & generator plan'], ['pfc', 'Power factor correction plan'],
  ['spacePlan', 'Space plan'], ['pfcCalc', 'Power factor calculator'], ['containmentCalc', 'Containment calculator'], ['components', 'Own components'],
  ['drawing', 'SLD title block and drawing settings'], ['titleTemplates', 'Title block templates'], ['params', 'Parameters'], ['studyReport', 'Study report setup'], ['panelPrefixes', 'Panel naming'],
  ['tags', 'Tags'], ['notes', 'Notes'], ['brief', 'Scope and deliverables'], ['vdSelection', 'Circuits chosen for voltage drop'], ['feederPresets', 'Feeder presets'],
  ['studyReportPresets', 'Study report presets'], ['calc', 'Calculation options']
];
const sizeOf = (v: unknown) => (Array.isArray(v) ? `${v.length} item(s)` : v === undefined || v === null ? '—' : 'set');

/** Plain text for a field value; objects list their non-empty entries. */
function show(v: unknown, digits = 3): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'number') return String(+v.toFixed(digits));
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== '' && x !== 0).map(([k, x]) => `${k} ${show(x, digits)}`);
    return parts.length ? parts.join(', ') : '—';
  }
  return String(v);
}

/** The listed fields that differ. Compared on the exact values — not on how they print — so a change in the fourth
 * decimal is found; zero entries inside an object (points counts) and empty values count as not set. */
function fieldChanges<T>(a: T, b: T, fields: [keyof T, string][]): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [k, label] of fields) {
    if (same(a[k], b[k], true)) continue;
    const [from, to] = pairText(a[k], b[k], show);
    out.push({ field: label, from, to });
  }
  return out;
}

const feederLabel = (f: Feeder) => {
  const ref = circuitRef(f);
  const name = f.room || f.name;
  return ref ? `${f.boardId} ${ref}${name ? ` (${name})` : ''}` : `${f.id}${name && name !== f.id ? ` (${name})` : ''}`;
};

/** An item's class: engineering when any changed field is engineering, else drawing (names, rooms, remarks). */
function classOfFields<T extends string>(fields: FieldChange[], table: [string, string][], classes: Record<T, ChangeClass>): ChangeClass {
  const byLabel = new Map(table.map(([k, label]) => [label, classes[k as T]]));
  return fields.some((f) => (byLabel.get(f.field) ?? 'engineering') === 'engineering') ? 'engineering' : 'drawing';
}

const without = <T extends object>(o: T | undefined, keys: string[]): Partial<T> | undefined => {
  if (!o) return o;
  const r = { ...o } as Record<string, unknown>;
  for (const k of keys) delete r[k];
  return r as Partial<T>;
};

/** Everything that differs between two versions of a project, each difference classed as engineering, drawings and
 * documents, commercial or project details. Identifiers, dates and numbers the app assigns by itself are not changes. */
export function diffProjects(before: Snapshot, after: Snapshot): Diff {
  const changes: Change[] = [];
  const A = before as Record<string, unknown>, B = after as Record<string, unknown>;
  const group: Record<'engineering' | 'drawing' | 'commercial' | 'admin', FieldChange[]> = { engineering: [], drawing: [], commercial: [], admin: [] };
  const cls = (k: string): 'engineering' | 'drawing' | 'commercial' | 'admin' => {
    const c = PROJECT_CLASS[k as keyof Project];
    return c === 'bookkeeping' ? 'admin' : c;
  };

  for (const [k, label] of PROJECT_FIELDS) group[cls(k)].push(...fieldChanges(before, after, [[k, label]]));
  // Form details are administrative, except the demand factor and built-up area, which are inputs.
  const infoA = before.info ?? {}, infoB = after.info ?? {};
  group.admin.push(...fieldChanges({ info: without(infoA, INFO_ENGINEERING) }, { info: without(infoB, INFO_ENGINEERING) }, [['info', 'Form details']]));
  for (const k of INFO_ENGINEERING) group.engineering.push(...fieldChanges(infoA, infoB, [[k, k === 'mdDemandFactor' ? 'MD demand factor (project)' : 'Built-up area (m²)']]));
  for (const [k, label] of DATA_SETS) {
    const a = A[k], b = B[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    group[cls(k)].push({ field: label, from: sizeOf(a), to: a === undefined ? sizeOf(b) : `changed${Array.isArray(b) ? ` (${b.length} item(s))` : ''}` });
    if (typeof a === 'object' || typeof b === 'object') for (const f of leafChanges(a, b)) group[cls(k)].push({ ...f, field: `${label} › ${f.field}` });
  }
  // Pricing: the BOQ and the rates. These never make the electrical design "changed".
  for (const [k, label] of [['boq', 'BOQ'], ['priceList', 'Price list']] as const)
    for (const f of leafChanges(A[k], B[k])) group.commercial.push({ ...f, field: `${label} › ${f.field}` });
  // The drawing set: set-level options here, each sheet below as an item of its own.
  const setA = without(before.drawingSet, ['sheets', 'issues']), setB = without(after.drawingSet, ['sheets', 'issues']);
  for (const f of leafChanges(setA, setB)) group.drawing.push({ ...f, field: `Drawing set › ${f.field}` });

  const order: [keyof typeof group, Change['what'], string, string][] = [['engineering', 'project', 'project', 'Project'], ['drawing', 'drawing', 'drawing-docs', CLASS_LABEL.drawing], ['commercial', 'commercial', 'commercial', CLASS_LABEL.commercial], ['admin', 'details', 'details', CLASS_LABEL.admin]];
  const projectChange = (c: (typeof order)[number]) => group[c[0]].length ? [{ kind: 'changed' as const, what: c[1], id: c[2], label: c[3], fields: group[c[0]], class: c[0] }] : [];
  changes.push(...projectChange(order[0]));

  const bBefore = new Map(before.boards.map((b) => [b.id, b]));
  const bAfter = new Map(after.boards.map((b) => [b.id, b]));
  for (const b of after.boards) {
    const old = bBefore.get(b.id);
    if (!old) changes.push({ kind: 'added', what: 'board', id: b.id, label: `${b.id} (${b.name})`, boardId: b.id, fields: [], class: 'engineering' });
    else {
      const f = fieldChanges(old, b, BOARD_FIELDS);
      if (f.length) changes.push({ kind: 'changed', what: 'board', id: b.id, label: `${b.id} (${b.name})`, boardId: b.id, fields: f, class: classOfFields(f, BOARD_FIELDS, BOARD_CLASS) });
    }
  }
  for (const b of before.boards) if (!bAfter.has(b.id)) changes.push({ kind: 'removed', what: 'board', id: b.id, label: `${b.id} (${b.name})`, boardId: b.id, fields: [], class: 'engineering' });

  const fBefore = new Map(before.feeders.map((f) => [f.id, f]));
  const fAfter = new Map(after.feeders.map((f) => [f.id, f]));
  const what = (f: Feeder) => (isScheduleCircuit(f) ? 'circuit' : 'feeder') as Change['what'];
  for (const f of after.feeders) {
    const old = fBefore.get(f.id);
    if (!old) changes.push({ kind: 'added', what: what(f), id: f.id, label: feederLabel(f), boardId: f.boardId, fields: [], class: 'engineering' });
    else {
      const fc = fieldChanges(old, f, FEEDER_FIELDS);
      if (fc.length) changes.push({ kind: 'changed', what: what(f), id: f.id, label: feederLabel(f), boardId: f.boardId, fields: fc, class: classOfFields(fc, FEEDER_FIELDS, FEEDER_CLASS) });
    }
  }
  for (const f of before.feeders) if (!fAfter.has(f.id)) changes.push({ kind: 'removed', what: what(f), id: f.id, label: feederLabel(f), boardId: f.boardId, fields: [], class: 'engineering' });

  // UPS and battery systems, one item each.
  const upsA = new Map((before.upsSystems ?? []).map((u) => [u.id, u])), upsB = new Map((after.upsSystems ?? []).map((u) => [u.id, u]));
  for (const id of [...new Set([...upsA.keys(), ...upsB.keys()])]) {
    const x = upsA.get(id), y = upsB.get(id), label = `UPS ${(y ?? x)!.name || id}`;
    if (!x) changes.push({ kind: 'added', what: 'ups', id, label, boardId: y!.boardId, fields: [], class: 'engineering' });
    else if (!y) changes.push({ kind: 'removed', what: 'ups', id, label, boardId: x.boardId, fields: [], class: 'engineering' });
    else { const f = leafChanges(x, y, { skip: ['id'] }); if (f.length) changes.push({ kind: 'changed', what: 'ups', id, label, boardId: y.boardId, fields: f, class: 'engineering' }); }
  }

  // The earthing plan, compared after the same normalisation the app applies on opening (so a file from before the
  // pit IDs existed does not look edited), without the pit ID bookkeeping itself.
  const earth = (s: Snapshot) => withEarthPitIds(s as Project).earthingPlan;
  const earthFields = leafChanges(earth(before), earth(after));
  if (earthFields.length) changes.push({ kind: 'changed', what: 'earthing', id: 'earthing', label: 'Earthing plan', fields: earthFields, class: 'engineering' });

  // Drawing sheets, one item each (the sheet's own issue history and "drawn when issued" fingerprint are not edits).
  const shA = new Map((before.drawingSet?.sheets ?? []).map((x) => [x.id, x])), shB = new Map((after.drawingSet?.sheets ?? []).map((x) => [x.id, x]));
  for (const id of [...new Set([...shA.keys(), ...shB.keys()])]) {
    const x = shA.get(id), y = shB.get(id), label = `${(y ?? x)!.number} ${(y ?? x)!.title}`.trim();
    if (!x) changes.push({ kind: 'added', what: 'sheet', id, label, fields: [], class: 'drawing' });
    else if (!y) changes.push({ kind: 'removed', what: 'sheet', id, label, fields: [], class: 'drawing' });
    else { const f = leafChanges(x, y, { skip: ['id', 'issuedHash', 'history'] }); if (f.length) changes.push({ kind: 'changed', what: 'sheet', id, label, fields: f, class: 'drawing' }); }
  }

  for (const c of order.slice(1)) changes.push(...projectChange(c));

  const ids = [...new Set([...before.boards.map((b) => b.id), ...after.boards.map((b) => b.id)])];
  const kw = (s: Snapshot, id: string) => (s.boards.some((b) => b.id === id) ? boardDemandKw(s as Project, id) : 0);
  const boardKw = ids.map((id) => ({ boardId: id, from: kw(before, id), to: kw(after, id) }));
  return { changes, boardKw };
}
