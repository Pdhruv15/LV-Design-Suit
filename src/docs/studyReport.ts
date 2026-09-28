import ExcelJS from 'exceljs';
import type { FeederResult, Status } from '../calc/electrical';
import { cableSizeText } from '../calc/electrical';
import type { EarthingResult } from '../calc/earthing';
import { breakerTypeOf, cpcOf } from '../calc/earthing';
import type { SelectivityResult } from '../calc/protection';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { boardSummary, boardsInSupplyOrder } from '../calc/summary';
import { generatorForBoard, settingsOf, sizePfc, STANDARD_TRANSFORMER_KVA } from '../calc/sizing';
import type { ResultLayers } from '../diagram/annotations';
import type { ColorBy } from '../diagram/heatmap';
import { currentRevision } from '../model/revisions';
import type { Board, Feeder, Project, StudyReportKind, StudyReportSetup } from '../types';
import { esc, REPORT_CSS } from './report';
import { cableTypeOf, fireRatingIssues } from '../model/cableTypes';
import { cableSchedule, dbSchedule } from './schedules';

/** Submission reports for chosen studies on a chosen part of the network:
 * e.g. only the short circuit study, only for MDB-3 and what it feeds.
 * Calculations always run on the whole network (a board's fault level and
 * voltage depend on everything upstream of it); the report only shows the
 * boards and circuits in scope, with an SLD of just that part. */

export interface StudyInfo {
  key: StudyReportKind;
  label: string;
  title: string; // report heading
  description: string;
  /** Result labels and colouring on the study's SLD (none = no SLD). */
  sld?: { layers: ResultLayers; colorBy: ColorBy; note: string };
}

const NO_LAYERS: ResultLayers = { current: false, voltage: false, vd: false, fault: false, pf: false, loading: false };

export const STUDIES: StudyInfo[] = [
  { key: 'sc', label: 'Short circuit', title: 'Short circuit study', description: 'Fault levels at every busbar, breaking capacity of every breaker, fault at the cable ends',
    sld: { layers: { ...NO_LAYERS, fault: true }, colorBy: 'fault', note: 'Ik″ = prospective 3-phase fault current; colour = fault at the breaker ÷ its breaking capacity' } },
  { key: 'lf', label: 'Load flow & voltage drop', title: 'Load flow and voltage drop study', description: 'Busbar demand, current, power factor and voltage; feeder current and voltage drop from the source',
    sld: { layers: { ...NO_LAYERS, current: true, voltage: true, vd: true }, colorBy: 'vd', note: 'Current, busbar voltage and total voltage drop; colour = voltage drop ÷ limit' } },
  { key: 'cable', label: 'Cable & breaker sizing', title: 'Cable and breaker sizing', description: 'Ib ≤ In ≤ Iz with ambient and grouping derating, voltage drop',
    sld: { layers: { ...NO_LAYERS, current: true, loading: true }, colorBy: 'utilisation', note: 'Current and breaker loading; colour = design current ÷ cable rating' } },
  { key: 'earth', label: 'Earth fault loop', title: 'Earth fault loop impedance and disconnection', description: 'Zs, earth fault current, disconnection time and protective conductor size',
    sld: { layers: NO_LAYERS, colorBy: 'earth', note: 'Zs against the largest Zs that disconnects in time' } },
  { key: 'disc', label: 'Discrimination', title: 'Protection discrimination study', description: 'Selectivity between each breaker and the one above it', sld: undefined },
  { key: 'sizing', label: 'Transformer, generator & PF', title: 'Transformer, generator and power factor correction', description: 'Transformer and generator sizing and capacitor banks for the main boards in scope', sld: undefined },
  { key: 'schedules', label: 'DB & cable schedules', title: 'DB and cable schedules', description: 'Panel schedule of each board and the cable schedule, for the boards in scope', sld: undefined }
];
export const studyInfo = (k: StudyReportKind) => STUDIES.find((s) => s.key === k)!;

export const DEFAULT_SETUP: StudyReportSetup = { boards: [], downstream: true, studies: ['sc'], sld: true, separate: false };
export const setupOf = (p: Project): StudyReportSetup => ({ ...DEFAULT_SETUP, ...p.studyReport });

// ---- Scope -----------------------------------------------------------------

