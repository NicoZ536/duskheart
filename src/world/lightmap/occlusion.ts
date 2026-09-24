/**
 * Light occlusion of the gameplay light map (MASTERPROMPT §12.1 "Verdeckung per Tile-Raycast gegen
 * Wände und Klippen, pro Lichtquelle gecacht, bei Bauänderungen invalidiert").
 *
 * - **What blocks** (`blocksLight`, from the collision grid's packed tile info, src/world/collision/tiles.ts):
 *   solid rock and ore veins (the walls of the caves, later built walls) always; a cliff face only for a
 *   light below its plateau (`wallTop` above the light's level) – a torch at the foot of a cliff does not
 *   light the plateau behind the face, a fire on the plateau lights the ground below the edge. Trees,
 *   rocks and bushes do not block light (§12.1 names walls and cliffs). The blocking tile itself is lit:
 *   its face is what the light falls on.
 * - **Tile raycast** (`traceVisibility`): from the centre of the light's tile to the centre of every tile
 *   within the window, walking the tiles the segment crosses (integer grid walk, a diagonal step through
 *   an exact corner); a tile is visible when no tile strictly between the two blocks. Integer arithmetic
 *   only – the same mask on every engine.
 * - **Cache** (`OcclusionCache`): one visibility mask per light and position, keyed by (layer, tile,
 *   window radius, level); a light that moves (the hand light) keeps its last few positions (LRU). A
 *   change of a tile that can change occlusion (`invalidateTile`, `invalidateChunk` – mining, building,
 *   terraforming) marks every mask whose window it touches as stale. A mask traced while a tile of its
 *   window was not loaded (`BLOCK_VOID`, counted as open) is not trusted either and traced again.
 * Allocation only when a mask is traced for a new window size.
 */
import { BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, MAX_LEVEL, infoLevel, infoWallTop } from '../collision/tiles';
import type { Layer } from '../model/coords';
import { CHUNK_SIZE } from '../model/coords';

/** Collision tile infos as the occlusion reads them (the collision grid of the world). */
export interface OccluderSource {
  /** Starts a batch of queries (one residency epoch). */
  beginQuery(): void;
  /** Packed collision info of a tile inside a batch (`BLOCK_VOID` when not loaded). */
  info(layer: Layer, tx: number, ty: number): number;
}

/** Whether a tile with packed collision `info` stops light of a source standing on height `lightLevel`. */
export function blocksLight(info: number, lightLevel: number): boolean {
  if ((info & BLOCK_SOLID) !== 0) return true;
  if ((info & BLOCK_WALL) !== 0) return infoWallTop(info) > lightLevel;
  return false;
}

/** Height level of the tile under a light (the level `blocksLight` compares cliff faces with). */
export function lightLevelOfTile(info: number): number {
  return infoLevel(info);
}

/** Edge length of the window of radius `r` [tiles]. */
export function windowSize(r: number): number {
  return 2 * r + 1;
}

/**
 * Walks from the window centre to the tile (dx, dy) and reports whether no tile strictly between the two
 * blocks. `blockers` holds 1 for blocking tiles, row-major over the window of radius `r`.
 */
export function rayVisible(blockers: Uint8Array, r: number, dx: number, dy: number): boolean {
  const size = windowSize(r);
  const nx = dx < 0 ? -dx : dx;
  const ny = dy < 0 ? -dy : dy;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  let x = 0;
  let y = 0;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    // Compare where the segment leaves the current tile: (0,5 + ix) / nx against (0,5 + iy) / ny.
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    if (x === dx && y === dy) return true;
    if (blockers[(y + r) * size + (x + r)] === 1) return false;
  }
  return true;
}

/**
 * Traces the visibility mask of a light on tile (tx, ty) of `layer` with window radius `r` [tiles]:
 * `mask[(dy + r) · size + (dx + r)]` = 1 for every tile within the circle of radius r + 1 around the
 * light that the light reaches. `blockers` is scratch space of the same size. Returns false when a tile of
 * the window was not loaded (the mask then treats it as open).
 */
export function traceVisibility(source: OccluderSource, layer: Layer, tx: number, ty: number, r: number, lightLevel: number, mask: Uint8Array, blockers: Uint8Array): boolean {
  const size = windowSize(r);
  let complete = true;
  source.beginQuery();
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const info = source.info(layer, tx + dx, ty + dy);
      if ((info & BLOCK_VOID) !== 0) complete = false;
      blockers[(dy + r) * size + (dx + r)] = (info & BLOCK_VOID) === 0 && blocksLight(info, lightLevel) ? 1 : 0;
    }
  }
  const reach = (r + 1) * (r + 1);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      mask[(dy + r) * size + (dx + r)] = dx * dx + dy * dy <= reach && rayVisible(blockers, r, dx, dy) ? 1 : 0;
    }
  }
  return complete;
}

