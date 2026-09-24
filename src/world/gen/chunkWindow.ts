/**
 * Tile window of the surface (docs/WORLD.md §2 step 2): a rectangle of tiles whose terrain (land,
 * level, water, ramp/stairs/ford flags), reservations (places, roads, bridges, cave mouths) and
 * dithered biome are computed lazily from the surface context and cached for the window's lifetime.
 *
 * The chunk generator fills one window per chunk (the chunk plus a margin for object rules that look
 * at neighbours); the resource placement uses the same window around each cluster. Both apply the
 * same tile predicates:
 * - `free`: a tile an object may stand on – dry land, no flags, not reserved, no lava, not a cliff
 *   face, on the given level;
 * - `open`: a tile around a blocking object – dry walkable land on the same level, no ramp or
 *   stairs, no lava, not a cliff face. A blocking object whose ring of neighbours is open can never
 *   cut a path (the ring leads around it).
 * Cliff faces follow the collision rules (src/world/collision/tiles.ts, autotile `wandAn`): an edge
 * that drops by d levels makes the d tiles south of it a wall.
 *
 * The window's arrays are allocated once for the largest size and reused (no allocation per chunk).
 */
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS } from '../model/chunk';
import { MAX_LEVEL, createTerrainSample, type TerrainSample } from './plan/index';
import type { Reservations, SurfaceContext } from './worldContext';

/** Terrain computed. */
const STATE_TERRAIN = 0b1;
/** Biome computed. */
const STATE_BIOME = 0b10;
/** Land flag in `bits`. */
const BIT_LAND = 0b1;
/** Lava flag in `bits`. */
const BIT_LAVA = 0b10;
/** Wall (cliff face) flag in `bits`. */
const BIT_WALL = 0b100;
/** Wall evaluated. */
const BIT_WALL_KNOWN = 0b1000;
/** Level of tiles outside the world. */
const OUTSIDE_LEVEL = -1;
/** Connector flags. */
const CONNECTOR = TILE_FLAG_RAMP | TILE_FLAG_STAIRS;

/** Lazily computed tile rectangle. */
export class TileWindow {
  x0 = 0;
  y0 = 0;
  w = 0;
  h = 0;
  private readonly state: Uint8Array;
  private readonly bits: Uint8Array;
  readonly levels: Int8Array;
  readonly water: Uint8Array;
  readonly flags: Uint8Array;
  readonly res: Uint8Array;
  readonly biome: Uint8Array;
  private readonly sample: TerrainSample = createTerrainSample();
  private readonly worldTiles: number;
  /** Biome of every tile of the window, or −1 when it varies (see `SurfaceContext.uniformBiome`). */
  private uniform = -1;

  constructor(
    readonly ctx: SurfaceContext,
    private reservations: Reservations,
    /** Largest window size [tiles]. */
    readonly capacityW: number,
    readonly capacityH: number,
  ) {
    const n = capacityW * capacityH;
    this.state = new Uint8Array(n);
    this.bits = new Uint8Array(n);
    this.levels = new Int8Array(n);
    this.water = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.res = new Uint8Array(n);
    this.biome = new Uint8Array(n);
    this.worldTiles = ctx.grid.tiles;
  }

  /** Replaces the reservations (the placement adds features step by step). */
  setReservations(res: Reservations): void {
    this.reservations = res;
  }

  /** Starts a new window (nothing computed yet). */
  reset(x0: number, y0: number, w: number, h: number): void {
    if (w > this.capacityW || h > this.capacityH) throw new RangeError(`TileWindow: ${w}×${h} exceeds the capacity ${this.capacityW}×${this.capacityH}`);
    this.x0 = x0;
    this.y0 = y0;
    this.w = w;
    this.h = h;
    this.state.fill(0, 0, w * h);
    this.uniform = this.ctx.uniformBiome(x0, y0, x0 + w, y0 + h);
  }

  /** Whether the tile lies in the window. */
  contains(tx: number, ty: number): boolean {
    return tx >= this.x0 && ty >= this.y0 && tx < this.x0 + this.w && ty < this.y0 + this.h;
  }

  /** Window index of a tile (must lie inside); computes its terrain on first use. */
  at(tx: number, ty: number): number {
    const i = (ty - this.y0) * this.w + (tx - this.x0);
    if (((this.state[i] as number) & STATE_TERRAIN) === 0) this.compute(i, tx, ty);
    return i;
  }

  private compute(i: number, tx: number, ty: number): void {
    this.state[i] = (this.state[i] as number) | STATE_TERRAIN;
    if (tx < 0 || ty < 0 || tx >= this.worldTiles || ty >= this.worldTiles) {
      this.bits[i] = 0;
      this.levels[i] = OUTSIDE_LEVEL;
      this.water[i] = 0;
      this.flags[i] = 0;
      this.res[i] = 0;
      return;
    }
    const s = this.ctx.terrain.sample(tx, ty, this.sample);
    this.levels[i] = s.level;
    this.water[i] = s.water;
    this.flags[i] = s.flags;
    this.bits[i] = (s.land ? BIT_LAND : 0) | (s.land && this.ctx.lavaAt(tx, ty) ? BIT_LAVA : 0);
    this.res[i] = s.land ? this.reservations.at(tx, ty, s.level) : 0;
  }

