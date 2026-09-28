/**
 * Room detection (MASTERPROMPT §16.4 "Automatische Raumerkennung (Flood-Fill; geschlossen durch Wände, Türen,
 * Fenster; ≤ 400 Tiles). Innenraum = mindestens 90 % überdacht"; M4-15).
 *
 * - **Region** of a tile: a flood fill over the four neighbours through every tile that does not close a room.
 *   Closing are finished walls, doors and gates (open or shut) and windows, and around them rock and cliff faces
 *   (a hut built against a cliff is closed by it). Fences, pillars and furniture do not close; blueprints neither.
 *   A tile that closes belongs to no room.
 * - A region is a **room** when the fill stops by itself within 400 tiles and at least one finished wall, door,
 *   gate or window bounds it (a pocket of rock alone is a cave, not a room). A fill that grows past 400 tiles is
 *   outdoors. An **interior** is a room with at least 90 % of its tiles under a finished roof; underground the
 *   rock is the roof.
 * - While filling, the region collects what the room needs later: its roof tiles by material and their insulation,
 *   every boundary face (a closing neighbour of a room tile) with its insulation, and the furniture standing and
 *   hanging in it (anchors of objects and wall objects: categories, decoration, beds). Lamps (category `licht`) are
 *   not counted here: a light counts only while it burns, and the light system reports the burning ones
 *   (`RoomsSystem.addFurniture`, src/game/setup.ts) – an empty or cold lamp lights no bedroom and gives no comfort.
 * - **Incremental** (M4-15 "inkrementelle Neuberechnung bei Bauänderung"): regions are cached – rooms per tile, the
 *   outdoor fills (their first 401 tiles) as a short list of the most recent ones (`BALANCE.rooms.outdoorFills`),
 *   found by bounding box and a binary search in their sorted tiles. A change of the buildings or the terrain drops
 *   exactly the regions that contain a changed tile or one of its neighbours (a room depends on its tiles and its
 *   boundary only); the next query fills them again. A fill that met a tile of an unloaded chunk is not cached. The
 *   cache is bounded (`BALANCE.rooms.cacheTiles`): past it the oldest outdoor fills are forgotten (they are filled
 *   again when asked), rooms stay; should rooms alone fill half of it, everything is forgotten. A region's id is its
 *   smallest tile key, so a region filled again is the same region.
 * - **No garbage per query** (§30, M4-Gate): an outdoor fill is asked for with every new tile the player steps on
 *   in the open (roof fade of the game view, `playerRoom`). Caching its tiles in the per-tile map grew and emptied a
 *   map of up to 65 536 entries while the player explored, and the fill's visited set and queue regrew their tables
 *   after every clear – objects that outlived the young generation and died in the old one, about half of those of a
 *   run through the world (sampling heap profile of `fluessiges-laufen`, 1.5 of 3.2 MB in 60 s). The fill now keeps
 *   its queue and visited set in typed arrays (a generation stamp empties the set), sorts in a typed array, and
 *   outdoor fills stay out of the map: a fill allocates only the region it returns (≈ 4 KB, before 25–43 KB).
 */
import { BALANCE } from '../../content/balance';
import type { BuildMaterial } from '../../content/balance/building';
import type { FurnitureCategory } from '../../content/buildParts';
import { BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL } from '../../world/collision/tiles';
import { CHUNK_SIZE, type Layer } from '../../world/model/coords';
import type { PartCatalog, PartDef } from '../../world/structures/catalog';
import { BUILD_LAYER_INDEX, cellBlueprint, cellCovered, cellOpen, cellPart } from '../../world/structures/cells';
import type { StructureStore } from '../../world/structures/store';

const R = BALANCE.rooms;
/** Tile key span (larger than the largest world, 2048 tiles). */
export const ROOM_TILE_SPAN = 4096;
/** Bias that makes world layers (−3 … 0) non-negative in keys. */
const LAYER_BIAS = 3;
const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const OBJECT = BUILD_LAYER_INDEX.objekt;
const WALL_OBJECT = BUILD_LAYER_INDEX.wandobjekt;
const ROOF = BUILD_LAYER_INDEX.dach;
/** The layers furniture stands and hangs on. */
const FURNITURE_LAYERS: readonly number[] = [OBJECT, WALL_OBJECT];
/** The furniture category of lights: counted while they burn, through the light system. */
const LIGHT_CATEGORY: FurnitureCategory = 'licht';
/** Four neighbours. */
const DX: readonly number[] = [0, 1, 0, -1];
const DY: readonly number[] = [-1, 0, 1, 0];

