import type { Board, Project } from '../types';

/** Extension of an existing installation.
 *
 * A board marked existing may carry its recorded maximum demand. That reading
 * covers ALL existing load at and below the board: below it, existing feeders
 * and other boards' recorded demands are not added again; only new load is
 * added on top. A board with no reading (and no reading above it) adds up its
 * feeders as usual, existing ones included. */

export const DEFAULT_EXISTING_PF = 0.9;

export const isExisting = (b: Board | undefined) => !!b?.existing;

/** Recorded maximum demand of a board in kVA with its margin, or undefined when none was entered. */
export function recordedKva(project: Project, b: Board): number | undefined {
  const e = b.existing;
  if (!e) return undefined;
  const kva = e.recordedKva ?? (e.recordedA ? (Math.sqrt(3) * project.voltageV * e.recordedA) / 1000 : undefined);
  if (!kva || kva <= 0) return undefined;
  return kva * (1 + (e.marginPct ?? 0) / 100);
}

/** The recorded demand as real and reactive power (kW, kvar), balanced over the three phases. */
export function recordedPQ(project: Project, b: Board): { p: number; q: number } | undefined {
  const kva = recordedKva(project, b);
  if (kva === undefined) return undefined;
  const pf = Math.min(Math.max(b.existing?.powerFactor ?? DEFAULT_EXISTING_PF, 0.01), 1);
  return { p: kva * pf, q: kva * Math.sin(Math.acos(pf)) };
}

/** "MD 610 kVA (DEWA reading, 2026-08-12)" for drawings and reports. */
export function recordedText(project: Project, b: Board): string | undefined {
  const kva = recordedKva(project, b);
  if (kva === undefined) return undefined;
  const e = b.existing!;
  const how = [e.source, e.recordedOn].filter(Boolean).join(', ');
  return `MD ${Math.round(kva)} kVA${e.marginPct ? ` incl. ${e.marginPct} %` : ''}${how ? ` (${how})` : ''}`;
}
