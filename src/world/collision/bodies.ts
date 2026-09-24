/**
 * Entity bodies in a spatial hash grid (MASTERPROMPT §3.3 "räumliches Hash-Grid für Entitäten",
 * M2-23).
 *
 * `BodyGrid` holds one circle per entity and layer for the current tick. Moving creatures change
 * cells all the time, so the grid is rebuilt every tick from the positions instead of being updated
 * body by body: `clear()`, `add…` per entity (or `addColumns` for a whole ECS column set), `build()` –
 * a counting sort of the bodies by the hash of their centre cell into flat typed arrays. That costs
 * a few nanoseconds per body and no allocation, where the incremental, map-backed `SpatialHash` of
 * the engine (meant for sparse, rarely moving boxes) costs about a microsecond per moving body.
 *
 * Bodies are addressed by their index in the current build (`idOf` maps back to the id). Queries
 * write the indices of the bodies whose circle overlaps a circle (touching counts) into an
 * `Int32Array`; `queryBody` uses a body's own circle and takes only an index, so a per-tick loop over
 * all bodies passes no coordinates across calls (V8 would box them). `sweep` finds the first body a
 * moving circle (projectile) touches along a segment – the entity half of the swept projectile test
 * (`sweepCircle` is the tile half). Order is deterministic: cell by cell (rows, then columns), within
 * a cell in insertion order; sweeps report the earliest contact, ties by the smaller index. The grid
 * is derived state (rebuilt from positions) and not saved.
 */
import { LAYER_COUNT, TILE_PX, layerIndex as layerIndexImport, type Layer } from '../model/coords';

// Module-local alias: bundler module wrappers turn imported bindings into getter calls (hot path).
const layerIndex = layerIndexImport;

/** Default cell edge of the body grid [tiles]: four tiles, so a creature's neighbourhood spans few cells. */
const BODY_CELL_TILES = 4;
/** Default cell edge of the body grid [px]. */
export const BODY_CELL_PX = BODY_CELL_TILES * TILE_PX;
/** Initial body capacity (grows by doubling). */
const INITIAL_CAPACITY = 256;
/** Hash buckets per body (power-of-two table of at least this many buckets per body). */
const BUCKETS_PER_BODY = 2;
/** Smallest bucket table. */
const MIN_BUCKETS = 64;
/** Most cells a query walks before it scans all bodies instead (huge queries). */
const MAX_QUERY_CELLS = 64;
/** Hash multipliers (odd 32 bit constants with good bit mixing). */
const HASH_X = 0x9e37_79b1;
const HASH_Y = 0x85eb_ca77;
const HASH_LAYER = 0xc2b2_ae3d;
/** Most pairs `overlapPairs` reports per body as the smaller index (a body overlapping more is a degenerate pile-up). */
const MAX_PAIR_NEIGHBOURS = 64;
/** Scratch indices of the query circle. */
const QX = 0;
const QY = 1;
const QR = 2;
const QX1 = 3;
const QY1 = 4;

/** First body touched by a sweep. */
export interface BodyHit {
  hit: boolean;
  /** Index of the body in the current build, −1 without hit. */
  index: number;
  /** Id of the body (0 without hit). */
  id: number;
  /** Fraction of the segment until the contact, 0…1 (1 without hit). */
  t: number;
  /** Centre of the moving circle at the contact [px]. */
  x: number;
  y: number;
}

/** A zeroed body hit (allocate once, reuse). */
export function createBodyHit(): BodyHit {
  return { hit: false, index: -1, id: 0, t: 1, x: 0, y: 0 };
}

/** Circles of the entities of one tick, indexed by a spatial hash grid. */
export class BodyGrid {
  readonly cellSizePx: number;
  private readonly invCell: number;
  private capacity = INITIAL_CAPACITY;
  private n = 0;
  private built = false;
  private ids = new Float64Array(INITIAL_CAPACITY);
  private xs = new Float64Array(INITIAL_CAPACITY);
  private ys = new Float64Array(INITIAL_CAPACITY);
  private rs = new Float64Array(INITIAL_CAPACITY);
  private layers = new Uint8Array(INITIAL_CAPACITY);
  private buckets = new Uint32Array(INITIAL_CAPACITY);
  /** Body indices sorted by bucket. */
  private order = new Uint32Array(INITIAL_CAPACITY);
  /** Start of each bucket in `order` (length = buckets + 1). */
  private start = new Uint32Array(MIN_BUCKETS + 1);
  private bucketMask = MIN_BUCKETS - 1;
  private readonly maxR = new Float64Array(LAYER_COUNT);
  private readonly visited = new Int32Array(MAX_QUERY_CELLS);
  private readonly q = new Float64Array(QY1 + 1);

