import type { Feeder, LoadType, Project, StarterType } from '../types';
import { breakerTypeOf } from '../calc/earthing';
import { isMotor } from '../calc/motor';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { cableTypeDef, cableTypeOf, labelCode } from '../model/cableTypes';
import { DEFAULT_CABLE_TYPE, incomerDeviceOf } from '../types';
import { Sym, SYM_SCALE, SYMBOLS, type SymbolId } from './symbolLibrary';
import { sldDevices } from './sldDevices';
import { boxedBoardIds, hiddenBoardIds, panelSymbolOf } from './panelBox';

/** IEC 60617 symbols for the single line diagram, drawn with the diagram's
 * own classes (.ln lines, .sym filled shapes) so they follow the theme and
 * print in black. Each symbol is placed by its connection points. */

export type SymbolStyle = 'iec' | 'simple';
export type SwitchKind = 'breaker' | 'acb' | 'isolator' | 'nonauto';

export const switchKindOf = (f: Feeder): SwitchKind =>
  f.device === 'ISOL' ? 'isolator' : f.device === 'ACB' || breakerTypeOf(f) === 'ACB' ? 'acb' : 'breaker';

/** Switching device in a vertical line from (x, y) to (x, y + 16), drawn
 * from the symbol library: circuit breaker (07-13-05), withdrawable ACB (with
 * the drawout marks), non-automatic breaker (isolating bar above the ×),
 * switch-disconnector (07-13-06 bar on the fixed contact). */
export function SwitchSym({ x, y, kind }: { x: number; y: number; kind: SwitchKind }) {
  return <Sym id={kind === 'breaker' ? 'cb' : kind} x={x} y={y + 8} s={SYM_SCALE.device} />;
}

export type SwitchSymbol = 'cb' | 'acb' | 'nonauto' | 'isolator' | 'rcbo' | 'rccb';
const SWITCH_SYM: Record<SwitchKind, SwitchSymbol> = { breaker: 'cb', acb: 'acb', isolator: 'isolator', nonauto: 'nonauto' };

/** Symbol in a feeder's switching slot: an RCBO (breaker) or RCCB (switch)
 * when the earth leakage protection is part of it, else the plain switch.
 * An ACB keeps its own symbol; an ELR, or an RCCB after a breaker, stays a
 * separate boxed device. */
export function feederSwitchOf(f: Feeder): SwitchSymbol {
  const kind = switchKindOf(f);
  const elcb = sldDevices(f).elcb?.label;
  if (!elcb || elcb === 'ELR' || kind === 'acb' || kind === 'nonauto') return SWITCH_SYM[kind];
  if (kind === 'breaker') return elcb === 'RCCB' ? 'cb' : 'rcbo';
  return elcb === 'RCBO' ? 'rcbo' : 'rccb';
}

/** True when the feeder's switching symbol already shows its earth leakage protection. */
export const rcdInSwitch = (f: Feeder) => ['rcbo', 'rccb'].includes(feederSwitchOf(f));

/** A feeder's switching device in the 16-unit slot from (x, y) to (x, y + 16). */
export function FeederSwitchSym({ x, y, f }: { x: number; y: number; f: Feeder }) {
  return <Sym id={feederSwitchOf(f)} x={x} y={y + 8} s={SYM_SCALE.device} />;
}

const STARTER_SYM: Record<StarterType, SymbolId> = { DOL: 'dol', SD: 'sd', SS: 'ss', VFD: 'vfd' };

/** Library symbol for a motor starter. */
export const starterSymbolOf = (s: StarterType): SymbolId => STARTER_SYM[s];

const EQUIP_SYM: Partial<Record<LoadType, SymbolId>> = { lighting: 'lighting', sockets: 'socket', capacitor: 'capacitor', pv: 'pv', hvac: 'eq-ac', ev: 'eq-ev', it: 'eq-it' };

