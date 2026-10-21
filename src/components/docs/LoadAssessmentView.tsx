import { X } from 'lucide-react';
import { ask } from '../ConfirmDialog';
import { useMemo, useState } from 'react';
import type { Project } from '../../types';
import { CheckedNum, Page, type NumRule } from '../ui';
import {
  assess, buildingFigures, COOL_SYSTEMS, DEFAULT_SPACES, DHW_SYSTEMS, laSpaces, laTypes, loadLaLibrary, newAssessment, rowArea, rowPct, rowsFromRooms,
  saveLaLibrary, setAreaMode, typeFromAssessment, type CategoryKey, type LaBuildingType, type LaCustomLoad, type LaFactors, type LaLibrary, type LaRow,
  type LaServices, type LaSupply, type LoadAssessment
} from '../../calc/loadAssessment';
import { buildDashboard } from '../../calc/dashboard';
import { createMdbFromAssessment, LA_MDB } from '../../calc/loadAssessmentMdb';

const f0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** A number cell that saves when you leave it (so typing isn't interrupted); text that
 * isn't a valid number gets a message under the cell and is not saved. */
function Num({ value, onSet, width = 70, step, title, rule }: { value?: number; onSet: (v: number) => void; width?: number; step?: number; title?: string; rule?: NumRule }) {
  const shown = value === undefined ? '' : step && step < 1 ? String(+value.toFixed(3)) : String(+value.toFixed(2));
  return <CheckedNum value={value} shown={shown} onSet={onSet} width={width} title={title} rule={rule} />;
}
function Text({ value, onSet, width = 170 }: { value: string; onSet: (v: string) => void; width?: number }) {
  return <input className="bi-text" style={{ width }} defaultValue={value} key={value}
    onBlur={(e) => e.target.value !== value && onSet(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Load assessment: building type → area schedule → services → maximum
 * demand and supply. Every value is editable; your own figures are kept as a
 * library on this computer and replace the placeholders. */
export default function LoadAssessmentView({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const [lib, setLibState] = useState<LaLibrary>(() => loadLaLibrary());
  const [editFactors, setEditFactors] = useState(false);
  const [target, setTarget] = useState('');
  const types = useMemo(() => laTypes(lib), [lib]);
  const spaces = useMemo(() => laSpaces(lib), [lib]);
  const a = project.loadAssessment;
  const r = useMemo(() => (a ? assess(a) : undefined), [a]);
  const designed = useMemo(() => { try { return buildDashboard(project); } catch { return undefined; } }, [project]);

  const setLib = (next: LaLibrary, msg: string) => { setLibState(next); onStatus(saveLaLibrary(next) ? msg : 'Could not store your library on this computer'); };
  const set = (next: LoadAssessment) => onChange({ ...project, loadAssessment: next });
  const patch = (p: Partial<LoadAssessment>) => a && set({ ...a, ...p });
  const setSvc = (p: Partial<LaServices>) => a && set({ ...a, services: { ...a.services, ...p } });
  const setFac = (p: Partial<LaFactors>) => a && set({ ...a, factors: { ...a.factors, ...p } });
  const setSup = (p: Partial<LaSupply>) => a && set({ ...a, supply: { ...a.supply, ...p } });
  const setRow = (i: number, p: Partial<LaRow>) => a && set({ ...a, rows: a.rows.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setCust = (i: number, p: Partial<LaCustomLoad>) => a && set({ ...a, custom: a.custom.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const pickType = async (t: LaBuildingType) => {
    if (a && a.typeId !== t.id && !(await ask(`Start again from “${t.label}”? The area schedule, services and diversities are replaced (GFA, custom loads and supply settings are kept).`))) return;
    const fig = buildingFigures(project);
    set(newAssessment(t, a ? { gfaM2: a.gfaM2, floors: a.floors, parkingM2: a.parkingM2, custom: a.custom, supply: a.supply, inReport: a.inReport } : { ...(fig.gfaM2 ? { gfaM2: fig.gfaM2 } : {}), ...(fig.floors ? { floors: fig.floors } : {}), parkingM2: fig.parkingM2 ?? (fig.gfaM2 ? 0 : 8000) }, lib));
  };
  const saveType = (asNew: boolean) => {
    if (!a) return;
    const id = asNew ? uid('my') : a.typeId;
    const label = asNew ? `My ${a.typeLabel.replace(/^My /, '').toLowerCase()}` : a.typeLabel;
    const t = typeFromAssessment(a, id, label);
    setLib({ ...lib, types: [...lib.types.filter((x) => x.id !== id), t] }, asNew ? `Saved “${label}” as your building type` : `Saved “${label}” — your figures now replace the placeholders for this type`);
    if (asNew) set({ ...a, typeId: id, typeLabel: label });
  };
  const deleteType = async () => {
    if (!a || !(await ask(`Remove “${a.typeLabel}” from your library? This project keeps its assessment.`))) return;
    setLib({ ...lib, types: lib.types.filter((x) => x.id !== a.typeId) }, `Removed “${a.typeLabel}” from your library`);
  };
  const mineType = a ? lib.types.find((t) => t.id === a.typeId) : undefined;
  const mains = project.boards.filter((b) => !b.upstreamId);
  const laMdbs = mains.filter((b) => b.generated === LA_MDB).map((b) => b.id);
  const picked = mains.some((b) => b.id === target && !laMdbs.includes(b.id)) ? target : '';
  const createMdb = async () => {
    if (!a) return;
    const to = picked || undefined;
    const on = to ? [to] : laMdbs;
    const earlier = project.feeders.filter((f) => on.includes(f.boardId) && f.fromRoom?.startsWith('la:')).length;
    if (earlier && !(await ask(`Replace the ${earlier} feeders made earlier from the load assessment on ${on.join(', ')}? Your own feeders on ${on.length > 1 ? 'them' : 'it'} are kept.`))) return;
    const res = createMdbFromAssessment(project, a, to);
    onChange(res.project);
    const made = res.createdIds.length ? `Created ${res.createdIds.join(', ')}` : '';
    const updated = res.boardIds.filter((id) => !res.createdIds.includes(id));
    const over = res.loading.filter((x) => x.pct > a.supply.maxLoadingPct);
    onStatus(`${[made, updated.length ? `Updated ${updated.join(', ')}` : ''].filter(Boolean).join('; ')}: ${res.added} feeders from the load assessment${res.boardIds.length > 1 ? `, demand balanced over ${res.boardIds.length} transformers` : ''}${res.replaced ? ` (replaced ${res.replaced})` : ''} — check the cable lengths`
      + (res.loading.length ? `. Transformer loading ${res.loading.map((x) => `${x.boardId} ${f0(x.pct)} %`).join(', ')}` : '')
      + (over.length ? ` — over the ${a.supply.maxLoadingPct} % limit: the boards add the feeders' demand without the assessment's coincidence factor` : '')
      + (res.unused.length ? `. ${res.unused.join(', ')} no longer needed by the assessment: its assessment feeders were removed — delete it if it is empty` : '')
      + (to && r?.tx && r.tx.duty > 1 ? `. The assessment needs ${r.tx.duty} duty transformers: pick “New MDBs” to spread the feeders over them` : ''));
  };

  if (!a || !r) {
    return (
      <Page title="Load assessment" intro="Maximum demand, transformers and generator from the building type, its area schedule and the services it needs — before any load schedule exists. Pick a building type to start; everything can be edited.">
        <section className="card">
          <h4>Building type</h4>
          <div className="la-types">{types.map((t) => <button key={t.id} className="la-type" onClick={() => pickType(t)}>{t.label}{t.mine && <i>my type</i>}</button>)}</div>
          <p className="m">{buildingFigures(project).gfaM2 ? 'GFA, floors and car park are taken from Building information.' : 'No building information yet — enter the GFA and floors after picking a type.'} The starting figures are placeholders until you save your own.</p>
        </section>
      </Page>
    );
  }

  const g = a.gfaM2;
  const pctBad = Math.abs(r.pctTotal - 100) > 0.5;
  const maxDemand = Math.max(1, ...r.categories.map((c) => c.demandKw));
  const svcKw = (k: string) => (r.services[k] ? <em>{f0(r.services[k])} kW</em> : null);
  const fac = (label: string, value: number, onSet: (v: number) => void, step = 0.1) => editFactors && <span className="la-fac">{label}<Num value={value} onSet={onSet} step={step} width={64} /></span>;
  const check = (k: keyof LaServices, label: string, hint: string, kwKey: string, factors: JSX.Element | false) => (
    <div className="la-card">
      <div className="la-card-t"><label><input type="checkbox" checked={!!a.services[k]} onChange={(e) => setSvc({ [k]: e.target.checked } as Partial<LaServices>)} /> {label}</label>{a.services[k] ? svcKw(kwKey) : null}</div>
      <div className="m">{hint}</div>{factors}
    </div>
  );
  const fromBuilding = () => {
    const fig = buildingFigures(project);
    if (!fig.gfaM2 && !fig.floors) { onStatus('No building information yet — enter levels with their gross area in Building'); return; }
    patch({ gfaM2: fig.gfaM2 ?? a.gfaM2, floors: fig.floors ?? a.floors, parkingM2: fig.parkingM2 ?? 0 });
    onStatus('GFA, floors and car park taken from Building information');
  };
  const rowsFromBuilding = async () => {
    const rows = rowsFromRooms(project, spaces);
    if (!rows.length) { onStatus('No rooms above ground in Building information'); return; }
    if (!(await ask(`Replace the area schedule with ${rows.length} spaces from the Building rooms (m²)?`))) return;
    set({ ...setAreaMode(a, 'm2'), rows });
    onStatus(`Area schedule from the Building rooms — check the densities of spaces not in your library`);
  };

  return (
    <Page
      title="Load assessment"
      intro="Area × W/m² per space gives lighting, small power and cooling; the cooling system turns cooling into electrical kW; services and your custom loads add their own. Each category has its own diversity. Fire and life-safety loads are on the generator only. Built-in figures are placeholders — save your own as your library."
      actions={<>
        <button className="chip" onClick={fromBuilding} title="GFA above ground, floors and car park area from Building information">GFA from Building</button>
        <button className="chip bad-btn" onClick={async () => (await ask('Clear this project’s load assessment?')) && onChange({ ...project, loadAssessment: undefined })}>Clear</button>
      </>}
    >
      <div className="la-grid">
        <div>
          <section className="card la-sec">
            <h4><span className="la-n">1</span>Building type <span className="m">sets the space mix, services and diversities</span></h4>
            <div className="la-types">
              {types.map((t) => <button key={t.id} className={`la-type${t.id === a.typeId ? ' on' : ''}`} onClick={() => pickType(t)}>{t.label}{t.mine && <i>my type</i>}</button>)}
              <button className="la-type add" onClick={() => saveType(true)} title="Saves the current set-up as a new building type in your library">+ Custom type<i>copies the current one</i></button>
            </div>
            <div className="la-box">
              <div className="bi-grid">
                <label>Type name<Text value={a.typeLabel} onSet={(v) => patch({ typeLabel: v })} width={190} /></label>
                <label title="Typical maximum demand per m² of GFA for this type">Typical VA/m² — low<Num value={a.vaBand[0]} onSet={(v) => patch({ vaBand: [v, a.vaBand[1]] })} rule={{ min: 0, unit: 'VA/m²' }} /></label>
                <label>Typical VA/m² — high<Num value={a.vaBand[1]} onSet={(v) => patch({ vaBand: [a.vaBand[0], v] })} rule={{ min: 0, unit: 'VA/m²' }} /></label>
                <label title="Share of the HVAC and special services kept on the standby generator">On generator (% of HVAC &amp; special)<Num value={a.essentialPct} onSet={(v) => patch({ essentialPct: v })} rule={{ min: 0, max: 100, unit: '%' }} /></label>
              </div>
              <div className="bi-actions" style={{ marginBottom: 0 }}>
                <button className="chip" onClick={() => saveType(false)} title="Keep this type's space mix, densities, services, diversities and VA/m² band in your library">Save as my type</button>
                {mineType && <button className="chip" onClick={deleteType}>Remove from my library</button>}
                <span className="m">{mineType ? 'Your figures' : 'Placeholder figures — save yours to replace them'}</span>
              </div>
            </div>
            <div className="bi-grid">
              <label>GFA above ground (m²)<Num value={a.gfaM2} onSet={(v) => patch({ gfaM2: v })} width={110} rule={{ min: 0, unit: 'm²' }} /></label>
              <label>Floors above ground<Num value={a.floors} onSet={(v) => patch({ floors: Math.max(1, Math.round(v)) })} width={80} /></label>
              <label>Basement car park (m²)<Num value={a.parkingM2} onSet={(v) => patch({ parkingM2: v })} width={110} /></label>
            </div>
          </section>

          <section className="card la-sec">
            <h4><span className="la-n">2</span>Area schedule <span className="m">every cell editable</span></h4>
            <div className="bi-actions" style={{ marginTop: 0 }}>
              <div className="seg">
                <button className={a.areaMode === 'pct' ? 'on' : ''} onClick={() => set(setAreaMode(a, 'pct'))}>% of GFA</button>
                <button className={a.areaMode === 'm2' ? 'on' : ''} onClick={() => set(setAreaMode(a, 'm2'))}>m²</button>
              </div>
              <button className="chip" onClick={rowsFromBuilding} title="m² per room type from Building → Rooms (above ground)">From Building rooms</button>
            </div>
            <table className="bi-table la-table">
              <thead><tr><th>Space</th><th>{a.areaMode === 'pct' ? '% GFA' : 'Area m²'}</th><th>Area m²</th><th>Lighting W/m²</th><th>Power W/m²</th><th title="Thermal">Cooling W/m²</th><th title="Counts for water heating and cooking">Dwelling</th><th /></tr></thead>
              <tbody>
                {a.rows.map((row, i) => (
                  <tr key={`${row.id}-${i}`}>
                    <td><Text value={row.label} onSet={(v) => setRow(i, { label: v })} /></td>
                    <td>{a.areaMode === 'pct' ? <Num value={row.pct ?? 0} onSet={(v) => setRow(i, { pct: v })} /> : <Num value={row.areaM2 ?? 0} onSet={(v) => setRow(i, { areaM2: v })} width={90} />}</td>
                    <td className="m">{f0(rowArea(a, row))}{a.areaMode === 'm2' && g ? ` · ${f1(rowPct(a, row))} %` : ''}</td>
                    <td><Num value={row.ltg} onSet={(v) => setRow(i, { ltg: v })} /></td>
                    <td><Num value={row.pwr} onSet={(v) => setRow(i, { pwr: v })} /></td>
                    <td><Num value={row.clg} onSet={(v) => setRow(i, { clg: v })} /></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!row.dwelling} onChange={(e) => setRow(i, { dwelling: e.target.checked || undefined })} /></td>
                    <td><button className="icon-btn" title="Remove" onClick={() => patch({ rows: a.rows.filter((_, j) => j !== i) })} aria-label="Remove"><X size={14} aria-hidden /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td><b>Total</b></td>
                <td className={pctBad ? 'warn' : ''}><b>{a.areaMode === 'pct' ? `${f1(r.pctTotal)} %` : f0(r.areaM2)}</b></td>
                <td className={pctBad ? 'warn' : ''}><b>{f0(r.areaM2)}</b>{pctBad ? ` — GFA is ${f0(g)}` : ''}</td>
                <td colSpan={5} />
              </tr></tfoot>
            </table>
            <div className="bi-actions">
              <select className="bi-sel" value="" onChange={(e) => { const s = spaces.find((x) => x.id === e.target.value); if (s) patch({ rows: [...a.rows, { ...s, ...(a.areaMode === 'pct' ? { pct: 0 } : { areaM2: 0 }) }] }); }}>
                <option value="">+ Space from library…</option>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button className="chip" onClick={() => patch({ rows: [...a.rows, { id: uid('sp'), label: 'Custom space', ltg: 8, pwr: 20, clg: 100, ...(a.areaMode === 'pct' ? { pct: 0 } : { areaM2: 0 }) }] })}>+ Custom space</button>
              <span className="sp" />
              <button className="chip" title="Keep these spaces' densities in your space library (added to or replacing the same names)" onClick={() => {
                const merged = [...spaces];
                for (const row of a.rows) {
                  const s = { id: row.id, label: row.label, ltg: row.ltg, pwr: row.pwr, clg: row.clg, dwelling: row.dwelling };
                  const i = merged.findIndex((x) => x.id === row.id || x.label === row.label);
                  if (i >= 0) merged[i] = s; else merged.push(s);
                }
                setLib({ ...lib, spaces: merged }, `Saved ${a.rows.length} space densities to your library`);
              }}>Save densities as my library</button>
              {lib.spaces?.length ? <button className="chip" onClick={() => setLib({ ...lib, spaces: undefined }, `Space library back to the ${DEFAULT_SPACES.length} placeholders`)}>Placeholder spaces</button> : null}
            </div>
          </section>

          <section className="card la-sec">
            <h4><span className="la-n">3</span>Service requirements
              <label className="la-tog"><input type="checkbox" checked={editFactors} onChange={(e) => setEditFactors(e.target.checked)} /> Edit factors</label>
              <span className="m">each choice changes the load</span></h4>
            <div className="la-svc">
              <div className="la-card">
                <div className="la-card-t">Cooling system{svcKw('cool')}</div>
                <select className="bi-sel" value={a.services.cool} onChange={(e) => setSvc({ cool: e.target.value as LaServices['cool'] })}>{COOL_SYSTEMS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                <div className="m">Cooling W/m² × kW electrical per kW thermal</div>
                {fac('kW-e / kW-th', a.factors.cool[a.services.cool], (v) => setFac({ cool: { ...a.factors.cool, [a.services.cool]: v } }), 0.01)}
              </div>
              <div className="la-card">
                <div className="la-card-t">Domestic hot water{svcKw('dhw')}</div>
                <select className="bi-sel" value={a.services.dhw} onChange={(e) => setSvc({ dhw: e.target.value as LaServices['dhw'] })}>{DHW_SYSTEMS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                <div className="m">W/m² of dwelling areas (point heaters: whole GFA)</div>
                {fac('W/m²', a.factors.dhw[a.services.dhw], (v) => setFac({ dhw: { ...a.factors.dhw, [a.services.dhw]: v } }))}
              </div>
              <div className="la-card">
                <div className="la-card-t">Cooking{svcKw('cook')}</div>
                <select className="bi-sel" value={a.services.cook} onChange={(e) => setSvc({ cook: e.target.value as LaServices['cook'] })}><option value="none">None / gas</option><option value="elec">Electric cooking</option></select>
                <div className="m">W/m² of dwelling areas</div>
                {fac('W/m²', a.factors.cook, (v) => setFac({ cook: v }))}
              </div>
              <div className="la-card">
                <div className="la-card-t">Lifts ({r.liftCount}){svcKw('lifts')}</div>
                <div className="la-inline">
                  <select className="bi-sel" value={a.services.lifts} onChange={(e) => setSvc({ lifts: e.target.value as LaServices['lifts'], liftCount: a.services.liftCount ?? r.liftCount })}><option value="none">None</option><option value="auto">Auto from floors</option><option value="custom">Set count</option></select>
                  {a.services.lifts === 'custom' && <Num value={a.services.liftCount ?? r.liftCount} onSet={(v) => setSvc({ liftCount: Math.max(0, Math.round(v)) })} width={60} title="Number of lifts" />}
                </div>
                <div className="m">Auto: 1 per {a.factors.floorsPerLift} floors per 6 000 m² floor plate</div>
                {fac('kW each ≤ 12 floors', a.factors.liftKw, (v) => setFac({ liftKw: v }))}{fac('kW each > 12 floors', a.factors.liftKwHigh, (v) => setFac({ liftKwHigh: v }))}{fac('floors / lift', a.factors.floorsPerLift, (v) => setFac({ floorsPerLift: v }), 1)}
              </div>
              <div className="la-card">
                <div className="la-card-t">EV charging{svcKw('ev')}</div>
                <div className="la-inline"><Num value={a.services.evPct} onSet={(v) => setSvc({ evPct: v })} width={60} /><span className="m">% of parking bays</span></div>
                {fac('kW / charger', a.factors.evKw, (v) => setFac({ evKw: v }))}{fac('m² / bay', a.factors.m2PerBay, (v) => setFac({ m2PerBay: v }), 1)}
              </div>
              <div className="la-card">
                <div className="la-card-t">IT / server room{svcKw('it')}</div>
                <div className="la-inline"><Num value={a.services.itKw} onSet={(v) => setSvc({ itKw: v })} width={60} /><span className="m">kW (UPS-backed)</span></div>
              </div>
              {check('fire', 'Fire & life-safety pumps / fans', 'Generator only — not in the normal MD', 'fire', editFactors && <>{fac('fire pump kW', a.factors.firePumpKw, (v) => setFac({ firePumpKw: v }))}{fac('jockey kW', a.factors.jockeyKw, (v) => setFac({ jockeyKw: v }))}{fac('stair fan kW (×2)', a.factors.stairFanKw, (v) => setFac({ stairFanKw: v }))}</>)}
              {check('pool', 'Swimming pool plant', 'Filtration, heating, lighting', 'pool', fac('kW', a.factors.poolKw, (v) => setFac({ poolKw: v })))}
              {check('kitchen', 'Commercial kitchen', 'Exhaust, cold rooms, dishwash', 'kitchen', fac('W/m² GFA', a.factors.kitchen, (v) => setFac({ kitchen: v })))}
              {check('laundry', 'Laundry', 'Washers, dryers, ironers', 'laundry', fac('W/m² GFA', a.factors.laundry, (v) => setFac({ laundry: v })))}
              {check('medical', 'Medical equipment', 'Imaging, sterilisation', 'medical', fac('W/m² GFA', a.factors.medical, (v) => setFac({ medical: v })))}
              {check('facade', 'Façade / feature lighting', 'Scales with height', 'facade', fac('kW / floor', a.factors.facadeKwPerFloor, (v) => setFac({ facadeKwPerFloor: v })))}
            </div>
            {editFactors && (
              <div className="la-box" style={{ marginTop: 8 }}>
                <div className="m" style={{ marginBottom: 6 }}>Plant always included</div>
                <div className="la-svc-f">
                  {fac('Booster pump kW (×2)', a.factors.boosterKw, (v) => setFac({ boosterKw: v }))}
                  {fac('Transfer pump kW (×2)', a.factors.transferKw, (v) => setFac({ transferKw: v }))}
                  {fac('Car park lighting W/m²', a.factors.carParkLtg, (v) => setFac({ carParkLtg: v }))}
                  {fac('Car park fans kW/m²', a.factors.carParkFanKwPerM2, (v) => setFac({ carParkFanKwPerM2: v }), 0.001)}
                </div>
                <div className="bi-actions" style={{ marginBottom: 0 }}>
                  <button className="chip" onClick={() => setLib({ ...lib, factors: a.factors }, 'Saved the service factors as your library — new assessments start with them')}>Save factors as my library</button>
                  {lib.factors && <button className="chip" onClick={() => setLib({ ...lib, factors: undefined }, 'Service factors back to the placeholders for new assessments')}>Placeholder factors</button>}
                </div>
              </div>
            )}
          </section>

          <section className="card la-sec">
            <h4><span className="la-n">+</span>Custom loads <span className="m">anything not covered above</span></h4>
            <table className="bi-table la-table">
              <thead><tr><th>Description</th><th>Qty</th><th>kW each</th><th>Diversity</th><th>On generator</th><th>Connected</th><th /></tr></thead>
              <tbody>
                {a.custom.map((c, i) => (
                  <tr key={c.id}>
                    <td><Text value={c.label} onSet={(v) => setCust(i, { label: v })} width={200} /></td>
                    <td><Num value={c.qty} onSet={(v) => setCust(i, { qty: v })} width={54} /></td>
                    <td><Num value={c.kw} onSet={(v) => setCust(i, { kw: v })} /></td>
                    <td><Num value={c.diversity} onSet={(v) => setCust(i, { diversity: v })} step={0.05} width={60} /></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={c.onGenerator} onChange={(e) => setCust(i, { onGenerator: e.target.checked })} /></td>
                    <td>{f1(c.qty * c.kw)} kW</td>
                    <td><button className="icon-btn" title="Remove" onClick={() => patch({ custom: a.custom.filter((_, j) => j !== i) })} aria-label="Remove"><X size={14} aria-hidden /></button></td>
                  </tr>
                ))}
                {!a.custom.length && <tr><td colSpan={7} className="m">No custom loads.</td></tr>}
              </tbody>
            </table>
            <div className="bi-actions"><button className="chip" onClick={() => patch({ custom: [...a.custom, { id: uid('c'), label: 'New load', qty: 1, kw: 1, diversity: 1, onGenerator: false }] })}>+ Load</button></div>
          </section>
        </div>

        <div>
          <section className="card la-sec la-sticky">
            <h4><span className="la-n">4</span>Maximum demand &amp; supply</h4>
            <div className="la-kpis">
              <div><b>{f0(r.connectedKw)}</b><span>Connected kW</span></div>
              <div><b>{f0(r.mdKva)}</b><span>Maximum demand kVA</span></div>
              <div><b>{f0(r.vaPerM2)}</b><span>VA/m² of GFA</span></div>
              <div><b>{r.tx ? `${r.tx.count} × ${f0(r.tx.kva)}` : '—'}</b><span>Transformers kVA (≤ {f0(a.supply.maxLoadingPct)} %, {a.supply.redundancy})</span></div>
              <div><b>{r.generatorKva ? `${r.generatorCount > 1 ? `${r.generatorCount} × ` : ''}${f0(r.generatorKva)}` : '—'}</b><span>Standby generator kVA</span></div>
              <div><b>{r.incomerA ? f0(r.incomerA) : '—'}</b><span>LV incomer A / transformer</span></div>
            </div>
            <table className="bi-table la-table">
              <thead><tr><th>Category</th><th>Connected kW</th><th title="Edit to change">Diversity ✎</th><th>Demand kW</th><th style={{ width: '26%' }} /></tr></thead>
              <tbody>
                {r.categories.map((c) => (
                  <tr key={c.key}>
                    <td>{c.key.startsWith('custom:') ? `+ ${c.label}` : c.label}</td>
                    <td>{f0(c.connectedKw)}</td>
                    <td>{c.editable ? <Num value={c.diversity} step={0.05} width={60} onSet={(v) => patch({ diversity: { ...a.diversity, [c.key as CategoryKey]: v } })} /> : c.diversity ? c.diversity.toFixed(2) : '—'}</td>
                    <td>{c.diversity ? f0(c.demandKw) : '—'}</td>
                    <td><div className="la-bar"><i style={{ width: `${(c.demandKw / maxDemand) * 100}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td><b>Sum of demands</b></td><td><b>{f0(r.connectedKw)}</b></td><td /><td><b>{f0(r.sumDemandKw)}</b></td><td /></tr>
                <tr><td colSpan={3}>× coincidence {a.supply.coincidence}{a.supply.sparePct ? ` × spare ${1 + a.supply.sparePct / 100}` : ''} → MD</td><td><b>{f0(r.mdKw)} kW</b></td><td /></tr>
              </tfoot>
            </table>
            <div className={`la-flag ${r.inBand ? 'ok' : 'warn'}`}>
              {f0(r.vaPerM2)} VA/m² is {r.inBand ? 'inside' : 'outside'} the typical {f0(a.vaBand[0])}–{f0(a.vaBand[1])} VA/m² for “{a.typeLabel}”{r.inBand ? '.' : ' — check the area mix and services.'}
            </div>
            {designed && designed.demandKva > 0 && (
              <div className="la-flag">
                Designed so far (load schedules): <b>{f0(designed.demandKva)} kVA</b> demand, {f0(designed.connectedKw)} kW connected{designed.transformerKva ? `, ${f0(designed.transformerKva)} kVA of transformers` : ''} —
                {' '}{f0((designed.demandKva / r.mdKva) * 100)} % of this assessment.
              </div>
            )}

            <div className="bi-actions">
              <select className="bi-sel" value={picked} onChange={(e) => setTarget(e.target.value)} title="Board the feeders go on">
                <option value="">{laMdbs.length ? `Assessment MDBs (${laMdbs.join(', ')})` : r.tx && r.tx.duty > 1 ? `New MDBs (${r.tx.duty} × ${f0(r.tx.kva)} kVA transformers)` : `New MDB${r.tx ? ` (${f0(r.tx.kva)} kVA transformer)` : ''}`}</option>
                {mains.filter((b) => !laMdbs.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
              </select>
              <button className="chip primary" onClick={createMdb} title="One feeder per load category and custom load: connected kW and diversity as load and demand factor; generator-backed loads marked essential. One MDB per duty transformer, demand balanced over them">
                {picked ? `Add feeders to ${picked}` : laMdbs.length ? 'Update MDB feeders' : r.tx && r.tx.duty > 1 ? `Create ${r.tx.duty} MDBs + feeders` : 'Create MDB + feeders'}
              </button>
              <span className="sp" />
              {a.inReport
                ? <><span className="m">In the Design Basis report ✓</span><button className="chip" onClick={() => patch({ inReport: undefined })}>Remove</button></>
                : <button className="chip" onClick={() => { patch({ inReport: true }); onStatus('The load assessment is now a section of the Design Basis report (Reports → Study reports)'); }}>Add to Design Basis report</button>}
            </div>

            <h4 style={{ marginTop: 14 }}>Supply settings</h4>
            <div className="la-box">
              <div className="bi-grid">
                <label title="Not every category peaks at the same time">Coincidence<Num value={a.supply.coincidence} onSet={(v) => setSup({ coincidence: v })} step={0.05} /></label>
                <label>Power factor<Num value={a.supply.pf} onSet={(v) => setSup({ pf: v })} step={0.01} /></label>
                <label>LV voltage (V)<Num value={a.supply.voltage} onSet={(v) => setSup({ voltage: v })} /></label>
                <label>Future spare %<Num value={a.supply.sparePct} onSet={(v) => setSup({ sparePct: v })} /></label>
              </div>
              <div className="bi-grid" style={{ marginTop: 8 }}>
                <label>Max transformer loading %<Num value={a.supply.maxLoadingPct} onSet={(v) => setSup({ maxLoadingPct: v })} /></label>
                <label>Largest transformer kVA
                  <select className="bi-sel" value={a.supply.maxTxKva} onChange={(e) => setSup({ maxTxKva: +e.target.value })}>
                    {[...new Set([...r.txSizes, a.supply.maxTxKva])].sort((x, y) => x - y).map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </label>
                <label>Redundancy
                  <select className="bi-sel" value={a.supply.redundancy} onChange={(e) => setSup({ redundancy: e.target.value as LaSupply['redundancy'] })}><option value="N">N</option><option value="N+1">N+1</option></select>
                </label>
                <label title="Generator kVA = essential demand ÷ pf × margin">Generator margin<Num value={a.supply.genMargin} onSet={(v) => setSup({ genMargin: v })} step={0.05} /></label>
              </div>
              <div className="bi-grid" style={{ marginTop: 8 }}>
                <label style={{ flex: 1 }}>Transformer sizes kVA <span className="m">(blank: your Transformers catalogue, else standard sizes)</span>
                  <input className="bi-text" defaultValue={a.supply.txSizes?.join(', ') ?? ''} key={a.supply.txSizes?.join(',') ?? ''} placeholder={r.txSizes.join(', ')}
                    onBlur={(e) => { const s = e.target.value.split(/[\s,;]+/).map(Number).filter((x) => x > 0); setSup({ txSizes: s.length ? s : undefined }); }} />
                </label>
              </div>
              <div className="bi-actions" style={{ marginBottom: 0 }}>
                <button className="chip" onClick={() => setLib({ ...lib, supply: a.supply, diversity: a.diversity }, 'Saved the supply settings and diversities as your library — new assessments start with them')}>Save supply &amp; diversity as my library</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
