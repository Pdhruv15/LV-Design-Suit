import { memoized, networkOf } from './network';
import { recordedPQ } from '../model/existing';
import { switchedOnBoard } from './capSwitching';
import { DEFAULT_POINT_WATTS, LIGHTING_POINTS, POINT_TYPES, pointTemplateOf, settingsOf, type Board, type CircuitLoadItem, type Feeder, type LoadType, type Phase, type PointType, type Project } from '../types';

export const SINGLE_PHASES: ('R' | 'Y' | 'B')[] = ['R', 'Y', 'B'];
const PHASE_ORDER: Record<Phase, number> = { R: 0, Y: 1, B: 2, RYB: 3 };

export const STANDARD_ELCB_A = [25, 40, 63, 80, 100, 125];

export type PhaseKw = Record<'R' | 'Y' | 'B', number>;

export const isScheduleCircuit = (f: Feeder) => !!f.phase && !!f.way;

/** Circuit reference as on the DEWA schedule: phase + way (R1, Y1, B1…);
 * a 3-phase circuit is RYB + way. */
export function circuitRef(f: Feeder): string | undefined {
  if (!f.phase || !f.way) return undefined;
  return `${f.phase}${f.way}`;
}

export function pointWattsFor(board: Board | undefined): Record<PointType, number> {
  return { ...DEFAULT_POINT_WATTS, ...board?.pointWatts };
}

/** Column heading: the DB's own name for a spare column, else the form
 * template's heading, else the standard label. */
export function pointLabel(board: Board | undefined, t: PointType, project?: Pick<Project, 'pointTemplate'>): string {
  if (t === 'spare1' && board?.spareNames?.spare1) return board.spareNames.spare1;
  if (t === 'spare2' && board?.spareNames?.spare2) return board.spareNames.spare2;
  return (project && pointTemplateOf(project).labels?.[t]) ?? POINT_TYPES.find((p) => p.value === t)!.label;
}

export interface PointColumn {
  value: PointType;
  label: string;
  title: string;
}

/** Point columns of a DB's schedule: the project's form template, then any
 * other point type already used on the DB (so no entered point is hidden). */
export function pointColumns(project: Project, board: Board): PointColumn[] {
  const template = pointTemplateOf(project).columns;
  const used = new Set<PointType>();
  for (const f of scheduleCircuits(project, board.id)) {
    for (const [t, n] of Object.entries(f.points ?? {})) if ((n ?? 0) > 0) used.add(t as PointType);
  }
  const extra = POINT_TYPES.map((p) => p.value).filter((t) => used.has(t) && !template.includes(t));
  return [...template, ...extra].map((t) => ({ value: t, label: pointLabel(board, t, project), title: POINT_TYPES.find((p) => p.value === t)!.title }));
}

const isPointType = (t: unknown): t is PointType => POINT_TYPES.some((p) => p.value === t);

/** Clean circuit items: trimmed text, whole positive quantities, watts ≥ 0, known point types. */
export function normalizeLoadItems(items: CircuitLoadItem[] | undefined): CircuitLoadItem[] {
  const out: CircuitLoadItem[] = [];
  for (const it of items ?? []) {
    const quantity = Math.round(Number(it?.quantity));
    const unitWatts = Number(it?.unitWatts);
    if (!isPointType(it?.pointType) || !(quantity > 0) || !Number.isFinite(unitWatts) || unitWatts < 0) continue;
    const reference = typeof it.reference === 'string' ? it.reference.trim() : '';
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    out.push({ ...(reference && { reference }), name: name || reference, pointType: it.pointType, quantity, unitWatts });
  }
  return out;
}

/** Point types whose count and watts come from the circuit's items. */
export function itemizedTypes(f: Pick<Feeder, 'loadItems'>): Set<PointType> {
  return new Set(normalizeLoadItems(f.loadItems).map((it) => it.pointType));
}

/** The point counts with every itemized type set to the sum of its items' quantities. */
export function pointsWithItems(points: Feeder['points'], items: CircuitLoadItem[] | undefined): Feeder['points'] {
  const list = normalizeLoadItems(items);
  if (!list.length) return points;
  const out: Partial<Record<PointType, number>> = { ...points };
  for (const t of new Set(list.map((it) => it.pointType))) out[t] = list.filter((it) => it.pointType === t).reduce((s, it) => s + it.quantity, 0);
  return out;
}

