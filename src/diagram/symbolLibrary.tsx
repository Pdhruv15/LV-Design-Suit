/** IEC 60617 symbol library. Every symbol is drawn once, on a 2.5 mm grid, in
 * one frame: the body fits the box x 16–44, y 24–56 (28 × 32 units) on the
 * line axis x = 30, entering at the top and leaving at the bottom. Parts
 * marked `acc` (drawout marks, toroids, signal links, earths, side boxes) may
 * sit outside the box. A drawing places a symbol by its body centre (30, 40)
 * at one scale, so all symbols of a kind come out the same size. Text keeps
 * the diagram's own font sizes and is not scaled. */

export type SymCls = 'ln' | 'sym' | 'open' | 'fill' | 'thick' | 'dash';

export type SymPrim =
  | { k: 'p'; d: string; c?: SymCls; acc?: true }
  | { k: 'c'; cx: number; cy: number; r: number; c?: SymCls; acc?: true }
  | { k: 'e'; cx: number; cy: number; rx: number; ry: number; c?: SymCls; acc?: true }
  | { k: 'r'; x: number; y: number; w: number; h: number; c?: SymCls; acc?: true }
  /** Text centred on (x, y); `side` labels sit right of the axis and are drawn only on request. */
  | { k: 't'; x: number; y: number; s: string; b?: true; side?: true; acc?: true };

export interface SymDef { label: string; iec: string; prims: SymPrim[] }

export const SYM_BOX = { x: 16, y: 24, w: 28, h: 32 } as const;
export const SYM_CX = 30;
export const SYM_CY = 40;

const p = (d: string, c?: SymCls, acc?: true): SymPrim => ({ k: 'p', d, c, acc });
const c = (cx: number, cy: number, r: number, cl: SymCls = 'sym', acc?: true): SymPrim => ({ k: 'c', cx, cy, r, c: cl, acc });
const r = (x: number, y: number, w: number, h: number, cl: SymCls = 'sym', acc?: true): SymPrim => ({ k: 'r', x, y, w, h, c: cl, acc });
const t = (x: number, y: number, s: string, b?: true): SymPrim => ({ k: 't', x, y, s, b });
const side = (s: string, y = 40): SymPrim => ({ k: 't', x: 48, y, s, side: true, acc: true });
const toroid = (y: number): SymPrim => ({ k: 'e', cx: 30, cy: y, rx: 6, ry: 3, c: 'open', acc: true });

// Switching parts: fixed contact at y 28, blade pivot at the body bottom.
const CON = 'M30 24V28';
const BLADE = 'M30 56L19 30';
const CROSS = 'M26 24L34 32M34 24L26 32'; // breaker function 07-13-05
const BAR = 'M25 28H35'; // disconnector function 07-13-06
const CB = [p(`${CON} ${CROSS} ${BLADE}`)];
const ISOL = [p(`${CON} ${BAR} ${BLADE}`)];
const EARTH = (y: number, acc?: true) => p(`M20 ${y}H40M24 ${y + 4}H36M28 ${y + 8}H32`, 'ln', acc);
const SIGNAL = (s: string) => [p('M44 40H62', 'dash', true), side(s, 34)];
const box = (code: string): SymPrim[] => [r(16, 24, 28, 32), code.length > 2 ? t(30, 40, code) : t(30, 40, code, true)];
const panel = (code: string): SymPrim[] => [r(16, 24, 28, 32), r(16, 24, 28, 5, 'fill'), t(30, 42, code, code.length <= 2 || undefined)];
const instrument = (letter: string, sub?: string): SymPrim[] => sub
  ? [c(30, 40, 14), t(30, 36, letter, true), t(30, 48, sub)]
  : [c(30, 40, 14), t(30, 40, letter, true)];
const rcdLink = [toroid(62), p('M36 62H44V40H24', 'dash', true), { k: 't', x: 48, y: 66, s: 'IΔn', side: true, acc: true } as SymPrim];

