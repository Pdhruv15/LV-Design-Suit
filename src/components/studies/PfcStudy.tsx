import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { settingsOf } from '../../types';
import { boardsInSupplyOrder } from '../../calc/summary';
import { addPfcBanks, PFC_STEPS, pfcPlanOf, planPfc, STRATEGY_LABEL, type Detuning, type PfcPlan, type PfcStrategy } from '../../calc/pfc';
import { buildStudyReportHtml, buildStudyWorkbook, pfcSection, scopeOf, setupOf } from '../../docs/studyReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { NumberSetting, Page } from '../ui';
import PfcCalculator from './PfcCalculator';
import { powerTriangleSvg, triangleFrom } from '../../calc/pfcCalc';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

const HINT: Record<PfcStrategy, string> = {
  central: 'One automatic bank at the main board corrects the whole installation — the usual choice, and what DEWA looks at (PF at the intake).',
  group: 'Banks at the boards you tick, e.g. a chiller SMDB or an MCC — they also unload those boards’ incomer cables. The main board takes what’s left.',
  individual: 'Fixed capacitors at the larger motors / HVAC units, switched with them. The main board takes what’s left.'
};

/** Power factor correction: choose where the banks go (central / group /
 * individual, which boards), how they're built (steps, detuning), then add
 * them to the SLD and export the calculation sheet. */
