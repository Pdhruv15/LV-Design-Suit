import type { Board, BusTie, Project } from '../types';
import { DEWA_TRANSFORMER_KVA, typicalImpedancePct } from '../calc/txGen';
import { STANDARD_BREAKER_A } from '../calc/sizing';
import { sequence } from './hierarchyBuilder';
import { boardAndDescendants } from './edit';
import { prefixOf } from './emergency';

/** Transformers of a project. One transformer feeds one main board (MDB):
 * the main board carries its rating (sourceKva). TX-1, TX-2 … are numbered
 * in the order of the main boards. */

export { DEWA_TRANSFORMER_KVA };

/** Main boards (no upstream), in project order. */
export const mainBoards = (project: Project) => project.boards.filter((b) => !b.upstreamId);

/** "TX-2" for a main board with a transformer, by its place among the main boards with one. */
export function txTag(project: Project, mainId: string): string | undefined {
  const withTx = mainBoards(project).filter((b) => b.sourceKva);
  const i = withTx.findIndex((b) => b.id === mainId);
  return i < 0 ? undefined : `TX-${i + 1}`;
}

/** The main board a panel is ultimately fed from. */
export function mainOf(project: Project, boardId: string): Board | undefined {
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const seen = new Set<string>();
  let b = byId.get(boardId);
  while (b?.upstreamId && !seen.has(b.id)) { seen.add(b.id); b = byId.get(b.upstreamId); }
  return b;
}

/** Supply path of a panel, source first: ["TX-2 (1500 kVA)", "MDB-02", "SMDB-L5", "DB-L5-02"]. */
export function supplyChain(project: Project, boardId: string): string[] {
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const path: string[] = [];
  const seen = new Set<string>();
  for (let b = byId.get(boardId); b && !seen.has(b.id); b = b.upstreamId ? byId.get(b.upstreamId) : undefined) { seen.add(b.id); path.unshift(b.id); }
  const main = byId.get(path[0]);
  const tag = main && txTag(project, main.id);
  const source = main?.sourceKva ? `${tag} (${main.sourceKva} kVA)` : main?.supply ? 'Authority supply' : 'Source not set';
  return [source, ...path];
}

/** Transformer and main board rating together: kVA, typical impedance, busbar up to the ACB. */
export function withTransformer(b: Board, kva: number | undefined, voltageV: number): Board {
  if (!kva) { const { sourceKva: _k, sourceImpedancePct: _z, ...rest } = b; return rest; }
  const flcA = (kva * 1000) / (Math.sqrt(3) * voltageV);
  const acbA = STANDARD_BREAKER_A.find((a) => a >= flcA) ?? STANDARD_BREAKER_A[STANDARD_BREAKER_A.length - 1];
  return { ...b, sourceKva: kva, sourceImpedancePct: typicalImpedancePct(kva), ratedCurrentA: Math.max(b.ratedCurrentA ?? 0, acbA) };
}

export interface TxSpec { kva: number }
export interface TxPlan { boards: Board[]; ties: BusTie[]; problems: string[] }

/** New transformers, each with its own MDB; optional normally-open bus ties between pairs (TX-1/TX-2, TX-3/TX-4 …). */
/** RMU names in use (from the transformers), in order. */
export const rmuNames = (project: Project) => [...new Set(mainBoards(project).map((b) => b.rmu?.trim()).filter((x): x is string => !!x))];
/** Next free "RMU-n" names. */
export function nextRmus(project: Project, count: number): string[] {
  const used = new Set(rmuNames(project));
  let n = Math.max(0, ...[...used].map((x) => Number(/^RMU-(\d+)$/.exec(x)?.[1] ?? 0)));
  return Array.from({ length: count }, () => { let id; do { id = `RMU-${++n}`; } while (used.has(id)); used.add(id); return id; });
}
/** Set the substation a transformer is in; blank clears it. */
export const setSubstation = (project: Project, mainId: string, name: string): Project =>
  ({ ...project, boards: project.boards.map((b) => { if (b.id !== mainId) return b; const { substation: _s, ...rest } = b; return name.trim() ? { ...rest, substation: name.trim() } : rest; }) });
/** Set the RMU feeding a transformer (main board); blank clears it. */
export const setRmu = (project: Project, mainId: string, rmu: string | undefined): Project =>
  ({ ...project, boards: project.boards.map((b) => { if (b.id !== mainId) return b; const { rmu: _r, ...rest } = b; return rmu ? { ...rest, rmu } : rest; }) });

export function planTransformers(project: Project, specs: TxSpec[], ties: boolean, perRmu: 1 | 2 = 1, substation?: string): TxPlan {
  const problems: string[] = [];
  if (!specs.length) problems.push('Enter at least one transformer');
  if (specs.length > 15) problems.push('15 transformers at most');
  const M = prefixOf(project, 'MDB');
  const seq = sequence({ ...project, boards: project.boards }, M, specs.length);
  const rmus = nextRmus(project, Math.ceil(specs.length / perRmu));
  const boards = specs.map((s, i) => withTransformer({ id: `${M}-${seq(i + 1)}`, name: `${M}-${seq(i + 1)}`, kind: 'MDB', rmu: rmus[Math.floor(i / perRmu)], ...(substation?.trim() ? { substation: substation.trim() } : {}) }, s.kva, project.voltageV));
  const taken = new Set(project.boards.map((b) => b.id));
  const clash = boards.filter((b) => taken.has(b.id));
  if (clash.length) problems.push(`Already in the project: ${clash.map((b) => b.id).join(', ')}`);
  const tieList: BusTie[] = [];
  if (ties) for (let i = 0; i + 1 < boards.length; i += 2) {
    const a = boards[i], b = boards[i + 1];
    tieList.push({ id: `BC-${a.id}-${b.id}`, a: a.id, b: b.id, ratingA: Math.min(a.ratedCurrentA ?? 0, b.ratedCurrentA ?? 0) });
  }
  return { boards, ties: tieList, problems };
}

export function applyTransformers(project: Project, plan: TxPlan): Project {
  if (plan.problems.length) throw new Error(plan.problems[0]);
  return { ...project, boards: [...project.boards, ...plan.boards], ...(plan.ties.length ? { ties: [...(project.ties ?? []), ...plan.ties] } : {}) };
}

/** Set (or clear) the transformer of a main board. */
export const setTransformer = (project: Project, mainId: string, kva: number | undefined): Project =>
  ({ ...project, boards: project.boards.map((b) => (b.id === mainId ? withTransformer(b, kva, project.voltageV) : b)) });

/** Move panels (with everything below them) to another board; their incomers go with them, lengths to check. */
export function moveUnder(project: Project, ids: string[], parentId: string): Project {
  const move = new Set(ids.filter((id) => id !== parentId && !boardAndDescendants(project, id).has(parentId)));
  if (!move.size) return project;
  return {
    ...project,
    boards: project.boards.map((b) => (move.has(b.id) ? { ...b, upstreamId: parentId } : b)),
    feeders: project.feeders.map((f) => (f.feedsBoardId && move.has(f.feedsBoardId) ? { ...f, boardId: parentId, lengthToCheck: true } : f))
  };
}
