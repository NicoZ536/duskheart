/**
 * Deep immutability for content data and balance values: content is loaded once and shared by
 * every system, so accidental writes must fail loudly instead of silently changing the game.
 */

/** Recursively readonly view of `T` (typed arrays and functions stay as they are). */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ArrayBufferView
    ? T
    : T extends ReadonlyArray<infer E>
      ? ReadonlyArray<DeepReadonly<E>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

/**
 * Freezes `value` and every plain object/array reachable from it. Returns the same reference. Walks arrays by index and
 * objects with `for … in` (their enumerable own keys; the enumeration cache of a shape is shared by every object of that
 * shape), so freezing the content at load allocates no key array per record (M7-151: the temporaries of module evaluation
 * are what leaves the holes the memory reducer later evacuates, ADR-0315).
 */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) deepFreeze(value[i]);
    } else {
      const record = value as Record<string, unknown>;
      for (const key in record) if (Object.hasOwn(record, key)) deepFreeze(record[key]);
    }
  }
  return value as DeepReadonly<T>;
}
