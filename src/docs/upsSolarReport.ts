import { sizeUps, type UpsSystem } from '../calc/ups';
import type { PvResult, PvSystem } from '../calc/solar';
import { acConnection } from '../calc/solar';
import { pvConnection } from '../model/pvFeeder';
import { revisionStamp } from '../model/revisions';
import type { Project } from '../types';
import { esc } from './report';

/** Printable UPS / battery and solar PV sizing sheets (A4 portrait). */

const n = (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : '—');
const CSS = `
  @page { size: A4 portrait; margin: 14mm; }
  body { font: 10.5px/1.45 Arial, sans-serif; color: #17202e; margin: 0; }
  header { display: flex; justify-content: space-between; border-bottom: 2px solid #17202e; padding-bottom: 4px; margin-bottom: 8px; }
  h1 { font-size: 16px; margin: 0; } h2 { font-size: 12px; margin: 14px 0 5px; color: #1d4f8f; border-bottom: 1px solid #1d4f8f; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 6px; } th, td { border: 1px solid #9aa6b8; padding: 3px 6px; text-align: left; }
  th { background: #eef2f7; width: 42%; font-weight: 600; } td b { font-size: 11.5px; }
  .ok { color: #13803d; font-weight: 700; } .bad { color: #c21f32; font-weight: 700; }
  .note { color: #5b6b82; font-size: 9px; } .page { break-after: page; } .page:last-child { break-after: auto; }`;
const head = (project: Project, title: string) => `<header><div><h1>${esc(title)}</h1><div>${esc(project.name)}</div></div><div>${esc(revisionStamp(project))}</div></header>`;
const rows = (r: [string, string][]) => `<table>${r.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>`;

