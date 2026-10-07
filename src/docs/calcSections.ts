import type { FeederResult, Status } from '../calc/electrical';
import { cableSizeText } from '../calc/electrical';
import { breakerTypeOf } from '../calc/earthing';
import { REPORT_STATUS_TEXT, STATUS_TEXT } from '../calc/statusText';
import { boardSummary } from '../calc/summary';
import { sizeGeneratorByBoards, sizeTransformers, txGenPlanOf } from '../calc/txGen';
import { settingsOf, type Feeder } from '../types';
import type { CalcData, Cell, Scope, Section } from './studyReport';

/** The standard layout of every calculation section of the design report:
 *   INPUT → DESIGN CRITERIA → METHOD → RESULT → SELECTION → VERIFICATION → STATUS
 * built only from existing calculation results (no formula lives here). The
 * main report keeps Requirement → Result → Selection → Verification; long
 * per-circuit tables are marked `appendix` and printed at the end. */

const S = (s: Status): Cell => ({ v: STATUS_TEXT[s], s });
const NC: Cell = { v: REPORT_STATUS_TEXT.nc, s: 'nc' };
const n = (v: number, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)) : '—');
const worst = (xs: Status[]): Status => (xs.includes('bad') ? 'bad' : xs.includes('warn') ? 'warn' : 'ok');
const counts = (xs: Status[]) => `${xs.filter((x) => x === 'ok').length} / ${xs.filter((x) => x === 'warn').length} / ${xs.filter((x) => x === 'bad').length}`;

const sourceText = (data: CalcData, scope: Scope) => scope.roots.map((b) => {
  const m = data.project.boards.find((x) => x.id === b.id)!;
  return m.upstreamId ? `${m.id}: fed from ${m.upstreamId}` : m.sourceKva ? `${m.id}: transformer ${m.sourceKva} kVA, ${m.sourceImpedancePct ?? '—'} % Z` : m.supply ? `${m.id}: ${m.supply.fedFrom ?? 'authority'} supply${m.supply.faultKa ? `, ${m.supply.faultKa} kA` : ''}` : `${m.id}: supply not defined`;
}).join('; ');

/** A circuit's cable check: overload protection, ampacity, voltage drop and breaking capacity. */
export const cableStatus = (r: FeederResult): Status => worst([r.protectionStatus, r.ampacityStatus, r.vdStatus, r.icuStatus]);

/** Moves the named tables to the appendix. */
const toAppendix = (s: Section, titles: (string | undefined)[]) => s.tables.forEach((t) => { if (titles.some((x) => x && t.title?.startsWith(x))) t.appendix = true; });

