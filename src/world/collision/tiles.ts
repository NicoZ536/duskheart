/**
 * Collision view of the tile grid (MASTERPROMPT §3.3 "Kreis/AABB gegen Tile-Raster", §9.1, M2-23).
 *
 * `CollisionGrid.tileInfo(layer, tx, ty)` packs everything movement needs about one tile into an
 * integer, derived on the fly from the chunk arrays (docs/WORLD.md §3) and the content:
 * - categories (`BLOCK_*`): solid rock / ore veins (`solid` field, or ground of kind `fest`), the
 *   footprint of blocking world objects (trees, rocks, bushes – `footprint` anchored at the object's
 *   tile, extending east and north), non-walkable ground (lava), deep unfrozen water without a
 *   bridge, cliff faces and tiles outside the world or in chunks that are not loaded;
 * - the height level 0–4 and whether the tile belongs to a ramp or stairs (`connector`);
 * - for cliff faces the level of the plateau above (`wallTop`).
 *
 * **Cliffs** follow the autotiler (src/world/autotile.ts `wandAn`): an edge that drops by `d` levels
 * shows its wall on the `d` tiles south of the plateau edge, on the lower level; those tiles are
 * cliff faces unless the edge tile carries the ramp/stairs flag (then they are the ramp). All other
 * edges are steps between neighbouring tiles of different height. Whether a tile blocks a mover is
 * decided relative to the tile under the mover's centre (`blocksMover`): walkers pass level steps
 * only along ramps and stairs (both tiles connectors, one level apart) and step down only if their
 * rules allow dropping (the player jumps down, §11.4/M3-09; land creatures never leave their level);
 * flying movers (projectiles) keep their launch level and hit anything higher.
 *
 * The grid keeps no simulation state (no save participant). Without `memo` it derives every tile per
 * query (a small per-query tile cache, chunk references per residency epoch). With `memo` – the
 * game's collision system – it keeps the derived infos per chunk instance: reloaded or replaced
 * chunks are detected by instance, edits of collision-relevant chunk fields are reported with
 * `invalidateTile`/`invalidateChunk`, and `staleTiles()` finds edits that were not (ADR-0022).
 */
import { CONTENT } from '../../content/index';
import { BALANCE } from '../../content/balance';
import type { ChunkData } from '../model/chunk';
import { TILE_FLAG_BRIDGE as FLAG_BRIDGE, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP as DEPTH_DEEP, WATER_DEPTH_MASK as DEPTH_MASK, WATER_FROZEN as FROZEN } from '../model/chunk';
import { CHUNK_MASK as CHUNK_MASK_IMPORT, CHUNK_SHIFT as CHUNK_SHIFT_IMPORT, type Layer } from '../model/coords';
import { contentWorldIdTables, type WorldIdTables } from '../model/runtimeIds';
import type { ChunkSource } from './chunkSource';

// ---------------------------------------------------------------------------------------------
// Packed tile info
// ---------------------------------------------------------------------------------------------

/** Solid rock or ore vein (underground walls). */
export const BLOCK_SOLID = 0b1;
/** Footprint of a blocking world object. */
export const BLOCK_OBJECT = 0b10;
/** Ground nobody can walk on (lava). */
export const BLOCK_HAZARD = 0b100;
/** Deep, unfrozen water without a bridge (swimmers pass). */
export const BLOCK_DEEP_WATER = 0b1000;
/** Cliff face below a plateau edge. */
export const BLOCK_WALL = 0b1_0000;
/** Outside the world or in a chunk that is not loaded. */
export const BLOCK_VOID = 0b10_0000;
/** All category bits. */
export const BLOCK_ALL = BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_DEEP_WATER | BLOCK_WALL | BLOCK_VOID;

/** Bit position of the height level (3 bits). */
const HEIGHT_SHIFT = 6;
/** Bit position of the plateau level above a cliff face (3 bits). */
const WALL_TOP_SHIFT = 9;
/** Mask of a 3 bit level field. */
const LEVEL_MASK = 0b111;
/** The tile belongs to a ramp or stairs. */
export const INFO_CONNECTOR = 0b1_0000_0000_0000;
/** `standInfo` only: the tile is open (`CollisionGrid.openAt`). */
export const INFO_OPEN = 0b10_0000_0000_0000;
/** `memoIndex` result: the tile's chunk is not loaded. */
const SLOT_MISSING = -1;
/** `memoIndex` result: the tile's value depends on a neighbouring chunk that is not loaded. */
const NOT_MEMOISED = -2;
/** Bits that must match the centre for an open neighbourhood: categories, height and plateau above. */
const OPEN_MASK = BLOCK_ALL | (LEVEL_MASK << HEIGHT_SHIFT) | (LEVEL_MASK << WALL_TOP_SHIFT);
/** Bits an open tile must not have: any category, or a plateau above it (ramp or stairs below an edge, which flyers hit). */
const NOT_OPEN = BLOCK_ALL | (LEVEL_MASK << WALL_TOP_SHIFT);
/** `tileInfo` of a tile outside the world or in a missing chunk. */
export const VOID_INFO = BLOCK_VOID;

