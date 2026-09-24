/**
 * Chunk data (docs/WORLD.md §3, M2-03): one 32×32 tile section of one layer as typed arrays.
 *
 * | field    | type   | content |
 * |----------|--------|---------|
 * | `ground` | Uint8  | terrain runtime id (src/content/terrain.ts), 0 = none |
 * | `height` | Uint8  | surface height level 0–4; underground 0 |
 * | `biome`  | Uint8  | biome runtime id, 0 = none |
 * | `water`  | Uint8  | bits 0–1 depth (0 none, 1 shallow, 2 deep), 2 river, 3 lake, 4 sea, 5 frozen, 6 spring |
 * | `solid`  | Uint8  | terrain runtime id of solid rock / ore vein, 0 = open |
 * | `object` | Uint16 | world object runtime id, 0 = none |
 * | `flags`  | Uint8  | ramp, stairs, road, ford, bridge, place area, cliff edge, dug |
 *
 * All seven arrays are views on one 8 KiB `ArrayBuffer` (8 bytes per tile), so a chunk moves between
 * worker and main thread as a single transferable. Sparse object state (hit points, growth, regrow
 * time) lives in a `Map<tileIndex, ObjectState>`; `frozenAtTick` is the tick at which the chunk
 * stopped ticking (docs/ARCHITEKTUR.md "Aktive Zone"; freshly generated chunks: 0 = world creation).
 *
 * `chunkHash` covers address, arrays and object states (not `frozenAtTick`, which only records when
 * the chunk was last active); `serializeChunk` writes a compact JSON snapshot (RLE + base64 per field).
 */
import { base64ToBytes, base64ToTypedArray, bytesToBase64, Fnv1a64, rleDecodeU16, rleDecodeU8, rleEncodeU16, rleEncodeU8, typedArrayToBase64 } from '../../engine/binary';
import { CHUNK_AREA, chunkKey, isLayer, packChunkId, type Layer } from './coords';

// ---------------------------------------------------------------------------------------------
// Tile bit fields
// ---------------------------------------------------------------------------------------------

/** `water` bits 0–1: depth. */
export const WATER_DEPTH_MASK = 0b11;
/** Depth value: no water. */
export const WATER_DEPTH_NONE = 0;
/** Depth value: shallow water (wadeable). */
export const WATER_DEPTH_SHALLOW = 1;
/** Depth value: deep water (swimming). */
export const WATER_DEPTH_DEEP = 2;
/** `water` bit 2: part of a river. */
export const WATER_RIVER = 0b100;
/** `water` bit 3: part of a lake. */
export const WATER_LAKE = 0b1000;
/** `water` bit 4: part of the sea. */
export const WATER_SEA = 0b1_0000;
/** `water` bit 5: frozen (walkable ice, §10). */
export const WATER_FROZEN = 0b10_0000;
/** `water` bit 6: spring (river source). */
export const WATER_SPRING = 0b100_0000;

/** `flags` bit 0: ramp between height levels. */
export const TILE_FLAG_RAMP = 0b1;
/** `flags` bit 1: stairs between height levels. */
export const TILE_FLAG_STAIRS = 0b10;
/** `flags` bit 2: Builder road. */
export const TILE_FLAG_ROAD = 0b100;
/** `flags` bit 3: ford through a river. */
export const TILE_FLAG_FORD = 0b1000;
/** `flags` bit 4: bridge. */
export const TILE_FLAG_BRIDGE = 0b1_0000;
/** `flags` bit 5: area of a place (location slot). */
export const TILE_FLAG_PLACE = 0b10_0000;
/** `flags` bit 6: cliff edge (upper tile of a height step). */
export const TILE_FLAG_CLIFF_EDGE = 0b100_0000;
/** `flags` bit 7: dug by the player (shovel/pickaxe). */
export const TILE_FLAG_DUG = 0b1000_0000;

/** Water depth (0 none, 1 shallow, 2 deep) of a `water` value. */
export function waterDepth(water: number): number {
  return water & WATER_DEPTH_MASK;
}

