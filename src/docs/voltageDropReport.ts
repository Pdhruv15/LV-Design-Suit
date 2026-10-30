import { groupByPanel, type VdRow } from '../calc/voltageDrop';
import { STATUS_TEXT } from '../calc/statusText';
import { cableSizeText } from '../calc/electrical';
import { ATTENTION_MAX, esc, PLAIN_CSS, reportHead, tally } from './report';
import { statusSpan } from './printStyles';
import { destMarker } from './outline';
import { printDoc } from './printDoc';
import pkg from '../../package.json';
import { displayVersion } from '../model/appVersion';
import type { Project } from '../types';
import type { RiserVd } from '../calc/busbar';
import { motorStartVdLimit } from '../calc/voltageDrop';
import { resistanceFactor } from '../calc/electrical';

export const VD_HEADERS = [
  'Ref', 'From panel', 'To', 'Type', 'Load (kW)', 'PF', 'Ib (A)', 'Phase', 'Cable (Cu)', 'Length (m)',
  'mV/A/m', 'Vd (V)', 'Vd (%)', 'Upstream (%)', 'Total Vd (%)', 'Limit (%)', 'Motor start (%)', 'Result', 'Remarks'
];

const n = (v: number, d: number) => v.toFixed(d);

export const cableText = (r: VdRow) => cableSizeText(r.feeder);

/** Motors: drop while starting against its own limit, e.g. "11.6 / 10 — exceeds". */
export const startText = (r: VdRow) => (r.startPct === undefined ? '' : `${n(r.startPct, 1)} / ${motorStartVdLimit()}${r.startPct > motorStartVdLimit() ? ' — exceeds' : ''}`);

/** One row of the table as text, in VD_HEADERS order. */
export function vdCells(r: VdRow): string[] {
  return [
    r.feeder.id, r.from.id, r.toName, r.toType, n(r.loadKw, 1), n(r.pf, 2), n(r.ib, 1), r.threePhase ? '3-ph' : '1-ph',
    cableText(r), n(r.feeder.lengthM, 0), n(r.mvPerAm, 3), n(r.vdV, 2), n(r.vdPct, 2), n(r.upstreamPct, 2),
    n(r.totalPct, 2), n(r.limitPct, 1), startText(r), STATUS_TEXT[r.status], [r.vdBasis && r.vdBasis.phase !== r.vdBasis.currentPhase ? `Vd on phase ${r.vdBasis.phase}: ${n(r.vdBasis.a, 1)} A at PF ${n(r.vdBasis.pf, 3)}${r.vdBasis.leading ? ' leading' : ''} (Ib on ${r.vdBasis.currentPhase})` : '', r.feeder.remarks ?? ''].filter(Boolean).join('; ')
  ];
}

export const scopeLabel = (project: Project, boardId: string) => {
  const b = project.boards.find((x) => x.id === boardId);
  return b ? `${b.id} – ${b.name}` : 'Entire system';
};

/** Columns the printed report leaves out: From panel (the section heading says it), Limit when
 * every cable has the same one (stated in the summary), Motor start and Remarks when empty. */
function printedColumns(rows: VdRow[]): number[] {
  const cells = rows.map(vdCells);
  const col = (h: string) => VD_HEADERS.indexOf(h);
  const empty = (h: string) => cells.every((c) => !c[col(h)]);
  const sameLimit = new Set(rows.map((r) => r.limitPct)).size <= 1;
  const drop = new Set([col('From panel'), ...(sameLimit ? [col('Limit (%)')] : []), ...(empty('Motor start (%)') ? [col('Motor start (%)')] : []), ...(empty('Remarks') ? [col('Remarks')] : [])]);
  return VD_HEADERS.map((_, i) => i).filter((i) => !drop.has(i));
}

const NUMERIC = new Set(['Load (kW)', 'PF', 'Ib (A)', 'Length (m)', 'mV/A/m', 'Vd (V)', 'Vd (%)', 'Upstream (%)', 'Total Vd (%)', 'Limit (%)']);

/** Print-ready voltage drop report in the plain black-and-white style: document block,
 * results summary with the cables needing attention, design basis, then one table per
 * panel (cables fed from it) with source-to-end totals against the limit, and the risers. */