/** Highest height level (§9.1: 0–4). */
export const MAX_LEVEL = BALANCE.world.maxHeightLevel;
if (MAX_LEVEL > LEVEL_MASK) throw new RangeError('Collision: height levels must fit into 3 bits');

// Module-local copies of imported constants: the hot path reads them per tile, and bundler module
// wrappers (tsx, vite-node) turn every access to an imported binding into a getter call.
const CHUNK_SHIFT = CHUNK_SHIFT_IMPORT;
const CHUNK_MASK = CHUNK_MASK_IMPORT;
const TILE_FLAG_BRIDGE = FLAG_BRIDGE;
const WATER_DEPTH_DEEP = DEPTH_DEEP;
const WATER_DEPTH_MASK = DEPTH_MASK;
const WATER_FROZEN = FROZEN;
/** Flags that connect two height levels. */
const CONNECTOR_FLAGS = TILE_FLAG_RAMP | TILE_FLAG_STAIRS;
/** Bits per footprint axis in the object table. */
const FOOTPRINT_BITS = 2;
const FOOTPRINT_MASK = 0b11;

/** Category bits of a packed tile info. */
export function infoCategories(info: number): number {
  return info & BLOCK_ALL;
}

/** Height level of a packed tile info. */
export function infoLevel(info: number): number {
  return (info >> HEIGHT_SHIFT) & LEVEL_MASK;
}

/** Plateau level above a cliff face (0 for other tiles). */
export function infoWallTop(info: number): number {
  return (info >> WALL_TOP_SHIFT) & LEVEL_MASK;
}

/** Whether the tile is part of a ramp or stairs. */
export function infoConnector(info: number): boolean {
  return (info & INFO_CONNECTOR) !== 0;
}

/** Packs a tile info (tests and debug tools). */
export function packTileInfo(categories: number, level: number, wallTop = 0, connector = false): number {
  return (categories & BLOCK_ALL) | ((level & LEVEL_MASK) << HEIGHT_SHIFT) | ((wallTop & LEVEL_MASK) << WALL_TOP_SHIFT) | (connector ? INFO_CONNECTOR : 0);
}

// ---------------------------------------------------------------------------------------------
// Mover rules
// ---------------------------------------------------------------------------------------------

/** How a mover treats height: walkers follow the terrain, flyers keep their level. */
export type MoverMode = 'walk' | 'fly';

/** What stops a mover. */
export interface MoverRules {
  /** Tile categories that block (`BLOCK_*`). */
  readonly blockMask: number;
  readonly mode: MoverMode;
  /** Walkers: may step down onto lower tiles (jumping down a cliff, M3-09). */
  readonly dropDown: boolean;
}

/** The player: swims (§11.4), jumps down cliffs, climbs only ramps and stairs. */
export const PLAYER_RULES: MoverRules = Object.freeze({ blockMask: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_WALL | BLOCK_VOID, mode: 'walk', dropDown: true });
/** Land creatures: no deep water, no jumping down – they stay on their level except via ramps and stairs. */
export const LAND_CREATURE_RULES: MoverRules = Object.freeze({ blockMask: BLOCK_ALL, mode: 'walk', dropDown: false });
/** Projectiles: fly over water, lava and lower ground; hit rock, objects and anything above their level. */
export const PROJECTILE_RULES: MoverRules = Object.freeze({ blockMask: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_VOID, mode: 'fly', dropDown: false });

/**
 * Whether a tile (`info`) blocks a mover. Walkers: `ref` is the info of the tile under the mover's
 * centre. Flyers: `level` is the flight level (ignored for walkers).
 */