/** A cached visibility mask. */
export class OcclusionEntry {
  id = 0;
  layer: Layer = 0;
  tx = 0;
  ty = 0;
  r = 0;
  level = 0;
  /** Visibility of the window tiles (see `traceVisibility`). */
  mask: Uint8Array = new Uint8Array(1);
  /** Traced while every tile of the window was loaded. */
  complete = false;
  /** A tile of the window changed since the trace. */
  stale = true;
  /** Use stamp (LRU). */
  used = 0;

  /** Whether the tile (x, y) lies in the window and the light reaches it. */
  visible(x: number, y: number): boolean {
    const dx = x - this.tx;
    const dy = y - this.ty;
    const r = this.r;
    if (dx < -r || dx > r || dy < -r || dy > r) return false;
    return this.mask[(dy + r) * windowSize(r) + (dx + r)] === 1;
  }

  /** Whether the window overlaps the tile rectangle [x0, x1] × [y0, y1] on `layer`. */
  overlaps(layer: Layer, x0: number, y0: number, x1: number, y1: number): boolean {
    return layer === this.layer && this.tx + this.r >= x0 && this.tx - this.r <= x1 && this.ty + this.r >= y0 && this.ty - this.r <= y1;
  }
}

/** Counters of the cache (tests, debug info). */
export interface OcclusionStats {
  /** Masks traced. */
  traces: number;
  /** Queries answered from the cache. */
  hits: number;
}

export class OcclusionCache {
  private readonly byId = new Map<number, OcclusionEntry[]>();
  private blockers = new Uint8Array(1);
  private stamp = 0;
  readonly stats: OcclusionStats = { traces: 0, hits: 0 };

  /**
   * @param perLight positions kept per light id (the moving hand light walks back and forth; a placed
   * light only ever uses one).
   */
  constructor(private readonly perLight: number) {
    if (!Number.isInteger(perLight) || perLight < 1) throw new RangeError(`OcclusionCache: perLight must be a positive integer, got ${String(perLight)}`);
  }

  /** The visibility mask of light `id` on tile (tx, ty) with window radius `r` and height level `level` – traced unless cached and valid. */
  window(source: OccluderSource, id: number, layer: Layer, tx: number, ty: number, r: number, level: number): OcclusionEntry {
    this.stamp++;
    let list = this.byId.get(id);
    if (list === undefined) {
      list = [];
      this.byId.set(id, list);
    }
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as OcclusionEntry;
      if (e.layer === layer && e.tx === tx && e.ty === ty && e.r === r && e.level === level) {
        if (e.stale || !e.complete) this.trace(source, e);
        else this.stats.hits++;
        e.used = this.stamp;
        return e;
      }
    }
    let e: OcclusionEntry;
    if (list.length < this.perLight) {
      e = new OcclusionEntry();
      list.push(e);
    } else {
      e = list[0] as OcclusionEntry;
      for (let i = 1; i < list.length; i++) if ((list[i] as OcclusionEntry).used < e.used) e = list[i] as OcclusionEntry;
    }
    e.id = id;
    e.layer = layer;
    e.tx = tx;
    e.ty = ty;
    e.r = r;
    e.level = level;
    e.used = this.stamp;
    this.trace(source, e);
    return e;
  }

  /** Forgets every mask of light `id` (the light is gone). */
  forget(id: number): void {
    this.byId.delete(id);
  }

  /**
   * A collision-relevant field of tile (tx, ty) changed: masks whose window holds the tile or the cliff
   * faces it can raise (up to `MAX_LEVEL + 1` rows south, the collision grid's band) are traced again.
   */
  invalidateTile(layer: Layer, tx: number, ty: number): void {
    this.invalidateRect(layer, tx - 1, ty - 1, tx + 1, ty + MAX_LEVEL + 1);
  }

  /** Something anywhere in chunk (cx, cy) changed (or it was reloaded). */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE;
    this.invalidateRect(layer, x0 - 1, y0 - 1, x0 + CHUNK_SIZE, y0 + CHUNK_SIZE + MAX_LEVEL);
  }

  /** Every mask is traced again on its next use. */
  invalidateAll(): void {
    for (const list of this.byId.values()) for (const e of list) e.stale = true;
  }

  /** Number of cached masks. */
  get size(): number {
    let n = 0;
    for (const list of this.byId.values()) n += list.length;
    return n;
  }

  private invalidateRect(layer: Layer, x0: number, y0: number, x1: number, y1: number): void {
    for (const list of this.byId.values()) for (const e of list) if (e.overlaps(layer, x0, y0, x1, y1)) e.stale = true;
  }

  private trace(source: OccluderSource, e: OcclusionEntry): void {
    const size = windowSize(e.r);
    const area = size * size;
    if (e.mask.length !== area) e.mask = new Uint8Array(area);
    if (this.blockers.length < area) this.blockers = new Uint8Array(area);
    e.complete = traceVisibility(source, e.layer, e.tx, e.ty, e.r, e.level, e.mask, this.blockers);
    e.stale = false;
    this.stats.traces++;
  }
}
