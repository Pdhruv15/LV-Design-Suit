/** 2D plan of the lumen-method grid: room outline, luminaire positions and the
 * setting-out dimensions (edge = spacing ÷ 2, then equal spacing). */

const f2 = (v: number) => v.toFixed(2);

/** Ticks along one side: 0, s/2, s/2 + s, … , length. */
const chain = (count: number, length: number) => {
  const s = length / count;
  return [0, ...Array.from({ length: count }, (_, i) => (i + 0.5) * s), length];
};

export default function LuxLayoutPlan({ lengthM, widthM, rows, cols }: { lengthM: number; widthM: number; rows: number; cols: number }) {
  if (!(lengthM > 0 && widthM > 0 && rows > 0 && cols > 0)) return null;
  const left = 84, top = 52, right = 64, bottom = 44;
  const scale = Math.min(520 / lengthM, 360 / widthM);
  const rw = lengthM * scale, rh = widthM * scale;
  const vbW = left + rw + right, vbH = top + rh + bottom;
  const sL = lengthM / cols, sW = widthM / rows;
  const xs = chain(cols, lengthM).map((v) => left + v * scale);
  const ys = chain(rows, widthM).map((v) => top + v * scale);
  const centresX = xs.slice(1, -1), centresY = ys.slice(1, -1);
  const r = Math.max(4, Math.min(11, Math.min(sL, sW) * scale * 0.22));

  // Label a chain segment only if it has room; the legend gives the values anyway.
  const hLabel = (a: number, b: number, y: number, text: string, key: string) =>
    b - a >= 30 ? <text key={key} x={(a + b) / 2} y={y - 4} textAnchor="middle">{text}</text> : null;
  const vLabel = (a: number, b: number, x: number, text: string, key: string) =>
    b - a >= 13 ? <text key={key} x={x - 6} y={(a + b) / 2 + 4} textAnchor="end">{text}</text> : null;
  const segText = (i: number, n: number, s: number) => f2(i === 0 || i === n ? s / 2 : s);

  const chainTop = top - 18, chainLeft = left - 18, dimBottom = top + rh + 24, dimRight = left + rw + 24;
  return (
    <figure className="lux-plan">
      <svg viewBox={`0 0 ${vbW} ${vbH}`} role="img" aria-label={`Plan: ${rows} rows by ${cols} columns of luminaires in a ${f2(lengthM)} by ${f2(widthM)} m room`}>
        <rect className="room" x={left} y={top} width={rw} height={rh} />
        {centresX.map((x, i) => <line key={`gx${i}`} className="axis" x1={x} y1={top} x2={x} y2={top + rh} />)}
        {centresY.map((y, i) => <line key={`gy${i}`} className="axis" x1={left} y1={y} x2={left + rw} y2={y} />)}
        {centresY.map((y, j) => centresX.map((x, i) => (
          <g key={`l${i}-${j}`} className="lum">
            <circle cx={x} cy={y} r={r} />
            <path d={`M${x - r * 0.7} ${y - r * 0.7}L${x + r * 0.7} ${y + r * 0.7}M${x + r * 0.7} ${y - r * 0.7}L${x - r * 0.7} ${y + r * 0.7}`} />
          </g>
        )))}

        {/* Setting-out chain along L (top) */}
        <line className="dim" x1={xs[0]} y1={chainTop} x2={xs[xs.length - 1]} y2={chainTop} />
        {xs.map((x, i) => <line key={`tx${i}`} className="tick" x1={x - 3} y1={chainTop + 3} x2={x + 3} y2={chainTop - 3} />)}
        {xs.map((x, i) => <line key={`ex${i}`} className="ext" x1={x} y1={chainTop - 4} x2={x} y2={i === 0 || i === xs.length - 1 ? top : centresY[0] - r} />)}
        {xs.slice(1).map((x, i) => hLabel(xs[i], x, chainTop, segText(i, cols, sL), `hx${i}`))}

        {/* Setting-out chain along W (left) */}
        <line className="dim" x1={chainLeft} y1={ys[0]} x2={chainLeft} y2={ys[ys.length - 1]} />
        {ys.map((y, i) => <line key={`ty${i}`} className="tick" x1={chainLeft - 3} y1={y + 3} x2={chainLeft + 3} y2={y - 3} />)}
        {ys.map((y, i) => <line key={`ey${i}`} className="ext" x1={chainLeft - 4} y1={y} x2={i === 0 || i === ys.length - 1 ? left : centresX[0] - r} y2={y} />)}
        {ys.slice(1).map((y, i) => vLabel(ys[i], y, chainLeft, segText(i, rows, sW), `vy${i}`))}

        {/* Overall dimensions */}
        <line className="dim" x1={left} y1={dimBottom} x2={left + rw} y2={dimBottom} />
        <line className="tick" x1={left - 3} y1={dimBottom + 3} x2={left + 3} y2={dimBottom - 3} />
        <line className="tick" x1={left + rw - 3} y1={dimBottom + 3} x2={left + rw + 3} y2={dimBottom - 3} />
        <text className="overall" x={left + rw / 2} y={dimBottom + 14} textAnchor="middle">L = {f2(lengthM)} m</text>
        <line className="dim" x1={dimRight} y1={top} x2={dimRight} y2={top + rh} />
        <line className="tick" x1={dimRight - 3} y1={top + 3} x2={dimRight + 3} y2={top - 3} />
        <line className="tick" x1={dimRight - 3} y1={top + rh + 3} x2={dimRight + 3} y2={top + rh - 3} />
        <text className="overall" x={dimRight + 14} y={top + rh / 2} textAnchor="middle" transform={`rotate(90 ${dimRight + 14} ${top + rh / 2})`}>W = {f2(widthM)} m</text>
      </svg>
      <figcaption>
        {rows} × {cols} = {rows * cols} luminaires · spacing {f2(sL)} m (along L) × {f2(sW)} m (along W) · first row {f2(sL / 2)} m / {f2(sW / 2)} m from the walls. Dimensions in metres, to luminaire centres.
      </figcaption>
    </figure>
  );
}
