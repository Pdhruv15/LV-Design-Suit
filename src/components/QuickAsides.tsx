import { nextBreaker, pfCorrection, type CableCandidate, type Phases, type Triangle } from '../calc/quick';

/** Right-hand panels for the quick calculators: a picture of the answer, the
 * worked steps with the numbers in, and what it means at the supply. */

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');
const deg = (pf: number) => (Math.acos(Math.min(1, Math.max(0, pf))) * 180) / Math.PI;

/** Power triangle drawn to scale: P along, Q up, S the hypotenuse. */
export function PowerTriangle({ t }: { t: Triangle }) {
  if (!(t.kva > 0) || ![t.kw, t.kvar].every(Number.isFinite)) return null;
  const left = 34, top = 18, maxW = 250, maxH = 120;
  const scale = Math.min(maxW / Math.max(t.kw, 1e-9), maxH / Math.max(t.kvar, 1e-9), maxW / t.kva, maxH / t.kva);
  const w = t.kw * scale, h = t.kvar * scale;
  const x0 = left, y0 = top + Math.max(h, 24), x1 = x0 + w, y1 = y0 - h;
  const phi = deg(t.pf);
  const arcR = Math.min(36, Math.max(14, w * 0.25));
  const a = (phi * Math.PI) / 180;
  return (
    <svg className="qc-triangle" viewBox={`0 0 ${left + maxW + 110} ${y0 + 28}`} role="img" aria-label={`Power triangle: P ${fmt(t.kw)} kW, Q ${fmt(t.kvar)} kVAr, S ${fmt(t.kva)} kVA, angle ${fmt(phi, 1)} degrees`}>
      <line className="p" x1={x0} y1={y0} x2={x1} y2={y0} />
      {h > 0.5 && <line className="q" x1={x1} y1={y0} x2={x1} y2={y1} />}
      <line className="s" x1={x0} y1={y0} x2={x1} y2={y1} />
      {phi > 0.5 && phi < 89.5 && <path className="arc" d={`M${x0 + arcR} ${y0}A${arcR} ${arcR} 0 0 0 ${x0 + arcR * Math.cos(a)} ${y0 - arcR * Math.sin(a)}`} />}
      {phi > 0.5 && <text x={x0 + arcR + 6} y={y0 - 5}>φ {fmt(phi, 1)}°</text>}
      <text className="lp" x={x0 + w / 2} y={y0 + 18} textAnchor="middle">P = {fmt(t.kw)} kW</text>
      {h > 0.5 && <text className="lq" x={x1 + 8} y={y0 - h / 2 + 4}>Q = {fmt(t.kvar)} kVAr</text>}
      <text className="ls" x={x0 + w / 2 - 8} y={y0 - h / 2 - 8} textAnchor="end">S = {fmt(t.kva)} kVA</text>
    </svg>
  );
}

export function Steps({ lines }: { lines: string[] }) {
  return lines.length ? <div className="qc-steps"><h5>Worked steps</h5><pre>{lines.join('\n')}</pre></div> : null;
}

/** Current, breaker and the capacitor to reach PF 0.95, at a stated supply. */
export function SupplyStrip({ t, phases, voltageV, onCable }: { t: Triangle; phases: Phases; voltageV: number; onCable?: (currentA: number) => void }) {
  if (!(t.kva > 0) || !(voltageV > 0)) return null;
  const currentA = (t.kva * 1000) / (phases === 3 ? Math.sqrt(3) * voltageV : voltageV);
  const breaker = nextBreaker(currentA);
  const pfc = t.kw > 0 && t.pf > 0 ? pfCorrection(t.kw, t.pf, 0.95) : undefined;
  return (
    <div className="qc-supply">
      <h5>At {fmt(voltageV, 0)} V, {phases}-phase</h5>
      <div className="qc-tiles">
        <div><span>Current</span><b>{fmt(currentA, 1)} A</b></div>
        <div><span>Reference rating ≥ current</span><b>{breaker === undefined ? 'None available' : `${breaker} A`}</b></div>
        {pfc && !pfc.invalid && (pfc.needed
          ? <><div><span>Capacitor for PF 0.95</span><b>{fmt(pfc.kvar, 1)} kVAr</b></div><div><span>kVA after correction</span><b>{fmt(pfc.kvaAfter, 1)} kVA</b></div></>
          : <div><span>Power factor</span><b>Already ≥ 0.95</b></div>)}
      </div>
      {onCable && Number.isFinite(currentA) && <button type="button" className="link-btn" onClick={() => onCable(currentA)}>Size the cable for {fmt(currentA, 1)} A →</button>}
    </div>
  );
}

