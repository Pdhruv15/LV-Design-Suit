import type { Feeder, LoadType, Project } from '../types';
import { applyTransformers, mainBoards, planTransformers, withTransformer } from '../model/transformers';
import { applyRecommendation, boardDemandKva, recommend } from './sizing';
import { assess, type LoadAssessment } from './loadAssessment';

/** Load assessment → an MDB with one feeder per load category and per
 * custom load: connected kW and diversity as loadKw / demandFactor, the
 * assessment's power factor. A
 * category partly on the standby generator is split into a normal and an
 * essential feeder so the generator demand matches the assessment; fire and
 * life-safety plant gets a feeder per item (essential, demand factor 1 — the
 * generator sizing counts loadKw × demand factor). */

export interface LaFeederItem { key: string; label: string; kw: number; demandFactor: number; loadType: LoadType; essential?: boolean }

const LOAD_TYPE: Record<string, LoadType> = { ltg: 'lighting', pwr: 'sockets', hvac: 'hvac', dhw: 'general', cook: 'general', lift: 'motor', pump: 'motor', ev: 'ev', spec: 'general' };
const round = (x: number) => Math.round(x * 100) / 100;

export function assessmentFeeders(a: LoadAssessment): LaFeederItem[] {
  const out: LaFeederItem[] = [];
  for (const c of assess(a).categories) {
    if (c.key === 'life') {
      const f = a.factors;
      out.push({ key: 'fire', label: 'Fire pump (electric)', kw: f.firePumpKw, demandFactor: 1, loadType: 'fire-pump', essential: true });
      out.push({ key: 'jockey', label: 'Jockey pump', kw: f.jockeyKw, demandFactor: 1, loadType: 'motor', essential: true });
      if (a.floors > 4) for (const n of [1, 2]) out.push({ key: `stair${n}`, label: `Stair pressurisation fan ${n}`, kw: f.stairFanKw, demandFactor: 1, loadType: 'motor', essential: true });
      continue;
    }
    const custom = c.key.startsWith('custom:');
    const key = custom ? `c-${c.key.slice(7)}` : c.key;
    const loadType = custom ? 'general' : LOAD_TYPE[c.key] ?? 'general';
    const share = Math.min(1, Math.max(0, c.generatorShare));
    const normal = c.connectedKw * (1 - share), ess = c.connectedKw * share;
    if (normal > 1e-6) out.push({ key, label: c.label, kw: round(normal), demandFactor: c.diversity, loadType });
    if (ess > 1e-6) out.push({ key: share < 1 ? `${key}-e` : key, label: share < 1 ? `${c.label} (essential)` : c.label, kw: round(ess), demandFactor: c.diversity, loadType, essential: true });
  }
  return out.filter((x) => x.kw > 0);
}

/** Board.generated of the MDBs this command makes. */
export const LA_MDB = 'la:mdb';

const isLife = (it: LaFeederItem) => it.key === 'fire' || it.key === 'jockey' || it.key.startsWith('stair');
const demandKw = (xs: LaFeederItem[]) => xs.reduce((s, x) => s + x.kw * x.demandFactor, 0);

/** The feeders over `n` boards with their demand (loadKw × demand factor)
 * balanced: groups largest first onto the least-loaded board. A category's
 * normal and essential feeders are one group, and so are all the fire &
 * life-safety feeders. Each board keeps the assessment's feeder order. */
export function spreadFeeders(items: LaFeederItem[], n: number): LaFeederItem[][] {
  const groups = new Map<string, LaFeederItem[]>();
  for (const it of items) { const g = isLife(it) ? 'life' : it.key.replace(/-e$/, ''); groups.set(g, [...(groups.get(g) ?? []), it]); }
  const boards = Array.from({ length: Math.max(1, n) }, () => [] as LaFeederItem[]);
  const load = boards.map(() => 0);
  for (const g of [...groups.values()].sort((x, y) => demandKw(y) - demandKw(x))) {
    const i = load.indexOf(Math.min(...load));
    boards[i].push(...g);
    load[i] += demandKw(g);
  }
  const order = new Map(items.map((x, i) => [x, i]));
  return boards.map((b) => b.sort((x, y) => order.get(x)! - order.get(y)!));
}

