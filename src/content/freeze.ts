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

/** Freezes `value` and every plain object/array reachable from it. Returns the same reference. */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value as DeepReadonly<T>;
}
