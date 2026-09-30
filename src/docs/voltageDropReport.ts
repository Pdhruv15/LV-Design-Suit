import { groupByPanel, type VdRow } from '../calc/voltageDrop';
import { cableSizeText } from '../calc/electrical';
import { esc, REPORT_CSS } from './report';
import type { Project } from '../types';
import type { RiserVd } from '../calc/busbar';
import { resistanceFactor } from '../calc/electrical';

export const VD_HEADERS = [
  'Ref', 'From panel', 'To', 'Type', 'Load (kW)', 'PF', 'Ib (A)', 'Phase', 'Cable (Cu)', 'Length (m)',
  'mV/A/m', 'Vd (V)', 'Vd (%)', 'Upstream (%)', 'Total Vd (%)', 'Limit (%)', 'Result', 'Remarks'
];

const n = (v: number, d: number) => v.toFixed(d);
const STATUS_TEXT = { ok: 'Pass', warn: 'Check', bad: 'Fail' } as const;
export const cableText = (r: VdRow) => cableSizeText(r.feeder);

/** One row of the table as text, in VD_HEADERS order. */
export function vdCells(r: VdRow): string[] {
  return [
    r.feeder.id, r.from.id, r.toName, r.toType, n(r.loadKw, 1), n(r.pf, 2), n(r.ib, 1), r.threePhase ? '3-ph' : '1-ph',
    cableText(r), n(r.feeder.lengthM, 0), n(r.mvPerAm, 3), n(r.vdV, 2), n(r.vdPct, 2), n(r.upstreamPct, 2),
    n(r.totalPct, 2), n(r.limitPct, 1), STATUS_TEXT[r.status], r.feeder.remarks ?? ''
  ];
}

export const scopeLabel = (project: Project, boardId: string) => {
  const b = project.boards.find((x) => x.id === boardId);
  return b ? `${b.id} – ${b.name}` : 'Entire system';
};

/** Print-ready voltage drop report: design basis, then one table per panel
 * (cables fed from it), with source-to-end totals against the limit. */
export function buildVdReportHtml(project: Project, rows: VdRow[], scope: string, risers: RiserVd[] = []): string {
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const count = (s: VdRow['status']) => rows.filter((r) => r.status === s).length;
  const worst = rows.reduce<VdRow | undefined>((w, r) => (!w || r.totalPct > w.totalPct ? r : w), undefined);
  const head = `<tr>${VD_HEADERS.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const body = groupByPanel(rows)
    .map(({ board, rows: rs }) => {
      const lines = rs
        .map((r) => `<tr>${vdCells(r).map((c, i) => (VD_HEADERS[i] === 'Result' ? `<td class="${r.status}">${esc(c)}</td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
        .join('');
      return `<h2>${esc(board.id)} – ${esc(board.name)}${board.kind ? ` (${esc(board.kind)})` : ''}</h2><table><thead>${head}</thead><tbody>${lines}</tbody></table>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — voltage drop calculation</title><style>${REPORT_CSS}
    th, td { white-space: nowrap; } td:nth-child(3), td:last-child { white-space: normal; }</style></head><body>
<h1>Voltage drop calculation</h1>
<p class="sub">${esc(project.name)} · ${esc(scope)} · ${esc(date)} · ${rows.length} cables:
  <span class="ok">${count('ok')} pass</span> · <span class="warn">${count('warn')} check</span> · <span class="bad">${count('bad')} fail</span>
  ${worst ? ` · highest total ${worst.totalPct.toFixed(2)} % (${esc(worst.feeder.id)} to ${esc(worst.toName)})` : ''}</p>
<table><tbody>
  <tr><th>System</th><td>${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz</td><th>Voltage drop limit</th><td>${project.vdLimitPct} % source to load</td></tr>
  <tr><th>Method</th><td colspan="3">Vd = mV/A/m × Ib × L ÷ 1000, with mV/A/m = k × (R·cos φ + X·sin φ); k = √3 for 3-phase (% of ${project.voltageV} V), 2 for single-phase (% of ${(project.voltageV / Math.sqrt(3)).toFixed(0)} V). R at ${project.vdTempC === undefined ? 'operating temperature (1.2 × R20' : `${project.vdTempC} °C (R20 × ${resistanceFactor(project.vdTempC).toFixed(3)}`}, IEC 60228).</td></tr>
  <tr><th>Scope</th><td colspan="3">Panel-to-panel and equipment cables. ${project.vdFinalCircuits ? "Each DB's worst final circuit is included (marked)." : 'Final circuits below each DB are not included;'} a DB's load is taken from its load schedule. Total Vd = drop from the source to the From panel + this cable.</td></tr>
</tbody></table>
${body || '<p class="note">No cables selected.</p>'}
${risers.map((v) => `<h2>Busbar riser ${esc(v.riser.name)} — from ${esc(v.riser.sourceBoardId ?? '—')}</h2>
<p class="sub">Design current ${v.designA.toFixed(0)} A · z = ${(v.zOhmPerM * 1000).toFixed(3)} mΩ/m · concentrated length ${v.concentratedM.toFixed(1)} m (full current) · distributed length ${v.distributedM.toFixed(1)} m · upstream ${v.upstreamPct.toFixed(2)} %<br>
Top tap-off: floor by floor <b class="${v.status}">${v.exactTopPct.toFixed(2)} %</b> · uniformly distributed load check ΔV = √3 · I · z · (Lc + Ld/2): ${v.uniformTopPct.toFixed(2)} %</p>
<table><thead><tr><th>Section</th><th>Part</th><th>Length (m)</th><th>Current (A)</th><th>Vd (%)</th><th>Total at end (%)</th><th>Result</th></tr></thead><tbody>
${v.segments.map((g) => { const st = g.cumPct > v.limitPct ? 'bad' : g.cumPct > v.limitPct * 0.85 ? 'warn' : 'ok'; return `<tr><td>${esc(g.label)}</td><td>${g.kind}</td><td>${g.lengthM.toFixed(1)}</td><td>${g.currentA.toFixed(0)}</td><td>${g.vdPct.toFixed(3)}</td><td>${g.cumPct.toFixed(2)}</td><td class="${st}">${STATUS_TEXT[st]}</td></tr>`; }).join('')}
</tbody></table>`).join('')}
</body></html>`;
}