export interface LaMdbResult {
  project: Project;
  boardId: string; // the first board
  boardIds: string[]; // the boards the feeders went on
  created: boolean; // a new board was made
  createdIds: string[];
  unused: string[]; // boards made by an earlier run that the assessment no longer needs (their assessment feeders removed)
  added: number;
  replaced: number;
  loading: { boardId: string; pct: number }[]; // transformer loading, demand kVA / kVA
}

/** Adds the assessment's feeders to `boardId` (a main board). When it is
 * undefined they go on one MDB per duty transformer, each with the
 * assessment's transformer, demand balanced over them (spreadFeeders). The
 * MDBs are tagged generated: 'la:mdb': a re-run reuses them (transformer updated to
 * the assessment's), makes more when more are needed and leaves the spare
 * ones in place with their assessment feeders removed. Feeders made earlier by
 * this command (fromRoom "la:…") on those boards are replaced; your own are kept. */
export function createMdbFromAssessment(project: Project, a: LoadAssessment, boardId?: string): LaMdbResult {
  const r = assess(a);
  const voltage = a.supply.voltage || project.voltageV;
  const pf = a.supply.pf > 0 && a.supply.pf <= 1 ? a.supply.pf : 0.9;
  let p = project;
  let ids: string[], unused: string[] = [], createdIds: string[] = [];
  if (boardId && p.boards.some((b) => b.id === boardId)) ids = [boardId];
  else {
    const n = Math.max(1, r.tx?.duty ?? 1), kva = r.tx?.kva;
    const earlier = mainBoards(p).filter((b) => b.generated === LA_MDB).map((b) => b.id);
    ids = earlier.slice(0, n);
    unused = earlier.slice(n);
    p = { ...p, boards: p.boards.map((b) => (ids.includes(b.id) ? withTransformer(b, kva, voltage) : b)) };
    if (ids.length < n) {
      const plan = planTransformers(p, Array.from({ length: n - ids.length }, () => ({ kva: kva ?? 0 })), false);
      p = applyTransformers(p, { ...plan, boards: plan.boards.map((b) => ({ ...withTransformer(b, kva, voltage), name: 'Main Distribution Board', generated: LA_MDB })) });
      createdIds = plan.boards.map((b) => b.id);
      ids = [...ids, ...createdIds];
    }
  }
  const cleared = new Set([...ids, ...unused]);
  const mine = (f: Feeder) => cleared.has(f.boardId) && !!f.fromRoom?.startsWith('la:');
  const replaced = p.feeders.filter(mine).length;
  p = { ...p, feeders: p.feeders.filter((f) => !mine(f)) };
  let added = 0;
  const spread = spreadFeeders(assessmentFeeders(a), ids.length);
  ids.forEach((id, bi) => {
    for (const it of spread[bi]) {
      let fid = `${id}-LA-${it.key.toUpperCase()}`;
      for (let n = 2; p.feeders.some((f) => f.id === fid); n++) fid = `${id}-LA-${it.key.toUpperCase()}-${n}`;
      const motor = it.loadType === 'motor' || it.loadType === 'fire-pump';
      const f: Feeder = {
        id: fid, boardId: id, name: it.label, loadKw: it.kw, demandFactor: it.demandFactor,
        powerFactor: pf, lengthM: 40, cableCsaMm2: 6, cores: 4, breakerRatingA: 32, breakerIcuKa: 25,
        loadType: it.loadType, essential: it.essential || undefined, localIsolator: motor || undefined,
        fromRoom: `la:${it.key}`
      };
      const tmp = { ...p, feeders: [...p.feeders, f] };
      p = { ...tmp, feeders: tmp.feeders.map((x) => (x.id === f.id ? applyRecommendation(f, recommend(tmp, f, 'optimise')) : x)) };
      added++;
    }
  });
  const loading = ids.flatMap((id) => {
    const kva = p.boards.find((b) => b.id === id)?.sourceKva;
    return kva ? [{ boardId: id, pct: (boardDemandKva(p, id) / kva) * 100 }] : [];
  });
  return { project: p, boardId: ids[0], boardIds: ids, created: createdIds.length > 0, createdIds, unused, added, replaced, loading };
}
