/**
 * Tile words per chunk for the path snapshots (M6-16, docs/SPIEL.md §12): derived once from the collision grid (the
 * world's memoised `CollisionGrid` with the building overlay), the chunk's water and the doors, then copied into
 * every snapshot that needs the chunk – a request copies a few KiB instead of deriving thousands of tiles.
 *
 * **Versions.** Every build gets a new version number (a counter of this cache). The portal graph of the searches
 * keys its data by these versions, so a chunk's version must change whenever one of its words could have changed:
 * - edits reported to the collision system (`WorldCollision.addChangeListener` → `invalidateTile`/`invalidateChunk`:
 *   felling, mining, digging, building, doors) mark every chunk whose words depend on the tile – cliff faces below
 *   it, footprints over it, level links around it;
 * - a chunk or one of its eight neighbours loaded, unloaded or replaced is noticed by instance, checked once per tick.
 * Chunk residency itself never enters a result: the service only snapshots allowed chunks (the active zone).
 */
import { BALANCE } from '../../content/balance';
import { BLOCK_SOLID, INFO_CONNECTOR, MAX_LEVEL, infoCategories, infoLevel, type CollisionGrid } from '../collision/tiles';
import type { ChunkData } from '../model/chunk';
import { WATER_DEPTH_MASK, WATER_FROZEN } from '../model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, LAYER_COUNT, layerIndex, type Layer } from '../model/coords';
import type { PathDoorSource } from './doors';
import { PATH_CONNECTOR, PATH_DOOR, PATH_LEVEL_BITS, PATH_LEVEL_SHIFT, PATH_LINK, PATH_VOID_WORD, PATH_WATER, type PathGrid } from './grid';

/** Tiles per chunk. */
const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;
/** A chunk and its eight neighbours. */
const NEIGHBOURHOOD = 9;
/** Largest footprint of a blocking object per axis [tiles]: the collision tables pack it into 2 bits. */
const MAX_FOOTPRINT_TILES = 3;
/** Bits per chunk coordinate in a cache key (worlds have at most 64 chunks per edge, §9.1). */
const KEY_BITS = 10;
/** Largest chunk coordinate a key holds. */
const KEY_MAX = (1 << KEY_BITS) - 1;

/**
 * Map key of a chunk: a small integer (V8 keeps it unboxed – `packChunkId` can exceed the small-integer range, and
 * every such key would be allocated per lookup); −1 for coordinates outside the world.
 */
function chunkKey(layer: Layer, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx > KEY_MAX || cy > KEY_MAX) return -1;
  return (layerIndex(layer) << (2 * KEY_BITS)) | (cy << KEY_BITS) | cx;
}

/** Bits per axis of the per-tick chunk lookup table (16 × 16 chunks per layer: a window with its ring fits). */
const LOOKUP_BITS = 4;
const LOOKUP_MASK = (1 << LOOKUP_BITS) - 1;
/** Slots of the lookup table (all layers). */
const LOOKUP_SLOTS = LAYER_COUNT << (2 * LOOKUP_BITS);

/** Level difference of two connectors that join. */
const LINK_STEP = 1 << PATH_LEVEL_SHIFT;

/** The words of one chunk. */
class ChunkWords {
  layer: Layer = 0;
  cx = 0;
  cy = 0;
  readonly words = new Uint16Array(CHUNK_TILES);
  /** One view per row of `words`, made once: a snapshot copies them row by row without allocating. */
  readonly rows: readonly Uint16Array[] = Array.from({ length: CHUNK_SIZE }, (_, y) => this.words.subarray(y * CHUNK_SIZE, (y + 1) * CHUNK_SIZE));
  version = 0;
  /** Tiles with `PATH_LINK` or `PATH_DOOR`. */
  specials = 0;
  dirty = true;
  /** Tick the neighbourhood's instances were last compared. */
  checkedTick = Number.NaN;
  lastUse = 0;
  /** Chunk instances of the 3 × 3 neighbourhood when built (row-major, the chunk itself in the middle). */
  readonly instances: Array<ChunkData | undefined> = new Array<ChunkData | undefined>(NEIGHBOURHOOD).fill(undefined);
}

