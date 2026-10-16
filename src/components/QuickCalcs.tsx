import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { ambientCorrectionFactor, getCable } from '../calc/cableTable';
import {
  awgLabel, awgToMm2, cableCandidates, cableFor, cableSizes, currentFromPower, energy, faultAtCableEnd, faultFromTransformer, HP_KW, kcmilToMm2, mm2ToAwg,
  motor, nextBreaker, ohm, pfCorrection, powerFromCurrent, transformer, triangle, pfcBank, TX_RATINGS_KVA, voltageDrop, type Phases, type PowerUnit, type Triangle
} from '../calc/quick';
import { LUX_TARGETS, lumenMethod, REFLECTANCES } from '../calc/lighting';
import { STARTERS } from '../calc/motor';
import type { Project, StarterType } from '../types';
import LuxLayoutPlan from './LuxLayoutPlan';
import { CandidatesTable, LineChart, PfcTriangles, PowerTriangle, RefTable, Steps, SupplyStrip } from './QuickAsides';
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

/** Which calculator tab is showing; every other card renders nothing. */
const ActiveCard = createContext('');

/** `tab` is the tab the card sits on when it isn't its own id (the power cards share one). */
function Card({ id, tab, title, children, result, formula, aside, onReset, errors }: { id: string; tab?: string; title: string; children: ReactNode; result: ReactNode; formula?: string; aside?: ReactNode; onReset: () => void; errors: QuickErrors }) {
  const onTab = tab ?? id;
  if (useContext(ActiveCard) !== onTab) return null;
  return (
    <section className={`qc-card${aside ? ' has-aside' : ''}`} role="tabpanel" id={`qc-panel-${onTab}`} aria-labelledby={`qc-tab-${onTab}`} data-card={id}>
      <div className="qc-main">
        <header><h4>{title}</h4><button className="icon-btn" title="Reset to the defaults" aria-label={`Reset ${title} to the defaults`} onClick={onReset}>↺</button></header>
        <InputErrors.Provider value={errors}><div className="qc-inputs">{children}</div></InputErrors.Provider>
        <div className="qc-result">{Object.keys(errors).length ? <Warn>Correct the highlighted inputs to calculate.</Warn> : result}</div>
        {formula && <p className="qc-formula">{formula}</p>}
      </div>
      {aside && !Object.keys(errors).length && <div className="qc-aside">{aside}</div>}
    </section>
  );
}

const TABS: [string, string][] = [['power', 'Power & current'], ['cable', "Cable & breaker"], ['vd', "Voltage drop"], ['tx', "Transformer"], ['motor', "Motor"], ['pfc', "PF correction"], ['fault', "Fault level"], ['lux', "Lighting lux"], ['ohm', "Ohm's law"], ['energy', "Energy & cost"], ['units', "Units"]];
const TAB_KEY = 'lvds.quick.tab';
function useTab(): [string, (t: string) => void] {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      const t = saved === 'amps' || saved === 'triangle' ? 'power' : saved; // tabs merged in v1.45
      return TABS.some(([k]) => k === t) ? t! : TABS[0][0];
    } catch { return TABS[0][0]; }
  });
  return [tab, (t) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* not kept */ } }];
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
/** The three ways into the Power & current tab. */
const POWER_MODES: [string, string][] = [['amps', 'Power → current'], ['power', 'Current → power'], ['triangle', 'Two of kW, kVA, kVAr, PF']];
const sq3 = (ph: string) => (ph === '3' ? '√3 × ' : '');
const phaseV = (p: string, project: Project) => (p === '3' ? String(project.voltageV) : String(Math.round(project.voltageV / Math.sqrt(3))));

