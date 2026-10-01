import type { Project } from '../types';
import { CONTAINMENT_LABEL, containmentSvg, type ContainmentInput, type ContainmentResult } from '../calc/containment';
import { revisionStamp } from '../model/revisions';
import { esc } from './report';

/** Custom containment report: inputs, cables, the selected size, cross-section and notes. */
export function containmentReportHtml(project: Project, i: ContainmentInput, r: ContainmentResult): string {
  const logo = project.drawing?.logo?.startsWith('data:image/') ? `<img class="logo" src="${esc(project.drawing.logo)}" alt="">` : '';
  const settings: [string, string][] = [['Containment', CONTAINMENT_LABEL[r.type]]];
  if (r.type === 'tray' || r.type === 'ladder' || r.type === 'basket') settings.push(['Laying', i.layout === 'spaced' ? 'Spaced one diameter apart' : i.layout === 'touching' ? 'Touching, single layer' : `Fill ≤ ${i.fillPct} %`], ['Side height', `${i.depthMm} mm`], ['Spare', `${i.sparePct} %`]);
  if (r.type === 'trunking') settings.push(['Space factor', `${i.fillPct} %`], ['Spare', `${i.sparePct} %`]);
  if (r.type === 'trench' || r.type === 'ducts') settings.push(['Burial depth', `${i.burialDepthM} m`], ['Soil thermal resistivity', `${i.soilResistivity} K·m/W`], ['Ground temperature', `${i.groundTempC} °C`]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — ${esc(CONTAINMENT_LABEL[r.type])}${i.title ? ` — ${esc(i.title)}` : ''}</title><style>
  @page { size: A4; margin: 12mm; } body { font: 10.5px/1.45 Arial, sans-serif; color: #111; margin: 0; }
  header { display: flex; gap: 10px; align-items: center; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 8px; } h1 { font-size: 16px; margin: 0; }
  h2 { font-size: 12.5px; margin: 14px 0 5px; color: #1d4f8f; border-bottom: 1px solid #1d4f8f; } .m { color: #555; } .logo { max-height: 12mm; max-width: 45mm; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 0.2mm solid #999; padding: 3px 6px; text-align: left; } thead th { background: #1d4f8f; color: #fff; } th.k { background: #eef2f7; width: 32%; }
  .big { font-size: 15px; font-weight: 700; } svg { width: 100%; max-height: 90mm; color: #111; }
  </style></head><body>
  <header>${logo}<div><h1>${esc(CONTAINMENT_LABEL[r.type])}${i.title ? ` — ${esc(i.title)}` : ''}</h1><div class="m">${esc(project.name)} · ${esc(revisionStamp(project))} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div></header>
  <p class="big">${esc(r.size)}${r.fillPct ? ` — fill ${r.fillPct.toFixed(0)} %` : ''}${r.soil ? ` — derating × ${r.soil.total.toFixed(2)}` : ''}</p>
  <h2>Basis</h2><table><tbody>${settings.map(([k, v]) => `<tr><th class="k">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
  <h2>Cables</h2><table><thead><tr><th>Cable</th><th>Size</th><th>Qty</th><th>OD (mm)</th><th>kg/m each</th></tr></thead><tbody>${r.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.cores}C × ${l.csaMm2} mm²</td><td>${l.qty}</td><td>${l.od.toFixed(1)}${l.estimated ? ' *' : ''}</td><td>${l.kg.toFixed(2)}</td></tr>`).join('')}
  <tr><td colspan="2"><b>Total</b></td><td><b>${r.count}</b></td><td>Σ ${r.sumOdMm.toFixed(0)}</td><td>${r.kgPerM.toFixed(1)} kg/m</td></tr></tbody></table>
  <h2>Cross-section (to scale)</h2>${containmentSvg(r, i, 520)}
  ${r.soil ? `<h2>Derating for buried cables</h2><table><tbody><tr><th class="k">Ground temperature ${i.groundTempC} °C</th><td>× ${r.soil.temp.toFixed(2)}</td></tr><tr><th class="k">Soil ${i.soilResistivity} K·m/W</th><td>× ${r.soil.resistivity.toFixed(2)}</td></tr><tr><th class="k">Grouping, ${r.count} circuits</th><td>× ${r.soil.group.toFixed(2)}</td></tr><tr><th class="k">Total</th><td><b>× ${r.soil.total.toFixed(2)}</b> on each cable's buried current rating</td></tr></tbody></table>` : ''}
  ${r.groupFactor !== undefined ? `<p>Grouping factor for the cables on the tray: <b>${r.groupFactor.toFixed(2)}</b> (IEC 60364-5-52 Table B.52.20).</p>` : ''}
  <h2>Notes</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
  <p class="m">Factors are typical IEC 60364-5-52 values; confirm with the cable manufacturer's data. * diameter from the next size in the cable data.</p>
  </body></html>`;
}