export const SYMBOLS = {
  // Switching & protective devices
  cb: { label: 'Circuit breaker (MCB / MCCB)', iec: '07-13-05', prims: CB },
  acb: { label: 'Air circuit breaker, withdrawable', iec: '07-13-05', prims: [...CB, p('M24 18L30 14L36 18M24 62L30 66L36 62', 'ln', true), side('ACB')] },
  nonauto: { label: 'Non-automatic breaker', iec: '07-13-05', prims: [...CB, p('M25 21H35', 'ln', true)] },
  isolator: { label: 'Disconnector / isolator', iec: '07-13-06', prims: ISOL },
  swdisc: { label: 'Switch-disconnector', iec: '07-13-08', prims: [...ISOL, c(30, 31, 2, 'open')] },
  contactor: { label: 'Contactor', iec: '07-13-02', prims: [p(`${CON} ${BLADE}`), p('M26 28A4 4 0 0 1 34 28', 'open'), side('KM')] },
  fuse: { label: 'Fuse', iec: '07-21-01', prims: [r(24, 24, 12, 32), p('M30 24V56')] },
  fusesw: { label: 'Fuse switch-disconnector', iec: '07-21-07', prims: [...ISOL, p('M18.1 35.8L24.6 33.2L29.9 46.2L23.4 48.8Z', 'open')] },
  rcbo: { label: 'RCBO (breaker with RCD)', iec: '07-13-05 + 07-20', prims: [...CB, ...rcdLink] },
  rccb: { label: 'RCCB / ELCB', iec: '07-13-08 + 07-20', prims: [...ISOL, ...rcdLink] },
  rcd: { label: 'Earth leakage protection (RCD)', iec: '07-20', prims: [p('M30 24V56'), { k: 'e', cx: 30, cy: 40, rx: 6, ry: 3, c: 'open' }] },
  shunt: { label: 'Breaker with shunt trip', iec: '07-13-05 + 07-15', prims: [...CB, p('M25 42H48', 'dash', true), r(48, 36, 12, 12, 'sym', true), { k: 't', x: 54, y: 42, s: 'ST', acc: true }] },
  ats: { label: 'Changeover / ATS', iec: '07-02-05', prims: [p('M18 24V30M42 24V30M30 56L19 31'), side('ATS')] },
  // Panels and boards, drawn as one box without downstream detail
  'p-mdb': { label: 'LV main panel (MDB)', iec: '11-15', prims: panel('MDB') },
  'p-smdb': { label: 'Sub-main board (SMDB)', iec: '11-15', prims: panel('SMDB') },
  'p-db': { label: 'Distribution board (DB)', iec: '11-15', prims: panel('DB') },
  'p-edb': { label: 'Emergency DB (EDB)', iec: '11-15', prims: panel('EDB') },
  'p-mcc': { label: 'Motor control centre (MCC)', iec: '11-15', prims: panel('MCC') },
  'p-apfc': { label: 'Capacitor panel (APFC)', iec: '11-15 + 04-02-01', prims: panel('APFC') },
  // Motor starters & relays
  dol: { label: 'DOL starter', iec: '11-15', prims: box('DOL') },
  sd: { label: 'Star-delta starter', iec: '11-15', prims: box('Y-Δ') },
  ss: { label: 'Soft starter', iec: '06-14', prims: [r(16, 24, 28, 32), p('M20 50H26L34 30H40'), side('SS')] },
  vfd: { label: 'Variable frequency drive (VFD)', iec: '06-14', prims: [r(16, 24, 28, 32), p('M16 56L44 24'), t(23, 33, 'f1'), t(37, 49, 'f2'), side('VFD')] },
  ol: { label: 'Thermal overload relay', iec: '07-15-21', prims: [r(16, 24, 28, 32), p('M30 24V32H24V48H30V56'), side('OL')] },
  uvr: { label: 'Undervoltage relay', iec: '07-15', prims: [...box('U<'), ...SIGNAL('UVR')] },
  pmr: { label: 'Phase monitoring relay (phase failure)', iec: '07-15', prims: [...box('PMR'), ...SIGNAL('trip')] },
  pfrelay: { label: 'Power factor relay', iec: '07-15', prims: box('PFR') },
  // Sources & conversion
  tx: { label: 'Transformer, two-winding', iec: '06-09-01', prims: [c(30, 33, 9, 'open'), c(30, 47, 9, 'open')] },
  gen: { label: 'Generator, three-phase', iec: '06-04-01', prims: instrument('G', '3~') },
  incomer: { label: 'Authority supply', iec: '—', prims: [p('M16 40H44M30 40V56'), p('M18 36L30 24L42 36Z', 'open')] },
  pv: { label: 'Solar PV with inverter', iec: '04-26 + 06-14', prims: [r(16, 24, 28, 32), p('M16 56L44 24'), t(23, 33, '='), t(37, 49, '~'), p('M6 12L13 19M10 19H13V16M12 6L19 13M16 13H19V10', 'ln', true)] },
  // Metering, monitoring & interfaces
  ct: { label: 'Current transformer', iec: '06-09-11', prims: [p('M30 24V56M36 40H44'), c(30, 40, 6, 'open'), side('CT')] },
  vt: { label: 'Voltage transformer', iec: '06-09-01', prims: [c(30, 33, 9, 'open'), c(30, 47, 9, 'open'), side('VT')] },
  voltmeter: { label: 'Voltmeter', iec: '08-02-01', prims: instrument('V') },
  ammeter: { label: 'Ammeter', iec: '08-02-01', prims: instrument('A') },
  kwh: { label: 'kWh meter', iec: '08-04-03', prims: box('kWh') },
  pmu: { label: 'Power monitoring unit (PMU)', iec: '08-04', prims: [...box('PMU'), ...SIGNAL('RS485')] },
  bms: { label: 'BMS interface', iec: '—', prims: [...box('BMS'), ...SIGNAL('BMS')] },
  faim: { label: 'Fire alarm interface module', iec: '—', prims: [...box('FAIM'), ...SIGNAL('FA')] },
  elr: { label: 'Earth leakage relay with CBCT', iec: '07-20 + 06-09-11', prims: [p('M30 24V56'), toroid(30), p('M36 30H48V36', 'dash', true), r(38, 36, 20, 14, 'sym', true), { k: 't', x: 48, y: 43, s: 'ELR', acc: true }] },
  lamp: { label: 'Indication lamp', iec: '08-10-01', prims: [p('M30 24V56M30 40H44'), c(50, 40, 6, 'sym', true), p('M46 36L54 44M54 36L46 44', 'ln', true)] },
  spd: { label: 'Surge protective device (SPD)', iec: '07-22-03', prims: [r(22, 24, 16, 32), p('M30 28V52M27 48L30 52L33 48'), p('M30 56V60', 'ln', true), EARTH(60, true)] },
  earth: { label: 'Earth', iec: '02-15-01', prims: [p('M30 24V40'), EARTH(40)] },
  pe: { label: 'Protective earth (PE)', iec: '02-15-03', prims: [c(30, 40, 14, 'open'), p('M30 24V36M22 36H38M25 40H35M28 44H32')] },
  // Distribution & loads
  busbar: { label: 'Busbar', iec: '03-01', prims: [p('M16 40H44', 'thick')] },
  motor: { label: 'Motor, three-phase', iec: '06-04-01', prims: instrument('M', '3~') },
  'motor-fp': { label: 'Fire pump motor', iec: '06-04-01', prims: instrument('M', 'FP') },
  lighting: { label: 'Lighting', iec: '08-10-01', prims: [p('M30 24V26'), c(30, 40, 14), p('M20.1 30.1L39.9 49.9M39.9 30.1L20.1 49.9')] },
  socket: { label: 'Socket outlets', iec: '11-13-01', prims: [p('M30 24V32M16 32H44'), p('M16 32A14 14 0 0 0 44 32', 'open')] },
  capacitor: { label: 'Capacitor bank', iec: '04-02-01', prims: [p('M30 24V36M30 44V48'), p('M16 36H44M16 44H44', 'thick'), EARTH(48)] },
  'eq-ac': { label: 'HVAC equipment (AC)', iec: '02-01-01', prims: box('AC') },
  'eq-ev': { label: 'EV charger (EV)', iec: '02-01-01', prims: box('EV') },
  'eq-it': { label: 'IT / data (IT)', iec: '02-01-01', prims: box('IT') },
  'eq-l': { label: 'Other load (L)', iec: '02-01-01', prims: box('L') },
  existing: { label: 'Existing equipment', iec: '—', prims: [r(16, 24, 28, 32, 'dash'), t(30, 40, 'EX', true)] }
} satisfies Record<string, SymDef>;

