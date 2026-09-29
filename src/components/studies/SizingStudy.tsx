import { Fragment, useMemo, useState } from 'react';
import type { Project, StudySettings } from '../../types';
import { isEssential, settingsOf } from '../../calc/sizing';
import { boardsInSupplyOrder, loadTypeOf } from '../../calc/summary';
import { MOTOR_START_DIP_LIMIT_PCT, starterInfo, starterOf } from '../../calc/motor';
import { applyTransformer, sizeGeneratorByBoards, sizeTransformers, txGenPlanOf, type TxGenPlan, type TxRow } from '../../calc/txGen';
import { subtree } from '../../calc/pfc';
import { buildSection, buildStudyReportHtml, buildStudyWorkbook, scopeOf, setupOf } from '../../docs/studyReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { NumberSetting, Page } from '../ui';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** Transformer per main board and the standby generator from whole boards:
 * no circuit lists unless you ask for them. */
export function TransformerGeneratorStudy({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus?: (m: string) => void }) {
  const s = settingsOf(project);
  const setS = (k: keyof StudySettings, v: number) => onChange({ ...project, studySettings: { ...project.studySettings, [k]: v } });
  const plan = txGenPlanOf(project);
  const setPlan = (patch: Partial<TxGenPlan>) => onChange({ ...project, txGen: { ...project.txGen, ...patch } });
  const tx = useMemo(() => sizeTransformers(project, plan), [project]); // eslint-disable-line react-hooks/exhaustive-deps
  const gen = useMemo(() => sizeGeneratorByBoards(project, plan), [project]); // eslint-disable-line react-hooks/exhaustive-deps
  const boards = useMemo(() => boardsInSupplyOrder(project), [project]);
  const mains = boards.filter((b) => !b.upstreamId);
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const depth = (id: string) => { let d = 0, b = project.boards.find((x) => x.id === id); while (b?.upstreamId && d < 20) { d++; b = project.boards.find((x) => x.id === b!.upstreamId); } return d; };
  const standbyBoards = project.boards.filter((b) => b.standby);

  const txTicked = (id: string) => !plan.txBoards.length || plan.txBoards.includes(id);
  const tickTx = (id: string, on: boolean) => {
    const cur = plan.txBoards.length ? plan.txBoards : mains.map((b) => b.id);
    const next = on ? [...cur, id] : cur.filter((x) => x !== id);
    setPlan({ txBoards: next.length === mains.length ? [] : next });
  };
  const setGenBoard = (id: string, pct: number | undefined) => {
    const g = { ...plan.genBoards };
    if (pct === undefined) delete g[id]; else g[id] = pct;
    setPlan({ genBoards: g });
  };

  function apply(r: TxRow) {
    onChange(applyTransformer(project, r));
    onStatus?.(`${r.board.id}: transformer set to ${r.recommendedKva} kVA, ${r.checks!.impedancePct} % — run the calculations (F5) for the new fault levels`);
  }
  function applyGen() {
    if (standbyBoards.length !== 1 || !gen.recommendedKva) return;
    const b = standbyBoards[0];
    onChange({ ...project, boards: project.boards.map((x) => (x.id === b.id ? { ...x, standby: { kva: gen.recommendedKva! } } : x)) });
    onStatus?.(`${b.id}: standby generator set to ${gen.recommendedKva} kVA`);
  }

  async function exportSheet(kind: 'pdf' | 'xlsx') {
    setBusy(true);
    try {
      const scope = scopeOf(project, { boards: plan.txBoards, downstream: true });
      const section = buildSection('sizing', { project, results: [], earthing: [], selectivity: [] }, scope);
      const setup = setupOf(project);
      const meta = { title: section.title, docNo: setup.docNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy };
      const name = safeFileName(`${project.name} - Transformer and generator sizing`);
      const m = kind === 'pdf'
        ? await savePdf(`${name}.pdf`, buildStudyReportHtml(project, scope, [section], meta), { cssPages: true })
        : await saveBinary(`${name}.xlsx`, await workbookBytes(buildStudyWorkbook(project, scope, [section], meta)), 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus?.(m);
    } finally {
      setBusy(false);
    }
  }

  const candidates = project.feeders.filter((f) => !f.feedsBoardId && !f.generation && !f.kvar);
  const counted = gen.picks.filter((x) => !x.within && x.pct > 0);
  // Boards below a board on the generator are in it already.
  const inside = new Map<string, string>();
  for (const x of counted) for (const id of subtree(project, x.board.id)) if (id !== x.board.id && !inside.has(id)) inside.set(id, x.board.id);

  return (
    <Page
      title="Transformer and generator sizing"
      intro="Sized at board level: a transformer for each main board, and the generator from the boards it supplies. The circuits below them are summed, not listed."
      actions={<>
        <button className="chip" disabled={busy} onClick={() => exportSheet('pdf')}>PDF sheet</button>
        <button className="chip" disabled={busy} onClick={() => exportSheet('xlsx')}>Excel</button>
      </>}
    >
      <section className="card txg-card">
        <div className="txg-head">
          <h4>Transformers</h4>
          <div className="settings">
            <NumberSetting label="Future growth" value={s.futureGrowthPct} suffix="%" onChange={(v) => setS('futureGrowthPct', v)} />
            <NumberSetting label="Max loading" value={s.transformerMaxLoadingPct} min={10} max={100} suffix="%" onChange={(v) => setS('transformerMaxLoadingPct', v)} />
            <label className="txg-sel">Sizes
              <select value={plan.sizeList} onChange={(e) => setPlan({ sizeList: e.target.value as TxGenPlan['sizeList'] })}>
                <option value="dewa">DEWA 11 / 0.415 kV — 500, 1000, 1500 kVA</option>
                <option value="iec">IEC standard — 100 … 3150 kVA</option>
              </select>
            </label>
            <label className="row"><input type="checkbox" checked={plan.includePfc} onChange={(e) => setPlan({ includePfc: e.target.checked })} /> After PF correction</label>
            {(project.ties ?? []).length > 0 && <NumberSetting label="Outage loading" value={plan.emergencyLoadingPct} min={80} max={150} suffix="%" onChange={(v) => setPlan({ emergencyLoadingPct: v })} />}
          </div>
        </div>
        {mains.length > 1 && (
          <div className="txg-pick">
            <span className="m">Size:</span>
            {mains.map((b) => (
              <label key={b.id} className="row"><input type="checkbox" checked={txTicked(b.id)} onChange={(e) => tickTx(b.id, e.target.checked)} /> {b.id}</label>
            ))}
          </div>
        )}
        <table className="txg-table">
          <thead>
            <tr><th>Main board</th><th>Demand</th><th>Design</th><th>Recommended</th><th>Installed</th><th>FLC · main breaker</th><th>LV fault · lowest Icu</th><th>Regulation</th><th>Busbar</th><th>Duty / standby</th><th /></tr>
          </thead>
          <tbody>
            {tx.map((r) => {
              const c = r.checks;
              const isOpen = open.includes(r.board.id);
              const same = r.installedKva === r.recommendedKva && (!c || r.board.sourceImpedancePct === c.impedancePct);
              return (
                <Fragment key={r.board.id}>
                  <tr>
                    <td>
                      <button className="linkish txg-toggle" onClick={() => setOpen(isOpen ? open.filter((x) => x !== r.board.id) : [...open, r.board.id])} title="What the demand is made of">{isOpen ? '▾' : '▸'}</button>
                      <b>{r.board.id}</b>
                    </td>
                    <td>{f0(r.demandKva)} kVA<div className="m">PF {r.pf.toFixed(2)}{r.pfcKvar ? ` · −${f0(r.pfcKvar)} kvar PFC` : ''}</div></td>
                    <td>{f0(r.designKva)} kVA</td>
                    <td><b>{r.recommendedKva ? `${r.split > 1 ? `${r.split} × ` : r.n1 ? '2 × ' : ''}${r.recommendedKva} kVA` : '—'}</b>{r.split > 1 && <div className="warn">Above the largest size — split into {r.split} boards</div>}</td>
                    <td className={r.adequate === false ? 'bad' : ''}>{r.installedKva ? <>{r.installedKva} kVA<div className="m">{f0(r.loadingPct!)} % loaded{r.adequate === false ? ' — too small' : ''}</div></> : 'Not set'}</td>
                    <td>{c ? <>{f0(c.flcA)} A<div className="m">{c.acbA >= 800 ? 'ACB' : 'MCCB'} {c.acbA} A</div></> : '—'}</td>
                    <td className={c?.icuOk === false ? 'bad' : ''}>{c ? <>{f1(c.faultKa)} kA<div className="m">{c.impedancePct} % · lowest Icu {c.minIcuKa ?? '—'} kA</div></> : '—'}</td>
                    <td>{c ? `${f1(c.regulationPct)} %` : '—'}</td>
                    <td className={c?.busbarOk === false ? 'bad' : ''}>{c?.busbarA ? `${c.busbarA} A` : '—'}</td>
                    <td><input type="checkbox" title="Two transformers, each for the whole load" checked={r.n1} onChange={(e) => setPlan({ n1: e.target.checked ? [...plan.n1, r.board.id] : plan.n1.filter((x) => x !== r.board.id) })} /></td>
                    <td>{r.recommendedKva && r.split === 1 && (same ? <span className="ok">On the SLD</span> : <button className="chip" onClick={() => apply(r)} title="Set this transformer (kVA, typical impedance) on the SLD">Apply to SLD</button>)}</td>
                  </tr>
                  {r.outage && (
                    <tr className="sub"><td /><td colSpan={10} className={r.outage.ok ? 'm' : 'warn'}>
                      Bus coupler: with the {r.outage.with} transformer out, this one carries {f0(r.outage.kva)} kVA{r.outage.pctOfRecommended !== undefined ? ` = ${f0(r.outage.pctOfRecommended)} % of ${r.recommendedKva} kVA` : ''}{r.outage.ok ? ' — OK' : ` — above ${plan.emergencyLoadingPct} %; shed load on outage or go a size up`}
                    </td></tr>
                  )}
                  {isOpen && r.breakdown.map((x) => (
                    <tr key={x.id} className="sub"><td style={{ paddingLeft: 30 }}>{x.id === r.board.id ? <span className="m">{x.label}</span> : <>{x.id} <span className="m">{x.label}</span></>}</td><td>{f0(x.kva)} kVA</td><td colSpan={9} /></tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {tx.some((r) => r.checks?.icuOk === false) && <p className="bad">A breaker on the MDB is rated below the LV fault level — raise its breaking capacity.</p>}
      </section>

      <section className="card txg-card">
        <div className="txg-head">
          <h4>Standby generator</h4>
          <div className="settings">
            <NumberSetting label="Max loading" value={s.generatorMaxLoadingPct} min={10} max={100} suffix="%" onChange={(v) => setS('generatorMaxLoadingPct', v)} />
          </div>
        </div>
        <div className="txg-gen">
          <div>
            <b>Boards on the generator</b>
            <p className="m">Tick whole boards; set a share for a board that’s only partly essential. EMDBs and boards with an ATS are on it already. Circuits marked essential (fire pumps) are added.</p>
            <div className="txg-boards">
              {boards.map((b) => {
                const pick = gen.picks.find((x) => x.board.id === b.id);
                const on = !!pick && pick.pct > 0;
                const within = inside.get(b.id);
                return (
                  <div key={b.id} className="txg-board" style={{ paddingLeft: depth(b.id) * 14 }}>
                    <label className="row">
                      <input type="checkbox" checked={on || !!within} disabled={!!within}
                        onChange={(e) => setGenBoard(b.id, e.target.checked ? 100 : pick?.auto ? 0 : undefined)} />
                      {b.id} <span className="m">{b.kind}</span>
                    </label>
                    {pick?.auto && on && <span className="tag">{pick.auto === 'emdb' ? 'EMDB' : 'ATS'}</span>}
                    {on && !within && (
                      <span className="txg-pct"><input inputMode="numeric" value={pick!.pct} onChange={(e) => { const v = Math.round(+e.target.value); if (v >= 0 && v <= 100) setGenBoard(b.id, v); }} /> %
                        <span className="m"> {f0(pick!.kw)} kW</span></span>
                    )}
                    {within && <span className="m">in {within}</span>}
                  </div>
                );
              })}
            </div>
            {gen.circuits.length > 0 && (
              <p className="m">Also on it: {gen.circuits.map((f) => `${f.id} (${f.name}, ${f0(f.loadKw * f.demandFactor)} kW)`).join(', ')}</p>
            )}
          </div>
          <dl className="kv">
            <dt>Running demand</dt><dd>{f0(gen.demandKw)} kW · {f0(gen.demandKva)} kVA</dd>
            <dt>For the running load</dt><dd>{f0(gen.demandKva)} ÷ {(s.generatorMaxLoadingPct / 100).toFixed(2)} = {f0(gen.runningDesignKva)} kVA</dd>
            {gen.motor && (
              <>
                <dt>Largest motor, started last</dt>
                <dd>{gen.motor.feeder.id} ({starterInfo(starterOf(gen.motor.feeder)).label.toLowerCase()}): {f0(gen.motor.startingKva)} kVA starting on top of {f0(gen.motor.baseKva)} kVA running</dd>
                <dt>For the motor start</dt>
                <dd className={gen.startDesignKva > gen.runningDesignKva ? 'warn' : ''}>{f0(gen.startDesignKva)} kVA so the dip stays ≤ {MOTOR_START_DIP_LIMIT_PCT} %{gen.startDesignKva > gen.runningDesignKva ? ' — this sets the size' : ''}</dd>
              </>
            )}
            <dt>Recommended</dt>
            <dd><b>{gen.recommendedKva ? `${gen.recommendedKva} kVA / ${f0(gen.recommendedKw!)} kW (0.8 PF)` : 'Tick the boards on the generator'}</b>
              {gen.motor?.dipPct !== undefined && <div className="m">dip ≈ {f1(gen.motor.dipPct)} % when {gen.motor.feeder.id} starts</div>}
            </dd>
            {gen.softStartKva && <><dt>With a soft starter</dt><dd className="ok">{gen.softStartKva} kVA would do — soft starter / star-delta on {gen.motor!.feeder.id}</dd></>}
            {gen.flcA && <><dt>Full-load current · ATS</dt><dd>{f0(gen.flcA)} A · {gen.atsA} A ATS / breaker</dd></>}
            <dt>Installed</dt>
            <dd className={gen.installedKva && gen.recommendedKva && gen.installedKva < gen.recommendedKva ? 'bad' : ''}>
              {gen.installedKva ? `${gen.installedKva} kVA` : 'None on the SLD'}
              {standbyBoards.length === 1 && gen.recommendedKva && gen.installedKva !== gen.recommendedKva && <button className="chip" style={{ marginLeft: 8 }} onClick={applyGen}>Set {gen.recommendedKva} kVA on {standbyBoards[0].id}</button>}
            </dd>
          </dl>
        </div>
        <details className="txg-adv">
          <summary>Advanced: pick individual circuits ({candidates.filter(isEssential).length} marked essential)</summary>
          <table>
            <thead><tr><th>Essential</th><th>Circuit</th><th>Board</th><th>Type</th><th>Demand (kW)</th><th>PF</th></tr></thead>
            <tbody>
              {candidates.map((f) => (
                <tr key={f.id} onClick={() => onChange({ ...project, feeders: project.feeders.map((x) => (x.id === f.id ? { ...x, essential: !isEssential(f) } : x)) })}>
                  <td><input type="checkbox" checked={isEssential(f)} readOnly aria-label={`${f.id} essential`} /></td>
                  <td>{f.id}</td><td>{f.boardId}</td><td>{loadTypeOf(f)}</td>
                  <td>{(f.loadKw * f.demandFactor).toFixed(0)}</td><td>{f.powerFactor.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        {counted.length === 0 && gen.circuits.length === 0 && <p className="m">No boards or circuits on the generator yet.</p>}
      </section>
    </Page>
  );
}
