/**
 * World coordinates (docs/WORLD.md §1, M2-03).
 *
 * - World tiles `(tx, ty)` are integers, origin top left, +x east, +y south; world pixels = tile × 16.
 * - Chunks are 32×32 tiles: `cx = floorDiv(tx, 32)`, local index `i = (ty mod 32) × 32 + (tx mod 32)`.
 * - Layers `0, −1, −2, −3` (surface, Wurzelhöhlen, Tiefgrund, Glutadern) share one coordinate system.
 * - Chunk keys: the string `layer:cx:cy` (saves, debug output) and a packed non-negative integer id
 *   for hot-path maps (no string allocation per lookup).
 *
 * Tile math uses 32 bit integer operations (`>>`, `&`), which floor correctly for negative tiles;
 * inputs must be integers within ±2^31 (worlds are at most 2048 tiles wide).
 */
import { BALANCE } from '../../content/balance';
import { WORLD_LAYERS, type WorldLayer } from '../../content/biomes';

/** Tile edge length [px] (§4.4). */
export const TILE_PX = BALANCE.world.tilePx;
/** log2 of the chunk edge length. */
export const CHUNK_SHIFT = 5;
/** Chunk edge length [tiles] (WORLD.md §1: 32×32). */
export const CHUNK_SIZE = 1 << CHUNK_SHIFT;
/** Mask of the local tile coordinate within a chunk. */
export const CHUNK_MASK = CHUNK_SIZE - 1;
/** Tiles per chunk (length of every `ChunkData` array). */
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
/** Chunk edge length [px]. */
export const CHUNK_PX = CHUNK_SIZE * TILE_PX;

/** World layers, surface first (WORLD.md §1). */
export const LAYERS = WORLD_LAYERS;
/** One world layer: 0 surface, −1 Wurzelhöhlen, −2 Tiefgrund, −3 Glutadern. */
export type Layer = WorldLayer;
/** Number of layers. */
export const LAYER_COUNT = LAYERS.length;
/** The surface layer. */
export const SURFACE_LAYER: Layer = 0;
/** The deepest layer (Glutadern). */
export const DEEPEST_LAYER: Layer = -3;

/** Bits per chunk axis in a packed id (±16384 chunks = ±524288 tiles, far beyond any world edge). */
const CHUNK_COORD_BITS = 15;
/** Chunk coordinates are packed with this bias so negative coordinates stay non-negative. */
const CHUNK_COORD_BIAS = 1 << (CHUNK_COORD_BITS - 1);
/** Number of distinct chunk coordinates per axis in a packed id. */
const CHUNK_COORD_RANGE = CHUNK_COORD_BIAS * 2;
/** Smallest chunk coordinate a packed id can hold. */
export const CHUNK_COORD_MIN = -CHUNK_COORD_BIAS;
/** Largest chunk coordinate a packed id can hold. */
export const CHUNK_COORD_MAX = CHUNK_COORD_BIAS - 1;
/** Separator of the string chunk key. */
const KEY_SEPARATOR = ':';
/** Parts of a string chunk key (layer, cx, cy). */
const KEY_PARTS = 3;

/** Chunk address. */
export interface ChunkCoord {
  layer: Layer;
  cx: number;
  cy: number;
}

/** Whether `value` is one of the four layers. */
export function isLayer(value: unknown): value is Layer {
  return typeof value === 'number' && (LAYERS as readonly number[]).includes(value);
}

/** Index of a layer in `LAYERS` (0 surface … 3 Glutadern). */
export function layerIndex(layer: Layer): number {
  // Math.abs instead of negation: −0 would leak into keys and hashes for the surface.
  return Math.abs(layer);
}

/** Layer at an index of `LAYERS`. Throws outside 0…3. */
export function layerAt(index: number): Layer {
  const layer = LAYERS[index];
  if (layer === undefined) throw new RangeError(`Layer index must be 0…${LAYER_COUNT - 1}, got ${String(index)}`);
  return layer;
}

/** Chunk coordinate of a tile coordinate (floor division by 32, also for negative tiles). */
export function tileToChunk(t: number): number {
  return t >> CHUNK_SHIFT;
}

/** Tile coordinate within its chunk, 0…31 (also for negative tiles). */
export function tileToLocal(t: number): number {
  return t & CHUNK_MASK;
}

/** First tile coordinate of a chunk. */
export function chunkToTile(c: number): number {
  return c * CHUNK_SIZE;
}

