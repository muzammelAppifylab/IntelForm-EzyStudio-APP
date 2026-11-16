/**
 * Immutable updates written as mutations, without a dependency (legacy used immer).
 *
 *   const next = produce(doc, d => { d.draft.fields[0].label = 'Hi' })
 *
 * The recipe edits a deep copy; the result then shares every part that did not change with
 * `base` (objects in arrays are matched by their `id` when they have one), so:
 *   - nothing changed → the very same `base` object comes back (`next === base`);
 *   - an unchanged field keeps its identity, so memoised components and `!==` checks
 *     (autosave's "did the draft change?") keep working as with immer.
 * Values must be plain JSON-like data (objects, arrays, primitives): definitions, themes, settings.
 */
export type Draft<T> = T;

export function produce<T>(base: T, recipe: (draft: Draft<T>) => void): T {
  const draft = structuredClone(base);
  recipe(draft);
  return share(base, draft) as T;
}

/** A deep copy of plain data (immer's `current()` on a draft, here just a clone). */
export const snapshot = <T>(value: T): T => structuredClone(value);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const idOf = (v: unknown): string | null => (isObject(v) && typeof v.id === 'string' ? v.id : null);

/** `next` with every part deep-equal to `prev` replaced by `prev`'s own object. */
export function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev;
  if (!isObject(prev) || !isObject(next)) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;

  if (Array.isArray(next)) {
    const before = prev as unknown as unknown[];
    const byId = new Map<string, unknown>();
    for (const item of before) {
      const id = idOf(item);
      if (id !== null) byId.set(id, item);
    }
    let same = before.length === next.length;
    const out = next.map((item, i) => {
      const id = idOf(item);
      const match = id !== null && byId.has(id) ? byId.get(id) : i < before.length ? before[i] : undefined;
      const shared = match === undefined ? item : share(match, item);
      if (shared !== before[i]) same = false;
      return shared;
    });
    return same ? prev : out;
  }

  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  let same = prevKeys.length === nextKeys.length;
  const out: Record<string, unknown> = {};
  for (const key of nextKeys) {
    const has = Object.prototype.hasOwnProperty.call(prev, key);
    const shared = has ? share(prev[key], next[key]) : next[key];
    if (!has || shared !== prev[key]) same = false;
    out[key] = shared;
  }
  return same ? prev : out;
}
