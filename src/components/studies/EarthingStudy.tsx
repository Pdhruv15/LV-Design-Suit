import { useMemo } from 'react';
import type { Project } from '../../types';
import { evaluateEarthingAll, breakerTypeOf, C_MIN, disconnectionLabel, K_CPC_XLPE_CU, loopFigures } from '../../calc/earthing';
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
          the fault: S ≥ I·√t / {K_CPC_XLPE_CU}, with I the current through that conductor — for parallel runs its equal share at the end-of-circuit fault (identical runs bonded at both ends; marked "assumed sharing" when only that makes it pass, as a fault within one run isn't covered). The total If sets the disconnection check. Change the breaker type or protective conductor size by editing the feeder.
        </>
      }
    >
      <table>
        <thead>
          <tr>
            <th>Circuit</th><th>Board</th><th>Breaker</th><th>Cable / CPC (mm²)</th><th>Ze (Ω)</th><th>Zs (Ω)</th>
            <th>Max Zs (Ω)</th><th>If (A)</th><th>Ia (A)</th><th>Required</th><th>Disconnection</th><th title="Minimum size of each protective conductor for the fault energy, from the current through it">CPC min, each (mm²)</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const f = r.feeder;
            const lf = loopFigures(r);
            return (
              <tr key={f.id} onClick={() => onSelectFeeder(f.id)}>
                <td>{f.id}</td>
                <td>{f.boardId}</td>
                <td>{f.breakerRatingA} A {breakerTypeOf(f)}</td>
                <td>{f.cableCsaMm2} / {r.cpcMm2}</td>
                <td title={r.sourceMissing}>{lf.ze}</td>
                <td className={r.zsOhm > r.maxZsOhm ? r.disconnection : ''}>{lf.zs}</td>
                <td>{r.maxZsOhm.toFixed(4)}</td>
                <td>{lf.fault}</td>
                <td>{r.tripA.toFixed(0)}</td>
                <td>{r.requiredS} s</td>
                <StatusCell status={r.disconnection}>
                  <span title={r.sourceMissing}>{disconnectionLabel(r)}</span>
                </StatusCell>
                <StatusCell status={r.adiabatic}><span title={r.adiabaticNote}>{r.adiabaticMinMm2.toFixed(1)}{r.runs > 1 ? <span className="m"> ({r.runs} runs, {r.cpcCurrentA.toFixed(0)} A each{r.adiabatic === 'warn' ? ', assumed sharing' : ''})</span> : null}</span></StatusCell>
                <StatusCell status={r.status} />
              </tr>
            );
          })}
        </tbody>
      </table>
      {(() => { const m = [...new Set(results.map((r) => r.sourceMissing).filter(Boolean))]; return m.length ? <p className="bad">Not verified — {m.join('; ')}. Ze isn't assumed to be 0: enter the source data so the loop is complete. Zs shown is a minimum and If a maximum for those circuits.</p> : null; })()}
    </Page>
  );
}
