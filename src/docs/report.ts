import { evaluateProject, type Status } from '../calc/electrical';
import { cableDataNotice } from '../calc/cableTable';
import { CALC_DISCLAIMER } from '../calc/statusText';
import { STATUS_TEXT, statusOfText } from '../calc/statusText';
import { evaluateEarthingAll, breakerTypeOf, disconnectionLabel, loopFigures } from '../calc/earthing';
import { evaluateSelectivity } from '../calc/protection';
import { boardSummary, boardsInSupplyOrder, systemSummary } from '../calc/summary';
import { settingsOf } from '../calc/sizing';
import { resistanceFactor } from '../calc/electrical';
import { sizeGeneratorByBoards, sizeTransformers, txGenPlanOf } from '../calc/txGen';
import { planPfc, STRATEGY_LABEL } from '../calc/pfc';
import { cableSchedule, dbSchedule, type Schedule } from './schedules';
import type { Project } from '../types';
import { DEFAULT_CABLE_TYPE } from '../types';
import { currentRevision } from '../model/revisions';
import { printDoc } from './printDoc';
import pkg from '../../package.json';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const f = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const LABEL: Record<Status, string> = STATUS_TEXT;
const st = (s: Status) => `<td class="${s}">${LABEL[s]}</td>`;

function table(headers: string[], rows: string[][], totalRows: number[] = []): string {
  return `<table class="grid"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r, i) => `<tr${totalRows.includes(i) ? ' class="total"' : ''}>${r.map((c) => (c.startsWith('<td') ? c : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

const scheduleTable = (s: Schedule) =>
  table(s.headers, s.rows.map((r) => r.map((c) => (statusOfText(c) ? st(statusOfText(c)!) : esc(c)))), s.totalRows);

export const tally = (statuses: Status[]) => {
  const n = (s: Status) => statuses.filter((x) => x === s).length;
  return { ok: n('ok'), warn: n('warn'), bad: n('bad') };
};
function counts(statuses: Status[]) {
  const t = tally(statuses);
  return `${t.ok} pass · ${t.warn} warning · <span class="bad">${t.bad} fail</span>`;
}

/** Black-and-white additions to the plain print document (calculation and voltage drop
 * reports): status in words (fails bold), tables that repeat their header on each page,
 * and the page-1 document block. */
export const PLAIN_CSS = `<style>
html, body { background: #fff; color-scheme: light; }
@media screen { body { padding: 21mm 14mm 16mm 16mm; } } /* on-screen preview: the printed page's margins */
table.grid { margin: 1mm 0 3mm; font-size: 7.6pt; } table.grid thead { display: table-header-group; } table.grid tr { break-inside: avoid; }
table.grid tr.total td { font-weight: 700; background: #f2f2f2; } h2 { margin: 5mm 0 2mm; break-after: avoid; }
.bad { font-weight: 700; } .m, .note { color: #444; }
.head { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; margin-bottom: 2mm; }
.head h1 { font-size: 18pt; margin: 0.5mm 0 1mm; } table.doc { width: 95mm; margin: 0; font-size: 8pt; } table.doc th { width: 20mm; }
.sum { display: grid; grid-template-columns: 70mm 1fr; gap: 4mm; align-items: start; } .sum .box { margin: 1mm 0 3mm; }
.sum .box table td { padding: 0.6mm 2mm 0.6mm 0; vertical-align: top; }
</style>`;

/** How many failing / warning items page 1 lists before pointing to the tables. */
export const ATTENTION_MAX = 10;

/** Page-1 heading of a plain report: title and project on the left, the document block on
 * the right (doc no., rev from the current revision, date, prepared / checked / approved
 * from Parameters). Blank cells are left for signing by hand. */
export function reportHead(project: Project, title: string, docNo?: string, extra = ''): string {
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const rev = currentRevision(project);
  const prm = project.params ?? {};
  const cell = (v?: string, span = 1) => `<td${span > 1 ? ` colspan="${span}"` : ''}${v?.trim() ? '' : ' class="sig"'}>${esc(v?.trim() ?? '')}</td>`;
  const place = [project.info?.plotNo && `Plot ${project.info.plotNo}`, project.info?.area].filter(Boolean).join(', ');
  return `<div class="head"><div><div class="k">LV electrical</div><h1>${esc(title)}</h1><p>${esc(project.name)}${place ? ` · ${esc(place)}` : ''}${extra ? ` · ${esc(extra)}` : ''}</p></div>
<table class="grid doc">
    <tr><th>Doc no.</th>${cell(docNo)}<th>Rev</th>${cell(rev?.id)}</tr>
    <tr><th>Date</th>${cell(date, 3)}</tr>
    <tr><th>Prepared</th>${cell(prm.designedBy)}<th>Checked</th>${cell(prm.checkedBy)}</tr>
    <tr><th>Approved</th>${cell(prm.approvedBy, 3)}</tr></table></div>`;
}

/** Print styles shared by the PDF reports (A4 landscape). */
export const REPORT_CSS = `
    @page { size: A4 landscape; margin: 14mm 12mm; }
    body { font: 10px/1.45 "Segoe UI", system-ui, sans-serif; color: #17202e; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 13px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #1d4f8f; color: #1d4f8f; break-after: avoid; }
    .sub { color: #5b6b82; margin: 0 0 12px; } .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
    .kpi { border: 1px solid #d5dce6; border-radius: 6px; padding: 6px 8px; } .kpi b { display: block; font-size: 14px; } .kpi span { color: #5b6b82; }
    table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; } th, td { border: 1px solid #d5dce6; padding: 3px 5px; text-align: left; }
    th { background: #eef2f7; font-weight: 600; } tr { break-inside: avoid; } tr.total td { background: #f5f7fa; font-weight: 600; }
    .ok { color: #13803d; } .warn { color: #a86500; } .bad { color: #c21f32; font-weight: 600; }
    ul { margin: 4px 0; padding-left: 18px; } .note { color: #5b6b82; }`;

/** Self-contained, print-ready HTML calculation report (A4 landscape). */
export function buildReportHtml(project: Project): string {
  const results = evaluateProject(project);
  const earthing = evaluateEarthingAll(project);
  const selectivity = evaluateSelectivity(project);
  const sys = systemSummary(project);
  // The same sizing as the Transformer & generator and Power factor pages (size list, duty / standby, generator boards, motor start, PFC strategy and steps).
  const txPlan = txGenPlanOf(project);
  const tx = sizeTransformers(project, txPlan);
  const gen = sizeGeneratorByBoards(project, txPlan);
  const settings = settingsOf(project);
  const pfcRes = planPfc(project);
  const boards = boardsInSupplyOrder(project).map((b) => boardSummary(project, b));




  const section = (title: string, body: string) => `<h2>${esc(title)}</h2>${body}`;
  // Page 1 lists what fails or needs a look, worst first, so nobody has to scan the tables.
  const attention: { st: Status; where: string; what: string }[] = [
    ...results.filter((r) => r.status !== 'ok').map((r) => ({ st: r.status, where: `${r.feeder.boardId} / ${r.feeder.id}`, what: `Feeder — ${[
      r.protectionStatus !== 'ok' && `Ib ${f(r.ib)} A, In ${r.feeder.breakerRatingA} A, Iz ${f(r.ampacity)} A`,
      r.vdStatus !== 'ok' && `voltage drop ${r.vdTotalPct.toFixed(2)} % of ${project.vdLimitPct} %`,
      r.icuStatus !== 'ok' && `Icu ${r.feeder.breakerIcuKa} kA vs ${f(r.breakerFaultKA, 1)} kA fault`
    ].filter(Boolean).join('; ') || LABEL[r.status]}` })),
    ...earthing.filter((r) => r.status !== 'ok').map((r) => ({ st: r.status, where: `${r.feeder.boardId} / ${r.feeder.id}`, what: `Earthing — ${[
      r.disconnection !== 'ok' && `${disconnectionLabel(r)} (Zs ${loopFigures(r).zs} Ω, max ${r.maxZsOhm.toFixed(4)} Ω)`,
      r.adiabatic !== 'ok' && (Number.isFinite(r.adiabaticMinMm2) ? `CPC ${r.cpcMm2} mm², minimum ${r.adiabaticMinMm2.toFixed(1)} mm²` : 'CPC not verified')
    ].filter(Boolean).join('; ') || LABEL[r.status]}` })),
    ...selectivity.filter((r) => r.status !== 'ok').map((r) => ({ st: r.status, where: `${r.upstream.id} → ${r.downstream.id}`,
      what: `Coordination — selectivity limit ${f(r.limitKA, 1)} kA, fault ${f(r.faultKA, 1)} kA` }))
  ].sort((a, b) => (a.st === b.st ? 0 : a.st === 'bad' ? -1 : 1));
  const shown = attention.slice(0, ATTENTION_MAX);
  const studies: [string, Status[]][] = [['Feeders', results.map((r) => r.status)], ['Earthing', earthing.map((r) => r.status)], ['Coordination', selectivity.map((r) => r.status)]];
  const summary = `<div class="sum">${table(['Study', 'Pass', 'Warning', 'Fail'], studies.map(([n, ss]) => { const t = tally(ss); return [esc(n), String(t.ok), String(t.warn), `<td class="bad">${t.bad}</td>`]; }))}
    <div class="box"><b>${attention.length ? `Needs attention (${attention.length})` : 'Nothing needs attention — every check passes'}</b>${shown.length ? `<table>${shown.map((a) => `<tr><td>${esc(a.where)}</td><td><span class="${a.st}">${LABEL[a.st]}</span> — ${esc(a.what)}</td></tr>`).join('')}</table>` : ''}
    ${attention.length > ATTENTION_MAX ? `<p class="note">…and ${attention.length - ATTENTION_MAX} more — see the tables below.</p>` : ''}</div></div>`;
  const cableTypes = [...new Set(project.feeders.map((x) => x.cableType || DEFAULT_CABLE_TYPE))];

  const body = `${PLAIN_CSS}
${reportHead(project, 'Calculation report', project.calcReportDocNo)}

${section('Results summary', summary)}

${section('Design basis', table(['Parameter', 'Value'], [
    ['System', `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S (as calculated)`],
    ['Design ambient temperature', `${project.ambientC} °C`],
    ['Voltage drop limit (source to load)', `${project.vdLimitPct} %`],
    ['Cable', `Copper; ${cableTypes.join(', ')}; reference installation in free air`],
    ['Standards', 'IEC 60364-4-41, 4-43, 5-52, 5-54; IEC 60909-based simplified fault levels (preliminary); IEC 60898 / 60947-2 (breakers)'],
    ['Sizing targets', `Transformer ≤ ${settings.transformerMaxLoadingPct}% with ${settings.futureGrowthPct}% growth; generator ≤ ${settings.generatorMaxLoadingPct}%; PF target ${settings.pfTarget}`]
  ].map((r) => r.map(esc))))}

${section('System summary', `${table(['Connected load', 'Maximum demand', 'Power factor / current', 'Transformer loading'], [[
    `${f(sys.connectedKw)} kW`, `${f(sys.demandKw)} kW · ${f(sys.demandKva)} kVA`, `${sys.powerFactor.toFixed(2)} · ${f(sys.currentA)} A`,
    sys.transformerLoadingPct === undefined ? '—' : `${sys.transformerLoadingPct.toFixed(0)} % of ${f(sys.transformerKva)} kVA`]])}
  ${table(['Item', 'Result'], [
    ...tx.map((r) => [`Transformer (${r.board.id})`, `Requirement ${f(r.designKva)} kVA → recommended ${r.recommendedKva ? `${r.split > 1 ? `${r.split} × ` : r.n1 ? '2 × ' : ''}${r.recommendedKva} kVA${r.n1 ? ' (duty / standby)' : ''}` : 'none — above the largest standard size'}; installed ${r.installedKva ? `${f(r.installedKva)} kVA` : '—'} — ${r.adequate === false || !r.recommendedKva ? 'UNDERSIZED / CHECK' : 'adequate'}`]),
    ['Standby generator', gen.demandKw > 0 || gen.recommendedKva ? `Demand ${f(gen.demandKw)} kW / ${f(gen.demandKva)} kVA → rating needed ${f(Math.max(gen.runningDesignKva, gen.startDesignKva))} kVA (${gen.governing}) → recommended ${gen.recommendedKva ? `${gen.recommendedKva} kVA / ${f(gen.recommendedKw!)} kW` : 'none — above the largest standard set'}${gen.installedKva ? `; installed ${gen.installedKva} kVA — ${gen.installedOk === false ? 'UNDERSIZED' : 'adequate'}` : ''}${gen.motor ? ` (largest motor start: ${gen.motor.feeder.id})` : ''}` : 'No boards or essential loads on a generator'],
    ...pfcRes.mains.map((p) => [`Power factor correction (${p.boardId})`, p.plannedKvar ? `${p.plannedKvar} kvar (${STRATEGY_LABEL[pfcRes.plan.strategy]}, ${pfcRes.plan.stepKvar} kvar steps): PF ${p.pfBefore.toFixed(2)} → ${p.pfAfter.toFixed(3)}, ${f(p.kvaBefore)} → ${f(p.kvaAfter)} kVA` : `Not required (PF ${p.pfBefore.toFixed(2)})`])
  ].map((r) => r.map(esc)))}
  ${table(['Board', 'Voltage (V)', '% nominal', 'Ik″ (kA)', 'Demand (kW)', 'Demand (A)', 'Rating (A)', 'Loading'],
    boards.map((b) => [esc(b.board.id), f(b.voltageV), `${b.voltagePct.toFixed(1)} %`, f(b.faultKA, 1), f(b.demandKw), f(b.currentA),
      b.board.ratedCurrentA ? f(b.board.ratedCurrentA) : '—', b.loadingPct === undefined ? '—' : `<td class="${b.loadingStatus}">${b.loadingPct.toFixed(0)} %</td>`]))}`)}

${section('Feeder calculations', `<p>${counts(results.map((r) => r.status))}</p>` + table(
    ['Circuit', 'Board', 'Ib (A)', 'Breaker', 'Iz (A)', 'Ib ≤ In ≤ Iz', 'Vd total (%)', 'Vd', 'Ik″ at breaker (kA)', 'Icu (kA)', 'Icu', 'Status'],
    results.map((r) => [esc(r.feeder.id), esc(r.feeder.boardId), f(r.ib), `${r.feeder.breakerRatingA} A ${breakerTypeOf(r.feeder)}`, f(r.ampacity),
      st(r.protectionStatus), r.vdTotalPct.toFixed(2), st(r.vdStatus), f(r.breakerFaultKA, 1), String(r.feeder.breakerIcuKa), st(r.icuStatus), st(r.status)])
  ))}

${section('Earthing — fault loop impedance and disconnection', `<p>${counts(earthing.map((r) => r.status))}</p>${(() => { const m = [...new Set(earthing.map((r) => r.sourceMissing).filter(Boolean))]; return m.length ? `<p class="bad">Not verified — ${esc(m.join('; '))}. Ze is not assumed 0; Zs shown is a minimum and If a maximum for those circuits.</p>` : ''; })()}` + table(
    ['Circuit', 'CPC (mm²)', 'Zs (Ω)', 'Max Zs (Ω)', 'If (A)', 'Ia (A)', 'Required (s)', 'Disconnection', 'CPC min, each (mm²)', 'Status'],
    earthing.map((r) => [esc(r.feeder.id), String(r.cpcMm2), esc(loopFigures(r).zs), r.maxZsOhm.toFixed(4), esc(loopFigures(r).fault), f(r.tripA), `${r.requiredS}${r.requiredBasis.startsWith('Project rule') ? ' (project rule)' : ''}${r.basisSupported ? '' : ' (not verified)'}`,
      `<td class="${r.disconnection}">${esc(disconnectionLabel(r))}</td>`,
      `<td class="${r.adiabatic}">${Number.isFinite(r.adiabaticMinMm2) ? r.adiabaticMinMm2.toFixed(1) : '—'}${r.runs > 1 ? ` <span class="m">(${r.runs} runs, ${r.cpcCurrentA.toFixed(0)} A each${r.adiabatic === 'warn' ? ', assumed equal sharing — not verified for a fault within one run' : ''})</span>` : ''}</td>`, st(r.status)])
  ))}

${section('Protection coordination', selectivity.length ? `<p>${counts(selectivity.map((r) => r.status))}</p>` + table(
    ['Upstream', 'Downstream', 'In ratio', 'Fault at downstream (kA)', 'Selectivity limit (kA)', 'Short circuit', 'Status'],
    selectivity.map((r) => [`${esc(r.upstream.id)} (${r.upstream.breakerRatingA} A)`, `${esc(r.downstream.id)} (${r.downstream.breakerRatingA} A)`, r.ratio.toFixed(2),
      f(r.faultKA, 1), f(r.limitKA, 1), r.shortCircuit === 'total' ? 'Total' : 'Partial', st(r.status)])
  ) : '<p class="note">No sub-boards — nothing to coordinate.</p>')}

${section('DB schedule', scheduleTable(dbSchedule(project)))}
${section('Cable schedule', scheduleTable(cableSchedule(project)))}

${section('Assumptions and limitations', `<ul>
  <li>Upstream MV network treated as infinite; transformer %Z split into R and X by its X/R ratio (default 5).</li>
  <li>Fault levels are a simplified estimate, not an IEC 60909 study: voltage factor c = 1 for breaking capacity (IEC 60909 uses c<sub>max</sub> = 1.05 / 1.10 at LV, and cable R at 20 °C, so its maximum can be higher) and c = ${0.95} (minimum) for earth-fault disconnection; loads, motor contribution and generation are neglected.</li>
  <li>Cable ratings: reference ampacities derated for ambient temperature and for grouping (the cable tray route the cable runs on, else its own parallel runs); other installation-method factors are not applied.</li>
  <li>Cable resistance at operating temperature = 1.2 × R20 (IEC 60228)${project.vdTempC === undefined ? '' : `; voltage drop at ${project.vdTempC} °C = R20 × ${resistanceFactor(project.vdTempC).toFixed(3)}`}; protective conductor per IEC 60364-5-54 Table 54.2 unless specified.</li>
  <li>Selectivity is assessed from current thresholds only; confirm with the breaker manufacturer's selectivity tables.</li>
  <li>Busbar voltages are measured from the main board busbar and exclude transformer regulation.</li>
</ul>
<p class="note">Generated by LV Design Studio ${esc(pkg.version)}. ${esc(CALC_DISCLAIMER)} Results must be checked by a qualified engineer before use.${cableDataNotice(project) ? ` <b>${esc(cableDataNotice(project))}</b>` : ''}</p>`)}
`;

  return printDoc(project, { title: `${project.name} — LV calculation report`, headRight: 'Calculation report',
    footer: `LV Design Studio ${pkg.version} · Results must be checked by a qualified engineer`, body, landscape: true });
}
