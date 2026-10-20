import { circuitRef, circuitWatts, loadItemsText, normalizeLoadItems } from '../calc/loadSchedule';
import { findLibraryLoad, loadItemFromLibrary, type LibraryLoad } from '../database/database';
import { updateCircuit } from './schedule';
import type { CadBlockMap, CircuitLoadItem, Feeder, PointType, Project } from '../types';

/** A block placed on a CAD floor plan: its block name and attribute values (tag → value). */
export interface CadBlock { block: string; attributes: Record<string, string> }

/** Attribute tags that carry a fixture's circuit reference, e.g. CCT = "DB-GF1/R3". */
export const CIRCUIT_ATTRIBUTES = ['CCT', 'CIRCUIT', 'CKT', 'CCT_REF', 'CIRCUIT_REF'];

/** What CAD says one circuit carries, beside what the design has now. */
export interface CadLoadProposal {
  feederId: string;
  boardId: string;
  ref: string; // "DB-GF1 R3"
  items: CircuitLoadItem[]; // the circuit's items after the pull
  currentText: string;
  proposedText: string;
  currentW: number;
  proposedW: number;
}

export interface CadLoadPull {
  proposals: CadLoadProposal[]; // circuits whose load differs from CAD
  matching: number; // circuits CAD agrees with
  unmapped: { block: string; count: number }[]; // blocks with a circuit but no library item: map them once
  noCircuit: { block: string; count: number }[]; // library fixtures without a circuit attribute
  unknownCircuits: { ref: string; count: number }[]; // circuit references that match no circuit in the design
}

const tally = (m: Map<string, number>) => [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, count]) => ({ k, count }));
const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

/** The library item and count a block stands for: a block named like a library reference is that item;
 * otherwise the project's block map says (a twin socket block counts 2). */
export function resolveBlock(block: string, loads: LibraryLoad[], map: CadBlockMap[] | undefined): { load: LibraryLoad; per: number } | undefined {
  const own = findLibraryLoad(loads, { reference: block });
  if (own) return { load: own, per: 1 };
  const row = map?.find((r) => r.block.trim().toLowerCase() === block.trim().toLowerCase());
  const load = row && findLibraryLoad(loads, { reference: row.reference });
  return load ? { load, per: row.per && row.per > 0 ? Math.round(row.per) : 1 } : undefined;
}

/** The circuit a reference such as "DB-GF1/R3", "DB-GF1 R3" or "db-gf1-r3" names: the longest board ID it starts
 * with, then that board's circuit (phase + way). */
export function findCircuit(project: Project, value: string): Feeder | undefined {
  const text = value.trim().toLowerCase();
  const board = [...project.boards].sort((a, b) => b.id.length - a.id.length).find((b) => text.startsWith(b.id.toLowerCase()));
  if (!board) return undefined;
  const ref = text.slice(board.id.length).replace(/^[\s/\\:.\-_]+/, '').replace(/\s+/g, '');
  if (!ref) return undefined;
  return project.feeders.find((f) => f.boardId === board.id && circuitRef(f)?.toLowerCase() === ref);
}

const circuitOf = (b: CadBlock) => {
  const tag = Object.keys(b.attributes).find((k) => CIRCUIT_ATTRIBUTES.includes(k.trim().toUpperCase()));
  const value = tag ? b.attributes[tag]?.trim() : '';
  return value || undefined;
};

/** Compares the fixtures on a CAD floor plan with each circuit's load. For every circuit that has fixtures in
 * CAD, the point types found there take CAD's items (count per library item); its other point types are kept.
 * Nothing is applied here — the engineer accepts proposals with applyCadLoads. */
