import { STANDARD_NOTE, type StandardLoad } from '../data/standardLoads';
import { POINT_TYPES } from '../types';

type Row = Record<string, unknown>;
const key = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Is a standard item already in the library: the same reference, or the same name? */
export function inLibrary(rows: Row[], item: Pick<StandardLoad, 'reference' | 'name'>): boolean {
  return rows.some((r) => (key(r.reference) && key(r.reference) === key(item.reference)) || key(r.name) === key(item.name));
}

/** The Loads.xlsx rows after adding the chosen standard items: the existing rows as they are (never changed), then
 * the new items, each marked as a standard typical value to verify. Items already in the library are skipped. */
export function withStandardLoads(rows: Row[], chosen: StandardLoad[]): { rows: Row[]; added: StandardLoad[]; skipped: StandardLoad[] } {
  const existing = rows.map(({ _row, ...rest }) => rest);
  const added: StandardLoad[] = [], skipped: StandardLoad[] = [];
  const out = [...existing];
  for (const item of chosen) {
    if (inLibrary(out, item)) { skipped.push(item); continue; }
    added.push(item);
    out.push({
      name: item.name,
      reference: item.reference,
      category: item.category,
      column: POINT_TYPES.find((p) => p.value === item.column)!.label,
      watts: item.watts,
      ...(item.pf !== undefined ? { pf: item.pf } : {}),
      ...(item.phases ? { phases: item.phases } : {}),
      notes: STANDARD_NOTE
    });
  }
  return { rows: out, added, skipped };
}
