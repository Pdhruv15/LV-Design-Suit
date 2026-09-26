import { useMemo } from 'react';
import type { Project, StudySettings } from '../../types';
import { isEssential, settingsOf, sizeGenerator, sizePfc, sizeTransformer } from '../../calc/sizing';
import { boardsInSupplyOrder } from '../../calc/summary';
import { loadTypeOf } from '../../calc/summary';
import { NumberSetting, Page } from '../ui';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

function useSettings(project: Project, onChange: (p: Project) => void) {
  const s = settingsOf(project);
  const set = (k: keyof StudySettings, v: number) => onChange({ ...project, studySettings: { ...project.studySettings, [k]: v } });
  return { s, set };
}

export function TransformerGeneratorStudy({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const { s, set } = useSettings(project, onChange);
  const tx = useMemo(() => sizeTransformer(project), [project]);
  const gen = useMemo(() => sizeGenerator(project), [project]);
  const candidates = project.feeders.filter((f) => !f.feedsBoardId && !f.generation);

  function toggleEssential(id: string, on: boolean) {
    onChange({ ...project, feeders: project.feeders.map((f) => (f.id === id ? { ...f, essential: on } : f)) });
  }

  return (
    <Page title="Transformer and generator sizing">
      <div className="cards flush">
        <section className="card">
          <h4>Transformer</h4>
          <div className="settings">
            <NumberSetting label="Future growth" value={s.futureGrowthPct} suffix="%" onChange={(v) => set('futureGrowthPct', v)} />
            <NumberSetting label="Max loading" value={s.transformerMaxLoadingPct} min={10} max={100} suffix="%" onChange={(v) => set('transformerMaxLoadingPct', v)} />
          </div>
          <dl className="kv">
            <dt>Maximum demand</dt><dd>{f0(tx.demandKva)} kVA</dd>
            <dt>Design requirement</dt><dd>{f0(tx.demandKva)} × {(1 + s.futureGrowthPct / 100).toFixed(2)} ÷ {(s.transformerMaxLoadingPct / 100).toFixed(2)} = {f0(tx.designKva)} kVA</dd>
            <dt>Recommended standard size</dt><dd><b>{tx.recommendedKva ? `${tx.recommendedKva} kVA` : 'Above 3150 kVA — split the supply'}</b></dd>
            <dt>Installed</dt>
            <dd className={tx.adequate ? 'ok' : 'bad'}>
              {tx.installedKva ? `${tx.installedKva} kVA (${tx.loadingPct?.toFixed(0)}% loaded now) — ${tx.adequate ? 'adequate' : 'undersized for the design requirement'}` : 'Not set'}
            </dd>
          </dl>
        </section>

        <section className="card">
          <h4>Standby generator</h4>
          <div className="settings">
            <NumberSetting label="Max loading" value={s.generatorMaxLoadingPct} min={10} max={100} suffix="%" onChange={(v) => set('generatorMaxLoadingPct', v)} />
          </div>
          <dl className="kv">
            <dt>Essential demand</dt><dd>{f0(gen.demandKw)} kW · {f0(gen.demandKva)} kVA</dd>
            <dt>Design requirement</dt><dd>{f0(gen.designKva)} kVA</dd>
            <dt>Recommended standard size</dt><dd><b>{gen.recommendedKva ? `${gen.recommendedKva} kVA` : gen.essential.length ? 'Above 2500 kVA' : 'Tick essential loads below'}</b></dd>
            {gen.largestMotor && (
              <>
                <dt>Largest motor</dt>
                <dd>{gen.largestMotor.feeder.id}: {f0(gen.largestMotor.runningKva)} kVA running, ≈ {f0(gen.largestMotor.dolStartingKva)} kVA DOL start</dd>
              </>
            )}
          </dl>
          {gen.largestMotor && (
            <p className="m note">Check the generator's transient voltage dip for the largest motor start against the manufacturer's data; a soft starter or VFD reduces the starting kVA.</p>
          )}
        </section>
      </div>

      <h3 className="section-title flush">Essential loads (on generator)</h3>
      <table>
        <thead><tr><th>On generator</th><th>Circuit</th><th>Board</th><th>Type</th><th>Demand (kW)</th><th>PF</th></tr></thead>
        <tbody>
          {candidates.map((f) => (
            <tr key={f.id} onClick={() => toggleEssential(f.id, !isEssential(f))}>
              <td><input type="checkbox" checked={isEssential(f)} readOnly aria-label={`${f.id} on generator`} /></td>
              <td>{f.id}</td><td>{f.boardId}</td><td>{loadTypeOf(f)}</td>
              <td>{(f.loadKw * f.demandFactor).toFixed(0)}</td><td>{f.powerFactor.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}

export function PfcStudy({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const { s, set } = useSettings(project, onChange);
  const rows = useMemo(() => boardsInSupplyOrder(project).map((b) => ({ board: b, r: sizePfc(project, b.id) })), [project]);

  return (
    <Page
      title="Power factor correction"
      intro="Capacitor bank at each board: Qc = P × (tan φ1 − tan φ2), rounded up to 25 kvar steps. A single bank at the main board corrects the whole installation; banks at sub-boards also reduce the current in their incomer cables. Consider detuned (reactor) banks where there are harmonic loads such as VFDs or IT equipment."
      actions={<NumberSetting label="Target PF" value={s.pfTarget} step={0.01} min={0.8} max={1} onChange={(v) => set('pfTarget', v)} />}
    >
      <table>
        <thead>
          <tr><th>Board</th><th>Demand (kW)</th><th>Reactive (kvar)</th><th>PF now</th><th>Required (kvar)</th><th>Bank</th><th>PF after</th><th>Current now → after (A)</th></tr>
        </thead>
        <tbody>
          {rows.map(({ board, r }) => (
            <tr key={board.id}>
              <td>{board.upstreamId ? board.id : <b>{board.id} (whole installation)</b>}</td>
              <td>{f0(r.demandKw)}</td>
              <td>{f0(r.demandKvar)}</td>
              <td className={r.pfBefore < r.pfTarget ? 'warn' : 'ok'}>{r.pfBefore.toFixed(2)}</td>
              <td>{r.requiredKvar.toFixed(1)}</td>
              <td><b>{r.bankKvar ? `${r.bankKvar} kvar` : 'Not needed'}</b></td>
              <td className="ok">{r.pfAfter.toFixed(3)}</td>
              <td>{f0(r.currentBeforeA)} → {f0(r.currentAfterA)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}