export function pullCadLoads(project: Project, blocks: CadBlock[], loads: LibraryLoad[]): CadLoadPull {
  const unmapped = new Map<string, number>(), noCircuit = new Map<string, number>(), unknown = new Map<string, number>();
  const found = new Map<string, Map<string, { load: LibraryLoad; quantity: number }>>(); // feeder → library ref/name → count
  for (const b of blocks) {
    const cct = circuitOf(b);
    const resolved = resolveBlock(b.block, loads, project.cadBlocks);
    // A library item without a schedule column cannot be counted on a circuit: it needs mapping like an unknown block.
    if (!resolved || !resolved.load.column) { if (cct) bump(unmapped, b.block); continue; }
    if (!cct) { bump(noCircuit, b.block); continue; }
    const f = findCircuit(project, cct);
    if (!f) { bump(unknown, cct); continue; }
    const key = (resolved.load.reference ?? resolved.load.name).toLowerCase();
    const items = found.get(f.id) ?? new Map();
    const at = items.get(key);
    items.set(key, { load: resolved.load, quantity: (at?.quantity ?? 0) + resolved.per });
    found.set(f.id, items);
  }

  const proposals: CadLoadProposal[] = [];
  let matching = 0;
  for (const f of project.feeders) {
    const cad = found.get(f.id);
    if (!cad) continue;
    const board = project.boards.find((b) => b.id === f.boardId);
    const fromCad = [...cad.values()].map(({ load, quantity }) => loadItemFromLibrary(load, load.column!, quantity));
    const types = new Set<PointType>(fromCad.map((it) => it.pointType));
    const current = normalizeLoadItems(f.loadItems);
    const items = normalizeLoadItems([...current.filter((it) => !types.has(it.pointType)), ...fromCad]);
    const points = { ...f.points };
    for (const t of types) points[t] = items.filter((it) => it.pointType === t).reduce((s, it) => s + it.quantity, 0);
    const proposed: Feeder = { ...f, points, loadItems: items };
    const before = { currentText: circuitText(f), currentW: circuitWatts(f, board) };
    const after = { proposedText: circuitText(proposed), proposedW: circuitWatts(proposed, board) };
    // Same counts and watts is a match, whether or not the circuit was itemized (no noise in the review).
    const sameCounts = [...types].every((t) => (f.points?.[t] ?? 0) === points[t]);
    if ((sameItems(current, items) || sameCounts) && before.currentW === after.proposedW) { matching += 1; continue; }
    proposals.push({ feederId: f.id, boardId: f.boardId, ref: `${f.boardId} ${circuitRef(f) ?? f.name}`, items, ...before, ...after });
  }
  return {
    proposals,
    matching,
    unmapped: tally(unmapped).map(({ k, count }) => ({ block: k, count })),
    noCircuit: tally(noCircuit).map(({ k, count }) => ({ block: k, count })),
    unknownCircuits: tally(unknown).map(({ k, count }) => ({ ref: k, count }))
  };
}

/** Everything on a circuit: its items ("6×L1 10 W"), then its other points ("1×EXFAN"). */
function circuitText(f: Feeder): string {
  const itemized = new Set(normalizeLoadItems(f.loadItems).map((it) => it.pointType));
  const rest = Object.entries(f.points ?? {}).filter(([t, n]) => (n ?? 0) > 0 && !itemized.has(t as PointType)).map(([t, n]) => `${n}×${t.toUpperCase()}`);
  return [loadItemsText(f), ...rest].filter(Boolean).join(' + ') || 'no points';
}

const itemKey = (it: CircuitLoadItem) => `${it.pointType}|${(it.reference ?? it.name).toLowerCase()}|${it.unitWatts}|${it.quantity}`;
const sameItems = (a: CircuitLoadItem[], b: CircuitLoadItem[]) => a.map(itemKey).sort().join() === b.map(itemKey).sort().join();

/** Applies the accepted proposals through the schedule's own edit (so auto-sized circuits re-size). */
export function applyCadLoads(project: Project, accepted: CadLoadProposal[]): Project {
  let p = project;
  for (const a of accepted) {
    const items = normalizeLoadItems(a.items);
    const points: Partial<Record<PointType, number>> = { ...p.feeders.find((f) => f.id === a.feederId)?.points };
    for (const t of new Set(items.map((it) => it.pointType))) points[t] = items.filter((it) => it.pointType === t).reduce((s, it) => s + it.quantity, 0);
    p = updateCircuit(p, a.feederId, { loadItems: items.length ? items : undefined, points });
  }
  return p;
}