/** `water` value with the depth replaced. */
export function withWaterDepth(water: number, depth: number): number {
  return (water & ~WATER_DEPTH_MASK) | (depth & WATER_DEPTH_MASK);
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

/** Field names in WORLD.md §3 order (hash and serialization order). */
export const CHUNK_FIELDS = ['ground', 'height', 'biome', 'water', 'solid', 'object', 'flags'] as const;
/** One field name. */
export type ChunkField = (typeof CHUNK_FIELDS)[number];

/** Byte offsets in the chunk buffer: the six byte fields first, then the 16 bit `object` field (aligned). */
const OFFSET_GROUND = 0;
const OFFSET_HEIGHT = OFFSET_GROUND + CHUNK_AREA;
const OFFSET_BIOME = OFFSET_HEIGHT + CHUNK_AREA;
const OFFSET_WATER = OFFSET_BIOME + CHUNK_AREA;
const OFFSET_SOLID = OFFSET_WATER + CHUNK_AREA;
const OFFSET_FLAGS = OFFSET_SOLID + CHUNK_AREA;
const OFFSET_OBJECT = OFFSET_FLAGS + CHUNK_AREA;
/** Bytes per tile over all fields (six Uint8 + one Uint16). */
export const CHUNK_BYTES_PER_TILE = (OFFSET_OBJECT + CHUNK_AREA * Uint16Array.BYTES_PER_ELEMENT) / CHUNK_AREA;
/** Size of the tile data of one chunk [bytes] (8 KiB). */
export const CHUNK_BYTES = CHUNK_AREA * CHUNK_BYTES_PER_TILE;

/** Snapshot format version written by `serializeChunk`. */
export const CHUNK_SNAPSHOT_VERSION = 1;
/** Numbers per object state in a snapshot: tile index, hp, growth, regrow tick. */
const OBJECT_STATE_STRIDE = 4;
/** Marks "no regrow scheduled" in `ObjectState.regrowAtTick`. */
export const NO_REGROW_TICK = -1;
/** Estimated heap cost of one entry in the object state map (Map slot + boxed key + state object) [bytes]. */
export const OBJECT_STATE_BYTES_ESTIMATE = 80;

/** Sparse per-object state (WORLD.md §3): only objects that deviate from their generated state. */
export interface ObjectState {
  /** Remaining hit points. */
  hp: number;
  /** Growth progress (0 = just planted). */
  growth: number;
  /** Tick at which a harvested object is back, or `NO_REGROW_TICK`. */
  regrowAtTick: number;
}

// ---------------------------------------------------------------------------------------------
// ChunkData
// ---------------------------------------------------------------------------------------------

/** One chunk of one layer. */
export class ChunkData {
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  /** Backing store of all seven arrays (transferable). */
  readonly buffer: ArrayBuffer;
  readonly ground: Uint8Array;
  readonly height: Uint8Array;
  readonly biome: Uint8Array;
  readonly water: Uint8Array;
  readonly solid: Uint8Array;
  readonly flags: Uint8Array;
  readonly object: Uint16Array;
  /** Sparse object state by local tile index. */
  readonly objectState = new Map<number, ObjectState>();
  /** Tick at which the chunk was frozen (0 for freshly generated chunks). */
  frozenAtTick = 0;

  /**
   * Creates a chunk. Pass `buffer` to wrap tile data received from a worker (exactly `CHUNK_BYTES`
   * long, e.g. `ArrayBuffer` transferred by the generator); otherwise all fields start at 0.
   */
  constructor(layer: Layer, cx: number, cy: number, buffer: ArrayBuffer = new ArrayBuffer(CHUNK_BYTES)) {
    if (!isLayer(layer)) throw new RangeError(`ChunkData: unknown layer ${String(layer)}`);
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) throw new RangeError(`ChunkData: chunk coordinates must be integers, got ${String(cx)}, ${String(cy)}`);
    if (buffer.byteLength !== CHUNK_BYTES) throw new RangeError(`ChunkData: buffer must be ${CHUNK_BYTES} bytes, got ${buffer.byteLength}`);
    this.layer = layer;
    this.cx = cx;
    this.cy = cy;
    this.buffer = buffer;
    this.ground = new Uint8Array(buffer, OFFSET_GROUND, CHUNK_AREA);
    this.height = new Uint8Array(buffer, OFFSET_HEIGHT, CHUNK_AREA);
    this.biome = new Uint8Array(buffer, OFFSET_BIOME, CHUNK_AREA);
    this.water = new Uint8Array(buffer, OFFSET_WATER, CHUNK_AREA);
    this.solid = new Uint8Array(buffer, OFFSET_SOLID, CHUNK_AREA);
    this.flags = new Uint8Array(buffer, OFFSET_FLAGS, CHUNK_AREA);
    this.object = new Uint16Array(buffer, OFFSET_OBJECT, CHUNK_AREA);
  }

  /** String key `layer:cx:cy`. */
  get key(): string {
    return chunkKey(this.layer, this.cx, this.cy);
  }

  /** Packed numeric id (see `packChunkId`). */
  get id(): number {
    return packChunkId(this.layer, this.cx, this.cy);
  }

  /** The array of a field by name. */
  field(name: ChunkField): Uint8Array | Uint16Array {
    switch (name) {
      case 'ground':
        return this.ground;
      case 'height':
        return this.height;
      case 'biome':
        return this.biome;
      case 'water':
        return this.water;
      case 'solid':
        return this.solid;
      case 'object':
        return this.object;
      case 'flags':
        return this.flags;
    }
  }

  /** Places (or removes with 0) an object on a tile; any state of the previous object is dropped. */
  setObject(i: number, runtimeId: number): void {
    this.object[i] = runtimeId;
    this.objectState.delete(i);
  }

  /** State of the object on tile `i`, if it deviates from its generated state. */
  getObjectState(i: number): ObjectState | undefined {
    return this.objectState.get(i);
  }

  /** Records the state of the object on tile `i` (reuses the existing state object). */
  setObjectState(i: number, hp: number, growth: number, regrowAtTick: number = NO_REGROW_TICK): ObjectState {
    if (!Number.isInteger(i) || i < 0 || i >= CHUNK_AREA) throw new RangeError(`ChunkData: tile index ${String(i)} outside 0…${CHUNK_AREA - 1}`);
    let state = this.objectState.get(i);
    if (state === undefined) {
      state = { hp, growth, regrowAtTick };
      this.objectState.set(i, state);
    } else {
      state.hp = hp;
      state.growth = growth;
      state.regrowAtTick = regrowAtTick;
    }
    return state;
  }

  /** Forgets the state of the object on tile `i` (it is back to its generated state). */
  clearObjectState(i: number): void {
    this.objectState.delete(i);
  }

  /** Copies tile data, object states and `frozenAtTick` from a chunk (address may differ). */
  copyFrom(source: ChunkData): this {
    new Uint8Array(this.buffer).set(new Uint8Array(source.buffer));
    this.objectState.clear();
    for (const [i, s] of source.objectState) this.objectState.set(i, { hp: s.hp, growth: s.growth, regrowAtTick: s.regrowAtTick });
    this.frozenAtTick = source.frozenAtTick;
    return this;
  }

  /** Independent deep copy. */
  clone(): ChunkData {
    return new ChunkData(this.layer, this.cx, this.cy).copyFrom(this);
  }

  /** Estimated memory of this chunk: tile data plus object states [bytes]. */
  memoryBytes(): number {
    return CHUNK_BYTES + this.objectState.size * OBJECT_STATE_BYTES_ESTIMATE;
  }
}