/** Sizes around the chosen cable and why each passes or fails. */
export function CandidatesTable({ rows, cores, requiredA, vdLimitPct }: { rows: CableCandidate[]; cores: number; requiredA: number; vdLimitPct: number }) {
  if (!rows.length) return null;
  const mark = (ok: boolean) => <span className={ok ? 'qc-ok' : 'qc-bad'}>{ok ? '✓' : '✗'}</span>;
  return (
    <div className="qc-candidates">
      <h5>Sizes checked{rows[0].runs > 1 ? ` (${rows[0].runs} runs in parallel)` : ''}</h5>
      <table>
        <thead><tr><th>Cable</th><th>Iz derated</th><th>≥ {fmt(requiredA, 0)} A</th><th>Voltage drop</th><th>≤ {fmt(vdLimitPct)} %</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.csaMm2} className={r.chosen ? 'chosen' : undefined}>
              <td>{r.runs > 1 ? `${r.runs} × ` : ''}{cores}C × {r.csaMm2} mm²</td>
              <td>{fmt(r.iz, 0)} A</td>
              <td>{mark(r.izOk)}</td>
              <td>{fmt(r.vdPct)} %</td>
              <td>{mark(r.vdOk)}</td>
              <td>{r.chosen ? 'Selected' : r.izOk && r.vdOk ? 'Also OK' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>The smallest size that passes both checks is selected. A larger size gives spare capacity and a lower voltage drop.</p>
    </div>
  );
}

const niceStep = (span: number, n = 5) => {
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
};

export interface ChartLine { y: number; label: string; tone?: 'limit' | 'ref' }

