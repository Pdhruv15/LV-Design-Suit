import { useState } from 'react';
import type { FeederResult } from '../calc/electrical';

type TabKey = 'vd' | 'load' | 'sc' | 'prot';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'vd', label: 'Voltage drop' },
  { key: 'load', label: 'Load schedule' },
  { key: 'sc', label: 'Short circuit' },
  { key: 'prot', label: 'Protection' }
];

export default function ResultsTable({
  results,
  vdLimitPct,
  selected,
  onSelect
}: {
  results: FeederResult[];
  vdLimitPct: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<TabKey>('vd');

  const headers: Record<TabKey, string[]> = {
    vd: ['Circuit', 'Cable', 'Length', 'Ib (A)', 'Vd feeder (%)', 'Vd upstream (%)', 'Vd total (%)', 'Limit', 'Status'],
    load: ['Board', 'Connected (kW)', 'Demand factor', 'Max demand (kW)', 'Current (A)', 'Breaker loading', 'Status'],
    sc: ['Circuit', 'Ik″ at breaker (kA)', 'Breaker Icu (kA)', 'Margin (kA)', 'Ik″ at cable end (kA)', 'Status'],
    prot: ['Circuit', 'Ib (A)', 'Breaker In (A)', 'Cable Iz (A)', 'Ib ≤ In ≤ Iz', 'Status']
  };

  function protectionNote(r: FeederResult): string {
    if (r.ib > r.feeder.breakerRatingA) return 'Breaker undersized (Ib > In)';
    if (r.feeder.breakerRatingA > r.ampacity) return 'Cable not protected (In > Iz)';
    return 'Holds';
  }

  function statusCell(s: 'ok' | 'warn' | 'bad') {
    const label = s === 'ok' ? 'Pass' : s === 'warn' ? 'Warning' : 'Fail';
    return <td className={s}>{label}</td>;
  }

  function row(r: FeederResult) {
    const f = r.feeder;
    switch (tab) {
      case 'vd':
        return (
          <>
            <td>{f.id}</td>
            <td>{f.cableCsaMm2} mm²</td>
            <td>{f.lengthM} m</td>
            <td>{r.ib.toFixed(0)}</td>
            <td>{r.vdPct.toFixed(2)}</td>
            <td>{r.vdUpstreamPct.toFixed(2)}</td>
            <td>{r.vdTotalPct.toFixed(2)}</td>
            <td>{vdLimitPct.toFixed(1)}</td>
            {statusCell(r.vdStatus)}
          </>
        );
      case 'load':
        return (
          <>
            <td>{f.id}</td>
            <td>{f.loadKw.toFixed(0)}{f.generation ? ' (PV)' : ''}</td>
            <td>{f.demandFactor.toFixed(2)}</td>
            <td>{(f.loadKw * f.demandFactor).toFixed(0)}</td>
            <td>{r.ib.toFixed(0)}</td>
            <td>{r.loadingPct.toFixed(0)}%</td>
            {statusCell(r.loadingPct > 100 ? 'bad' : r.loadingPct > 85 ? 'warn' : 'ok')}
          </>
        );
      case 'sc':
        return (
          <>
            <td>{f.id}</td>
            <td>{r.breakerFaultKA.toFixed(1)}</td>
            <td>{f.breakerIcuKa}</td>
            <td>{(f.breakerIcuKa - r.breakerFaultKA).toFixed(1)}</td>
            <td>{r.endFaultKA.toFixed(1)}</td>
            {statusCell(r.icuStatus)}
          </>
        );
      case 'prot':
        return (
          <>
            <td>{f.id}</td>
            <td>{r.ib.toFixed(0)}</td>
            <td>{f.breakerRatingA}</td>
            <td>{r.ampacity.toFixed(0)}</td>
            <td>{protectionNote(r)}</td>
            {statusCell(r.protectionStatus)}
          </>
        );
    }
  }

  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tw">
        <table>
          <thead>
            <tr>
              {headers[tab].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.feeder.id} className={selected === r.feeder.id ? 'sel' : ''} onClick={() => onSelect(r.feeder.id)}>
                {row(r)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
