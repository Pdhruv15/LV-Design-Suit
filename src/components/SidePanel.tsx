import type { FeederResult } from '../calc/electrical';

export default function SidePanel({ results, selected }: { results: FeederResult[]; selected: string | null }) {
  const r = results.find((r) => r.feeder.id === selected) ?? results[0];
  const passed = results.filter((r) => r.status === 'ok').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  const failed = results.filter((r) => r.status === 'bad').length;
  const total = results.length || 1;
  const passPct = Math.round((passed / total) * 100);

  const C = 2 * Math.PI * 42; // circumference for r=42
  const passLen = (passed / total) * C;
  const warnLen = (warned / total) * C;
  const failLen = (failed / total) * C;

  return (
    <>
      {r && (
        <div className="pn">
          <h3>
            Feeder: {r.feeder.id}
            <span className={`pill ${r.status}`}>{r.status === 'ok' ? 'Pass' : r.status === 'warn' ? 'Warning' : 'Fail'}</span>
          </h3>
          <dl className="kv">
            <dt>Board</dt>
            <dd>{r.feeder.name}</dd>
            <dt>Breaker</dt>
            <dd>{r.feeder.breakerRatingA} A, {r.feeder.breakerIcuKa} kA</dd>
            <dt>Cable</dt>
            <dd>{r.feeder.cableCsaMm2} mm², {r.feeder.cores}-core</dd>
            <dt>Length</dt>
            <dd>{r.feeder.lengthM} m</dd>
            <dt>Design current</dt>
            <dd>{r.ib.toFixed(0)} A ({r.loadingPct.toFixed(0)}%)</dd>
            <dt>Voltage drop</dt>
            <dd className={r.vdStatus}>{r.vdPct.toFixed(2)}% feeder · {r.vdTotalPct.toFixed(2)}% total</dd>
            <dt>Cable rating Iz</dt>
            <dd className={r.protectionStatus}>{r.ampacity.toFixed(0)} A {r.protectionStatus === 'ok' ? '(Ib ≤ In ≤ Iz)' : '(Ib ≤ In ≤ Iz fails)'}</dd>
            <dt>Fault at breaker</dt>
            <dd className={r.icuStatus}>{r.breakerFaultKA.toFixed(1)} kA vs Icu {r.feeder.breakerIcuKa} kA</dd>
            <dt>Fault at cable end</dt>
            <dd>{r.endFaultKA.toFixed(1)} kA</dd>
          </dl>
        </div>
      )}
      <div className="pn">
        <h3>Design checks</h3>
        <div className="dc">
          <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
            <g fill="none" strokeWidth="11" transform="rotate(-90 52 52)">
              <circle cx="52" cy="52" r="42" stroke="var(--line)" />
              <circle cx="52" cy="52" r="42" stroke="var(--ok)" strokeDasharray={`${passLen} ${C - passLen}`} />
              <circle cx="52" cy="52" r="42" stroke="var(--warn)" strokeDasharray={`${warnLen} ${C - warnLen}`} strokeDashoffset={-passLen} />
              <circle cx="52" cy="52" r="42" stroke="var(--bad)" strokeDasharray={`${failLen} ${C - failLen}`} strokeDashoffset={-(passLen + warnLen)} />
            </g>
            <text x="52" y="54" textAnchor="middle" style={{ fontSize: 20, fontWeight: 600 }}>
              {passPct}%
            </text>
            <text x="52" y="68" textAnchor="middle" className="m">
              passed
            </text>
          </svg>
          <ul>
            <li className="ok">Passed<span>{passed}</span></li>
            <li className="warn">Warnings<span>{warned}</span></li>
            <li className="bad">Failed<span>{failed}</span></li>
          </ul>
        </div>
      </div>
    </>
  );
}
