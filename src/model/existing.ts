import type { Board, OtherBuilding, Project } from '../types';

/** Extension of an existing installation.
 *
 * A board marked existing may carry its recorded maximum demand. That reading
 * covers ALL existing load at and below the board: below it, existing feeders
 * and other boards' recorded demands are not added again; only new load is
 * added on top. A board with no reading (and no reading above it) adds up its
 * feeders as usual, existing ones included.
 *
 * Shared supply: an existing board may list other buildings it supplies that
 * are not drawn here (a shared substation, or a neighbour's main board feeding
 * the new building), each with its allocated and recorded load; the higher of
 * the two is kept for it (see existingLoad). */

export const DEFAULT_EXISTING_PF = 0.9;

export const isExisting = (b: Board | undefined) => !!b?.existing;

/** Load kept for another building on a shared supply: the higher of its allocated and recorded load. */
export const otherKva = (o: OtherBuilding) => Math.max(o.allocatedKva ?? 0, o.recordedKva ?? 0);

/** Recorded maximum demand of a board in kVA with its margin, or undefined when none was entered. */
export function recordedKva(project: Project, b: Board): number | undefined {
  const e = b.existing;
  if (!e) return undefined;
  const kva = e.recordedKva ?? (e.recordedA ? (Math.sqrt(3) * project.voltageV * e.recordedA) / 1000 : undefined);
  if (!kva || kva <= 0) return undefined;
  return kva * (1 + (e.marginPct ?? 0) / 100);
}

/** Load kept for the other buildings a board supplies (0 when none are listed). */
export const othersKva = (b: Board) => (b.existing?.others ?? []).reduce((s, o) => s + otherKva(o), 0);

/** Existing load drawn in the project at and below a board (its existing circuits), kVA. */
function drawnExistingKva(project: Project, b: Board): number {
  const ids = new Set([b.id]);
  for (let added = true; added; ) {
    added = false;
    for (const x of project.boards) if (x.upstreamId && ids.has(x.upstreamId) && !ids.has(x.id)) { ids.add(x.id); added = true; }
  }
  let p = 0, q = 0;
  for (const f of project.feeders) {
    if (!f.existing || f.feedsBoardId || f.kvar || f.generation || !ids.has(f.boardId)) continue;
    const kw = f.loadKw * f.demandFactor;
    p += kw; q += kw * Math.tan(Math.acos(Math.min(Math.max(f.powerFactor, 0.01), 1)));
  }
  return Math.hypot(p, q);
}

/** Existing load of a board, kVA, and whether it covers the existing load drawn below it:
 *  - a recorded maximum demand covers it; with other buildings listed, the existing load is the higher
 *    of the reading and (the existing load drawn here + the load kept for them), since their
 *    allocations may not all be in use yet;
 *  - other buildings without a reading: the load kept for them, on top of the existing load drawn here.
 * Undefined when neither is entered. */
export function existingLoad(project: Project, b: Board): { kva: number; covers: boolean } | undefined {
  const rec = recordedKva(project, b);
  const kept = othersKva(b);
  if (rec === undefined) return kept > 0 ? { kva: kept, covers: false } : undefined;
  return { kva: kept > 0 ? Math.max(rec, kept + drawnExistingKva(project, b)) : rec, covers: true };
}

/** The existing load as real and reactive power (kW, kvar), balanced over the three phases. */
export function recordedPQ(project: Project, b: Board): { p: number; q: number; covers: boolean } | undefined {
  const e = existingLoad(project, b);
  if (!e) return undefined;
  const pf = Math.min(Math.max(b.existing?.powerFactor ?? DEFAULT_EXISTING_PF, 0.01), 1);
  return { p: e.kva * pf, q: e.kva * Math.sin(Math.acos(pf)), covers: e.covers };
}

/** "MD 610 kVA (DEWA reading, 2026-08-12)" for drawings and reports. */
export function recordedText(project: Project, b: Board): string | undefined {
  const kva = recordedKva(project, b);
  if (kva === undefined) return undefined;
  const e = b.existing!;
  const how = [e.source, e.recordedOn].filter(Boolean).join(', ');
  return `MD ${Math.round(kva)} kVA${e.marginPct ? ` incl. ${e.marginPct} %` : ''}${how ? ` (${how})` : ''}`;
}
