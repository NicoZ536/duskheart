/**
 * Lean entity component system (docs/ARCHITEKTUR.md "ECS", MASTERPROMPT §3.3).
 *
 * - Entity handle: a plain number, 20 bit index + 12 bit generation (stale handles are detected).
 * - `SparseSet<T>`: object components (dense arrays + sparse index).
 * - `ColumnStore`: hot numeric components as typed array columns, growing by doubling.
 * - `Ecs`: allocator (generations + free list), component registry, deferred destruction,
 *   allocation free queries over the smallest store, snapshot/restore for saves.
 */
import { base64ToTypedArray, typedArrayToBase64 } from './binary';

/** Entity handle: `generation * 2^20 + index`, always a non negative integer below 2^32. */
export type Entity = number;

/** Bits of the entity index. */
export const ENTITY_INDEX_BITS = 20;
/** Bits of the entity generation. */
export const ENTITY_GENERATION_BITS = 12;
/** Maximum number of simultaneously allocated entity indices (2^20). */
export const MAX_ENTITIES = 2 ** ENTITY_INDEX_BITS;
/** Mask extracting the index from a handle. */
export const ENTITY_INDEX_MASK = MAX_ENTITIES - 1;
/** Largest generation before it wraps to 0. */
export const MAX_GENERATION = 2 ** ENTITY_GENERATION_BITS - 1;
/** Handle that never refers to a live entity. */
export const NULL_ENTITY: Entity = -1;
/**
 * Freed indices are only reused once more than this many are waiting. Spreading reuse over many
 * indices delays generation wrap-around (12 bits) for handles that are held for a long time.
 */
export const DEFAULT_MIN_FREE_BEFORE_REUSE = 1024;
/** Initial capacity of allocator arrays and column stores. */
export const ECS_INITIAL_CAPACITY = 256;
/** Consumed free queue entries that trigger compaction of the queue array. */
const FREE_QUEUE_COMPACT_MIN = 64;
/** Initial size of a sparse index (grows by doubling up to `MAX_ENTITIES`). */
const SPARSE_INITIAL = 64;
/** Current `EcsSnapshot` format version. */
export const ECS_SNAPSHOT_VERSION = 1;
const EMPTY_SLOT = -1;
/** `aliveFlags` states: free index, live entity, entity inside `destroy()` (listeners running). */
const SLOT_FREE = 0;
const SLOT_ALIVE = 1;
const SLOT_DESTROYING = 2;

/** Builds a handle from index and generation. */
export function makeEntity(index: number, generation: number): Entity {
  return (generation & MAX_GENERATION) * MAX_ENTITIES + (index & ENTITY_INDEX_MASK);
}

/** Index part of a handle. */
export function entityIndex(e: Entity): number {
  return e & ENTITY_INDEX_MASK;
}

/** Generation part of a handle. */
export function entityGeneration(e: Entity): number {
  return (e >>> ENTITY_INDEX_BITS) & MAX_GENERATION;
}

/** Whether `e` has the shape of a handle (non negative integer below 2^32). */
export function isEntityHandle(e: number): boolean {
  return e >>> 0 === e;
}

function assertHandle(e: Entity): void {
  if (!isEntityHandle(e)) throw new RangeError(`Invalid entity handle ${String(e)}`);
}

function grownSize(current: number, needed: number, max: number): number {
  let size = Math.max(current, 1);
  while (size < needed) size *= 2;
  return Math.min(size, max);
}

/** Minimal interface every component store implements (used by `Ecs` and queries). */
export interface ComponentStorage {
  /** Number of entities in the store. */
  readonly size: number;
  /** Entity at dense position `i` (0 ≤ i < size). */
  entityAt(i: number): Entity;
  /** Dense position (row) of `e`, or -1 (also for stale and malformed handles). */
  indexOf(e: Entity): number;
  has(e: Entity): boolean;
  remove(e: Entity): boolean;
  clear(): void;
}

/**
 * Converts a store to and from JSON compatible data (plain objects, arrays, strings, numbers,
 * booleans, null). `deserialize` receives an empty store.
 */
export interface ComponentSerializer<S extends ComponentStorage> {
  serialize(store: S): unknown;
  deserialize(store: S, data: unknown): void;
}

// ---------------------------------------------------------------------------------------------
// SparseSet
// ---------------------------------------------------------------------------------------------