/** Small line chart: one curve, horizontal reference lines and a marked point. */
export function LineChart({ title, points, xLabel, yUnit, lines = [], marker, ariaLabel }: {
  title: string; points: { x: number; y: number }[]; xLabel: string; yUnit: string; lines?: ChartLine[];
  marker?: { x: number; y: number; label: string }; ariaLabel: string;
}) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return null;
  const W = 420, H = 210, l = 46, r = 14, t = 12, b = 34;
  const xMax = Math.max(...pts.map((p) => p.x));
  const yTop = Math.max(...pts.map((p) => p.y), ...lines.map((ln) => ln.y), marker?.y ?? 0) * 1.08 || 1;
  const xs = niceStep(xMax), ys = niceStep(yTop, 4);
  const X = (x: number) => l + (x / xMax) * (W - l - r);
  const Y = (y: number) => t + (1 - y / yTop) * (H - t - b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('');
  const xTicks = Array.from({ length: Math.floor(xMax / xs) + 1 }, (_, i) => i * xs);
  const yTicks = Array.from({ length: Math.floor(yTop / ys) + 1 }, (_, i) => i * ys);
  return (
    <div className="qc-chart">
      <h5>{title}</h5>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {yTicks.map((y) => <g key={`y${y}`}><line className="grid" x1={l} x2={W - r} y1={Y(y)} y2={Y(y)} /><text x={l - 6} y={Y(y) + 4} textAnchor="end">{fmt(y, 2)}</text></g>)}
        {xTicks.map((x) => <text key={`x${x}`} x={X(x)} y={H - b + 15} textAnchor="middle">{fmt(x, 1)}</text>)}
        <line className="axis" x1={l} x2={W - r} y1={H - b} y2={H - b} />
        <line className="axis" x1={l} x2={l} y1={t} y2={H - b} />
        {lines.filter((ln) => ln.y <= yTop).map((ln) => (
          <g key={ln.label} className={ln.tone === 'limit' ? 'limit' : 'ref'}>
            <line x1={l} x2={W - r} y1={Y(ln.y)} y2={Y(ln.y)} />
            <text x={W - r - 4} y={Y(ln.y) - 4} textAnchor="end">{ln.label}</text>
          </g>
        ))}
        <path className="curve" d={path} />
        {marker && Number.isFinite(marker.y) && <g className="mark"><circle cx={X(marker.x)} cy={Y(marker.y)} r={4} /><text x={X(marker.x) + 7} y={Y(marker.y) - 7}>{marker.label}</text></g>}
        <text className="cap" x={(l + W - r) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
        <text className="cap" x={12} y={t + (H - t - b) / 2} textAnchor="middle" transform={`rotate(-90 12 ${t + (H - t - b) / 2})`}>{yUnit}</text>
      </svg>
    </div>
  );
}

/** Compact reference table with one row highlighted. */
export function RefTable({ title, head, rows, highlight, note }: { title: string; head: string[]; rows: (string | number)[][]; highlight?: number; note?: string }) {
  if (!rows.length) return null;
  return (
    <div className="qc-candidates">
      <h5>{title}</h5>
      <table>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} className={i === highlight ? 'chosen' : undefined}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
      {note && <p>{note}</p>}
    </div>
  );
}

/** Power triangle before and after correction, sharing P. */
export function PfcTriangles({ kw, pfBefore, pfAfter }: { kw: number; pfBefore: number; pfAfter: number }) {
  if (!(kw > 0 && pfBefore > 0 && pfAfter > 0)) return null;
  const q = (pf: number) => kw * Math.sqrt(1 - pf * pf) / pf;
  const q1 = q(pfBefore), q2 = q(pfAfter);
  const left = 30, top = 16, maxW = 250, maxH = 130;
  const s = Math.min(maxW / kw, maxH / Math.max(q1, 1e-9));
  const w = kw * s, x0 = left, y0 = top + Math.max(q1 * s, 24), x1 = x0 + w;
  return (
    <div className="qc-chart">
      <h5>Before and after correction</h5>
      <svg className="qc-triangle" viewBox={`0 0 ${left + maxW + 130} ${y0 + 28}`} role="img" aria-label={`Reactive power falls from ${fmt(q1)} to ${fmt(q2)} kVAr at ${fmt(kw)} kW`}>
        <line className="p" x1={x0} y1={y0} x2={x1} y2={y0} />
        <line className="q" x1={x1} y1={y0} x2={x1} y2={y0 - q1 * s} />
        <line className="s before" x1={x0} y1={y0} x2={x1} y2={y0 - q1 * s} />
        <line className="s" x1={x0} y1={y0} x2={x1} y2={y0 - q2 * s} />
        <line className="cap-q" x1={x1 + 10} y1={y0 - q1 * s} x2={x1 + 10} y2={y0 - q2 * s} />
        <text className="lp" x={x0 + w / 2} y={y0 + 18} textAnchor="middle">P = {fmt(kw)} kW</text>
        <text x={x1 + 16} y={y0 - (q1 + q2) * s / 2 + 4}>Capacitor {fmt(q1 - q2, 1)} kVAr</text>
      </svg>
      <p className="qc-note"><span className="qc-key dash" /> Before: S₁ {fmt(kw / pfBefore, 0)} kVA at PF {fmt(pfBefore, 2)} · <span className="qc-key" /> After: S₂ {fmt(kw / pfAfter, 0)} kVA at PF {fmt(pfAfter, 2)}</p>
    </div>
  );
}