/** Local index from local coordinates (0…31 each): `ly × 32 + lx`. */
export function localIndex(lx: number, ly: number): number {
  return (ly << CHUNK_SHIFT) | lx;
}

/** Local index of a world tile within its chunk: `(ty mod 32) × 32 + (tx mod 32)`. */
export function tileLocalIndex(tx: number, ty: number): number {
  return ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
}

/** Local x (column) of a local index. */
export function localX(i: number): number {
  return i & CHUNK_MASK;
}

/** Local y (row) of a local index. */
export function localY(i: number): number {
  return i >> CHUNK_SHIFT;
}

/** World tile x of local index `i` in chunk column `cx`. */
export function worldTileX(cx: number, i: number): number {
  return cx * CHUNK_SIZE + (i & CHUNK_MASK);
}

/** World tile y of local index `i` in chunk row `cy`. */
export function worldTileY(cy: number, i: number): number {
  return cy * CHUNK_SIZE + (i >> CHUNK_SHIFT);
}

/** Tile containing a world pixel coordinate. */
export function pxToTile(px: number): number {
  return Math.floor(px / TILE_PX);
}

/** World pixel of a tile's top left corner. */
export function tileToPx(t: number): number {
  return t * TILE_PX;
}

/** World pixel of a tile's centre. */
export function tileCenterPx(t: number): number {
  return t * TILE_PX + TILE_PX * 0.5;
}

/** Chunk containing a world pixel coordinate. */
export function pxToChunk(px: number): number {
  return Math.floor(px / CHUNK_PX);
}

/** String chunk key `layer:cx:cy` (WORLD.md §1). */
export function chunkKey(layer: Layer, cx: number, cy: number): string {
  return `${layer}${KEY_SEPARATOR}${cx}${KEY_SEPARATOR}${cy}`;
}

function parseKeyInt(part: string | undefined, key: string): number {
  const value = part === undefined || !/^-?\d+$/.test(part) ? Number.NaN : Number(part);
  if (!Number.isSafeInteger(value)) throw new SyntaxError(`Invalid chunk key "${key}" (expected "layer:cx:cy")`);
  return value;
}

/** Parses a key from `chunkKey`. Throws `SyntaxError` on malformed keys or unknown layers. */
export function parseChunkKey(key: string, out: ChunkCoord = { layer: 0, cx: 0, cy: 0 }): ChunkCoord {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length !== KEY_PARTS) throw new SyntaxError(`Invalid chunk key "${key}" (expected "layer:cx:cy")`);
  const layer = parseKeyInt(parts[0], key);
  if (!isLayer(layer)) throw new SyntaxError(`Invalid chunk key "${key}": unknown layer ${layer}`);
  out.layer = layer;
  out.cx = parseKeyInt(parts[1], key);
  out.cy = parseKeyInt(parts[2], key);
  return out;
}

/** Whether a chunk coordinate fits into a packed chunk id. */
export function isPackableChunkCoord(c: number): boolean {
  return Number.isInteger(c) && c >= CHUNK_COORD_MIN && c <= CHUNK_COORD_MAX;
}

/**
 * Packs a chunk address into one non-negative safe integer (unique per layer/cx/cy) for maps and
 * sets in hot paths. Chunk coordinates must lie in `CHUNK_COORD_MIN…CHUNK_COORD_MAX`.
 */
export function packChunkId(layer: Layer, cx: number, cy: number): number {
  if (!isPackableChunkCoord(cx) || !isPackableChunkCoord(cy)) throw new RangeError(`Chunk coordinate out of range: ${String(cx)}, ${String(cy)}`);
  return (layerIndex(layer) * CHUNK_COORD_RANGE + (cy + CHUNK_COORD_BIAS)) * CHUNK_COORD_RANGE + (cx + CHUNK_COORD_BIAS);
}

/** Inverse of `packChunkId` (writes into `out`, no allocation). */
export function unpackChunkId(id: number, out: ChunkCoord): ChunkCoord {
  if (!Number.isSafeInteger(id) || id < 0 || id >= LAYER_COUNT * CHUNK_COORD_RANGE * CHUNK_COORD_RANGE) throw new RangeError(`Invalid packed chunk id ${String(id)}`);
  const cx = id % CHUNK_COORD_RANGE;
  const rest = (id - cx) / CHUNK_COORD_RANGE;
  const cy = rest % CHUNK_COORD_RANGE;
  out.layer = layerAt((rest - cy) / CHUNK_COORD_RANGE);
  out.cx = cx - CHUNK_COORD_BIAS;
  out.cy = cy - CHUNK_COORD_BIAS;
  return out;
}
