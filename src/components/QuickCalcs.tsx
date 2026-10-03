import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import {
  awgLabel, awgToMm2, cableFor, cableSizes, currentFromPower, energy, faultAtCableEnd, faultFromTransformer, HP_KW, kcmilToMm2, mm2ToAwg,
  motor, nextBreaker, ohm, pfCorrection, powerFromCurrent, transformer, triangle, voltageDrop, type Phases, type PowerUnit
} from '../calc/quick';
import { STARTERS } from '../calc/motor';
import type { Project, StarterType } from '../types';
import { Page } from './ui';
import { quickInputErrors, quickNumber as num, type QuickErrors } from './quickInputs';

/** Quick calculators: everyday engineering sums, separate from the project.
 * Inputs are remembered on this computer between visits. */

type Vals = Record<string, string>;

/** Card inputs kept as typed text (so "0." can be typed), remembered per card. */
function useInputs(card: string, initial: Vals): [Vals, (k: string, v: string) => void, () => void] {
  const key = `lvds.quick.${card}`;
  const [vals, setVals] = useState<Vals>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Vals | null;
      return saved && typeof saved === 'object'
        ? { ...initial, ...Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string')) }
        : initial;
    } catch {
      return initial;
    }
  });
  const save = (next: Vals) => { try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* not kept */ } };
  return [
    vals,
    (k, v) => setVals((p) => { const next = { ...p, [k]: v }; save(next); return next; }),
    () => { setVals(initial); try { localStorage.removeItem(key); } catch { /* ignore */ } }
  ];
}

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');
const InputErrors = createContext<QuickErrors>({});

function Field({ label, v, k, set, unit, width = 90 }: { label: string; v: Vals; k: string; set: (k: string, v: string) => void; unit?: string; width?: number }) {
  const error = useContext(InputErrors)[k];
  const errorId = useId();
  return (
    <label className="qc-field">
      <span>{label}</span>
      <span className="qc-in">
        <input inputMode="decimal" style={{ width }} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
        {unit && <em>{unit}</em>}
      </span>
      {error && <span id={errorId} className="qc-field-error">{error}</span>}
    </label>
  );
}

