import ExcelJS from 'exceljs';
import { REFERENCE_DATA_NOTICE, usingReferenceCables } from '../calc/cableTable';
import { CALC_DISCLAIMER } from '../calc/statusText';
import { STATUS_TEXT, statusOfText } from '../calc/statusText';
import type { FeederResult, Status } from '../calc/electrical';
import { cableSizeText } from '../calc/electrical';
import type { EarthingResult } from '../calc/earthing';
import { phaseBalance, PHASE_UNBALANCE_CHECK_PCT } from '../calc/phaseBalance';
import { breakerTypeOf, cpcOf, disconnectionLabel, loopFigures } from '../calc/earthing';
import type { SelectivityResult } from '../calc/protection';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { boardSummary, boardsInSupplyOrder } from '../calc/summary';
import { generatorForBoard, settingsOf, STANDARD_TRANSFORMER_KVA } from '../calc/sizing';
import { planPfc, pfcPlanOf, STRATEGY_LABEL } from '../calc/pfc';
import { sizeGeneratorByBoards, sizeTransformers, txGenPlanOf, type TxRow } from '../calc/txGen';
import { MATERIAL_LABEL, sizeRiser } from '../calc/busbar';
import { motorStartVdLimit, vdRow, type VdRow } from '../calc/voltageDrop';
import { incomerBasis } from '../calc/electrical';
import { GENERATOR_XD_TRANSIENT_PCT, MOTOR_START_DIP_LIMIT_PCT } from '../calc/motor';
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
  { key: 'phase', label: 'Phase balance', title: 'Phase balance', description: 'Demand current on R / Y / B at every board, estimated neutral current and current unbalance; single-phase circuits without a phase flagged', sld: undefined },
  { key: 'sizing', label: 'Transformer & generator', title: 'Transformer and standby generator sizing', description: 'Transformer per main board (size, loading, fault level, main breaker) and the standby generator from the boards on it', sld: undefined },
  { key: 'busbar', label: 'Busbar risers', title: 'Busbar trunking risers', description: 'Busway rating (copper / aluminium), conductor area, voltage drop per floor, short-circuit withstand, size and weight (tables only)', sld: undefined },
  { key: 'pfc', label: 'Power factor correction', title: 'Power factor correction', description: 'Capacitor banks as planned (central / group / individual): kvar, steps, detuning, breaker and cable, PF before and after', sld: undefined },
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

/** Whole installation or the selected boards (older reports: all when none chosen). */
export const scopeMode = (setup: Pick<StudyReportSetup, 'boards' | 'mode'>): 'all' | 'selected' => setup.mode ?? (setup.boards.length ? 'selected' : 'all');
/** Chosen boards that no longer exist (e.g. a saved set after a rename). */
export const missingBoards = (project: Project, boards: string[]) => boards.filter((id) => !project.boards.some((b) => b.id === id));