export type SymbolId = keyof typeof SYMBOLS;
export const SYMBOL_IDS = Object.keys(SYMBOLS) as SymbolId[];

/** Scale per drawing role: switching devices fill the 16-unit breaker slot,
 * loads the 28-unit load slot; the legend draws every symbol at one size. */
export const SYM_SCALE = { device: 0.5, load: 0.875, legend: 0.6 } as const;

const n = (v: number) => +v.toFixed(2);

/** A symbol path (absolute M L H V A Z only) mapped to drawing coordinates. */
export function placePath(d: string, map: (u: number, v: number) => [number, number], s: number, mirror = false): string {
  const tok = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let cmd = '', u = 0, v = 0, i = 0;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) {
      cmd = tok[i++];
      if (!'MLHVAZ'.includes(cmd)) throw new Error(`Unsupported symbol path command: ${cmd}`);
      out.push(cmd);
      continue;
    }
    if (cmd === 'M' || cmd === 'L') { u = num(); v = num(); out.push(map(u, v).map(n).join(' ')); }
    else if (cmd === 'H') { u = num(); out.push(String(n(map(u, v)[0]))); }
    else if (cmd === 'V') { v = num(); out.push(String(n(map(u, v)[1]))); }
    else if (cmd === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      u = num(); v = num();
      out.push(`${n(rx * s)} ${n(ry * s)} ${rot} ${large} ${mirror ? 1 - sweep : sweep} ${map(u, v).map(n).join(' ')}`);
    } else throw new Error(`Symbol path value without a command: ${d}`);
  }
  return out.join(' ');
}

