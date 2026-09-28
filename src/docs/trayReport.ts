import { routeSettings, SPACING_LABEL, trayQuantities, type TrayResult } from '../calc/cableTray';
import { revisionStamp } from '../model/revisions';
import type { Project, TrayPlan } from '../types';
import { lineNumbers, traySectionSvg } from './traySection';

/** Cable tray schedule as a printable document (PDF): each route with its
 * cables, its cross-section to scale and its sizing, then the summary and
 * the tray BOQ. */

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (v: number) => (Math.round(v * 10) / 10).toString();
const trayText = (r: TrayResult) => `${r.tiers > 1 ? `${r.tiers} × ` : ''}${r.widthMm} × ${r.depthMm}`;

export function buildTrayReportHtml(project: Project, plan: TrayPlan, results: TrayResult[]): string {
  const s = { ...plan.settings };
  const routes = results.map((r) => {
    const e = routeSettings(plan, r.route);
    const nums = lineNumbers(r.lines);
    const rows = r.lines.map((l) => `<tr${l.ecc ? ' class="ecc"' : ''}><td>${nums.get(l.id)}</td><td class="l">${esc(l.from)}</td><td class="l">${esc(l.to)}</td><td class="l">${esc(l.description)}${l.feederId && !l.ecc ? ` (${esc(l.feederId)})` : ''}</td><td class="l">${esc(l.ecc ? '' : l.path ?? `${r.route.name} only`)}</td><td>${l.qty}</td><td>${r1(l.odMm)}</td><td>${r1(l.kgPerM)}</td></tr>`).join('');
    const basis = e.method === 'spacing'
      ? `Single layer, spacing ${SPACING_LABEL[e.spacing]}${e.spacing === 'mm' ? ` ${e.spacingMm} mm` : ''}: Σ D ${r1(r.sumOdMm)} + spacing ${r1(r.clearanceMm)} = ${r1(r.occupiedMm)} mm`
      : `Fill ${e.fillPct} % of ${e.depthMm} mm: cable area ${Math.round(r.cableAreaMm2)} mm² → ${r1(r.occupiedMm)} mm`;
    return `
<section class="route">
  <h2>Route ${esc(r.route.name)} <small>${esc(r.route.from ?? '—')} → ${esc(r.route.to ?? '—')}${r.route.lengthM ? ` · ${r.route.lengthM} m` : ''}</small></h2>
  <div class="grid">
    <table><thead><tr><th>No.</th><th>From (panel)</th><th>To</th><th>Cable</th><th>Path</th><th>Qty</th><th>OD (mm)</th><th>kg/m</th></tr></thead><tbody>${rows || '<tr><td colspan="8">No cables</td></tr>'}</tbody></table>
    ${r.cableCount ? `<figure>${traySectionSvg(r, plan, 330)}<figcaption>Cross-section to scale — hatched = spare</figcaption></figure>` : ''}
  </div>
  <p>${esc(basis)}; + ${e.sparePct} % spare → required ${r1(r.requiredMm)} mm.</p>
  <p class="sel ${r.status}">Selected tray: ${trayText(r)} mm${r.manual ? ' (chosen)' : ''} — spare ${Math.round(r.sparePctActual)} %, cable weight ${r1(r.kgPerM)} kg/m, grouping factor ${r.groupFactor.toFixed(2)} (${r.loadedPerTier} per tier, ${r.arrangement})${r.notes.length ? ` — ${esc(r.notes.join('; '))}` : ''}</p>
</section>`;
  }).join('');
  const summary = results.map((r) => `<tr><td><b>${esc(r.route.name)}</b></td><td class="l">${esc(r.route.from ?? '')}</td><td class="l">${esc(r.route.to ?? '')}</td><td class="l">${esc(r.panels.join(', '))}</td><td>${r.cableCount}</td><td>${Math.round(r.requiredMm)}</td><td><b>${r.cableCount ? trayText(r) : '—'}</b></td><td>${Math.round(r.sparePctActual)} %</td><td>${r.groupFactor.toFixed(2)}</td><td>${r1(r.kgPerM)}</td><td>${r.route.lengthM ?? '—'}</td><td class="${r.status}">${r.status === 'ok' ? 'OK' : r.status === 'warn' ? 'Check' : 'Too small'}</td></tr>`).join('');
  const q = trayQuantities(results, s);
  const boq = q.map((x) => `<tr><td><b>${x.size}</b></td><td>${Math.round(x.lengthM)}</td><td>${x.bends}</td><td>${x.tees}</td><td>${x.reducers}</td><td>${x.risers}</td><td>${x.supports}</td><td>${x.couplers}</td>${s.covers ? `<td>${Math.round(x.coverM)}</td>` : ''}<td class="l">${esc(x.routes.join(', '))}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — cable tray schedule</title>
<style>
@page{size:A4 landscape;margin:12mm}
body{font:10px/1.35 Arial,sans-serif;color:#17202e;margin:0}
header{display:flex;justify-content:space-between;border-bottom:2px solid #17202e;padding-bottom:4px;margin-bottom:8px}
h1{font-size:15px;margin:0}h2{font-size:12.5px;margin:10px 0 4px}h2 small{font-weight:400;color:#4a5568;margin-left:8px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #9aa6b8;padding:2px 4px;text-align:center}th{background:#e9edf3}
td.l{text-align:left}tr.ecc td{color:#6a7689}
.route{page-break-inside:avoid;border-top:1px solid #cfd6e0;padding-top:4px}
.grid{display:flex;gap:10px;align-items:flex-start}.grid table{flex:1}.grid figure{margin:0;flex:0 0 auto;text-align:center}
figcaption{font-size:8.5px;color:#6a7689}
.sel{font-weight:700}.ok{color:#13803d}.warn{color:#a86500}.bad{color:#c21f32}
.basis{font-size:8.5px;color:#4a5568;margin-top:8px}
</style></head><body>
<header><h1>${esc(project.name)} — Cable tray schedule</h1><span>${esc(revisionStamp(project))}</span></header>
<p>${esc(s.trayType ?? '')}: default spare ${s.sparePct} %, ${s.method === 'spacing' ? `single layer, spacing ${SPACING_LABEL[s.spacing]}` : `fill ${s.fillPct} %`}, depth ${s.depthMm} mm, max width ${s.maxWidthMm} mm${s.includeEcc ? ', separate 1C ECC with each feeder' : ''}.</p>
${routes}
<section class="route"><h2>Summary</h2>
<table><thead><tr><th>Route</th><th>From</th><th>To</th><th>Panels</th><th>Cables</th><th>Required (mm)</th><th>Tray W × D (mm)</th><th>Spare</th><th>Grouping</th><th>kg/m</th><th>Length (m)</th><th>Status</th></tr></thead><tbody>${summary}</tbody></table></section>
${q.length ? `<section class="route"><h2>Tray BOQ</h2><table><thead><tr><th>Size W × D (mm)</th><th>Tray (m)</th><th>Bends</th><th>Tees</th><th>Reducers</th><th>Risers</th><th>Supports</th><th>Coupler sets</th>${s.covers ? '<th>Cover (m)</th>' : ''}<th>Routes</th></tr></thead><tbody>${boq}</tbody></table></section>` : ''}
<p class="basis">Tiers counted in the BOQ. Grouping factors: IEC 60364-5-52 Table B.52.20 (trays) / B.52.17 (bunched), typical values. Cable diameters: ${plan.ods ? 'project cable data' : 'typical catalogue values — confirm with the manufacturer'}.</p>
</body></html>`;
}
