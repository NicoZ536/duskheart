/**
 * The structure layers of the world (MASTERPROMPT §16.1; docs/WORLD.md §3 beside the terrain arrays; M4-11):
 * per chunk address one `StructureChunk` with a packed cell (src/world/structures/cells.ts) and the hit points
 * per tile and build layer – floor, structure, object, wall object, roof. Only chunks with something built
 * exist (a chunk without parts is dropped), so the store costs nothing in the wild.
 *
 * The store is independent of chunk residency: buildings are few and small next to the terrain (30 KiB per
 * built chunk), and the systems that read them – collision, rooms, statics, the hearth – must see a building
 * whether or not its terrain chunk is loaded. It is saved by the building system (participant `building`,
 * src/world/structures/snapshot.ts) instead of the terrain's chunk diffs, with the part ids as strings, so new
 * parts never renumber a save (docs/DECISIONS.md, ADR of M4-11).
 *
 * `revision` counts every change of the whole store, `StructureChunk.revision` those of one chunk (render
 * caches, room caches).
 */
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, packChunkId, type Layer } from '../model/coords';
import { BUILD_LAYER_COUNT } from './cells';

/** Structure layers of one chunk. */
export class StructureChunk {
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
  /** Packed cells, build layer by build layer (`layerIndex × 1024 + local index`). */
  readonly cells = new Uint32Array(BUILD_LAYER_COUNT * CHUNK_AREA);
  /** Hit points of the anchors [HP], same layout. */
  readonly hp = new Uint16Array(BUILD_LAYER_COUNT * CHUNK_AREA);
  /** Non-empty cells. */
  used = 0;
  /** Changes of this chunk. */
  revision = 0;

  constructor(layer: Layer, cx: number, cy: number) {
    this.layer = layer;
    this.cx = cx;
    this.cy = cy;
  }
}

/** Index of tile (tx, ty) on build layer `li` inside its chunk's arrays. */
export function structureIndex(li: number, tx: number, ty: number): number {
  return li * CHUNK_AREA + (((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK));
}

/** The structure layers of all chunks. */
export class StructureStore {
  private readonly map = new Map<number, StructureChunk>();
  /** Changes of the whole store. */
  revision = 0;

  /** The structure chunk at (layer, cx, cy), or `undefined` when nothing is built there. */
  chunk(layer: Layer, cx: number, cy: number): StructureChunk | undefined {
    return this.map.get(packChunkId(layer, cx, cy));
  }

  /** The chunk holding tile (tx, ty) of `layer`, or `undefined`. */
  chunkOfTile(layer: Layer, tx: number, ty: number): StructureChunk | undefined {
    return this.map.get(packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT));
  }

  /** Packed cell of tile (tx, ty) on build layer `li` (0 = empty). */
  cell(layer: Layer, li: number, tx: number, ty: number): number {
    const c = this.chunkOfTile(layer, tx, ty);
    return c === undefined ? 0 : (c.cells[structureIndex(li, tx, ty)] as number);
  }

  /** Hit points of the cell (anchors) [HP]. */
  hp(layer: Layer, li: number, tx: number, ty: number): number {
    const c = this.chunkOfTile(layer, tx, ty);
    return c === undefined ? 0 : (c.hp[structureIndex(li, tx, ty)] as number);
  }

  /** Writes a cell and its hit points (0 clears the cell); creates and drops chunks as needed. */
  set(layer: Layer, li: number, tx: number, ty: number, cell: number, hp: number): void {
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    const key = packChunkId(layer, cx, cy);
    let c = this.map.get(key);
    if (c === undefined) {
      if (cell === 0) return;
      c = new StructureChunk(layer, cx, cy);
      this.map.set(key, c);
    }
    const i = structureIndex(li, tx, ty);
    const before = c.cells[i] as number;
    if (before === 0 && cell !== 0) c.used++;
    else if (before !== 0 && cell === 0) c.used--;
    c.cells[i] = cell >>> 0;
    c.hp[i] = cell === 0 ? 0 : hp;
    c.revision++;
    this.revision++;
    if (c.used === 0) this.map.delete(key);
  }

  /** Sets the hit points of an existing cell [HP]. */
  setHp(layer: Layer, li: number, tx: number, ty: number, hp: number): void {
    const c = this.chunkOfTile(layer, tx, ty);
    const i = structureIndex(li, tx, ty);
    if (c === undefined || c.cells[i] === 0) throw new RangeError(`StructureStore: no part on layer ${li} at ${tx}, ${ty}`);
    c.hp[i] = hp;
    c.revision++;
    this.revision++;
  }

  /** Every structure chunk in ascending packed id order (deterministic iteration). */
  chunks(): StructureChunk[] {
    return [...this.map.keys()].sort((a, b) => a - b).map((k) => this.map.get(k) as StructureChunk);
  }

  /** Number of chunks with something built. */
  get size(): number {
    return this.map.size;
  }

  /** Removes everything. */
  clear(): void {
    this.map.clear();
    this.revision++;
  }

  /** Replaces the whole content by a copy of `other` (loading a save into a running store). */
  replaceWith(other: StructureStore): void {
    this.map.clear();
    for (const c of other.chunks()) {
      const copy = new StructureChunk(c.layer, c.cx, c.cy);
      copy.cells.set(c.cells);
      copy.hp.set(c.hp);
      copy.used = c.used;
      this.map.set(packChunkId(c.layer, c.cx, c.cy), copy);
    }
    this.revision++;
  }
}