/** Adds the standard structure to a section built by studyReport.buildSection. */
export function structureSection(s: Section, data: CalcData, scope: Scope): Section {
  const p = data.project;
  const byId = new Map(data.results.map((r) => [r.feeder.id, r]));
  const circuits = [...scope.incomers, ...scope.feeders];
  const res = (fs: Feeder[]) => fs.map((f) => byId.get(f.id)).filter((r): r is FeederResult => !!r);
  const onBoard = (rs: FeederResult[], id: string) => rs.filter((r) => r.feeder.boardId === id);

  switch (s.key) {
    case 'sc': {
      const rs = res([...circuits, ...scope.finals]);
      s.inputs = [['Supply', sourceText(data, scope)], ['System', `${p.voltageV} V, ${p.frequencyHz} Hz`]];
      s.criteria = [['Voltage factor', 'c = 1.0 (maximum fault)'], ['Breaking capacity', 'Breaker Icu ≥ prospective fault at its terminals (Ik″)']];
      // The governing breaker is the one with the smallest Icu ÷ Ik″: its own Icu, fault and margin are shown together.
      s.verification = { title: 'Breaking capacity at each busbar', headers: ['Location', 'Ik″ busbar (kA)', 'Governing circuit', 'Ik″ at breaker (kA)', 'Icu (kA)', 'Margin (kA)', 'Breakers pass / check / fail', 'Status'],
        rows: scope.boards.map((b) => {
          const here = onBoard(rs, b.id), fk = boardSummary(p, b).faultKA;
          if (!here.length) return [b.id, n(fk, 1), '—', '—', '—', '—', '—', '—'];
          const g = here.reduce((a, r) => (r.feeder.breakerIcuKa / r.breakerFaultKA < a.feeder.breakerIcuKa / a.breakerFaultKA ? r : a)), st = here.map((r) => r.icuStatus);
          return [b.id, n(fk, 1), g.feeder.id, n(g.breakerFaultKA, 1), g.feeder.breakerIcuKa, n(g.feeder.breakerIcuKa - g.breakerFaultKA, 1), counts(st), S(worst(st))];
        }) };
      toAppendix(s, ['Breaker breaking capacity', 'Fault at the end of each cable']);
      break;
    }
    case 'lf': {
      const rs = res(circuits);
      s.inputs = [['Supply', sourceText(data, scope)], ['Loads', 'Design loads × demand factors (load schedules and feeders)']];
      s.criteria = [['Voltage drop limit (source to load)', `${p.vdLimitPct} %`], ...(p.vdTempC !== undefined ? [['Conductor temperature', `${p.vdTempC} °C`] as [string, string]] : [])];
      s.verification = { title: 'Voltage drop — worst circuit on each board', headers: ['Board', 'Circuit', 'Calculated ΔV total (%)', 'Allowable (%)', 'Margin (%)', 'Status'],
        rows: scope.boards.flatMap((b) => {
          const here = onBoard(rs, b.id);
          if (!here.length) return [];
          const w = here.reduce((a, r) => (r.vdTotalPct > a.vdTotalPct ? r : a));
          return [[b.id, w.feeder.id, n(w.vdTotalPct, 2), p.vdLimitPct, n(p.vdLimitPct - w.vdTotalPct, 2), S(worst(here.map((r) => r.vdStatus)))]];
        }) };
      toAppendix(s, ['Feeders']);
      break;
    }
    case 'cable': {
      const rs = res([...circuits, ...scope.finals]);
      s.inputs = [['Cable', 'Cu / XLPE multicore, reference installation in free air'], ['Ambient temperature', `${p.ambientC} °C`], ['Grouping', 'From the cable tray route, else the circuit\'s own parallel runs']];
      s.criteria = [['Overload protection', 'Ib ≤ In ≤ Iz (IEC 60364-4-43)'], ['Voltage drop limit', `${p.vdLimitPct} %`], ['Breaking capacity', 'Icu ≥ Ik″ at the breaker']];
      // Major feeders: those supplying a board (the full list is in the appendix).
      s.cards = res(circuits.filter((f) => f.feedsBoardId)).map((r) => ({
        title: `Feeder: ${r.feeder.boardId} → ${r.feeder.feedsBoardId}`,
        rows: [
          ['Design current (Ib)', `${n(r.ib, 0)} A`], ['Protective device (In)', `${r.feeder.breakerRatingA} A ${breakerTypeOf(r.feeder)}`],
          ['Selected cable', cableSizeText(r.feeder)], ['Derated capacity (Iz)', `${n(r.ampacity, 0)} A`],
          ['Ib ≤ In ≤ Iz', S(r.protectionStatus)], ['Voltage drop (total)', `${n(r.vdTotalPct, 2)} % (limit ${p.vdLimitPct} %)`],
          ['Breaking capacity check', S(r.icuStatus)], ['Overall status', S(cableStatus(r))]
        ]
      }));
      s.verification = { title: 'Circuits on each board', headers: ['Board', 'Circuits', 'Pass / check / fail', 'Status'],
        rows: scope.boards.flatMap((b) => { const here = onBoard(rs, b.id).map(cableStatus); return here.length ? [[b.id, here.length, counts(here), S(worst(here))]] : []; }) };
      toAppendix(s, ['Cables and breakers']);
      break;
    }
    case 'earth': {
      const want = new Set([...circuits, ...scope.finals].map((f) => f.id));
      const es = data.earthing.filter((e) => want.has(e.feeder.id));
      s.inputs = [['Earthing arrangement', 'TN-S'], ['Supply loop (Ze)', 'From the source impedance to each board']];
      s.criteria = [['Disconnection time', `IEC 60364-4-41 Table 41.1: 0.4 s final circuits, 5 s distribution circuits${p.strictFinalDisconnection ? '; project rule: 0.4 s for every final circuit ≤ 63 A' : ''}`],
        ['Fault current', 'Minimum, c = 0.95'], ['Protective conductor', 'Adiabatic, k = 143']];
      s.verification = { title: 'Earth fault loop on each board', headers: ['Board', 'Circuits', 'Highest Zs ÷ max Zs', 'Pass / check / fail', 'Status'],
        rows: scope.boards.flatMap((b) => {
          const here = es.filter((e) => e.feeder.boardId === b.id);
          if (!here.length) return [];
          const st = here.map((e) => e.status);
          return [[b.id, here.length, `${n(Math.max(...here.map((e) => e.zsOhm / e.maxZsOhm)) * 100, 0)} %`, counts(st), S(worst(st))]];
        }) };
      toAppendix(s, ['Earth fault loop']);
      break;
    }
    case 'disc':
      s.criteria = [['Overload selectivity', 'In upstream ÷ In downstream ≥ 1.6'], ['Short-circuit selectivity', 'Fault at the downstream breaker below the upstream magnetic threshold']];
      break;
    case 'sizing': {
      const set = settingsOf(p), plan = txGenPlanOf(p);
      const tx = sizeTransformers(p, plan).filter((r) => scope.ids.has(r.board.id));
      const gen = sizeGeneratorByBoards(p, plan);
      s.criteria = [['Future growth', `${set.futureGrowthPct} %`], ['Transformer design loading', `≤ ${set.transformerMaxLoadingPct} %`], ['Generator design loading', `≤ ${set.generatorMaxLoadingPct} %`]];
      const rows: Cell[][] = tx.map((r) => [`Transformer ${r.board.id}`, n(r.demandKva, 0), n(r.designKva, 0), r.recommendedKva ? `${r.recommendedKva} kVA` : '—',
        r.installedKva ?? '—', r.loadingPct !== undefined ? `${n(r.loadingPct, 0)} %` : '—', r.installedKva ? n(r.installedKva - r.demandKva, 0) : '—',
        r.adequate === false || !r.recommendedKva ? S('bad') : r.installedKva ? S('ok') : NC]);
      if (gen.demandKw > 0 || gen.recommendedKva) rows.push(['Standby generator', n(gen.demandKva, 0), n(Math.max(gen.runningDesignKva, gen.startDesignKva), 0), gen.recommendedKva ? `${gen.recommendedKva} kVA` : '—',
        gen.installedKva ?? '—', gen.installedKva ? `${n((gen.demandKva / gen.installedKva) * 100, 0)} %` : '—', gen.installedKva ? n(gen.installedKva - gen.demandKva, 0) : '—',
        gen.installedOk === false || !gen.recommendedKva ? S('bad') : gen.installedKva ? S('ok') : NC]);
      s.verification = { title: 'Capacity verification', headers: ['Equipment', 'Calculated demand (kVA)', 'Required capacity (kVA)', 'Selected', 'Installed (kVA)', 'Loading', 'Spare (kVA)', 'Status'], rows };
      toAppendix(s, ['Standby generator — loads']);
      break;
    }
    case 'schedules':
      s.tables.forEach((t) => { t.appendix = t.title === 'Cable schedule' ? 'cable' : 'load'; });
      break;
  }
  return s;
}