export interface Scope {
  /** Boards in the report, in supply order. */
  boards: Board[];
  ids: Set<string>;
  /** Top boards of the scope (their supply is outside it, or they're mains). */
  roots: Board[];
  /** Outgoing circuits of the boards in scope (without load schedule circuits). */
  feeders: Feeder[];
  /** Final circuits of the DBs in scope (load schedules). */
  finals: Feeder[];
  /** Cables feeding the scope's top boards from outside it. */
  incomers: Feeder[];
  all: boolean;
}

export function scopeOf(project: Project, setup: Pick<StudyReportSetup, 'boards' | 'downstream'>): Scope {
  const known = new Set(project.boards.map((b) => b.id));
  const chosen = setup.boards.filter((id) => known.has(id));
  const ids = new Set<string>(chosen.length ? chosen : project.boards.map((b) => b.id));
  if (setup.downstream) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const b of project.boards) if (b.upstreamId && ids.has(b.upstreamId) && !ids.has(b.id)) { ids.add(b.id); grew = true; }
    }
  }
  const boards = boardsInSupplyOrder(project).filter((b) => ids.has(b.id));
  const roots = boards.filter((b) => !b.upstreamId || !ids.has(b.upstreamId));
  const inScope = project.feeders.filter((f) => ids.has(f.boardId));
  return {
    boards, ids, roots,
    feeders: inScope.filter((f) => !isScheduleCircuit(f)),
    finals: inScope.filter(isScheduleCircuit),
    incomers: roots.map((r) => project.feeders.find((f) => f.feedsBoardId === r.id && f.boardId === r.upstreamId)).filter((f): f is Feeder => !!f),
    all: ids.size === project.boards.length
  };
}

/** The part of the network drawn on a scoped SLD: the boards in scope and
 * their circuits. Top boards keep their upstream reference, so the drawing
 * shows what feeds them. */
export function drawingProject(project: Project, scope: Scope): Project {
  return { ...project, boards: project.boards.filter((b) => scope.ids.has(b.id)), feeders: project.feeders.filter((f) => scope.ids.has(f.boardId)), ties: (project.ties ?? []).filter((t) => scope.ids.has(t.a) && scope.ids.has(t.b)) };
}

export function scopeText(project: Project, scope: Scope): string {
  if (scope.all) return `Whole installation (${scope.boards.length} boards)`;
  const below = scope.boards.filter((b) => !scope.roots.includes(b)).map((b) => b.id);
  return `${scope.roots.map((b) => b.id).join(', ')}${below.length ? ` and downstream: ${below.join(', ')}` : ''}`;
}

// ---- Sections ----------------------------------------------------------------

type Cell = string | number | { v: string | number; s: Status };
export interface Table { title?: string; headers: string[]; rows: Cell[][]; }
export interface Section {
  key: StudyReportKind;
  title: string;
  method: string[];
  summary: { label: string; value: string; status?: Status }[];
  tables: Table[];
  statuses: Status[];
}

export interface CalcData {
  project: Project; // the calculated project (last run)
  results: FeederResult[];
  earthing: EarthingResult[];
  selectivity: SelectivityResult[];
}

const LABEL: Record<Status, string> = { ok: 'Pass', warn: 'Check', bad: 'Fail' };
const S = (s: Status): Cell => ({ v: LABEL[s], s });
const n = (v: number, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)) : '—');
const worst = (xs: Status[]): Status => (xs.includes('bad') ? 'bad' : xs.includes('warn') ? 'warn' : 'ok');
const tally = (xs: Status[]) => `${xs.filter((x) => x === 'ok').length} pass · ${xs.filter((x) => x === 'warn').length} check · ${xs.filter((x) => x === 'bad').length} fail`;

