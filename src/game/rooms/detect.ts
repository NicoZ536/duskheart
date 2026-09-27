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
 * - **Incremental** (M4-15 "inkrementelle Neuberechnung bei Bauänderung"): regions are cached per tile – rooms and
 *   the first 401 tiles of an outdoor fill alike. A change of the buildings or the terrain drops exactly the
 *   regions that contain a changed tile or one of its neighbours (a room depends on its tiles and its boundary
 *   only); the next query fills them again. A fill that met a tile of an unloaded chunk is not cached. The cache is
 *   bounded (`BALANCE.rooms.cacheTiles`): past it the outdoor fills are forgotten (they are filled again when asked),
 *   rooms stay; should rooms alone fill it, everything is forgotten. A region's id is its smallest tile key, so a
 *   region filled again is the same region.
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
  return Math.floor(key / ROOM_TILE_SPAN) % ROOM_TILE_SPAN;
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

/** How a tile bounds a fill. */
const OPEN = 0;
const BUILT = 1;
const NATURAL = 2;
const UNKNOWN = 3;

/** Regions of the world, filled on demand and cached per tile (see module comment). */
export class RoomMap {
  private readonly byTile = new Map<number, RoomRegion>();
  private readonly queue: number[] = [];
  private readonly seen = new Set<number>();
  /** Insulation of the last `closing` answer. */
  private closingInsulation = 0;

  /** `cacheTiles`: the bound of the region cache (default `BALANCE.rooms.cacheTiles`; tests use a small one). */
  constructor(
    private readonly world: RoomWorld,
    private readonly cacheTiles: number = R.cacheTiles,
  ) {}

  /** The region of tile (tx, ty), or `null` on a tile that closes a room or when a tile of the fill is not loaded. */
  regionAt(layer: Layer, tx: number, ty: number): RoomRegion | null {
    const cached = this.byTile.get(roomTileKey(layer, tx, ty));
    if (cached !== undefined) return cached;
    this.world.beginQuery();
    if (this.closing(layer, tx, ty) !== OPEN) return null;
    const region = this.fill(layer, tx, ty);
    if (region === null) return null;
    if (this.byTile.size + region.tiles.length > this.cacheTiles) this.dropOutdoor();
    for (const key of region.tiles) this.byTile.set(key, region);
    return region;
  }

  /** Number of tiles with a cached region (tests, debug). */
  get cachedTiles(): number {
    return this.byTile.size;
  }

  /** Forgets the outdoor fills; if the rooms alone still fill the cache, forgets everything. */
  private dropOutdoor(): void {
    for (const [key, region] of this.byTile) if (!region.room) this.byTile.delete(key);
    if (this.byTile.size > this.cacheTiles / 2) this.byTile.clear();
  }

  /** Drops the regions containing a tile of the rectangle or one next to it (a change of buildings or terrain). */
  invalidate(layer: Layer, x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const region = this.byTile.get(roomTileKey(layer, x, y));
        if (region !== undefined) this.drop(region);
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
    queue.length = 0;
    seen.clear();
    const start = roomTileKey(layer, sx, sy);
    queue.push(start);
    seen.add(start);
    let bounded = true;
    let builtWall = false;
    let wallFaces = 0;
    let wallInsulationSum = 0;
    for (let q = 0; q < queue.length; q++) {
      if (queue.length > R.maxTiles) {
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
          queue.push(nk);
          continue;
        }
        if (kind === BUILT) builtWall = true;
        wallFaces++;
        wallInsulationSum += this.closingInsulation;
      }
    }
    const tiles = [...queue].sort((a, b) => a - b);
    return this.describe(layer, tiles, bounded && builtWall, wallFaces, wallInsulationSum);
  }

  /** The region of `tiles` with its roof, boundary and furniture. */
  private describe(layer: Layer, tiles: number[], room: boolean, wallFaces: number, wallInsulationSum: number): RoomRegion {
    const store = this.world.store;
    const catalog = this.world.catalog;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    let roofed = 0;
    let roofInsulationSum = 0;
    let decorations = 0;
    const roofs: Partial<Record<BuildMaterial, number>> = {};
    const furniture: Partial<Record<FurnitureCategory, number>> = {};
    const beds: RoomPiece[] = [];
    const underground = layer < 0;
    for (const key of tiles) {
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
