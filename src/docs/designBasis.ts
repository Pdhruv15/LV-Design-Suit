import type { Status } from '../calc/electrical';
import { REPORT_STATUS_TEXT } from '../calc/statusText';
import { systemSummary } from '../calc/summary';
import { sizeGeneratorByBoards, sizeTransformers, txGenPlanOf } from '../calc/txGen';
import { SCOPE_ITEMS } from '../model/brief';
import { STUDY_DEFAULTS, settingsOf, type Project, type StudyReportKind } from '../types';
import { esc } from './report';
import { NOT_DEFINED, valueOrMissing } from './reportFrame';

/** Executive summary and design basis of the design report (sections 1–5):
 * report data built only from the project and the existing calculation
 * outputs (systemSummary, transformer / generator sizing, the study
 * sections' statuses). Nothing is calculated here that the calculation pages
 * don't already calculate, and nothing missing is filled in — an undefined
 * value is `undefined` and prints as "Not defined". */

// ---- Report data -------------------------------------------------------------

export interface Finding { status: Status | 'info'; text: string }
/** 'nc' = nothing installed to check against (NOT CHECKED). */
type CheckStatus = Status | 'nc';

export interface ExecutiveSummary {
  connectedKw: number;
  demandKw: number;
  demandKva: number;
  /** Maximum demand ÷ connected load (undefined with no connected load). */
  demandRatio?: number;
  powerFactor: number;
  currentA: number;
  transformers: { board: string; requiredKva: number; recommended?: string; installedKva?: number; loadingPct?: number; status: CheckStatus }[];
  generator?: { demandKva: number; requiredKva: number; governing: string; recommended?: string; installedKva?: number; status: CheckStatus };
  arrangement: string[];
  findings: Finding[];
}

export interface CriteriaRow { parameter: string; value?: string; source: string; flag?: string }

export interface DesignBasis {
  summary: ExecutiveSummary;
  scope: { included: string[]; excluded: string[]; boundaries: string[]; defined: boolean };
  system: { supply: string[]; transformers: string[]; distribution: string[]; emergency: string[]; ups: string[]; other: string[] };
  standards: { project: string[]; authority?: string; methods: { standard: string; used: string }[] };
  criteria: CriteriaRow[];
}

const n = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Standards the app's calculation methods follow, per study (shown as the calculation basis, not as project requirements). */
const METHOD_STANDARDS: { standard: string; studies: StudyReportKind[]; used: string }[] = [
  { standard: 'IEC 60909-0', studies: ['sc'], used: 'Short-circuit currents (simplified: c factor, infinite MV network)' },
  { standard: 'IEC 60364-5-52', studies: ['lf', 'cable'], used: 'Cable current-carrying capacity, derating and voltage drop' },
  { standard: 'IEC 60364-4-43', studies: ['cable'], used: 'Overload protection: Ib ≤ In ≤ Iz' },
  { standard: 'IEC 60364-4-41', studies: ['earth'], used: 'Automatic disconnection: earth fault loop impedance and disconnection times' },
  { standard: 'IEC 60364-5-54', studies: ['earth'], used: 'Protective conductor size (Table 54.2 / adiabatic)' },
  { standard: 'IEC 60898-1 / IEC 60947-2', studies: ['sc', 'cable', 'earth', 'disc'], used: 'Circuit-breaker characteristics and breaking capacity' },
  { standard: 'IEC 60831', studies: ['pfc'], used: 'Capacitor bank rating and switching device' },
  { standard: 'IEC 61439-6', studies: ['busbar'], used: 'Busbar trunking ratings' }
];

