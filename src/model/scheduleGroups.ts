import type { Board, Project } from '../types';
import { boardsInSupplyOrder } from '../calc/summary';
import { roleOf } from './emergency';

/** Load schedule groups in submission order: TCL summary, main LV panels,
 * busbar riser, sub-mains, DBs, the emergency system (EMDB → ESMDB → EDB and
 * emergency MCCs), MCCs, then any other panels (UPS, meter cabinets …). */
export type ScheduleGroup = 'mdb' | 'smdb' | 'db' | 'emg' | 'mcc' | 'other';
export const SCHEDULE_GROUPS: { key: ScheduleGroup; label: string }[] = [
  { key: 'mdb', label: 'MDB' },
  { key: 'smdb', label: 'SMDB' },
  { key: 'db', label: 'DB' },
  { key: 'emg', label: 'Emergency' },
  { key: 'mcc', label: 'MCC' },
  { key: 'other', label: 'Others' }
];

/** True when the board is an EMDB or anywhere below one. */
function inEmergency(project: Project, b: Board): boolean {
  const byId = new Map(project.boards.map((x) => [x.id, x]));
  const seen = new Set<string>();
  for (let x: Board | undefined = b; x && !seen.has(x.id); x = x.upstreamId ? byId.get(x.upstreamId) : undefined) {
    seen.add(x.id);
    if (x.kind === 'EMDB') return true;
  }
  return false;
}

export function scheduleGroupOf(project: Project, b: Board): ScheduleGroup {
  if (inEmergency(project, b)) return 'emg';
  const kind = b.kind ?? (b.upstreamId ? 'DB' : 'MDB');
  if (kind === 'MCC') return 'mcc';
  if (!b.upstreamId && kind !== 'UPS') return 'mdb';
  if (kind === 'SMDB') return 'smdb';
  if (kind === 'DB') return 'db';
  return 'other';
}

const EMG_ORDER: Record<string, number> = { EMDB: 0, ESMDB: 1, EDB: 2 };

/** Boards of each group, in supply order (emergency: EMDB, then ESMDB, then EDB, then emergency MCCs). */
export function scheduleGroups(project: Project): Record<ScheduleGroup, Board[]> {
  const out: Record<ScheduleGroup, Board[]> = { mdb: [], smdb: [], db: [], emg: [], mcc: [], other: [] };
  for (const b of boardsInSupplyOrder(project)) out[scheduleGroupOf(project, b)].push(b);
  const rank = (b: Board) => EMG_ORDER[roleOf(project, b)] ?? 3;
  out.emg = out.emg.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).map((x) => x.b);
  return out;
}
