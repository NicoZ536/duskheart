/**
 * Statics of roofs (MASTERPROMPT §16.3 "Jedes Dachtile braucht eine Stütze (Wand oder Säule) in Reichweite: Stroh 3,
 * Holz 5, Stein/Ziegel 6, Metall 8 Tiles. Wird eine Stütze entfernt, stürzen ungestützte Dachtiles ein"; M4-14).
 *
 * A roof tile is carried when a chain of carried roof tiles (eight neighbours) leads from it to a support – a
 * wall, door, gate, window or pillar – and the chain is not longer than the roof tile's reach: a roof tile on a
 * support has distance 0, one next to a support (eight neighbours) 1, every further roof tile one more. Each roof
 * tile compares its own distance with the reach of its own material, and only carried tiles carry others: a straw
 * tile 4 tiles out comes down and does not hold up the stone tile beyond it.
 *
 * The distances are a breadth-first search in buckets of equal distance over a window around the change: a roof
 * tile within `r` of a changed tile is carried by a chain inside the square of `r` around it, so a window of the
 * checked area plus the longest reach plus one decides every tile of the area exactly.
 *
 * The ghost preview asks for a roof's support every frame (§16.6 "Geister-Vorschau"): with a `RoofScratch` the
 * search reuses its buffers instead of allocating a window, a reach map and bucket lists per call;
 * `roofSupportDistance` and `unsupportedRoofs` use a scratch of their own.
 */
import { BALANCE } from '../../content/balance';

/** Longest reach of any roof material [tiles] (§16.3). */
export const MAX_ROOF_REACH = Math.max(...Object.values(BALANCE.building.materials).map((m) => m.roofReach));

/** What statics reads of the grid. */
export interface RoofGrid {
  /** Reach of the roof on tile (tx, ty) [tiles], or 0 when no roof lies there. */
  roofReach(tx: number, ty: number): number;
  /** Whether a support stands on tile (tx, ty). */
  support(tx: number, ty: number): boolean;
}

/** Eight neighbours. */
const NEIGHBOURS_X: readonly number[] = [-1, 0, 1, -1, 1, -1, 0, 1];
const NEIGHBOURS_Y: readonly number[] = [-1, -1, -1, 0, 0, 1, 1, 1];

/** Result of `roofDistances`: distances of the window's roof tiles (−1 = not carried). */
export interface RoofDistances {
  /** Window origin and size [tiles]. */
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  /** Row-major distances; −1 for tiles without roof or without support. */
  readonly dist: Int16Array;
}

/** Mutable result of a search with a scratch. */
interface ScratchDistances {
  x0: number;
  y0: number;
  w: number;
  h: number;
  dist: Int16Array;
}

/**
 * Buffers of `roofDistances` kept between calls: grown to the largest window asked for, never shrunk. A search with
 * a scratch returns the scratch's result object, whose `dist` is the scratch's buffer – valid until the next search
 * with the same scratch, and possibly longer than `w × h` (index it with `w`).
 */
export class RoofScratch {
  /** The result of the last search. */
  readonly result: ScratchDistances = { x0: 0, y0: 0, w: 0, h: 0, dist: new Int16Array(0) };
  /** Reach of the window's roof tiles (0 = none). */
  reach = new Uint8Array(0);
  /** Tiles of equal distance. */
  readonly buckets: number[][] = Array.from({ length: MAX_ROOF_REACH + 1 }, () => []);

  /** Makes room for a window of `n` tiles and empties the buckets. */
  prepare(n: number): void {
    if (this.result.dist.length < n) {
      this.result.dist = new Int16Array(n);
      this.reach = new Uint8Array(n);
    }
    for (const b of this.buckets) b.length = 0;
  }
}

/** The scratch of `roofSupportDistance` and `unsupportedRoofs` (no call nests another: the grid only reads cells). */
const SHARED_SCRATCH = new RoofScratch();