export function blocksMover(rules: MoverRules, ref: number, info: number, level: number): boolean {
  if ((info & rules.blockMask) !== 0) return true;
  const h = (info >> HEIGHT_SHIFT) & LEVEL_MASK;
  if (rules.mode === 'fly') {
    const top = (info >> WALL_TOP_SHIFT) & LEVEL_MASK;
    return h > level || top > level;
  }
  const hr = (ref >> HEIGHT_SHIFT) & LEVEL_MASK;
  if (h === hr) return false;
  if ((h - hr === 1 || hr - h === 1) && (info & INFO_CONNECTOR) !== 0 && (ref & INFO_CONNECTOR) !== 0) return false;
  return !(h < hr && rules.dropDown);
}

// ---------------------------------------------------------------------------------------------
// Content tables
// ---------------------------------------------------------------------------------------------

/** Collision properties of the content, indexed by runtime id. */
export interface CollisionTables {
  /** Category bits of a ground terrain: `BLOCK_SOLID` for solid material, `BLOCK_HAZARD` for non-walkable ground. */
  readonly ground: Uint8Array;
  /** Footprint of a blocking world object: `w | h << 2`; 0 = does not block. */
  readonly objectFootprint: Uint8Array;
  /** Largest blocking footprint [tiles]. */
  readonly maxFootprintW: number;
  readonly maxFootprintH: number;
}

/** Builds the collision tables for the runtime id tables of a world (default: the game content). */
export function createCollisionTables(ids: WorldIdTables = contentWorldIdTables()): CollisionTables {
  const terrain = CONTENT.collection('terrain');
  const objects = CONTENT.collection('worldObjects');
  const ground = new Uint8Array(ids.terrain.size + 1);
  ids.terrain.ids().forEach((id, i) => {
    const t = terrain.get(id);
    ground[i + 1] = t.kind === 'fest' ? BLOCK_SOLID : t.walkable ? 0 : BLOCK_HAZARD;
  });
  const objectFootprint = new Uint8Array(ids.objects.size + 1);
  let maxFootprintW = 1;
  let maxFootprintH = 1;
  ids.objects.ids().forEach((id, i) => {
    const o = objects.get(id);
    if (!o.blocking) return;
    objectFootprint[i + 1] = o.footprint.w | (o.footprint.h << FOOTPRINT_BITS);
    maxFootprintW = Math.max(maxFootprintW, o.footprint.w);
    maxFootprintH = Math.max(maxFootprintH, o.footprint.h);
  });
  return Object.freeze({ ground, objectFootprint, maxFootprintW, maxFootprintH });
}

// ---------------------------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------------------------

/** Construction options of a collision grid. */
export interface CollisionGridOptions {
  /** Loaded chunks (e.g. the `ChunkManager`). */
  readonly chunks: ChunkSource;
  /** World edge length [tiles]; tiles outside [0, worldTiles)² are `BLOCK_VOID`. */
  readonly worldTiles: number;
  /** Collision properties of the content (default: `createCollisionTables()`). */
  readonly tables?: CollisionTables;
  /**
   * Residency epoch of `chunks`: loaded chunk references are reused while it returns the same value,
   * e.g. `() => clock.tick`, because the `ChunkManager` loads and unloads between ticks. Without it,
   * chunks are looked up again for every query.
   */
  readonly epoch?: () => number;
  /**
   * Keep derived tile infos between queries, per chunk instance (the collision system of the game).
   * The owner then reports every change of a collision-relevant chunk field (`ground`, `height`,
   * `water`, `solid`, `object`, `flags`) with `invalidateTile` or `invalidateChunk`; a chunk that is
   * reloaded or replaced (new instance) is detected by itself. Without it every query derives the
   * tiles afresh from the chunk arrays.
   */
  readonly memo?: boolean;
}

/** Chunk slots: 8 × 8 keyed by the low bits of the chunk coordinates (a whole active zone fits). */
const SLOT_BITS = 3;
const SLOT_MASK = 0b111;
const SLOTS = 64;
/** Tiles per chunk edge. */
const CHUNK_TILES = CHUNK_MASK + 1;
/** log2 of the tiles per chunk (memo index = slot × 1024 + local index). */
const AREA_SHIFT = 2 * CHUNK_SHIFT;
/** Largest cache stamp before the caches are cleared and the stamps restart (fits an Int32Array). */
const MAX_STAMP = 0x7fff_fff0;
/** Tile cache of a query: 4 × 4 slots keyed by the low bits of the tile coordinates. */
const TILE_CACHE_BITS = 2;
const TILE_CACHE_MASK = 0b11;
const TILE_CACHE_SLOTS = 16;
/** `openAt` memo values. */
const OPEN_YES = 1;
const OPEN_NO = 2;
/** Neighbours per row in the ready bits (3 × 3 around a chunk). */
const NEIGHBOUR_ROW = 3;