/** Builds the report data. `studies` are the studies in this report; `statuses` their results (from the sections). */
export function buildDesignBasis(project: Project, studies: { key: StudyReportKind; title: string; statuses: Status[] }[]): DesignBasis {
  const sys = systemSummary(project);
  const plan = txGenPlanOf(project);
  const tx = sizeTransformers(project, plan);
  const gen = sizeGeneratorByBoards(project, plan);
  const mains = project.boards.filter((b) => !b.upstreamId);
  const kinds = (k: string) => project.boards.filter((b) => b.kind === k);

  // Executive summary
  const transformers = tx.map((r) => ({
    board: r.board.id, requiredKva: r.designKva,
    recommended: r.recommendedKva ? `${r.split > 1 ? `${r.split} × ` : r.n1 ? '2 × ' : ''}${r.recommendedKva} kVA${r.n1 ? ' (duty / standby)' : ''}` : undefined,
    installedKva: r.installedKva, loadingPct: r.loadingPct,
    status: (r.adequate === false || !r.recommendedKva ? 'bad' : r.installedKva ? 'ok' : 'nc') as CheckStatus
  }));
  const hasGen = gen.demandKw > 0 || !!gen.recommendedKva || !!gen.installedKva;
  const generator = hasGen ? {
    demandKva: gen.demandKva, requiredKva: Math.max(gen.runningDesignKva, gen.startDesignKva), governing: String(gen.governing),
    recommended: gen.recommendedKva ? `${gen.recommendedKva} kVA / ${n(gen.recommendedKw!)} kW` : undefined, installedKva: gen.installedKva,
    status: (gen.installedOk === false || !gen.recommendedKva ? 'bad' : gen.installedKva ? 'ok' : 'nc') as CheckStatus
  } : undefined;
  const arrangement = mains.map((m) => {
    const below = (id: string): string[] => project.boards.filter((b) => b.upstreamId === id).flatMap((b) => [b.id, ...below(b.id)]);
    const tree = below(m.id).map((id) => project.boards.find((b) => b.id === id)!);
    const count = (['SMDB', 'DB', 'MCC', 'EMDB', 'UPS'] as const).map((k) => [k, tree.filter((b) => b.kind === k).length] as const).filter(([, c]) => c);
    return `${m.id}${m.kind ? ` (${m.kind})` : ''} feeding ${tree.length ? `${tree.length} board(s)${count.length ? `: ${count.map(([k, c]) => `${c} ${k}`).join(', ')}` : ''}` : 'final circuits only'}`;
  });
  const findings: Finding[] = [];
  for (const s of studies) {
    const bad = s.statuses.filter((x) => x === 'bad').length, warn = s.statuses.filter((x) => x === 'warn').length;
    if (bad) findings.push({ status: 'bad', text: `${s.title}: ${bad} check(s) fail.` });
    else if (warn) findings.push({ status: 'warn', text: `${s.title}: ${warn} check(s) need review.` });
    else if (s.statuses.length) findings.push({ status: 'ok', text: `${s.title}: all ${s.statuses.length} checks pass.` });
  }
  for (const t of transformers) if (t.status === 'bad') findings.push({ status: 'bad', text: `Transformer for ${t.board}: ${t.recommended ? `installed ${t.installedKva ?? '—'} kVA is below the ${t.recommended} required` : 'demand is above the largest standard size'}.` });
  if (generator?.status === 'bad') findings.push({ status: 'bad', text: generator.recommended ? `Standby generator: installed ${generator.installedKva} kVA is below the ${generator.recommended} required.` : 'Standby generator: requirement is above the largest standard set.' });
  if (!mains.some((m) => m.sourceKva || m.supply)) findings.push({ status: 'warn', text: 'No incoming supply is defined (no transformer rating or authority supply on a main board).' });

  // Scope
  const brief = project.brief;
  const scope = brief?.scope.length
    ? {
      defined: true,
      included: SCOPE_ITEMS.filter((s) => brief.scope.includes(s.id)).map((s) => `${s.label} — ${s.hint}`),
      excluded: SCOPE_ITEMS.filter((s) => !brief.scope.includes(s.id)).map((s) => s.label),
      boundaries: boundaries(project)
    }
    : { defined: false, included: [], excluded: [], boundaries: boundaries(project) };

  // System description
  const supply = mains.map((m) => m.supply
    ? `${m.id}: supplied by ${m.supply.fedFrom ?? NOT_DEFINED}${m.supply.ratingA ? `, ${m.supply.ratingA} A ${m.supply.device ?? 'incomer'}` : ''}${m.supply.faultKa ? `, ${m.supply.faultKa} kA fault level` : ''}${m.supply.meter ? `, ${m.supply.meter} metering` : ''}`
    : m.sourceKva ? `${m.id}: from a dedicated transformer${m.rmu ? ` fed by RMU ${m.rmu}` : ''}${m.substation ? ` in substation ${m.substation}` : ''}` : `${m.id}: incoming supply ${NOT_DEFINED}`);
  const transformersText = mains.filter((m) => m.sourceKva).map((m) =>
    `${m.txRef ?? m.id}: ${m.sourceKva} kVA, ${m.sourceImpedancePct ?? NOT_DEFINED} % Z, ${m.vectorGroup ?? 'Dyn11 (app default)'}, ${project.voltageV} V secondary`);
  const distribution = [
    `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S (the earthing arrangement the calculations assume).`,
    ...arrangement,
    ...(project.ties ?? []).map((t) => `Bus coupler ${t.id}: ${t.a} ↔ ${t.b}, ${t.ratingA} A, normally open.`)
  ];
  const emergency = [
    ...project.boards.filter((b) => b.standby).map((b) => `${b.id}: standby generator ${b.standby!.kva} kVA through ${b.standby!.changeover ?? 'ATS'}; everything on and below ${b.id} is essential load.`),
    ...kinds('EMDB').filter((b) => !b.standby).map((b) => `${b.id}: emergency board${b.upstreamId ? ` fed from ${b.upstreamId}` : ''}.`)
  ];
  const ups = [
    ...(project.upsSystems ?? []).map((u) => `${u.name}${u.boardId ? ` (board ${u.boardId})` : ''}: ${u.autonomyMin} min autonomy, ${u.dcVoltage} V DC.`),
    ...kinds('UPS').filter((b) => !(project.upsSystems ?? []).some((u) => u.boardId === b.id)).map((b) => `${b.id}: UPS output board${b.upsKva ? `, ${b.upsKva} kVA` : ''}.`)
  ];
  const other = project.pv ? ['Solar PV system (see the Solar PV page for the array and inverter).'] : [];

  // Codes and standards
  const keys = new Set(studies.map((s) => s.key));
  const standards = {
    project: (project.standards ?? []).map((s) => s.trim()).filter(Boolean),
    authority: brief?.authority?.trim() || undefined,
    methods: METHOD_STANDARDS.filter((m) => m.studies.some((k) => keys.has(k))).map(({ standard, used }) => ({ standard, used }))
  };

  // Design criteria
  const set = settingsOf(project), own = project.studySettings ?? {};
  const fromSettings = (k: keyof typeof STUDY_DEFAULTS, value: string, parameter: string): CriteriaRow =>
    own[k] === undefined ? { parameter, value, source: 'App default', flag: 'Not set for the project — app default used' } : { parameter, value, source: 'Study settings' };
  const criteria: CriteriaRow[] = [
    { parameter: 'System voltage (line-line)', value: `${project.voltageV} V`, source: 'Project settings' },
    { parameter: 'Frequency', value: `${project.frequencyHz} Hz`, source: 'Project settings' },
    { parameter: 'Earthing arrangement', value: 'TN-S', source: 'Calculation basis (fixed)' },
    { parameter: 'Design ambient temperature', value: `${project.ambientC} °C`, source: 'Project settings' },
    { parameter: 'Voltage drop limit (source to load)', value: `${project.vdLimitPct} %`, source: 'Project settings' },
    project.vdTempC === undefined
      ? { parameter: 'Conductor temperature for voltage drop', value: '1.2 × R20', source: 'Calculation basis', flag: 'Not set for the project' }
      : { parameter: 'Conductor temperature for voltage drop', value: `${project.vdTempC} °C`, source: 'Project settings' },
    { parameter: 'Final circuit disconnection', value: project.strictFinalDisconnection ? '0.4 s for every final circuit ≤ 63 A (project rule)' : 'IEC 60364-4-41 Table 41.1', source: 'Project settings' },
    fromSettings('pfTarget', String(set.pfTarget), 'Power factor target'),
    fromSettings('futureGrowthPct', `${set.futureGrowthPct} %`, 'Future growth allowance (transformer)'),
    fromSettings('transformerMaxLoadingPct', `${set.transformerMaxLoadingPct} %`, 'Transformer maximum design loading'),
    fromSettings('generatorMaxLoadingPct', `${set.generatorMaxLoadingPct} %`, 'Generator maximum design loading'),
    project.info?.mdDemandFactor === undefined
      ? { parameter: 'Maximum demand factor (authority forms)', source: 'Project information', flag: NOT_DEFINED }
      : { parameter: 'Maximum demand factor (authority forms)', value: String(project.info.mdDemandFactor), source: 'Project information' },
    sys.connectedKw > 0
      ? { parameter: 'Overall demand ÷ connected load', value: `${n(sys.demandKw / sys.connectedKw, 2)} (${n(sys.demandKw)} ÷ ${n(sys.connectedKw)} kW)`, source: 'Load assessment (calculated)' }
      : { parameter: 'Overall demand ÷ connected load', source: 'Load assessment (calculated)', flag: 'No connected load' }
  ];

  return {
    summary: {
      connectedKw: sys.connectedKw, demandKw: sys.demandKw, demandKva: sys.demandKva, demandRatio: sys.connectedKw > 0 ? sys.demandKw / sys.connectedKw : undefined,
      powerFactor: sys.powerFactor, currentA: sys.currentA, transformers, generator, arrangement, findings
    },
    scope, system: { supply, transformers: transformersText, distribution, emergency, ups, other }, standards, criteria
  };
}

