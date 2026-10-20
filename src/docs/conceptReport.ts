import type { Project } from '../types';
import { systemSummary } from '../calc/summary';
import { dmSubstationAreas, substationsFromProject } from '../calc/dmSubstation';
import { revisionStamp } from '../model/revisions';
import { STAGE_INFO } from '../model/designStage';
import { laBandText, laGenText, laTxText, loadAssessmentBasis, type LoadAssessmentBasis } from './designBasis';
import { PRINT_BASE_CSS } from './printStyles';
import { esc } from './report';

/** The concept design report: one A4 page, black and white, for the end of the concept stage — building, area
 * schedule, maximum demand, supply and the room areas the architect must reserve. Built only from figures the app
 * already calculates (load assessment, DM-D-013 areas); a figure that is not there prints as "to confirm". */

export interface ConceptRoom { name: string; transformers: number; kva?: number; substationM2?: number; lvM2?: number; totalM2?: number; error?: string }
export interface ConceptReport {
  project: { name: string; plot?: string; owner?: string; consultant?: string; stamp: string; date: string; preparedBy?: string };
  la?: LoadAssessmentBasis;
  /** Without a load assessment: the load on the SLD as it stands. */
  designed?: { connectedKw: number; demandKw: number; demandKva: number; pf: number };
  rooms: ConceptRoom[];
  roomSource: 'project' | 'space plan' | 'SLD' | 'none';
  confirm: string[];
}

const n = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const TO_CONFIRM = 'to confirm';

export function conceptReport(p: Project, o: { preparedBy?: string; date?: string } = {}): ConceptReport {
  const la = p.loadAssessment ? loadAssessmentBasis(p.loadAssessment) : undefined;
  const sys = la ? undefined : systemSummary(p);
  const fromPlan = p.substations?.length ? undefined : substationsFromProject(p);
  const subs = p.substations?.length ? p.substations : fromPlan!.rooms;
  const rooms = subs.map((s): ConceptRoom => {
    const r = dmSubstationAreas(s.type, s.transformers);
    const area = (k: string) => r.rooms.find((x) => x.key === k)?.areaM2;
    return { name: s.name, transformers: s.transformers, kva: s.kva, substationM2: area('substation') ?? area('transformer'), lvM2: area('lv'), totalM2: r.error ? undefined : r.totalAreaM2, error: r.error };
  });
  const confirm: string[] = [];
  if (!la) confirm.push('No load assessment yet: the load shown is the load entered on the SLD (1 Concept → Load assessment).');
  else {
    confirm.push('Load densities and service factors are typical values — to verify against the authority’s figures and your own library.');
    if (!la.inBand) confirm.push(`Load density ${laBandText(la)}.`);
    if (Math.abs(la.pctTotal - 100) > 0.5) confirm.push(`The area schedule adds up to ${n(la.pctTotal, 1)} % of the GFA.`);
    if (la.notSelected.length) confirm.push(`Services not included: ${la.notSelected.join(', ')} — to confirm with the MEP consultant.`);
    if (la.generator || la.generatorKvaRequired > 0) confirm.push('Generator room size depends on the selected set.');
  }
  if (!rooms.length) confirm.push('No substation defined: room areas to confirm (1 Concept → Substation area).');
  else if (!p.substations?.length) confirm.push(`Substation rooms taken from the ${fromPlan!.source}; set the substation type in 1 Concept → Substation area.`);
  const info = p.info ?? {};
  return {
    project: { name: p.name, plot: info.plotNo, owner: info.owner, consultant: info.consultant, stamp: revisionStamp(p), date: o.date ?? new Date().toISOString().slice(0, 10), preparedBy: o.preparedBy?.trim() || undefined },
    la, designed: sys && { connectedKw: sys.connectedKw, demandKw: sys.demandKw, demandKva: sys.demandKva, pf: sys.powerFactor },
    rooms, roomSource: p.substations?.length ? 'project' : fromPlan!.source, confirm
  };
}