export default function QuickCalcs({ project }: { project: Project }) {
  const V3 = String(project.voltageV);
  const amb = String(project.ambientC);
  const sizes = cableSizes();
  const [tab, setTab] = useTab();
  const [pm, setPm] = useInputs('powerMode', { m: 'amps' });
  const powerMode = POWER_MODES.some(([k]) => k === pm.m) ? pm.m : 'amps';
  const modePick = <Pick label="Start from" value={powerMode} options={POWER_MODES} onChange={(x) => setPm('m', x)} />;

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

  // Power & current — the triangle, worked steps and supply values for each mode
  const aTri: Triangle | undefined = (() => {
    if (!Number.isFinite(aI)) return undefined;
    const kva = (aI * (a.ph === '3' ? Math.sqrt(3) : 1) * num(a.v)!) / 1000;
    return a.unit === 'kVA' ? { kw: NaN, kva, kvar: NaN, pf: NaN } : triangle({ kva, pf: num(a.pf)! });
  })();
  const aSteps = (() => {
    if (!aTri) return [];
    const p = num(a.p)!, eff = num(a.eff)!, pf = num(a.pf)!, v = num(a.v)!;
    const lines: string[] = [];
    let kw = p;
    if (a.unit === 'HP') { kw = p * HP_KW; lines.push(`P = ${fmt(p)} HP × 0.7457 = ${fmt(kw)} kW`); }
    if (a.unit === 'W') { kw = p / 1000; lines.push(`P = ${fmt(p)} W ÷ 1000 = ${fmt(kw)} kW`); }
    if (a.unit !== 'kVA') {
      if (eff !== 1) { lines.push(`P in = ${fmt(kw)} ÷ η ${fmt(eff)} = ${fmt(kw / eff)} kW`); kw /= eff; }
      lines.push(`S = P ÷ PF = ${fmt(kw)} ÷ ${fmt(pf)} = ${fmt(aTri.kva)} kVA`);
    }
    lines.push(`I = S × 1000 ÷ (${sq3(a.ph)}${fmt(v, 0)}) = ${fmt(aI, 1)} A`);
    return lines;
  })();
  const bSteps = bP && !bP.invalid ? [
    `S = ${sq3(b.ph)}${fmt(num(b.v)!, 0)} × ${fmt(num(b.i)!)} ÷ 1000 = ${fmt(bP.kva)} kVA`,
    `P = S × PF = ${fmt(bP.kva)} × ${fmt(num(b.pf)!)} = ${fmt(bP.kw)} kW`,
    `Q = √(S² − P²) = ${fmt(bP.kvar)} kVAr`
  ] : [];
  const cSteps = cT && !cT.invalid ? [
    ...({
      'kw-pf': [`kVA = kW ÷ PF = ${fmt(cT.kw)} ÷ ${fmt(cT.pf, 3)} = ${fmt(cT.kva)}`, `kVAr = √(kVA² − kW²) = ${fmt(cT.kvar)}`],
      'kva-pf': [`kW = kVA × PF = ${fmt(cT.kva)} × ${fmt(cT.pf, 3)} = ${fmt(cT.kw)}`, `kVAr = √(kVA² − kW²) = ${fmt(cT.kvar)}`],
      'kw-kva': [`PF = kW ÷ kVA = ${fmt(cT.kw)} ÷ ${fmt(cT.kva)} = ${fmt(cT.pf, 3)}`, `kVAr = √(kVA² − kW²) = ${fmt(cT.kvar)}`],
      'kw-kvar': [`kVA = √(kW² + kVAr²) = ${fmt(cT.kva)}`, `PF = kW ÷ kVA = ${fmt(cT.pf, 3)}`],
      'kva-kvar': [`kW = √(kVA² − kVAr²) = ${fmt(cT.kw)}`, `PF = kW ÷ kVA = ${fmt(cT.pf, 3)}`]
    } as Record<string, string[]>)[c.known] ?? [],
    `φ = acos PF = ${fmt((Math.acos(Math.min(1, cT.pf)) * 180) / Math.PI, 1)}°`
  ] : [];

  // 4 · Cable & breaker
  const [d, setD, resetD] = useInputs('cable', { i: '160', ph: '3', v: V3, pf: '0.85', l: '50', amb, g: '1', vd: String(project.vdLimitPct) });
  const dErrors = quickInputErrors('cable', d);
  const dRes = Object.keys(dErrors).length ? undefined
    : cableFor(num(d.i)!, { lengthM: num(d.l)!, phases: +d.ph as Phases, voltageV: num(d.v)!, pf: num(d.pf)!, ambientC: num(d.amb)!, groupFactor: num(d.g)!, vdLimitPct: num(d.vd)! });
  const dOpts = { lengthM: num(d.l)!, phases: +d.ph as Phases, voltageV: num(d.v)!, pf: num(d.pf)!, ambientC: num(d.amb)!, groupFactor: num(d.g)!, vdLimitPct: num(d.vd)! };
  const dRows = dRes?.sel && dRes.breakerA ? cableCandidates(num(d.i)!, dOpts, dRes.sel, dRes.breakerA) : [];
  const dSteps = dRes?.sel && dRes.breakerA ? [
    `In = next standard ≥ Ib ${fmt(num(d.i)!, 1)} A → ${dRes.breakerA} A`,
    `Iz = ${getCable(dRes.sel.csaMm2).ampacityA} A × k_amb ${fmt(ambientCorrectionFactor(dOpts.ambientC), 3)} × g ${fmt(dOpts.groupFactor)}${dRes.sel.runs > 1 ? ` × ${dRes.sel.runs} runs` : ''} = ${fmt(dRes.iz, 0)} A ≥ ${Math.max(dRes.breakerA, num(d.i)!)} A`,
    `ΔV = ${fmt(dRes.vd!.pct)} % ≤ ${fmt(dOpts.vdLimitPct)} %`
  ] : [];
  /** Carry a current from the Power & current tab into the cable calculator. */
  const sizeCable = (currentA: number, ph: string, v: string) => { setD('i', String(Math.round(currentA * 10) / 10)); setD('ph', ph); setD('v', v); setTab('cable'); };

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

  // 12 · Lighting (lumen method)
  const [x, setX, resetX] = useInputs('lux', { room: 'office', e: '500', l: '10', w: '8', h: '3', wp: '0.85', sus: '0', lm: '3600', wt: '36', mf: '0.8', ufMode: 'est', refl: '753', uf: '0.6' });
  const xErrors = quickInputErrors('lux', x);
  const xRes = Object.keys(xErrors).length ? undefined : lumenMethod({
    lengthM: num(x.l)!, widthM: num(x.w)!, ceilingM: num(x.h)!, workPlaneM: num(x.wp)!, suspensionM: num(x.sus)!,
    targetLux: num(x.e)!, lumens: num(x.lm)!, watts: num(x.wt)!, mf: num(x.mf)!, reflectance: x.refl, uf: x.ufMode === 'man' ? num(x.uf)! : undefined
  });
  const setLux = (k: string, v: string) => { setX(k, v); if (k === 'e') setX('room', 'custom'); };

  // 13 · Conversions
  const [u, setU, resetU] = useInputs('units', { hp: '10', kw: '7.5', awg: '10', mm2: '16', kcmil: '250' });
  const uErrors = quickInputErrors('units', u);

  // Right-hand panels for the remaining calculators
  const asides: Record<string, ReactNode> = {};
  if (eVd && !eVd.invalid) {
    const I = num(e.i)!, L = num(e.l)!, runs = num(e.runs)!, V = num(e.v)!, pf = num(e.pf)!;
    const lMax = eVd.pct > 0 ? (L * eLim) / eVd.pct : Infinity;
    const span = Math.max(L * 1.5, Math.min(Number.isFinite(lMax) ? lMax * 1.25 : L * 2, L * 4), 10);
    const at = sizes.indexOf(+e.csa);
    const near = sizes.slice(Math.max(0, at - 2), at + 3);
    asides.vd = <>
      <LineChart title="Voltage drop along the cable" xLabel="Length (m)" yUnit="%" ariaLabel={`Voltage drop rises to ${fmt(eVd.pct)} % at ${fmt(L)} m; limit ${fmt(eLim)} %`}
        points={Array.from({ length: 31 }, (_, i) => ({ x: (span * i) / 30, y: (eVd.pct * ((span * i) / 30)) / Math.max(L, 1e-9) }))}
        lines={[{ y: eLim, label: `Limit ${fmt(eLim)} %`, tone: 'limit' }]} marker={{ x: L, y: eVd.pct, label: `${fmt(eVd.pct)} % at ${fmt(L)} m` }} />
      <div className="qc-tiles">
        <div><span>Max length at {fmt(eLim)} %</span><b>{Number.isFinite(lMax) ? `${fmt(lMax, 0)} m` : 'No limit'}</b></div>
        <div><span>Spare to the limit</span><b>{fmt(eLim - eVd.pct)} %</b></div>
      </div>
      <RefTable title={`Other sizes at ${fmt(L)} m`} head={['Cable', 'Voltage drop', `≤ ${fmt(eLim)} %`, 'Max length']} highlight={near.indexOf(+e.csa)}
        rows={near.map((c) => { const v = voltageDrop(I, L, c, +e.ph as Phases, V, pf, runs); return [`${runs > 1 ? `${runs} × ` : ''}${c} mm²`, `${fmt(v.pct)} %`, v.pct <= eLim ? '✓' : '✗', v.pct > 0 ? `${fmt((L * eLim) / v.pct, 0)} m` : '—']; })} />
      <Steps lines={[
        `mV/A/m = ${e.ph === '3' ? '√3' : '2'} · (R cosφ + X sinφ)${runs > 1 ? ` ÷ ${runs}` : ''} = ${fmt(eVd.mvPerAm, 3)}`,
        `ΔV = ${fmt(eVd.mvPerAm, 3)} × ${fmt(I)} A × ${fmt(L)} m ÷ 1000 = ${fmt(eVd.volts)} V`,
        `ΔV % = ${fmt(eVd.volts)} ÷ ${fmt(V, 0)} × 100 = ${fmt(eVd.pct)} %`,
        ...(Number.isFinite(lMax) ? [`L max = ${fmt(L)} × ${fmt(eLim)} ÷ ${fmt(eVd.pct)} = ${fmt(lMax, 0)} m`] : [])
      ]} />
    </>;
  }
  if (tRes && !tRes.invalid) {
    const kva = num(t.kva)!, V = num(t.v)!, z = num(t.z)!;
    const ratings = [...new Set([...TX_RATINGS_KVA, kva])].sort((x1, x2) => x1 - x2);
    asides.tx = <>
      <RefTable title={`Standard ratings at ${fmt(V, 0)} V, Z ${fmt(z)} %`} head={['Rating', 'Full-load current', 'Fault at LV', 'Main breaker']} highlight={ratings.indexOf(kva)}
        rows={ratings.map((r) => { const x2 = transformer(r, V, z); const br = nextBreaker(x2.flc); return [`${fmt(r, 0)} kVA`, `${fmt(x2.flc, 0)} A`, `${fmt(x2.faultKA, 1)} kA`, br === undefined ? '—' : `${br} A`]; })}
        note="Infinite MV source. A real MV source impedance lowers these fault levels a little." />
      <Steps lines={[
        `FLC = ${fmt(kva, 0)} × 1000 ÷ (√3 × ${fmt(V, 0)}) = ${fmt(tRes.flc, 1)} A`,
        `Ik = c 1.05 × ${fmt(tRes.flc, 1)} A ÷ ${fmt(z / 100, 3)} = ${fmt(tRes.faultKA, 1)} kA`
      ]} />
    </>;
  }
  if (mRes && !mRes.invalid) {
    const V = num(m.v)!, k = m.ph === '3' ? Math.sqrt(3) : 1;
    asides.motor = <>
      <RefTable title="Starting current by starter" head={['Starter', '× FLC', 'Starting current', 'Starting kVA']} highlight={STARTERS.findIndex((x2) => x2.value === m.st)}
        rows={STARTERS.map((x2) => [x2.label, `× ${x2.multiple}`, `${fmt(mRes.flc * x2.multiple, 0)} A`, `${fmt((k * V * mRes.flc * x2.multiple) / 1000, 0)} kVA`])}
        note="Typical multiples. Use the starter maker's figures for the final check." />
      <Steps lines={[
        ...(m.unit === 'HP' ? [`P = ${fmt(num(m.p)!)} HP × 0.7457 = ${fmt(mKw)} kW`] : []),
        `P in = ${fmt(mKw)} ÷ η ${fmt(num(m.eff)!)} = ${fmt(mRes.inputKw)} kW`,
        `S = ${fmt(mRes.inputKw)} ÷ PF ${fmt(num(m.pf)!)} = ${fmt(mRes.inputKva)} kVA`,
        `FLC = ${fmt(mRes.inputKva)} × 1000 ÷ (${sq3(m.ph)}${fmt(V, 0)}) = ${fmt(mRes.flc, 1)} A`,
        `I start = ${fmt(mRes.flc, 1)} × ${mRes.multiple} = ${fmt(mRes.startA, 0)} A`
      ]} />
    </>;
  }
  if (pRes && !pRes.invalid && pRes.needed) {
    const kw = num(p.kw)!, pf1 = num(p.now)!, pf2 = num(p.target)!;
    const tan = (pf: number) => Math.sqrt(1 - pf * pf) / pf;
    const bank = pfcBank(pRes.kvar);
    const qLeft = kw * tan(pf1) - (bank?.totalKvar ?? 0);
    const pfBank = kw / Math.hypot(kw, qLeft);
    asides.pfc = <>
      <PfcTriangles kw={kw} pfBefore={pf1} pfAfter={pf2} />
      {bank && <div className="qc-tiles">
        <div><span>Standard bank</span><b>{bank.steps} × {fmt(bank.stepKvar)} kVAr</b></div>
        <div><span>Installed</span><b>{fmt(bank.totalKvar)} kVAr</b></div>
        <div><span>PF with all steps in</span><b>{fmt(pfBank, 3)}{qLeft < 0 ? ' leading' : ''}</b></div>
      </div>}
      <Steps lines={[
        `tan φ1 = tan(acos ${fmt(pf1, 3)}) = ${fmt(tan(pf1), 3)}`,
        `tan φ2 = tan(acos ${fmt(pf2, 3)}) = ${fmt(tan(pf2), 3)}`,
        `Q = ${fmt(kw)} × (${fmt(tan(pf1), 3)} − ${fmt(tan(pf2), 3)}) = ${fmt(pRes.kvar, 1)} kVAr`
      ]} />
    </>;
  }
  if (fRes && !fRes.invalid) {
    const L = num(f.l)!, V = num(f.v)!, csa = +f.csa, runs = num(f.runs)!;
    const at = (len: number) => (f.src === 'tx' ? faultFromTransformer(num(f.kva)!, num(f.z)!, V, csa, len, runs).endKA : faultAtCableEnd(num(f.ka)!, V, csa, len, runs).endKA);
    const span = Math.max(L * 2, 50);
    asides.fault = <>
      <LineChart title="Fault level along the cable" xLabel="Length (m)" yUnit="kA" ariaLabel={`Fault level falls from ${fmt(fRes.startKA, 1)} kA to ${fmt(fRes.endKA, 1)} kA at ${fmt(L)} m`}
        points={Array.from({ length: 41 }, (_, i) => ({ x: (span * i) / 40, y: at((span * i) / 40) }))}
        lines={[6, 10, 25, 36, 50, 70, 100].filter((k) => k <= fRes.startKA * 1.08).map((k) => ({ y: k, label: `${k} kA breaker`, tone: 'ref' as const }))}
        marker={{ x: L, y: fRes.endKA, label: `${fmt(fRes.endKA, 1)} kA at ${fmt(L)} m` }} />
      <p className="qc-note">Pick breakers whose breaking capacity (Icu / Ics) is above the fault level where they are installed. The dashed lines mark common ratings.</p>
      <Steps lines={[
        `At the start: ${fmt(fRes.startKA, 1)} kA`,
        `Z cable = ${csa} mm²${runs > 1 ? ` × ${runs} runs` : ''}, ${fmt(L)} m, R at 20 °C`,
        `At ${fmt(L)} m: ${fmt(fRes.endKA, 1)} kA (${fmt((1 - fRes.endKA / fRes.startKA) * 100, 0)} % lower)`
      ]} />
    </>;
  }
  if (nRes && !nRes.invalid) {
    const kw = num(n.kw)!, h = num(n.h)!, rate = num(n.rate)!;
    const row = (label: string, kwh: number) => [label, `${fmt(kwh, 0)} kWh`, `${fmt(kwh * rate, 2)} ${n.cur}`];
    asides.energy = <RefTable title={`At ${fmt(kw)} kW for ${fmt(h)} h a day`} head={['Period', 'Energy', 'Cost']} highlight={3}
      rows={[row('Per day', kw * h), row('Per week', kw * h * 7), row('Per month (30 days)', kw * h * 30), row(`Your period (${fmt(num(n.days)!, 0)} days)`, nRes.kwh), row('Per year (365 days)', kw * h * 365)]}
      note="Tariff as entered; add fuel surcharge, VAT and demand charges if they apply." />;
  }
  {
    const awgs = [14, 12, 10, 8, 6, 4, 2, 1, 0, -1, -2, -3];
    const awg = num(u.awg);
    asides.units = <RefTable title="AWG to mm²" head={['AWG', 'mm²', 'Next metric size']} highlight={awg === undefined ? undefined : awgs.indexOf(awg)}
      rows={awgs.map((g) => { const mm2 = awgToMm2(g); const next = sizes.find((c) => c >= mm2 - 1e-9); return [awgLabel(g), fmt(mm2, 2), next === undefined ? '—' : `${next} mm²`]; })}
      note="Next metric size up by area. Check the current rating separately; AWG and metric tables use different conditions." />;
  }

  return (
    <Page
      title="Quick calculators"
      intro="Everyday electrical calculations, separate from the project — nothing here changes your design. Same formulas and cable data as the studies; voltage, ambient and voltage-drop limit start from the project settings. Pick a calculator from the tabs. Inputs are remembered on this computer (↺ resets a calculator)."
    >
      <div className="tabs qc-tabs" role="tablist" aria-label="Calculators">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" id={`qc-tab-${k}`} aria-controls={`qc-panel-${k}`} aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <ActiveCard.Provider value={tab}>
      <div className="qc-grid">
        {powerMode === 'amps' && <Card id="amps" tab="power" title="Current from power" errors={aErrors}
          aside={aTri ? <><PowerTriangle t={aTri} /><Steps lines={aSteps} /><SupplyStrip t={aTri} phases={+a.ph as Phases} voltageV={num(a.v)!} onCable={(i) => sizeCable(i, a.ph, a.v)} /></> : undefined} onReset={resetA} formula={a.ph === '3' ? 'I = P ÷ (√3 · V · PF · η)   (kVA: I = S ÷ √3·V)' : 'I = P ÷ (V · PF · η)   (kVA: I = S ÷ V)'}
          result={Number.isFinite(aI) ? <><Out main label="Current" value={fmt(aI, 1)} unit="A" /><BreakerOutput currentA={aI} label="Breaker (next standard)" /></> : <Warn>These values do not produce a finite current. Check the power, voltage and factors.</Warn>}>
          {modePick}
          <Field label="Power" v={a} k="p" set={setA} />
          <Pick field="unit" label="Unit" value={a.unit} options={[['kW', 'kW'], ['kVA', 'kVA'], ['HP', 'HP'], ['W', 'W']]} onChange={(x) => setA('unit', x)} />
          <Pick field="ph" label="Supply" value={a.ph} options={PHASES} onChange={(x) => { setA('ph', x); setA('v', phaseV(x, project)); }} />
          <Field label={a.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={a} k="v" set={setA} unit="V" />
          {a.unit !== 'kVA' && <Field label="Power factor" v={a} k="pf" set={setA} width={60} />}
          {a.unit !== 'kVA' && <Field label="Efficiency η" v={a} k="eff" set={setA} width={60} />}
        </Card>}

        {powerMode === 'power' && <Card id="power" title="Power from current" errors={bErrors}
          aside={bP && !bP.invalid ? <><PowerTriangle t={bP} /><Steps lines={bSteps} /><SupplyStrip t={bP} phases={+b.ph as Phases} voltageV={num(b.v)!} onCable={(i) => sizeCable(i, b.ph, b.v)} /></> : undefined} onReset={resetB} formula={b.ph === '3' ? 'S = √3 · V · I;  P = S · PF;  Q = √(S² − P²)' : 'S = V · I;  P = S · PF;  Q = √(S² − P²)'}
          result={bP?.invalid ? <Warn>{bP.invalid}.</Warn>
            : bP ? <><Out main label="Apparent" value={fmt(bP.kva)} unit="kVA" /><Out label="Active" value={fmt(bP.kw)} unit="kW" /><Out label="Reactive" value={fmt(bP.kvar)} unit="kVAr" /></> : null}>
          {modePick}
          <Field label="Current" v={b} k="i" set={setB} unit="A" />
          <Pick field="ph" label="Supply" value={b.ph} options={PHASES} onChange={(x) => { setB('ph', x); setB('v', phaseV(x, project)); }} />
          <Field label={b.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={b} k="v" set={setB} unit="V" />
          <Field label="Power factor" v={b} k="pf" set={setB} width={60} />
        </Card>}

        {powerMode === 'triangle' && <Card id="triangle" tab="power" title="kW ↔ kVA ↔ kVAr" errors={cErrors}
          aside={cT && !cT.invalid ? <><PowerTriangle t={cT} /><Steps lines={cSteps} /><SupplyStrip t={cT} phases={3} voltageV={project.voltageV} onCable={(i) => sizeCable(i, '3', V3)} /></> : undefined} onReset={resetC} formula="kVA² = kW² + kVAr²;  PF = kW ÷ kVA"
          result={cT && !cT.invalid
            ? <><Out main label="kW" value={fmt(cT.kw)} /><Out main label="kVA" value={fmt(cT.kva)} /><Out label="kVAr" value={fmt(cT.kvar)} /><Out label="Power factor" value={fmt(cT.pf, 3)} /></>
            : <Warn>{cT?.invalid ? `${cT.invalid}. ` : ''}Enter two values that fit together (kW ≤ kVA, kVAr ≤ kVA, PF 0–1).</Warn>}>
          {modePick}
          <Pick field="known" label="You know" value={c.known} options={[['kw-pf', 'kW and PF'], ['kva-pf', 'kVA and PF'], ['kw-kva', 'kW and kVA'], ['kw-kvar', 'kW and kVAr'], ['kva-kvar', 'kVA and kVAr']]} onChange={(x) => setC('known', x)} />
          <Field label={cx} v={c} k="x" set={setC} />
          <Field label={cy} v={c} k="y" set={setC} width={70} />
        </Card>}

        <Card id="cable" title="Cable & breaker size" errors={dErrors}
          aside={dRows.length ? <><CandidatesTable rows={dRows} cores={d.ph === '3' ? 4 : 2} requiredA={Math.max(dRes!.breakerA!, num(d.i)!)} vdLimitPct={dOpts.vdLimitPct} /><Steps lines={dSteps} /></> : undefined} onReset={resetD} formula="In ≥ Ib (next standard); Iz = Iz(table) × ambient × grouping × runs ≥ In; voltage drop ≤ limit. 4-core (3-phase) / 2-core (1-phase) Cu XLPE/SWA, in air."
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

        <Card id="vd" aside={asides.vd} title="Voltage drop" errors={eErrors} onReset={resetE} formula={`ΔV = ${e.ph === '3' ? '√3' : '2'} · I · L · (R cosφ + X sinφ) ÷ runs;  R at 90 °C (1.2 × R20)`}
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

        <Card id="tx" aside={asides.tx} title="Transformer" errors={tErrors} onReset={resetT} formula="FLC = S ÷ (√3 · V);  Isc = FLC ÷ Z%  (infinite MV source)"
          result={tRes?.invalid ? <Warn>{tRes.invalid}</Warn> : tRes ? <><Out main label="Full-load current" value={fmt(tRes.flc, 0)} unit="A" /><Out main label="Fault at LV terminals" value={fmt(tRes.faultKA, 1)} unit="kA" /><BreakerOutput currentA={tRes.flc} label="Main breaker (next standard)" /></> : null}>
          <Field label="Rating" v={t} k="kva" set={setT} unit="kVA" />
          <Field label="LV voltage (L-L)" v={t} k="v" set={setT} unit="V" />
          <Field label="Impedance Z" v={t} k="z" set={setT} unit="%" width={60} />
        </Card>

        <Card id="motor" aside={asides.motor} title="Motor" errors={mErrors} onReset={resetM} formula="FLC = P ÷ (√3 · V · PF · η);  starting current = FLC × starter multiple"
          result={mRes?.invalid ? <Warn>{mRes.invalid}</Warn> : mRes ? <><Out main label="Full-load current" value={fmt(mRes.flc, 1)} unit="A" /><Out main label="Starting current" value={fmt(mRes.startA, 0)} unit="A" /><Out label="Input" value={`${fmt(mRes.inputKw, 1)} kW · ${fmt(mRes.inputKva, 1)} kVA`} /><Out label={m.unit === 'HP' ? 'Output' : 'Output (HP)'} value={m.unit === 'HP' ? `${fmt(mKw, 2)} kW` : `${fmt(mRes.hp, 1)} HP`} /></> : null}>
          <Field label="Output power" v={m} k="p" set={setM} />
          <Pick field="unit" label="Unit" value={m.unit} options={[['kW', 'kW'], ['HP', 'HP']]} onChange={(x) => setM('unit', x)} />
          <Pick field="ph" label="Supply" value={m.ph} options={PHASES} onChange={(x) => { setM('ph', x); setM('v', phaseV(x, project)); }} />
          <Field label={m.ph === '3' ? 'Voltage (L-L)' : 'Voltage (L-N)'} v={m} k="v" set={setM} unit="V" />
          <Field label="Power factor" v={m} k="pf" set={setM} width={60} />
          <Field label="Efficiency η" v={m} k="eff" set={setM} width={60} />
          <Pick field="st" label="Starter" value={m.st} options={STARTERS.map((s) => [s.value, `${s.label} (× ${s.multiple})`] as [string, string])} onChange={(x) => setM('st', x)} />
        </Card>

        <Card id="pfc" aside={asides.pfc} title="Power factor correction" errors={pErrors} onReset={resetP} formula="kVAr = P · (tan φ1 − tan φ2)"
          result={!pRes ? <Warn>Enter kW and both power factors.</Warn>
            : pRes.invalid ? <Warn>{pRes.invalid}.</Warn>
              : pRes.needed
                ? <><Out main label="Capacitor bank" value={fmt(pRes.kvar, 1)} unit="kVAr" /><Out label="kVA before → after" value={`${fmt(pRes.kvaBefore, 0)} → ${fmt(pRes.kvaAfter, 0)}`} unit="kVA" /><Out label="kVA reduced by" value={fmt(pRes.reductionPct, 1)} unit="%" /></>
                : <><Out main label="Capacitor bank" value="0" unit="kVAr" /><Out label="kVA (unchanged)" value={fmt(pRes.kvaBefore, 0)} unit="kVA" /><p className="qc-ok">PF {fmt(pRes.pfAchieved, 3)} already meets the {fmt(num(p.target)!, 3)} target — no capacitor needed.</p></>}>
          <Field label="Active power" v={p} k="kw" set={setP} unit="kW" />
          <Field label="Present PF" v={p} k="now" set={setP} width={60} />
          <Field label="Target PF" v={p} k="target" set={setP} width={60} />
        </Card>

        <Card id="fault" aside={asides.fault} title="Fault level at end of cable" errors={fErrors} onReset={resetF} formula="Zsource from the fault at the start (X/R 5) or the transformer; Iend = V ÷ (√3 · |Zsource + Zcable|)"
          result={fRes?.invalid ? <Warn>{fRes.invalid}</Warn> : fRes ? <><Out label="At the start" value={fmt(fRes.startKA, 1)} unit="kA" /><Out main label="At the cable end" value={fmt(fRes.endKA, 1)} unit="kA" /></> : null}>
          <Pick field="src" label="Source" value={f.src} options={[['tx', 'Transformer'], ['ka', 'Known fault level']]} onChange={(x) => setF('src', x)} />
          {f.src === 'tx' ? <><Field label="Transformer" v={f} k="kva" set={setF} unit="kVA" /><Field label="Impedance" v={f} k="z" set={setF} unit="%" width={60} /></> : <Field label="Fault at start" v={f} k="ka" set={setF} unit="kA" />}
          <Field label="Voltage (L-L)" v={f} k="v" set={setF} unit="V" />
          <Pick field="csa" label="Cable size (mm²)" value={f.csa} options={sizes.map((s) => [String(s), `${s} mm²`])} onChange={(x) => setF('csa', x)} />
          <Field label="Runs in parallel" v={f} k="runs" set={setF} width={50} />
          <Field label="Length" v={f} k="l" set={setF} unit="m" />
        </Card>

        <Card id="ohm" title="Ohm's law & power" errors={oErrors} onReset={resetO} formula="V = I · R;  P = V · I = I² · R = V² ÷ R  (DC / resistive)"
          result={oRes?.invalid ? <Warn>{oRes.invalid}</Warn> : oRes ? <><Out label="Voltage" value={fmt(oRes.v, 3)} unit="V" /><Out label="Current" value={fmt(oRes.i, 3)} unit="A" /><Out label="Resistance" value={fmt(oRes.r, 3)} unit="Ω" /><Out label="Power" value={fmt(oRes.p, 3)} unit="W" /></> : null}>
          <Pick field="known" label="You know" value={o.known} options={Object.entries(oKnown).map(([k, x]) => [k, `${x[0]} and ${x[2]}`] as [string, string])} onChange={(x) => setO('known', x)} />
          <Field label={ok2[0]} v={o} k="x" set={setO} unit={ok2[1]} />
          <Field label={ok2[2]} v={o} k="y" set={setO} unit={ok2[3]} />
        </Card>

        <Card id="energy" aside={asides.energy} title="Energy & cost" errors={nErrors} onReset={resetN} formula="kWh = kW × hours/day × days;  cost = kWh × tariff (use your tariff incl. fuel surcharge)"
          result={nRes?.invalid ? <Warn>{nRes.invalid}</Warn> : nRes ? <><Out main label="Energy" value={fmt(nRes.kwh, 0)} unit="kWh" /><Out main label="Cost" value={fmt(nRes.cost, 2)} unit={n.cur} /></> : null}>
          <Field label="Load" v={n} k="kw" set={setN} unit="kW" />
          <Field label="Hours per day" v={n} k="h" set={setN} unit="h" width={60} />
          <Field label="Days" v={n} k="days" set={setN} width={60} />
          <Field label="Tariff" v={n} k="rate" set={setN} unit={`${n.cur}/kWh`} width={60} />
          <label className="qc-field"><span>Currency</span><input style={{ width: 60 }} value={n.cur} onChange={(x) => setN('cur', x.target.value)} /></label>
        </Card>

        <Card id="lux" title="Lighting — lux (lumen method)" errors={xErrors} onReset={resetX}
          aside={xRes && !xRes.invalid ? <LuxLayoutPlan lengthM={num(x.l)!} widthM={num(x.w)!} rows={xRes.rows} cols={xRes.cols} /> : undefined}
          formula="K = L·W ÷ (Hm·(L + W));  N = E·A ÷ (Φ·UF·MF);  E achieved = N·Φ·UF·MF ÷ A. Average only — use DIALux / Relux for uniformity, glare and point values. Estimated UF is indicative for a direct LED luminaire; use the manufacturer's UF table when you have it."
          result={xRes?.invalid ? <Warn>{xRes.invalid}</Warn> : xRes ? <>
            <Out main label="Luminaires" value={`${xRes.count} (${xRes.rows} × ${xRes.cols})`} />
            <Out main label="Average illuminance" value={fmt(xRes.achievedLux, 0)} unit="lx" />
            <Out label="Calculated (exact)" value={fmt(xRes.required, 1)} />
            <Out label="Room index K" value={fmt(xRes.k)} />
            <Out label={xRes.ufEstimated ? 'UF (estimated)' : 'UF (entered)'} value={fmt(xRes.uf)} />
            <Out label="Area · Hm" value={`${fmt(xRes.areaM2, 1)} m² · ${fmt(xRes.hmM)} m`} />
            <Out label="Spacing (along L × W)" value={`${fmt(xRes.spacingLM)} × ${fmt(xRes.spacingWM)}`} unit="m" />
            <Out label="Spacing ÷ Hm" value={fmt(xRes.shr)} />
            <Out label="Lighting load" value={`${fmt(xRes.totalW / 1000)} kW · ${fmt(xRes.wPerM2, 1)} W/m²`} />
            <Out label="W/m² per 100 lx" value={fmt(xRes.wPerM2Per100Lux)} />
            {xRes.shr > 1.5 && <Warn>Spacing is more than 1.5 × Hm — check the luminaire's maximum spacing-to-height ratio; uniformity may be poor.</Warn>}
          </> : null}>
          <Pick field="room" label="Space" value={x.room} options={[...LUX_TARGETS.map((r) => [r.key, `${r.label} (${r.lux} lx)`] as [string, string]), ['custom', 'Custom target']]}
            onChange={(v) => { setX('room', v); const t = LUX_TARGETS.find((r) => r.key === v); if (t) setX('e', String(t.lux)); }} />
          <Field label="Target Em" v={x} k="e" set={setLux} unit="lx" width={70} />
          <Field label="Room length L" v={x} k="l" set={setX} unit="m" width={70} />
          <Field label="Room width W" v={x} k="w" set={setX} unit="m" width={70} />
          <Field label="Ceiling height" v={x} k="h" set={setX} unit="m" width={70} />
          <Field label="Working plane" v={x} k="wp" set={setX} unit="m" width={70} />
          <Field label="Suspension" v={x} k="sus" set={setX} unit="m" width={70} />
          <Field label="Luminaire output Φ" v={x} k="lm" set={setX} unit="lm" width={70} />
          <Field label="Luminaire wattage" v={x} k="wt" set={setX} unit="W" width={70} />
          <Field label="Maintenance factor" v={x} k="mf" set={setX} width={60} />
          <Pick field="ufMode" label="Utilisation factor" value={x.ufMode} options={[['est', 'Estimate from reflectances'], ['man', 'Enter from manufacturer']]} onChange={(v) => setX('ufMode', v)} />
          {x.ufMode === 'man'
            ? <Field label="UF" v={x} k="uf" set={setX} width={60} />
            : <Pick field="refl" label="Ceiling / wall / floor" value={x.refl} options={REFLECTANCES.map((r) => [r.key, r.label] as [string, string])} onChange={(v) => setX('refl', v)} />}
        </Card>

        <Card id="units" aside={asides.units} title="Unit conversions" errors={uErrors} onReset={resetU}
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
      </ActiveCard.Provider>
    </Page>
  );
}
