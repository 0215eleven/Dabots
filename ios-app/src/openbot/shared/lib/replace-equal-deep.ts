// Structural sharing as in TanStack Query's replaceEqualDeep (MIT, Tanner Linsley): keep the old
// reference wherever the new value is deeply equal, so memoized rows do not re-render.
const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function replaceEqualDeep<T>(previous: unknown, next: T): T {
  if (previous === next) return previous as T;
  const array = Array.isArray(previous) && Array.isArray(next);
  if (!array && !(isPlain(previous) && isPlain(next))) return next;
  const prevItems: Record<string, unknown> = array ? Object.fromEntries((previous as unknown[]).map((value, index) => [index, value])) : (previous as Record<string, unknown>);
  const nextItems: Record<string, unknown> = array ? Object.fromEntries((next as unknown[]).map((value, index) => [index, value])) : (next as Record<string, unknown>);
  const keys = Object.keys(nextItems);
  const copy: Record<string, unknown> = array ? ([] as unknown as Record<string, unknown>) : {};
  let equal = 0;
  for (const key of keys) {
    const value = replaceEqualDeep(prevItems[key], nextItems[key]);
    copy[key] = value;
    if (value === prevItems[key] && key in prevItems) equal++;
  }
  return (Object.keys(prevItems).length === keys.length && equal === keys.length ? previous : copy) as T;
}