  constructor(cellSizePx: number = BODY_CELL_PX) {
    if (!(cellSizePx > 0) || !Number.isFinite(cellSizePx)) throw new RangeError(`BodyGrid: cell size must be > 0, got ${String(cellSizePx)}`);
    this.cellSizePx = cellSizePx;
    this.invCell = 1 / cellSizePx;
  }

  /** Number of bodies added since the last `clear`. */
  get size(): number {
    return this.n;
  }

  /** Id of the body at `index`. */
  idOf(index: number): number {
    return this.ids[this.checkIndex(index)] as number;
  }

  /** Writes the circle of the body at `index` into `out`. */
  circleOf(index: number, out: { x: number; y: number; r: number }): void {
    const i = this.checkIndex(index);
    out.x = this.xs[i] as number;
    out.y = this.ys[i] as number;
    out.r = this.rs[i] as number;
  }

  /** Removes all bodies (start of a tick). */
  clear(): void {
    this.n = 0;
    this.built = false;
    this.maxR.fill(0);
  }

  /** Adds the body `id`: a circle of radius `r` [px] at (x, y) on `layer`. Returns its index. Call `build` before querying. */
  add(id: number, layer: Layer, x: number, y: number, r: number): number {
    const i = this.push(id, layerIndex(layer));
    this.xs[i] = x;
    this.ys[i] = y;
    this.rs[i] = r;
    this.checkBody(i);
    return i;
  }

  /** Adds `count` bodies from columns (e.g. ECS columns) on one layer; indices continue from `size`. */
  addColumns(count: number, ids: ArrayLike<number>, layer: Layer, x: ArrayLike<number>, y: ArrayLike<number>, r: ArrayLike<number>): void {
    if (ids.length < count || x.length < count || y.length < count || r.length < count) throw new RangeError(`BodyGrid.addColumns: every column needs at least ${count} entries`);
    while (this.capacity < this.n + count) this.grow();
    const li = layerIndex(layer);
    const base = this.n;
    const bodyIds = this.ids;
    const xs = this.xs;
    const ys = this.ys;
    const rs = this.rs;
    const layers = this.layers;
    let maxR = this.maxR[li] as number;
    for (let k = 0; k < count; k++) {
      const bx = x[k] as number;
      const by = y[k] as number;
      const br = r[k] as number;
      // `v - v === 0` is false exactly for NaN and ±Infinity.
      if (!(br >= 0) || bx - bx !== 0 || by - by !== 0 || br - br !== 0) {
        throw new RangeError(`BodyGrid: invalid body ${String(ids[k])} (${String(bx)}, ${String(by)}, r ${String(br)})`);
      }
      const i = base + k;
      bodyIds[i] = ids[k] as number;
      xs[i] = bx;
      ys[i] = by;
      rs[i] = br;
      layers[i] = li;
      if (br > maxR) maxR = br;
    }
    this.maxR[li] = maxR;
    this.n = base + count;
    this.built = false;
  }

