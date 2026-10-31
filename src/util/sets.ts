/** A copy of the set with the item added, or removed when it is already there (for checkbox lists). */
export function toggleIn<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}

/** The items by key, in their order (one pass, for a lookup per board instead of a filter per board). */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of items) { const k = key(x), l = out.get(k); if (l) l.push(x); else out.set(k, [x]); }
  return out;
}