export function buildSection(key: StudyReportKind, data: CalcData, scope: Scope): Section {
  const p = data.project;
  const byId = new Map(data.results.map((r) => [r.feeder.id, r]));
  const res = (fs: Feeder[]) => fs.map((f) => byId.get(f.id)).filter((r): r is FeederResult => !!r);
  const circuits = [...scope.incomers, ...scope.feeders];
  const to = (f: Feeder) => f.feedsBoardId ?? f.name;
  const tag = (f: Feeder) => (scope.incomers.includes(f) ? `${f.id} (incomer)` : f.id);
  const info = studyInfo(key);

  if (key === 'sc') {
    const sums = scope.boards.map((b) => boardSummary(p, b));
    const rs = res(circuits);
    const statuses = rs.map((r) => r.icuStatus);
    return {
      key, title: info.title, statuses,
      method: [
        'Prospective symmetrical 3-phase fault current per IEC 60909 (simplified): voltage factor c = 1.0 (maximum), upstream MV network infinite.',
        'Source impedance from the transformer rating and %Z (split by its X/R ratio); cable R at operating temperature (1.2 × R20) and X per km; parallel runs divide the impedance.',
        'Breaking capacity check: the fault at the breaker terminals (supply busbar) must not exceed the breaker Icu. Fault at the cable end: 3-phase for 3/4-core circuits, line-to-neutral for 2-core.',
        'Motor contribution and generation are neglected.'
      ],
      summary: [
        { label: 'Highest busbar fault', value: sums.length ? `${Math.max(...sums.map((s) => s.faultKA)).toFixed(1)} kA` : '—' },
        { label: 'Breakers checked', value: tally(statuses), status: worst(statuses) }
      ],
      tables: [
        { title: 'Fault levels at the busbars', headers: ['Board', 'Type', 'Fed from', 'Busbar rating (A)', 'Ik″ max (kA)'],
          rows: sums.map((s) => [s.board.id, s.board.kind ?? (s.board.upstreamId ? 'DB' : 'MDB'), s.board.upstreamId ?? (s.board.sourceKva ? `Transformer ${s.board.sourceKva} kVA, ${s.board.sourceImpedancePct ?? '—'} % Z` : 'Authority supply'), s.board.ratedCurrentA ?? '—', n(s.faultKA, 1)]) },
        { title: 'Breaker breaking capacity', headers: ['Circuit', 'Board', 'To', 'Breaker', 'Ik″ at breaker (kA)', 'Icu (kA)', 'Margin', 'Result'],
          rows: rs.map((r) => [tag(r.feeder), r.feeder.boardId, to(r.feeder), `${r.feeder.breakerRatingA} A ${breakerTypeOf(r.feeder)}`, n(r.breakerFaultKA, 1), r.feeder.breakerIcuKa, `${n((r.feeder.breakerIcuKa / r.breakerFaultKA - 1) * 100, 0)} %`, S(r.icuStatus)]) },
        { title: 'Fault at the end of each cable', headers: ['Circuit', 'From', 'To', 'Cable', 'Length (m)', 'Ik at cable end (kA)'],
          rows: rs.map((r) => [tag(r.feeder), r.feeder.boardId, to(r.feeder), cableSizeText(r.feeder), r.feeder.lengthM, n(r.endFaultKA, 2)]) }
      ]
    };
  }

  if (key === 'lf') {
    const sums = scope.boards.map((b) => boardSummary(p, b));
    const rs = res(circuits);
    const statuses = [...rs.map((r) => r.vdStatus), ...sums.map((s) => s.loadingStatus).filter((x): x is Status => !!x)];
    return {
      key, title: info.title, statuses,
      method: [
        'Balanced 3-phase load flow from the design loads: demand = connected load × demand factor, summed up the network (kW and kVAr separately).',
        `Voltage drop per cable: √3 · I · L · (R cosφ + X sinφ) for 3-phase, 2 · I · L · (…) for single-phase; busbar voltage = nominal minus the drops of the incomers above it. Limit ${p.vdLimitPct} % from the main board to the load.`,
        'Transformer regulation is not included (busbar voltages are measured from the main LV busbar).'
      ],
      summary: [
        { label: 'Total demand of the scope', value: `${n(scope.roots.reduce((a, b) => a + boardSummary(p, b).demandKw, 0), 0)} kW · ${n(scope.roots.reduce((a, b) => a + boardSummary(p, b).demandKva, 0), 0)} kVA` },
        { label: 'Lowest busbar voltage', value: sums.length ? `${Math.min(...sums.map((s) => s.voltagePct)).toFixed(2)} %` : '—' },
        { label: 'Circuits checked', value: tally(rs.map((r) => r.vdStatus)), status: worst(statuses) }
      ],
      tables: [
        { title: 'Busbars', headers: ['Board', 'Connected (kW)', 'Demand (kW)', 'Demand (kVA)', 'PF', 'Current (A)', 'Rating (A)', 'Loading', 'Voltage (V)', '% of nominal'],
          rows: sums.map((s) => [s.board.id, n(s.connectedKw, 1), n(s.demandKw, 1), n(s.demandKva, 1), n(s.powerFactor, 2), n(s.currentA, 0), s.board.ratedCurrentA ?? '—', s.loadingPct === undefined ? '—' : { v: `${n(s.loadingPct, 0)} %`, s: s.loadingStatus ?? 'ok' }, n(s.voltageV, 1), n(s.voltagePct, 2)]) },
        { title: 'Feeders', headers: ['Circuit', 'From', 'To', 'Cable', 'Length (m)', 'Ib (A)', 'PF', 'ΔV cable (%)', 'ΔV total (%)', 'Result'],
          rows: rs.map((r) => [tag(r.feeder), r.feeder.boardId, to(r.feeder), cableSizeText(r.feeder), r.feeder.lengthM, n(r.ib, 1), r.feeder.feedsBoardId ? '—' : n(r.feeder.powerFactor, 2), n(r.vdPct, 2), n(r.vdTotalPct, 2), S(r.vdStatus)]) }
      ]
    };
  }

  if (key === 'cable') {
    const rs = res([...circuits, ...scope.finals]);
    const statuses = rs.map((r) => worst([r.protectionStatus, r.ampacityStatus, r.vdStatus]));
    return {
      key, title: info.title, statuses,
      method: [
        'Cu/XLPE/SWA multicore cable, reference rating in free air; derated for the ambient temperature and for grouping (the cable tray the cable runs on, else its own parallel runs).',
        'Overload protection per IEC 60364-4-43: Ib ≤ In ≤ Iz. Voltage drop from the main board to the load within the limit.'
      ],
      summary: [
        { label: 'Circuits checked', value: tally(statuses), status: worst(statuses) },
        { label: 'Ambient', value: `${p.ambientC} °C` },
        ...(() => {
          const fr = fireRatingIssues(p).filter((f) => rs.some((r) => r.feeder.id === f.id));
          return fr.length ? [{ label: 'Life safety circuits not on fire-rated cable', value: fr.map((f) => f.id).join(', '), status: 'warn' as const }] : [];
        })()
      ],
      tables: [{
        title: 'Cables and breakers', headers: ['Circuit', 'From', 'To', 'Cable', 'Ib (A)', 'Breaker In (A)', 'Iz (A)', 'Grouping', 'Ib ≤ In ≤ Iz', 'ΔV total (%)', 'Result'],
        rows: rs.map((r, i) => [tag(r.feeder), r.feeder.boardId, to(r.feeder), `${cableSizeText(r.feeder)} ${cableTypeOf(p, r.feeder).code} + ${cpcOf(r.feeder)} CPC`, n(r.ib, 1), `${r.feeder.breakerRatingA} ${breakerTypeOf(r.feeder)}`, n(r.ampacity, 0), r.tray ? `${r.tray.factor.toFixed(2)} (tray ${r.tray.route})` : '—', S(r.protectionStatus), n(r.vdTotalPct, 2), S(statuses[i])])
      }]
    };
  }

  if (key === 'earth') {
    const want = new Set([...circuits, ...scope.finals].map((f) => f.id));
    const es = data.earthing.filter((e) => want.has(e.feeder.id));
    const statuses = es.map((e) => e.status);
    return {
      key, title: info.title, statuses,
      method: [
        'TN-S system. Earth fault loop impedance Zs = Ze (at the supply board) + (R phase + R cpc) of the circuit, at operating temperature; minimum fault current with c = 0.95.',
        'Disconnection per IEC 60364-4-41: 0.4 s for final circuits ≤ 32 A, 5 s for distribution circuits; instantaneous tripping when If ≥ Ia. Protective conductor checked by the adiabatic equation (k = 143).'
      ],
      summary: [{ label: 'Circuits checked', value: tally(statuses), status: worst(statuses) }],
      tables: [{
        title: 'Earth fault loop', headers: ['Circuit', 'Board', 'Breaker', 'CPC (mm²)', 'Zs (Ω)', 'Max Zs (Ω)', 'If (A)', 'Ia (A)', 'Required (s)', 'Disconnection', 'CPC min (mm²)', 'Result'],
        rows: es.map((e) => [tag(e.feeder), e.feeder.boardId, `${e.feeder.breakerRatingA} A ${breakerTypeOf(e.feeder)}`, e.cpcMm2, n(e.zsOhm, 4), n(e.maxZsOhm, 4), n(e.faultA, 0), n(e.tripA, 0), e.requiredS,
          { v: e.disconnection === 'ok' ? '< 0.1 s' : e.disconnection === 'warn' ? 'Thermal — check curve' : 'Too slow', s: e.disconnection }, { v: n(e.adiabaticMinMm2, 1), s: e.adiabatic }, S(e.status)])
      }]
    };
  }

  if (key === 'disc') {
    const want = new Set(circuits.map((f) => f.id));
    const ss = data.selectivity.filter((s) => want.has(s.downstream.id) || want.has(s.upstream.id));
    const statuses = ss.map((s) => s.status);
    return {
      key, title: info.title, statuses,
      method: [
        'Each breaker against the breaker above it. Overload (time) selectivity: In upstream ÷ In downstream ≥ 1.6.',
        'Short-circuit selectivity: total when the maximum fault at the downstream breaker stays below the upstream magnetic no-trip threshold; otherwise partial up to that current. Confirm with the manufacturer\'s selectivity tables.'
      ],
      summary: [{ label: 'Pairs checked', value: tally(statuses), status: worst(statuses) }],
      tables: [{
        title: 'Selectivity', headers: ['Upstream', 'Downstream', 'In ratio', 'Fault at downstream (kA)', 'Selectivity limit (kA)', 'Short circuit', 'Result'],
        rows: ss.map((s) => [`${s.upstream.id} (${s.upstream.breakerRatingA} A)`, `${s.downstream.id} (${s.downstream.breakerRatingA} A)`, n(s.ratio, 2), n(s.faultKA, 1), n(s.limitKA, 1), s.shortCircuit === 'total' ? 'Total' : 'Partial', S(s.status)])
      }]
    };
  }

  if (key === 'sizing') {
    const set = settingsOf(p);
    const mains = scope.boards.filter((b) => !b.upstreamId);
    const tx = mains.filter((b) => b.sourceKva).map((b) => {
      const s = boardSummary(p, b);
      const design = (s.demandKva * (1 + set.futureGrowthPct / 100)) / (set.transformerMaxLoadingPct / 100);
      const rec = STANDARD_TRANSFORMER_KVA.find((k) => k >= design);
      const status: Status = (b.sourceKva ?? 0) >= design ? 'ok' : (b.sourceKva ?? 0) >= s.demandKva ? 'warn' : 'bad';
      return { b, s, design, rec, status };
    });
    const gens = scope.boards.filter((b) => b.standby).map((b) => ({ b, rec: generatorForBoard(p, b.id) }));
    const pfc = mains.map((b) => sizePfc(p, b.id));
    const statuses = [...tx.map((t) => t.status), ...gens.map((g) => ((g.b.standby?.kva ?? 0) >= g.rec ? 'ok' : 'bad') as Status)];
    return {
      key, title: info.title, statuses,
      method: [
        `Transformer: maximum demand × (1 + ${set.futureGrowthPct} % growth) ÷ ${set.transformerMaxLoadingPct} % design loading, next standard size.`,
        `Standby generator: demand of the boards it feeds ÷ ${set.generatorMaxLoadingPct} % loading. Power factor correction to PF ${set.pfTarget}, banks in 25 kvar steps.`
      ],
      summary: [{ label: 'Items checked', value: tally(statuses), status: statuses.length ? worst(statuses) : undefined }],
      tables: [
        { title: 'Transformers', headers: ['Main board', 'Maximum demand (kVA)', 'Design requirement (kVA)', 'Recommended (kVA)', 'Installed (kVA)', 'Loading', 'Result'],
          rows: tx.map((t) => [t.b.id, n(t.s.demandKva, 0), n(t.design, 0), t.rec ?? '> 3150', t.b.sourceKva ?? '—', `${n((t.s.demandKva / (t.b.sourceKva ?? 1)) * 100, 0)} %`, S(t.status)]) },
        ...(gens.length ? [{ title: 'Standby generators', headers: ['Board', 'Recommended (kVA)', 'Installed (kVA)', 'Result'],
          rows: gens.map((g) => [g.b.id, g.rec, g.b.standby?.kva ?? '—', S((g.b.standby?.kva ?? 0) >= g.rec ? 'ok' : 'bad')]) }] : []),
        { title: 'Power factor correction', headers: ['Main board', 'Demand (kW)', 'PF before', 'Bank (kvar)', 'PF after', 'Current before → after (A)'],
          rows: pfc.map((x) => [x.boardId, n(x.demandKw, 0), n(x.pfBefore, 2), x.bankKvar || 'Not required', n(x.pfAfter, 3), `${n(x.currentBeforeA, 0)} → ${n(x.currentAfterA, 0)}`]) }
      ]
    };
  }

  // schedules
  const db = dbSchedule(p, scope.boards.map((b) => b.id));
  const cs = cableSchedule(p);
  const inScope = new Set([...scope.ids]);
  const incomerTags = new Set(scope.incomers.map((f) => `C-${f.id}`));
  const toCell = (c: string | number): Cell => (c === 'Pass' ? S('ok') : c === 'Check' ? S('warn') : c === 'Fail' ? S('bad') : c);
  return {
    key, title: info.title, statuses: [],
    method: ['Schedules of the boards in scope, from the design data and the latest calculation run.'],
    summary: [{ label: 'Boards', value: String(scope.boards.length) }],
    tables: [
      { title: 'DB schedule', headers: db.headers, rows: db.rows.map((r) => r.map(toCell)) },
      { title: 'Cable schedule', headers: cs.headers, rows: cs.rows.filter((r) => inScope.has(String(r[1])) || incomerTags.has(String(r[0]))).map((r) => r.map(toCell)) }
    ]
  };
}

