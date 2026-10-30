import type { Board, Feeder, Project } from '../types';
import { layoutSystem } from '../diagram/layout';
import { boardTotals } from '../calc/summary';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { isDbBoard } from './spareWays';
import { BOARD_FIELDS, FEEDER_FIELDS, fieldChanges } from './revisions';
import type { FieldChange } from './datasetDiff';
import { sheetProject, type DrawingSet, type DrawingSheet, type SheetCloud } from './drawingSet';

/** Automatic revision clouds (SLD sheets): when a sheet is issued it keeps what it drew of each panel and circuit
 * (`issuedItems`); later, the panels and circuits that changed since are listed, and the ones ticked get a cloud with
 * the next revision. Only what the SLD prints is compared: a circuit's room or remarks don't cloud it. */

/** What is kept of each item at an issue: "b:<board id>" or "f:<feeder id>" → its drawn values. */
export type SheetItems = Record<string, Record<string, unknown>>;

const FEEDER_DRAWN = new Set(['name', 'loadKw', 'breakerRatingA', 'breakerType', 'breakerIcuKa', 'breakerImMultiple', 'device', 'cableCsaMm2', 'cores', 'cableType', 'cpcMm2', 'lengthM', 'parallel',
  'rcdMa', 'kvar', 'capSteps', 'starter', 'phase', 'way', 'kwhMeter', 'feedsBoardId', 'essential', 'existing', 'standbyUnit', 'localIsolator']);
const BOARD_DRAWN = new Set(['name', 'kind', 'upstreamId', 'ratedCurrentA', 'sourceKva', 'sourceImpedancePct', 'txRef', 'supply', 'standby', 'vectorGroup', 'protection', 'upsKva', 'busbarMaterial',
  'instruments', 'incomerDevice', 'earthing', 'rmu', 'spd', 'pmu', 'existing', 'form4', 'spareWays', 'elcbRatingA', 'elcbSensitivityMa', 'elcbGroupSize']);
const FEEDER_LABELS = FEEDER_FIELDS.filter(([k]) => FEEDER_DRAWN.has(k)) as [string, string][];
/** A DB drawn as one box shows its circuit count and connected load. */
const BOARD_LABELS = [...BOARD_FIELDS.filter(([k]) => BOARD_DRAWN.has(k)), ['circuits', 'Circuits'], ['connectedKw', 'Connected load (kW)']] as [string, string][];

/** Numbers to 3 decimals, so a recalculated load doesn't differ in its last digit. */
const tidy = (v: unknown): unknown => (typeof v === 'number' ? +v.toFixed(3) : Array.isArray(v) ? v.map(tidy) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x)])) : v);
function pick(o: object, fields: [string, string][]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k] of fields) { const v = (o as Record<string, unknown>)[k]; if (v !== undefined && v !== '') out[k] = tidy(v); }
  return out;
}

/** The panels and circuits a system SLD sheet draws, with their drawn values; undefined for other sheets. */
export function sheetItems(p: Project, set: DrawingSet, s: DrawingSheet): SheetItems | undefined {
  if (s.kind !== 'system') return undefined;
  const drawing = sheetProject(p, set, s);
  const layout = layoutSystem(drawing);
  const out: SheetItems = {};
  for (const n of layout.boards) {
    const b = n.board;
    // A main or sub-main's load is the sum of what is downstream: only a DB box shows its own.
    out[`b:${b.id}`] = { ...pick(b, BOARD_LABELS), ...(isDbBoard(b) ? { circuits: p.feeders.filter((f) => f.boardId === b.id && isScheduleCircuit(f)).length, connectedKw: tidy(boardTotals(p, b.id).connectedKw) } : {}) };
  }
  for (const n of layout.feeders) out[`f:${n.feeder.id}`] = pick(n.feeder, FEEDER_LABELS);
  return out;
}

export interface ItemChange {
  key: string; // "b:MDB-1" / "f:<feeder id>"
  label: string; // "DB-ROOF", "MDB-01 → DB-ROOF", "MDB-01 Chiller"
  change: 'changed' | 'added' | 'removed';
  fields: FieldChange[];
  /** Still drawn on the sheet, so it can be clouded. */
  cloudable: boolean;
}

const itemLabel = (key: string, v: Record<string, unknown> | undefined, p: Project): string => {
  const id = key.slice(2);
  if (key.startsWith('b:')) return id;
  const f: Partial<Feeder> | undefined = p.feeders.find((x) => x.id === id);
  const board = f?.boardId ?? '';
  const to = (v?.feedsBoardId as string | undefined) ?? f?.feedsBoardId;
  return to ? `${board} → ${to}` : `${board} ${(v?.name as string | undefined) || f?.name || id}`.trim();
};

/** The panels and circuits that changed since the sheet was last issued; undefined when its issue kept no items
 * (other sheet kinds, or issued before items were kept). */
export function sheetChanges(p: Project, set: DrawingSet, s: DrawingSheet): ItemChange[] | undefined {
  const before = s.issuedItems;
  const now = before && sheetItems(p, set, s);
  if (!before || !now) return undefined;
  const out: ItemChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(now)])) {
    const a = before[key], b = now[key];
    const labels = key.startsWith('b:') ? BOARD_LABELS : FEEDER_LABELS;
    if (!a) out.push({ key, label: itemLabel(key, b, p), change: 'added', fields: [], cloudable: true });
    else if (!b) out.push({ key, label: itemLabel(key, a, p), change: 'removed', fields: [], cloudable: false });
    else {
      const fields = fieldChanges(a as Partial<Board & Feeder>, b as Partial<Board & Feeder>, labels as [keyof (Board & Feeder), string][]);
      if (fields.length) out.push({ key, label: itemLabel(key, b, p), change: 'changed', fields, cloudable: true });
    }
  }
  return out;
}

/** One line for an item's change: "Cable (mm²) 25 → 35; Breaker (A) 200 → 250", "new", "taken off". */
export const changeText = (c: ItemChange) => (c.change === 'added' ? 'new' : c.change === 'removed' ? 'taken off the sheet' : c.fields.map((f) => `${f.field} ${f.from} → ${f.to}`).join('; '));

/** The sheet with a cloud at `rev` round each chosen item (a panel, or one circuit); items already clouded at that
 * revision are not clouded twice. */
export function cloudChanges(s: DrawingSheet, keys: string[], rev: string): DrawingSheet {
  const has = (c: SheetCloud, key: string) => c.rev === rev && (key.startsWith('b:') ? c.boards.length === 1 && c.boards[0] === key.slice(2) : !c.boards.length && c.feeders?.length === 1 && c.feeders[0] === key.slice(2));
  const add = keys.filter((k) => !(s.clouds ?? []).some((c) => has(c, k)))
    .map((k): SheetCloud => (k.startsWith('b:') ? { boards: [k.slice(2)], rev } : { boards: [], feeders: [k.slice(2)], rev }));
  return add.length ? { ...s, clouds: [...(s.clouds ?? []), ...add] } : s;
}
