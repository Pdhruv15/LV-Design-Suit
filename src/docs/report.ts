import { evaluateProject, type Status } from '../calc/electrical';
import { REFERENCE_DATA_NOTICE, usingReferenceCables } from '../calc/cableTable';
import { CALC_DISCLAIMER } from '../calc/statusText';
import { STATUS_TEXT, statusOfText } from '../calc/statusText';
import { evaluateEarthingAll, breakerTypeOf } from '../calc/earthing';
import { evaluateSelectivity } from '../calc/protection';
import { boardSummary, boardsInSupplyOrder, systemSummary } from '../calc/summary';
import { settingsOf, sizeGenerator, sizePfc, sizeTransformer } from '../calc/sizing';
import { cableSchedule, dbSchedule, type Schedule } from './schedules';
import type { Project } from '../types';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const f = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const LABEL: Record<Status, string> = STATUS_TEXT;
const st = (s: Status) => `<td class="${s}">${LABEL[s]}</td>`;

function table(headers: string[], rows: string[][], totalRows: number[] = []): string {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r, i) => `<tr${totalRows.includes(i) ? ' class="total"' : ''}>${r.map((c) => (c.startsWith('<td') ? c : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

const scheduleTable = (s: Schedule) =>
  table(s.headers, s.rows.map((r) => r.map((c) => (statusOfText(c) ? st(statusOfText(c)!) : esc(c)))), s.totalRows);

function counts(statuses: Status[]) {
  const n = (s: Status) => statuses.filter((x) => x === s).length;
  return `<span class="ok">${n('ok')} pass</span> · <span class="warn">${n('warn')} check</span> · <span class="bad">${n('bad')} fail</span>`;
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
  const tx = sizeTransformer(project);
  const gen = sizeGenerator(project);
  const settings = settingsOf(project);
  const mains = project.boards.filter((b) => !b.upstreamId);
  const pfc = mains.map((b) => sizePfc(project, b.id));
  const boards = boardsInSupplyOrder(project).map((b) => boardSummary(project, b));
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const all: Status[] = [...results.map((r) => r.status), ...earthing.map((r) => r.status), ...selectivity.map((r) => r.status)];



  const section = (title: string, body: string) => `<h2>${esc(title)}</h2>${body}`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — LV calculation report</title><style>${REPORT_CSS}</style></head><body>
<h1>${esc(project.name)}</h1>
<p class="sub">LV electrical calculation report · ${esc(date)} · Overall: ${counts(all)}</p>

${section('Design basis', table(['Parameter', 'Value'], [
    ['System', `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S`],
    ['Design ambient temperature', `${project.ambientC} °C`],
    ['Voltage drop limit (source to load)', `${project.vdLimitPct} %`],
    ['Cable', 'Copper, XLPE insulated, multicore, reference installation in free air'],
    ['Standards', 'IEC 60364-4-41, 4-43, 5-52, 5-54; IEC 60909 (fault levels); IEC 60898 / 60947-2 (breakers)'],
    ['Sizing targets', `Transformer ≤ ${settings.transformerMaxLoadingPct}% with ${settings.futureGrowthPct}% growth; generator ≤ ${settings.generatorMaxLoadingPct}%; PF target ${settings.pfTarget}`]
  ].map((r) => r.map(esc))))}

${section('System summary', `<div class="grid">
    <div class="kpi"><span>Connected load</span><b>${f(sys.connectedKw)} kW</b></div>
    <div class="kpi"><span>Maximum demand</span><b>${f(sys.demandKw)} kW · ${f(sys.demandKva)} kVA</b></div>
    <div class="kpi"><span>Power factor / current</span><b>${sys.powerFactor.toFixed(2)} · ${f(sys.currentA)} A</b></div>
    <div class="kpi"><span>Transformer loading</span><b>${sys.transformerLoadingPct === undefined ? '—' : `${sys.transformerLoadingPct.toFixed(0)} % of ${f(sys.transformerKva)} kVA`}</b></div>
  </div>
  ${table(['Item', 'Result'], [
    ['Transformer', `Requirement ${f(tx.designKva)} kVA → recommended ${tx.recommendedKva ?? '> 3150'} kVA; installed ${f(tx.installedKva)} kVA — ${tx.adequate ? 'adequate' : 'UNDERSIZED'}`],
    ['Standby generator', gen.essential.length ? `Essential demand ${f(gen.demandKva)} kVA → recommended ${gen.recommendedKva ?? '> 2500'} kVA (${gen.essential.map((x) => x.id).join(', ')})` : 'No essential loads selected'],
    ...pfc.map((p) => [`Power factor correction (${p.boardId})`, p.bankKvar ? `${p.bankKvar} kvar bank: PF ${p.pfBefore.toFixed(2)} → ${p.pfAfter.toFixed(3)}, ${f(p.currentBeforeA)} → ${f(p.currentAfterA)} A` : `Not required (PF ${p.pfBefore.toFixed(2)})`])
  ].map((r) => r.map(esc)))}
  ${table(['Board', 'Voltage (V)', '% nominal', 'Ik″ (kA)', 'Demand (kW)', 'Demand (A)', 'Rating (A)', 'Loading'],
    boards.map((b) => [esc(b.board.id), f(b.voltageV), `${b.voltagePct.toFixed(1)} %`, f(b.faultKA, 1), f(b.demandKw), f(b.currentA),
      b.board.ratedCurrentA ? f(b.board.ratedCurrentA) : '—', b.loadingPct === undefined ? '—' : `<td class="${b.loadingStatus}">${b.loadingPct.toFixed(0)} %</td>`]))}`)}

${section('Feeder calculations', `<p>${counts(results.map((r) => r.status))}</p>` + table(
    ['Circuit', 'Board', 'Ib (A)', 'Breaker', 'Iz (A)', 'Ib ≤ In ≤ Iz', 'Vd total (%)', 'Vd', 'Ik″ at breaker (kA)', 'Icu (kA)', 'Icu', 'Status'],
    results.map((r) => [esc(r.feeder.id), esc(r.feeder.boardId), f(r.ib), `${r.feeder.breakerRatingA} A ${breakerTypeOf(r.feeder)}`, f(r.ampacity),
      st(r.protectionStatus), r.vdTotalPct.toFixed(2), st(r.vdStatus), f(r.breakerFaultKA, 1), String(r.feeder.breakerIcuKa), st(r.icuStatus), st(r.status)])
  ))}

${section('Earthing — fault loop impedance and disconnection', `<p>${counts(earthing.map((r) => r.status))}</p>` + table(
    ['Circuit', 'CPC (mm²)', 'Zs (Ω)', 'Max Zs (Ω)', 'If (A)', 'Ia (A)', 'Required (s)', 'Disconnection', 'CPC min (mm²)', 'Status'],
    earthing.map((r) => [esc(r.feeder.id), String(r.cpcMm2), r.zsOhm.toFixed(4), r.maxZsOhm.toFixed(4), f(r.faultA), f(r.tripA), String(r.requiredS),
      `<td class="${r.disconnection}">${r.disconnection === 'ok' ? '&lt; 0.1 s' : r.disconnection === 'warn' ? 'Thermal — check curve' : 'Too slow'}</td>`,
      `<td class="${r.adiabatic}">${r.adiabaticMinMm2.toFixed(1)}</td>`, st(r.status)])
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
  <li>Fault levels use voltage factor c = 1 (maximum) for breaking capacity and c = ${0.95} (minimum) for earth-fault disconnection; loads and generation are neglected.</li>
  <li>Cable ratings: reference ampacities derated for ambient temperature and for grouping (the cable tray route the cable runs on, else its own parallel runs); other installation-method factors are not applied.</li>
  <li>Cable resistance at operating temperature = 1.2 × R20 (IEC 60228); protective conductor per IEC 60364-5-54 Table 54.2 unless specified.</li>
  <li>Selectivity is assessed from current thresholds only; confirm with the breaker manufacturer's selectivity tables.</li>
  <li>Busbar voltages are measured from the main board busbar and exclude transformer regulation.</li>
</ul>
<p class="note">Generated by LV Design Studio. ${esc(CALC_DISCLAIMER)} Results must be checked by a qualified engineer before use.${usingReferenceCables() ? ` <b>${esc(REFERENCE_DATA_NOTICE)}</b>` : ''}</p>`)}
</body></html>`;
}