  /** Level of a tile (−1 outside the world). */
  level(tx: number, ty: number): number {
    return this.levels[this.at(tx, ty)] as number;
  }

  /** Whether the tile is land (not sea). */
  land(tx: number, ty: number): boolean {
    return ((this.bits[this.at(tx, ty)] as number) & BIT_LAND) !== 0;
  }

  /** Whether the tile is lava. */
  lava(tx: number, ty: number): boolean {
    return ((this.bits[this.at(tx, ty)] as number) & BIT_LAVA) !== 0;
  }

  /** Dithered biome index (`PLAN_BIOME_IDS`) of a tile inside the window. */
  biomeOf(tx: number, ty: number): number {
    if (this.uniform >= 0) return this.uniform;
    const i = (ty - this.y0) * this.w + (tx - this.x0);
    if (((this.state[i] as number) & STATE_BIOME) === 0) {
      this.state[i] = (this.state[i] as number) | STATE_BIOME;
      this.biome[i] = this.ctx.biomeAt(tx, ty);
    }
    return this.biome[i] as number;
  }

  /**
   * Whether the tile is a cliff face (collision rules): some edge north of it drops by at least its
   * distance, and that edge tile is not a ramp or stairs. Needs `MAX_LEVEL` rows north in the window
   * (rows outside the window count as not higher).
   */
  wall(tx: number, ty: number): boolean {
    const i = this.at(tx, ty);
    const b = this.bits[i] as number;
    if ((b & BIT_WALL_KNOWN) !== 0) return (b & BIT_WALL) !== 0;
    const h = this.levels[i] as number;
    let wall = false;
    let foot = h;
    for (let k = 1; k <= MAX_LEVEL; k++) {
      const y = ty - k;
      if (y < this.y0 || y < 0) break;
      const j = this.at(tx, y);
      const top = this.levels[j] as number;
      if (top < 0) break;
      if (top - foot >= k && h < top) {
        wall = ((this.flags[j] as number) & CONNECTOR) === 0;
        break;
      }
      foot = top;
    }
    this.bits[i] = b | BIT_WALL_KNOWN | (wall ? BIT_WALL : 0);
    return wall;
  }

  /** A tile an object may stand on at `level`: dry land without flags, reservations, lava or wall. */
  free(tx: number, ty: number, level: number): boolean {
    if (!this.contains(tx, ty)) return false;
    const i = this.at(tx, ty);
    if (((this.bits[i] as number) & (BIT_LAND | BIT_LAVA)) !== BIT_LAND) return false;
    if (this.levels[i] !== level || this.water[i] !== 0 || this.flags[i] !== 0 || this.res[i] !== 0) return false;
    return !this.wall(tx, ty);
  }

  /** A tile around a blocking object at `level`: dry walkable land, no ramp/stairs, no lava, no wall. */
  open(tx: number, ty: number, level: number): boolean {
    if (!this.contains(tx, ty)) return false;
    const i = this.at(tx, ty);
    if (((this.bits[i] as number) & (BIT_LAND | BIT_LAVA)) !== BIT_LAND) return false;
    if (this.levels[i] !== level || this.water[i] !== 0 || ((this.flags[i] as number) & CONNECTOR) !== 0) return false;
    return !this.wall(tx, ty);
  }

  /** Whether any tile within Chebyshev distance `r` of (tx, ty) holds water (inside the window). */
  waterNear(tx: number, ty: number, r: number): boolean {
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (!this.contains(x, y)) continue;
        if (this.water[this.at(x, y)] !== 0) return true;
      }
    }
    return false;
  }
}

/** Occupancy of a tile by objects: none. */
export const OCC_NONE = 0;
/** Occupancy: a non-blocking object (plant, scatter). */
export const OCC_LOOSE = 1;
/** Occupancy: part of a blocking object's footprint. */
export const OCC_BLOCK = 2;

/**
 * Whether a blocking object with footprint `fw × fh` anchored at (tx, ty) (extending east and north,
 * src/content/worldObjects.ts) fits: every footprint tile is free on `level` and holds no object, and
 * every tile of the surrounding ring is open and no part of another blocking object. `occupancy(x, y)`
 * reports `OCC_*` of objects placed before.
 */
export function blockingFits(win: TileWindow, tx: number, ty: number, fw: number, fh: number, level: number, occupancy: (x: number, y: number) => number): boolean {
  for (let y = ty - fh + 1; y <= ty; y++) for (let x = tx; x < tx + fw; x++) if (!win.free(x, y, level) || occupancy(x, y) !== OCC_NONE) return false;
  for (let y = ty - fh; y <= ty + 1; y++) {
    for (let x = tx - 1; x <= tx + fw; x++) {
      const inside = x >= tx && x < tx + fw && y > ty - fh && y <= ty;
      if (inside) continue;
      if (!win.open(x, y, level) || occupancy(x, y) === OCC_BLOCK) return false;
    }
  }
  return true;
}