function Pick<T extends string>({ label, value, options, onChange, field }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; field?: string }) {
  const errors = useContext(InputErrors);
  const error = field ? errors[field] : undefined;
  const errorId = useId();
  return (
    <label className="qc-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
        {!options.some(([option]) => option === value) && <option value={value} disabled>Choose {label.toLowerCase()}…</option>}
        {options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
      </select>
      {error && <span id={errorId} className="qc-field-error">{error}</span>}
    </label>
  );
}

function Card({ title, children, result, formula, onReset, errors }: { title: string; children: ReactNode; result: ReactNode; formula?: string; onReset: () => void; errors: QuickErrors }) {
  return (
    <section className="qc-card">
      <header><h4>{title}</h4><button className="icon-btn" title="Reset to the defaults" aria-label={`Reset ${title} to the defaults`} onClick={onReset}>↺</button></header>
      <InputErrors.Provider value={errors}><div className="qc-inputs">{children}</div></InputErrors.Provider>
      <div className="qc-result">{Object.keys(errors).length ? <Warn>Correct the highlighted inputs to calculate.</Warn> : result}</div>
      {formula && <p className="qc-formula">{formula}</p>}
    </section>
  );
}

const Out = ({ label, value, unit, main }: { label: string; value: string; unit?: string; main?: boolean }) => (
  <div className={`qc-out${main ? ' main' : ''}`}><span>{label}</span><b>{value}{unit && value !== '—' ? <small> {unit}</small> : null}</b></div>
);
const Warn = ({ children }: { children: ReactNode }) => <p className="qc-warn">{children}</p>;
function BreakerOutput({ currentA, label }: { currentA: number; label: string }) {
  const rating = nextBreaker(currentA);
  return <>
    <Out label={label} value={rating === undefined ? 'No available rating' : String(rating)} unit={rating === undefined ? undefined : 'A'} />
    {rating === undefined && <Warn>No available breaker rating meets this current. Review the breaker catalogue.</Warn>}
  </>;
}

const PHASES: [string, string][] = [['3', '3-phase'], ['1', '1-phase']];
const phaseV = (p: string, project: Project) => (p === '3' ? String(project.voltageV) : String(Math.round(project.voltageV / Math.sqrt(3))));

export default function QuickCalcs({ project }: { project: Project }) {
  const V3 = String(project.voltageV);
  const amb = String(project.ambientC);
  const sizes = cableSizes();

  // 1 · Current from power
  const [a, setA, resetA] = useInputs('amps', { p: '100', unit: 'kW', ph: '3', v: V3, pf: '0.85', eff: '1' });
  const aErrors = quickInputErrors('amps', a);
  const aI = Object.keys(aErrors).length ? NaN : currentFromPower(num(a.p)!, a.unit as PowerUnit, +a.ph as Phases, num(a.v)!, num(a.pf)!, num(a.eff)!);

  // 2 · Power from current
  const [b, setB, resetB] = useInputs('power', { i: '100', ph: '3', v: V3, pf: '0.85' });
  const bErrors = quickInputErrors('power', b);
  const bP = Object.keys(bErrors).length ? undefined : powerFromCurrent(num(b.i)!, +b.ph as Phases, num(b.v)!, num(b.pf)!);

  // 3 · Power triangle
  const [c, setC, resetC] = useInputs('triangle', { known: 'kw-pf', x: '80', y: '0.8' });
  const cKnown: Record<string, [string, string, (x: number, y: number) => ReturnType<typeof triangle>]> = {
    'kw-pf': ['kW', 'PF', (x, y) => triangle({ kw: x, pf: y })],
    'kva-pf': ['kVA', 'PF', (x, y) => triangle({ kva: x, pf: y })],
    'kw-kva': ['kW', 'kVA', (x, y) => triangle({ kw: x, kva: y })],
    'kw-kvar': ['kW', 'kVAr', (x, y) => triangle({ kw: x, kvar: y })],
    'kva-kvar': ['kVA', 'kVAr', (x, y) => triangle({ kva: x, kvar: y })]
  };
  const [cx, cy, cfn] = cKnown[c.known] ?? cKnown['kw-pf'];
  const cErrors = quickInputErrors('triangle', c);
  const cT = Object.keys(cErrors).length ? undefined : cfn(num(c.x)!, num(c.y)!);

  // 4 · Cable & breaker
  const [d, setD, resetD] = useInputs('cable', { i: '160', ph: '3', v: V3, pf: '0.85', l: '50', amb, g: '1', vd: String(project.vdLimitPct) });
  const dErrors = quickInputErrors('cable', d);
  const dRes = Object.keys(dErrors).length ? undefined
    : cableFor(num(d.i)!, { lengthM: num(d.l)!, phases: +d.ph as Phases, voltageV: num(d.v)!, pf: num(d.pf)!, ambientC: num(d.amb)!, groupFactor: num(d.g)!, vdLimitPct: num(d.vd)! });

  // 5 · Voltage drop
  const [e, setE, resetE] = useInputs('vd', { i: '100', l: '100', csa: '35', runs: '1', ph: '3', v: V3, pf: '0.85', lim: String(project.vdLimitPct) });
  const eErrors = quickInputErrors('vd', e, sizes);
  const eVd = Object.keys(eErrors).length ? undefined : voltageDrop(num(e.i)!, num(e.l)!, +e.csa, +e.ph as Phases, num(e.v)!, num(e.pf)!, num(e.runs)!);
  const eLim = num(e.lim)!;

  // 6 · Transformer
  const [t, setT, resetT] = useInputs('tx', { kva: '1000', v: V3, z: '5' });
  const tErrors = quickInputErrors('tx', t);
  const tRes = Object.keys(tErrors).length ? undefined : transformer(num(t.kva)!, num(t.v)!, num(t.z)!);

  // 7 · Motor
  const [m, setM, resetM] = useInputs('motor', { p: '11', unit: 'kW', ph: '3', v: V3, pf: '0.85', eff: '0.9', st: 'DOL' });
  const mKw = m.unit === 'HP' ? (num(m.p) ?? NaN) * HP_KW : num(m.p) ?? NaN;
  const mErrors = quickInputErrors('motor', m);
  const mRes = Object.keys(mErrors).length ? undefined : motor(mKw, num(m.v)!, +m.ph as Phases, num(m.pf)!, num(m.eff)!, m.st as StarterType);

  // 8 · PF correction
  const [p, setP, resetP] = useInputs('pfc', { kw: '500', now: '0.8', target: '0.95' });
  const pErrors = quickInputErrors('pfc', p);
  const pRes = Object.keys(pErrors).length ? undefined : pfCorrection(num(p.kw)!, num(p.now)!, num(p.target)!);

  // 9 · Fault at cable end
  const [f, setF, resetF] = useInputs('fault', { src: 'tx', kva: '1000', z: '5', ka: '25', v: V3, csa: '95', runs: '1', l: '50' });
  const fErrors = quickInputErrors('fault', f, sizes);
  const fRes = Object.keys(fErrors).length ? undefined
    : f.src === 'tx'
      ? faultFromTransformer(num(f.kva)!, num(f.z)!, num(f.v)!, +f.csa, num(f.l)!, num(f.runs)!)
      : { startKA: num(f.ka)!, ...faultAtCableEnd(num(f.ka)!, num(f.v)!, +f.csa, num(f.l)!, num(f.runs)!) };

  // 10 · Ohm's law
  const [o, setO, resetO] = useInputs('ohm', { known: 'v-i', x: '230', y: '10' });
  const oKnown: Record<string, [string, string, string, string, 'v' | 'i' | 'r' | 'p', 'v' | 'i' | 'r' | 'p']> = {
    'v-i': ['Voltage', 'V', 'Current', 'A', 'v', 'i'],
    'v-r': ['Voltage', 'V', 'Resistance', 'Ω', 'v', 'r'],
    'v-p': ['Voltage', 'V', 'Power', 'W', 'v', 'p'],
    'i-r': ['Current', 'A', 'Resistance', 'Ω', 'i', 'r'],
    'i-p': ['Current', 'A', 'Power', 'W', 'i', 'p'],
    'r-p': ['Resistance', 'Ω', 'Power', 'W', 'r', 'p']
  };
  const ok2 = oKnown[o.known] ?? oKnown['v-i'];
  const oErrors = quickInputErrors('ohm', o);
  const oRes = Object.keys(oErrors).length ? undefined : ohm({ [ok2[4]]: num(o.x)!, [ok2[5]]: num(o.y)! });

  // 11 · Energy & cost
  const [n, setN, resetN] = useInputs('energy', { kw: '5', h: '10', days: '30', rate: '0.30', cur: 'AED' });
  const nErrors = quickInputErrors('energy', n);
  const nRes = Object.keys(nErrors).length ? undefined : energy(num(n.kw)!, num(n.h)!, num(n.days)!, num(n.rate)!);

  // 12 · Conversions
  const [u, setU, resetU] = useInputs('units', { hp: '10', kw: '7.5', awg: '10', mm2: '16', kcmil: '250' });
  const uErrors = quickInputErrors('units', u);

  return (
    <Page
      title="Quick calculators"
      intro="Everyday electrical calculations, separate from the project — nothing here changes your design. Same formulas and cable data as the studies; voltage, ambient and voltage-drop limit start from the project settings. Inputs are remembered on this computer (↺ resets a card)."
    >
      <div className="qc-grid">
        <Card title="Current from power" errors={aErrors} onReset={resetA} formula={a.ph === '3' ? 'I = P ÷ (√3 · V · PF · η)   (kVA: I = S ÷ √3·V)' : 'I = P ÷ (V · PF · η)   (kVA: I = S ÷ V)'}
          result={Number.isFinite(aI) ? <><Out main label="Current" value={fmt(aI, 1)} unit="A" /><BreakerOutput currentA={aI} label="Breaker (next standard)" /></> : <Warn>These values do not produce a finite current. Check the power, voltage and factors.</Warn>}>
          <Field label="Power" v={a} k="p" set={setA} />
          <Pick field="unit" label="Unit" value={a.unit} options={[['kW', 'kW'], ['kVA', 'kVA'], ['HP', 'HP'], ['W', 'W']]} onChange={(x) => setA('unit', x)} />
          <Pick field="ph" label="Supply" value={a.ph} options={PHASES} onChange={(x) => { setA('ph', x); setA('v', phaseV(x, project)); }} />
          <Field label={a.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={a} k="v" set={setA} unit="V" />
          {a.unit !== 'kVA' && <Field label="Power factor" v={a} k="pf" set={setA} width={60} />}
          {a.unit !== 'kVA' && <Field label="Efficiency η" v={a} k="eff" set={setA} width={60} />}
        </Card>

        <Card title="Power from current" errors={bErrors} onReset={resetB} formula={b.ph === '3' ? 'S = √3 · V · I;  P = S · PF;  Q = √(S² − P²)' : 'S = V · I;  P = S · PF;  Q = √(S² − P²)'}
          result={bP?.invalid ? <Warn>{bP.invalid}.</Warn>
            : bP ? <><Out main label="Apparent" value={fmt(bP.kva)} unit="kVA" /><Out label="Active" value={fmt(bP.kw)} unit="kW" /><Out label="Reactive" value={fmt(bP.kvar)} unit="kVAr" /></> : null}>
          <Field label="Current" v={b} k="i" set={setB} unit="A" />
          <Pick field="ph" label="Supply" value={b.ph} options={PHASES} onChange={(x) => { setB('ph', x); setB('v', phaseV(x, project)); }} />
          <Field label={b.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={b} k="v" set={setB} unit="V" />
          <Field label="Power factor" v={b} k="pf" set={setB} width={60} />
        </Card>

        <Card title="kW ↔ kVA ↔ kVAr" errors={cErrors} onReset={resetC} formula="kVA² = kW² + kVAr²;  PF = kW ÷ kVA"
          result={cT && !cT.invalid
            ? <><Out main label="kW" value={fmt(cT.kw)} /><Out main label="kVA" value={fmt(cT.kva)} /><Out label="kVAr" value={fmt(cT.kvar)} /><Out label="Power factor" value={fmt(cT.pf, 3)} /></>
            : <Warn>{cT?.invalid ? `${cT.invalid}. ` : ''}Enter two values that fit together (kW ≤ kVA, kVAr ≤ kVA, PF 0–1).</Warn>}>
          <Pick field="known" label="You know" value={c.known} options={[['kw-pf', 'kW and PF'], ['kva-pf', 'kVA and PF'], ['kw-kva', 'kW and kVA'], ['kw-kvar', 'kW and kVAr'], ['kva-kvar', 'kVA and kVAr']]} onChange={(x) => setC('known', x)} />
          <Field label={cx} v={c} k="x" set={setC} />
          <Field label={cy} v={c} k="y" set={setC} width={70} />
        </Card>

        <Card title="Cable & breaker size" errors={dErrors} onReset={resetD} formula="In ≥ Ib (next standard); Iz = Iz(table) × ambient × grouping × runs ≥ In; voltage drop ≤ limit. 4-core (3-phase) / 2-core (1-phase) Cu XLPE/SWA, in air."
          result={dRes ? (dRes.sel
            ? <><Out main label="Cable" value={`${dRes.sel.runs > 1 ? `${dRes.sel.runs} × ` : ''}${d.ph === '3' ? 4 : 2}C × ${dRes.sel.csaMm2}`} unit="mm²" /><Out main label="Breaker" value={String(dRes.breakerA)} unit="A" /><Out label="Iz (derated)" value={fmt(dRes.iz, 0)} unit="A" /><Out label="Voltage drop" value={fmt(dRes.vd!.pct)} unit="%" /></>
            : <Warn>{dRes.message}</Warn>) : null}>
          <Field label="Design current Ib" v={d} k="i" set={setD} unit="A" />
          <Pick field="ph" label="Supply" value={d.ph} options={PHASES} onChange={(x) => { setD('ph', x); setD('v', phaseV(x, project)); }} />
          <Field label={d.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={d} k="v" set={setD} unit="V" />
          <Field label="Length" v={d} k="l" set={setD} unit="m" />
          <Field label="Power factor" v={d} k="pf" set={setD} width={60} />
          <Field label="Ambient" v={d} k="amb" set={setD} unit="°C" width={60} />
          <Field label="Grouping factor" v={d} k="g" set={setD} width={60} />
          <Field label="Vd limit" v={d} k="vd" set={setD} unit="%" width={60} />
        </Card>

        <Card title="Voltage drop" errors={eErrors} onReset={resetE} formula={`ΔV = ${e.ph === '3' ? '√3' : '2'} · I · L · (R cosφ + X sinφ) ÷ runs;  R at 90 °C (1.2 × R20)`}
          result={eVd?.invalid ? <Warn>{eVd.invalid}</Warn> : eVd
            ? <><Out main label="Voltage drop" value={fmt(eVd.pct)} unit="%" /><Out label="Volts" value={fmt(eVd.volts)} unit="V" /><Out label="mV/A/m" value={fmt(eVd.mvPerAm / Math.max(1, num(e.runs) ?? 1), 3)} />
              <p className={eVd.pct > eLim ? 'qc-bad' : 'qc-ok'}>{eVd.pct > eLim ? `Over the ${eLim} % limit` : `Within the ${eLim} % limit`}</p></>
            : <Warn>Enter the current, length and voltage.</Warn>}>
          <Field label="Current" v={e} k="i" set={setE} unit="A" />
          <Field label="Length" v={e} k="l" set={setE} unit="m" />
          <Pick field="csa" label="Cable size (mm²)" value={e.csa} options={sizes.map((s) => [String(s), `${s} mm²`])} onChange={(x) => setE('csa', x)} />
          <Field label="Runs in parallel" v={e} k="runs" set={setE} width={50} />
          <Pick field="ph" label="Supply" value={e.ph} options={PHASES} onChange={(x) => { setE('ph', x); setE('v', phaseV(x, project)); }} />
          <Field label={e.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={e} k="v" set={setE} unit="V" />
          <Field label="Power factor" v={e} k="pf" set={setE} width={60} />
          <Field label="Limit" v={e} k="lim" set={setE} unit="%" width={60} />
        </Card>

        <Card title="Transformer" errors={tErrors} onReset={resetT} formula="FLC = S ÷ (√3 · V);  Isc = FLC ÷ Z%  (infinite MV source)"
          result={tRes?.invalid ? <Warn>{tRes.invalid}</Warn> : tRes ? <><Out main label="Full-load current" value={fmt(tRes.flc, 0)} unit="A" /><Out main label="Fault at LV terminals" value={fmt(tRes.faultKA, 1)} unit="kA" /><BreakerOutput currentA={tRes.flc} label="Main breaker (next standard)" /></> : null}>
          <Field label="Rating" v={t} k="kva" set={setT} unit="kVA" />
          <Field label="LV voltage (L-L)" v={t} k="v" set={setT} unit="V" />
          <Field label="Impedance Z" v={t} k="z" set={setT} unit="%" width={60} />
        </Card>

        <Card title="Motor" errors={mErrors} onReset={resetM} formula="FLC = P ÷ (√3 · V · PF · η);  starting current = FLC × starter multiple"
          result={mRes?.invalid ? <Warn>{mRes.invalid}</Warn> : mRes ? <><Out main label="Full-load current" value={fmt(mRes.flc, 1)} unit="A" /><Out main label="Starting current" value={fmt(mRes.startA, 0)} unit="A" /><Out label="Input" value={`${fmt(mRes.inputKw, 1)} kW · ${fmt(mRes.inputKva, 1)} kVA`} /><Out label={m.unit === 'HP' ? 'Output' : 'Output (HP)'} value={m.unit === 'HP' ? `${fmt(mKw, 2)} kW` : `${fmt(mRes.hp, 1)} HP`} /></> : null}>
          <Field label="Output power" v={m} k="p" set={setM} />
          <Pick field="unit" label="Unit" value={m.unit} options={[['kW', 'kW'], ['HP', 'HP']]} onChange={(x) => setM('unit', x)} />
          <Pick field="ph" label="Supply" value={m.ph} options={PHASES} onChange={(x) => { setM('ph', x); setM('v', phaseV(x, project)); }} />
          <Field label={m.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={m} k="v" set={setM} unit="V" />
          <Field label="Power factor" v={m} k="pf" set={setM} width={60} />
          <Field label="Efficiency η" v={m} k="eff" set={setM} width={60} />
          <Pick field="st" label="Starter" value={m.st} options={STARTERS.map((s) => [s.value, `${s.label} (× ${s.multiple})`] as [string, string])} onChange={(x) => setM('st', x)} />
        </Card>

        <Card title="Power factor correction" errors={pErrors} onReset={resetP} formula="kVAr = P · (tan φ1 − tan φ2)"
          result={!pRes ? <Warn>Enter kW and both power factors.</Warn>
            : pRes.invalid ? <Warn>{pRes.invalid}.</Warn>
              : pRes.needed
                ? <><Out main label="Capacitor bank" value={fmt(pRes.kvar, 1)} unit="kVAr" /><Out label="kVA before → after" value={`${fmt(pRes.kvaBefore, 0)} → ${fmt(pRes.kvaAfter, 0)}`} unit="kVA" /><Out label="kVA reduced by" value={fmt(pRes.reductionPct, 1)} unit="%" /></>
                : <><Out main label="Capacitor bank" value="0" unit="kVAr" /><Out label="kVA (unchanged)" value={fmt(pRes.kvaBefore, 0)} unit="kVA" /><p className="qc-ok">PF {fmt(pRes.pfAchieved, 3)} already meets the {fmt(num(p.target)!, 3)} target — no capacitor needed.</p></>}>
          <Field label="Active power" v={p} k="kw" set={setP} unit="kW" />
          <Field label="Present PF" v={p} k="now" set={setP} width={60} />
          <Field label="Target PF" v={p} k="target" set={setP} width={60} />
        </Card>

        <Card title="Fault level at end of cable" errors={fErrors} onReset={resetF} formula="Zsource from the fault at the start (X/R 5) or the transformer; Iend = V ÷ (√3 · |Zsource + Zcable|)"
          result={fRes?.invalid ? <Warn>{fRes.invalid}</Warn> : fRes ? <><Out label="At the start" value={fmt(fRes.startKA, 1)} unit="kA" /><Out main label="At the cable end" value={fmt(fRes.endKA, 1)} unit="kA" /></> : null}>
          <Pick field="src" label="Source" value={f.src} options={[['tx', 'Transformer'], ['ka', 'Known fault level']]} onChange={(x) => setF('src', x)} />
          {f.src === 'tx' ? <><Field label="Transformer" v={f} k="kva" set={setF} unit="kVA" /><Field label="Impedance" v={f} k="z" set={setF} unit="%" width={60} /></> : <Field label="Fault at start" v={f} k="ka" set={setF} unit="kA" />}
          <Field label="Voltage (L-L)" v={f} k="v" set={setF} unit="V" />
          <Pick field="csa" label="Cable size (mm²)" value={f.csa} options={sizes.map((s) => [String(s), `${s} mm²`])} onChange={(x) => setF('csa', x)} />
          <Field label="Runs in parallel" v={f} k="runs" set={setF} width={50} />
          <Field label="Length" v={f} k="l" set={setF} unit="m" />
        </Card>

        <Card title="Ohm's law & power" errors={oErrors} onReset={resetO} formula="V = I · R;  P = V · I = I² · R = V² ÷ R  (DC / resistive)"
          result={oRes?.invalid ? <Warn>{oRes.invalid}</Warn> : oRes ? <><Out label="Voltage" value={fmt(oRes.v, 3)} unit="V" /><Out label="Current" value={fmt(oRes.i, 3)} unit="A" /><Out label="Resistance" value={fmt(oRes.r, 3)} unit="Ω" /><Out label="Power" value={fmt(oRes.p, 3)} unit="W" /></> : null}>
          <Pick field="known" label="You know" value={o.known} options={Object.entries(oKnown).map(([k, x]) => [k, `${x[0]} and ${x[2]}`] as [string, string])} onChange={(x) => setO('known', x)} />
          <Field label={ok2[0]} v={o} k="x" set={setO} unit={ok2[1]} />
          <Field label={ok2[2]} v={o} k="y" set={setO} unit={ok2[3]} />
        </Card>

        <Card title="Energy & cost" errors={nErrors} onReset={resetN} formula="kWh = kW × hours/day × days;  cost = kWh × tariff (use your tariff incl. fuel surcharge)"
          result={nRes?.invalid ? <Warn>{nRes.invalid}</Warn> : nRes ? <><Out main label="Energy" value={fmt(nRes.kwh, 0)} unit="kWh" /><Out main label="Cost" value={fmt(nRes.cost, 2)} unit={n.cur} /></> : null}>
          <Field label="Load" v={n} k="kw" set={setN} unit="kW" />
          <Field label="Hours per day" v={n} k="h" set={setN} unit="h" width={60} />
          <Field label="Days" v={n} k="days" set={setN} width={60} />
          <Field label="Tariff" v={n} k="rate" set={setN} unit={`${n.cur}/kWh`} width={60} />
          <label className="qc-field"><span>Currency</span><input style={{ width: 60 }} value={n.cur} onChange={(x) => setN('cur', x.target.value)} /></label>
        </Card>

        <Card title="Unit conversions" errors={uErrors} onReset={resetU}
          result={<>
            <Out label={`${u.hp || 0} HP`} value={fmt((num(u.hp) ?? NaN) * HP_KW, 2)} unit="kW" />
            <Out label={`${u.kw || 0} kW`} value={fmt((num(u.kw) ?? NaN) / HP_KW, 2)} unit="HP" />
            <Out label={Number.isFinite(num(u.awg) ?? NaN) ? awgLabel(num(u.awg)!) : 'AWG'} value={fmt(awgToMm2(num(u.awg) ?? NaN), 2)} unit="mm²" />
            <Out label={`${u.mm2 || 0} mm²`} value={!uErrors.mm2 ? `≈ ${awgLabel(mm2ToAwg(num(u.mm2)!))}` : '—'} />
            <Out label={`${u.kcmil || 0} kcmil`} value={fmt(kcmilToMm2(num(u.kcmil) ?? NaN), 1)} unit="mm²" />
          </>}
          formula="1 HP = 0.7457 kW; AWG per ASTM B258 (0 = 1/0, −1 = 2/0…); 1 kcmil = 0.5067 mm²">
          <Field label="HP" v={u} k="hp" set={setU} width={70} />
          <Field label="kW" v={u} k="kw" set={setU} width={70} />
          <Field label="AWG" v={u} k="awg" set={setU} width={60} />
          <Field label="mm²" v={u} k="mm2" set={setU} width={70} />
          <Field label="kcmil" v={u} k="kcmil" set={setU} width={70} />
        </Card>
      </div>
    </Page>
  );
}