function boundaries(project: Project): string[] {
  const mains = project.boards.filter((b) => !b.upstreamId);
  return [
    `Starts at: ${mains.map((m) => (m.supply ? `the incoming ${m.supply.fedFrom ?? 'authority'} supply of ${m.id}` : m.sourceKva ? `the LV terminals of the transformer feeding ${m.id}` : `${m.id} (supply ${NOT_DEFINED.toLowerCase()})`)).join('; ') || NOT_DEFINED}.`,
    'MV network upstream of the transformers is outside the calculations (treated as an infinite source).',
    'Ends at: the final circuits on the DB load schedules and the loads connected to them.'
  ];
}

// ---- HTML -----------------------------------------------------------------------

const list = (xs: string[], empty: string) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="missing">${esc(empty)}</p>`);
const LABEL: Record<Finding['status'] | 'nc', string> = { ...REPORT_STATUS_TEXT, info: 'NOTE' };

/** The five design-basis sections, each as {title, html}; numbered by the report. */
export function designBasisSections(b: DesignBasis): { title: string; html: string }[] {
  const s = b.summary;
  const exec = `
  <div class="grid grid4">
    <div class="kpi"><span>Connected load</span><b>${n(s.connectedKw)} kW</b></div>
    <div class="kpi"><span>Maximum demand</span><b>${n(s.demandKw)} kW · ${n(s.demandKva)} kVA</b></div>
    <div class="kpi"><span>Demand ÷ connected</span><b>${s.demandRatio === undefined ? valueOrMissing() : n(s.demandRatio, 2)}</b></div>
    <div class="kpi"><span>Power factor · current</span><b>${n(s.powerFactor, 2)} · ${n(s.currentA)} A</b></div>
  </div>
  <h3>Transformer requirement</h3>
  ${s.transformers.length ? `<table><thead><tr><th>Main board</th><th>Required (kVA)</th><th>Recommended</th><th>Installed (kVA)</th><th>Loading</th><th>Status</th></tr></thead><tbody>${s.transformers.map((t) =>
    `<tr><td>${esc(t.board)}</td><td>${n(t.requiredKva)}</td><td>${t.recommended ? esc(t.recommended) : '<span class="bad">Above the largest standard size</span>'}</td><td>${t.installedKva ? n(t.installedKva) : valueOrMissing()}</td><td>${t.loadingPct === undefined ? '—' : `${n(t.loadingPct)} %`}</td><td class="${t.status}">${LABEL[t.status]}</td></tr>`).join('')}</tbody></table>`
    : '<p class="missing">No transformer is defined on any main board.</p>'}
  <h3>Generator requirement</h3>
  ${s.generator ? `<table><thead><tr><th>Essential demand (kVA)</th><th>Rating needed (kVA)</th><th>Governed by</th><th>Recommended</th><th>Installed (kVA)</th><th>Status</th></tr></thead><tbody><tr><td>${n(s.generator.demandKva)}</td><td>${n(s.generator.requiredKva)}</td><td>${esc(s.generator.governing)}</td><td>${s.generator.recommended ? esc(s.generator.recommended) : '<span class="bad">Above the largest standard set</span>'}</td><td>${s.generator.installedKva ? n(s.generator.installedKva) : valueOrMissing()}</td><td class="${s.generator.status}">${LABEL[s.generator.status]}</td></tr></tbody></table>`
    : '<p class="note">No standby generator: no board or essential load is on a generator.</p>'}
  <h3>Main LV distribution</h3>
  ${list(s.arrangement, 'No main board.')}
  <h3>Major design findings</h3>
  ${s.findings.length ? `<table><thead><tr><th>Status</th><th>Finding</th></tr></thead><tbody>${s.findings.map((f) => `<tr><td class="${f.status}">${LABEL[f.status]}</td><td>${esc(f.text)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No studies in this report.</p>'}
  <p class="caption">Whole installation, from the latest calculation run. Section results are for the scope of this report.</p>`;

  const scope = `
  ${b.scope.defined ? '' : '<p class="warning">The project scope is not defined (Project → Brief). Included and excluded systems are not listed.</p>'}
  <h3>Electrical systems included</h3>${b.scope.defined ? list(b.scope.included, NOT_DEFINED) : `<p class="missing">${NOT_DEFINED}</p>`}
  <h3>Electrical systems excluded</h3>${b.scope.defined ? list(b.scope.excluded, 'None — every system the app covers is in scope.') : `<p class="missing">${NOT_DEFINED}</p>`}
  <h3>Design boundaries</h3>${list(b.scope.boundaries, NOT_DEFINED)}`;

  const sys = b.system;
  const system = `
  <h3>Incoming supply</h3>${list(sys.supply, 'No main board.')}
  <h3>MV / LV arrangement and transformers</h3>${list(sys.transformers, 'No transformer is defined.')}
  <h3>Main LV distribution</h3>${list(sys.distribution, NOT_DEFINED)}
  <h3>Emergency supply</h3>${sys.emergency.length ? list(sys.emergency, '') : '<p class="note">None defined in the project.</p>'}
  <h3>UPS</h3>${sys.ups.length ? list(sys.ups, '') : '<p class="note">None defined in the project.</p>'}
  ${sys.other.length ? `<h3>Other systems</h3>${list(sys.other, '')}` : ''}`;

  const st = b.standards;
  const standards = `
  <h3>Project and authority requirements</h3>
  <table class="meta"><tbody><tr><th>Approving authority</th><td>${valueOrMissing(st.authority)}</td></tr></tbody></table>
  ${st.project.length ? list(st.project, '') : '<p class="warning">No project standards or specifications are defined (Reports → Study reports → Output). None are assumed.</p>'}
  <h3>Calculation basis</h3>
  ${st.methods.length ? `<table><thead><tr><th>Standard</th><th>Used for</th></tr></thead><tbody>${st.methods.map((m) => `<tr><td>${esc(m.standard)}</td><td>${esc(m.used)}</td></tr>`).join('')}</tbody></table>
  <p class="caption">The methods the app's calculations follow for the studies in this report. They are not a statement of the project's contractual standards.</p>` : '<p class="note">No study in this report uses a standard method.</p>'}`;

  const criteria = `
  <table><thead><tr><th>Parameter</th><th>Design value</th><th>Source</th><th>Note</th></tr></thead><tbody>${b.criteria.map((c) =>
    `<tr><td>${esc(c.parameter)}</td><td>${valueOrMissing(c.value)}</td><td>${esc(c.source)}</td><td>${c.flag ? `<span class="missing">${esc(c.flag)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;

  return [
    { title: 'Executive summary', html: exec },
    { title: 'Project scope', html: scope },
    { title: 'Electrical system description', html: system },
    { title: 'Codes and standards', html: standards },
    { title: 'Design criteria', html: criteria }
  ];
}