/** Tile queries for collision. */
export class CollisionGrid {
  readonly chunks: ChunkSource;
  readonly worldTiles: number;
  readonly tables: CollisionTables;
  /** Whether derived tile infos are kept between queries (see `CollisionGridOptions.memo`). */
  readonly memo: boolean;
  private readonly worldChunks: number;
  private readonly epoch: (() => number) | undefined;
  private readonly groundBits: Uint8Array;
  private readonly footprint: Uint8Array;
  private readonly maxFootprintW: number;
  private readonly maxFootprintH: number;
  private readonly wideObjects: boolean;
  private readonly tallObjects: boolean;
  /**
   * Border bands [tiles] whose memoised values depend on the neighbouring chunk on that side: cliff
   * faces look up to MAX_LEVEL rows north, footprints reach over from the west and south, and
   * `openAt` looks one tile further in every direction.
   */
  private readonly bandNorth: number;
  private readonly bandWest: number;
  private readonly bandSouth: number;
  private readonly bandEast: number;
  // Chunk slots: bound address and instance, checked once per chunk generation.
  private chunkGen = 1;
  private lastEpoch = Number.NaN;
  private readonly slotGen = new Int32Array(SLOTS);
  private readonly slotLayer = new Int8Array(SLOTS);
  private readonly slotCx = new Int32Array(SLOTS);
  private readonly slotCy = new Int32Array(SLOTS);
  private readonly slotChunk: Array<ChunkData | undefined> = new Array<ChunkData | undefined>(SLOTS).fill(undefined);
  /** Loaded neighbours per slot (`checkNeighbours`) and the chunk generation they were checked in. */
  private readonly readyBits = new Uint16Array(SLOTS);
  private readonly readyGen = new Int32Array(SLOTS);
  /** Memoised tile infos + 1 per slot (0 = not derived yet). */
  private readonly memoInfo: Uint16Array;
  /** Memoised `openAt` per slot: 0 unknown, `OPEN_YES`, `OPEN_NO`. */
  private readonly memoOpen: Uint8Array;
  // Tile cache of the current query (tiles that are not memoised).
  private queryGen = 1;
  private readonly tileGen = new Int32Array(TILE_CACHE_SLOTS);
  private readonly tileX = new Int32Array(TILE_CACHE_SLOTS);
  private readonly tileY = new Int32Array(TILE_CACHE_SLOTS);
  private readonly tileLayer = new Int8Array(TILE_CACHE_SLOTS);
  private readonly tileInfoCache = new Int32Array(TILE_CACHE_SLOTS);

  constructor(opts: CollisionGridOptions) {
    if (!Number.isInteger(opts.worldTiles) || opts.worldTiles < 1) throw new RangeError(`CollisionGrid: worldTiles must be a positive integer, got ${String(opts.worldTiles)}`);
    this.chunks = opts.chunks;
    this.worldTiles = opts.worldTiles;
    this.worldChunks = Math.ceil(opts.worldTiles / CHUNK_TILES);
    this.tables = opts.tables ?? createCollisionTables();
    this.epoch = opts.epoch;
    this.memo = opts.memo ?? false;
    // Table fields copied onto the grid: one property load less per tile in the hot path.
    this.groundBits = this.tables.ground;
    this.footprint = this.tables.objectFootprint;
    this.maxFootprintW = this.tables.maxFootprintW;
    this.maxFootprintH = this.tables.maxFootprintH;
    this.wideObjects = this.maxFootprintW > 1;
    this.tallObjects = this.maxFootprintH > 1;
    this.bandNorth = MAX_LEVEL + 1;
    this.bandWest = this.maxFootprintW;
    this.bandSouth = this.maxFootprintH;
    this.bandEast = 1;
    this.memoInfo = new Uint16Array(this.memo ? SLOTS << AREA_SHIFT : 0);
    this.memoOpen = new Uint8Array(this.memo ? SLOTS << AREA_SHIFT : 0);
  }

  /**
   * Starts a query: forgets the query's tile cache and, unless the residency epoch is unchanged, the
   * chunk references. Every public query of the collision module calls it first.
   */
  beginQuery(): void {
    if (this.queryGen >= MAX_STAMP || this.chunkGen >= MAX_STAMP) {
      this.tileGen.fill(0);
      this.slotGen.fill(0);
      this.readyGen.fill(0);
      this.queryGen = 1;
      this.chunkGen = 1;
    }
    this.queryGen++;
    if (this.epoch === undefined) this.chunkGen++;
    else {
      const e = this.epoch();
      if (e !== this.lastEpoch) {
        this.lastEpoch = e;
        this.chunkGen++;
      }
    }
  }