/** Load assessment: connected load → demand → maximum demand → design capacity, per board, from the load flow results. */
export function loadSection(data: CalcData, scope: Scope, title: string): Section {
  const p = data.project, set = settingsOf(p);
  const sums = scope.boards.map((b) => boardSummary(p, b));
  const tx = sizeTransformers(p, txGenPlanOf(p)).filter((r) => scope.ids.has(r.board.id));
  const roots = sums.filter((s) => scope.roots.includes(s.board));
  const conn = roots.reduce((a, s) => a + s.connectedKw, 0), dem = roots.reduce((a, s) => a + s.demandKw, 0);
  return {
    key: 'load', title, statuses: [],
    inputs: [['Loads', 'Connected loads on the feeders and DB load schedules'], ['Demand factors', 'Per load / circuit as entered']],
    criteria: [['Future growth allowance', `${set.futureGrowthPct} %${p.studySettings?.futureGrowthPct === undefined ? ' (app default)' : ''}`], ['Transformer design loading', `${set.transformerMaxLoadingPct} %`]],
    method: ['Demand = connected load × demand factor for each load, summed up the network (kW and kvar separately); maximum demand kVA = √(kW² + kvar²).',
      'Required capacity = maximum demand × (1 + growth) ÷ design loading, from the transformer sizing (no further diversity applied).'],
    summary: [{ label: 'Connected load', value: `${n(conn, 0)} kW` }, { label: 'Maximum demand', value: `${n(dem, 0)} kW` }, { label: 'Demand ÷ connected', value: conn > 0 ? String(n(dem / conn, 2)) : '—' }],
    tables: [
      { title: 'Load at each board', headers: ['Board', 'Connected (kW)', 'Demand (kW)', 'Demand ÷ connected', 'Demand (kVA)', 'PF', 'Current (A)'],
        rows: sums.map((s) => [s.board.id, n(s.connectedKw, 1), n(s.demandKw, 1), s.connectedKw > 0 ? n(s.demandKw / s.connectedKw, 2) : '—', n(s.demandKva, 1), n(s.powerFactor, 2), n(s.currentA, 0)]) },
      ...(tx.length ? [{ title: 'Design load of each main board', headers: ['Main board', 'Maximum demand (kVA)', 'Future growth', 'Required capacity (kVA)'],
        rows: tx.map((r) => [r.board.id, n(r.demandKva, 0), `${set.futureGrowthPct} %`, n(r.designKva, 0)]) }] : [])
    ]
  };
}