/** Library symbol for a load. */
export const loadSymbolOf = (type: LoadType, motor?: boolean, fireFighting?: boolean): SymbolId =>
  motor || type === 'motor' || type === 'fire-pump' ? (fireFighting ? 'motor-fp' : 'motor') : EQUIP_SYM[type] ?? 'eq-l';

/** Load symbol centred on (x, y), 28 units tall. */
export function LoadSym({ x, y, type, motor, fireFighting, s = SYM_SCALE.load }: { x: number; y: number; type: LoadType; motor?: boolean; fireFighting?: boolean; s?: number }) {
  return <Sym id={loadSymbolOf(type, motor, fireFighting)} x={x} y={y} s={s} />;
}

/** Poles as written on SLDs: SP+N, TP, TP+N. */
export const polesText = (f: Feeder) => (f.cores === 2 ? 'SP+N' : f.cores === 3 ? 'TP' : 'TP+N');

// ---- Legend ----------------------------------------------------------------

export interface LegendEntry { key: string; label: string; draw: (x: number, y: number) => JSX.Element; }

/** The symbols the drawing uses, for its legend. */
export function legendEntries(project: Project): LegendEntry[] {
  const hidden = hiddenBoardIds(project);
  const drawn = project.feeders.filter((f) => !isScheduleCircuit(f) && !hidden.has(f.boardId));
  const shown = project.boards.filter((b) => !hidden.has(b.id));
  const loads = drawn.filter((f) => !f.feedsBoardId);
  const types = new Set<string>(loads.map((f) => (isMotor(f) ? 'motor' : f.loadType ?? (f.generation ? 'pv' : 'general'))));
  const has = (k: SwitchKind) => drawn.some((f) => switchKindOf(f) === k);
  const out: LegendEntry[] = [];
  const add = (key: string, label: string, draw: LegendEntry['draw']) => out.push({ key, label, draw });
  if (shown.some((b) => b.sourceKva)) add('tx', 'Transformer', (x, y) => <Sym id="tx" x={x} y={y} s={SYM_SCALE.legend} />);
  if (shown.some((b) => b.standby)) add('gen', 'Standby generator', (x, y) => <Sym id="gen" x={x} y={y} s={SYM_SCALE.legend} />);
  if (shown.some((b) => b.standby && b.standby.changeover !== 'ACB')) add('ats', 'Automatic transfer switch (ATS), 4P switched neutral', (x, y) => <Sym id="ats" x={x} y={y} s={SYM_SCALE.legend} />);
  add('bus', 'Busbar', (x, y) => <line x1={x - 12} y1={y} x2={x + 12} y2={y} className="bus" />);
  if (shown.some((b) => b.existing) || project.feeders.some((f) => f.existing)) add('existing', 'EXISTING: already installed, not in the BOQ', (x, y) => (
    <line x1={x - 12} y1={y} x2={x + 12} y2={y} className="ln" style={{ strokeDasharray: '5 3' }} />
  ));
  if (drawn.length) add('cable', `Cable ${cableTypeDef(DEFAULT_CABLE_TYPE).label.replace(/ \(.*\)$/, '')} unless marked`, (x, y) => <line x1={x} y1={y - 10} x2={x} y2={y + 10} className="ln" />);
  if (drawn.some((f) => cableTypeOf(project, f).fireRated)) add('fr', 'Fire-rated cable (FR, MICC)', (x, y) => <line x1={x} y1={y - 10} x2={x} y2={y + 10} className="ln fr" />);
  const others = [...new Set(drawn.map((f) => labelCode(project, f)).filter((c) => c && c !== 'FR' && c !== 'MICC'))];
  if (others.length) add('ctype', `Marked cables: ${others.join(', ')}`, (x, y) => <text x={x} y={y + 3} textAnchor="middle" className="iec-t s">code</text>);
  if (has('breaker')) add('cb', 'Circuit breaker (MCB / MCCB)', (x, y) => <Sym id="cb" x={x} y={y} s={SYM_SCALE.legend} />);
  if (has('acb')) add('acb', 'Air circuit breaker, withdrawable', (x, y) => <Sym id="acb" x={x} y={y} s={SYM_SCALE.legend} />);
  if (shown.some((b) => !b.standby && incomerDeviceOf(b) === 'MCCB-NA')) add('nonauto', 'Non-automatic breaker (incomer isolation)', (x, y) => <Sym id="nonauto" x={x} y={y} s={SYM_SCALE.legend} />);
  if (has('isolator')) add('isol', 'Switch-disconnector', (x, y) => <Sym id="isolator" x={x} y={y} s={SYM_SCALE.legend} />);
  const switches = new Set(drawn.map(feederSwitchOf));
  if (switches.has('rcbo')) add('rcbo', 'RCBO: breaker with earth leakage protection', (x, y) => <Sym id="rcbo" x={x} y={y} s={SYM_SCALE.legend} />);
  if (switches.has('rccb')) add('rccb', 'RCCB / ELCB: switch with earth leakage protection', (x, y) => <Sym id="rccb" x={x} y={y} s={SYM_SCALE.legend} />);
  if (drawn.some((f) => sldDevices(f).elcb && !rcdInSwitch(f))) add('rcd', 'Earth leakage protection (RCD / ELR toroid), device named beside it', (x, y) => <Sym id="rcd" x={x} y={y} s={SYM_SCALE.legend} />);
  if (loads.some((f) => sldDevices(f).extras.includes('UVR'))) add('uvr', 'Undervoltage relay (UVR)', (x, y) => <Sym id="uvr" x={x} y={y} s={SYM_SCALE.legend} />);
  const prot = shown.map((b) => b.protection);
  if (drawn.some((f) => f.kwhMeter === 'CT') || shown.some((b) => b.protection?.ctRatio || b.supply?.ctRatio)) add('ct', 'Current transformer', (x, y) => <Sym id="ct" x={x} y={y} s={SYM_SCALE.legend} />);
  const relays = [...new Set(prot.flatMap((p) => p?.relays ?? []))];
  if (relays.length) add('relay', `Protection relays: ${relays.join(', ')}`, (x, y) => (
    <g className="iec"><circle cx={x - 8} cy={y} r="4.5" className="sym-ln" /><line x1={x - 3.5} y1={y} x2={x + 6} y2={y} className="ln" style={{ strokeDasharray: '2 1.5' }} /><text x={x + 8} y={y + 3} className="iec-t s">{relays[0]}</text></g>
  ));
  const changeover = shown.filter((b) => b.standby?.changeover === 'ACB');
  if (changeover.length) {
    add('emi', 'Electro-mechanical interlock (mains / generator)', (x, y) => (
      <g className="iec"><path d={`M${x - 14} ${y + 5} L${x - 8} ${y - 3} H${x + 8} L${x + 14} ${y + 5}`} className="ln" /><path d={`M${x - 4} ${y - 3} l4 4 l4 -4 z`} className="sym-open" /></g>
    ));
    add('trip', 'Breaker trip functions: OC overcurrent, SC short circuit, EF earth fault', (x, y) => (
      <g className="iec"><rect x={x - 10} y={y - 6} width="20" height="12" className="sym" /><text x={x} y={y + 3} textAnchor="middle" className="iec-t s">OC</text></g>
    ));
  }
  if (shown.some((b) => b.pmu)) add('pmu', 'Power meter (PMU) with link to BMS', (x, y) => <Sym id="pmu" x={x} y={y} s={SYM_SCALE.legend} />);
  if (prot.some((p) => p?.apfc)) add('pfr', 'Power factor relay (PFR), CT from the incomer', (x, y) => <Sym id="pfrelay" x={x} y={y} s={SYM_SCALE.legend} />);
  const main = (b: { upstreamId?: string }) => !b.upstreamId;
  if (shown.some((b) => b.instruments ?? main(b))) {
    add('am', 'Ammeter (A) / voltmeter (V), selector switch (SS)', (x, y) => <g><Sym id="ammeter" x={x - 10} y={y} s={SYM_SCALE.legend} /><Sym id="voltmeter" x={x + 10} y={y} s={SYM_SCALE.legend} /></g>);
    add('lamps', 'Phase indicating lamps R, Y, B', (x, y) => <Sym id="lamp" x={x - 6} y={y} s={SYM_SCALE.legend} />);
  }
  if (shown.some((b) => b.earthing?.show ?? main(b))) add('pit', 'Earth pit with inspection cover', (x, y) => (
    <g className="iec"><rect x={x - 7} y={y - 11} width="14" height="9" className="sym" /><line x1={x} y1={y - 6} x2={x} y2={y + 6} className="ln" /><path d={`M${x - 7} ${y + 6} h14 M${x - 4.5} ${y + 9} h9 M${x - 2} ${y + 12} h4`} className="ln" /></g>
  ));
  if (drawn.some((f) => f.kwhMeter)) add('kwh', 'kWh meter', (x, y) => <Sym id="kwh" x={x} y={y} s={SYM_SCALE.legend} />);
  if (drawn.some((f) => f.localIsolator)) add('iso', 'Local isolator at the equipment', (x, y) => <Sym id="isolator" x={x} y={y} s={SYM_SCALE.legend} />);
  if (shown.some((b) => b.spd)) add('spd', 'Surge protection device (SPD)', (x, y) => <Sym id="spd" x={x} y={y} s={SYM_SCALE.legend} />);
  const starters = new Set(loads.map((f) => sldDevices(f).starterType).filter((t): t is StarterType => !!t));
  for (const t of ['DOL', 'SD', 'SS', 'VFD'] as const) if (starters.has(t)) add(starterSymbolOf(t), SYMBOLS[starterSymbolOf(t)].label, (x, y) => <Sym id={starterSymbolOf(t)} x={x} y={y} s={SYM_SCALE.legend} />);
  if (types.has('motor') || types.has('fire-pump')) add('m', 'Motor (FP = fire pump)', (x, y) => <LoadSym x={x} y={y} type="motor" s={SYM_SCALE.legend} />);
  if (types.has('lighting')) add('lamp', 'Lighting', (x, y) => <LoadSym x={x} y={y} type="lighting" s={SYM_SCALE.legend} />);
  if (types.has('sockets')) add('so', 'Socket outlets', (x, y) => <LoadSym x={x} y={y} type="sockets" s={SYM_SCALE.legend} />);
  if (types.has('capacitor')) add('cap', 'Capacitor bank', (x, y) => <LoadSym x={x} y={y} type="capacitor" s={SYM_SCALE.legend} />);
  if (types.has('pv')) add('pv', 'Solar PV / generation', (x, y) => <LoadSym x={x} y={y} type="pv" s={SYM_SCALE.legend} />);
  const boxed = boxedBoardIds(project);
  const panels = new Set(project.boards.filter((b) => boxed.has(b.id)).map((b) => panelSymbolOf(project, b)!));
  for (const id of panels) add(id, `${SYMBOLS[id].label}, drawn as one box`, (x, y) => <Sym id={id} x={x} y={y} s={SYM_SCALE.legend} />);
  const EQUIP: [LoadType, string][] = [['hvac', 'HVAC equipment (AC)'], ['ev', 'EV charger (EV)'], ['it', 'IT / data (IT)'], ['general', 'Other load (L)']];
  for (const [t, label] of EQUIP) if (types.has(t)) add(`eq-${t}`, label, (x, y) => <LoadSym x={x} y={y} type={t} s={SYM_SCALE.legend} />);
  return out;
}

export const LEGEND_W = 250;
export const LEGEND_ROW = 30;
/** Symbol column centre and label start inside the legend box. */
export const LEGEND_SYM_X = 34;
export const LEGEND_TEXT_X = 64;
/** Legend box width: fits the longest label (≈ 6 px per character). */
export const legendWidth = (entries: LegendEntry[]) => Math.max(LEGEND_W, Math.ceil(LEGEND_TEXT_X + 14 + Math.max(0, ...entries.map((e) => e.label.length)) * 6.1));