  /** Sorts the bodies into the hash grid (counting sort, stable: insertion order within a bucket). */
  build(): void {
    const n = this.n;
    let buckets = MIN_BUCKETS;
    while (buckets < n * BUCKETS_PER_BODY) buckets *= 2;
    if (this.start.length < buckets + 1) this.start = new Uint32Array(buckets + 1);
    this.bucketMask = buckets - 1;
    const start = this.start;
    start.fill(0, 0, buckets + 1);
    const inv = this.invCell;
    const mask = this.bucketMask;
    const xs = this.xs;
    const ys = this.ys;
    const layers = this.layers;
    const bucketOfBody = this.buckets;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((xs[i] as number) * inv);
      const cy = Math.floor((ys[i] as number) * inv);
      const b = (Math.imul(cx, HASH_X) ^ (Math.imul(cy, HASH_Y) ^ Math.imul((layers[i] as number) + 1, HASH_LAYER))) & mask;
      bucketOfBody[i] = b;
      start[b + 1] = (start[b + 1] as number) + 1;
    }
    for (let b = 0; b < buckets; b++) start[b + 1] = (start[b + 1] as number) + (start[b] as number);
    // start[b] … start[b + 1] is bucket b. Fill each bucket from its back so the order stays stable;
    // afterwards start[b + 1] holds the first index of bucket b.
    for (let i = n - 1; i >= 0; i--) {
      const b = this.buckets[i] as number;
      const at = (start[b + 1] as number) - 1;
      start[b + 1] = at;
      this.order[at] = i;
    }
    for (let b = 0; b < buckets; b++) start[b] = start[b + 1] as number;
    start[buckets] = n;
    this.built = true;
  }

  /**
   * Indices of the bodies on `layer` whose circle overlaps the circle (x, y, r) (touching counts),
   * except `ignoreIndex`. Writes up to `out.length` indices and returns the number of overlaps.
   */
  queryCircle(layer: Layer, x: number, y: number, r: number, out: Int32Array, ignoreIndex = -1): number {
    this.checkBuilt();
    this.q[QX] = x;
    this.q[QY] = y;
    this.q[QR] = r;
    return this.scan(layerIndex(layer), out, ignoreIndex, -1);
  }

  /** Indices of the other bodies on its layer that overlap the body at `index` (see `queryCircle`). */
  queryBody(index: number, out: Int32Array): number {
    this.checkBuilt();
    const i = this.checkIndex(index);
    this.q[QX] = this.xs[i] as number;
    this.q[QY] = this.ys[i] as number;
    this.q[QR] = this.rs[i] as number;
    return this.scan(this.layers[i] as number, out, i, -1);
  }

  /**
   * All pairs of overlapping bodies on the same layer (touching counts), each pair once with the
   * smaller index first: `out[2k]`, `out[2k + 1]`, in bucket order (deterministic for the same
   * bodies). Writes up to `out.length / 2` pairs and returns the number of pairs found (entity
   * separation, melee contact). A body that overlaps more than `MAX_PAIR_NEIGHBOURS` bodies with a
   * larger index (a degenerate pile-up) reports only the first of them in scan order.
   */
  overlapPairs(out: Int32Array): number {
    this.checkBuilt();
    const cap = out.length >> 1;
    const n = this.n;
    const xs = this.xs;
    const ys = this.ys;
    const rs = this.rs;
    const layers = this.layers;
    const order = this.order;
    const start = this.start;
    const visited = this.visited;
    const maxR = this.maxR;
    const mask = this.bucketMask;
    const inv = this.invCell;
    let pairs = 0;
    // The per-body scan of `scan`, inlined: this loop runs for every body of every tick. Bucket order:
    // consecutive bodies share cells, so their neighbourhoods are already in the cache. Each pair is
    // reported by its smaller index (only bodies with a larger index count).
    for (let k = 0; k < n; k++) {
      const i = order[k] as number;
      const x = xs[i] as number;
      const y = ys[i] as number;
      const r = rs[i] as number;
      const li = layers[i] as number;
      const reach = r + (maxR[li] as number);
      const cx0 = Math.floor((x - reach) * inv);
      const cy0 = Math.floor((y - reach) * inv);
      const cx1 = Math.floor((x + reach) * inv);
      const cy1 = Math.floor((y + reach) * inv);
      let listed = 0;
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_QUERY_CELLS) {
        for (let j = i + 1; j < n && listed < MAX_PAIR_NEIGHBOURS; j++) {
          if (layers[j] !== li) continue;
          const ex = (xs[j] as number) - x;
          const ey = (ys[j] as number) - y;
          const d = (rs[j] as number) + r;
          if (ex * ex + ey * ey > d * d) continue;
          if (pairs < cap) {
            out[pairs << 1] = i;
            out[(pairs << 1) + 1] = j;
          }
          pairs++;
          listed++;
        }
        continue;
      }
      const layerHash = Math.imul(li + 1, HASH_LAYER);
      let visitedCount = 0;
      for (let cy = cy0; cy <= cy1 && listed < MAX_PAIR_NEIGHBOURS; cy++) {
        const rowHash = Math.imul(cy, HASH_Y) ^ layerHash;
        for (let cx = cx0; cx <= cx1 && listed < MAX_PAIR_NEIGHBOURS; cx++) {
          const b = (Math.imul(cx, HASH_X) ^ rowHash) & mask;
          let seen = false;
          for (let v = 0; v < visitedCount; v++) {
            if (visited[v] === b) {
              seen = true;
              break;
            }
          }
          if (seen) continue;
          visited[visitedCount++] = b;
          const end = start[b + 1] as number;
          for (let s = start[b] as number; s < end && listed < MAX_PAIR_NEIGHBOURS; s++) {
            const j = order[s] as number;
            if (j <= i || layers[j] !== li) continue;
            const ex = (xs[j] as number) - x;
            const ey = (ys[j] as number) - y;
            const d = (rs[j] as number) + r;
            if (ex * ex + ey * ey > d * d) continue;
            if (pairs < cap) {
              out[pairs << 1] = i;
              out[(pairs << 1) + 1] = j;
            }
            pairs++;
            listed++;
          }
        }
      }
    }
    return pairs;
  }

  /**
   * First body on `layer` touched by a circle of radius `r` moving from (x0, y0) to (x1, y1), except
   * `ignoreIndex` (the shooter). Bodies overlapping the start count as hit at t = 0.
   */
  sweep(layer: Layer, x0: number, y0: number, x1: number, y1: number, r: number, out: BodyHit, ignoreIndex = -1): BodyHit {
    this.checkBuilt();
    const q = this.q;
    q[QX] = x0;
    q[QY] = y0;
    q[QR] = r;
    q[QX1] = x1;
    q[QY1] = y1;
    const li = layerIndex(layer);
    const reach = r + (this.maxR[li] as number);
    const inv = this.invCell;
    const cx0 = Math.floor((Math.min(x0, x1) - reach) * inv);
    const cy0 = Math.floor((Math.min(y0, y1) - reach) * inv);
    const cx1 = Math.floor((Math.max(x0, x1) + reach) * inv);
    const cy1 = Math.floor((Math.max(y0, y1) + reach) * inv);
    out.hit = false;
    out.t = 1;
    out.index = -1;
    out.id = 0;
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_QUERY_CELLS) {
      for (let i = 0; i < this.n; i++) if (this.layers[i] === li && i !== ignoreIndex) this.sweepBody(i, out);
    } else {
      let visitedCount = 0;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const b = this.bucketOf(li, cx, cy);
          if (this.seen(b, visitedCount)) continue;
          this.visited[visitedCount++] = b;
          const end = this.start[b + 1] as number;
          for (let k = this.start[b] as number; k < end; k++) {
            const i = this.order[k] as number;
            if (this.layers[i] === li && i !== ignoreIndex) this.sweepBody(i, out);
          }
        }
      }
    }
    if (out.hit) out.id = this.ids[out.index] as number;
    out.x = x0 + (x1 - x0) * out.t;
    out.y = y0 + (y1 - y0) * out.t;
    return out;
  }

  /** Overlap scan around the circle in the scratch `q` on layer index `li`; only bodies with an index above `after` count. */
  private scan(li: number, out: Int32Array, ignoreIndex: number, after: number): number {
    const x = this.q[QX] as number;
    const y = this.q[QY] as number;
    const r = this.q[QR] as number;
    const reach = r + (this.maxR[li] as number);
    const inv = this.invCell;
    const cx0 = Math.floor((x - reach) * inv);
    const cy0 = Math.floor((y - reach) * inv);
    const cx1 = Math.floor((x + reach) * inv);
    const cy1 = Math.floor((y + reach) * inv);
    const xs = this.xs;
    const ys = this.ys;
    const rs = this.rs;
    const layers = this.layers;
    const cap = out.length;
    let found = 0;
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_QUERY_CELLS) {
      for (let i = 0; i < this.n; i++) {
        if (layers[i] !== li || i === ignoreIndex || i <= after) continue;
        const ex = (xs[i] as number) - x;
        const ey = (ys[i] as number) - y;
        const d = (rs[i] as number) + r;
        if (ex * ex + ey * ey <= d * d) {
          if (found < cap) out[found] = i;
          found++;
        }
      }
      return found;
    }
    const start = this.start;
    const order = this.order;
    const visited = this.visited;
    const mask = this.bucketMask;
    const layerHash = Math.imul(li + 1, HASH_LAYER);
    let visitedCount = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      const rowHash = Math.imul(cy, HASH_Y) ^ layerHash;
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = (Math.imul(cx, HASH_X) ^ rowHash) & mask;
        let seen = false;
        for (let v = 0; v < visitedCount; v++) {
          if (visited[v] === b) {
            seen = true;
            break;
          }
        }
        if (seen) continue;
        visited[visitedCount++] = b;
        const end = start[b + 1] as number;
        for (let k = start[b] as number; k < end; k++) {
          const i = order[k] as number;
          if (layers[i] !== li || i === ignoreIndex || i <= after) continue;
          const ex = (xs[i] as number) - x;
          const ey = (ys[i] as number) - y;
          const d = (rs[i] as number) + r;
          if (ex * ex + ey * ey <= d * d) {
            if (found < cap) out[found] = i;
            found++;
          }
        }
      }
    }
    return found;
  }

  /** Whether bucket `b` was already scanned in this query (two cells can share a bucket). */
  private seen(b: number, visitedCount: number): boolean {
    for (let v = 0; v < visitedCount; v++) if (this.visited[v] === b) return true;
    return false;
  }

  /** Earliest contact of the moving circle in the scratch `q` with body `i`, merged into `out`. */
  private sweepBody(i: number, out: BodyHit): void {
    const q = this.q;
    const x0 = q[QX] as number;
    const y0 = q[QY] as number;
    const dx = (q[QX1] as number) - x0;
    const dy = (q[QY1] as number) - y0;
    const reach = (this.rs[i] as number) + (q[QR] as number);
    const mx = x0 - (this.xs[i] as number);
    const my = y0 - (this.ys[i] as number);
    const c = mx * mx + my * my - reach * reach;
    let t: number;
    if (c <= 0) t = 0;
    else {
      const a = dx * dx + dy * dy;
      if (a === 0) return;
      const b = mx * dx + my * dy;
      const disc = b * b - a * c;
      if (b >= 0 || disc < 0) return;
      t = (-b - Math.sqrt(disc)) / a;
      if (t > 1) return;
    }
    if (!out.hit || t < out.t || (t === out.t && i < out.index)) {
      out.hit = true;
      out.t = t;
      out.index = i;
    }
  }

  private bucketOf(layer: number, cx: number, cy: number): number {
    return (Math.imul(cx, HASH_X) ^ (Math.imul(cy, HASH_Y) ^ Math.imul(layer + 1, HASH_LAYER))) & this.bucketMask;
  }

  private push(id: number, li: number): number {
    if (this.n === this.capacity) this.grow();
    const i = this.n++;
    this.ids[i] = id;
    this.layers[i] = li;
    this.built = false;
    return i;
  }

  private checkBody(i: number): void {
    const x = this.xs[i] as number;
    const y = this.ys[i] as number;
    const r = this.rs[i] as number;
    // `v - v === 0` is false exactly for NaN and ±Infinity.
    if (!(r >= 0) || x - x !== 0 || y - y !== 0 || r - r !== 0) {
      this.n--;
      throw new RangeError(`BodyGrid: invalid body ${String(this.ids[i])} (${String(x)}, ${String(y)}, r ${String(r)})`);
    }
    const li = this.layers[i] as number;
    if (r > (this.maxR[li] as number)) this.maxR[li] = r;
  }

  private checkIndex(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.n) throw new RangeError(`BodyGrid: body index ${String(index)} outside 0…${this.n - 1}`);
    return index;
  }

  private checkBuilt(): void {
    if (!this.built) throw new Error('BodyGrid: call build() after adding bodies and before querying');
  }

  private grow(): void {
    const cap = this.capacity * 2;
    const copy = (a: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.ids = copy(this.ids);
    this.xs = copy(this.xs);
    this.ys = copy(this.ys);
    this.rs = copy(this.rs);
    const layers = new Uint8Array(cap);
    layers.set(this.layers);
    this.layers = layers;
    this.buckets = new Uint32Array(cap);
    this.order = new Uint32Array(cap);
    this.capacity = cap;
  }
}
