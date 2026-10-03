import type { BoardKind, Project } from '../types';
import { BOARD_KINDS, LOAD_TYPES, PROJECT_STATUSES, settingsOf } from '../types';
import type { Status } from './electrical';
import type { CalcRun, StudyKey } from './runs';
import { STUDY_LABEL } from './runs';
import { boardsInSupplyOrder, boardTotals, loadTypeOf, systemSummary } from './summary';
import { boardDemandKva } from './sizing';
import { summarizeBuilding, dbChecks } from './building';
import { sizeGeneratorByBoards, sizeTransformers } from './txGen';
import { planPfc } from './pfc';
import { sizeRiser } from './busbar';
import { sizeUps } from './ups';
import { sizePv } from './solar';
import { fireRatingIssues } from '../model/cableTypes';
import { currentRevision } from '../model/revisions';
import type { MainView } from '../views';

/** Everything the project dashboard shows, from the design as it is: the
 * headline numbers, three breakdowns and a to-do list of what needs
 * attention (each item says where to fix it). */

export interface DashTransformer { boardId: string; kva: number; demandKva: number; loadingPct: number; limitPct: number; status: Status }
export interface DashBar { label: string; kw: number; pct: number }
export interface TodoItem {
  status: Status; // bad = must fix, warn = check
  text: string;
  go?: { view: MainView; boardId?: string; feederId?: string };
}