/** Watts of each point type on a circuit: exact from its items where it has them, else count × WATT / UNIT. */
export function circuitWattsByType(f: Feeder, board: Board | undefined): Partial<Record<PointType, number>> {
  const w = pointWattsFor(board);
  const items = normalizeLoadItems(f.loadItems);
  const itemized = new Set(items.map((it) => it.pointType));
  const out: Partial<Record<PointType, number>> = {};
  for (const [t, n] of Object.entries(f.points ?? {})) if (!itemized.has(t as PointType)) out[t as PointType] = (n ?? 0) * (w[t as PointType] ?? 0);
  for (const it of items) out[it.pointType] = (out[it.pointType] ?? 0) + it.quantity * it.unitWatts;
  return out;
}

/** Connected load of a circuit in watts: Σ items × their own watts, plus
 * Σ other points × the DB's watts per point. */
export function circuitWatts(f: Feeder, board: Board | undefined): number {
  return Object.values(circuitWattsByType(f, board)).reduce((sum: number, v) => sum + (v ?? 0), 0);
}

/** WATT / UNIT printed for a column: the DB's value, plus each other wattage
 * mixed items use on its circuits (e.g. "10 / 20"); the DB's value is left out
 * when every circuit with that type is itemized. */
export function wattUnitText(project: Project, board: Board, t: PointType): string {
  const own: number[] = [];
  let plain = false;
  for (const f of scheduleCircuits(project, board.id)) {
    const items = normalizeLoadItems(f.loadItems).filter((it) => it.pointType === t);
    if (items.length) own.push(...items.map((it) => it.unitWatts));
    else if ((f.points?.[t] ?? 0) > 0) plain = true;
  }
  const values = [...new Set([...(plain || !own.length ? [pointWattsFor(board)[t] || 0] : []), ...own])];
  return values.length === 1 && !values[0] ? '' : values.join(' / ');
}

/** The circuit's items as text, e.g. "6×L1 10 W + 4×L2 20 W" (empty when it has none). */
export function loadItemsText(f: Pick<Feeder, 'loadItems'>, pointType?: PointType): string {
  return normalizeLoadItems(f.loadItems)
    .filter((it) => !pointType || it.pointType === pointType)
    .map((it) => `${it.quantity}×${it.reference || it.name} ${it.unitWatts} W`)
    .join(' + ');
}

export type CircuitCategory = 'lighting' | 'power';

/** A lighting circuit has only lighting points (LTG, C.FAN, EX.FAN);
 * anything else — or a circuit with no points yet — counts as power, the
 * stricter case (larger minimum wire, 30 mA ELCB). */
export function circuitCategory(f: Feeder): CircuitCategory {
  const used = Object.entries(f.points ?? {}).filter(([, n]) => (n ?? 0) > 0).map(([t]) => t as PointType);
  return used.length > 0 && used.every((t) => LIGHTING_POINTS.includes(t)) ? 'lighting' : 'power';
}

/** Minimum circuit wire for the circuit's type (project settings). */
export function minWireMm2(project: Project, f: Feeder): number {
  const s = settingsOf(project);
  return circuitCategory(f) === 'lighting' ? s.minWireLightingMm2 : s.minWirePowerMm2;
}

/** Point types used on a board's circuits whose WATT/UNIT is still 0. */
export function missingWatts(project: Project, board: Board): PointType[] {
  const w = pointWattsFor(board);
  const used = new Set<PointType>();
  for (const f of scheduleCircuits(project, board.id)) {
    const itemized = itemizedTypes(f); // these carry their own watts
    for (const [t, n] of Object.entries(f.points ?? {})) if ((n ?? 0) > 0 && !itemized.has(t as PointType)) used.add(t as PointType);
  }
  return POINT_TYPES.map((p) => p.value).filter((t) => used.has(t) && !w[t]);
}

/** Icon for the diagram: the point type contributing the most watts. */
export function dominantLoadType(f: Feeder, board: Board | undefined): LoadType {
  let best: PointType | undefined;
  let bestW = 0;
  for (const [t, watts = 0] of Object.entries(circuitWattsByType(f, board))) {
    if (watts > bestW) {
      bestW = watts;
      best = t as PointType;
    }
  }
  switch (best) {
    case 'ltg': return 'lighting';
    case 's13': case 's13t': case 's15': case 'shaver': case 'spur': return 'sockets';
    case 'wac': case 'sac': case 'cfan': case 'exfan': case 'fcu': return 'hvac';
    case 'pump': return 'motor';
    default: return 'general';
  }
}

/** Demand real and reactive power (kW, kvar) on each phase of a board, including everything
 * downstream (ENG-005). Each load's demand factor is applied once and its kvar comes from its own
 * PF; capacitor banks give negative kvar; incomers add the board they feed (their own loadKw / PF
 * are placeholders, not loads). Phase allocation as boardPhaseKw: labelled single-phase circuits
 * on their phase, three-phase and older unlabelled single-phase feeders spread evenly. Generation
 * and standby units are treated exactly as boardPhaseKw treats them (counted like loads). */