/** Key of tile (tx, ty) on `layer`. */
export function roomTileKey(layer: Layer, tx: number, ty: number): number {
  return ((layer + LAYER_BIAS) * ROOM_TILE_SPAN + ty) * ROOM_TILE_SPAN + tx;
}

/** Tile x of a key. */
export function keyTx(key: number): number {
  return key % ROOM_TILE_SPAN;
}

/** Tile y of a key. */
export function keyTy(key: number): number {
  // `Math.floor(key / ROOM_TILE_SPAN)` as an exact division (the floored remainder taken off first): it stays a small
  // integer in every tier of the engine, where the fraction would be boxed as a heap number in unoptimized code.
  const below = ((key % ROOM_TILE_SPAN) + ROOM_TILE_SPAN) % ROOM_TILE_SPAN;
  return ((key - below) / ROOM_TILE_SPAN) % ROOM_TILE_SPAN;
}

/** An anchor of a piece of furniture in a room. */
export interface RoomPiece {
  readonly part: PartDef;
  readonly tx: number;
  readonly ty: number;
}

/** A region of tiles (see module comment). */
export interface RoomRegion {
  /** Smallest tile key of the region (stable while the region is unchanged). */
  readonly id: number;
  readonly layer: Layer;
  /** Tile keys, ascending. */
  readonly tiles: readonly number[];
  /** Enclosed within 400 tiles and bounded by at least one finished wall, door, gate or window. */
  readonly room: boolean;
  /** A room at least 90 % under a roof. */
  readonly interior: boolean;
  readonly size: number;
  /** Tiles under a finished roof (underground: all). */
  readonly roofed: number;
  /** Roof tiles per material. */
  readonly roofs: Readonly<Partial<Record<BuildMaterial, number>>>;
  /** Sum of the roof insulation over the tiles. */
  readonly roofInsulationSum: number;
  /** Boundary faces and the sum of their insulation. */
  readonly wallFaces: number;
  readonly wallInsulationSum: number;
  /** Own furniture (standing and hanging) per category – lights not included, they count while they burn – and decoration. */
  readonly furniture: Readonly<Partial<Record<FurnitureCategory, number>>>;
  readonly decorations: number;
  /** Beds in the room (anchors). */
  readonly beds: readonly RoomPiece[];
  /** Bounding box [tiles]. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** What detection reads of the world. */
export interface RoomWorld {
  readonly store: StructureStore;
  readonly catalog: PartCatalog;
  /** Starts a batch of tile queries. */
  beginQuery(): void;
  /** Collision info of a tile inside a batch (src/world/collision/tiles.ts; `BLOCK_VOID` when not loaded). */
  info(layer: Layer, tx: number, ty: number): number;
}

/** Whether ascending `tiles` holds `key` (binary search). */
function sortedHas(tiles: readonly number[], key: number): boolean {
  let lo = 0;
  let hi = tiles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = tiles[mid] as number;
    if (v === key) return true;
    if (v < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Whether a tile of `region` lies in the rectangle (x0, y0)–(x1, y1). */
function regionTouches(region: RoomRegion, x0: number, y0: number, x1: number, y1: number): boolean {
  if (region.x1 < x0 || region.x0 > x1 || region.y1 < y0 || region.y0 > y1) return false;
  const tiles = region.tiles;
  for (let i = 0; i < tiles.length; i++) {
    const key = tiles[i] as number;
    const tx = keyTx(key);
    const ty = keyTy(key);
    if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) return true;
  }
  return false;
}

/** Multiplier of the key hash (Fibonacci hashing). */
const HASH_MULTIPLIER = 0x9e3779b1;
/** Last generation of a `TileKeySet` before its stamps wrap (largest u32). */
const LAST_GENERATION = 0xffffffff;

/**
 * The tile keys one fill has seen: open addressing over typed arrays, reused for every fill. A slot belongs to the
 * set while its stamp equals the current generation, so emptying the set only moves the generation – no table is
 * reallocated (a `Set` replaces its table on `clear()` and regrows it with every fill).
 */
export class TileKeySet {
  private readonly keys: Int32Array;
  private readonly stamps: Uint32Array;
  private readonly mask: number;
  private generation = 1;
  private count = 0;

  /** `capacity`: most keys held at once; the table has at least twice as many slots. */
  constructor(readonly capacity: number) {
    let slots = 1;
    while (slots < 2 * capacity) slots *= 2;
    this.keys = new Int32Array(slots);
    this.stamps = new Uint32Array(slots);
    this.mask = slots - 1;
  }

  /** Number of keys held. */
  get size(): number {
    return this.count;
  }

  /** Empties the set (moves the generation; the stamps are wiped only when it wraps). */
  clear(): void {
    this.count = 0;
    if (this.generation === LAST_GENERATION) {
      this.stamps.fill(0);
      this.generation = 1;
    } else this.generation++;
  }

  /** Whether `key` (an integer tile key) is held. */
  has(key: number): boolean {
    return this.stamps[this.slotOf(key)] === this.generation;
  }

  /** Adds `key` (an integer tile key). Throws when the set already holds `capacity` keys. */
  add(key: number): void {
    const i = this.slotOf(key);
    if (this.stamps[i] === this.generation) return;
    if (this.count >= this.capacity) throw new RangeError(`TileKeySet: more than ${this.capacity} keys`);
    this.keys[i] = key | 0;
    this.stamps[i] = this.generation;
    this.count++;
  }

  /** The slot holding `key`, or the free slot where it would go (linear probing). */
  private slotOf(key: number): number {
    const k = key | 0;
    let i = Math.imul(k, HASH_MULTIPLIER) & this.mask;
    while (this.stamps[i] === this.generation && this.keys[i] !== k) i = (i + 1) & this.mask;
    return i;
  }
}

/** Tiles a fill can queue before it stops: it checks the bound before each tile and adds up to four neighbours. */
const FILL_CAPACITY = R.maxTiles + DX.length;
/** Fills the unused tail of the sort buffer (larger than every tile key). */
const UNUSED_KEY = 0x7fffffff;

/** How a tile bounds a fill. */
const OPEN = 0;
const BUILT = 1;
const NATURAL = 2;
const UNKNOWN = 3;

/** Regions of the world, filled on demand and cached per tile (see module comment). */
export class RoomMap {
  /** Rooms by tile key. */
  private readonly byTile = new Map<number, RoomRegion>();
  /** The most recent outdoor fills, oldest first (not in `byTile`). */
  private readonly outdoor: RoomRegion[] = [];
  /** Tiles of the cached outdoor fills. */
  private outdoorTiles = 0;
  /** Queue of the fill (tile keys); `seen` holds the keys it has queued; `sorted` sorts them for the region. */
  private readonly queue = new Int32Array(FILL_CAPACITY);
  private readonly sorted = new Int32Array(FILL_CAPACITY);
  private readonly seen = new TileKeySet(FILL_CAPACITY);
  /** Insulation of the last `closing` answer. */
  private closingInsulation = 0;

  /**
   * `cacheTiles`: the bound of the region cache (default `BALANCE.rooms.cacheTiles`; tests use a small one);
   * `outdoorFills`: the most outdoor fills kept (default `BALANCE.rooms.outdoorFills`).
   */
  constructor(
    private readonly world: RoomWorld,
    private readonly cacheTiles: number = R.cacheTiles,
    private readonly outdoorFills: number = R.outdoorFills,
  ) {}

  /** The region of tile (tx, ty), or `null` on a tile that closes a room or when a tile of the fill is not loaded. */
  regionAt(layer: Layer, tx: number, ty: number): RoomRegion | null {
    const key = roomTileKey(layer, tx, ty);
    const cached = this.byTile.get(key) ?? this.outdoorAt(layer, tx, ty, key);
    if (cached !== null) return cached;
    this.world.beginQuery();
    if (this.closing(layer, tx, ty) !== OPEN) return null;
    const region = this.fill(layer, tx, ty);
    if (region === null) return null;
    if (region.room) this.cacheRoom(region);
    else this.cacheOutdoor(region);
    return region;
  }

  /** Number of tiles with a cached region (tests, debug). */
  get cachedTiles(): number {
    return this.byTile.size + this.outdoorTiles;
  }

  /** The cached outdoor fill holding tile (tx, ty) – the most recent one if fills overlap – or `null`. */
  private outdoorAt(layer: Layer, tx: number, ty: number, key: number): RoomRegion | null {
    for (let i = this.outdoor.length - 1; i >= 0; i--) {
      const r = this.outdoor[i] as RoomRegion;
      if (r.layer === layer && tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1 && sortedHas(r.tiles, key)) return r;
    }
    return null;
  }

  /** Caches a room per tile; past the bound the outdoor fills go first, then – should rooms fill half of it – all. */
  private cacheRoom(region: RoomRegion): void {
    if (this.cachedTiles + region.size > this.cacheTiles) {
      this.outdoor.length = 0;
      this.outdoorTiles = 0;
      if (this.byTile.size > this.cacheTiles / 2) this.byTile.clear();
    }
    for (const key of region.tiles) this.byTile.set(key, region);
  }

  /** Caches an outdoor fill; the oldest ones go past `outdoorFills` or the tile bound. */
  private cacheOutdoor(region: RoomRegion): void {
    while (this.outdoor.length > 0 && (this.outdoor.length >= this.outdoorFills || this.cachedTiles + region.size > this.cacheTiles)) {
      this.outdoorTiles -= (this.outdoor.shift() as RoomRegion).size;
    }
    if (this.byTile.size + region.size > this.cacheTiles && this.byTile.size > this.cacheTiles / 2) this.byTile.clear();
    if (this.outdoorFills === 0) return;
    this.outdoor.push(region);
    this.outdoorTiles += region.size;
  }

  /** Drops the regions containing a tile of the rectangle or one next to it (a change of buildings or terrain). */
  invalidate(layer: Layer, x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const region = this.byTile.get(roomTileKey(layer, x, y));
        if (region !== undefined) this.drop(region);
      }
    }
    for (let i = this.outdoor.length - 1; i >= 0; i--) {
      const r = this.outdoor[i] as RoomRegion;
      if (r.layer === layer && regionTouches(r, x0 - 1, y0 - 1, x1 + 1, y1 + 1)) {
        this.outdoor.splice(i, 1);
        this.outdoorTiles -= r.size;
      }
    }
  }

