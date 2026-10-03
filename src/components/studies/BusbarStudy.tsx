import { useMemo, useState } from 'react';
import { boardLocation } from '../../model/levels';
import type { Project } from '../../types';
import { boardsInSupplyOrder } from '../../calc/summary';
import { MATERIAL_LABEL, riserFromBuilding, newRiser, sizeRiser, TYPICAL_BUSBAR_DATA, type BusbarData, type BusbarType, type BusMaterial, type BusRiser, type RiserFloor, type RiserResult } from '../../calc/busbar';
import { buildSection, buildStudyReportHtml, buildStudyWorkbook, scopeOf, setupOf } from '../../docs/studyReport';
import { workbookBytes } from '../../docs/formWorkbook';
import { safeFileName, saveBinary, savePdf } from '../../util/files';
import { Page } from '../ui';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const f2 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const num = (v: string) => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);

const DATA_COLS: { key: keyof BusbarType; label: string }[] = [
  { key: 'ratingA', label: 'Rating (A)' }, { key: 'csaMm2', label: 'Area / phase (mm²)' }, { key: 'rMohmPerM', label: 'R (mΩ/m)' }, { key: 'xMohmPerM', label: 'X (mΩ/m)' },
  { key: 'icwKa', label: 'Icw 1 s (kA)' }, { key: 'widthMm', label: 'Width (mm)' }, { key: 'heightMm', label: 'Height (mm)' }, { key: 'kgPerM', label: 'Weight (kg/m)' }
];

/** Busbar trunking risers for high-rise buildings: floors and their loads
 * in, rating, material, voltage drop, withstand and physical size out. */
