import { DEFAULT_POINT_WATTS, POINT_TYPES, type Board, type Feeder, type LoadType, type Phase, type PointType, type Project } from '../types';

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

export function pointLabel(board: Board | undefined, t: PointType): string {
  if (t === 'spare1' && board?.spareNames?.spare1) return board.spareNames.spare1;
  if (t === 'spare2' && board?.spareNames?.spare2) return board.spareNames.spare2;
  return POINT_TYPES.find((p) => p.value === t)!.label;
}

/** Connected load of a circuit in watts: Σ points × watts per point. */
export function circuitWatts(f: Feeder, board: Board | undefined): number {
  const w = pointWattsFor(board);
  return Object.entries(f.points ?? {}).reduce((sum, [t, n]) => sum + (n ?? 0) * w[t as PointType], 0);
}

/** Icon for the diagram: the point type contributing the most watts. */
export function dominantLoadType(f: Feeder, board: Board | undefined): LoadType {
  const w = pointWattsFor(board);
  let best: PointType | undefined;
  let bestW = 0;
  for (const [t, n] of Object.entries(f.points ?? {})) {
    const watts = (n ?? 0) * w[t as PointType];
    if (watts > bestW) {
      bestW = watts;
      best = t as PointType;
    }
  }
  switch (best) {
    case 'ltg': return 'lighting';
    case 's13': case 's15': case 'shaver': return 'sockets';
    case 'wac': case 'sac': case 'cfan': case 'exfan': return 'hvac';
    case 'pump': return 'motor';
    default: return 'general';
  }
}

/** Demand kW on each phase of a board, including everything downstream.
 * Single-phase circuits load their own phase; 3-phase circuits, and older
 * single-phase feeders with no phase set, are spread evenly. */
export function boardPhaseKw(project: Project, boardId: string, seen = new Set<string>()): PhaseKw {
  const out: PhaseKw = { R: 0, Y: 0, B: 0 };
  if (seen.has(boardId)) return out;
  seen.add(boardId);
  for (const f of project.feeders.filter((x) => x.boardId === boardId)) {
    if (f.feedsBoardId) {
      const sub = boardPhaseKw(project, f.feedsBoardId, seen);
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
  for (const f of scheduleCircuits(project, boardId)) {
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
  phaseKw: PhaseKw;
  maxPhaseA: number;
  ratingA: number;
  sensitivityMa: number;
  label: string; // e.g. "40 A 30 mA 4P"
}

/** ELCB (RCCB) groups: by default one 4-pole ELCB per 6 circuits (two
 * ways); 3 gives one per way; 0 means no ELCBs. Rated for the group's most
 * loaded phase unless the board overrides it. */
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
      for (const f of cs) {
        const kw = f.loadKw * f.demandFactor;
        if (f.phase === 'RYB') SINGLE_PHASES.forEach((p) => (phaseKw[p] += kw / 3));
        else phaseKw[f.phase as 'R' | 'Y' | 'B'] += kw;
      }
      const pf = cs.length ? cs.reduce((s, f) => s + f.powerFactor, 0) / cs.length : 0.9;
      const maxPhaseA = (Math.max(phaseKw.R, phaseKw.Y, phaseKw.B) * 1000) / (u0 * pf);
      const ratingA = board.elcbRatingA ?? STANDARD_ELCB_A.find((r) => r >= maxPhaseA) ?? STANDARD_ELCB_A[STANDARD_ELCB_A.length - 1];
      const sensitivityMa = board.elcbSensitivityMa ?? 30;
      const first = (index - 1) * waysPerGroup + 1;
      return {
        index,
        ways: Array.from({ length: waysPerGroup }, (_, i) => first + i),
        circuits: cs,
        phaseKw,
        maxPhaseA,
        ratingA,
        sensitivityMa,
        label: `${ratingA} A ${sensitivityMa} mA 4P`
      };
    });
}