  /** Packed collision info of one tile, as movers see it (starts a query). */
  tileInfo(layer: Layer, tx: number, ty: number): number {
    this.beginQuery();
    return this.info(layer, tx, ty);
  }

  /** Packed collision info of one tile derived afresh from the chunk arrays (ignores the memo). */
  liveInfo(layer: Layer, tx: number, ty: number): number {
    this.beginQuery();
    return this.derive(layer, tx, ty);
  }

  /** Live collision infos of a tile rectangle into `out` (row-major, `w × h`), e.g. for a debug overlay. */
  fillInfo(layer: Layer, tx0: number, ty0: number, w: number, h: number, out: Uint16Array | Uint32Array | number[]): void {
    this.beginQuery();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = this.derive(layer, tx0 + x, ty0 + y);
  }

  /** Packed collision info inside a query (after `beginQuery`). */
  info(layer: Layer, tx: number, ty: number): number {
    if (this.memo && tx >= 0 && ty >= 0 && tx < this.worldTiles && ty < this.worldTiles) {
      const at = this.memoIndex(layer, tx, ty);
      if (at === SLOT_MISSING) return VOID_INFO;
      if (at >= 0) {
        const m = this.memoInfo[at] as number;
        if (m !== 0) return m - 1;
        const v = this.derive(layer, tx, ty);
        this.memoInfo[at] = v + 1;
        return v;
      }
    }
    const k = (tx & TILE_CACHE_MASK) | ((ty & TILE_CACHE_MASK) << TILE_CACHE_BITS);
    if (this.tileGen[k] === this.queryGen && this.tileX[k] === tx && this.tileY[k] === ty && this.tileLayer[k] === layer) return this.tileInfoCache[k] as number;
    const v = this.derive(layer, tx, ty);
    this.tileGen[k] = this.queryGen;
    this.tileX[k] = tx;
    this.tileY[k] = ty;
    this.tileLayer[k] = layer;
    this.tileInfoCache[k] = v;
    return v;
  }

  /**
   * Whether the tile and its eight neighbours are open ground on one level: no category bit, no
   * plateau above (the ramp or stairs tiles below an edge block flyers) and the same height. Then
   * nothing within one tile of its centre can block a walker standing on it or a flyer at or above
   * its level – the movers' fast path (inside a query).
   */
  openAt(layer: Layer, tx: number, ty: number): boolean {
    if (this.memo && tx >= 0 && ty >= 0 && tx < this.worldTiles && ty < this.worldTiles) {
      const at = this.memoIndex(layer, tx, ty);
      if (at === SLOT_MISSING) return false;
      if (at >= 0) {
        const m = this.memoOpen[at] as number;
        if (m !== 0) return m === OPEN_YES;
        const open = this.computeOpen(layer, tx, ty, false);
        this.memoOpen[at] = open ? OPEN_YES : OPEN_NO;
        return open;
      }
    }
    return this.computeOpen(layer, tx, ty, false);
  }

  /**
   * `info` of the tile a mover stands on plus `INFO_OPEN` if it is open – one memo lookup for both
   * (inside a query). Without memo the open test would cost more than it saves, so only the info is
   * returned.
   */
  standInfo(layer: Layer, tx: number, ty: number): number {
    if (this.memo && tx >= 0 && ty >= 0 && tx < this.worldTiles && ty < this.worldTiles) {
      const at = this.memoIndex(layer, tx, ty);
      if (at === SLOT_MISSING) return VOID_INFO;
      if (at >= 0) {
        const m = this.memoInfo[at] as number;
        const info = m !== 0 ? m - 1 : this.derive(layer, tx, ty);
        if (m === 0) this.memoInfo[at] = info + 1;
        let o = this.memoOpen[at] as number;
        if (o === 0) {
          o = this.computeOpen(layer, tx, ty, false) ? OPEN_YES : OPEN_NO;
          this.memoOpen[at] = o;
        }
        return o === OPEN_YES ? info | INFO_OPEN : info;
      }
    }
    return this.info(layer, tx, ty);
  }

  /**
   * Reports a change of a collision-relevant field of tile (tx, ty) (memo mode). Clears the memoised
   * values that depend on it – the tile, the cliff-face rows below it, the tiles a footprint anchored
   * on it covers – and the open flags around them.
   */
  invalidateTile(layer: Layer, tx: number, ty: number): void {
    if (!this.memo) return;
    for (let y = ty - (this.maxFootprintH - 1) - 1; y <= ty + MAX_LEVEL + 1; y++) {
      for (let x = tx - 1; x <= tx + this.maxFootprintW; x++) this.forget(layer, x, y);
    }
  }