/** Maps entity index → dense slot; shared by `SparseSet` and `ColumnStore`. */
class SparseIndex {
  slots: Int32Array = new Int32Array(SPARSE_INITIAL).fill(EMPTY_SLOT);

  get(index: number): number {
    return index < this.slots.length ? (this.slots[index] as number) : EMPTY_SLOT;
  }

  set(index: number, slot: number): void {
    if (index >= this.slots.length) {
      const next = new Int32Array(grownSize(this.slots.length, index + 1, MAX_ENTITIES)).fill(EMPTY_SLOT);
      next.set(this.slots);
      this.slots = next;
    }
    this.slots[index] = slot;
  }

  reset(): void {
    this.slots.fill(EMPTY_SLOT);
  }
}

/**
 * Dense slot of `e` in a sparse/dense pair, or -1. Hot path of every lookup and query: no method
 * calls, no allocation. A malformed handle (negative, fractional, ≥ 2^32, NaN) can never equal a
 * stored u32 handle, so the final comparison also rejects it.
 */
function denseSlot(slots: Int32Array, dense: Uint32Array, count: number, e: Entity): number {
  const index = e & ENTITY_INDEX_MASK;
  if (index >= slots.length) return EMPTY_SLOT;
  const slot = slots[index] as number;
  return slot >= 0 && slot < count && dense[slot] === e ? slot : EMPTY_SLOT;
}

/**
 * Sparse set of object components. Dense storage allows allocation free iteration:
 * `for (let i = set.size - 1; i >= 0; i--) { const e = set.entityAt(i); const v = set.valueAt(i); }`
 * (iterate backwards if the loop may remove the current entity).
 */
export class SparseSet<T> implements ComponentStorage {
  private readonly sparse = new SparseIndex();
  private dense = new Uint32Array(ECS_INITIAL_CAPACITY);
  private readonly values: T[] = [];
  private count = 0;

  /** Number of entities in the set. */
  get size(): number {
    return this.count;
  }

  /** Dense entity array; only positions [0, size) are valid. Re-read after adds (it may grow). */
  get entities(): Uint32Array {
    return this.dense;
  }

  /** Dense slot of `e`, or -1. */
  indexOf(e: Entity): number {
    return denseSlot(this.sparse.slots, this.dense, this.count, e);
  }

  has(e: Entity): boolean {
    return this.indexOf(e) >= 0;
  }

  /** Component of `e`, or `undefined`. */
  get(e: Entity): T | undefined {
    const slot = this.indexOf(e);
    return slot >= 0 ? this.values[slot] : undefined;
  }

  /** Adds or replaces the component of `e`. Returns `value`. */
  add(e: Entity, value: T): T {
    assertHandle(e);
    const index = e & ENTITY_INDEX_MASK;
    const slot = this.sparse.get(index);
    if (slot >= 0 && slot < this.count && ((this.dense[slot] as number) & ENTITY_INDEX_MASK) === index) {
      // Same entity, or a stale handle that shares the index: overwrite in place.
      this.dense[slot] = e;
      this.values[slot] = value;
      return value;
    }
    if (this.count === this.dense.length) {
      const next = new Uint32Array(grownSize(this.dense.length, this.count + 1, MAX_ENTITIES));
      next.set(this.dense);
      this.dense = next;
    }
    this.dense[this.count] = e;
    this.values[this.count] = value;
    this.sparse.set(index, this.count);
    this.count++;
    return value;
  }

  /** Removes the component of `e` (swap with the last element). Returns whether it existed. */
  remove(e: Entity): boolean {
    const slot = this.indexOf(e);
    if (slot < 0) return false;
    const last = this.count - 1;
    if (slot !== last) {
      const moved = this.dense[last] as number;
      this.dense[slot] = moved;
      this.values[slot] = this.values[last] as T;
      this.sparse.set(moved & ENTITY_INDEX_MASK, slot);
    }
    this.sparse.set(e & ENTITY_INDEX_MASK, EMPTY_SLOT);
    this.values.pop();
    this.count = last;
    return true;
  }

  /** Entity at dense position `i`. */
  entityAt(i: number): Entity {
    return this.dense[i] as number;
  }

  /** Component at dense position `i`. */
  valueAt(i: number): T {
    return this.values[i] as T;
  }