// ---- Output --------------------------------------------------------------------

export interface ReportMeta {
  title: string;
  docNo?: string;
  preparedBy?: string;
  checkedBy?: string;
  date?: string;
}

export const defaultTitle = (studies: StudyReportKind[]) => (studies.length === 1 ? studyInfo(studies[0]).title : 'Electrical design studies');

const cellHtml = (c: Cell) => (typeof c === 'object' ? `<td class="${c.s}">${esc(c.v)}</td>` : `<td>${esc(c)}</td>`);
const tableHtml = (t: Table) => `${t.title ? `<h3>${esc(t.title)}</h3>` : ''}${t.rows.length
  ? `<table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map(cellHtml).join('')}</tr>`).join('')}</tbody></table>`
  : '<p class="note">Nothing in scope.</p>'}`;

/** The report as print-ready HTML: cover, then per study its method, results
 * summary, SLD (A3 page) and tables (A4 landscape). */
export function buildStudyReportHtml(project: Project, scope: Scope, sections: Section[], meta: ReportMeta, slds: Partial<Record<StudyReportKind, string>> = {}): string {
  const rev = currentRevision(project);
  const date = meta.date ?? new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const info = project.info ?? {};
  const cover = `
<section class="cover">
  ${project.drawing?.logo?.startsWith('data:image/') ? `<img class="cover-logo" src="${esc(project.drawing.logo)}" alt="">` : ''}
  <p class="kicker">${esc(project.name)}</p>
  <h1>${esc(meta.title)}</h1>
  <table class="meta">
    ${[['Project', project.name], ['Owner', info.owner], ['Consultant', info.consultant], ['Contractor', info.contractor], ['Plot / area', [info.plotNo, info.area].filter(Boolean).join(' · ')],
      ['Scope', scopeText(project, scope)], ['Studies', sections.map((s) => s.title).join('; ')], ['System', `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S`],
      ['Document no.', meta.docNo], ['Revision', rev ? `${rev.id} (${rev.date})` : '—'], ['Date', date], ['Prepared by', meta.preparedBy], ['Checked by', meta.checkedBy]]
      .filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
  </table>
  <h2>Results summary</h2>
  <table><thead><tr><th>Study</th><th>Result</th></tr></thead><tbody>
    ${sections.map((s) => `<tr><td>${esc(s.title)}</td>${s.statuses.length ? `<td class="${worst(s.statuses)}">${esc(tally(s.statuses))}</td>` : '<td>—</td>'}</tr>`).join('')}
  </tbody></table>
</section>`;
  const body = sections.map((s, i) => `
<section class="study">
  <h2>${i + 1}. ${esc(s.title)}</h2>
  <p class="scope">Scope: ${esc(scopeText(project, scope))}</p>
  <div class="grid">${s.summary.map((k) => `<div class="kpi"><span>${esc(k.label)}</span><b class="${k.status ?? ''}">${esc(k.value)}</b></div>`).join('')}</div>
  <h3>Method</h3><ul>${s.method.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
  ${s.tables.map(tableHtml).join('')}
</section>
${slds[s.key] ? `<section class="sld"><div class="sld-head"><b>${esc(s.title)} — single line diagram</b><span>${esc(scopeText(project, scope))}</span><span>${esc(studyInfo(s.key).sld?.note ?? '')}</span><span>${esc(meta.docNo ?? '')} ${rev ? `Rev ${esc(rev.id)}` : ''}</span></div><div class="sld-body">${slds[s.key]}</div></section>` : ''}`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — ${esc(meta.title)}</title><style>${REPORT_CSS}
    @page { size: A4 landscape; margin: 14mm 12mm; }
    @page sld { size: A3 landscape; margin: 10mm; }
    h3 { font-size: 11px; margin: 10px 0 3px; }
    .cover { break-after: page; } .cover h1 { font-size: 24px; margin: 4px 0 14px; } .kicker { color: #5b6b82; margin: 30px 0 0; font-size: 12px; } .cover-logo { float: right; max-height: 22mm; max-width: 70mm; margin-top: 20px; }
    .meta { width: 70%; } .meta th { width: 28%; }
    .study { break-before: page; } .scope { color: #5b6b82; margin: 0 0 6px; }
    .grid { grid-template-columns: repeat(3, 1fr); }
    .sld { page: sld; break-before: page; height: 272mm; display: flex; flex-direction: column; }
    .sld-head { display: flex; gap: 14px; flex-wrap: wrap; border-bottom: 1px solid #17202e; padding-bottom: 3px; margin-bottom: 4px; font-size: 9px; color: #333; }
    .sld-head b { color: #17202e; font-size: 11px; }
    .sld-body { flex: 1; min-height: 0; display: flex; } .sld-body svg { width: 100%; height: 100%; }
  </style></head><body>${cover}${body}
<p class="note">Generated by LV Design Studio from the latest calculation run. Calculations cover the whole network; this report shows the part in scope. Results must be checked by a qualified engineer before submission.</p>
</body></html>`;
}

/** The report's tables as an Excel workbook: a cover sheet and one sheet per study. */
export function buildStudyWorkbook(project: Project, scope: Scope, sections: Section[], meta: ReportMeta): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const FILL: Record<Status, string> = { ok: 'FF13803D', warn: 'FFA86500', bad: 'FFC21F32' };
  const cover = wb.addWorksheet('Cover');
  cover.columns = [{ width: 22 }, { width: 90 }];
  cover.addRow([meta.title]).font = { bold: true, size: 14 };
  cover.addRow([]);
  for (const [k, v] of [['Project', project.name], ['Scope', scopeText(project, scope)], ['Studies', sections.map((s) => s.title).join('; ')], ['Document no.', meta.docNo ?? ''], ['Revision', currentRevision(project)?.id ?? '—'], ['Prepared by', meta.preparedBy ?? ''], ['Checked by', meta.checkedBy ?? '']]) {
    const r = cover.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  for (const s of sections) {
    const name = studyInfo(s.key).label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(name);
    ws.addRow([s.title]).font = { bold: true, size: 13 };
    ws.addRow([`Scope: ${scopeText(project, scope)}`]);
    for (const k of s.summary) ws.addRow([k.label, k.value]);
    for (const t of s.tables) {
      ws.addRow([]);
      if (t.title) ws.addRow([t.title]).font = { bold: true };
      const h = ws.addRow(t.headers);
      h.font = { bold: true };
      h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } }; });
      for (const r of t.rows) {
        const row = ws.addRow(r.map((c) => (typeof c === 'object' ? c.v : c)));
        r.forEach((c, i) => { if (typeof c === 'object') row.getCell(i + 1).font = { color: { argb: FILL[c.s] }, bold: c.s === 'bad' }; });
      }
    }
    ws.columns.forEach((c) => { c.width = 16; });
    ws.getColumn(1).width = 24;
  }
  return wb;
}
