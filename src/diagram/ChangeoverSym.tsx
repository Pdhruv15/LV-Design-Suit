import { breakerLines, type IncomerBreaker } from '../model/changeover';
import type { SpdType } from '../types';
import { SwitchSym } from './IecSymbols';
import { Sym, SYM_SCALE } from './symbolLibrary';

/** Rows of an incomer's instruments, measured up from the busbar (DEWA submission
 * drawings): ammeters on CTs, R-Y-B lamps, the breaker's OC / SC / EF trip
 * functions, the power meter to BMS, the voltmeter with its selector switch and,
 * hung below it, the SPD. The incomer breaker sits just above the busbar. */
export const CO_ROWS = { amps: 195, lamps: 170, trip: 145, pmu: 120, volts: 95, spd: 75, breaker: 48 } as const;
/** How far the generator incomer's instruments reach right of its line (PMU arrow and "TO BMS"). */
export const CO_GEN_REACH = 135;

const CELL = 18, GAP = 3;

/** A row of labelled cells beside an incomer line at (x, y); side −1 = to the left, +1 = to the right.
 * `ct`: taken from a current transformer (ring on the line), else a voltage tap (dot). */
function Row({ x, y, side, cells, round, ct }: { x: number; y: number; side: 1 | -1; cells: string[]; round?: boolean; ct?: boolean }) {
  const w = CELL;
  const total = cells.length * w + (cells.length - 1) * GAP;
  const x0 = side < 0 ? x - 14 - total : x + 14;
  const order = side < 0 ? cells : [...cells].reverse();
  return (
    <g>
      {ct ? <circle cx={x} cy={y} r="4" className="sym-ln" /> : <circle cx={x} cy={y} r="2.2" className="sym-fill" />}
      <line x1={x + side * (ct ? 4 : 2)} y1={y} x2={side < 0 ? x0 + total : x0} y2={y} className="ln" />
      {order.map((c, i) => {
        const cx = x0 + i * (w + GAP) + w / 2;
        return (
          <g key={`${c}-${i}`}>
            {round ? <circle cx={cx} cy={y} r={CELL / 2} className="sym" /> : <rect x={cx - w / 2} y={y - 7} width={w} height="14" className="sym" />}
            <text x={cx} y={y + 3} textAnchor="middle" className="acc-t b" style={{ fontSize: 8.5 }}>{c}</text>
          </g>
        );
      })}
    </g>
  );
}

/** One incomer of a mains / generator changeover, from `top` down to the busbar at `busY`. */
function Incomer({ x, top, busY, side, breaker, instruments, pmu, spd }: {
  x: number; top: number; busY: number; side: 1 | -1; breaker: IncomerBreaker; instruments: boolean; pmu: boolean; spd?: SpdType;
}) {
  const y = (k: keyof typeof CO_ROWS) => busY - CO_ROWS[k];
  const lines = breakerLines(breaker);
  const tx = x + side * 14, anchor = side < 0 ? 'end' : 'start';
  // PMU in the middle of its 28-wide cell, BMS arrow out from it, away from the incomer.
  const pmuX = x + side * 28, pmuEnd = pmuX + side * 7, bmsX = x + side * 88;
  // SPD hangs below the voltmeter row, clear of the breaker text.
  const sx = x + side * 52;
  return (
    <g>
      <line x1={x} y1={top} x2={x} y2={busY} className="ln" />
      {instruments && <Row x={x} y={y('amps')} side={side} cells={['A', 'A', 'A']} ct />}
      {instruments && <Row x={x} y={y('lamps')} side={side} cells={['B', 'Y', 'R']} round />}
      <Row x={x} y={y('trip')} side={side} cells={['EF', 'SC', 'OC']} ct />
      {pmu && (
        <>
          <circle cx={x} cy={y('pmu')} r="4" className="sym-ln" />
          <line x1={x + side * 4} y1={y('pmu')} x2={pmuX - side * 7} y2={y('pmu')} className="ln" />
          <Sym id="pmu" x={pmuX} y={y('pmu')} s={SYM_SCALE.device} />
          <line x1={pmuEnd} y1={y('pmu')} x2={bmsX} y2={y('pmu')} className="ln" />
          <path d={`M${bmsX} ${y('pmu')} l${-side * 6} -3.5 v7 z`} className="sym-fill" />
          <text x={bmsX + side * 5} y={y('pmu') + 3} textAnchor={anchor} className="acc-t">TO BMS</text>
        </>
      )}
      {instruments && <Row x={x} y={y('volts')} side={side} cells={['V', 'SS']} />}
      {spd && (
        <g>
          {!instruments && <line x1={x} y1={y('volts')} x2={sx} y2={y('volts')} className="ln" />}
          <line x1={sx} y1={y('volts') + (instruments ? 7 : 0)} x2={sx} y2={y('spd') - 8} className="ln" />
          <Sym id="spd" x={sx} y={y('spd')} s={SYM_SCALE.device} />
          <text x={sx + side * 7} y={y('spd') + 3} textAnchor={anchor} className="acc-t b" style={{ fontSize: 8 }}>SPD</text>
        </g>
      )}
      <rect x={x - 2} y={y('breaker') - 7} width="4" height="31" className="bg-fill" />
      <SwitchSym x={x} y={y('breaker')} kind={breaker.drawOut ? 'acb' : 'breaker'} />
      <text x={tx} y={y('breaker') - 2} textAnchor={anchor} className="dev">{lines[0]}</text>
      <text x={tx} y={y('breaker') + 10} textAnchor={anchor} className="dev-k">{lines[1]}</text>
      <text x={tx} y={y('breaker') + 22} textAnchor={anchor} className="dev-k">{lines[2]}</text>
    </g>
  );
}