export interface Dashboard {
  /** Studies whose results are older than the inputs (the study counts are then from the last run). */
  stale: StudyKey[];
  runAt?: number;
  info: { name: string; owner?: string; plot?: string; area?: string; consultant?: string; status: string; revision?: string; engineer?: string; updatedBy?: string; updatedAt?: string };
  connectedKw: number;
  demandKw: number;
  demandKva: number;
  pf: number;
  transformers: DashTransformer[];
  transformerKva: number;
  substations: number;
  generators: { boardId: string; kva: number }[];
  generatorLoadingPct?: number;
  panels: { total: number; byKind: { kind: BoardKind; label: string; n: number }[] };
  area?: { gfaM2: number; floors: number; buildings: number; source: 'building' | 'forms' | 'space plan' };
  density?: { connected: number; demand: number };
  capacitorKvar: number;
  cableM: number;
  cableRuns: number;
  extras: string[]; // busway, UPS, PV…
  studies: { key: StudyKey; label: string; pass: number; check: number; fail: number }[];
  byType: DashBar[];
  perArea: { title: string; bars: DashBar[] };
  todo: TodoItem[];
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const tally = (xs: Status[]) => ({ pass: xs.filter((x) => x === 'ok').length, check: xs.filter((x) => x === 'warn').length, fail: xs.filter((x) => x === 'bad').length });

export function buildDashboard(project: Project, run?: CalcRun, stale: StudyKey[] = []): Dashboard {
  const sys = systemSummary(project);
  const s = settingsOf(project);
  const mains = boardsInSupplyOrder(project).filter((b) => !b.upstreamId);
  const rev = currentRevision(project);
  const info = project.info ?? {};

  // Transformers and substations.
  const transformers: DashTransformer[] = mains.filter((b) => b.sourceKva).map((b) => {
    const demandKva = boardDemandKva(project, b.id);
    const loadingPct = pct(demandKva, b.sourceKva!);
    return { boardId: b.id, kva: b.sourceKva!, demandKva, loadingPct, limitPct: s.transformerMaxLoadingPct, status: loadingPct > 100 ? 'bad' : loadingPct > s.transformerMaxLoadingPct ? 'warn' : 'ok' };
  });
  const substations = new Set(mains.map((b) => (b.substation || b.rmu || 'SUBSTATION-01').toUpperCase())).size;

  // Generators.
  const generators = project.boards.filter((b) => b.standby).map((b) => ({ boardId: b.id, kva: b.standby!.kva }));
  const gen = generators.length ? sizeGeneratorByBoards(project) : undefined;
  const genKva = generators.reduce((a, g) => a + g.kva, 0);

  // Panels by kind.
  const kindOf = (id: string) => project.boards.find((b) => b.id === id)?.kind ?? (project.boards.find((b) => b.id === id)?.upstreamId ? 'DB' : 'MDB');
  const byKind = BOARD_KINDS.map((k) => ({ kind: k.value, label: k.value, n: project.boards.filter((b) => kindOf(b.id) === k.value).length })).filter((k) => k.n);

  // Area: Building information, else the forms' built-up area, else the space plan.
  let area: Dashboard['area'];
  const bi = project.building;
  if (bi?.buildings.length) {
    const sums = bi.buildings.map((b) => summarizeBuilding(bi, b));
    const gfa = sums.reduce((a, x) => a + x.gfaM2, 0);
    if (gfa > 0) area = { gfaM2: gfa, floors: Math.max(...sums.map((x) => x.floors)), buildings: sums.length, source: 'building' };
  }
  if (!area && info.builtUpAreaM2) area = { gfaM2: info.builtUpAreaM2, floors: 0, buildings: 1, source: 'forms' };
  if (!area && project.spacePlan?.areas.length) {
    const a = project.spacePlan.areas.reduce((x, y) => x + (y.areaM2 ?? 0), 0);
    if (a > 0) area = { gfaM2: a, floors: 0, buildings: new Set(project.spacePlan.areas.map((x) => x.building)).size, source: 'space plan' };
  }

  // Quantities.
  const caps = project.feeders.filter((f) => f.kvar);
  const cabled = project.feeders.filter((f) => f.lengthM > 0 && f.cableCsaMm2 > 0);
  const cableM = cabled.reduce((a, f) => a + f.lengthM * (f.parallel ?? 1), 0);
  const extras: string[] = [];
  const risers = (project.busRisers ?? []).map((r) => sizeRiser(project, r));
  if (risers.length) extras.push(`${risers.length} busbar riser${risers.length > 1 ? 's' : ''}, ${Math.round(risers.reduce((a, r) => a + r.lengthM, 0))} m`);
  const ups = (project.upsSystems ?? []).map((u) => sizeUps(project, u).upsKva).filter((k): k is number => !!k);
  if (ups.length) extras.push(`UPS ${ups.map((k) => `${k} kVA`).join(' + ')}`);
  if (project.pv) { try { const pv = sizePv(project.pv, project.voltageV); if (pv.kwp) extras.push(`Solar PV ${pv.kwp.toFixed(1)} kWp`); } catch { /* incomplete PV data */ } }
  if (project.boards.some((b) => b.upsKva)) extras.push(`${project.boards.filter((b) => b.upsKva).length} UPS board(s)`);

  // Studies (last run).
  const studies: Dashboard['studies'] = run ? [
    { key: 'checks', label: 'Cables, breakers & voltage drop', ...tally(run.results.map((r) => r.status)) },
    { key: 'earthing', label: STUDY_LABEL.earthing, ...tally(run.earthing.map((r) => r.status)) },
    { key: 'protection', label: STUDY_LABEL.protection, ...tally(run.selectivity.map((r) => r.status)) }
  ] : [];

  // Load by type (demand), largest first.
  const typeKw = new Map<string, number>();
  for (const f of project.feeders) {
    if (f.feedsBoardId || f.generation || f.kvar) continue;
    const t = loadTypeOf(f);
    typeKw.set(t, (typeKw.get(t) ?? 0) + f.loadKw * f.demandFactor);
  }
  const typeTotal = [...typeKw.values()].reduce((a, b) => a + b, 0);
  const byType: DashBar[] = [...typeKw.entries()].filter(([, kw]) => kw > 0.05)
    .map(([t, kw]) => ({ label: LOAD_TYPES.find((x) => x.value === t)?.label ?? t, kw, pct: pct(kw, typeTotal) }))
    .sort((a, b) => b.kw - a.kw);

  // Load per level (Building information), else per board below the mains.
  let perArea: Dashboard['perArea'];
  const levelBars: DashBar[] = [];
  if (bi?.buildings.length) {
    for (const b of bi.buildings) {
      for (const l of summarizeBuilding(bi, b).levels) {
        if (l.demandKw > 0) levelBars.push({ label: `${bi.buildings.length > 1 ? `${b.name} · ` : ''}${l.level.name}${l.count > 1 ? ` (×${l.count})` : ''}`, kw: l.demandKw, pct: 0 });
      }
    }
  }
  if (levelBars.length) {
    const tot = levelBars.reduce((a, x) => a + x.kw, 0);
    perArea = { title: 'Load per level (Building information)', bars: levelBars.map((x) => ({ ...x, pct: pct(x.kw, tot) })) };
  } else {
    const subs = project.boards.filter((b) => b.upstreamId && mains.some((m) => m.id === b.upstreamId));
    const bars = subs.map((b) => ({ label: b.id, kw: boardTotals(project, b.id).demandKw, pct: 0 }));
    const tot = bars.reduce((a, x) => a + x.kw, 0);
    perArea = { title: 'Load per sub-main board', bars: bars.map((x) => ({ ...x, pct: pct(x.kw, tot) })).sort((a, b) => b.kw - a.kw) };
  }

  // To do.
  const todo: TodoItem[] = [];
  if (stale.length) todo.push({ status: 'warn', text: `Results out of date (${stale.map((k) => STUDY_LABEL[k]).join(', ')}) — press Run (F5)` });
  if (run) {
    const fails = run.results.filter((r) => r.status === 'bad');
    if (fails.length) todo.push({ status: 'bad', text: `${fails.length} circuit${fails.length > 1 ? 's' : ''} fail cable / breaker / voltage drop (${fails.slice(0, 3).map((r) => r.feeder.id).join(', ')}${fails.length > 3 ? '…' : ''})`, go: { view: 'selection' } });
    const ef = run.earthing.filter((r) => r.status === 'bad');
    if (ef.length) todo.push({ status: 'bad', text: `${ef.length} circuit${ef.length > 1 ? 's' : ''} fail earth fault disconnection`, go: { view: 'earthing' } });
    const sf = run.selectivity.filter((r) => r.status === 'bad');
    if (sf.length) todo.push({ status: 'warn', text: `${sf.length} breaker pair${sf.length > 1 ? 's are' : ' is'} not selective`, go: { view: 'coordination' } });
    const fw = run.results.filter((r) => r.status === 'warn');
    if (fw.length) todo.push({ status: 'warn', text: `${fw.length} circuit${fw.length > 1 ? 's' : ''} to check — close to a cable, breaker or voltage-drop limit`, go: { view: 'selection' } });
    const ew = run.earthing.filter((r) => r.status === 'warn');
    if (ew.length) todo.push({ status: 'warn', text: `${ew.length} earth fault loop${ew.length > 1 ? 's' : ''} to check`, go: { view: 'earthing' } });
    const sw = run.selectivity.filter((r) => r.status === 'warn');
    if (sw.length) todo.push({ status: 'warn', text: `${sw.length} breaker pair${sw.length > 1 ? 's' : ''} only partly selective`, go: { view: 'coordination' } });
  }
  for (const f of fireRatingIssues(project)) todo.push({ status: 'bad', text: `${f.id} (${f.name}) is life safety but not on fire-rated cable`, go: { view: 'design', feederId: f.id } });
  for (const t of transformers) if (t.status !== 'ok') todo.push({ status: t.status, text: `${t.boardId} transformer ${t.loadingPct.toFixed(0)} % loaded (limit ${t.limitPct} %)`, go: { view: 'sizing' } });
  for (const r of sizeTransformers(project)) if (r.checks?.icuOk === false) todo.push({ status: 'bad', text: `${r.board.id}: a breaker's Icu (${r.checks.minIcuKa} kA) is below the ${r.checks.faultKa.toFixed(1)} kA fault level`, go: { view: 'sizing' } });
  if (gen && gen.demandKw > 0 && gen.recommendedKva === undefined) todo.push({ status: 'bad', text: `Standby generator: ${Math.max(gen.runningDesignKva, gen.startDesignKva).toFixed(0)} kVA needed — above the largest standard set`, go: { view: 'sizing' } });
  if (gen?.recommendedKva && genKva && genKva < gen.recommendedKva) todo.push({ status: 'bad', text: `Standby generator ${genKva} kVA — ${gen.recommendedKva} kVA needed`, go: { view: 'sizing' } });
  const pfc = planPfc(project);
  for (const m of pfc.mains) if (m.pfBefore < pfc.pfTarget - 1e-6 && m.existingKvar === 0) todo.push({ status: 'warn', text: `${m.boardId} PF ${m.pfBefore.toFixed(2)} — no capacitor bank yet (${m.plannedKvar} kvar planned)`, go: { view: 'pfc' } });
  for (const c of dbChecks(project)) if (c.status === 'warn' && c.ratio !== undefined) todo.push({ status: 'warn', text: `${c.boardId} designed for ${(c.ratio * 100).toFixed(0)} % of its rooms’ expected load`, go: { view: 'load-schedule', boardId: c.boardId } });
  for (const r of risers) if (!r.type || r.icwOk === false) todo.push({ status: 'bad', text: `${r.riser.name}: ${!r.type ? 'above the busway data' : 'Icw below the fault level'}`, go: { view: 'busbar' } });
  const missing = [['owner', info.owner], ['plot no.', info.plotNo], ['consultant', info.consultant], ['area', info.area]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) todo.push({ status: 'warn', text: `Submission forms: ${missing.join(', ')} not filled in (Project settings)` });

  return {
    info: {
      name: project.name, owner: info.owner, plot: info.plotNo, area: info.area, consultant: info.consultant,
      status: PROJECT_STATUSES.find((x) => x.value === (project.status ?? 'design'))!.label,
      revision: rev ? `Rev ${rev.id} (${rev.date})` : undefined,
      engineer: project.drawing?.drawnBy ?? project.createdBy, updatedBy: project.updatedBy, updatedAt: project.updatedAt
    },
    connectedKw: sys.connectedKw, demandKw: sys.demandKw, demandKva: sys.demandKva, pf: sys.powerFactor,
    transformers, transformerKva: sys.transformerKva, substations,
    generators, generatorLoadingPct: gen && genKva ? pct(gen.demandKva, genKva) : undefined,
    panels: { total: project.boards.length, byKind },
    area, density: area ? { connected: (sys.connectedKw * 1000) / area.gfaM2, demand: (sys.demandKw * 1000) / area.gfaM2 } : undefined,
    capacitorKvar: caps.reduce((a, f) => a + (f.kvar ?? 0), 0),
    cableM, cableRuns: cabled.length, extras,
    studies, byType, perArea, stale, runAt: run?.at,
    todo: todo.sort((a, b) => (a.status === b.status ? 0 : a.status === 'bad' ? -1 : 1))
  };
}

/** "850 m" below 10 km, else "12.4 km". */
export const lengthText = (m: number) => (m < 10000 ? `${Math.round(m).toLocaleString('en-US')} m` : `${(m / 1000).toFixed(1)} km`);

/** "2 × 1500 kVA + 1 × 1000 kVA" */
export function sizesText(kvas: number[]): string {
  const m = new Map<number, number>();
  for (const k of kvas) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([k, n]) => `${n} × ${k} kVA`).join(' + ');
}