export type PhasePQ = Record<'R' | 'Y' | 'B', { p: number; q: number }>;
export function boardPhasePQ(project: Project, boardId: string, seen = new Set<string>(), covered = false): PhasePQ {
  if (seen.has(boardId)) return { R: { p: 0, q: 0 }, Y: { p: 0, q: 0 }, B: { p: 0, q: 0 } };
  seen.add(boardId);
  return memoized(project, `phasePQ:${boardId}${covered ? ':covered' : ''}`, () => boardPhasePQOf(project, boardId, seen, covered));
}

/** `covered`: a recorded maximum demand above (or on) this board already includes its existing load. */
function boardPhasePQOf(project: Project, boardId: string, seen: Set<string>, covered: boolean): PhasePQ {
  const board = networkOf(project)?.boardById.get(boardId) ?? project.boards.find((b) => b.id === boardId);
  const rec = !covered && board ? recordedPQ(project, board) : undefined;
  const cov = covered || !!rec;
  const out: PhasePQ = { R: { p: (rec?.p ?? 0) / 3, q: (rec?.q ?? 0) / 3 }, Y: { p: (rec?.p ?? 0) / 3, q: (rec?.q ?? 0) / 3 }, B: { p: (rec?.p ?? 0) / 3, q: (rec?.q ?? 0) / 3 } };
  const put = (f: Feeder, p: number, q: number) => {
    if (f.cores === 2 && f.phase && f.phase !== 'RYB') { out[f.phase].p += p; out[f.phase].q += q; return; }
    for (const ph of ['R', 'Y', 'B'] as const) { out[ph].p += p / 3; out[ph].q += q / 3; }
  };
  const caps: Feeder[] = [];
  for (const f of networkOf(project)?.feedersByBoard.get(boardId) ?? project.feeders.filter((x) => x.boardId === boardId)) {
    if (f.feedsBoardId) {
      const sub = boardPhasePQ(project, f.feedsBoardId, seen, cov);
      for (const ph of ['R', 'Y', 'B'] as const) { out[ph].p += sub[ph].p; out[ph].q += sub[ph].q; }
      continue;
    }
    if (cov && f.existing) continue;
    if (f.kvar) { caps.push(f); continue; }
    const kw = f.loadKw * f.demandFactor;
    const pf = Math.min(Math.max(f.powerFactor, 0.01), 1);
    put(f, kw, kw * Math.tan(Math.acos(pf)));
  }
  // Capacitor banks: the switched steps for this board's load (as boardTotals), kvar negative.
  if (caps.length) {
    const p = out.R.p + out.Y.p + out.B.p, q = out.R.q + out.Y.q + out.B.q;
    const sw = switchedOnBoard(caps, p, q, settingsOf(project).pfTarget);
    for (const c of caps) put(c, c.loadKw * c.demandFactor, -(sw.get(c.id) ?? 0));
  }
  return out;
}

/** Demand kW on each phase of a board, including everything downstream.
 * Single-phase circuits load their own phase; 3-phase circuits, and older
 * single-phase feeders with no phase set, are spread evenly. */
export function boardPhaseKw(project: Project, boardId: string, seen = new Set<string>(), covered = false): PhaseKw {
  const out: PhaseKw = { R: 0, Y: 0, B: 0 };
  if (seen.has(boardId)) return out;
  seen.add(boardId);
  // A recorded maximum demand (existing installation): balanced, and it covers the existing load below.
  const board = project.boards.find((b) => b.id === boardId);
  const rec = !covered && board ? recordedPQ(project, board) : undefined;
  const cov = covered || !!rec;
  if (rec) { out.R += rec.p / 3; out.Y += rec.p / 3; out.B += rec.p / 3; }
  for (const f of project.feeders.filter((x) => x.boardId === boardId)) {
    if (cov && f.existing && !f.feedsBoardId) continue;
    if (f.feedsBoardId) {
      const sub = boardPhaseKw(project, f.feedsBoardId, seen, cov);
      out.R += sub.R;
      out.Y += sub.Y;
      out.B += sub.B;
      continue;
    }
    const kw = f.loadKw * f.demandFactor;
    if (f.cores === 2 && f.phase && f.phase !== 'RYB') out[f.phase] += kw;
    else {
      out.R += kw / 3;
      out.Y += kw / 3;
      out.B += kw / 3;
    }
  }
  return out;
}

/** Phase imbalance: (max − min) ÷ average, in %. */
export function imbalancePct(p: PhaseKw): number {
  const avg = (p.R + p.Y + p.B) / 3;
  return avg > 0 ? ((Math.max(p.R, p.Y, p.B) - Math.min(p.R, p.Y, p.B)) / avg) * 100 : 0;
}

