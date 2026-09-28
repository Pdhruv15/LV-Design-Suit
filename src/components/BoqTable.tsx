import { runsOf, type FeederResult } from '../calc/electrical';
import { cableTypeOf, cableTypeDef } from '../model/cableTypes';
import type { Project } from '../types';
import { cableRatePerM, breakerRateAed, CURRENCY } from '../data/rates';

interface Row {
  id: string; name: string; type: string; fireRated: boolean; cableCsaMm2: number; runs: number; lengthM: number;
  cableRate: number; cableCost: number; breakerRatingA: number; breakerCost: number; total: number;
}

function buildRows(results: FeederResult[], project?: Project): Row[] {
  return results.map((r) => {
    const f = r.feeder;
    const t = project ? cableTypeOf(project, f) : cableTypeDef(f.cableType);
    const cableRate = cableRatePerM(f.cableCsaMm2);
    const cableCost = cableRate * f.lengthM * runsOf(f); // every run in parallel
    const breakerCost = breakerRateAed(f.breakerRatingA);
    return {
      id: f.id, name: f.name, type: t.code, fireRated: !!t.fireRated, cableCsaMm2: f.cableCsaMm2, runs: runsOf(f), lengthM: f.lengthM,
      cableRate, cableCost, breakerRatingA: f.breakerRatingA, breakerCost, total: cableCost + breakerCost
    };
  });
}

function toCsv(rows: Row[]): string {
  const header = ['Circuit', 'Description', 'Cable type', 'Cable (mm²)', 'Length (m)', `Cable rate (${CURRENCY}/m)`, `Cable cost (${CURRENCY})`, 'Breaker (A)', `Breaker cost (${CURRENCY})`, `Total (${CURRENCY})`];
  const lines = rows.map((r) => [r.id, r.name, r.type, r.runs > 1 ? `${r.runs} x ${r.cableCsaMm2}` : r.cableCsaMm2, r.lengthM, r.cableRate, r.cableCost.toFixed(0), r.breakerRatingA, r.breakerCost.toFixed(0), r.total.toFixed(0)].join(','));
  const grand = rows.reduce((s, r) => s + r.total, 0);
  lines.push(['', '', '', '', '', '', '', '', 'Grand total', grand.toFixed(0)].join(','));
  return [header.join(','), ...lines].join('\n');
}

export default function BoqTable({ results, projectName, project }: { results: FeederResult[]; projectName: string; project?: Project }) {
  const rows = buildRows(results, project);
  // Cable length by type (fire-rated priced and ordered separately).
  const byType = [...rows.reduce((m, r) => m.set(r.type, (m.get(r.type) ?? 0) + r.lengthM * r.runs), new Map<string, number>())];
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  function exportCsv() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/[^a-z0-9]+/gi, '-')}-boq.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="tw">
      <div className="boq-head">
        <span className="m">Illustrative unit rates — edit src/data/rates.ts with your real supplier prices.</span>
        <button className="chip" onClick={exportCsv}>Export CSV</button>
      </div>
      {byType.length > 1 && <p className="m">Cable by type: {byType.map(([t, m]) => `${t} ${Math.round(m)} m`).join(' · ')} — the rates are the same for every type; enter fire-rated / LSZH prices in rates.ts.</p>}
      <table>
        <thead>
          <tr>
            <th>Circuit</th><th>Description</th><th>Type</th><th>Cable</th><th>Length</th>
            <th>Cable rate</th><th>Cable cost</th><th>Breaker</th><th>Breaker cost</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td><td>{r.name}</td><td className={r.fireRated ? 'fr-cell' : undefined}>{r.type}</td><td>{r.runs > 1 ? `${r.runs} × ` : ''}{r.cableCsaMm2} mm²</td><td>{r.lengthM} m</td>
              <td>{r.cableRate}/m</td><td>{r.cableCost.toFixed(0)}</td>
              <td>{r.breakerRatingA} A</td><td>{r.breakerCost.toFixed(0)}</td>
              <td><b>{r.total.toFixed(0)}</b></td>
            </tr>
          ))}
          <tr>
            <td colSpan={9} style={{ textAlign: 'right', fontWeight: 600 }}>Grand total ({CURRENCY})</td>
            <td style={{ fontWeight: 700 }}>{grandTotal.toFixed(0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
