import type { FeederResult } from '../calc/electrical';
import { cableRatePerM, breakerRateAed, CURRENCY } from '../data/rates';

interface Row {
  id: string; name: string; cableCsaMm2: number; lengthM: number;
  cableRate: number; cableCost: number; breakerRatingA: number; breakerCost: number; total: number;
}

function buildRows(results: FeederResult[]): Row[] {
  return results.map((r) => {
    const f = r.feeder;
    const cableRate = cableRatePerM(f.cableCsaMm2);
    const cableCost = cableRate * f.lengthM;
    const breakerCost = breakerRateAed(f.breakerRatingA);
    return {
      id: f.id, name: f.name, cableCsaMm2: f.cableCsaMm2, lengthM: f.lengthM,
      cableRate, cableCost, breakerRatingA: f.breakerRatingA, breakerCost, total: cableCost + breakerCost
    };
  });
}

function toCsv(rows: Row[]): string {
  const header = ['Circuit', 'Description', 'Cable (mm²)', 'Length (m)', `Cable rate (${CURRENCY}/m)`, `Cable cost (${CURRENCY})`, 'Breaker (A)', `Breaker cost (${CURRENCY})`, `Total (${CURRENCY})`];
  const lines = rows.map((r) => [r.id, r.name, r.cableCsaMm2, r.lengthM, r.cableRate, r.cableCost.toFixed(0), r.breakerRatingA, r.breakerCost.toFixed(0), r.total.toFixed(0)].join(','));
  const grand = rows.reduce((s, r) => s + r.total, 0);
  lines.push(['', '', '', '', '', '', '', 'Grand total', grand.toFixed(0)].join(','));
  return [header.join(','), ...lines].join('\n');
}

export default function BoqTable({ results, projectName }: { results: FeederResult[]; projectName: string }) {
  const rows = buildRows(results);
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
      <table>
        <thead>
          <tr>
            <th>Circuit</th><th>Description</th><th>Cable</th><th>Length</th>
            <th>Cable rate</th><th>Cable cost</th><th>Breaker</th><th>Breaker cost</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td><td>{r.name}</td><td>{r.cableCsaMm2} mm²</td><td>{r.lengthM} m</td>
              <td>{r.cableRate}/m</td><td>{r.cableCost.toFixed(0)}</td>
              <td>{r.breakerRatingA} A</td><td>{r.breakerCost.toFixed(0)}</td>
              <td><b>{r.total.toFixed(0)}</b></td>
            </tr>
          ))}
          <tr>
            <td colSpan={8} style={{ textAlign: 'right', fontWeight: 600 }}>Grand total ({CURRENCY})</td>
            <td style={{ fontWeight: 700 }}>{grandTotal.toFixed(0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
