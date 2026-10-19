import type { Board, Feeder, LoadType, Project } from '../types';
import { withTransformer } from '../model/transformers';
import { applyRecommendation, recommend } from './sizing';
import { assess, type LoadAssessment } from './loadAssessment';

/** Load assessment → an MDB with one feeder per load category and per
 * custom load: connected kW and diversity as loadKw / demandFactor. A
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

export interface LaMdbResult { project: Project; boardId: string; created: boolean; added: number; replaced: number }

/** Next free "MDB-n". */
const nextMdbId = (project: Project) => { let n = 1; while (project.boards.some((b) => b.id === `MDB-${n}`)) n++; return `MDB-${n}`; };

/** Adds the assessment's feeders to `boardId` (a main board), or to a new MDB
 * (with the assessment's transformer) when it is undefined. Feeders made
 * earlier by this command on that board are replaced; your own are kept. */
export function createMdbFromAssessment(project: Project, a: LoadAssessment, boardId?: string): LaMdbResult {
  let p = project;
  let id = boardId && p.boards.some((b) => b.id === boardId) ? boardId : undefined;
  const created = !id;
  if (!id) {
    id = nextMdbId(p);
    const kva = assess(a).tx?.kva;
    const board: Board = withTransformer({ id, name: 'Main Distribution Board', kind: 'MDB' }, kva, a.supply.voltage || p.voltageV);
    p = { ...p, boards: [...p.boards, board] };
  }
  const replaced = p.feeders.filter((f) => f.boardId === id && f.fromRoom?.startsWith('la:')).length;
  p = { ...p, feeders: p.feeders.filter((f) => !(f.boardId === id && f.fromRoom?.startsWith('la:'))) };
  let added = 0;
  for (const it of assessmentFeeders(a)) {
    let fid = `${id}-LA-${it.key.toUpperCase()}`;
    for (let n = 2; p.feeders.some((f) => f.id === fid); n++) fid = `${id}-LA-${it.key.toUpperCase()}-${n}`;
    const motor = it.loadType === 'motor' || it.loadType === 'fire-pump';
    const f: Feeder = {
      id: fid, boardId: id, name: it.label, loadKw: it.kw, demandFactor: it.demandFactor,
      powerFactor: it.loadType === 'lighting' ? 0.9 : 0.85, lengthM: 40, cableCsaMm2: 6, cores: 4, breakerRatingA: 32, breakerIcuKa: 25,
      loadType: it.loadType, essential: it.essential || undefined, localIsolator: motor || undefined,
      fromRoom: `la:${it.key}`
    };
    const tmp = { ...p, feeders: [...p.feeders, f] };
    p = { ...tmp, feeders: tmp.feeders.map((x) => (x.id === f.id ? applyRecommendation(f, recommend(tmp, f, 'optimise')) : x)) };
    added++;
  }
  return { project: p, boardId: id, created, added, replaced };
}