/** LV distribution: the boards, their bus ratings and loading, and the major feeders between them. */
export function distributionSection(data: CalcData, scope: Scope, title: string): Section {
  const p = data.project;
  const byId = new Map(data.results.map((r) => [r.feeder.id, r]));
  const sums = scope.boards.map((b) => boardSummary(p, b));
  const major = [...scope.incomers, ...scope.feeders].filter((f) => f.feedsBoardId).map((f) => byId.get(f.id)).filter((r): r is FeederResult => !!r);
  const statuses = [...sums.map((s) => s.loadingStatus).filter((x): x is Status => !!x), ...major.map((r) => worst([r.protectionStatus, r.ampacityStatus]))];
  return {
    key: 'dist', title, statuses,
    inputs: [['Supply', sourceText(data, scope)]],
    criteria: [['Board loading', 'Demand current ≤ busbar / main device rating'], ['Feeders', 'Ib ≤ In ≤ Iz']],
    method: ['Board demand from the load flow; loading = demand current ÷ the board\'s rated current (when entered).'],
    summary: [{ label: 'Boards', value: String(sums.length) }, { label: 'Major feeders', value: String(major.length) }, ...(statuses.length ? [{ label: 'Checks', value: counts(statuses) + ' (pass / check / fail)', status: worst(statuses) }] : [])],
    tables: [
      { title: 'Distribution boards', headers: ['Board', 'Type', 'Fed from', 'Bus rating (A)', 'Demand (A)', 'Loading', 'Ik″ (kA)'],
        rows: sums.map((s) => [s.board.id, s.board.kind ?? (s.board.upstreamId ? 'DB' : 'MDB'), s.board.upstreamId ?? 'Supply', s.board.ratedCurrentA ?? 'Not defined', n(s.currentA, 0),
          s.loadingPct === undefined ? '—' : { v: `${n(s.loadingPct, 0)} %`, s: s.loadingStatus ?? 'ok' }, n(s.faultKA, 1)]) },
      { title: 'Major feeders', headers: ['From', 'To', 'Breaker', 'Cable', 'Ib (A)', 'Iz (A)', 'Status'],
        rows: major.map((r) => [r.feeder.boardId, r.feeder.feedsBoardId!, `${r.feeder.breakerRatingA} A ${breakerTypeOf(r.feeder)}`, cableSizeText(r.feeder), n(r.ib, 0), n(r.ampacity, 0), S(worst([r.protectionStatus, r.ampacityStatus]))]) }
    ]
  };
}
