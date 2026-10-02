import type { Feeder, LoadType, Project } from '../types';
import { breakerTypeOf } from '../calc/earthing';
import { isMotor } from '../calc/motor';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { cableTypeDef, cableTypeOf, labelCode } from '../model/cableTypes';
import { DEFAULT_CABLE_TYPE } from '../types';

/** IEC 60617 symbols for the single line diagram, drawn with the diagram's
 * own classes (.ln lines, .sym filled shapes) so they follow the theme and
 * print in black. Each symbol is placed by its connection points. */

export type SymbolStyle = 'iec' | 'simple';
export type SwitchKind = 'breaker' | 'acb' | 'isolator';

export const switchKindOf = (f: Feeder): SwitchKind =>
  f.device === 'ISOL' ? 'isolator' : breakerTypeOf(f) === 'ACB' ? 'acb' : 'breaker';

/** Switching device in a vertical line from (x, y) to (x, y + 16):
 * circuit breaker (07-13-05: contact with ×), withdrawable ACB (with the
 * drawout marks), switch-disconnector (07-13-08: contact with bar). */
export function SwitchSym({ x, y, kind }: { x: number; y: number; kind: SwitchKind }) {
  return (
    <g className="iec">
      <line x1={x} y1={y} x2={x} y2={y + 3} className="ln" />
      {kind === 'isolator'
        ? <line x1={x - 4} y1={y + 3} x2={x + 4} y2={y + 3} className="ln" />
        : <path d={`M${x - 3} ${y} l6 6 M${x + 3} ${y} l-6 6`} className="ln" />}
      <line x1={x} y1={y + 16} x2={x - 7} y2={y + 5} className="ln" />
      {kind === 'acb' && (
        <>
          <path d={`M${x - 4} ${y - 5} l4 -3 l4 3`} className="ln" />
          <path d={`M${x - 4} ${y + 20} l4 3 l4 -3`} className="ln" />
        </>
      )}
    </g>
  );
}

/** Load symbol centred on (x, y), about 30 units across. */
export function LoadSym({ x, y, type, motor, fireFighting }: { x: number; y: number; type: LoadType; motor?: boolean; fireFighting?: boolean }) {
  if (motor || type === 'motor' || type === 'fire-pump') {
    return (
      <g className="iec">
        <circle cx={x} cy={y} r="14" className="sym" />
        <text x={x} y={y + 2} textAnchor="middle" className="iec-t b">M</text>
        <text x={x} y={y + 11} textAnchor="middle" className="iec-t s">{fireFighting ? 'FP' : '3~'}</text>
      </g>
    );
  }
  switch (type) {
    case 'lighting':
      return (
        <g className="iec">
          <line x1={x} y1={y - 18} x2={x} y2={y - 10} className="ln" />
          <circle cx={x} cy={y} r="10" className="sym" />
          <path d={`M${x - 7} ${y - 7} l14 14 M${x + 7} ${y - 7} l-14 14`} className="ln" />
        </g>
      );
    case 'sockets':
      return (
        <g className="iec">
          <line x1={x} y1={y - 18} x2={x} y2={y - 2} className="ln" />
          <path d={`M${x - 11} ${y - 2} a11 11 0 0 0 22 0`} className="sym-open" />
          <line x1={x - 11} y1={y - 2} x2={x + 11} y2={y - 2} className="ln" />
        </g>
      );
    case 'capacitor':
      return (
        <g className="iec">
          <line x1={x} y1={y - 18} x2={x} y2={y - 3} className="ln" />
          <line x1={x - 11} y1={y - 3} x2={x + 11} y2={y - 3} className="ln thick" />
          <line x1={x - 11} y1={y + 3} x2={x + 11} y2={y + 3} className="ln thick" />
          <line x1={x} y1={y + 3} x2={x} y2={y + 9} className="ln" />
          <path d={`M${x - 6} ${y + 9} h12 M${x - 4} ${y + 12} h8 M${x - 2} ${y + 15} h4`} className="ln" />
        </g>
      );
    case 'pv':
      return (
        <g className="iec">
          <rect x={x - 13} y={y - 13} width="26" height="26" className="sym" />
          <line x1={x - 13} y1={y + 13} x2={x + 13} y2={y - 13} className="ln" />
          <path d={`M${x - 20} ${y - 20} l6 6 m-3 0 h3 v-3 M${x - 13} ${y - 22} l6 6 m-3 0 h3 v-3`} className="ln" />
          <text x={x - 6} y={y - 3} textAnchor="middle" className="iec-t s">=</text>
          <text x={x + 6} y={y + 9} textAnchor="middle" className="iec-t s">~</text>
        </g>
      );
    default: {
      // Equipment: a box with its code (IEC general equipment symbol).
      const code = type === 'hvac' ? 'AC' : type === 'ev' ? 'EV' : type === 'it' ? 'IT' : 'L';
      return (
        <g className="iec">
          <rect x={x - 14} y={y - 12} width="28" height="24" className="sym" />
          <text x={x} y={y + 4} textAnchor="middle" className="iec-t b">{code}</text>
        </g>
      );
    }
  }
}

