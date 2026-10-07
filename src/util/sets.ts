/** A copy of the set with the item added, or removed when it is already there (for checkbox lists). */
export function toggleIn<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