/** Options of a `PathTileCache`. */
export interface PathTileCacheOptions {
  /** The collision grid (read when a chunk is built; the game's grid exists only once the world does). */
  readonly grid: () => CollisionGrid;
  /** Closed doors, if any are built. */
  readonly doors?: PathDoorSource | null;
  /** Chunks kept [chunks] (default `BALANCE.ai.path.tileCacheChunks`). */
  readonly capacity?: number;
}

/** Per-chunk tile words with versions (see module comment). */
export class PathTileCache {
  private readonly entries = new Map<number, ChunkWords>();
  private readonly capacity: number;
  private readonly gridOf: () => CollisionGrid;
  private doors: PathDoorSource | null;
  /** Next version (a small integer: 2³⁰ rebuilds would take centuries of play). */
  private nextVersion = 1;
  // Chunk lookups of the current tick: direct-mapped by the low bits of the chunk coordinates and the layer.
  private readonly lookupTick = new Float64Array(LOOKUP_SLOTS).fill(Number.NaN);
  private readonly lookupCx = new Int32Array(LOOKUP_SLOTS);
  private readonly lookupCy = new Int32Array(LOOKUP_SLOTS);
  private readonly lookupValid = new Uint8Array(LOOKUP_SLOTS);
  private readonly lookupChunk: Array<ChunkData | undefined> = new Array<ChunkData | undefined>(LOOKUP_SLOTS).fill(undefined);
  private uses = 0;
  /** Chunks built (statistics). */
  built = 0;

  constructor(options: PathTileCacheOptions) {
    this.gridOf = options.grid;
    this.doors = options.doors ?? null;
    this.capacity = options.capacity ?? BALANCE.ai.path.tileCacheChunks;
    if (!Number.isInteger(this.capacity) || this.capacity < 1) throw new RangeError(`PathTileCache: capacity must be a positive integer, got ${String(this.capacity)}`);
  }

  /** Sets the door source (the building system) and rebuilds every chunk. */
  setDoors(doors: PathDoorSource | null): void {
    this.doors = doors;
    this.invalidateAll();
  }

  /** A tile changed (collision listener): every chunk whose words depend on it is rebuilt on next use. */
  invalidateTile(layer: Layer, tx: number, ty: number): void {
    if (this.entries.size === 0) return;
    // Like CollisionGrid.invalidateTile – cliff faces below, footprints over the tile – plus one ring for level links.
    const x0 = tx - 1 - 1;
    const x1 = tx + MAX_FOOTPRINT_TILES + 1;
    const y0 = ty - MAX_FOOTPRINT_TILES - 1;
    const y1 = ty + MAX_LEVEL + 1 + 1;
    for (let cy = y0 >> CHUNK_SHIFT; cy <= y1 >> CHUNK_SHIFT; cy++) {
      for (let cx = x0 >> CHUNK_SHIFT; cx <= x1 >> CHUNK_SHIFT; cx++) this.markDirty(layer, cx, cy);
    }
  }