// ---------------------------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------------------------

/** Object state tile indices in ascending order. */
function sortedStateIndices(chunk: ChunkData): number[] {
  return [...chunk.objectState.keys()].sort((a, b) => a - b);
}

/**
 * Stable 64 bit hash (16 hex digits) of a chunk: address, all seven arrays in WORLD.md §3 order and
 * the object states in tile order. Equal chunks hash equal on every platform (little endian bytes).
 */
export function chunkHash(chunk: ChunkData): string {
  const h = new Fnv1a64();
  h.update(Int32Array.of(CHUNK_SNAPSHOT_VERSION, chunk.layer, chunk.cx, chunk.cy));
  for (const name of CHUNK_FIELDS) h.update(chunk.field(name));
  const indices = sortedStateIndices(chunk);
  const states = new Float64Array(indices.length * OBJECT_STATE_STRIDE);
  indices.forEach((i, k) => {
    const s = chunk.objectState.get(i) as ObjectState;
    states.set([i, s.hp, s.growth, s.regrowAtTick], k * OBJECT_STATE_STRIDE);
  });
  h.update(states);
  return h.hex();
}

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

/** JSON snapshot of a chunk (saves, exports, debug dumps). */
export interface ChunkSnapshot {
  readonly version: number;
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  readonly frozenAtTick: number;
  /** Per field: base64 of its run length encoding (`rleEncodeU8`/`rleEncodeU16`). */
  readonly fields: Readonly<Record<ChunkField, string>>;
  /** Object states as flat quadruples `[tileIndex, hp, growth, regrowAtTick, …]` in tile order. */
  readonly objects: readonly number[];
}

