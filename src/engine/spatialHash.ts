/**
 * Uniform grid spatial hash for entities (MASTERPROMPT §3.3 "räumliches Hash-Grid").
 *
 * Each id is stored with its AABB in every cell the box touches. Updates that stay within the
 * same cell range only rewrite the bounds. Queries write matching ids into a caller provided
 * array; entries and buckets are reused, so steady state operation does not allocate.
 */

/** Cell coordinates are offset by this so that keys are non negative (±2^25 cells). */
export const SPATIAL_CELL_COORD_LIMIT = 2 ** 25;
/** Key stride between cell columns (2^26 > 2 · limit). */
const CELL_KEY_STRIDE = 2 ** 26;

interface SpatialEntry {
  id: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  /** Last query that reported this entry (dedupe across cells). */
  stamp: number;
}

/** Bounds output of `SpatialHash.getBounds`. */
export interface SpatialBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Spatial hash over axis aligned boxes keyed by numeric id (typically an `Entity`). */
export class SpatialHash {
  /** Edge length of one grid cell in world units. */
  readonly cellSize: number;
  private readonly invCell: number;
  private readonly cells = new Map<number, SpatialEntry[]>();
  private readonly entries = new Map<number, SpatialEntry>();
  private readonly spare: SpatialEntry[] = [];
  private stampCounter = 0;

