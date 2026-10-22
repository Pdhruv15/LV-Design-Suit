import type { Board, Project, BusTie } from '../types';
import { settingsOf } from '../types';
import { boardTotals } from './summary';
import { faultCurrentKA, impedanceToBoard, parallelGroup, type Status } from './electrical';

const SQRT3 = Math.sqrt(3);

/** Transformers in parallel through closed bus couplers (IEC 60076-8):
 * how they share the joined load, the current through each coupler, and the
 * conditions for parallel operation. The fault level of the joined busbar is
 * in impedanceToBoard; the earth fault loop keeps one transformer (the
 * minimum fault, with the coupler open). */

export interface ParallelTransformer {
  boardId: string;
  kva: number;
  impedancePct: number;
  vectorGroup: string;
  /** Demand of this board's own section. */
  sectionKva: number;
  /** Its share of the joined demand: in proportion to kVA ÷ uk %. */
  shareKva: number;
  loadingPct: number;
  status: Status;
}

export interface ParallelCoupler { tie: BusTie; currentA?: number; loadingPct?: number; status: Status }

export interface ParallelGroupResult {
  boards: string[];
  transformers: ParallelTransformer[];
  couplers: ParallelCoupler[];
  demandKva: number;
  faultKA: number;
  /** Conditions for parallel operation that are not met. */
  conditions: { text: string; status: Exclude<Status, 'ok'> }[];
  status: Status;
}

const worst = (s: Status[]): Status => (s.includes('bad') ? 'bad' : s.includes('warn') ? 'warn' : 'ok');

export function parallelOperation(project: Project): ParallelGroupResult[] {
  const done = new Set<string>();
  const out: ParallelGroupResult[] = [];
  const limit = settingsOf(project).transformerMaxLoadingPct;
  for (const b of project.boards) {
    if (done.has(b.id)) continue;
    const group = parallelGroup(project, b.id);
    if (group.length < 2) continue;
    group.forEach((g) => done.add(g.id));
    const ids = new Set(group.map((g) => g.id));
    const pq = new Map(group.map((g) => { const t = boardTotals(project, g.id); return [g.id, { p: t.demandKw, q: Math.max(0, t.demandKvar) }]; }));
    const P = group.reduce((s, g) => s + pq.get(g.id)!.p, 0);
    const Q = group.reduce((s, g) => s + pq.get(g.id)!.q, 0);
    const demandKva = Math.hypot(P, Q);
    const weight = (g: Board) => g.sourceKva! / g.sourceImpedancePct!;
    const W = group.reduce((s, g) => s + weight(g), 0);
    const k = (g: Board) => weight(g) / W;

    const transformers = group.map((g): ParallelTransformer => {
      const shareKva = demandKva * k(g);
      const loadingPct = (shareKva / g.sourceKva!) * 100;
      const own = pq.get(g.id)!;
      return {
        boardId: g.id, kva: g.sourceKva!, impedancePct: g.sourceImpedancePct!, vectorGroup: g.vectorGroup ?? 'Dyn11',
        sectionKva: Math.hypot(own.p, own.q), shareKva, loadingPct,
        status: loadingPct > 100 + 1e-6 ? 'bad' : loadingPct > limit + 1e-6 ? 'warn' : 'ok'
      };
    });

    // Each coupler carries what one side's transformers supply beyond that side's own load.
    const ties = (project.ties ?? []).filter((t) => t.closed && ids.has(t.a) && ids.has(t.b));
    const couplers = ties.map((t): ParallelCoupler => {
      const side = new Set([t.a]);
      for (let added = true; added; ) {
        added = false;
        for (const u of ties) {
          if (u === t) continue;
          const [x, y] = side.has(u.a) ? [u.a, u.b] : side.has(u.b) ? [u.b, u.a] : [];
          if (x && y && !side.has(y)) { side.add(y); added = true; }
        }
      }
      if (side.has(t.b)) return { tie: t, status: 'ok' }; // couplers in a ring: the split isn't worked out
      let p = 0, q = 0;
      for (const g of group) if (side.has(g.id)) { p += k(g) * P - pq.get(g.id)!.p; q += k(g) * Q - pq.get(g.id)!.q; }
      const currentA = (Math.hypot(p, q) * 1000) / (SQRT3 * project.voltageV);
      const loadingPct = (currentA / t.ratingA) * 100;
      return { tie: t, currentA, loadingPct, status: loadingPct > 100 + 1e-6 ? 'bad' : loadingPct > 85 ? 'warn' : 'ok' };
    });

    const conditions: ParallelGroupResult['conditions'] = [];
    const groups = new Set(transformers.map((t) => t.vectorGroup.toUpperCase()));
    if (groups.size > 1) conditions.push({ text: `Vector groups differ (${transformers.map((t) => `${t.boardId} ${t.vectorGroup}`).join(', ')}): they must be the same to run in parallel`, status: 'bad' });
    const z = transformers.map((t) => t.impedancePct);
    if (Math.max(...z) > Math.min(...z) * 1.1 + 1e-9) conditions.push({ text: `Impedances ${z.map((x) => `${x} %`).join(' / ')} differ by more than 10 %: the load shares unequally`, status: 'warn' });
    const s = transformers.map((t) => t.kva);
    if (Math.max(...s) > Math.min(...s) * 2 + 1e-9) conditions.push({ text: `Ratings ${s.map((x) => `${x} kVA`).join(' / ')} differ by more than 2 : 1`, status: 'warn' });

    const faultKA = faultCurrentKA(impedanceToBoard(project, group[0].id), project.voltageV);
    out.push({
      boards: group.map((g) => g.id), transformers, couplers, demandKva, faultKA, conditions,
      status: worst([...transformers.map((t) => t.status), ...couplers.map((c) => c.status), ...conditions.map((c) => c.status)])
    });
  }
  return out;
}
