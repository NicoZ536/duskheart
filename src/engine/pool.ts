/**
 * Allocation helpers for hot paths: a generic object pool and a fixed size float ring buffer
 * (frame time statistics, rolling averages).
 */

/** Options for `Pool`. */
export interface PoolOptions<T> {
  /** Called on release to return the object to a neutral state. */
  reset?: (obj: T) => void;
  /** Maximum number of idle objects kept; extra releases are dropped for the GC. */
  maxIdle?: number;
}

/** Default cap of idle objects a pool keeps around. */
export const POOL_DEFAULT_MAX_IDLE = 4096;

/**
 * Generic object pool. `acquire()` reuses an idle object or creates a new one; `release()` resets
 * it and keeps it for reuse. Releasing the same object twice is a caller error and is not detected
 * (the check would cost O(n) per release).
 */
export class Pool<T> {
  private readonly idle: T[] = [];
  private readonly factory: () => T;
  private readonly reset: ((obj: T) => void) | undefined;
  private readonly maxIdle: number;
  private createdCount = 0;

  constructor(factory: () => T, options: PoolOptions<T> = {}) {
    const maxIdle = options.maxIdle ?? POOL_DEFAULT_MAX_IDLE;
    if (!Number.isInteger(maxIdle) || maxIdle < 0) throw new RangeError(`Pool maxIdle must be an integer ≥ 0, got ${String(maxIdle)}`);
    this.factory = factory;
    this.reset = options.reset;
    this.maxIdle = maxIdle;
  }

  /** Number of idle objects ready for reuse. */
  get idleCount(): number {
    return this.idle.length;
  }

  /** Total number of objects this pool ever created. */
  get created(): number {
    return this.createdCount;
  }

  /** Returns an idle object or creates a new one. */
  acquire(): T {
    const obj = this.idle.pop();
    if (obj !== undefined) return obj;
    this.createdCount++;
    return this.factory();
  }

  /** Resets `obj` and keeps it for reuse (or drops it when `maxIdle` is reached). */
  release(obj: T): void {
    this.reset?.(obj);
    if (this.idle.length < this.maxIdle) this.idle.push(obj);
  }

  /** Creates objects until at least `count` are idle (capped by `maxIdle`). */
  prewarm(count: number): void {
    const target = Math.min(count, this.maxIdle);
    while (this.idle.length < target) {
      this.createdCount++;
      this.idle.push(this.factory());
    }
  }

  /** Drops all idle objects. */
  clear(): void {
    this.idle.length = 0;
  }
}

/**
 * Fixed capacity ring buffer of numbers. Pushing beyond capacity overwrites the oldest value.
 * Index 0 is the oldest retained value.
 */
export class FloatRing {
  private readonly data: Float64Array;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`FloatRing capacity must be an integer ≥ 1, got ${String(capacity)}`);
    this.data = new Float64Array(capacity);
  }

  /** Maximum number of retained values. */
  get capacity(): number {
    return this.data.length;
  }

  /** Number of retained values. */
  get length(): number {
    return this.count;
  }

  /** Appends a value, overwriting the oldest when full. */
  push(v: number): void {
    const cap = this.data.length;
    this.data[(this.head + this.count) % cap] = v;
    if (this.count < cap) this.count++;
    else this.head = (this.head + 1) % cap;
  }

  /** Value at `i` (0 = oldest). Throws when out of range. */
  get(i: number): number {
    if (!Number.isInteger(i) || i < 0 || i >= this.count) throw new RangeError(`FloatRing index ${String(i)} out of range`);
    return this.data[(this.head + i) % this.data.length] as number;
  }

  /** Most recent value, or `fallback` when empty. */
  last(fallback = 0): number {
    return this.count === 0 ? fallback : (this.data[(this.head + this.count - 1) % this.data.length] as number);
  }

  /** Sum of retained values. */
  sum(): number {
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.data[(this.head + i) % this.data.length] as number;
    return s;
  }

  /** Mean of retained values (0 when empty). */
  average(): number {
    return this.count === 0 ? 0 : this.sum() / this.count;
  }

  /** Minimum retained value (0 when empty). */
  min(): number {
    if (this.count === 0) return 0;
    let m = Infinity;
    for (let i = 0; i < this.count; i++) m = Math.min(m, this.data[(this.head + i) % this.data.length] as number);
    return m;
  }

  /** Maximum retained value (0 when empty). */
  max(): number {
    if (this.count === 0) return 0;
    let m = -Infinity;
    for (let i = 0; i < this.count; i++) m = Math.max(m, this.data[(this.head + i) % this.data.length] as number);
    return m;
  }

  /**
   * Value below which `q` (0..1) of the retained values lie (nearest rank). Allocates a sorted
   * copy, so use it for reports, not per frame.
   */
  percentile(q: number): number {
    if (this.count === 0) return 0;
    const sorted = new Float64Array(this.count);
    this.copyTo(sorted);
    sorted.sort();
    const rank = Math.min(this.count - 1, Math.max(0, Math.ceil(q * this.count) - 1));
    return sorted[rank] as number;
  }

  /** Copies the retained values (oldest first) into `out`; returns the number copied. */
  copyTo(out: { [index: number]: number; readonly length: number }): number {
    const n = Math.min(this.count, out.length);
    for (let i = 0; i < n; i++) out[i] = this.data[(this.head + i) % this.data.length] as number;
    return n;
  }

  /** Removes all values. */
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