/** Schedule circuits of a board in schedule order: by way, then R, Y, B. */
export function scheduleCircuits(project: Project, boardId: string): Feeder[] {
  return project.feeders
    .filter((f) => f.boardId === boardId && isScheduleCircuit(f))
    .sort((a, b) => a.way! - b.way! || PHASE_ORDER[a.phase!] - PHASE_ORDER[b.phase!]);
}

/** First free slot on a board: fills R1, Y1, B1, R2… A 3-phase circuit
 * needs a way with all three phases free. */
export function nextFreeSlot(project: Project, boardId: string, phase?: Phase): { phase: Phase; way: number } {
  const used = new Set<string>();
  // Spares and spaces of the board keep their slots too.
  const spares = project.boards.find((b) => b.id === boardId)?.spareWays ?? [];
  for (const f of [...scheduleCircuits(project, boardId), ...spares.filter((s) => s.way)]) {
    for (const p of f.phase === 'RYB' ? SINGLE_PHASES : [f.phase as 'R' | 'Y' | 'B']) used.add(`${p}${f.way}`);
  }
  for (let way = 1; way < 1000; way++) {
    if (phase === 'RYB') {
      if (SINGLE_PHASES.every((p) => !used.has(`${p}${way}`))) return { phase, way };
      continue;
    }
    for (const p of phase ? [phase] : SINGLE_PHASES) if (!used.has(`${p}${way}`)) return { phase: p, way };
  }
  throw new Error('No free way');
}

export interface ElcbGroup {
  index: number; // 1-based
  ways: number[];
  circuits: Feeder[];
  category: CircuitCategory | 'mixed';
  phaseKw: PhaseKw;
  maxPhaseA: number;
  ratingA: number;
  sensitivityMa: number;
  label: string; // e.g. "40 A 30 mA 4P"
}

/** ELCB (RCCB) groups: by default one 4-pole ELCB per 6 circuits (two
 * ways); 3 gives one per way; 0 means no ELCBs. Rated for the group's most
 * loaded phase, and 100 mA for an all-lighting group / 30 mA otherwise
 * (project settings), unless the board overrides either. */
export function elcbGroups(project: Project, board: Board): ElcbGroup[] {
  const size = board.elcbGroupSize ?? 6;
  if (!size) return [];
  const waysPerGroup = size / 3;
  const circuits = scheduleCircuits(project, board.id);
  const byGroup = new Map<number, Feeder[]>();
  for (const f of circuits) {
    const g = Math.floor((f.way! - 1) / waysPerGroup) + 1;
    byGroup.set(g, [...(byGroup.get(g) ?? []), f]);
  }
  const u0 = project.voltageV / Math.sqrt(3);
  return [...byGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, cs]) => {
      const phaseKw: PhaseKw = { R: 0, Y: 0, B: 0 };
      const phaseKvar: PhaseKw = { R: 0, Y: 0, B: 0 };
      for (const f of cs) {
        const kw = f.loadKw * f.demandFactor;
        const pf = Math.min(Math.max(f.powerFactor, 0.01), 1);
        const kvar = kw * Math.tan(Math.acos(pf));
        if (f.phase === 'RYB') SINGLE_PHASES.forEach((p) => { phaseKw[p] += kw / 3; phaseKvar[p] += kvar / 3; });
        else {
          const phase = f.phase as 'R' | 'Y' | 'B';
          phaseKw[phase] += kw;
          phaseKvar[phase] += kvar;
        }
      }
      const maxPhaseA = Math.max(...SINGLE_PHASES.map((p) => Math.hypot(phaseKw[p], phaseKvar[p]) * 1000 / u0));
      const ratingA = board.elcbRatingA ?? STANDARD_ELCB_A.find((r) => r >= maxPhaseA) ?? STANDARD_ELCB_A[STANDARD_ELCB_A.length - 1];
      const cats = new Set(cs.map(circuitCategory));
      const category: ElcbGroup['category'] = cats.size === 1 ? [...cats][0] : 'mixed';
      const s = settingsOf(project);
      const sensitivityMa = board.elcbSensitivityMa ?? (category === 'lighting' ? s.elcbLightingMa : s.elcbPowerMa);
      const first = (index - 1) * waysPerGroup + 1;
      return {
        index,
        ways: Array.from({ length: waysPerGroup }, (_, i) => first + i),
        circuits: cs,
        category,
        phaseKw,
        maxPhaseA,
        ratingA,
        sensitivityMa,
        label: `${ratingA} A ${sensitivityMa} mA 4P`
      };
    });
}