  /** Drops the regions that touch chunk (cx, cy) of `layer`. */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    this.invalidate(layer, cx * CHUNK_SIZE, cy * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE - 1, (cy + 1) * CHUNK_SIZE - 1);
  }

  /** Forgets every region. */
  clear(): void {
    this.byTile.clear();
    this.outdoor.length = 0;
    this.outdoorTiles = 0;
  }

  /** The cached rooms (not the outdoor fills), ordered by id. */
  cachedRooms(): RoomRegion[] {
    const out = new Map<number, RoomRegion>();
    for (const r of this.byTile.values()) if (r.room) out.set(r.id, r);
    return [...out.values()].sort((a, b) => a.id - b.id);
  }

  private drop(region: RoomRegion): void {
    for (const key of region.tiles) if (this.byTile.get(key) === region) this.byTile.delete(key);
  }

  /** How tile (tx, ty) bounds a fill; for closing tiles `closingInsulation` holds its insulation. */
  private closing(layer: Layer, tx: number, ty: number): number {
    const info = this.world.info(layer, tx, ty);
    if ((info & BLOCK_VOID) !== 0) return UNKNOWN;
    const cell = this.world.store.cell(layer, STRUCTURE, tx, ty);
    if (cell !== 0 && !cellBlueprint(cell)) {
      const part = this.world.catalog.byRuntimeId(cellPart(cell));
      if (part?.closesRoom === true) {
        this.closingInsulation = cellOpen(cell) ? part.insulationOpen : part.insulation;
        return BUILT;
      }
    }
    if ((info & (BLOCK_SOLID | BLOCK_WALL)) !== 0) {
      this.closingInsulation = R.climate.naturalWallInsulation;
      return NATURAL;
    }
    return OPEN;
  }

  /** Fills the region of the open tile (sx, sy); `null` when it met an unloaded tile. */
  private fill(layer: Layer, sx: number, sy: number): RoomRegion | null {
    const queue = this.queue;
    const seen = this.seen;
    seen.clear();
    const start = roomTileKey(layer, sx, sy);
    queue[0] = start;
    let queued = 1;
    seen.add(start);
    let bounded = true;
    let builtWall = false;
    let wallFaces = 0;
    let wallInsulationSum = 0;
    for (let q = 0; q < queued; q++) {
      if (queued > R.maxTiles) {
        bounded = false;
        break;
      }
      const key = queue[q] as number;
      const tx = keyTx(key);
      const ty = keyTy(key);
      for (let d = 0; d < DX.length; d++) {
        const nx = tx + (DX[d] as number);
        const ny = ty + (DY[d] as number);
        const nk = roomTileKey(layer, nx, ny);
        if (seen.has(nk)) continue;
        const kind = this.closing(layer, nx, ny);
        if (kind === UNKNOWN) return null;
        if (kind === OPEN) {
          seen.add(nk);
          queue[queued++] = nk;
          continue;
        }
        if (kind === BUILT) builtWall = true;
        wallFaces++;
        wallInsulationSum += this.closingInsulation;
      }
    }
    // Sorted in a typed array (a sort with a comparator allocates its work arrays); the unused tail sorts last.
    const sorted = this.sorted;
    for (let i = 0; i < sorted.length; i++) sorted[i] = i < queued ? (queue[i] as number) : UNUSED_KEY;
    sorted.sort();
    const tiles = new Array<number>(queued);
    for (let i = 0; i < queued; i++) tiles[i] = sorted[i] as number;
    return this.describe(layer, tiles, bounded && builtWall, wallFaces, wallInsulationSum);
  }

  /** The region of `tiles` with its roof, boundary and furniture. */
  private describe(layer: Layer, tiles: number[], room: boolean, wallFaces: number, wallInsulationSum: number): RoomRegion {
    const store = this.world.store;
    const catalog = this.world.catalog;
    // Integer bounds (tiles lie in 0 … ROOM_TILE_SPAN − 1): no number of the loop needs a heap box.
    let x0 = ROOM_TILE_SPAN;
    let y0 = ROOM_TILE_SPAN;
    let x1 = -1;
    let y1 = -1;
    let roofed = 0;
    let roofInsulationSum = 0;
    let decorations = 0;
    const roofs: Partial<Record<BuildMaterial, number>> = {};
    const furniture: Partial<Record<FurnitureCategory, number>> = {};
    const beds: RoomPiece[] = [];
    const underground = layer < 0;
    for (let i = 0; i < tiles.length; i++) {
      const key = tiles[i] as number;
      const tx = keyTx(key);
      const ty = keyTy(key);
      x0 = Math.min(x0, tx);
      y0 = Math.min(y0, ty);
      x1 = Math.max(x1, tx);
      y1 = Math.max(y1, ty);
      if (!room) continue;
      const roof = store.cell(layer, ROOF, tx, ty);
      if (roof !== 0 && !cellBlueprint(roof)) {
        const part = catalog.byRuntimeId(cellPart(roof)) as PartDef;
        roofed++;
        roofInsulationSum += part.insulation;
        roofs[part.material] = (roofs[part.material] ?? 0) + 1;
      } else if (underground) {
        roofed++;
        roofInsulationSum += R.climate.naturalWallInsulation;
      }
      for (let k = 0; k < FURNITURE_LAYERS.length; k++) {
        const cell = store.cell(layer, FURNITURE_LAYERS[k] as number, tx, ty);
        if (cell === 0 || cellBlueprint(cell) || cellCovered(cell)) continue;
        const part = catalog.byRuntimeId(cellPart(cell));
        if (part === undefined || part.category === null || part.category === LIGHT_CATEGORY) continue;
        furniture[part.category] = (furniture[part.category] ?? 0) + 1;
        if (part.decoration) decorations++;
        if (part.sleepKind !== null) beds.push({ part, tx, ty });
      }
    }
    const size = tiles.length;
    return Object.freeze({
      id: tiles[0] as number,
      layer,
      tiles,
      room,
      interior: room && roofed >= R.interiorRoofShare * size,
      size,
      roofed,
      roofs,
      roofInsulationSum,
      wallFaces,
      wallInsulationSum,
      furniture,
      decorations,
      beds,
      x0,
      y0,
      x1,
      y1,
    });
  }
}
