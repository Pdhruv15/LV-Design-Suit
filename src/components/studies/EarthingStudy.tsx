import { useMemo } from 'react';
import type { Project } from '../../types';
import { evaluateEarthingAll, breakerTypeOf, C_MIN, K_CPC_XLPE_CU } from '../../calc/earthing';
import { FocusChip, Page, StatusCell, StatusCounts } from '../ui';
import { subtree } from '../../calc/pfc';

export default function EarthingStudy({ project, onSelectFeeder, focus, onClearFocus }: { project: Project; onSelectFeeder: (id: string) => void; focus?: string | null; onClearFocus?: () => void }) {
  const all = useMemo(() => evaluateEarthingAll(project), [project]);
  const results = useMemo(() => { if (!focus) return all; const ids = subtree(project, focus); return all.filter((r) => ids.has(r.feeder.boardId)); }, [all, project, focus]);

  return (
    <Page
      title="Earthing — fault loop impedance and disconnection time"
      actions={<><FocusChip id={focus} onClear={onClearFocus} /><StatusCounts statuses={results.map((r) => r.status)} /></>}
      intro={
        <>
          TN-S system. Zs = Ze + (R1 + R2) at operating temperature; minimum fault current If = {C_MIN} × U0 / Zs. A circuit
          passes when If reaches the breaker's instantaneous trip current Ia (disconnection &lt; 0.1 s), which satisfies both
          the 0.4 s (final circuits ≤ 63 A) and 5 s limits of IEC 60364-4-41. The protective conductor must also withstand
          the fault: S ≥ If·√t / {K_CPC_XLPE_CU}. Change the breaker type or protective conductor size by editing the feeder.
        </>
      }
    >
      <table>
        <thead>
          <tr>
            <th>Circuit</th><th>Board</th><th>Breaker</th><th>Cable / CPC (mm²)</th><th>Ze (Ω)</th><th>Zs (Ω)</th>
            <th>Max Zs (Ω)</th><th>If (A)</th><th>Ia (A)</th><th>Required</th><th>Disconnection</th><th>CPC min (mm²)</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const f = r.feeder;
            return (
              <tr key={f.id} onClick={() => onSelectFeeder(f.id)}>
                <td>{f.id}</td>
                <td>{f.boardId}</td>
                <td>{f.breakerRatingA} A {breakerTypeOf(f)}</td>
                <td>{f.cableCsaMm2} / {r.cpcMm2}</td>
                <td>{r.zeOhm.toFixed(4)}</td>
                <td className={r.zsOhm > r.maxZsOhm ? r.disconnection : ''}>{r.zsOhm.toFixed(4)}</td>
                <td>{r.maxZsOhm.toFixed(4)}</td>
                <td>{r.faultA.toFixed(0)}</td>
                <td>{r.tripA.toFixed(0)}</td>
                <td>{r.requiredS} s</td>
                <StatusCell status={r.disconnection}>
                  {r.disconnection === 'ok' ? '< 0.1 s' : r.disconnection === 'warn' ? 'Thermal — check curve' : 'Too slow'}
                </StatusCell>
                <StatusCell status={r.adiabatic}>{r.adiabaticMinMm2.toFixed(1)}</StatusCell>
                <StatusCell status={r.status} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </Page>
  );
}