/**
 * Distances to the next support of every roof tile in the window [x0, x0 + w) × [y0, y0 + h) (see module comment).
 * Without `scratch` the result owns fresh buffers of exactly `w × h`; with one it reuses the scratch's buffers.
 */
export function roofDistances(grid: RoofGrid, x0: number, y0: number, w: number, h: number, scratch?: RoofScratch): RoofDistances {
  const n = w * h;
  let dist: Int16Array;
  let reach: Uint8Array;
  let buckets: number[][];
  if (scratch === undefined) {
    dist = new Int16Array(n);
    reach = new Uint8Array(n);
    buckets = Array.from({ length: MAX_ROOF_REACH + 1 }, () => []);
  } else {
    scratch.prepare(n);
    dist = scratch.result.dist;
    reach = scratch.reach;
    buckets = scratch.buckets;
    reach.fill(0, 0, n);
  }
  dist.fill(-1, 0, n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = grid.roofReach(x0 + x, y0 + y);
      if (r <= 0) continue;
      const i = y * w + x;
      reach[i] = r;
      let d = -1;
      if (grid.support(x0 + x, y0 + y)) d = 0;
      else {
        for (let k = 0; k < NEIGHBOURS_X.length; k++) {
          if (grid.support(x0 + x + (NEIGHBOURS_X[k] as number), y0 + y + (NEIGHBOURS_Y[k] as number))) {
            d = 1;
            break;
          }
        }
      }
      if (d >= 0 && d <= r) {
        dist[i] = d;
        (buckets[d] as number[]).push(i);
      }
    }
  }
  for (let d = 0; d < MAX_ROOF_REACH; d++) {
    const bucket = buckets[d] as number[];
    for (let b = 0; b < bucket.length; b++) {
      const i = bucket[b] as number;
      if (dist[i] !== d) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < NEIGHBOURS_X.length; k++) {
        const nx = x + (NEIGHBOURS_X[k] as number);
        const ny = y + (NEIGHBOURS_Y[k] as number);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const r = reach[j] as number;
        const nd = d + 1;
        if (r === 0 || nd > r) continue;
        const cur = dist[j] as number;
        if (cur >= 0 && cur <= nd) continue;
        dist[j] = nd;
        (buckets[nd] as number[]).push(j);
      }
    }
  }
  if (scratch === undefined) return { x0, y0, w, h, dist };
  const result = scratch.result;
  result.x0 = x0;
  result.y0 = y0;
  result.w = w;
  result.h = h;
  return result;
}

/**
 * Roof tiles within `radius` of (tx, ty) that are not carried, as flat pairs `[tx, ty, …]` in row order (the tiles
 * to bring down after a change at (tx, ty); `radius` is the longest reach by default).
 */
export function unsupportedRoofs(grid: RoofGrid, tx: number, ty: number, radius: number = MAX_ROOF_REACH): number[] {
  const margin = radius + MAX_ROOF_REACH + 1;
  const size = 2 * margin + 1;
  const d = roofDistances(grid, tx - margin, ty - margin, size, size, SHARED_SCRATCH);
  const out: number[] = [];
  const inner0 = margin - radius;
  const inner1 = margin + radius;
  for (let y = inner0; y <= inner1; y++) {
    for (let x = inner0; x <= inner1; x++) {
      const i = y * size + x;
      if (d.dist[i] === -1 && grid.roofReach(d.x0 + x, d.y0 + y) > 0) out.push(d.x0 + x, d.y0 + y);
    }
  }
  return out;
}

/** Distance of the roof tile (tx, ty) to its support [tiles], −1 when it is not carried (or no roof lies there). */
export function roofSupportDistance(grid: RoofGrid, tx: number, ty: number): number {
  const reach = grid.roofReach(tx, ty);
  if (reach <= 0) return -1;
  const margin = reach + 1;
  const size = 2 * margin + 1;
  return roofDistances(grid, tx - margin, ty - margin, size, size, SHARED_SCRATCH).dist[margin * size + margin] as number;
}