const kv = (rows: [string, string][]) => `<table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

export function conceptReportHtml(r: ConceptReport): string {
  const la = r.la, pj = r.project;
  const building = la
    ? kv([['Building type', esc(la.typeLabel)], ['GFA above ground', `${n(la.gfaM2)} m²`], ['Floors above ground', n(la.floors)], ['Basement car park', la.parkingM2 ? `${n(la.parkingM2)} m²` : 'None']])
    : `<p class="missing">Building type and GFA ${TO_CONFIRM} — no load assessment.</p>`;
  const areas = la ? `<table><thead><tr><th>Space</th><th class="r">% of GFA</th><th class="r">Area (m²)</th><th class="r">Lighting (W/m²)</th><th class="r">Small power (W/m²)</th><th class="r">Cooling, thermal (W/m²)</th></tr></thead><tbody>${la.rows.map((x) =>
    `<tr><td>${esc(x.label)}</td><td class="r">${n(x.pct, 1)}</td><td class="r">${n(x.areaM2)}</td><td class="r">${n(x.ltg, 1)}</td><td class="r">${n(x.pwr, 1)}</td><td class="r">${n(x.clg)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td class="r">${n(la.pctTotal, 1)}</td><td class="r">${n(la.areaM2)}</td><td colspan="3"></td></tr></tbody></table>`
    : `<p class="missing">Area schedule ${TO_CONFIRM}.</p>`;
  const demand = la ? `<table><thead><tr><th>Category</th><th class="r">Connected (kW)</th><th class="r">Diversity</th><th class="r">Demand (kW)</th></tr></thead><tbody>${la.categories.map((c) =>
    `<tr><td>${esc(c.label)}</td><td class="r">${n(c.connectedKw, 1)}</td><td class="r">${c.diversity === undefined ? '—' : n(c.diversity, 2)}</td><td class="r">${c.demandKw === undefined ? '—' : n(c.demandKw, 1)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td class="r">${n(la.connectedKw, 1)}</td><td></td><td class="r">${n(la.sumDemandKw, 1)}</td></tr></tbody></table>
    ${kv([['Maximum demand', `<b>${n(la.mdKw, 1)} kW · ${n(la.mdKva, 1)} kVA</b> (coincidence ${n(la.coincidence, 2)}${la.sparePct ? `, ${n(la.sparePct)} % future spare` : ''}, PF ${n(la.pf, 2)})`], ['Load density', esc(laBandText(la))], ['Essential (generator) demand', `${n(la.generatorKw, 1)} kW`]])}`
    : r.designed ? kv([['Connected load (SLD)', `${n(r.designed.connectedKw, 1)} kW`], ['Maximum demand (SLD)', `<b>${n(r.designed.demandKw, 1)} kW · ${n(r.designed.demandKva, 1)} kVA</b> (PF ${n(r.designed.pf, 2)})`]]) : '';
  const supply = la ? kv([
    ['Transformers', la.tx ? `${esc(laTxText(la.tx))}, each loaded to ${n(la.tx.maxLoadingPct)} % or less, ${n(la.tx.voltage)} V` : `<span class="missing">${la.mdKva > 0 ? 'No size fits — check the sizes and maximum loading' : TO_CONFIRM}</span>`],
    ...(la.tx ? [['LV incomer per transformer', `${n(la.tx.incomerA)} A`] as [string, string]] : []),
    ['Standby generator', `${esc(laGenText(la))}${la.generatorKvaRequired > 0 ? ` (${n(la.generatorKvaRequired)} kVA required)` : ''}`]
  ]) : `<p class="missing">Transformers and generator ${TO_CONFIRM} — size them from the load assessment.</p>`;
  const rooms = r.rooms.length ? `<table><thead><tr><th>Substation</th><th class="r">Transformers</th><th class="r">Substation / transformer room (m²)</th><th class="r">LV room (m²)</th><th class="r">Total (m²)</th></tr></thead><tbody>${r.rooms.map((x) =>
    `<tr><td>${esc(x.name)}</td><td class="r">${x.transformers}${x.kva ? ` × ${n(x.kva)} kVA` : ''}</td>${x.error ? `<td colspan="3">${esc(x.error)}</td>` : `<td class="r">${x.substationM2 === undefined ? '—' : `min. ${n(x.substationM2, 2)}`}</td><td class="r">${x.lvM2 === undefined ? '—' : `min. ${n(x.lvM2, 2)}`}</td><td class="r">${x.totalM2 === undefined ? '—' : n(x.totalM2, 2)}</td>`}</tr>`).join('')}</tbody></table>
    <p class="note">Minimum areas to Dubai Municipality DM-D-013. Generator room and electrical risers: ${TO_CONFIRM}.</p>`
    : `<p class="missing">Substation and LV room areas ${TO_CONFIRM}.</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pj.name)} — concept design report</title><style>
@page { size: A4 portrait; margin: 12mm; }
${PRINT_BASE_CSS}
.hd { display: flex; justify-content: space-between; gap: 6mm; border: 1.2pt solid #000; padding: 2mm 3mm; margin-bottom: 2mm; }
.hd .rt { text-align: right; } .hd h1 { font-size: 14pt; }
h2 { margin-top: 10px; }
.r { text-align: right; }
table.kv th { width: 34%; }
.ft { border-top: 1.2pt solid #000; margin-top: 4mm; padding-top: 1.5mm; display: flex; justify-content: space-between; color: #444; font-size: 7.5pt; }
</style></head><body>
<div class="hd"><div><h1>Concept design report — electrical</h1><div>${esc(pj.name)}${pj.plot ? `, plot ${esc(pj.plot)}` : ''}${pj.owner ? ` · Owner: ${esc(pj.owner)}` : ''}${pj.consultant ? ` · Consultant: ${esc(pj.consultant)}` : ''}</div></div>
<div class="rt"><b>${esc(STAGE_INFO.concept.sheetStatus)}</b><br>${esc(pj.stamp)}<br>Printed ${esc(pj.date)}${pj.preparedBy ? `<br>Prepared by: ${esc(pj.preparedBy)}` : ''}</div></div>
<h2>1. Building</h2>${building}
<h2>2. Area schedule and load densities</h2>${areas}
<h2>3. Maximum demand</h2>${demand}
<h2>4. Supply</h2>${supply}
<h2>5. Space requirements</h2>${rooms}
<h2>6. Assumptions and items to confirm</h2><ul>${r.confirm.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
<div class="ft"><span>Concept estimates — refined at schematic and detailed design. Engineering review is required.</span><span>${esc(pj.stamp)}</span></div>
</body></html>`;
}

export const buildConceptReportHtml = (p: Project, o: { preparedBy?: string; date?: string } = {}) => conceptReportHtml(conceptReport(p, o));