/** Serializes a chunk into a compact JSON-compatible snapshot. */
export function serializeChunk(chunk: ChunkData): ChunkSnapshot {
  const fields = {} as Record<ChunkField, string>;
  for (const name of CHUNK_FIELDS) {
    fields[name] = name === 'object' ? typedArrayToBase64(rleEncodeU16(chunk.object)) : bytesToBase64(rleEncodeU8(chunk.field(name) as Uint8Array));
  }
  const objects: number[] = [];
  for (const i of sortedStateIndices(chunk)) {
    const s = chunk.objectState.get(i) as ObjectState;
    objects.push(i, s.hp, s.growth, s.regrowAtTick);
  }
  return { version: CHUNK_SNAPSHOT_VERSION, layer: chunk.layer, cx: chunk.cx, cy: chunk.cy, frozenAtTick: chunk.frozenAtTick, fields, objects };
}

function fail(reason: string): never {
  throw new TypeError(`Chunk snapshot invalid: ${reason}`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Restores a chunk from `serializeChunk` output. Throws `TypeError` on malformed data. */
export function deserializeChunk(data: unknown): ChunkData {
  if (typeof data !== 'object' || data === null) fail('not an object');
  const s = data as Partial<Record<keyof ChunkSnapshot, unknown>>;
  if (s.version !== CHUNK_SNAPSHOT_VERSION) fail(`unsupported version ${String(s.version)}`);
  if (!isLayer(s.layer)) fail(`unknown layer ${String(s.layer)}`);
  if (!Number.isSafeInteger(s.cx) || !Number.isSafeInteger(s.cy)) fail('cx/cy must be integers');
  if (!Number.isSafeInteger(s.frozenAtTick) || (s.frozenAtTick as number) < 0) fail('frozenAtTick must be an integer ≥ 0');
  const fields = s.fields;
  if (typeof fields !== 'object' || fields === null) fail('fields missing');
  const chunk = new ChunkData(s.layer, s.cx as number, s.cy as number);
  for (const name of CHUNK_FIELDS) {
    const encoded = (fields as Record<string, unknown>)[name];
    if (typeof encoded !== 'string') fail(`field ${name} missing`);
    try {
      if (name === 'object') chunk.object.set(rleDecodeU16(base64ToTypedArray(encoded, Uint16Array), CHUNK_AREA));
      else (chunk.field(name) as Uint8Array).set(rleDecodeU8(base64ToBytes(encoded), CHUNK_AREA));
    } catch (err) {
      fail(`field ${name}: ${(err as Error).message}`);
    }
  }
  const objects = s.objects;
  if (!Array.isArray(objects) || objects.length % OBJECT_STATE_STRIDE !== 0) fail('objects must be a list of quadruples');
  let previous = -1;
  for (let k = 0; k < objects.length; k += OBJECT_STATE_STRIDE) {
    const [i, hp, growth, regrow] = objects.slice(k, k + OBJECT_STATE_STRIDE) as unknown[];
    if (!Number.isInteger(i) || (i as number) <= previous || (i as number) >= CHUNK_AREA) fail(`object state tile index ${String(i)} invalid or not ascending`);
    if (!isFiniteNumber(hp) || !isFiniteNumber(growth) || !Number.isSafeInteger(regrow) || (regrow as number) < NO_REGROW_TICK) fail(`object state at tile ${String(i)} invalid`);
    chunk.setObjectState(i as number, hp, growth, regrow as number);
    previous = i as number;
  }
  chunk.frozenAtTick = s.frozenAtTick as number;
  return chunk;
}
