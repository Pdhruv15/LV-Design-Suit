import { evaluateProject, resistanceFactor, type Status } from '../calc/electrical';
import { evaluateEarthingAll } from '../calc/earthing';
import { evaluateSelectivity } from '../calc/protection';
import { cableDataNotice } from '../calc/cableTable';
import { CALC_DISCLAIMER, STATUS_TEXT } from '../calc/statusText';
import { settingsOf } from '../calc/sizing';
import { withNetwork } from '../calc/network/index';
import type { Project, StudyReportKind } from '../types';
import { DEFAULT_CABLE_TYPE } from '../types';
import { buildCalcRecord, calcRecordHtml } from './calcRecord';
import { unresolvedChecks } from './issuePackage';
import { printDoc } from './printDoc';
import { PRINT, statusSpan } from './printStyles';
import { destMarker } from './outline';
import { ATTENTION_MAX, esc, PLAIN_CSS, reportHead, tally } from './report';
import { buildSection, kvHtml, scopeOf, tableHtml, type CalcData, type Scope, type Section } from './studyReport';
import pkg from '../../package.json';
import { displayVersion } from '../model/appVersion';

/** The standalone calculation report: a compact A4-landscape print with the document block,
 * results summary and design basis on page 1, then the calculation sections. Every section is
 * the study report's own (buildSection), so the figures, columns and statuses are the same in
 * both reports; this file only lays them out. */

/** The studies the calculation report carries, in order. */
export const CALC_REPORT_STUDIES: StudyReportKind[] = ['load', 'sizing', 'cable', 'lf', 'sc', 'earth', 'disc', 'pfc', 'schedules'];

const LABEL: Record<Status, string> = STATUS_TEXT;
const worst = (xs: Status[]): Status => (xs.includes('bad') ? 'bad' : xs.includes('warn') ? 'warn' : 'ok');
const counts = (xs: Status[]) => { const t = tally(xs); return `${t.ok} pass · ${t.warn} warning · ${t.bad} fail`; };

/** One calculation of the whole network: what the report prints and the pre-export check reads. */
export function calcReportData(project: Project): { data: CalcData; scope: Scope; sections: Section[] } {
  const { results, earthing, selectivity } = withNetwork(project, () => ({ results: evaluateProject(project), earthing: evaluateEarthingAll(project), selectivity: evaluateSelectivity(project) }));
  const data: CalcData = { project, results, earthing, selectivity };
  const scope = scopeOf(project, { boards: [], downstream: true });
  return { data, scope, sections: CALC_REPORT_STUDIES.map((k) => buildSection(k, data, scope)) };
}

/** The sections of the calculation report, from one calculation of the whole network. */
export const calcReportSections = (project: Project): Section[] => calcReportData(project).sections;

/** One section, compact: status, input and criteria, method, results, then every table (no appendices here). */
function sectionHtml(s: Section, no: number): string {
  const w = worst(s.statuses);
  const summary = s.summary.length ? `<table class="kv"><tbody>${s.summary.map((k) => `<tr><th>${esc(k.label)}</th><td${k.status ? ` class="${k.status}"` : ''}>${esc(k.value)}</td></tr>`).join('')}</tbody></table>` : '';
  return `
<section class="calc" id="calc-${no}">
<h2>${destMarker(`calc-${no}`, `${no}. ${s.title}`)}${no}. ${esc(s.title)}</h2>
${s.statuses.length ? `<p class="overall">Overall status: <b class="${w}">${statusSpan(LABEL[w])}</b> <span class="m">(${counts(s.statuses)})</span></p>` : ''}
${s.inputs?.length ? `<h3>Input</h3>${kvHtml(s.inputs)}` : ''}${s.criteria?.length ? `<h3>Design criteria</h3>${kvHtml(s.criteria)}` : ''}
<h3>Method</h3><ul class="method">${s.method.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
${summary ? `<h3>Result</h3>${summary}` : ''}
${s.tables.map(tableHtml).join('')}
${s.verification ? tableHtml({ ...s.verification, title: `Verification — ${s.verification.title}` }) : ''}
</section>`;
}

const CALC_CSS = `<style>
.calc table { border-collapse: collapse; width: 100%; margin: 1mm 0 3mm; font-size: ${PRINT.table}; }
.calc th, .calc td { border: ${PRINT.thin} solid ${PRINT.rule}; padding: 1.1mm 1.6mm; text-align: left; vertical-align: top; }
.calc thead { display: table-header-group; } .calc thead th, .calc .kv th { background: ${PRINT.fill}; } .calc .kv th { width: 32%; font-weight: 400; }
.calc tr { break-inside: avoid; } .calc h2 { margin-top: 7mm; } .calc h3 { text-transform: none; font-size: 9.5pt; margin: 4mm 0 1.5mm; break-after: avoid; }
.calc .overall { font-size: 10pt; margin: 0 0 2mm; } ul.method { margin: 0 0 1mm 5mm; color: ${PRINT.ink2}; } ul.method li { margin: 0 0 0.6mm; }
</style>`;