export function buildVdReportHtml(project: Project, rows: VdRow[], scope: string, risers: RiserVd[] = []): string {
  const t = tally(rows.map((r) => r.status));
  const worst = rows.reduce<VdRow | undefined>((w, r) => (!w || r.totalPct > w.totalPct ? r : w), undefined);
  const limits = [...new Set(rows.map((r) => r.limitPct))].sort((a, b) => a - b);
  const limitText = limits.length > 1 ? `${n(limits[0], 1)}–${n(limits[limits.length - 1], 1)} % (per cable)` : `${n(limits[0] ?? project.vdLimitPct, 1)} % source to load`;
  const cls = (h: string) => (NUMERIC.has(h) ? ' class="n"' : '');

  // Page 1: cables (and risers) that fail or need a look, worst first.
  const attention = [
    ...rows.filter((r) => r.status !== 'ok').map((r) => ({ st: r.status, ref: r.feeder.id, path: `${r.from.id} → ${r.toName}`, vd: n(r.vdPct, 2), up: n(r.upstreamPct, 2), total: r.totalPct })),
    ...risers.filter((v) => v.status !== 'ok').map((v) => ({ st: v.status, ref: v.riser.name, path: `Busbar riser from ${v.riser.sourceBoardId ?? '—'}`, vd: '', up: n(v.upstreamPct, 2), total: v.noType ? NaN : v.exactTopPct }))
  ].sort((a, b) => (a.st === b.st ? (b.total || 0) - (a.total || 0) : a.st === 'bad' ? -1 : 1));
  const shown = attention.slice(0, ATTENTION_MAX);
  const summary = `<div class="sum"><table class="grid">
    <tr><th>Cables</th><th class="n">Pass</th><th class="n">Warning</th><th class="n">Fail</th></tr>
    <tr><td>${rows.length}</td><td class="n">${t.ok}</td><td class="n">${t.warn}</td><td class="n bad">${t.bad}</td></tr>
    <tr><th colspan="2">Highest total</th><td colspan="2" class="n">${worst ? `${n(worst.totalPct, 2)} % — ${esc(worst.from.id)} / ${esc(worst.feeder.id)}` : '—'}</td></tr>
    <tr><th colspan="2">Limit</th><td colspan="2" class="n">${esc(limitText)}</td></tr></table>
    <div class="box"><b>${attention.length ? `Needs attention (${attention.length})` : 'Nothing needs attention — every cable is within the limit'}</b>${shown.length ? `<table class="grid">
      <tr><th>Cable</th><th>From → to</th><th class="n">This cable (%)</th><th class="n">Upstream (%)</th><th class="n">Total (%)</th><th>Result</th></tr>
      ${shown.map((a) => `<tr><td>${esc(a.ref)}</td><td>${esc(a.path)}</td><td class="n">${a.vd}</td><td class="n">${a.up}</td><td class="n">${Number.isFinite(a.total) ? n(a.total, 2) : 'Not calculated'}</td><td class="${a.st}">${STATUS_TEXT[a.st]}</td></tr>`).join('')}</table>` : ''}
    ${attention.length > ATTENTION_MAX ? `<p class="note">…and ${attention.length - ATTENTION_MAX} more — all ${attention.length} are listed under “Items needing attention” below.</p>` : ''}</div></div>`;
  // Every cable or riser that fails or needs a look, none left out.
  const allItems = attention.length > ATTENTION_MAX ? `<h2>Items needing attention (all ${attention.length})</h2><table class="grid"><thead>
      <tr><th>Cable</th><th>From → to</th><th class="n">This cable (%)</th><th class="n">Upstream (%)</th><th class="n">Total (%)</th><th>Result</th></tr></thead><tbody>
      ${attention.map((a) => `<tr><td>${esc(a.ref)}</td><td>${esc(a.path)}</td><td class="n">${a.vd}</td><td class="n">${a.up}</td><td class="n">${Number.isFinite(a.total) ? n(a.total, 2) : 'Not calculated'}</td><td class="${a.st}">${statusSpan(STATUS_TEXT[a.st])}</td></tr>`).join('')}</tbody></table>` : '';

  const cols = printedColumns(rows);
  const head = `<tr>${cols.map((i) => `<th${cls(VD_HEADERS[i])}>${esc(VD_HEADERS[i])}</th>`).join('')}</tr>`;
  const panels = groupByPanel(rows)
    .map(({ board, rows: rs }) => {
      const lines = rs
        .map((r) => { const c = vdCells(r); return `<tr>${cols.map((i) => (VD_HEADERS[i] === 'Result' ? `<td class="${r.status}">${esc(c[i])}</td>` : `<td${cls(VD_HEADERS[i])}>${esc(c[i])}</td>`)).join('')}</tr>`; })
        .join('');
      return `<h2 id="vd-${esc(board.id)}">${destMarker(`vd-${board.id}`, `${board.id} – ${board.name}`)}${esc(board.id)} – ${esc(board.name)}${board.kind ? ` (${esc(board.kind)})` : ''}</h2><table class="grid vd"><thead>${head}</thead><tbody>${lines}</tbody></table>`;
    })
    .join('');

  const body = `${PLAIN_CSS}<style>table.vd th, table.vd td { white-space: nowrap; } table.vd td:nth-child(2), table.vd td:last-child { white-space: normal; } .n { text-align: right; }</style>
${reportHead(project, 'Voltage drop calculation', project.vdReportDocNo, `Scope: ${scope}`)}

<h2>Results summary</h2>
${summary}
${allItems}

<h2>Design basis</h2>
<table class="grid"><tbody>
  <tr><th>System</th><td>${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz · limit ${esc(limitText)}</td></tr>
  <tr><th>Method</th><td>Vd = mV/A/m × Ib × L ÷ 1000, with mV/A/m = k × (R·cos φ + X·sin φ); k = √3 for 3-phase (% of ${project.voltageV} V), 2 for single-phase (% of ${(project.voltageV / Math.sqrt(3)).toFixed(0)} V). R at ${project.vdTempC === undefined ? 'operating temperature (1.2 × R20' : `${project.vdTempC} °C (R20 × ${resistanceFactor(project.vdTempC).toFixed(3)}`}, IEC 60228).</td></tr>
  <tr><th>Scope</th><td>Panel-to-panel and equipment cables. ${project.vdFinalCircuits ? "Each DB's worst final circuit is included (marked)." : 'Final circuits below each DB are not included;'} a DB's load is taken from its load schedule. Total Vd = drop from the source to the From panel + this cable.</td></tr>
</tbody></table>
${panels || '<p class="note">No cables selected.</p>'}
${risers.map((v) => `<h2>Busbar riser ${esc(v.riser.name)} — from ${esc(v.riser.sourceBoardId ?? '—')}</h2>
<p>Design current ${v.designA.toFixed(0)} A · z = ${(v.zOhmPerM * 1000).toFixed(3)} mΩ/m · concentrated length ${v.concentratedM.toFixed(1)} m (full current) · distributed length ${v.distributedM.toFixed(1)} m · upstream ${v.upstreamPct.toFixed(2)} %<br>
${v.noType ? `<b class="bad">Not calculated — no busbar size in the data carries ${v.designA.toFixed(0)} A. ${STATUS_TEXT.bad}.</b>` : `Top tap-off: floor by floor <b class="${v.status}">${v.exactTopPct.toFixed(2)} %</b> · uniformly distributed load check ΔV = √3 · I · z · (Lc + Ld/2): ${v.uniformTopPct.toFixed(2)} %`}</p>
<table class="grid"><thead><tr><th>Section</th><th>Part</th><th class="n">Length (m)</th><th class="n">Current (A)</th><th class="n">Vd (%)</th><th class="n">Total at end (%)</th><th>Result</th></tr></thead><tbody>
${v.noType ? '' : v.segments.map((g) => { const st = g.cumPct > v.limitPct ? 'bad' : g.cumPct > v.limitPct * 0.85 ? 'warn' : 'ok'; return `<tr><td>${esc(g.label)}</td><td>${g.kind}</td><td class="n">${g.lengthM.toFixed(1)}</td><td class="n">${g.currentA.toFixed(0)}</td><td class="n">${g.vdPct.toFixed(3)}</td><td class="n">${g.cumPct.toFixed(2)}</td><td class="${st}">${STATUS_TEXT[st]}</td></tr>`; }).join('')}
</tbody></table>`).join('')}`;

  return printDoc(project, { title: `${project.name} — voltage drop calculation`, headRight: 'Voltage drop calculation',
    footer: `LV Design Studio ${displayVersion(pkg.version)} · Results must be checked by a qualified engineer`, body, landscape: true });
}
