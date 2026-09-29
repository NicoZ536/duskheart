/**
 * Occluders of the terrain (M5-01): raised levels and cliff faces as blocks of their height – a light below a
 * plateau does not reach the ground behind its face, a light on it lights the ground below the edge (the gameplay
 * light map's rule, §12.1) –, solid rock as structural walls. Read from the collision view of the tiles
 * (`CollisionGrid.info`: the same categories, levels and plateau tops the light map's raycast reads), without the
 * build grid's overlay (walls come from `buildingOccluders.ts` as thin bands).
 *
 * Per chunk the tiles are merged into row runs and kept until the chunk's content signature – or that of its
 * northern neighbour, whose plateau decides the cliff faces along the border – changes.
 */
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, CollisionGrid, infoLevel, infoWallTop } from '../../world/collision/tiles';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import type { ChunkLookup } from '../world/window';
import type { ChunkSignatures } from '../world/signature';
import { OCCLUDER_FLOATS, OCCLUDER_OFFSET, OCCLUDER_SHAPE, PRISM_FLAG, type OccluderList } from './occluders';
import { OCCLUDER_CLASS, type OccluderClass } from './params';

const CHUNK_TILES = 1 << CHUNK_SHIFT;
/**
 * Floats per cached run: the occluder record itself (`OCCLUDER_FLOATS`, `OCCLUDER_OFFSET`: centre, half extents, top,
 * class, rectangle with the prism flag, ground) – `collect` copies a chunk's runs in one block, no arithmetic per frame.
 */
const RUN_FLOATS = OCCLUDER_FLOATS;
/** Shape code of a run: a rectangle whose footprint casts the sun's shadow as a block. */
const RUN_SHAPE = OCCLUDER_SHAPE.rect + PRISM_FLAG;
/**
 * Cache key of a chunk: layer (+ `KEY_LAYER_BIAS`, the layers 0 … −3) and chunk coordinates (modulo 2^`KEY_COORD_BITS`,
 * far beyond any world's extent) packed into 30 bits – a small integer, so the frame's lookup boxes no float (§30).
 */
const KEY_COORD_BITS = 13;
const KEY_COORD_MASK = (1 << KEY_COORD_BITS) - 1;
const KEY_LAYER_BIAS = 8;
/** A 32-bit signature is kept as two 16-bit halves (small integers: the per-frame comparison boxes nothing). */
const SIG_HALF_BITS = 16;
const SIG_HALF_MASK = (1 << SIG_HALF_BITS) - 1;

function chunkKey(layer: Layer, cx: number, cy: number): number {
  const row = ((layer + KEY_LAYER_BIAS) << KEY_COORD_BITS) | (cy & KEY_COORD_MASK);
  return (row << KEY_COORD_BITS) | (cx & KEY_COORD_MASK);
}

/** What a tile is to the light. */
export interface TerrainTile {
  /** Top of its occluder [px above level 0]; 0: none. */
  top: number;
  cls: OccluderClass;
  /** Height of the ground a pixel on the tile stands on [px]: its level (a cliff face: the level at its foot). */
  ground: number;
}

/**
 * Class, top and ground of a tile from its packed collision info: a raised level blocks up to its height and is the
 * ground at that height; a cliff face (drawn on the tiles south of a plateau edge, on the lower level) blocks up to
 * the plateau and stands on its own, lower level; solid rock is a structural wall one level high.
 */
export function terrainOccluderOf(info: number, out: TerrainTile): void {
  out.top = 0;
  out.cls = OCCLUDER_CLASS.terrain;
  out.ground = 0;
  if ((info & BLOCK_VOID) !== 0) return;
  const level = infoLevel(info);
  out.ground = level * WAND_PX_JE_STUFE;
  if ((info & BLOCK_SOLID) !== 0) {
    out.top = (level + 1) * WAND_PX_JE_STUFE;
    out.cls = OCCLUDER_CLASS.structural;
    return;
  }
  out.top = ((info & BLOCK_WALL) !== 0 ? infoWallTop(info) : level) * WAND_PX_JE_STUFE;
}

interface Entry {
  chunk: ChunkData;
  north: ChunkData | undefined;
  /** Signatures of the chunk and its northern neighbour (0: none) the runs were built from, as 16-bit halves. */
  sigLow: number;
  sigHigh: number;
  northLow: number;
  northHigh: number;
  runs: Float32Array;
  count: number;
  complete: boolean;
  /** The `collect` call that last checked it (its signature halves are that frame's). */
  visit: number;
}

export class TerrainOccluders {
  private grid: CollisionGrid | null = null;
  private gridTiles = 0;
  private gridChunks: ChunkLookup | null = null;
  private readonly entries = new Map<number, Entry>();
  private readonly tile: TerrainTile = { top: 0, cls: OCCLUDER_CLASS.terrain, ground: 0 };
  private scratch = new Float32Array(64 * RUN_FLOATS);
  /** Counts the `collect` calls: a chunk checked in this one lends its signature to its southern neighbour. */
  private visit = 0;

  /** Runs rebuilt in the last `collect` (tests, debug). */
  rebuilt = 0;

  private gridFor(chunks: ChunkLookup, worldTiles: number): CollisionGrid {
    if (this.grid === null || this.gridChunks !== chunks || this.gridTiles !== worldTiles) {
      this.grid = new CollisionGrid({ chunks, worldTiles });
      this.gridChunks = chunks;
      this.gridTiles = worldTiles;
      this.entries.clear();
    }
    return this.grid;
  }