const CLASS: Record<SymCls, string> = { ln: 'ln', sym: 'sym', open: 'sym-open', fill: 'sym-fill', thick: 'ln thick', dash: 'ln' };
const DASH = { strokeDasharray: '2 1.5' };

/** Draw a library symbol with its body centre at (x, y). `flip` mirrors it
 * top to bottom, for a device drawn upward from a busbar. */
export function Sym({ id, x, y, s = 1, labels = false, flip = false }: { id: SymbolId; x: number; y: number; s?: number; labels?: boolean; flip?: boolean }) {
  const X = (u: number) => n(x + (u - SYM_CX) * s);
  const Y = (v: number) => n(y + (v - SYM_CY) * (flip ? -s : s));
  const map = (u: number, v: number): [number, number] => [X(u), Y(v)];
  return (
    <g className="iec">
      {(SYMBOLS[id].prims as SymPrim[]).map((q, i) => {
        const cls = q.k === 't' ? '' : CLASS[q.c ?? (q.k === 'p' ? 'ln' : 'sym')];
        const style = q.k !== 't' && q.c === 'dash' ? DASH : undefined;
        switch (q.k) {
          case 'p': return <path key={i} d={placePath(q.d, map, s, flip)} className={cls} style={style} />;
          case 'c': return <circle key={i} cx={X(q.cx)} cy={Y(q.cy)} r={n(q.r * s)} className={cls} style={style} />;
          case 'e': return <ellipse key={i} cx={X(q.cx)} cy={Y(q.cy)} rx={n(q.rx * s)} ry={n(q.ry * s)} className={cls} style={style} />;
          case 'r': return <rect key={i} x={X(q.x)} y={flip ? Y(q.y + q.h) : Y(q.y)} width={n(q.w * s)} height={n(q.h * s)} className={cls} style={style} />;
          case 't':
            if (q.side && !labels) return null;
            return <text key={i} x={X(q.x)} y={Y(q.y) + (q.b ? 4 : 3)} textAnchor={q.side ? 'start' : 'middle'} className={q.b ? 'iec-t b' : 'iec-t s'}>{q.s}</text>;
        }
      })}
    </g>
  );
}