export function scopeOf(project: Project, setup: Pick<StudyReportSetup, 'boards' | 'downstream' | 'mode'>): Scope {
  const known = new Set(project.boards.map((b) => b.id));
  const chosen = setup.boards.filter((id) => known.has(id));
  const ids = new Set<string>(scopeMode(setup) === 'all' ? project.boards.map((b) => b.id) : chosen);
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
    all: ids.size === project.boards.length && project.boards.length > 0
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

const LABEL: Record<Status, string> = STATUS_TEXT;
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
    // Motors: the drop while starting has its own limit (running drop × starting current).
    const starts = circuits.map((f) => vdRow(p, f)).filter((r) => r.startPct !== undefined);
    const startStatus = (r: VdRow): Status => (r.startPct! > motorStartVdLimit() ? 'bad' : 'ok');
    const statuses = [...rs.map((r) => r.vdStatus), ...starts.map(startStatus), ...sums.map((s) => s.loadingStatus).filter((x): x is Status => !!x)];
    return {
      key, title: info.title, statuses,
      method: [
        'Balanced 3-phase load flow from the design loads: demand = connected load × demand factor, summed up the network (kW and kVAr separately).',
        `Voltage drop per cable: √3 · I · L · (R cosφ + X sinφ) for 3-phase, 2 · I · L · (…) for single-phase; busbar voltage = nominal minus the drops of the incomers above it. Limit ${p.vdLimitPct} % from the main board to the load.`,
        'Transformer regulation is not included (busbar voltages are measured from the main LV busbar).',
        `Motors: drop while starting = upstream drop + cable drop × the starter's starting-current multiple; limit ${motorStartVdLimit()} %.`
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
          rows: rs.map((r) => [tag(r.feeder), r.feeder.boardId, to(r.feeder), cableSizeText(r.feeder), r.feeder.lengthM, n(r.ib, 1), r.feeder.feedsBoardId ? n(incomerBasis(r.feeder, p).current.pf, 2) : n(r.feeder.powerFactor, 2), n(r.vdPct, 2), n(r.vdTotalPct, 2), S(r.vdStatus)]) },
        ...(starts.length ? [{ title: `Motor starting — limit ${motorStartVdLimit()} % source to motor`, headers: ['Circuit', 'From', 'Motor', 'Running ΔV total (%)', 'Starting ΔV total (%)', 'Limit (%)', 'Result'],
          rows: starts.map((r) => [tag(r.feeder), r.from.id, r.toType, n(r.totalPct, 2), n(r.startPct!, 1), motorStartVdLimit(), S(startStatus(r))]) }] : [])
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
        'Protective conductor (adiabatic): S ≥ I·√t ÷ 143, t = 0.1 s when tripping instantaneously (not the device let-through energy), with I the current through the conductor checked. Parallel runs: each CPC carries an equal share of the end-of-circuit fault (identical runs bonded at both ends); a result that passes only on that assumption is marked "assumed sharing" (warning) because a fault within one run or unequal runs are not covered. The total fault current sets the disconnection check.',
        `Disconnection per IEC 60364-4-41 Table 41.1 (TN, U0 in the 230 V band): 0.4 s for final circuits up to 63 A with socket-outlets and up to 32 A supplying fixed equipment only; 5 s for distribution circuits and other final circuits. Circuits whose purpose is not set are treated as socket-outlet circuits.${data.project.strictFinalDisconnection ? ' Project rule (stricter than the standard): every final circuit up to 63 A in 0.4 s.' : ''} Instantaneous tripping when If ≥ Ia; below that, a 5 s circuit needs the breaker's time-current curve checked. Protective conductor checked by the adiabatic equation (k = 143).`
      ],
      summary: [{ label: 'Circuits checked', value: tally(statuses), status: worst(statuses) },
        ...(() => { const m = [...new Set(es.map((e) => e.sourceMissing).filter((x): x is string => !!x))]; return m.length ? [{ label: 'Not verified — supply loop incomplete', value: `${m.join('; ')} (Ze not assumed 0; Zs a minimum, If a maximum)`, status: 'warn' as const }] : []; })()],
      tables: [{
        title: 'Earth fault loop', headers: ['Circuit', 'Board', 'Breaker', 'CPC (mm²)', 'Zs (Ω)', 'Max Zs (Ω)', 'If (A)', 'Ia (A)', 'Required (s)', 'Disconnection', 'CPC min, each (mm²)', 'Result'],
        rows: es.map((e) => [tag(e.feeder), e.feeder.boardId, `${e.feeder.breakerRatingA} A ${breakerTypeOf(e.feeder)}`, e.cpcMm2, loopFigures(e).zs, n(e.maxZsOhm, 4), loopFigures(e).fault, n(e.tripA, 0), `${e.requiredS}${e.requiredBasis.startsWith('Project rule') ? ' (project rule)' : ''}${e.basisSupported ? '' : ' (not verified)'}`,
          { v: disconnectionLabel(e), s: e.disconnection }, { v: `${n(e.adiabaticMinMm2, 1)}${e.runs > 1 ? ` (${e.runs} runs, ${n(e.cpcCurrentA, 0)} A each${e.adiabatic === 'warn' ? ', assumed sharing' : ''})` : ''}`, s: e.adiabatic }, S(e.status)])
      }]
    };
  }

  if (key === 'phase') {
    const pb = scope.boards.map((b) => phaseBalance(p, b.id));
    const statuses = pb.map((x) => x.status);
    const unassigned = [...new Map(pb.flatMap((x) => x.unassigned).map((f) => [f.id, f])).values()];
    return {
      key, title: info.title, statuses,
      method: [
        'Demand kW and kvar per phase (each load\'s demand factor and power factor), downstream boards included: single-phase circuits on their labelled phase R / Y / B; 3-phase loads spread evenly.',
        `Phase current I = S ÷ U0 at nominal voltage (U0 = ${n(p.voltageV / Math.sqrt(3), 0)} V). Neutral current = phasor sum of the three phase currents, phases 120° apart, at fundamental frequency — triplen harmonics (e.g. from LED drivers and IT loads) add to the neutral and are not included.`,
        `Current unbalance = largest deviation from the average phase current ÷ the average. Flagged above ${PHASE_UNBALANCE_CHECK_PCT} % (app default, not a standard's limit).`,
        'Limits of this check: demand-based at nominal voltage — not an unbalanced load flow; no voltage unbalance, no neutral voltage, no phase-specific voltage drop. Single-phase circuits with no phase set are spread evenly, which hides their unbalance; they are listed.'
      ],
      summary: [{ label: 'Boards checked', value: tally(statuses), status: worst(statuses) },
        ...(unassigned.length ? [{ label: 'Single-phase circuits without a phase', value: `${unassigned.length} (${unassigned.slice(0, 8).map((f) => f.id).join(', ')}${unassigned.length > 8 ? ' …' : ''}) — spread evenly, unbalance may be understated`, status: 'warn' as const }] : [])],
      tables: [{
        title: 'Phase balance at each board (demand)', headers: ['Board', 'R (A)', 'Y (A)', 'B (A)', 'R / Y / B (kW)', 'Neutral (A)', 'Unbalance', 'No phase set', 'Result'],
        rows: pb.map((x) => [x.boardId, n(x.currentA.R, 1), n(x.currentA.Y, 1), n(x.currentA.B, 1), `${n(x.kw.R, 1)} / ${n(x.kw.Y, 1)} / ${n(x.kw.B, 1)}`, n(x.neutralA, 1),
          { v: `${n(x.unbalancePct, 1)} %`, s: x.unbalancePct > PHASE_UNBALANCE_CHECK_PCT + 1e-9 ? 'warn' : 'ok' }, x.unassigned.length ? { v: x.unassigned.length, s: 'warn' } : 0, S(x.status)])
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

  if (key === 'busbar') {
    const rs = (p.busRisers ?? []).filter((r) => !r.sourceBoardId || scope.all || scope.ids.has(r.sourceBoardId)).map((r) => sizeRiser(p, r));
    const st = (x: ReturnType<typeof sizeRiser>): Status => (!x.type || x.icwOk === false ? 'bad' : x.vdTopPct > p.vdLimitPct / 2 ? 'warn' : 'ok');
    const statuses = rs.map(st);
    return {
      key, title: info.title, statuses,
      method: [
        'Demand: the tap-offs’ loads (a floor’s board demand, or the load entered) × diversity (IEC 61439-6: 0.9 for 2–3 tap-offs, 0.8 for 4–5, 0.7 for 6–9, 0.6 for 10 or more, unless set).',
        'Rating: Ib ≤ In (feeding breaker) ≤ busway rating × ambient derating (≈ 1 % per °C above 40 °C).',
        'Voltage drop floor by floor: ΔU = √3 · I · L · (R cos φ + X sin φ), each riser section carrying the diversified load of the tap-offs above it.',
        'Short-circuit: the busway’s Icw (1 s) ≥ the fault level at the board feeding it. Busway data: ' + (p.busbarData ? 'as entered for this project.' : 'typical sandwich busway — confirm with the manufacturer.')
      ],
      summary: [{ label: 'Risers checked', value: tally(statuses), status: statuses.length ? worst(statuses) : undefined },
        ...rs.map((x) => ({ label: x.riser.name, value: x.type ? `${x.type.ratingA} A ${MATERIAL_LABEL[x.riser.material].toLowerCase()}` : '—', status: st(x) }))],
      tables: [
        { title: 'Busbar risers', headers: ['Riser', 'From', 'Tap-offs', 'Demand (kW)', 'Ib (A)', 'Breaker (A)', 'Busway', 'Area / phase (mm²)', 'Icw (kA) · fault (kA)', 'Vd top (%)', 'W × H (mm)', 'Length (m)', 'Weight (kg)', 'Result'],
          rows: rs.map((x) => [x.riser.name, x.riser.sourceBoardId ?? '—', x.tapOffs, n(x.demandKw, 0), n(x.designA, 0), x.feederBreakerA ?? '—',
            x.type ? `${x.type.ratingA} A ${MATERIAL_LABEL[x.riser.material]}` : 'Above the data', x.type ? x.type.csaMm2 : '—',
            x.type ? `${x.type.icwKa} · ${x.faultKa !== undefined ? n(x.faultKa, 1) : '—'}` : '—', n(x.vdTopPct, 2), x.type ? `${x.type.widthMm} × ${x.type.heightMm}` : '—', n(x.lengthM, 1), x.weightKg !== undefined ? n(x.weightKg, 0) : '—', S(st(x))]) },
        ...rs.map((x) => ({ title: `${x.riser.name} — tap-offs`, headers: ['Floor', 'Board', 'Load (kW)', 'Current (A)', 'Tap-off (A)', 'Floors', 'Height (m)', 'Vd (%)'],
          rows: x.floors.map((f) => [f.floor.name, f.floor.boardId ?? '—', n(f.kw, 1), n(f.currentA, 0), f.tapOffA ?? '—', f.floor.count ?? 1, n(f.heightM, 1), n(f.vdPct, 2)]) }))
      ]
    };
  }

  if (key === 'pfc') return pfcSection(p, scope);

  if (key === 'sizing') {
    const set = settingsOf(p);
    const plan = txGenPlanOf(p);
    const tx = sizeTransformers(p, plan).filter((r) => scope.ids.has(r.board.id));
    const gen = sizeGeneratorByBoards(p, plan);
    const txStatus = (r: TxRow): Status => (r.adequate === false ? 'bad' : r.outage && !r.outage.ok ? 'warn' : r.checks && (r.checks.icuOk === false || r.checks.busbarOk === false) ? 'warn' : 'ok');
    // A generator demand above the largest standard set is a failure, never left out.
    const genNeeded = gen.demandKw > 0 || gen.recommendedKva !== undefined;
    const genTooBig = genNeeded && gen.recommendedKva === undefined;
    const genStatus: Status | undefined = !genNeeded ? undefined : genTooBig || gen.installedOk === false ? 'bad' : 'ok';
    const genSize = genTooBig ? `${n(Math.max(gen.runningDesignKva, gen.startDesignKva), 0)} kVA needed (${gen.governing}) — above the largest standard set` : `${gen.recommendedKva} kVA / ${n(gen.recommendedKw ?? 0, 0)} kW`;
    const genScope = scope.all ? '' : ' (sized for the whole installation — the generator is shared)';
    const statuses = [...tx.map(txStatus), ...(genStatus ? [genStatus] : [])];
    const pfcTaken = tx.some((r) => r.pfcKvar > 0);
    return {
      key, title: info.title, statuses,
      method: [
        `Transformer per main board: maximum demand${pfcTaken ? ' (after the planned power factor correction)' : ''} × (1 + ${set.futureGrowthPct} % growth) ÷ ${set.transformerMaxLoadingPct} % design loading, next ${plan.sizeList === 'dewa' ? 'DEWA standard size (500 / 1000 / 1500 kVA)' : 'IEC standard size'}.`,
        'For that size: full-load current and main breaker, LV fault level (typical IEC 60076-5 impedance, infinite MV source), voltage regulation at the design demand.',
        `Bus couplers: with one transformer out, the other carries both boards up to ${plan.emergencyLoadingPct} % of its rating. Duty / standby: two transformers, each for the whole load.`,
        `Standby generator from the boards on it (share of each), plus circuits marked essential. The set must carry the running kVA and the running kW at ${set.generatorMaxLoadingPct} % loading: rating ≥ max(kVA ÷ ${set.generatorMaxLoadingPct / 100}, kW ÷ (0.8 × ${set.generatorMaxLoadingPct / 100})), with rated kW = 0.8 × rated kVA unless the Generators list gives the set's kW; or larger if the largest motor, started last, would dip the voltage over ${MOTOR_START_DIP_LIMIT_PCT} % (X′d ${GENERATOR_XD_TRANSIENT_PCT} %).`
      ],
      summary: [
        { label: 'Items checked', value: tally(statuses), status: statuses.length ? worst(statuses) : undefined },
        ...tx.map((r) => ({ label: `${r.board.id} transformer`, value: r.recommendedKva ? `${r.split > 1 ? `${r.split} × ` : r.n1 ? '2 × ' : ''}${r.recommendedKva} kVA` : '—', status: txStatus(r) })),
        ...(genNeeded ? [{ label: `Standby generator${genScope}`, value: genSize, status: genStatus }] : [])
      ],
      tables: [
        { title: 'Transformers', headers: ['Main board', 'Demand (kVA)', 'PF', 'Design (kVA)', 'Recommended', 'Installed · loading', 'FLC · main breaker', 'LV fault (kA) · lowest Icu', 'Regulation', 'Result'],
          rows: tx.map((r) => [r.board.id, n(r.demandKva, 0), n(r.pf, 2), n(r.designKva, 0),
            r.recommendedKva ? `${r.split > 1 ? `${r.split} × ` : r.n1 ? '2 × ' : ''}${r.recommendedKva} kVA${r.n1 ? ' (duty / standby)' : ''}` : '—',
            r.installedKva ? `${r.installedKva} kVA · ${n(r.loadingPct!, 0)} %` : '—',
            r.checks ? `${n(r.checks.flcA, 0)} A · ${r.checks.acbA} A` : '—',
            r.checks ? `${n(r.checks.faultKa, 1)} · ${r.checks.minIcuKa ?? '—'}` : '—',
            r.checks ? `${n(r.checks.regulationPct, 1)} %` : '—', S(txStatus(r))]) },
        ...(tx.some((r) => r.outage) ? [{ title: 'Bus coupler — one transformer out', headers: ['Transformer', 'Also carries', 'Load (kVA)', 'Of its rating', 'Result'],
          rows: tx.filter((r) => r.outage).map((r) => [r.board.id, r.outage!.with, n(r.outage!.kva, 0), r.outage!.pctOfRecommended !== undefined ? `${n(r.outage!.pctOfRecommended, 0)} %` : '—', S(r.outage!.ok ? 'ok' : 'warn')]) }] : []),
        ...(genNeeded ? [
          { title: `Standby generator — loads${genScope}`, headers: ['Board / circuit', 'Share', 'Demand (kW)', 'Reactive (kvar)'],
            rows: [...gen.picks.filter((x) => !x.within && x.pct > 0).map((x) => [x.board.id + (x.auto === 'emdb' ? ' (EMDB)' : x.auto === 'standby' ? ' (ATS)' : ''), `${x.pct} %`, n(x.kw, 0), n(x.kvar, 0)]),
              ...gen.circuits.map((f) => [`${f.id} ${f.name} (essential circuit)`, '100 %', n(f.loadKw * f.demandFactor, 0), '—'])] },
          { title: 'Standby generator — size', headers: ['Item', 'Value'],
            rows: [
              ['Running demand', `${n(gen.demandKw, 0)} kW · ${n(gen.demandKva, 0)} kVA`],
              ['For the running load', `${n(gen.runningDesignKva, 0)} kVA — ${gen.governing === 'kW' ? 'set by the kW (rated kW = 0.8 × kVA)' : gen.governing === 'kVA' ? 'set by the kVA' : 'running; the motor start sets the size'}`],
              ...(gen.motor ? [
                ['Largest motor start', `${gen.motor.feeder.id}: ${n(gen.motor.startingKva, 0)} kVA starting with ${n(gen.motor.baseKva, 0)} kVA already running`],
                ['For the motor start', `${n(gen.startDesignKva, 0)} kVA (dip ${n(gen.motor.dipPct ?? 0, 1)} % on the recommended set)`]
              ] : []),
              ['Recommended', genTooBig ? `None — ${genSize}. Consider sets in parallel or splitting the essential load.` : `${gen.recommendedKva} kVA / ${n(gen.recommendedKw!, 0)} kW at 0.8 PF`],
              ['Result', S(genStatus!)],
              ...(gen.softStartKva ? [['With a soft starter on the largest motor', `${gen.softStartKva} kVA`]] : []),
              ['Full-load current · ATS / breaker', gen.flcA !== undefined ? `${n(gen.flcA, 0)} A · ${gen.atsA ?? '—'} A` : '—'],
              ['Installed', gen.installedKva ? `${gen.installedKva} kVA / ${n(gen.installedKva * 0.8, 0)} kW${gen.installedOk === false ? ' — too small' : ''}` : '—']
            ] }
        ] : [])
      ]
    };
  }


  // schedules
  const db = dbSchedule(p, scope.boards.map((b) => b.id));
  const cs = cableSchedule(p);
  const inScope = new Set([...scope.ids]);
  const incomerTags = new Set(scope.incomers.map((f) => `C-${f.id}`));
  const toCell = (c: string | number): Cell => (statusOfText(c) ? S(statusOfText(c)!) : c);
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

/** Power factor correction as planned on the PFC page, for the boards in scope. */
export function pfcSection(p: Project, scope: Scope): Section {
  const r = planPfc(p);
  const plan = pfcPlanOf(p);
  const rows = r.rows.filter((x) => scope.ids.has(x.boardId));
  const mains = r.mains.filter((m) => scope.ids.has(m.boardId));
  const statuses: Status[] = rows.map((x) => (x.warn ? 'warn' : x.bankKvar === 0 || x.pfAfter >= x.pfTarget - 1e-6 || x.kind === 'load' ? 'ok' : 'warn'));
  const kvar = rows.reduce((s, x) => s + x.bankKvar, 0);
  const noted = rows.filter((x) => x.notes.length);
  return {
    key: 'pfc', title: studyInfo('pfc').title, statuses,
    method: [
      `Strategy: ${STRATEGY_LABEL[plan.strategy]}.${plan.strategy !== 'central' && plan.remainder ? ' The main board has a bank for what the others leave.' : ''}`,
      `Qc = P × (tan φ1 − tan φ2) to PF ${r.pfTarget}, from the maximum demand (demand factors applied). Capacitors already on the drawing are included.`,
      'Banks are sized from the bottom up: each bank only covers what the banks below it do not, so nothing is corrected twice.',
      `Board banks: automatic (APFC) in ${plan.stepKvar} kvar steps, rounded up. Individual capacitors: fixed, rounded down (never over-correct a motor).`,
      `Detuned (7 %, 189 Hz) where non-linear load ≥ 25 % of demand${plan.detuning === 'auto' ? '' : ` — set to ${plan.detuning ? `${plan.detuning} %` : 'none'} for this project`}. Capacitor rating ≥ 1.05 × U ÷ (1 − p).`,
      `Breaker ≥ 1.43 × bank current (IEC 60831 1.3 × overcurrent and capacitance tolerance). Light-load check at ${plan.lightLoadPct} % of demand.`
    ],
    summary: [
      { label: 'Target PF', value: String(r.pfTarget) },
      { label: 'Capacitors (new)', value: `${n(kvar, 1)} kvar in ${rows.filter((x) => x.bankKvar).length} banks` },
      ...mains.map((m) => ({ label: `${m.boardId} PF`, value: `${m.pfBefore.toFixed(2)} → ${m.pfAfter.toFixed(3)}`, status: (m.pfAfter >= r.pfTarget - 1e-6 ? 'ok' : 'warn') as Status })),
      ...mains.filter((m) => m.releasedKva > 0.5).map((m) => ({ label: `${m.boardId} capacity released`, value: `${n(m.releasedKva, 0)} kVA${m.loadingBeforePct !== undefined ? ` (transformer ${n(m.loadingBeforePct, 0)} % → ${n(m.loadingAfterPct!, 0)} %)` : ''}` }))
    ],
    tables: [
      { title: 'Capacitor banks', headers: ['Location', 'Demand (kW)', 'Reactive (kvar)', 'Existing (kvar)', 'Banks below (kvar)', 'PF now', 'Required (kvar)', 'Bank', 'Detuning · capacitor V', 'Breaker · cable', 'PF after', 'Current (A)', 'Result'],
        rows: rows.map((x, k) => [
          x.kind === 'load' ? `  ${x.label} (at the load)` : x.label, n(x.demandKw, 0), n(x.demandKvar, 0), x.existingKvar ? n(x.existingKvar, 1) : '—', x.downstreamKvar ? n(x.downstreamKvar, 1) : '—',
          n(x.pfBefore, 2), n(x.requiredKvar, 1),
          x.bankKvar ? (x.steps > 1 ? `${n(x.bankKvar, 1)} kvar (${x.steps} × ${x.stepKvar})` : `${n(x.bankKvar, 1)} kvar fixed`) : 'Not required',
          x.bankKvar ? `${x.detunedPct ? `${x.detunedPct} %` : 'None'} · ${x.capVoltageV} V` : '—',
          x.bankKvar ? `${x.breakerA ?? '—'} A · ${x.cable ?? '—'}` : '—',
          n(x.pfAfter, 3), `${n(x.currentBeforeA, 0)} → ${n(x.currentAfterA, 0)}`, S(statuses[k])
        ]) },
      { title: 'Main boards', headers: ['Main board', 'Demand (kW)', 'PF before', 'PF after', 'kVA before → after', 'Released (kVA)', 'Transformer loading'],
        rows: mains.map((m) => [m.boardId, n(m.demandKw, 0), n(m.pfBefore, 2), n(m.pfAfter, 3), `${n(m.kvaBefore, 0)} → ${n(m.kvaAfter, 0)}`, n(m.releasedKva, 0), m.loadingBeforePct !== undefined ? `${n(m.loadingBeforePct, 0)} % → ${n(m.loadingAfterPct!, 0)} %` : '—']) },
      ...(noted.length ? [{ title: 'Notes', headers: ['Location', 'Note'], rows: noted.flatMap((x) => x.notes.map((t) => [x.label, t])) }] : [])
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
<p class="note">Generated by LV Design Studio from the latest calculation run. Calculations cover the whole network; this report shows the part in scope. ${esc(CALC_DISCLAIMER)} Results must be checked by a qualified engineer before submission.${usingReferenceCables() ? ` <b>${esc(REFERENCE_DATA_NOTICE)}</b>` : ''}</p>
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