  /** Calls `cb` for every entry, last to first (removing the current entry is safe). */
  forEach(cb: (value: T, e: Entity) => void): void {
    for (let i = this.count - 1; i >= 0; i--) {
      if (i >= this.count) continue;
      cb(this.values[i] as T, this.dense[i] as number);
    }
  }

  clear(): void {
    this.sparse.reset();
    this.values.length = 0;
    this.count = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// ColumnStore
// ---------------------------------------------------------------------------------------------

/** Element type of a column. */
export type ColumnType = 'f32' | 'f64' | 'i32' | 'u32' | 'u16' | 'u8';
/** Typed array used for a column type. */
export type ColumnArrayOf<K extends ColumnType> = K extends 'f32'
  ? Float32Array
  : K extends 'f64'
    ? Float64Array
    : K extends 'i32'
      ? Int32Array
      : K extends 'u32'
        ? Uint32Array
        : K extends 'u16'
          ? Uint16Array
          : Uint8Array;
/** Column layout of a store, e.g. `{ x: 'f32', y: 'f32' }`. */
export type ColumnSchema = Readonly<Record<string, ColumnType>>;
/** The typed column arrays of a store. */
export type Columns<S extends ColumnSchema> = { readonly [K in keyof S]: ColumnArrayOf<S[K]> };

type AnyColumn = Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

function allocColumn(type: ColumnType, length: number): AnyColumn {
  switch (type) {
    case 'f32':
      return new Float32Array(length);
    case 'f64':
      return new Float64Array(length);
    case 'i32':
      return new Int32Array(length);
    case 'u32':
      return new Uint32Array(length);
    case 'u16':
      return new Uint16Array(length);
    case 'u8':
      return new Uint8Array(length);
  }
}

function decodeColumn(type: ColumnType, b64: string): AnyColumn {
  switch (type) {
    case 'f32':
      return base64ToTypedArray(b64, Float32Array);
    case 'f64':
      return base64ToTypedArray(b64, Float64Array);
    case 'i32':
      return base64ToTypedArray(b64, Int32Array);
    case 'u32':
      return base64ToTypedArray(b64, Uint32Array);
    case 'u16':
      return base64ToTypedArray(b64, Uint16Array);
    case 'u8':
      return base64ToTypedArray(b64, Uint8Array);
  }
}

/**
 * Struct-of-arrays store for hot numeric components. Row `i` of every column belongs to
 * `entityAt(i)`. Columns are reallocated when the store grows, so read `columns` again after
 * `add()`; inside a loop without adds, cache them in locals.
 */
export class ColumnStore<S extends ColumnSchema> implements ComponentStorage {
  readonly schema: S;
  private readonly names: ReadonlyArray<keyof S & string>;
  private cols: Record<string, AnyColumn> = {};
  private colList: AnyColumn[] = [];
  private readonly sparse = new SparseIndex();
  private dense: Uint32Array;
  private count = 0;

  constructor(schema: S, initialCapacity: number = ECS_INITIAL_CAPACITY) {
    if (!Number.isInteger(initialCapacity) || initialCapacity < 1) throw new RangeError('ColumnStore capacity must be an integer ≥ 1');
    const names = Object.keys(schema);
    if (names.length === 0) throw new RangeError('ColumnStore needs at least one column');
    this.schema = schema;
    this.names = names as Array<keyof S & string>;
    this.dense = new Uint32Array(initialCapacity);
    this.allocate(initialCapacity);
  }

  private allocate(capacity: number): void {
    const next: Record<string, AnyColumn> = {};
    const list: AnyColumn[] = [];
    for (const name of this.names) {
      const col = allocColumn(this.schema[name] as ColumnType, capacity);
      const old = this.cols[name];
      if (old !== undefined) col.set(old.subarray(0, this.count));
      next[name] = col;
      list.push(col);
    }
    this.cols = next;
    this.colList = list;
  }

  /** Number of rows. */
  get size(): number {
    return this.count;
  }

  /** Allocated rows. */
  get capacity(): number {
    return this.dense.length;
  }

  /** Column names in schema order. */
  get columnNames(): ReadonlyArray<keyof S & string> {
    return this.names;
  }

  /** All columns (valid rows: [0, size)). */
  get columns(): Columns<S> {
    return this.cols as unknown as Columns<S>;
  }

  /** One column (valid rows: [0, size)). */
  column<K extends keyof S & string>(name: K): ColumnArrayOf<S[K]> {
    const col = this.cols[name];
    if (col === undefined) throw new RangeError(`Unknown column "${name}"`);
    return col as ColumnArrayOf<S[K]>;
  }

  /** Dense entity array; only [0, size) is valid. */
  get entities(): Uint32Array {
    return this.dense;
  }

  /** Row of `e`, or -1. */
  indexOf(e: Entity): number {
    return denseSlot(this.sparse.slots, this.dense, this.count, e);
  }

  has(e: Entity): boolean {
    return this.indexOf(e) >= 0;
  }

  entityAt(i: number): Entity {
    return this.dense[i] as number;
  }

  /** Adds a zeroed row for `e` (or returns its existing row). Returns the row index. */
  add(e: Entity): number {
    assertHandle(e);
    const existing = this.indexOf(e);
    if (existing >= 0) return existing;
    const index = e & ENTITY_INDEX_MASK;
    const stale = this.sparse.get(index);
    if (stale >= 0 && stale < this.count && ((this.dense[stale] as number) & ENTITY_INDEX_MASK) === index) {
      // A stale handle occupies the index: reuse its row.
      this.dense[stale] = e;
      for (let c = 0; c < this.colList.length; c++) (this.colList[c] as AnyColumn)[stale] = 0;
      return stale;
    }
    if (this.count === this.dense.length) {
      const capacity = grownSize(this.dense.length, this.count + 1, MAX_ENTITIES);
      const next = new Uint32Array(capacity);
      next.set(this.dense);
      this.dense = next;
      this.allocate(capacity);
    }
    const row = this.count;
    this.dense[row] = e;
    for (let c = 0; c < this.colList.length; c++) (this.colList[c] as AnyColumn)[row] = 0;
    this.sparse.set(index, row);
    this.count++;
    return row;
  }

  /** Removes the row of `e` (last row moves into its place). Returns whether it existed. */
  remove(e: Entity): boolean {
    const row = this.indexOf(e);
    if (row < 0) return false;
    const last = this.count - 1;
    if (row !== last) {
      const moved = this.dense[last] as number;
      this.dense[row] = moved;
      for (let c = 0; c < this.colList.length; c++) {
        const col = this.colList[c] as AnyColumn;
        col[row] = col[last] as number;
      }
      this.sparse.set(moved & ENTITY_INDEX_MASK, row);
    }
    this.sparse.set(e & ENTITY_INDEX_MASK, EMPTY_SLOT);
    this.count = last;
    return true;
  }

  /** Value of column `name` for `e`. Throws if `e` has no row. */
  get(e: Entity, name: keyof S & string): number {
    const row = this.indexOf(e);
    if (row < 0) throw new RangeError(`Entity ${e} has no row in this store`);
    return this.column(name)[row] as number;
  }

  /** Sets column `name` for `e`. Throws if `e` has no row. */
  set(e: Entity, name: keyof S & string, value: number): void {
    const row = this.indexOf(e);
    if (row < 0) throw new RangeError(`Entity ${e} has no row in this store`);
    this.column(name)[row] = value;
  }

  clear(): void {
    this.sparse.reset();
    this.count = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------------------------

/**
 * Serializer for a `SparseSet<T>`: `{ e: number[], v: unknown[] }` in dense order.
 * `decode` validates each stored value; `encode` converts a value to JSON data (default: as is).
 */
export function sparseSetSerializer<T>(
  decode: (raw: unknown) => T,
  encode: (value: T) => unknown = (value) => value,
): ComponentSerializer<SparseSet<T>> {
  return {
    serialize(store) {
      const e: number[] = [];
      const v: unknown[] = [];
      for (let i = 0; i < store.size; i++) {
        e.push(store.entityAt(i));
        v.push(encode(store.valueAt(i)));
      }
      return { e, v };
    },
    deserialize(store, data) {
      if (typeof data !== 'object' || data === null) throw new TypeError('SparseSet data must be an object');
      const { e, v } = data as { e?: unknown; v?: unknown };
      if (!Array.isArray(e) || !Array.isArray(v) || e.length !== v.length) throw new TypeError('SparseSet data needs arrays e and v of equal length');
      for (let i = 0; i < e.length; i++) {
        const ent: unknown = e[i];
        if (typeof ent !== 'number' || !isEntityHandle(ent)) throw new TypeError(`Invalid entity in SparseSet data at ${i}`);
        store.add(ent, decode(v[i]));
      }
    },
  };
}

/** Serializer for a `ColumnStore`: entities and each column as base64 (exact, compact). */
export function columnStoreSerializer<S extends ColumnSchema>(): ComponentSerializer<ColumnStore<S>> {
  return {
    serialize(store) {
      const n = store.size;
      const cols: Record<string, string> = {};
      for (const name of store.columnNames) cols[name] = typedArrayToBase64(store.column(name).subarray(0, n));
      return { n, e: typedArrayToBase64(store.entities.subarray(0, n)), c: cols };
    },
    deserialize(store, data) {
      if (typeof data !== 'object' || data === null) throw new TypeError('ColumnStore data must be an object');
      const { n, e, c } = data as { n?: unknown; e?: unknown; c?: unknown };
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || typeof e !== 'string' || typeof c !== 'object' || c === null) {
        throw new TypeError('ColumnStore data needs n, e and c');
      }
      const ents = base64ToTypedArray(e, Uint32Array);
      if (ents.length !== n) throw new TypeError('ColumnStore entity count mismatch');
      const colData = c as Record<string, unknown>;
      const decoded: Array<{ name: keyof S & string; values: AnyColumn }> = [];
      for (const name of store.columnNames) {
        const raw = colData[name];
        if (typeof raw !== 'string') throw new TypeError(`ColumnStore data lacks column "${name}"`);
        const values = decodeColumn(store.schema[name] as ColumnType, raw);
        if (values.length !== n) throw new TypeError(`ColumnStore column "${name}" length mismatch`);
        decoded.push({ name, values });
      }
      for (let i = 0; i < n; i++) {
        const row = store.add(ents[i] as number);
        for (const { name, values } of decoded) store.column(name)[row] = values[i] as number;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

/**
 * Calls `cb` for every entity present in all `stores`, iterating the smallest store backwards.
 * Allocation free when `stores` and `cb` are created once. Removing the current entity inside
 * `cb` is safe; destroy other entities with `Ecs.queueDestroy` instead.
 */
export function queryEach(stores: ReadonlyArray<ComponentStorage>, cb: (e: Entity) => void): void {
  const n = stores.length;
  if (n === 0) return;
  let smallest = stores[0] as ComponentStorage;
  for (let s = 1; s < n; s++) {
    const st = stores[s] as ComponentStorage;
    if (st.size < smallest.size) smallest = st;
  }
  for (let i = smallest.size - 1; i >= 0; i--) {
    if (i >= smallest.size) continue;
    const e = smallest.entityAt(i);
    let all = true;
    for (let s = 0; s < n; s++) {
      const st = stores[s] as ComponentStorage;
      if (st !== smallest && st.indexOf(e) < 0) {
        all = false;
        break;
      }
    }
    if (all) cb(e);
  }
}

/** A reusable query over a fixed set of stores. */
export class Query {
  /**
   * Rows of the current entity in each store (same order as `stores`), filled for `eachRow`
   * callbacks. Shared scratch buffer: valid only inside the callback.
   */
  readonly rows: Int32Array;

  constructor(readonly stores: ReadonlyArray<ComponentStorage>) {
    this.rows = new Int32Array(Math.max(1, stores.length));
  }

  /** See `queryEach`. */
  each(cb: (e: Entity) => void): void {
    queryEach(this.stores, cb);
  }

  /**
   * Like `each`, but also hands the callback the entity's row in every store (`rows[k]` belongs to
   * `stores[k]`), so hot loops read typed array columns without a second lookup. Iterates the
   * smallest store backwards; removing the current entity inside `cb` is safe. Allocation free.
   */
  eachRow(cb: (e: Entity, rows: Int32Array) => void): void {
    const stores = this.stores;
    const rows = this.rows;
    const n = stores.length;
    if (n === 0) return;
    let smallestIndex = 0;
    for (let s = 1; s < n; s++) if ((stores[s] as ComponentStorage).size < (stores[smallestIndex] as ComponentStorage).size) smallestIndex = s;
    const smallest = stores[smallestIndex] as ComponentStorage;
    if (n === 2) {
      // Most systems join two stores (position + velocity …): one lookup per entity, no inner loop.
      const otherIndex = 1 - smallestIndex;
      const other = stores[otherIndex] as ComponentStorage;
      for (let i = smallest.size - 1; i >= 0; i--) {
        if (i >= smallest.size) continue;
        const e = smallest.entityAt(i);
        const row = other.indexOf(e);
        if (row < 0) continue;
        rows[smallestIndex] = i;
        rows[otherIndex] = row;
        cb(e, rows);
      }
      return;
    }
    for (let i = smallest.size - 1; i >= 0; i--) {
      if (i >= smallest.size) continue;
      const e = smallest.entityAt(i);
      let all = true;
      for (let s = 0; s < n; s++) {
        if (s === smallestIndex) {
          rows[s] = i;
          continue;
        }
        const row = (stores[s] as ComponentStorage).indexOf(e);
        if (row < 0) {
          all = false;
          break;
        }
        rows[s] = row;
      }
      if (all) cb(e, rows);
    }
  }

  /** Number of matching entities (allocation free). */
  count(): number {
    const stores = this.stores;
    const n = stores.length;
    if (n === 0) return 0;
    let smallest = stores[0] as ComponentStorage;
    for (let s = 1; s < n; s++) {
      const st = stores[s] as ComponentStorage;
      if (st.size < smallest.size) smallest = st;
    }
    let count = 0;
    for (let i = 0; i < smallest.size; i++) {
      const e = smallest.entityAt(i);
      let all = true;
      for (let s = 0; s < n; s++) {
        const st = stores[s] as ComponentStorage;
        if (st !== smallest && st.indexOf(e) < 0) {
          all = false;
          break;
        }
      }
      if (all) count++;
    }
    return count;
  }
}

// ---------------------------------------------------------------------------------------------
// Ecs
// ---------------------------------------------------------------------------------------------

/** Options for `Ecs`. */
export interface EcsOptions {
  /** See `DEFAULT_MIN_FREE_BEFORE_REUSE`. */
  minFreeBeforeReuse?: number;
}

/** Serialized world state of an `Ecs` (plain JSON data). */
export interface EcsSnapshot {
  readonly version: number;
  /** Number of indices ever allocated. */
  readonly highWater: number;
  /** Base64 `Uint16Array(highWater)` of generations. */
  readonly generations: string;
  /** Base64 `Uint32Array` of free indices in reuse order. */
  readonly free: string;
  /** Handles queued for deferred destruction. */
  readonly pendingDestroy: readonly number[];
  /** Serialized data per registered component name (only stores with a serializer). */
  readonly components: Readonly<Record<string, unknown>>;
}

interface Registration {
  readonly name: string;
  readonly store: ComponentStorage;
  readonly serializer: ComponentSerializer<ComponentStorage> | undefined;
}

/** Entity allocator + component registry. */
export class Ecs {
  private generations = new Uint16Array(ECS_INITIAL_CAPACITY);
  private aliveFlags = new Uint8Array(ECS_INITIAL_CAPACITY);
  private highWater = 0;
  private freeQueue: number[] = [];
  private freeHead = 0;
  private aliveCount = 0;
  private readonly minFreeBeforeReuse: number;
  private readonly registrations: Registration[] = [];
  private readonly byName = new Map<string, Registration>();
  private pending: Entity[] = [];
  private readonly destroyListeners: Array<(e: Entity) => void> = [];

  constructor(options: EcsOptions = {}) {
    const minFree = options.minFreeBeforeReuse ?? DEFAULT_MIN_FREE_BEFORE_REUSE;
    if (!Number.isInteger(minFree) || minFree < 0) throw new RangeError('minFreeBeforeReuse must be an integer ≥ 0');
    this.minFreeBeforeReuse = minFree;
  }

  /** Number of live entities. */
  get count(): number {
    return this.aliveCount;
  }

  /** Number of entity indices ever allocated. */
  get indexCount(): number {
    return this.highWater;
  }

  /** Number of handles waiting in the deferred destruction queue. */
  get pendingDestroyCount(): number {
    return this.pending.length;
  }

  private freeLength(): number {
    return this.freeQueue.length - this.freeHead;
  }

  private ensureIndexCapacity(needed: number): void {
    if (needed <= this.generations.length) return;
    const size = grownSize(this.generations.length, needed, MAX_ENTITIES);
    const gens = new Uint16Array(size);
    gens.set(this.generations);
    const alive = new Uint8Array(size);
    alive.set(this.aliveFlags);
    this.generations = gens;
    this.aliveFlags = alive;
  }

  /** Allocates a new entity. Throws when all 2^20 indices are live. */
  create(): Entity {
    const free = this.freeLength();
    let index: number;
    if (free > this.minFreeBeforeReuse || (free > 0 && this.highWater >= MAX_ENTITIES)) {
      index = this.freeQueue[this.freeHead] as number;
      this.freeHead++;
      if (this.freeHead >= FREE_QUEUE_COMPACT_MIN && this.freeHead * 2 >= this.freeQueue.length) {
        this.freeQueue = this.freeQueue.slice(this.freeHead);
        this.freeHead = 0;
      }
    } else if (this.highWater < MAX_ENTITIES) {
      index = this.highWater++;
      this.ensureIndexCapacity(this.highWater);
    } else {
      throw new RangeError(`Entity limit of ${MAX_ENTITIES} reached`);
    }
    this.aliveFlags[index] = SLOT_ALIVE;
    this.aliveCount++;
    return makeEntity(index, this.generations[index] as number);
  }

  /** Whether `e` refers to a live entity (false for stale or malformed handles). */
  alive(e: Entity): boolean {
    if (e >>> 0 !== e) return false;
    const index = e & ENTITY_INDEX_MASK;
    return index < this.highWater && this.aliveFlags[index] === SLOT_ALIVE && this.generations[index] === e >>> ENTITY_INDEX_BITS;
  }

  /**
   * Registers a callback that runs before an entity's components are removed. Inside the callback
   * the components are still readable, but `alive(e)` is already false (so a listener that
   * destroys related entities can never destroy `e` twice).
   */
  onDestroy(listener: (e: Entity) => void): () => void {
    this.destroyListeners.push(listener);
    return () => {
      const i = this.destroyListeners.indexOf(listener);
      if (i >= 0) this.destroyListeners.splice(i, 1);
    };
  }

  /** Destroys `e` immediately and removes it from every registered store. */
  destroy(e: Entity): boolean {
    if (!this.alive(e)) return false;
    const index = e & ENTITY_INDEX_MASK;
    // Mark first: a listener that (directly or indirectly) destroys `e` again is a no-op instead of
    // pushing the index onto the free list twice.
    this.aliveFlags[index] = SLOT_DESTROYING;
    try {
      for (let i = 0; i < this.destroyListeners.length; i++) (this.destroyListeners[i] as (e: Entity) => void)(e);
    } finally {
      for (let i = 0; i < this.registrations.length; i++) (this.registrations[i] as Registration).store.remove(e);
      this.aliveFlags[index] = SLOT_FREE;
      this.generations[index] = ((this.generations[index] as number) + 1) & MAX_GENERATION;
      this.freeQueue.push(index);
      this.aliveCount--;
    }
    return true;
  }

  /** Queues `e` for destruction at `flushDestroyed()` (safe during iteration). */
  queueDestroy(e: Entity): void {
    this.pending.push(e);
  }

  /** Destroys all queued entities (typically at tick end). Returns the number destroyed. */
  flushDestroyed(): number {
    let n = 0;
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      for (let i = 0; i < batch.length; i++) if (this.destroy(batch[i] as Entity)) n++;
    }
    return n;
  }

  /** Registers a component store under a unique name. Returns the store. */
  registerComponent<S extends ComponentStorage>(name: string, store: S, serializer?: ComponentSerializer<S>): S {
    if (this.byName.has(name)) throw new Error(`Component "${name}" is already registered`);
    if (this.registrations.some((r) => r.store === store)) throw new Error(`Store for "${name}" is already registered`);
    const reg: Registration = { name, store, serializer: serializer as ComponentSerializer<ComponentStorage> | undefined };
    this.registrations.push(reg);
    this.byName.set(name, reg);
    return store;
  }

  /** The store registered under `name`, if any. */
  component(name: string): ComponentStorage | undefined {
    return this.byName.get(name)?.store;
  }

  /** Registered component names in registration order. */
  componentNames(): string[] {
    return this.registrations.map((r) => r.name);
  }

  /** See `queryEach`. */
  query(stores: ReadonlyArray<ComponentStorage>, cb: (e: Entity) => void): void {
    queryEach(stores, cb);
  }

  /** Calls `cb` for every live entity in ascending index order. */
  forEachAlive(cb: (e: Entity) => void): void {
    for (let i = 0; i < this.highWater; i++) {
      if (this.aliveFlags[i] === SLOT_ALIVE) cb(makeEntity(i, this.generations[i] as number));
    }
  }

  /** Destroys everything and resets the allocator (registrations stay). */
  reset(): void {
    for (const r of this.registrations) r.store.clear();
    this.generations = new Uint16Array(ECS_INITIAL_CAPACITY);
    this.aliveFlags = new Uint8Array(ECS_INITIAL_CAPACITY);
    this.highWater = 0;
    this.freeQueue = [];
    this.freeHead = 0;
    this.aliveCount = 0;
    this.pending = [];
  }

  /** Serializes allocator state and every component registered with a serializer. */
  snapshot(): EcsSnapshot {
    const components: Record<string, unknown> = {};
    for (const r of this.registrations) if (r.serializer !== undefined) components[r.name] = r.serializer.serialize(r.store);
    return {
      version: ECS_SNAPSHOT_VERSION,
      highWater: this.highWater,
      generations: typedArrayToBase64(this.generations.subarray(0, this.highWater)),
      free: typedArrayToBase64(Uint32Array.from(this.freeQueue.slice(this.freeHead))),
      pendingDestroy: this.pending.slice(),
      components,
    };
  }

  /**
   * Restores a snapshot: all stores are cleared, the allocator is rebuilt exactly (same handles),
   * and registered serializers load their data. Throws on malformed or inconsistent data; after a
   * failed component load the ECS is left empty (reset).
   */
  restore(snapshot: unknown): void {
    if (typeof snapshot !== 'object' || snapshot === null) throw new TypeError('ECS snapshot must be an object');
    const s = snapshot as Partial<Record<keyof EcsSnapshot, unknown>>;
    if (s.version !== ECS_SNAPSHOT_VERSION) throw new TypeError(`Unsupported ECS snapshot version ${String(s.version)}`);
    const highWater = s.highWater;
    if (typeof highWater !== 'number' || !Number.isInteger(highWater) || highWater < 0 || highWater > MAX_ENTITIES) {
      throw new TypeError('ECS snapshot highWater invalid');
    }
    if (typeof s.generations !== 'string' || typeof s.free !== 'string') throw new TypeError('ECS snapshot allocator data missing');
    const gens = base64ToTypedArray(s.generations, Uint16Array);
    if (gens.length !== highWater) throw new TypeError('ECS snapshot generation count mismatch');
    const free = base64ToTypedArray(s.free, Uint32Array);
    const pending = s.pendingDestroy;
    if (!Array.isArray(pending) || !pending.every((p): p is number => typeof p === 'number' && isEntityHandle(p))) {
      throw new TypeError('ECS snapshot pendingDestroy invalid');
    }
    const comps = s.components;
    if (typeof comps !== 'object' || comps === null || Array.isArray(comps)) throw new TypeError('ECS snapshot components invalid');
    const compData = comps as Record<string, unknown>;
    for (const name of Object.keys(compData)) {
      const reg = this.byName.get(name);
      if (reg === undefined || reg.serializer === undefined) throw new TypeError(`ECS snapshot contains unknown component "${name}"`);
    }

    const alive = new Uint8Array(Math.max(highWater, ECS_INITIAL_CAPACITY)).fill(SLOT_FREE);
    alive.fill(SLOT_ALIVE, 0, highWater);
    for (let i = 0; i < free.length; i++) {
      const idx = free[i] as number;
      if (idx >= highWater || alive[idx] === SLOT_FREE) throw new TypeError(`ECS snapshot free list invalid at ${i}`);
      alive[idx] = SLOT_FREE;
    }
    const generations = new Uint16Array(alive.length);
    generations.set(gens);
    for (let i = 0; i < highWater; i++) if ((generations[i] as number) > MAX_GENERATION) throw new TypeError('ECS snapshot generation out of range');

    this.reset();
    this.generations = generations;
    this.aliveFlags = alive;
    this.highWater = highWater;
    this.freeQueue = Array.from(free);
    this.freeHead = 0;
    this.aliveCount = highWater - free.length;
    this.pending = pending.slice();

    try {
      for (const r of this.registrations) {
        const data = compData[r.name];
        if (data === undefined || r.serializer === undefined) continue;
        r.serializer.deserialize(r.store, data);
        for (let i = 0; i < r.store.size; i++) {
          const e = r.store.entityAt(i);
          if (!this.alive(e)) throw new TypeError(`ECS snapshot component "${r.name}" references dead entity ${e}`);
        }
      }
    } catch (err) {
      // Never leave a half restored world behind.
      this.reset();
      throw err;
    }
  }
}