/** Self-contained, print-ready HTML calculation report (A4 landscape). */
export function buildReportHtml(project: Project): string {
  const sections = calcReportSections(project);
  const settings = settingsOf(project);
  // Page 1 lists what fails or needs a look, worst first (the issue package's own list), so nobody has to scan the tables.
  const attention = unresolvedChecks(sections);
  const shown = attention.slice(0, ATTENTION_MAX);
  const rated = sections.filter((s) => s.statuses.length);
  const summary = `<div class="sum"><table class="grid"><thead><tr><th>Study</th><th>Pass</th><th>Warning</th><th>Fail</th></tr></thead><tbody>${rated.map((s) => {
    const t = tally(s.statuses);
    return `<tr><td>${esc(s.title)}</td><td>${t.ok}</td><td>${t.warn}</td><td class="bad">${t.bad}</td></tr>`;
  }).join('')}</tbody></table>
    <div class="box"><b>${attention.length ? `Needs attention (${attention.length})` : 'Nothing needs attention — every check passes'}</b>${shown.length ? `<table>${shown.map((a) => `<tr><td>${esc(a.item === '—' ? a.study : a.item)}</td><td><span class="${a.status}">${LABEL[a.status]}</span> — ${esc(a.study)}: ${esc(a.check)}${a.value && a.value !== LABEL[a.status] ? ` — ${esc(a.value)}` : ''}</td></tr>`).join('')}</table>` : ''}
    ${attention.length > ATTENTION_MAX ? `<p class="note">…and ${attention.length - ATTENTION_MAX} more — all ${attention.length} are listed under “Items needing attention” below.</p>` : ''}</div></div>`;
  // Every failed or unverified check, none left out: the page-1 box shows the first ones, this lists them all.
  const allItems = attention.length > ATTENTION_MAX ? `<h2 id="attention">${destMarker('attention', `Items needing attention (all ${attention.length})`)}Items needing attention (all ${attention.length})</h2>
<table class="grid"><thead><tr><th>Status</th><th>Study</th><th>Item</th><th>Check</th><th>Value</th></tr></thead><tbody>${attention.map((a) => `<tr><td class="${a.status}">${statusSpan(LABEL[a.status])}</td><td>${esc(a.study)}</td><td>${esc(a.item)}</td><td>${esc(a.check)}</td><td>${esc(a.value)}</td></tr>`).join('')}</tbody></table>` : '';
  const cableTypes = [...new Set(project.feeders.map((x) => x.cableType || DEFAULT_CABLE_TYPE))];
  const basis = [
    ['System', `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S (as calculated)`],
    ['Design ambient temperature', `${project.ambientC} °C`],
    ['Voltage drop limit (source to load)', `${project.vdLimitPct} %`],
    ['Cable', `Copper; ${cableTypes.join(', ')}; rated for each circuit's installation method (IEC 60364-5-52)`],
    ['Standards', 'IEC 60364-4-41, 4-43, 5-52, 5-54; IEC 60909-based simplified fault levels (preliminary); IEC 60898 / 60947-2 (breakers)'],
    ['Sizing targets', `Transformer ≤ ${settings.transformerMaxLoadingPct}% with ${settings.futureGrowthPct}% growth; generator ≤ ${settings.generatorMaxLoadingPct}%; PF target ${settings.pfTarget}`]
  ];
  const statuses = sections.flatMap((s) => s.statuses);

  const body = `${PLAIN_CSS}${CALC_CSS}
${reportHead(project, 'Calculation report', project.calcReportDocNo)}

<h2 id="summary">${destMarker('summary', 'Results summary')}Results summary</h2>${summary}
${allItems}

<h2 id="basis">${destMarker('basis', 'Design basis')}Design basis</h2><table class="grid"><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>${basis.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>

${sections.map((s, i) => sectionHtml(s, i + 1)).join('')}

<section class="calc" id="assumptions">
<h2>${destMarker('assumptions', `${sections.length + 1}. Assumptions and limitations`)}${sections.length + 1}. Assumptions and limitations</h2><ul>
  <li>Upstream MV network treated as infinite; transformer %Z split into R and X by its X/R ratio (default 5).</li>
  <li>Fault levels follow IEC 60909-0 in a simplified form, not a full study: maximum currents for breaking capacity with c<sub>max</sub> = 1.05 and cable R at 20 °C; minimum currents for earth-fault disconnection with c<sub>min</sub> = ${0.95} and cable R at operating temperature; transformer correction K<sub>T</sub> not applied; loads, motor contribution and generation are neglected.</li>
  <li>Cable ratings: the rating for each circuit's IEC 60364-5-52 installation method (E free air / tray unless set), derated for air ambient or, for buried cables, ground temperature and soil thermal resistivity, and for grouping (the cable tray route for method E, else the circuit's own parallel runs). A circuit without a rating for its method is DATA REQUIRED.</li>
  <li>Cable resistance at operating temperature = 1.2 × R20 (IEC 60228)${project.vdTempC === undefined ? '' : `; voltage drop at ${project.vdTempC} °C = R20 × ${resistanceFactor(project.vdTempC).toFixed(3)}`}; protective conductor per IEC 60364-5-54 Table 54.2 unless specified. Maximum fault levels use R at 20 °C.</li>
  <li>Selectivity is assessed from current thresholds only; confirm with the breaker manufacturer's selectivity tables.</li>
  <li>Busbar voltages are measured from the main board busbar and exclude transformer regulation.</li>
</ul>
<p class="note">Generated by LV Design Studio ${esc(displayVersion(pkg.version))}. ${esc(CALC_DISCLAIMER)} Results must be checked by a qualified engineer before use.${cableDataNotice(project) ? ` <b>${esc(cableDataNotice(project))}</b>` : ''}</p>
${calcRecordHtml(buildCalcRecord(project, { statuses, warningsAt: 'see the results summary on page 1' }), `<h2 id="record">${destMarker('record', 'Calculation record')}Calculation record</h2>`)}
</section>
`;

  return printDoc(project, { title: `${project.name} — LV calculation report`, headRight: 'Calculation report',
    footer: `LV Design Studio ${displayVersion(pkg.version)} · Results must be checked by a qualified engineer`, body, landscape: true });
}