/** Poles as written on SLDs: SP+N, TP, TP+N. */
export const polesText = (f: Feeder) => (f.cores === 2 ? 'SP+N' : f.cores === 3 ? 'TP' : 'TP+N');

// ---- Legend ----------------------------------------------------------------

export interface LegendEntry { key: string; label: string; draw: (x: number, y: number) => JSX.Element; }

/** The symbols the drawing uses, for its legend. */
export function legendEntries(project: Project): LegendEntry[] {
  const drawn = project.feeders.filter((f) => !isScheduleCircuit(f));
  const loads = drawn.filter((f) => !f.feedsBoardId);
  const types = new Set<string>(loads.map((f) => (isMotor(f) ? 'motor' : f.loadType ?? (f.generation ? 'pv' : 'general'))));
  const has = (k: SwitchKind) => drawn.some((f) => switchKindOf(f) === k);
  const out: LegendEntry[] = [];
  const add = (key: string, label: string, draw: LegendEntry['draw']) => out.push({ key, label, draw });
  if (project.boards.some((b) => b.sourceKva)) add('tx', 'Transformer', (x, y) => (
    <g className="iec"><circle cx={x} cy={y - 5} r="7" className="tr" /><circle cx={x} cy={y + 4} r="7" className="tr" /></g>
  ));
  if (project.boards.some((b) => b.standby)) add('gen', 'Standby generator with ATS', (x, y) => (
    <g className="iec"><circle cx={x} cy={y} r="9" className="sym" /><text x={x} y={y + 4} textAnchor="middle" className="iec-t b">G</text></g>
  ));
  add('bus', 'Busbar', (x, y) => <line x1={x - 12} y1={y} x2={x + 12} y2={y} className="bus" />);
  if (drawn.length) add('cable', `Cable ${cableTypeDef(DEFAULT_CABLE_TYPE).label.replace(/ \(.*\)$/, '')} unless marked`, (x, y) => <line x1={x} y1={y - 10} x2={x} y2={y + 10} className="ln" />);
  if (drawn.some((f) => cableTypeOf(project, f).fireRated)) add('fr', 'Fire-rated cable (FR, MICC)', (x, y) => <line x1={x} y1={y - 10} x2={x} y2={y + 10} className="ln fr" />);
  const others = [...new Set(drawn.map((f) => labelCode(project, f)).filter((c) => c && c !== 'FR' && c !== 'MICC'))];
  if (others.length) add('ctype', `Marked cables: ${others.join(', ')}`, (x, y) => <text x={x} y={y + 3} textAnchor="middle" className="iec-t s">code</text>);
  if (has('breaker')) add('cb', 'Circuit breaker (MCB / MCCB)', (x, y) => <SwitchSym x={x} y={y - 8} kind="breaker" />);
  if (has('acb')) add('acb', 'Air circuit breaker, withdrawable', (x, y) => <SwitchSym x={x} y={y - 8} kind="acb" />);
  if (has('isolator')) add('isol', 'Switch-disconnector', (x, y) => <SwitchSym x={x} y={y - 8} kind="isolator" />);
  if (drawn.some((f) => f.rcdMa)) add('rcd', 'Earth leakage protection (RCD)', (x, y) => (
    <g className="iec"><line x1={x} y1={y - 9} x2={x} y2={y + 9} className="ln" /><ellipse cx={x} cy={y} rx="7" ry="3.2" className="sym-ln" /></g>
  ));
  const prot = project.boards.map((b) => b.protection);
  if (drawn.some((f) => f.kwhMeter === 'CT') || project.boards.some((b) => b.protection?.ctRatio || b.supply?.ctRatio)) add('ct', 'Current transformer', (x, y) => (
    <g className="iec"><line x1={x} y1={y - 9} x2={x} y2={y + 9} className="ln" /><circle cx={x} cy={y} r="4.5" className="sym-ln" /></g>
  ));
  const relays = [...new Set(prot.flatMap((p) => p?.relays ?? []))];
  if (relays.length) add('relay', `Protection relays: ${relays.join(', ')}`, (x, y) => (
    <g className="iec"><circle cx={x - 8} cy={y} r="4.5" className="sym-ln" /><line x1={x - 3.5} y1={y} x2={x + 6} y2={y} className="ln" style={{ strokeDasharray: '2 1.5' }} /><text x={x + 8} y={y + 3} className="iec-t s">{relays[0]}</text></g>
  ));
  if (project.boards.some((b) => b.standby?.changeover === 'ACB')) add('il', 'Mechanical / electrical interlock (IL)', (x, y) => <line x1={x - 12} y1={y} x2={x + 12} y2={y} className="ln interlock" />);
  if (prot.some((p) => p?.apfc)) add('pfr', 'Power factor relay (PFR), CT from the incomer', (x, y) => (
    <g className="iec"><rect x={x - 9} y={y - 5.5} width="18" height="11" rx="1" className="sym" /><text x={x} y={y + 3} textAnchor="middle" className="iec-t s">PFR</text></g>
  ));
  const main = (b: { upstreamId?: string }) => !b.upstreamId;
  if (project.boards.some((b) => b.instruments ?? main(b))) {
    add('am', 'Ammeter (A) / voltmeter (V), selector S/S', (x, y) => (
      <g className="iec"><rect x={x - 17} y={y - 7} width="14" height="14" className="sym" /><text x={x - 10} y={y + 4} textAnchor="middle" className="iec-t b">A</text><rect x={x + 3} y={y - 7} width="14" height="14" className="sym" /><text x={x + 10} y={y + 4} textAnchor="middle" className="iec-t b">V</text></g>
    ));
    add('lamps', 'Indicating lamps R, Y, B', (x, y) => (
      <g className="iec">{['R', 'Y', 'B'].map((p, i) => <g key={p}><circle cx={x - 13 + i * 13} cy={y} r="5.5" className="sym" /><text x={x - 13 + i * 13} y={y + 3} textAnchor="middle" className="iec-t s">{p}</text></g>)}</g>
    ));
  }
  if (project.boards.some((b) => b.earthing?.show ?? main(b))) add('pit', 'Earth pit with inspection cover', (x, y) => (
    <g className="iec"><rect x={x - 7} y={y - 11} width="14" height="9" className="sym" /><line x1={x} y1={y - 6} x2={x} y2={y + 6} className="ln" /><path d={`M${x - 7} ${y + 6} h14 M${x - 4.5} ${y + 9} h9 M${x - 2} ${y + 12} h4`} className="ln" /></g>
  ));
  if (drawn.some((f) => f.kwhMeter)) add('kwh', 'kWh meter', (x, y) => (
    <g className="iec"><rect x={x - 12} y={y - 6} width="24" height="12" rx="2" className="sym" /><text x={x} y={y + 3} textAnchor="middle" className="iec-t b">kWh</text></g>
  ));
  if (drawn.some((f) => f.localIsolator)) add('iso', 'Local isolator at the equipment', (x, y) => <SwitchSym x={x} y={y - 8} kind="isolator" />);
  if (project.boards.some((b) => b.spd)) add('spd', 'Surge protection device (SPD)', (x, y) => (
    <g className="iec"><rect x={x - 6} y={y - 9} width="12" height="14" className="sym" /><path d={`M${x + 2} ${y - 7} l-3 5 h3 l-3 5`} className="sym-ln" /><path d={`M${x - 6} ${y + 8} h12 M${x - 4} ${y + 11} h8`} className="ln" /></g>
  ));
  if (types.has('motor') || types.has('fire-pump')) add('m', 'Motor (FP = fire pump)', (x, y) => <LoadSym x={x} y={y} type="motor" />);
  if (types.has('lighting')) add('lamp', 'Lighting', (x, y) => <LoadSym x={x} y={y + 5} type="lighting" />);
  if (types.has('sockets')) add('so', 'Socket outlets', (x, y) => <LoadSym x={x} y={y + 7} type="sockets" />);
  if (types.has('capacitor')) add('cap', 'Capacitor bank', (x, y) => <LoadSym x={x} y={y + 2} type="capacitor" />);
  if (types.has('pv')) add('pv', 'Solar PV / generation', (x, y) => <LoadSym x={x} y={y + 6} type="pv" />);
  const EQUIP: [LoadType, string][] = [['hvac', 'HVAC equipment (AC)'], ['ev', 'EV charger (EV)'], ['it', 'IT / data (IT)'], ['general', 'Other load (L)']];
  for (const [t, label] of EQUIP) if (types.has(t)) add(`eq-${t}`, label, (x, y) => <LoadSym x={x} y={y} type={t} />);
  return out;
}

export const LEGEND_W = 250;
export const LEGEND_ROW = 30;
/** Symbol column centre and label start inside the legend box. */
export const LEGEND_SYM_X = 34;
export const LEGEND_TEXT_X = 64;
/** Legend box width: fits the longest label (≈ 6 px per character). */
export const legendWidth = (entries: LegendEntry[]) => Math.max(LEGEND_W, Math.ceil(LEGEND_TEXT_X + 14 + Math.max(0, ...entries.map((e) => e.label.length)) * 6.1));