  /** Adds the terrain occluders of `layer` in the tile rectangle [tx0, tx1] × [ty0, ty1] (whole chunks) to `out`. */
  collect(chunks: ChunkLookup, signatures: ChunkSignatures, worldTiles: number, layer: Layer, tx0: number, ty0: number, tx1: number, ty1: number, out: OccluderList): number {
    const grid = this.gridFor(chunks, worldTiles);
    this.rebuilt = 0;
    this.visit++;
    let n = 0;
    // Rows from north to south: the northern neighbour of a chunk below the first row was checked just before.
    for (let cy = ty0 >> CHUNK_SHIFT; cy <= ty1 >> CHUNK_SHIFT; cy++) {
      for (let cx = tx0 >> CHUNK_SHIFT; cx <= tx1 >> CHUNK_SHIFT; cx++) {
        const chunk = chunks.get(layer, cx, cy);
        if (chunk === undefined) continue;
        const e = this.entry(grid, chunks, signatures, layer, cx, cy, chunk);
        out.appendRecords(e.runs, e.count);
        n += e.count;
      }
    }
    return n;
  }

  private entry(grid: CollisionGrid, chunks: ChunkLookup, signatures: ChunkSignatures, layer: Layer, cx: number, cy: number, chunk: ChunkData): Entry {
    const key = chunkKey(layer, cx, cy);
    const north = chunks.get(layer, cx, cy - 1);
    const sig = signatures.of(chunk);
    const sigLow = sig & SIG_HALF_MASK;
    const sigHigh = sig >>> SIG_HALF_BITS;
    let northLow = 0;
    let northHigh = 0;
    if (north !== undefined) {
      // Checked in this call already (the row above): its halves, without asking the signatures again.
      const above = this.entries.get(chunkKey(layer, cx, cy - 1));
      if (above !== undefined && above.visit === this.visit && above.chunk === north) {
        northLow = above.sigLow;
        northHigh = above.sigHigh;
      } else {
        const northSig = signatures.of(north);
        northLow = northSig & SIG_HALF_MASK;
        northHigh = northSig >>> SIG_HALF_BITS;
      }
    }
    let e = this.entries.get(key);
    if (e !== undefined && e.chunk === chunk && e.north === north && e.sigLow === sigLow && e.sigHigh === sigHigh && e.northLow === northLow && e.northHigh === northHigh && e.complete) {
      e.visit = this.visit;
      return e;
    }
    if (e === undefined) {
      e = { chunk, north, sigLow, sigHigh, northLow, northHigh, runs: new Float32Array(0), count: 0, complete: false, visit: this.visit };
      this.entries.set(key, e);
    }
    e.visit = this.visit;
    e.chunk = chunk;
    e.north = north;
    e.sigLow = sigLow;
    e.sigHigh = sigHigh;
    e.northLow = northLow;
    e.northHigh = northHigh;
    this.build(grid, layer, cx, cy, e);
    this.rebuilt++;
    return e;
  }

  /** Merges the chunk's occluding tiles into row runs of equal class and top. */
  private build(grid: CollisionGrid, layer: Layer, cx: number, cy: number, e: Entry): void {
    grid.beginQuery();
    let count = 0;
    let complete = true;
    const t = this.tile;
    for (let row = 0; row < CHUNK_TILES; row++) {
      const ty = cy * CHUNK_TILES + row;
      let runStart = -1;
      let runTop = 0;
      let runCls: OccluderClass = OCCLUDER_CLASS.terrain;
      let runGround = 0;
      for (let col = 0; col <= CHUNK_TILES; col++) {
        let top = 0;
        let cls: OccluderClass = OCCLUDER_CLASS.terrain;
        let ground = 0;
        if (col < CHUNK_TILES) {
          const info = grid.info(layer, cx * CHUNK_TILES + col, ty);
          if ((info & BLOCK_VOID) !== 0) complete = false;
          terrainOccluderOf(info, t);
          top = t.top;
          cls = t.cls;
          ground = t.ground;
        }
        if (runStart >= 0 && (top !== runTop || cls !== runCls || ground !== runGround)) {
          count = this.push(count, (cx * CHUNK_TILES + runStart) * TILE_PX, ty * TILE_PX, (cx * CHUNK_TILES + col) * TILE_PX, (ty + 1) * TILE_PX, runTop, runCls, runGround);
          runStart = -1;
        }
        if ((top > 0 || ground > 0) && runStart < 0) {
          runStart = col;
          runTop = top;
          runCls = cls;
          runGround = ground;
        }
      }
    }
    e.runs = this.scratch.slice(0, count * RUN_FLOATS);
    e.count = count;
    e.complete = complete;
  }

  private push(count: number, x0: number, y0: number, x1: number, y1: number, top: number, cls: OccluderClass, ground: number): number {
    if ((count + 1) * RUN_FLOATS > this.scratch.length) {
      const next = new Float32Array(this.scratch.length * 2);
      next.set(this.scratch);
      this.scratch = next;
    }
    // As `OccluderList.rect` packs it (the record of a prism rectangle).
    const o = count * RUN_FLOATS;
    const d = this.scratch;
    d[o] = (x0 + x1) / 2;
    d[o + 1] = (y0 + y1) / 2;
    d[o + 2] = (x1 - x0) / 2;
    d[o + 3] = (y1 - y0) / 2;
    d[o + OCCLUDER_OFFSET.top] = top;
    d[o + OCCLUDER_OFFSET.cls] = cls;
    d[o + OCCLUDER_OFFSET.shapePrism] = RUN_SHAPE;
    d[o + OCCLUDER_OFFSET.ground] = ground;
    return count + 1;
  }
}