export function buildUpsReportHtml(project: Project, systems: UpsSystem[]): string {
  const pages = systems.map((s) => {
    const r = sizeUps(project, s);
    const loads = s.boardId ? '' : `<h2>Loads</h2><table><tr><th style="width:auto">Load</th><th>Qty</th><th>W each</th><th>VA each</th><th>PF</th></tr>${s.loads.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${l.w ?? '—'}</td><td>${l.va ?? '—'}</td><td>${l.pf ?? 0.9}</td></tr>`).join('')}</table>`;
    return `<section class="page">${head(project, `UPS & battery sizing — ${s.name}`)}
      <h2>Load</h2>${rows([
        ['Load from', s.boardId ? `Board ${esc(s.boardId)} (its maximum demand)` : 'List of loads (below)'],
        ['Load', `<b>${n(r.loadKva)} kVA · ${n(r.loadKw)} kW</b>`],
        ['Growth / design loading', `${s.growthPct} % / ${s.maxLoadingPct} %`],
        ['Design requirement', `${n(r.designKva)} kVA · ${n(r.designKw)} kW`]
      ])}${loads}
      <h2>UPS</h2>${rows([
        ['Selected UPS', r.upsKva ? `<b>${r.upsKva} kVA / ${n(r.upsKw!)} kW</b> (output PF ${s.outputPf})` : '<span class="bad">Above the largest standard size — parallel modules</span>'],
        ['Loading today', r.loadingPct !== undefined ? `<b>${n(r.loadingPct, 0)} %</b> — governed by ${r.loadingBy} (${n(r.loadingKvaPct!, 1)} % of ${r.upsKva} kVA · ${n(r.loadingKwPct!, 1)} % of ${n(r.upsKw!, 0)} kW)` : '—'],
        ['Inverter efficiency', `${n(s.inverterEff * 100)} %`]
      ])}
      <h2>Battery</h2>${rows([
        ['Type', s.chem === 'vrla' ? `VRLA lead-acid, end voltage ${s.endCellV ?? 1.75} V/cell` : 'Lithium-ion (LFP)'],
        ['Backup time', `${s.autonomyMin} min`],
        ['DC power from the battery', `${n(r.dcKw, 2)} kW = load kW with growth ÷ ${s.inverterEff}`],
        ...(r.busMismatch
          ? [['DC bus (requested)', `${s.dcVoltage} V`], ['Battery string (actual)', `<b class="bad">${r.blocksPerString} × ${s.blockV} V = ${n(r.stringV, 1)} V ≠ ${s.dcVoltage} V — configuration not valid; figures below are for the ${n(r.stringV, 1)} V string, UPS compatibility not verified</b>`]] as [string, string][]
          : [['DC bus', `${s.dcVoltage} V = ${r.blocksPerString} × ${s.blockV} V`]] as [string, string][]),
        ['Capacity at this rate', `${n(r.rate * 100, 0)} % of C10 (${s.rateCapacityPct ? 'manufacturer' : 'typical'})`],
        ['Factors', `ageing ${s.ageing} · temperature ${s.tempFactor} · design margin ${s.designMargin}`],
        ['Required capacity (C10)', `${n(r.requiredAh)} Ah = P × t ÷ ${n(r.stringV, 1)} V (string) ÷ rate × factors`],
        ['Selected battery', r.busMismatch && r.blockAh ? `<span class="bad">Not valid (DC bus mismatch)</span> — candidate ${r.strings > 1 ? `${r.strings} strings × ` : ''}${r.blocksPerString} × ${s.blockV} V ${r.blockAh} Ah, ${n(r.energyKwh)} kWh at ${n(r.stringV, 1)} V` : r.blockAh ? `<b>${r.strings > 1 ? `${r.strings} strings × ` : ''}${r.blocksPerString} × ${s.blockV} V ${r.blockAh} Ah</b> — ${r.totalBlocks} ${s.chem === 'vrla' ? 'blocks' : 'modules'}, ${n(r.energyKwh)} kWh` : '<span class="bad">No block size fits</span>'],
        ['Backup with this battery', r.runtimeMin !== undefined ? `<span class="${r.runtimeMin >= s.autonomyMin ? 'ok' : 'bad'}">${n(r.runtimeMin, 0)} min</span>` : '—'],
        ['Maximum DC current / battery-bus DC breaker', `${n(r.dcCurrentMaxA, 0)} A (end of discharge, all strings) / ${r.dcBreakerNoFit ? `<b class="bad">No suitable DC breaker in the list — ${n(r.dcBreakerRequiredA, 0)} A needed (1.25 × I), largest listed ${r.dcBreakerMaxA} A</b>` : r.dcBreakerA ? `${r.dcBreakerA} A (≥ 1.25 × I; confirm DC voltage, poles and breaking capacity)` : '—'}`]
      ])}
      ${r.notes.length ? `<p>${esc(r.notes.join(' · '))}</p>` : ''}
      <p class="note">Constant-power method (IEEE 485 / 1184 practice). Capacity-at-rate figures are typical; confirm the battery with the manufacturer's constant-power discharge table at the end voltage and room temperature.</p>
    </section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — UPS sizing</title><style>${CSS}</style></head><body>${pages}</body></html>`;
}

export function buildPvReportHtml(project: Project, s: PvSystem, r: PvResult): string {
  const board = s.boardId ?? project.boards.find((b) => !b.upstreamId)?.id ?? project.boards[0]?.id;
  const conn = board && r.inverters ? pvConnection(project, s, r, board) : undefined;
  const ok = (b: boolean) => `<span class="${b ? 'ok' : 'bad'}">${b ? 'OK' : 'Fail'}</span>`;
  const mppt = (b: boolean) => (r.vmpBasis === 'estimated' ? `<span class="${b ? 'warn' : 'bad'}">${b ? 'OK (estimated)' : 'Fail (estimated)'}</span>` : ok(b));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — Solar PV sizing</title><style>${CSS}</style></head><body>
  <section class="page">${head(project, 'Solar PV sizing — panels and inverters')}
  <h2>Array</h2>${rows([
    ['Sized by', s.mode === 'kwp' ? `Target ${s.targetKwp} kWp` : s.mode === 'area' ? `Roof area ${s.roofAreaM2} m² (${s.roofUsePct} % usable)` : `Daily energy ${s.dailyKwh} kWh`],
    ['Panel', `${esc(s.panel.name)} — ${s.panel.pmaxW} W, Voc ${s.panel.vocV} V, Vmp ${s.panel.vmpV} V, Isc ${s.panel.iscA} A, ${s.panel.lengthM} × ${s.panel.widthM} m`],
    ['Array', `<b>${r.panels} panels = ${n(r.kwp, 2)} kWp</b> in ${r.strings} strings of ${r.perString}`],
    ['Panel area / roof needed', `${n(r.arrayAreaM2, 0)} m² / ≈ ${n(r.roofNeededM2, 0)} m²`]
  ])}
  <h2>Inverters</h2>${rows([
    ['Inverter', `${esc(s.inverter.name)} — ${s.inverter.acKw} kW, ${s.inverter.phases}-phase, max DC ${s.inverter.maxDcV} V, MPPT ${s.inverter.mpptMinV}–${s.inverter.mpptMaxV} V, ${s.inverter.mppts} MPPTs × ${s.inverter.maxInputA} A`],
    ['Selected', `<b>${r.inverters} × ${s.inverter.acKw} kW = ${n(r.inverters * s.inverter.acKw)} kW AC</b>, DC/AC ${r.dcAcRatio.toFixed(2)}`],
    ['AC connection', `${n(r.acCurrentA, 0)} A → ${r.acBreakerNoFit ? `<b class="bad">No suitable breaker in the available list — ${n(r.acBreakerRequiredA, 0)} A needed (1.25 × I), largest available ${r.acBreakerMaxA} A</b>` : r.acBreakerA ? `${r.acBreakerA} A breaker` : 'no breaker (no generation)'} (${acConnection(s, project.voltageV).text}${s.inverter.phases === 1 ? `${s.acPhase ? `, phase ${s.acPhase}` : ', phase not set'}${r.inverters > 1 ? `; ${r.inverters} inverters counted together` : ''}` : ''})`],
    ...(conn ? [['SLD connection', conn.ok ? esc(conn.text) : `<b class="bad">${esc(conn.text)}</b>`] as [string, string]] : []),
  ])}
  <h2>String design (IEC 62548)</h2>${rows([
    ['Site temperatures', `min ${s.tMinC} °C, max ${s.tMaxC} °C → max cell ${n(r.tCellMaxC, 0)} °C (NOCT ${s.panel.noctC} °C)`],
    ['Temperature coefficients', `Voc ${s.panel.betaVocPct} %/°C (maximum DC voltage) · Vmp ${r.vmpCoeffPct} %/°C (MPPT window)${r.vmpBasis === 'estimated' ? ' — <b class="warn">ESTIMATED: no datasheet Vmp coefficient; typical crystalline-silicon value, MPPT checks not verified</b>' : ' (datasheet)'} · Pmax ${s.panel.gammaPmaxPct} %/°C (yield). Linear approximation V(T) = V<sub>STC</sub> × (1 + coefficient × (T − 25 °C)).`],
    [`String Voc at ${s.tMinC} °C`, `${r.perString} × ${n(r.vocColdV, 2)} = ${n(r.perString * r.vocColdV, 0)} V ≤ ${s.inverter.maxDcV} V ${ok(r.perString * r.vocColdV <= s.inverter.maxDcV)}`],
    [`String Vmp at ${n(r.tCellMaxC, 0)} °C`, `${r.perString} × ${n(r.vmpHotV, 2)} = ${n(r.perString * r.vmpHotV, 0)} V ≥ ${s.inverter.mpptMinV} V ${mppt(r.perString * r.vmpHotV >= s.inverter.mpptMinV)}`],
    [`String Vmp at ${s.tMinC} °C`, `${r.perString} × ${n(r.vmpColdV, 2)} = ${n(r.perString * r.vmpColdV, 0)} V ≤ ${s.inverter.mpptMaxV} V ${mppt(r.perString * r.vmpColdV <= s.inverter.mpptMaxV)}`],
    ['MPPT current', `${r.stringsPerMppt} × 1.25 × ${s.panel.iscA} A = ${n(r.mpptCurrentA)} A ≤ ${s.inverter.maxInputA} A ${ok(r.mpptCurrentA <= s.inverter.maxInputA)}`],
    ['Panels per string that fit', `${r.minPerString} – ${r.maxPerString}`]
  ])}
  <h2>Energy</h2>${rows([
    ['Peak sun hours', `${s.peakSunHours} kWh/m²/day`],
    ['Losses', `temperature ${n(r.tempLossPct)} % · soiling ${s.soilingPct} % · mismatch ${s.mismatchPct} % · DC cable ${s.dcCablePct} % · AC cable ${s.acCablePct} % · inverter ${n(100 - s.inverter.efficiencyPct)} %`],
    ['Performance ratio', `${n(r.prPct)} %`],
    ['Yield', `<b>${n(r.dailyKwh, 0)} kWh/day · ${n(r.annualKwh, 0)} kWh/year</b> (${n(r.specificYield, 0)} kWh/kWp)`],
    ['Savings', r.savings !== undefined ? `${n(r.savings, 0)} per year at ${s.tariff} per kWh` : '—'],
    ['CO₂ avoided', `${n(r.co2Tonnes)} t/year at ${s.gridKgPerKwh} kg/kWh`]
  ])}
  ${r.notes.length ? `<p>${esc(r.notes.join(' · '))}</p>` : ''}
  <p class="note">Yield = kWp × peak sun hours × performance ratio (first estimate; confirm with a simulation such as PVsyst for the final design). Panel and inverter values from the datasheets entered.</p>
  </section></body></html>`;
}