  /** Something anywhere in a chunk changed: it and its neighbours are rebuilt on next use. */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) this.markDirty(layer, cx + ox, cy + oy);
  }

  /** Every chunk is rebuilt on next use. */
  invalidateAll(): void {
    for (const e of this.entries.values()) e.dirty = true;
    this.lookupValid.fill(0);
  }

  /** Number of cached chunks. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Fills the window of `grid` (already `reset`) from the cache: allowed, loaded chunks with their words and
   * version, every other chunk void (version 0). `tick` scopes the instance checks.
   */
  fill(grid: PathGrid, allowed: ((layer: Layer, cx: number, cy: number) => boolean) | null, tick: number): void {
    const { layer, cx0, cy0, cw, ch, width, words, versions, special } = grid;
    const collision = this.gridOf();
    const worldChunks = Math.ceil(collision.worldTiles / CHUNK_SIZE);
    special.fill(0, 0, cw * ch);
    for (let wy = 0; wy < ch; wy++) {
      for (let wx = 0; wx < cw; wx++) {
        const cx = cx0 + wx;
        const cy = cy0 + wy;
        const inWorld = cx >= 0 && cy >= 0 && cx < worldChunks && cy < worldChunks;
        const e = inWorld && (allowed === null || allowed(layer, cx, cy)) ? this.entry(collision, layer, cx, cy, tick) : null;
        const base = (wy << CHUNK_SHIFT) * width + (wx << CHUNK_SHIFT);
        const c = wy * cw + wx;
        if (e === null) {
          versions[c] = 0;
          for (let y = 0; y < CHUNK_SIZE; y++) words.fill(PATH_VOID_WORD, base + y * width, base + y * width + CHUNK_SIZE);
          continue;
        }
        versions[c] = e.version;
        const rows = e.rows;
        for (let y = 0; y < CHUNK_SIZE; y++) words.set(rows[y] as Uint16Array, base + y * width);
        if (e.specials > 0) {
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const nx = wx + ox;
              const ny = wy + oy;
              if (nx >= 0 && ny >= 0 && nx < cw && ny < ch) special[ny * cw + nx] = 1;
            }
          }
        }
      }
    }
  }

  private markDirty(layer: Layer, cx: number, cy: number): void {
    const e = this.entries.get(chunkKey(layer, cx, cy));
    if (e !== undefined) e.dirty = true;
  }

  /** The current words of a loaded chunk (built or rebuilt as needed), or `null` when it is not loaded. */
  private entry(collision: CollisionGrid, layer: Layer, cx: number, cy: number, tick: number): ChunkWords | null {
    const chunk = this.chunkAt(collision, layer, cx, cy, tick);
    if (chunk === undefined) return null;
    const key = chunkKey(layer, cx, cy);
    if (key < 0) return null;
    let e = this.entries.get(key);
    if (e !== undefined && !e.dirty && e.checkedTick !== tick) {
      let k = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++, k++) {
          if (this.chunkAt(collision, layer, cx + ox, cy + oy, tick) !== e.instances[k]) e.dirty = true;
        }
      }
      e.checkedTick = tick;
    }
    if (e === undefined) {
      e = this.newEntry();
      e.layer = layer;
      e.cx = cx;
      e.cy = cy;
      e.dirty = true;
      this.entries.set(key, e);
    }
    e.lastUse = ++this.uses;
    if (e.dirty) this.build(collision, e, tick);
    return e;
  }

  /**
   * The loaded chunk at (layer, cx, cy), looked up at most once per tick (residency changes between ticks only): a
   * chunk and its neighbours are compared for every window chunk, and a lookup of the chunk store may allocate.
   */
  private chunkAt(collision: CollisionGrid, layer: Layer, cx: number, cy: number, tick: number): ChunkData | undefined {
    const slot = (layerIndex(layer) << (2 * LOOKUP_BITS)) | ((cy & LOOKUP_MASK) << LOOKUP_BITS) | (cx & LOOKUP_MASK);
    if (this.lookupTick[slot] === tick && this.lookupCx[slot] === cx && this.lookupCy[slot] === cy && this.lookupValid[slot] === 1) return this.lookupChunk[slot];
    const chunk = collision.chunks.get(layer, cx, cy);
    this.lookupTick[slot] = tick;
    this.lookupCx[slot] = cx;
    this.lookupCy[slot] = cy;
    this.lookupValid[slot] = 1;
    this.lookupChunk[slot] = chunk;
    return chunk;
  }

  /** A fresh entry, or the least recently used one when the cache is full. */
  private newEntry(): ChunkWords {
    if (this.entries.size < this.capacity) return new ChunkWords();
    let oldestKey = -1;
    let oldest: ChunkWords | null = null;
    for (const [k, e] of this.entries) {
      if (oldest === null || e.lastUse < oldest.lastUse) {
        oldest = e;
        oldestKey = k;
      }
    }
    this.entries.delete(oldestKey);
    return oldest as ChunkWords;
  }

  private build(collision: CollisionGrid, e: ChunkWords, tick: number): void {
    const { layer, cx, cy, words } = e;
    const chunk = this.chunkAt(collision, layer, cx, cy, tick) as ChunkData;
    let k = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++, k++) e.instances[k] = this.chunkAt(collision, layer, cx + ox, cy + oy, tick);
    const tx0 = cx << CHUNK_SHIFT;
    const ty0 = cy << CHUNK_SHIFT;
    const doors = this.doors !== null && this.doors.mayHaveDoors(layer, cx, cy) ? this.doors : null;
    const groundSolid = collision.tables.ground;
    collision.beginQuery();
    for (let i = 0; i < CHUNK_TILES; i++) {
      const tx = tx0 + (i & CHUNK_MASK);
      const ty = ty0 + (i >> CHUNK_SHIFT);
      let w = wordOf(collision.info(layer, tx, ty));
      const water = chunk.water[i] as number;
      if ((water & WATER_DEPTH_MASK) !== 0 && (water & WATER_FROZEN) === 0) w |= PATH_WATER;
      if (doors !== null && doors.closedDoorAt(layer, tx, ty)) {
        w |= PATH_DOOR;
        // The door's own solid goes; rock under it (never built on) would stay.
        const terrainSolid = chunk.solid[i] !== 0 || (((groundSolid[chunk.ground[i] as number] ?? 0) & BLOCK_SOLID) !== 0);
        if (!terrainSolid) w &= ~BLOCK_SOLID;
      }
      words[i] = w;
    }
    // Level links: connectors with a connector one level up or down among their eight neighbours.
    let specials = 0;
    for (let i = 0; i < CHUNK_TILES; i++) {
      const w = words[i] as number;
      if ((w & PATH_CONNECTOR) !== 0 && this.linked(collision, e, i, w)) words[i] = w | PATH_LINK;
      if (((words[i] as number) & (PATH_LINK | PATH_DOOR)) !== 0) specials++;
    }
    e.specials = specials;
    e.version = this.nextVersion++;
    e.dirty = false;
    e.checkedTick = tick;
    this.built++;
  }

  private linked(collision: CollisionGrid, e: ChunkWords, i: number, w: number): boolean {
    const lx = i & CHUNK_MASK;
    const ly = i >> CHUNK_SHIFT;
    const level = w & PATH_LEVEL_BITS;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = lx + ox;
        const ny = ly + oy;
        const n = nx >= 0 && ny >= 0 && nx < CHUNK_SIZE && ny < CHUNK_SIZE ? (e.words[(ny << CHUNK_SHIFT) | nx] as number) : wordOf(collision.info(e.layer, (e.cx << CHUNK_SHIFT) + nx, (e.cy << CHUNK_SHIFT) + ny));
        if ((n & PATH_CONNECTOR) === 0) continue;
        const d = (n & PATH_LEVEL_BITS) - level;
        if (d === LINK_STEP || d === -LINK_STEP) return true;
      }
    }
    return false;
  }

  /** Version of the cached chunk (0 when it is not cached; tests). */
  versionOf(layer: Layer, cx: number, cy: number): number {
    return this.entries.get(chunkKey(layer, cx, cy))?.version ?? 0;
  }
}

/** Word of a collision tile info: categories, level, connector. */
export function wordOf(info: number): number {
  return infoCategories(info) | (infoLevel(info) << PATH_LEVEL_SHIFT) | ((info & INFO_CONNECTOR) !== 0 ? PATH_CONNECTOR : 0);
}