export default function BusbarStudy({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus?: (m: string) => void }) {
  const risers = project.busRisers ?? [];
  const [sel, setSel] = useState(risers[0]?.id ?? '');
  const [dataMat, setDataMat] = useState<BusMaterial>('cu');
  const [busy, setBusy] = useState(false);
  const riser = risers.find((r) => r.id === sel) ?? risers[0];
  const boards = boardsInSupplyOrder(project);
  const data: BusbarData = project.busbarData ?? TYPICAL_BUSBAR_DATA;
  const res = useMemo(() => (riser ? sizeRiser(project, riser) : undefined), [project, riser]);
  const alt = useMemo(() => (riser ? sizeRiser(project, { ...riser, material: riser.material === 'cu' ? 'al' : 'cu' }) : undefined), [project, riser]);

  const setRisers = (next: BusRiser[]) => onChange({ ...project, busRisers: next });
  const setRiser = (patch: Partial<BusRiser>) => riser && setRisers(risers.map((r) => (r.id === riser.id ? { ...r, ...patch } : r)));
  const setFloor = (id: string, patch: Partial<RiserFloor>) => riser && setRiser({ floors: riser.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const add = () => {
    let n = risers.length + 1;
    while (risers.some((r) => r.id === `BR-${n}`)) n++;
    const r = newRiser(`BR-${n}`, boards.find((b) => !b.upstreamId)?.id);
    setRisers([...risers, r]);
    setSel(r.id);
  };
  const addFloor = () => {
    if (!riser) return;
    let n = riser.floors.length + 1;
    while (riser.floors.some((f) => f.id === `F${n}`)) n++;
    const last = riser.floors[riser.floors.length - 1];
    setRiser({ floors: [...riser.floors, { id: `F${n}`, name: `Level ${n}`, kw: last?.kw ?? 50, pf: last?.pf ?? 0.9 }] });
  };
  const fromBoards = () => {
    if (!riser?.sourceBoardId) return;
    const below = boards.filter((b) => b.upstreamId === riser.sourceBoardId);
    if (!below.length) { onStatus?.(`${riser.sourceBoardId} feeds no boards — enter the floors’ loads`); return; }
    setRiser({ floors: below.map((b, i) => ({ id: `F${i + 1}`, name: boardLocation(project, b) || b.name || b.id, boardId: b.id })) });
    onStatus?.(`One tap-off per board fed from ${riser.sourceBoardId} (${below.length}), with their demand`);
  };
  const setData = (m: BusMaterial, rows: BusbarType[]) => onChange({ ...project, busbarData: { ...data, [m]: [...rows].sort((a, b) => a.ratingA - b.ratingA) } });

  async function exportSheet(kind: 'pdf' | 'xlsx') {
    setBusy(true);
    try {
      const scope = scopeOf(project, { boards: [], downstream: true });
      const section = buildSection('busbar', { project, results: [], earthing: [], selectivity: [] }, scope);
      const setup = setupOf(project);
      const meta = { title: section.title, docNo: setup.docNo, preparedBy: setup.preparedBy, checkedBy: setup.checkedBy };
      const name = safeFileName(`${project.name} - Busbar risers`);
      const m = kind === 'pdf'
        ? await savePdf(`${name}.pdf`, buildStudyReportHtml(project, scope, [section], meta), { cssPages: true })
        : await saveBinary(`${name}.xlsx`, await workbookBytes(buildStudyWorkbook(project, scope, [section], meta)), 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus?.(m);
    } finally {
      setBusy(false);
    }
  }

  const typeText = (r?: RiserResult) => (r?.type ? `${r.type.ratingA} A ${MATERIAL_LABEL[r.riser.material].toLowerCase()}` : 'Above the data');

  return (
    <Page
      title="Busbar trunking risers"
      intro="For high-rise buildings: a busway riser from a main board with a tap-off unit on each floor, instead of a cable to every floor. Enter the floors (or take them from the boards), and get the rating in copper or aluminium, conductor area, voltage drop floor by floor, short-circuit withstand, and the size, weight and parts."
      actions={<>
        <button className="chip" onClick={add}>+ Riser</button>
        <button className="chip" disabled={busy || !risers.length} onClick={() => exportSheet('pdf')}>PDF sheet</button>
        <button className="chip" disabled={busy || !risers.length} onClick={() => exportSheet('xlsx')}>Excel</button>
      </>}
    >
      {!riser ? (
        <div className="card"><p>No busbar riser yet.</p><button className="chip primary" onClick={add}>Add a busbar riser</button></div>
      ) : (
        <>
          {risers.length > 1 && (
            <div className="seg bb-risers" role="tablist">
              {risers.map((r) => <button key={r.id} role="tab" className={r.id === riser.id ? 'on' : ''} onClick={() => setSel(r.id)}>{r.name}</button>)}
            </div>
          )}
          <section className="card bb-setup">
            <div className="bb-grid">
              <label>Name<input value={riser.name} onChange={(e) => setRiser({ name: e.target.value })} /></label>
              <label>Fed from
                <select value={riser.sourceBoardId ?? ''} onChange={(e) => setRiser({ sourceBoardId: e.target.value || undefined })}>
                  <option value="">—</option>
                  {boards.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
                </select>
              </label>
              <label>Material
                <span className="seg">
                  {(['cu', 'al'] as const).map((m) => <button key={m} className={riser.material === m ? 'on' : ''} onClick={() => setRiser({ material: m })}>{MATERIAL_LABEL[m]}</button>)}
                </span>
              </label>
              <label>Feed to the riser foot (m)<input inputMode="decimal" value={riser.feedM} onChange={(e) => setRiser({ feedM: num(e.target.value) ?? 0 })} /></label>
              <label>Floor-to-floor height (m)<input inputMode="decimal" value={riser.floorHeightM} onChange={(e) => setRiser({ floorHeightM: num(e.target.value) ?? 3.6 })} /></label>
              <label title="Floors the riser passes before the first tap-off (e.g. basements, podium)">Floors before the first tap-off<input inputMode="numeric" value={riser.offsetFloors} onChange={(e) => setRiser({ offsetFloors: Math.max(0, Math.round(num(e.target.value) ?? 0)) })} /></label>
              <label>Diversity<input inputMode="decimal" value={riser.diversity ?? ''} placeholder={res ? `auto ${res.diversity}` : 'auto'} onChange={(e) => setRiser({ diversity: num(e.target.value) })} /></label>
              <label>Ambient (°C)<input inputMode="decimal" value={riser.ambientC ?? ''} placeholder={String(project.ambientC)} onChange={(e) => setRiser({ ambientC: num(e.target.value) })} /></label>
              <label>Straight length (m)<input inputMode="decimal" value={riser.elementM} onChange={(e) => setRiser({ elementM: num(e.target.value) ?? 3 })} /></label>
              <label>Elbows<input inputMode="numeric" value={riser.elbows} onChange={(e) => setRiser({ elbows: Math.max(0, Math.round(num(e.target.value) ?? 0)) })} /></label>
            </div>
            <div className="bb-row-actions">
              <button className="linkish bad" style={{ marginLeft: 0 }} onClick={() => { if (window.confirm(`Delete ${riser.name}?`)) { setRisers(risers.filter((r) => r.id !== riser.id)); setSel(''); } }}>Delete this riser</button>
            </div>
          </section>

          <h3 className="section-title flush">Floors and tap-offs <span className="m">(bottom to top)</span></h3>
          <table className="bb-floors">
            <thead><tr><th>Floor</th><th>Board</th><th>Load (kW)</th><th>PF</th><th>Floors like it</th><th>Current (A)</th><th>Tap-off</th><th>Height (m)</th><th>Vd at the tap-off</th><th /></tr></thead>
            <tbody>
              {riser.floors.map((f) => {
                const r = res?.floors.find((x) => x.floor.id === f.id);
                return (
                  <tr key={f.id}>
                    <td><input value={f.name} onChange={(e) => setFloor(f.id, { name: e.target.value })} /></td>
                    <td>
                      <select value={f.boardId ?? ''} onChange={(e) => setFloor(f.id, { boardId: e.target.value || undefined })}>
                        <option value="">— enter the load</option>
                        {boards.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
                      </select>
                    </td>
                    <td>{f.boardId ? <span title="The board's maximum demand">{r ? f1(r.kw) : '—'}</span> : <input inputMode="decimal" value={f.kw ?? ''} onChange={(e) => setFloor(f.id, { kw: num(e.target.value) })} />}</td>
                    <td>{f.boardId ? <span className="m">board</span> : <input inputMode="decimal" value={f.pf ?? ''} placeholder="0.9" onChange={(e) => setFloor(f.id, { pf: num(e.target.value) })} />}</td>
                    <td><input inputMode="numeric" value={f.count ?? 1} onChange={(e) => setFloor(f.id, { count: Math.max(1, Math.round(num(e.target.value) ?? 1)) })} title="Typical floors: the same tap-off repeated" /></td>
                    <td>{r ? f0(r.currentA) : '—'}</td>
                    <td>{r?.tapOffA ? `${r.tapOffA} A${(f.count ?? 1) > 1 ? ` × ${f.count}` : ''}` : '—'}</td>
                    <td>{r ? f1(r.heightM) : '—'}</td>
                    <td className={r && r.vdPct > project.vdLimitPct / 2 ? 'warn' : ''}>{r ? `${f2(r.vdPct)} %` : '—'}</td>
                    <td><button className="icon-btn" title="Remove" onClick={() => setRiser({ floors: riser.floors.filter((x) => x.id !== f.id) })}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="bb-row-actions">
            <button className="chip" onClick={addFloor}>+ Floor</button>
            <button className="chip" disabled={!riser.sourceBoardId} onClick={fromBoards} title="One tap-off per board fed from the source board">Take floors from the boards</button>
            {(project.building?.buildings ?? []).map((b) => (
              <button key={b.id} className="chip" title={`One tap-off per level of ${b.name} with rooms: its demand per floor, typical floors repeated, the typical floor height`} onClick={() => {
                const f = riserFromBuilding(project, b.id);
                if (!f) { onStatus?.(`${b.name} has no rooms with a load yet — add them in Building information`); return; }
                setRiser(f);
                onStatus?.(`${f.floors.length} tap-off rows from ${b.name}'s levels`);
              }}>Take floors from {b.name}</button>
            ))}
          </div>

          {res && (
            <div className="cards flush bb-results">
              <section className="card">
                <h4>Load</h4>
                <dl className="kv">
                  <dt>Tap-offs</dt><dd>{res.tapOffs}</dd>
                  <dt>Connected</dt><dd>{f0(res.connectedKw)} kW · PF {res.pf.toFixed(2)}{(res.sections[0]?.q ?? 0) < -1e-9 ? ' leading' : ''}</dd>
                  <dt>Diversity</dt><dd>{res.diversity}{riser.diversity === undefined ? ' (IEC 61439-6)' : ''}</dd>
                  <dt>Maximum demand</dt><dd>{f0(res.demandKw)} kW · {f0(res.demandKva)} kVA</dd>
                  <dt>Design current Ib</dt><dd><b>{f0(res.designA)} A</b></dd>
                </dl>
              </section>
              <section className="card">
                <h4>Busway</h4>
                <dl className="kv">
                  <dt>Feeding breaker In</dt><dd>{res.feederBreakerA} A</dd>
                  <dt>Needed (÷ {res.derate.toFixed(2)} at {res.ambientC} °C)</dt><dd>{f0(res.requiredA)} A</dd>
                  <dt>Selected</dt><dd><b className={res.type ? 'ok' : 'bad'}>{typeText(res)}</b></dd>
                  {res.type && <><dt>Conductor area</dt><dd>{f0(res.type.csaMm2)} mm² per phase · {f2(res.currentDensity!)} A/mm² at Ib</dd></>}
                  {res.type && <><dt>Short-circuit withstand</dt><dd className={res.icwOk === false ? 'bad' : res.icwOk ? 'ok' : ''}>Icw {res.type.icwKa} kA 1 s{res.faultKa !== undefined ? ` vs ${f1(res.faultKa)} kA at ${riser.sourceBoardId}` : ''}</dd></>}
                  <dt>Vd at the top tap-off</dt><dd className={res.vdTopPct > project.vdLimitPct / 2 ? 'warn' : 'ok'}>{f2(res.vdTopPct)} % <span className="m">(riser only)</span></dd>
                </dl>
              </section>
              <section className="card">
                <h4>Physical</h4>
                <dl className="kv">
                  {res.type && <><dt>Size (W × H)</dt><dd>{res.type.widthMm} × {res.type.heightMm} mm</dd></>}
                  <dt>Length</dt><dd>{f1(res.lengthM)} m <span className="m">({f1(riser.feedM)} feed + {f1(res.lengthM - riser.feedM)} vertical)</span></dd>
                  <dt>Straight lengths</dt><dd>{res.elements} × {riser.elementM} m</dd>
                  {res.weightKg !== undefined && <><dt>Weight</dt><dd>{f0(res.weightKg)} kg · {res.type!.kgPerM} kg/m <span className="m">(check the slab and the riser supports)</span></dd></>}
                  <dt>Parts</dt><dd>1 end-feed unit, 1 end cap, {riser.elbows} elbows, {res.tapOffs} tap-off units, fire barriers at each slab</dd>
                </dl>
              </section>
              {alt && (
                <section className="card">
                  <h4>{MATERIAL_LABEL[riser.material]} or {MATERIAL_LABEL[alt.riser.material].toLowerCase()}?</h4>
                  <table className="bb-compare">
                    <thead><tr><th /><th>{MATERIAL_LABEL[riser.material]}</th><th>{MATERIAL_LABEL[alt.riser.material]}</th></tr></thead>
                    <tbody>
                      <tr><td>Rating</td><td>{res.type ? `${res.type.ratingA} A` : '—'}</td><td>{alt.type ? `${alt.type.ratingA} A` : '—'}</td></tr>
                      <tr><td>Area / phase</td><td>{res.type ? `${f0(res.type.csaMm2)} mm²` : '—'}</td><td>{alt.type ? `${f0(alt.type.csaMm2)} mm²` : '—'}</td></tr>
                      <tr><td>W × H</td><td>{res.type ? `${res.type.widthMm} × ${res.type.heightMm}` : '—'}</td><td>{alt.type ? `${alt.type.widthMm} × ${alt.type.heightMm}` : '—'}</td></tr>
                      <tr><td>Weight</td><td>{res.weightKg !== undefined ? `${f0(res.weightKg)} kg` : '—'}</td><td>{alt.weightKg !== undefined ? `${f0(alt.weightKg)} kg` : '—'}</td></tr>
                      <tr><td>Vd top</td><td>{f2(res.vdTopPct)} %</td><td>{f2(alt.vdTopPct)} %</td></tr>
                    </tbody>
                  </table>
                  <button className="chip" onClick={() => setRiser({ material: alt.riser.material })}>Use {MATERIAL_LABEL[alt.riser.material].toLowerCase()}</button>
                </section>
              )}
            </div>
          )}
          {res && res.notes.length > 0 && <ul className="bb-notes">{res.notes.map((n) => <li key={n} className={/above|Above/.test(n) ? 'warn' : 'm'}>{n}</li>)}</ul>}
        </>
      )}

      <details className="card bb-data">
        <summary><b>Busway data</b> <span className="m">— {project.busbarData ? 'your data' : 'typical values; replace them with the manufacturer’s catalogue (e.g. RR busbar) when you have it'}</span></summary>
        <div className="bb-row-actions">
          <span className="seg">
            {(['cu', 'al'] as const).map((m) => <button key={m} className={dataMat === m ? 'on' : ''} onClick={() => setDataMat(m)}>{MATERIAL_LABEL[m]}</button>)}
          </span>
          <button className="chip" onClick={() => setData(dataMat, [...data[dataMat], { ...data[dataMat][data[dataMat].length - 1] ?? TYPICAL_BUSBAR_DATA[dataMat][0], ratingA: (data[dataMat][data[dataMat].length - 1]?.ratingA ?? 0) + 1 }])}>+ Rating</button>
          {project.busbarData && <button className="chip" onClick={() => { if (window.confirm('Go back to the typical busway data?')) onChange({ ...project, busbarData: undefined }); }}>Back to typical</button>}
        </div>
        <table className="bb-datatable">
          <thead><tr>{DATA_COLS.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {data[dataMat].map((t, i) => (
              <tr key={`${t.ratingA}-${i}`}>
                {DATA_COLS.map((c) => (
                  <td key={c.key}><input inputMode="decimal" defaultValue={t[c.key]} onBlur={(e) => {
                    const v = num(e.target.value);
                    if (v === undefined || v === t[c.key]) return;
                    setData(dataMat, data[dataMat].map((x, k) => (k === i ? { ...x, [c.key]: v } : x)));
                  }} /></td>
                ))}
                <td><button className="icon-btn" title="Remove" onClick={() => setData(dataMat, data[dataMat].filter((_, k) => k !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m">R and X per phase at operating temperature; Icw is the 1 s short-time withstand. The data are saved with the project.</p>
      </details>
    </Page>
  );
}
