import type { Board, Feeder, Project } from '../types';
import type { PlanCheck } from './hierarchy';
import { sequence } from './hierarchyBuilder';

/** Emergency panels and the panel naming table.
 *
 * DEWA practice: normally one dedicated emergency panel (EMDB) with a dual
 * supply through an ATS — mains from a normal panel, standby from the
 * generator. In the model the EMDB is fed from that mains panel and carries
 * `standby` (generator kVA, ATS): the existing generator scenario and sizing
 * then treat everything on and below it as essential load.
 * Emergency sub-panels are ordinary SMDB / DB boards below an EMDB; their
 * role (ESMDB / EDB) — and so their name prefix — comes from being below it. */

export type PanelRole = 'MDB' | 'SMDB' | 'DB' | 'EMDB' | 'ESMDB' | 'EDB';
export const PANEL_ROLES: { role: PanelRole; label: string }[] = [
  { role: 'MDB', label: 'Main distribution board' }, { role: 'SMDB', label: 'Sub-main distribution board' }, { role: 'DB', label: 'Distribution board' },
  { role: 'EMDB', label: 'Emergency main board (ATS)' }, { role: 'ESMDB', label: 'Emergency sub-main board' }, { role: 'EDB', label: 'Emergency distribution board' }
];

export const prefixOf = (project: Project, role: string): string => (project.panelPrefixes as Record<string, string> | undefined)?.[role]?.trim() || role;
export const namesOf = (project: Project) => ({ MDB: prefixOf(project, 'MDB'), SMDB: prefixOf(project, 'SMDB'), DB: prefixOf(project, 'DB') });

/** A panel's role: its type, or ESMDB / EDB when it is below an EMDB. Other kinds (MCC, UPS…) keep their kind. */
export function roleOf(project: Project, b: Board): string {
  const kind = b.kind ?? (b.upstreamId ? 'DB' : 'MDB');
  if (kind === 'EMDB') return 'EMDB';
  if (kind !== 'SMDB' && kind !== 'DB') return kind;
  const byId = new Map(project.boards.map((x) => [x.id, x]));
  const seen = new Set<string>();
  for (let up = b.upstreamId ? byId.get(b.upstreamId) : undefined; up && !seen.has(up.id); up = up.upstreamId ? byId.get(up.upstreamId) : undefined) {
    seen.add(up.id);
    if (up.kind === 'EMDB') return kind === 'SMDB' ? 'ESMDB' : 'EDB';
  }
  return kind;
}

export interface EmergencySpec {
  count: number; // EMDBs, normally 1
  mainsFrom: string; // the normal panel giving the ATS its mains supply
  generatorKva?: number; // standby generator on the ATS (blank: to assign)
  esmdb: number; // emergency sub-mains, spread over the EMDBs
  edb: number; // emergency DBs, spread over the ESMDBs (or the EMDBs when none)
  incomers: boolean;
}

const spread = (count: number, groups: number) => Array.from({ length: groups }, (_, i) => Math.floor(count / groups) + (i < count % groups ? 1 : 0));
const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

export function planEmergency(project: Project, spec: EmergencySpec): { boards: Board[]; feeders: Feeder[]; checks: PlanCheck[]; ok: boolean } {
  const checks: PlanCheck[] = [];
  const bad = (text: string) => checks.push({ level: 'bad', text });
  if (!whole(spec.count, 1, 10)) bad('Emergency main boards: a whole number from 1 to 10 (DEWA practice is normally 1).');
  if (!whole(spec.esmdb, 0, 500) || !whole(spec.edb, 0, 2000)) bad('Emergency sub-panel counts must be whole numbers of 0 or more.');
  if (spec.generatorKva !== undefined && !(spec.generatorKva > 0)) bad('Generator rating must be above 0 kVA, or leave it blank to assign later.');
  const mains = project.boards.find((b) => b.id === spec.mainsFrom);
  if (!mains) bad('Choose the normal panel that gives the ATS its mains supply.');
  if (checks.some((c) => c.level === 'bad')) return { boards: [], feeders: [], checks, ok: false };
  const E = prefixOf(project, 'EMDB'), ES = prefixOf(project, 'ESMDB'), ED = prefixOf(project, 'EDB');
  const eSeq = sequence(project, E, spec.count), sSeq = sequence(project, ES, spec.esmdb), dSeq = sequence(project, ED, spec.edb);
  const boards: Board[] = [];
  const emdbs = Array.from({ length: spec.count }, (_, i): Board => {
    const id = spec.count === 1 && !project.boards.some((b) => b.id === E || b.id.startsWith(`${E}-`)) ? E : `${E}-${eSeq(i + 1)}`;
    return { id, name: id, kind: 'EMDB', upstreamId: mains!.id, ...(spec.generatorKva ? { standby: { kva: spec.generatorKva, changeover: 'ATS' as const } } : {}) };
  });
  boards.push(...emdbs);
  let sN = 0, dN = 0;
  const subs: Board[] = [];
  spread(spec.esmdb, emdbs.length).forEach((n, g) => { for (let k = 0; k < n; k++) { const id = `${ES}-${sSeq(++sN)}`; subs.push({ id, name: id, kind: 'SMDB', upstreamId: emdbs[g].id }); } });
  boards.push(...subs);
  const dbParents = subs.length ? subs : emdbs;
  spread(spec.edb, dbParents.length).forEach((n, g) => { for (let k = 0; k < n; k++) { const id = `${ED}-${dSeq(++dN)}`; boards.push({ id, name: id, kind: 'DB', upstreamId: dbParents[g].id }); } });
  const taken = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id)]);
  const clash = boards.filter((b) => taken.has(b.id));
  if (clash.length) bad(`Already in the project: ${clash.slice(0, 5).map((b) => b.id).join(', ')}`);
  const feeders: Feeder[] = spec.incomers ? boards.map((b) => ({
    id: `INC-${b.id}`, boardId: b.upstreamId!, feedsBoardId: b.id, name: b.kind === 'EMDB' ? `To ${b.id} (ATS mains)` : `To ${b.id}`,
    lengthM: 10, lengthToCheck: true, cableCsaMm2: b.kind === 'DB' ? 16 : 35, breakerRatingA: b.kind === 'DB' ? 63 : 100, breakerIcuKa: b.kind === 'DB' ? 10 : 25,
    loadKw: 0, demandFactor: 1, powerFactor: 0.9, cores: 4 as const, sizingPending: true
  })) : [];
  if (feeders.some((f) => taken.has(f.id))) bad('An incomer id is already used — rename the existing feeder first.');
  checks.push({ level: 'warn', text: `ATS: mains from ${mains!.id}, standby ${spec.generatorKva ? `generator ${spec.generatorKva} kVA` : 'generator to assign (enter its kVA on the EMDB)'} — everything on and below ${emdbs.map((b) => b.id).join(', ')} counts as essential load.` });
  if (spec.count > 1) checks.push({ level: 'warn', text: 'More than one EMDB — DEWA practice is normally one dedicated emergency panel.' });
  if (feeders.length) checks.push({ level: 'warn', text: `${feeders.length} incomers are placeholders: sizing pending, lengths to check.` });
  if (!checks.some((c) => c.level === 'bad')) checks.push({ level: 'ok', text: 'Names are unique and every panel has a parent.' });
  return { boards, feeders, checks, ok: !checks.some((c) => c.level === 'bad') };
}