export default function PfcStudy({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus?: (m: string) => void }) {
  const plan = useMemo(() => pfcPlanOf(project), [project]);
  const target = settingsOf(project).pfTarget;
  const setPlan = (patch: Partial<PfcPlan>) => onChange({ ...project, pfc: { ...project.pfc, ...patch } });
  const r = useMemo(() => planPfc(project, plan), [project, plan]);
  const boards = useMemo(() => boardsInSupplyOrder(project), [project]);
  const mains = boards.filter((b) => !b.upstreamId);
  const depth = (id: string) => { let d = 0, b = project.boards.find((x) => x.id === id); while (b?.upstreamId && d < 20) { d++; b = project.boards.find((x) => x.id === b!.upstreamId); } return d; };
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'design' | 'calc'>(() => (project.boards.length ? 'design' : 'calc'));
  const modeSwitch = <div className="seg">{([['design', 'From the design'], ['calc', 'Custom calculation']] as const).map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div>;

  const choice = plan.strategy === 'central' ? mains : boards;
  const ticked = (id: string) => (plan.strategy === 'central' && !plan.boards.length) || plan.boards.includes(id);
  const tick = (id: string, on: boolean) => {
    const cur = plan.strategy === 'central' && !plan.boards.length ? mains.map((b) => b.id) : plan.boards;
    const next = on ? [...cur, id] : cur.filter((x) => x !== id);
    setPlan({ boards: plan.strategy === 'central' && next.length === mains.length ? [] : next });
  };

  const toAdd = r.rows.filter((x) => x.bankKvar > 0);
  function addToSld(keys?: string[]) {
    const { project: next, added } = addPfcBanks(project, r, keys);
    if (!added.length) return;
    onChange(next);
    onStatus?.(`Added to the SLD: ${added.join(', ')} — run the calculations (F5) to check them`);
  }

  async function exportSheet(kind: 'pdf' | 'xlsx') {
    setBusy(true);
    try {
      const scope = scopeOf(project, { boards: [], downstream: true });
      const section = pfcSection(project, scope);
      const setup = setupOf(project);
      const meta = { title: 'Power factor correction', docNo: setup.docNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy };
      const name = safeFileName(`${project.name} - Power factor correction`);
      const m = kind === 'pdf'
        ? await savePdf(`${name}.pdf`, buildStudyReportHtml(project, scope, [section], meta), { cssPages: true })
        : await saveBinary(`${name}.xlsx`, await workbookBytes(buildStudyWorkbook(project, scope, [section], meta)), 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus?.(m);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'calc') {
    return (
      <Page title="Power factor correction" intro="A custom calculation, no design needed — e.g. an existing installation: enter what was measured (kW, kVA or V and A with the PF), the DEWA bill's kWh and kvarh, or a list of loads. The bank, its steps and detuning, the diagrams and the report update as you type." actions={modeSwitch}>
        <PfcCalculator project={project} onChange={onChange} onStatus={(m) => onStatus?.(m)} />
      </Page>
    );
  }

  return (
    <Page
      title="Power factor correction"
      intro="Choose where the capacitor banks go, and only those are sized. Banks are sized from the bottom up — a bank only covers what the banks below it don’t — and capacitors already on the SLD count."
      actions={<>
        {modeSwitch}
        <NumberSetting label="Target PF" value={target} step={0.01} min={0.8} max={1} onChange={(v) => onChange({ ...project, studySettings: { ...project.studySettings, pfTarget: v } })} />
        <button className="chip" disabled={busy} onClick={() => exportSheet('pdf')}>PDF sheet</button>
        <button className="chip" disabled={busy} onClick={() => exportSheet('xlsx')}>Excel</button>
      </>}
    >
      <div className="pfc-setup">
        <section className="card">
          <h4>Where to correct</h4>
          <div className="pfc-strategies">
            {(Object.keys(STRATEGY_LABEL) as PfcStrategy[]).map((s) => (
              <label key={s} className={`pfc-strategy${plan.strategy === s ? ' on' : ''}`}>
                <input type="radio" name="pfc-strategy" checked={plan.strategy === s} onChange={() => setPlan({ strategy: s, boards: [] })} />
                <span><b>{STRATEGY_LABEL[s].split(' — ')[0]}</b> — {STRATEGY_LABEL[s].split(' — ')[1]}</span>
              </label>
            ))}
          </div>
          <p className="m">{HINT[plan.strategy]}</p>

          {plan.strategy !== 'individual' && (
            <>
              <div className="pfc-boards-head">
                <b>{plan.strategy === 'central' ? 'Main boards to correct' : 'Boards that get a bank'}</b>
                {plan.strategy === 'group' && plan.boards.length > 0 && <button className="linkish" onClick={() => setPlan({ boards: [] })}>clear</button>}
              </div>
              <div className="pfc-boards">
                {choice.map((b) => (
                  <label key={b.id} className="row" style={{ paddingLeft: plan.strategy === 'group' ? depth(b.id) * 14 : 0 }}>
                    <input type="checkbox" checked={ticked(b.id)} onChange={(e) => tick(b.id, e.target.checked)} />
                    {b.id} <span className="m">{b.kind}{b.name && b.name !== b.id ? ` · ${b.name}` : ''}</span>
                  </label>
                ))}
              </div>
              {plan.strategy === 'group' && !plan.boards.length && <p className="warn">Tick the boards that should have their own bank.</p>}
            </>
          )}
          {plan.strategy === 'individual' && (
            <div className="settings">
              <NumberSetting label="Motors / HVAC from" value={plan.minKw} min={0} suffix="kW" onChange={(v) => setPlan({ minKw: v })} />
            </div>
          )}
          {plan.strategy !== 'central' && (
            <label className="row"><input type="checkbox" checked={plan.remainder} onChange={(e) => setPlan({ remainder: e.target.checked })} /> Also a bank at the main board for what’s left</label>
          )}
        </section>

        <section className="card">
          <h4>Bank design</h4>
          <div className="pfc-design">
            <label>Step size
              <select value={plan.stepKvar} onChange={(e) => setPlan({ stepKvar: +e.target.value })}>
                {PFC_STEPS.map((s) => <option key={s} value={s}>{s} kvar</option>)}
              </select>
            </label>
            <label>Detuning reactor
              <select value={String(plan.detuning)} onChange={(e) => setPlan({ detuning: (e.target.value === 'auto' ? 'auto' : +e.target.value) as Detuning })}>
                <option value="auto">Automatic (7 % where non-linear load ≥ 25 %)</option>
                <option value="0">None (standard capacitors)</option>
                <option value="7">7 % (189 Hz) — VFDs, IT, LED</option>
                <option value="14">14 % (134 Hz) — high 3rd harmonic</option>
              </select>
            </label>
            <label>Light-load check at
              <select value={plan.lightLoadPct} onChange={(e) => setPlan({ lightLoadPct: +e.target.value })}>
                {[20, 30, 40, 50].map((p) => <option key={p} value={p}>{p} % of demand</option>)}
              </select>
            </label>
          </div>
          <p className="m">Board banks switch automatically in steps (APFC relay); individual capacitors are fixed. Capacitor voltage ≥ 1.05 × U ÷ (1 − p); breaker ≥ 1.43 × bank current.</p>
        </section>
      </div>

      <div className="cards flush pfc-mains">
        {r.mains.map((m) => (
          <section key={m.boardId} className="card">
            <h4>{m.boardId}</h4>
            <div className="pfc-kpi">
              <span>PF <b className={m.pfBefore < target ? 'warn' : 'ok'}>{m.pfBefore.toFixed(2)}</b> → <b className={m.pfAfter >= target - 1e-6 ? 'ok' : 'warn'}>{m.pfAfter.toFixed(3)}</b></span>
              <span>{f1(m.plannedKvar)} kvar new{m.existingKvar ? ` · ${f1(m.existingKvar)} existing` : ''}</span>
              <span>{f0(m.kvaBefore)} → {f0(m.kvaAfter)} kVA{m.releasedKva > 0.5 ? <> · frees <b>{f0(m.releasedKva)} kVA</b></> : null}</span>
              {m.loadingBeforePct !== undefined && <span className="m">Transformer {m.transformerKva} kVA: {f0(m.loadingBeforePct)} % → {f0(m.loadingAfterPct!)} %</span>}
            </div>
            {m.demandKw > 0 && <div className="pfcc-svg pfc-mini" dangerouslySetInnerHTML={{ __html: powerTriangleSvg(triangleFrom(m.demandKw, m.pfBefore, m.pfAfter, target)) }} />}
          </section>
        ))}
      </div>

      <div className="pfc-actions">
        <b>{toAdd.length ? `${toAdd.length} bank${toAdd.length > 1 ? 's' : ''}, ${f1(r.totalKvar)} kvar` : 'No new capacitors needed'}</b>
        {toAdd.length > 0 && <button className="chip primary" onClick={() => addToSld()}>Add all to the SLD</button>}
      </div>

      <table className="pfc-table">
        <thead>
          <tr><th>Location</th><th>Demand (kW)</th><th>Reactive (kvar)</th><th>Existing</th><th>Banks below</th><th>PF now</th><th>Required (kvar)</th><th>Bank</th><th>Detuning · cap. V</th><th>Breaker · cable</th><th>PF after</th><th>Current (A)</th><th /></tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.key} className={x.kind === 'load' ? 'sub' : ''}>
              <td title={x.notes.join('\n')}>
                {x.kind === 'load' ? <span className="m">↳ </span> : null}
                {x.kind === 'load' ? x.label : <b>{x.label}</b>}
                {x.remainder && <span className="m"> (what’s left)</span>}
                {x.notes.map((t) => <div key={t} className={`pfc-note${/leading|check harmonics/.test(t) ? ' warn' : ''}`}>{t}</div>)}
              </td>
              <td>{f0(x.demandKw)}</td>
              <td>{f0(x.demandKvar)}</td>
              <td>{x.existingKvar ? f1(x.existingKvar) : '—'}</td>
              <td>{x.downstreamKvar ? `−${f1(x.downstreamKvar)}` : '—'}</td>
              <td className={x.pfBefore < target ? 'warn' : 'ok'}>{x.pfBefore.toFixed(2)}</td>
              <td>{f1(x.requiredKvar)}</td>
              <td><b>{x.bankKvar ? (x.kind === 'load' ? `${f1(x.bankKvar)} kvar fixed` : `${f1(x.bankKvar)} kvar`) : 'Not needed'}</b>{x.steps > 1 && <div className="m">{x.steps} × {x.stepKvar} kvar</div>}</td>
              <td>{x.bankKvar ? `${x.detunedPct ? `${x.detunedPct} %` : 'None'} · ${x.capVoltageV} V` : '—'}</td>
              <td>{x.bankKvar ? <>{x.breakerA} A<div className="m">{x.cable}</div></> : '—'}</td>
              <td className={x.pfAfter >= target - 1e-6 || x.kind === 'load' ? 'ok' : 'warn'}>{x.pfAfter.toFixed(3)}</td>
              <td>{f0(x.currentBeforeA)} → {f0(x.currentAfterA)}</td>
              <td>{x.bankKvar > 0 && <button className="chip" title="Add this bank to the SLD" onClick={() => addToSld([x.key])}>Add to SLD</button>}</td>
            </tr>
          ))}
          {!r.rows.length && <tr><td colSpan={13} className="m">No banks in this plan — tick a board above.</td></tr>}
        </tbody>
      </table>
      {r.notCorrected.length > 0 && (
        <p className="m">
          No bank of their own: {r.notCorrected.join(', ')}
          {r.rows.some((x) => x.kind === 'board' && !project.boards.find((b) => b.id === x.boardId)?.upstreamId) ? ' — corrected at the main board.' : '.'}
        </p>
      )}
    </Page>
  );
}