  /** Reports changes anywhere in a chunk (memo mode): clears its memoised values and the border bands of its neighbours. */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    if (!this.memo) return;
    const s = (cx & SLOT_MASK) | ((cy & SLOT_MASK) << SLOT_BITS);
    if (this.isBound(s, layer, cx, cy)) this.clearRect(s, 0, 0, CHUNK_TILES, CHUNK_TILES);
    this.clearNeighbourBands(layer, cx, cy);
  }

  /** Clears every memoised value. */
  invalidateAll(): void {
    this.memoInfo.fill(0);
    this.memoOpen.fill(0);
  }

  /**
   * Compares every memoised value with a fresh derivation from the chunk arrays and returns the tiles
   * that differ (a change that was not reported). For tests and the debug overlay.
   */
  staleTiles(): Array<{ layer: Layer; tx: number; ty: number }> {
    const stale: Array<{ layer: Layer; tx: number; ty: number }> = [];
    this.beginQuery();
    for (let s = 0; s < SLOTS; s++) {
      const chunk = this.slotChunk[s];
      if (chunk === undefined) continue;
      for (let i = 0; i < 1 << AREA_SHIFT; i++) {
        const m = this.memoInfo[(s << AREA_SHIFT) | i] as number;
        const o = this.memoOpen[(s << AREA_SHIFT) | i] as number;
        if (m === 0 && o === 0) continue;
        const tx = chunk.cx * CHUNK_TILES + (i & CHUNK_MASK);
        const ty = chunk.cy * CHUNK_TILES + (i >> CHUNK_SHIFT);
        const infoStale = m !== 0 && this.derive(chunk.layer, tx, ty) !== m - 1;
        const openStale = o !== 0 && this.computeOpen(chunk.layer, tx, ty, true) !== (o === OPEN_YES);
        if (infoStale || openStale) stale.push({ layer: chunk.layer, tx, ty });
      }
    }
    return stale;
  }

  /** Open test from the tile infos (`live`: derived afresh instead of through the memo). */
  private computeOpen(layer: Layer, tx: number, ty: number, live: boolean): boolean {
    const centre = live ? this.derive(layer, tx, ty) : this.info(layer, tx, ty);
    if ((centre & NOT_OPEN) !== 0) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const v = live ? this.derive(layer, tx + dx, ty + dy) : this.info(layer, tx + dx, ty + dy);
        if ((v & OPEN_MASK) !== (centre & OPEN_MASK)) return false;
      }
    }
    return true;
  }

  /**
   * Memo index of a tile inside the world, `SLOT_MISSING` if its chunk is not loaded, or
   * `NOT_MEMOISED` if a neighbouring chunk its value depends on is not loaded.
   */
  private memoIndex(layer: Layer, tx: number, ty: number): number {
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    const s = this.slotFor(layer, cx, cy);
    if (s < 0) return SLOT_MISSING;
    const lx = tx & CHUNK_MASK;
    const ly = ty & CHUNK_MASK;
    const nx = lx < this.bandWest ? 0 : lx >= CHUNK_TILES - this.bandEast ? 2 : 1;
    const ny = ly < this.bandNorth ? 0 : ly >= CHUNK_TILES - this.bandSouth ? 2 : 1;
    if (nx !== 1 || ny !== 1) {
      if (this.readyGen[s] !== this.chunkGen) this.checkNeighbours(s, layer, cx, cy);
      const ready = this.readyBits[s] as number;
      // Bits of the neighbours the tile's value depends on: the side(s) and the corner between them.
      if ((ready & (1 << (NEIGHBOUR_ROW + nx))) === 0 || (ready & (1 << (NEIGHBOUR_ROW * ny + 1))) === 0 || (ready & (1 << (NEIGHBOUR_ROW * ny + nx))) === 0) {
        return NOT_MEMOISED;
      }
    }
    return (s << AREA_SHIFT) | (ly << CHUNK_SHIFT) | lx;
  }

  /**
   * Checks the eight neighbours of the chunk in slot `s` once per chunk generation: bit
   * `3 × (oy + 1) + (ox + 1)` is set when the neighbour is loaded (its binding validated, which
   * clears stale border bands) or lies outside the world.
   */
  private checkNeighbours(s: number, layer: Layer, cx: number, cy: number): void {
    let bits = 1 << (NEIGHBOUR_ROW + 1);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const ncx = cx + ox;
        const ncy = cy + oy;
        const outside = ncx < 0 || ncy < 0 || ncx >= this.worldChunks || ncy >= this.worldChunks;
        if (outside || this.slotFor(layer, ncx, ncy) >= 0) bits |= 1 << (NEIGHBOUR_ROW * (oy + 1) + (ox + 1));
      }
    }
    this.readyBits[s] = bits;
    this.readyGen[s] = this.chunkGen;
  }

  private isBound(s: number, layer: Layer, cx: number, cy: number): boolean {
    return this.slotChunk[s] !== undefined && this.slotCx[s] === cx && this.slotCy[s] === cy && this.slotLayer[s] === layer;
  }

  private forget(layer: Layer, tx: number, ty: number): void {
    if (tx < 0 || ty < 0 || tx >= this.worldTiles || ty >= this.worldTiles) return;
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    const s = (cx & SLOT_MASK) | ((cy & SLOT_MASK) << SLOT_BITS);
    if (!this.isBound(s, layer, cx, cy)) return;
    const at = (s << AREA_SHIFT) | ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    this.memoInfo[at] = 0;
    this.memoOpen[at] = 0;
  }

  /** Clears the memoised values of a local tile rectangle of slot `s`. */
  private clearRect(s: number, x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y < y1; y++) {
      const row = (s << AREA_SHIFT) | (y << CHUNK_SHIFT);
      this.memoInfo.fill(0, row + x0, row + x1);
      this.memoOpen.fill(0, row + x0, row + x1);
    }
  }

  /** Clears, in the eight neighbours of chunk (cx, cy), the border band facing it. */
  private clearNeighbourBands(layer: Layer, cx: number, cy: number): void {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const ncx = cx + ox;
        const ncy = cy + oy;
        const s = (ncx & SLOT_MASK) | ((ncy & SLOT_MASK) << SLOT_BITS);
        if (!this.isBound(s, layer, ncx, ncy)) continue;
        // The neighbour west of the chunk (ox = −1) depends on it along its east band, and so on.
        const x0 = ox < 0 ? CHUNK_TILES - this.bandEast : 0;
        const x1 = ox > 0 ? this.bandWest : CHUNK_TILES;
        const y0 = oy < 0 ? CHUNK_TILES - this.bandSouth : 0;
        const y1 = oy > 0 ? this.bandNorth : CHUNK_TILES;
        this.clearRect(s, x0, y0, x1, y1);
      }
    }
  }

  /** Derives the packed collision info of a tile from the chunk arrays. */
  private derive(layer: Layer, tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.worldTiles || ty >= this.worldTiles) return VOID_INFO;
    const chunk = this.chunkAt(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return VOID_INFO;
    const lx = tx & CHUNK_MASK;
    const ly = ty & CHUNK_MASK;
    const i = (ly << CHUNK_SHIFT) | lx;
    const flags = chunk.flags[i] as number;
    const water = chunk.water[i] as number;
    let cat = (this.groundBits[chunk.ground[i] as number] ?? 0) | (chunk.solid[i] !== 0 ? BLOCK_SOLID : 0);
    if ((water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP && (water & WATER_FROZEN) === 0 && (flags & TILE_FLAG_BRIDGE) === 0) cat |= BLOCK_DEEP_WATER;
    if ((this.footprint[chunk.object[i] as number] ?? 0) !== 0 || (this.wideObjects && this.coveredFromWest(layer, chunk, i, lx, tx, ty)) || (this.tallObjects && this.coveredFromSouth(layer, chunk, i, lx, ly, tx, ty))) {
      cat |= BLOCK_OBJECT;
    }
    const h = chunk.height[i] as number;
    let connector = (flags & CONNECTOR_FLAGS) !== 0;
    let wallTop = 0;
    if (layer === 0 && h < MAX_LEVEL) {
      // Most tiles: nothing higher within MAX_LEVEL rows to the north ⇒ no cliff face.
      const inChunk = ly >= MAX_LEVEL;
      let higher = !inChunk;
      if (inChunk) {
        const height = chunk.height;
        for (let k = 1; k <= MAX_LEVEL; k++) {
          if ((height[i - (k << CHUNK_SHIFT)] as number) > h) {
            higher = true;
            break;
          }
        }
      }
      if (higher) {
        // Cliff face: `k` rows below an edge that drops by at least `k` levels (autotile `wandAn`).
        let foot = h;
        for (let k = 1; k <= MAX_LEVEL; k++) {
          const top = this.heightAt(layer, tx, ty - k);
          if (top < 0) break;
          if (top - foot >= k && h < top) {
            wallTop = top;
            if ((this.flagsAt(layer, tx, ty - k) & CONNECTOR_FLAGS) !== 0) connector = true;
            else cat |= BLOCK_WALL;
            break;
          }
          foot = top;
        }
      }
    }
    return cat | (h << HEIGHT_SHIFT) | (wallTop << WALL_TOP_SHIFT) | (connector ? INFO_CONNECTOR : 0);
  }

  /** Whether a wide blocking object anchored west of the tile (same row) covers it. */
  private coveredFromWest(layer: Layer, chunk: ChunkData, i: number, lx: number, tx: number, ty: number): boolean {
    for (let dx = 1; dx < this.maxFootprintW; dx++) {
      const obj = lx >= dx ? (chunk.object[i - dx] as number) : this.objectAt(layer, tx - dx, ty);
      if (((this.footprint[obj] ?? 0) & FOOTPRINT_MASK) > dx) return true;
    }
    return false;
  }

  /** Whether a tall blocking object anchored south of the tile (or south-west) covers it. */
  private coveredFromSouth(layer: Layer, chunk: ChunkData, i: number, lx: number, ly: number, tx: number, ty: number): boolean {
    for (let dy = 1; dy < this.maxFootprintH; dy++) {
      for (let dx = 0; dx < this.maxFootprintW; dx++) {
        const obj = lx >= dx && ly + dy <= CHUNK_MASK ? (chunk.object[i - dx + (dy << CHUNK_SHIFT)] as number) : this.objectAt(layer, tx - dx, ty + dy);
        const fp = this.footprint[obj] ?? 0;
        if ((fp & FOOTPRINT_MASK) > dx && fp >> FOOTPRINT_BITS > dy) return true;
      }
    }
    return false;
  }

  private objectAt(layer: Layer, tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.worldTiles || ty >= this.worldTiles) return 0;
    const chunk = this.chunkAt(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return chunk === undefined ? 0 : (chunk.object[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
  }

  /** Height level of a tile, −1 outside the world or in a missing chunk. */
  private heightAt(layer: Layer, tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.worldTiles || ty >= this.worldTiles) return -1;
    const chunk = this.chunkAt(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return chunk === undefined ? -1 : (chunk.height[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
  }

  private flagsAt(layer: Layer, tx: number, ty: number): number {
    const chunk = this.chunkAt(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    return chunk === undefined ? 0 : (chunk.flags[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
  }

  private chunkAt(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    const s = this.slotFor(layer, cx, cy);
    return s < 0 ? undefined : this.slotChunk[s];
  }

  /**
   * Slot bound to the loaded chunk (layer, cx, cy), or −1 if it is not loaded. The binding is checked
   * against the chunk source once per chunk generation. Binding another chunk instance (or losing
   * one) clears the slot's memoised values and the facing border bands of its neighbours. Missing
   * chunks are not remembered (`ChunkManager.ensure` may load them during a tick).
   */
  private slotFor(layer: Layer, cx: number, cy: number): number {
    const s = (cx & SLOT_MASK) | ((cy & SLOT_MASK) << SLOT_BITS);
    if (this.slotGen[s] === this.chunkGen && this.slotCx[s] === cx && this.slotCy[s] === cy && this.slotLayer[s] === layer) return s;
    const chunk = this.chunks.get(layer, cx, cy);
    const sameAddress = this.slotCx[s] === cx && this.slotCy[s] === cy && this.slotLayer[s] === layer;
    if (chunk === undefined) {
      if (sameAddress && this.slotChunk[s] !== undefined) {
        this.slotChunk[s] = undefined;
        if (this.memo) this.clearNeighbourBands(layer, cx, cy);
      }
      return -1;
    }
    if (this.slotChunk[s] !== chunk || !sameAddress) {
      const wasBound = sameAddress && this.slotChunk[s] !== undefined;
      this.slotChunk[s] = chunk;
      this.slotCx[s] = cx;
      this.slotCy[s] = cy;
      this.slotLayer[s] = layer;
      if (this.memo) {
        this.clearRect(s, 0, 0, CHUNK_TILES, CHUNK_TILES);
        // A replaced instance changes what the neighbours' borders see; a first binding does too
        // (their borders may have been derived while this chunk was missing).
        if (wasBound || !sameAddress) this.clearNeighbourBands(layer, cx, cy);
      }
    }
    this.slotGen[s] = this.chunkGen;
    return s;
  }
}
