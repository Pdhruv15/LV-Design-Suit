import type { Project } from '../types';
import { calcPfc, phasorSvg, powerTriangleSvg, type PfcCalcInput, type PfcCalcResult } from '../calc/pfcCalc';
import { revisionStamp } from '../model/revisions';
import { rule } from '../database/catalog';
import { esc } from './report';

/** Power factor correction report: inputs and method, the power triangle
 * (before / after, to scale), the current phasors, the step chart, the bank
 * selection and the before / after table. */

const f = (n: number, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const MODE: Record<PfcCalcInput['mode'], string> = {
  'kw-pf': 'Measured kW and power factor', 'kva-pf': 'Measured kVA and power factor', 'vi-pf': 'Measured voltage, current and power factor',
  bill: 'Utility bill (kWh and kvarh)', loads: 'List of loads'
};

export function pfcReportHtml(project: Project, input: PfcCalcInput, r: PfcCalcResult = calcPfc(input)): string {
  const logo = project.drawing?.logo?.startsWith('data:image/') ? `<img class="logo" src="${esc(project.drawing.logo)}" alt="">` : '';
  const rows: [string, string, string][] = [
    ['Active power P', `${f(r.p)} kW`, `${f(r.p)} kW`],
    ['Reactive power Q', `${f(r.q1)} kvar`, `${f(r.q2)} kvar`],
    ['Apparent power S', `${f(r.s1)} kVA`, `${f(r.s2)} kVA`],
    ['Power factor', r.pf1.toFixed(3), r.pf2.toFixed(3)],
    ['Phase angle φ', `${f(r.phi1Deg)}°`, `${f(r.phi2Deg)}°`],
    ['Current at ' + input.voltageV + ' V', `${f(r.i1, 0)} A`, `${f(r.i2, 0)} A`],
    ...(r.transformer ? [['Transformer loading (' + r.transformer.kva + ' kVA)', `${f(r.transformer.before, 0)} %`, `${f(r.transformer.after, 0)} %`] as [string, string, string]] : [])
  ];
  const inputs: [string, string][] = [['Input', MODE[input.mode]], ['System', `${input.voltageV} V, 3-phase, 50 Hz`], ['Target PF', String(input.targetPf)], ['Step size', `${input.stepKvar} kvar`],
    ['Harmonics', input.thdIPct !== undefined ? `Current THD ${input.thdIPct} %` : input.harmonics === 'none' ? 'No significant non-linear load' : input.harmonics === 'some' ? 'Some non-linear load (VFDs, UPS, LED)' : 'High non-linear load']];
  if (input.mode === 'loads') inputs.push(['Loads', (input.loads ?? []).map((l) => `${l.qty} × ${esc(l.name)} ${l.kw} kW PF ${l.pf}`).join('; ')]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — power factor correction</title><style>
  @page { size: A4; margin: 12mm; } body { font: 10.5px/1.45 Arial, sans-serif; color: #111; margin: 0; }
  header { display: flex; gap: 10px; align-items: center; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 8px; }
  h1 { font-size: 16px; margin: 0; } h2 { font-size: 12.5px; margin: 14px 0 5px; color: #1d4f8f; border-bottom: 1px solid #1d4f8f; } .m { color: #555; } .logo { max-height: 12mm; max-width: 45mm; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 0.2mm solid #999; padding: 3px 6px; text-align: left; } thead th { background: #1d4f8f; color: #fff; } th.k { background: #eef2f7; width: 30%; }
  .n { text-align: right; } .grid { display: grid; grid-template-columns: 1.7fr 1fr; gap: 10px; align-items: start; } svg { width: 100%; height: auto; color: #111; }
  .big { font-size: 15px; font-weight: 700; } .warn { color: #a86500; } .keep { break-inside: avoid; } code { font-family: Menlo, monospace; font-size: 10px; }
  </style></head><body>
  <header>${logo}<div><h1>Power factor correction${input.title ? ` — ${esc(input.title)}` : ''}</h1><div class="m">${esc(project.name)} · ${esc(revisionStamp(project))} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div></header>
  <p class="big">Capacitor bank ${r.bankKvar ? `${r.bankKvar} kvar = ${r.steps} × ${r.stepKvar} kvar${r.detunedPct ? `, ${r.detunedPct} % detuned` : ''} — PF ${r.pf1.toFixed(2)} → ${r.pf2.toFixed(3)}` : 'not needed'}</p>
  <h2>Input data</h2><table><tbody>${inputs.map(([k, v]) => `<tr><th class="k">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>
  <h2>Method</h2><p>${r.derivation.map((d) => `<code>${esc(d)}</code>`).join('<br>')}<br><code>Bank: next standard size in whole ${r.stepKvar} kvar steps = ${r.bankKvar} kvar → Q2 = Q1 − Qc = ${f(r.q2)} kvar, PF2 = P ÷ √(P² + Q2²) = ${r.pf2.toFixed(3)}</code></p>
  <div class="keep"><h2>Power triangle — before (red) and after (green), to scale</h2><div class="grid"><div>${powerTriangleSvg(r)}</div><div>${phasorSvg(r, input.voltageV)}</div></div></div>
  <div class="keep"><h2>Before and after</h2><table><thead><tr><th></th><th class="n">Before</th><th class="n">After</th></tr></thead><tbody>${rows.map(([k, a, b]) => `<tr><td>${esc(k)}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`).join('')}</tbody></table>
  <p>kVA released <b>${f(r.releasedKva)} kVA</b> · current down <b>${f(r.currentReductionPct, 0)} %</b> · I²R losses down <b>${f(r.lossReductionPct, 0)} %</b>${r.lossSavedKw !== undefined ? ` (${f(r.lossSavedKw, 2)} kW)` : ''}</p></div>
  <div class="keep"><h2>Bank selection</h2><table><tbody>
    <tr><th class="k">Required</th><td>${f(r.requiredKvar)} kvar</td></tr>
    <tr><th class="k">Selected</th><td>${r.bankKvar} kvar, automatic, ${r.steps} steps × ${r.stepKvar} kvar, with power factor relay (CT on the incomer)</td></tr>
    <tr><th class="k">Detuning</th><td>${esc(r.detuneReason)}</td></tr>
    <tr><th class="k">Capacitor rated voltage</th><td>${r.capVoltageV} V</td></tr>
    <tr><th class="k">Bank current</th><td>${f(r.bankCurrentA, 0)} A</td></tr>
    <tr><th class="k">Breaker</th><td>${r.breakerA ? `${r.breakerA} A MCCB (≥ 1.43 × bank current, IEC 60831)` : '—'}</td></tr>
  </tbody></table></div>
  <h2>Other targets</h2><table><thead><tr><th>Target PF</th><th class="n">Required kvar</th><th class="n">Standard bank</th></tr></thead><tbody>${r.compare.map((c) => `<tr><td>${c.pf.toFixed(2)}</td><td class="n">${f(c.kvar)}</td><td class="n">${c.bank}</td></tr>`).join('')}</tbody></table>
  ${r.warnings.length ? `<h2>Notes</h2><ul>${r.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join('')}</ul>` : ''}
  <p class="m">Minimum power factor required: ${rule('pfMinimum').toFixed(2)}. Detuning recommendations are indicative — confirm with a harmonic survey where VFDs, UPS or large LED loads are present.</p>
  </body></html>`;
}