  constructor(cellSize: number) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new RangeError(`cellSize must be > 0, got ${String(cellSize)}`);
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
  }

  /** Number of stored ids. */
  get size(): number {
    return this.entries.size;
  }

  /** Number of allocated cell buckets (including empty ones kept for reuse). */
  get bucketCount(): number {
    return this.cells.size;
  }

  has(id: number): boolean {
    return this.entries.has(id);
  }

  private cellCoord(v: number): number {
    const c = Math.floor(v * this.invCell);
    if (!(c > -SPATIAL_CELL_COORD_LIMIT && c < SPATIAL_CELL_COORD_LIMIT)) throw new RangeError(`Coordinate ${String(v)} outside the spatial hash range`);
    return c;
  }

  private static key(cx: number, cy: number): number {
    return (cx + SPATIAL_CELL_COORD_LIMIT) * CELL_KEY_STRIDE + (cy + SPATIAL_CELL_COORD_LIMIT);
  }

  private link(entry: SpatialEntry): void {
    for (let cx = entry.cx0; cx <= entry.cx1; cx++) {
      for (let cy = entry.cy0; cy <= entry.cy1; cy++) {
        const k = SpatialHash.key(cx, cy);
        let bucket = this.cells.get(k);
        if (bucket === undefined) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(entry);
      }
    }
  }

  private unlink(entry: SpatialEntry): void {
    for (let cx = entry.cx0; cx <= entry.cx1; cx++) {
      for (let cy = entry.cy0; cy <= entry.cy1; cy++) {
        const bucket = this.cells.get(SpatialHash.key(cx, cy));
        if (bucket === undefined) continue;
        const i = bucket.indexOf(entry);
        if (i < 0) continue;
        const last = bucket.length - 1;
        if (i !== last) bucket[i] = bucket[last] as SpatialEntry;
        bucket.pop();
      }
    }
  }

  private static checkBox(minX: number, minY: number, maxX: number, maxY: number): void {
    if (!(minX <= maxX && minY <= maxY)) throw new RangeError('SpatialHash box must satisfy min ≤ max (and be finite)');
  }

  /** Adds `id` with the given box. Throws if `id` is already present. */
  insert(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.entries.has(id)) throw new Error(`SpatialHash already contains ${id}`);
    SpatialHash.checkBox(minX, minY, maxX, maxY);
    const cx0 = this.cellCoord(minX);
    const cy0 = this.cellCoord(minY);
    const cx1 = this.cellCoord(maxX);
    const cy1 = this.cellCoord(maxY);
    const entry = this.spare.pop() ?? { id: 0, minX: 0, minY: 0, maxX: 0, maxY: 0, cx0: 0, cy0: 0, cx1: 0, cy1: 0, stamp: 0 };
    entry.id = id;
    entry.minX = minX;
    entry.minY = minY;
    entry.maxX = maxX;
    entry.maxY = maxY;
    entry.cx0 = cx0;
    entry.cy0 = cy0;
    entry.cx1 = cx1;
    entry.cy1 = cy1;
    entry.stamp = 0;
    this.entries.set(id, entry);
    this.link(entry);
  }

  /** Moves `id` to a new box. Throws if `id` is not present. */
  update(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new Error(`SpatialHash does not contain ${id}`);
    SpatialHash.checkBox(minX, minY, maxX, maxY);
    const cx0 = this.cellCoord(minX);
    const cy0 = this.cellCoord(minY);
    const cx1 = this.cellCoord(maxX);
    const cy1 = this.cellCoord(maxY);
    entry.minX = minX;
    entry.minY = minY;
    entry.maxX = maxX;
    entry.maxY = maxY;
    if (cx0 === entry.cx0 && cy0 === entry.cy0 && cx1 === entry.cx1 && cy1 === entry.cy1) return;
    this.unlink(entry);
    entry.cx0 = cx0;
    entry.cy0 = cy0;
    entry.cx1 = cx1;
    entry.cy1 = cy1;
    this.link(entry);
  }

  /** Inserts or updates `id`. */
  upsert(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.entries.has(id)) this.update(id, minX, minY, maxX, maxY);
    else this.insert(id, minX, minY, maxX, maxY);
  }

  /** Removes `id`. Returns whether it was present. */
  remove(id: number): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    this.unlink(entry);
    this.entries.delete(id);
    this.spare.push(entry);
    return true;
  }

  /** Writes the stored box of `id` into `out`. Returns false if absent. */
  getBounds(id: number, out: SpatialBounds): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    out.minX = entry.minX;
    out.minY = entry.minY;
    out.maxX = entry.maxX;
    out.maxY = entry.maxY;
    return true;
  }

  /**
   * Whether walking the cell range would cost more than scanning every stored entry (huge or
   * unbounded queries such as `queryRect(-Infinity, …)` would otherwise visit up to 2^50 cells).
   */
  private prefersLinearScan(cx0: number, cy0: number, cx1: number, cy1: number): boolean {
    if (!(cx1 >= cx0 && cy1 >= cy0)) return false; // empty or NaN range: the cell loop does nothing
    return (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > this.entries.size + this.cells.size;
  }

  private nextStamp(): number {
    this.stampCounter++;
    return this.stampCounter;
  }

  /**
   * Ids whose box overlaps the rectangle (touching counts). Results are written to `out[0..n)`,
   * `out.length` is set to `n`, and `n` is returned. Order follows the grid, or the insertion order
   * for queries larger than the whole hash (both deterministic for a given history).
   */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: number[]): number {
    const stamp = this.nextStamp();
    const cx0 = Math.max(Math.floor(minX * this.invCell), -SPATIAL_CELL_COORD_LIMIT + 1);
    const cy0 = Math.max(Math.floor(minY * this.invCell), -SPATIAL_CELL_COORD_LIMIT + 1);
    const cx1 = Math.min(Math.floor(maxX * this.invCell), SPATIAL_CELL_COORD_LIMIT - 1);
    const cy1 = Math.min(Math.floor(maxY * this.invCell), SPATIAL_CELL_COORD_LIMIT - 1);
    let n = 0;
    if (this.prefersLinearScan(cx0, cy0, cx1, cy1)) {
      // Huge query (e.g. unbounded): scanning the stored ids is cheaper than walking empty cells.
      for (const e of this.entries.values()) {
        if (e.minX <= maxX && e.maxX >= minX && e.minY <= maxY && e.maxY >= minY) out[n++] = e.id;
      }
      out.length = n;
      return n;
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(SpatialHash.key(cx, cy));
        if (bucket === undefined) continue;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i] as SpatialEntry;
          if (e.stamp === stamp) continue;
          e.stamp = stamp;
          if (e.minX <= maxX && e.maxX >= minX && e.minY <= maxY && e.maxY >= minY) out[n++] = e.id;
        }
      }
    }
    out.length = n;
    return n;
  }

  /** Ids whose box overlaps the circle (touching counts). Same output contract as `queryRect`. */
  queryCircle(cx: number, cy: number, r: number, out: number[]): number {
    const stamp = this.nextStamp();
    const r2 = r * r;
    const gx0 = Math.max(Math.floor((cx - r) * this.invCell), -SPATIAL_CELL_COORD_LIMIT + 1);
    const gy0 = Math.max(Math.floor((cy - r) * this.invCell), -SPATIAL_CELL_COORD_LIMIT + 1);
    const gx1 = Math.min(Math.floor((cx + r) * this.invCell), SPATIAL_CELL_COORD_LIMIT - 1);
    const gy1 = Math.min(Math.floor((cy + r) * this.invCell), SPATIAL_CELL_COORD_LIMIT - 1);
    let n = 0;
    if (this.prefersLinearScan(gx0, gy0, gx1, gy1)) {
      for (const e of this.entries.values()) {
        const px = cx < e.minX ? e.minX : cx > e.maxX ? e.maxX : cx;
        const py = cy < e.minY ? e.minY : cy > e.maxY ? e.maxY : cy;
        const dx = cx - px;
        const dy = cy - py;
        if (dx * dx + dy * dy <= r2) out[n++] = e.id;
      }
      out.length = n;
      return n;
    }
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const bucket = this.cells.get(SpatialHash.key(gx, gy));
        if (bucket === undefined) continue;
        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i] as SpatialEntry;
          if (e.stamp === stamp) continue;
          e.stamp = stamp;
          const px = cx < e.minX ? e.minX : cx > e.maxX ? e.maxX : cx;
          const py = cy < e.minY ? e.minY : cy > e.maxY ? e.maxY : cy;
          const dx = cx - px;
          const dy = cy - py;
          if (dx * dx + dy * dy <= r2) out[n++] = e.id;
        }
      }
    }
    out.length = n;
    return n;
  }

  /** Deletes empty cell buckets (e.g. after large moves). Returns the number removed. */
  prune(): number {
    let removed = 0;
    for (const [k, bucket] of this.cells) {
      if (bucket.length === 0) {
        this.cells.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** Removes everything. */
  clear(): void {
    for (const entry of this.entries.values()) this.spare.push(entry);
    this.entries.clear();
    this.cells.clear();
  }
}