/** Mains / generator changeover into one busbar: two incomers with their instruments,
 * kept apart by an electro-mechanical interlock between the two breakers. */
export function ChangeoverIncomers({ x, genX, headY, busY, kva, mains, generator, instruments, pmu, spd }: {
  x: number; genX: number; headY: number; busY: number; kva: number;
  mains: IncomerBreaker; generator: IncomerBreaker; instruments: boolean; pmu: boolean; spd?: SpdType;
}) {
  const by = busY - CO_ROWS.breaker + 9; // mid-breaker, where the interlock links
  const ly = busY - CO_ROWS.volts + 12, mid = (x + genX) / 2;
  const gy = headY - 40;
  return (
    <g className="acc changeover">
      <title>{`Mains / generator changeover: ${breakerLines(mains).join(' ')} and ${breakerLines(generator).join(' ')}, electro-mechanically interlocked`}</title>
      <Incomer x={x} top={headY - 22} busY={busY} side={-1} breaker={mains} instruments={instruments} pmu={pmu} spd={spd} />
      <Incomer x={genX} top={gy + 11} busY={busY} side={1} breaker={generator} instruments={instruments} pmu={pmu} spd={spd} />
      <text x={x - 6} y={busY - CO_ROWS.amps - 13} textAnchor="end" className="acc-t b">MAINS (N)</text>
      <text x={genX + 6} y={busY - CO_ROWS.amps - 13} className="acc-t b">GENERATOR (E)</text>
      <circle cx={genX} cy={gy} r="11" className="sym" />
      <text x={genX} y={gy + 4} textAnchor="middle" className="b" style={{ fontSize: 11 }}>G</text>
      <text x={genX + 15} y={gy - 2} className="m">STANDBY GENERATOR</text>
      <text x={genX + 15} y={gy + 11} className="m">{kva} kVA</text>
      <path d={`M${x + 5} ${by} L${x + 28} ${ly} H${genX - 28} L${genX - 5} ${by}`} className="ln" />
      <path d={`M${mid - 7} ${ly} l7 7 l7 -7 z`} className="sym-ln" />
      <text x={mid} y={ly - 18} textAnchor="middle" className="acc-t b" style={{ fontSize: 9 }}>ELECTRO MECHANICAL</text>
      <text x={mid} y={ly - 7} textAnchor="middle" className="acc-t b" style={{ fontSize: 9 }}>INTERLOCK</text>
    </g>
  );
}
