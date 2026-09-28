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
import type { OccluderList } from './occluders';
import { OCCLUDER_CLASS, type OccluderClass } from './params';

const CHUNK_TILES = 1 << CHUNK_SHIFT;
/** Floats per cached run: x0, y0, x1, y1 [world px], top [px], class, ground [px]. */
const RUN_FLOATS = 7;

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
  sig: number;
  northSig: number;
  runs: Float32Array;
  count: number;
  complete: boolean;
}

export class TerrainOccluders {
  private grid: CollisionGrid | null = null;
  private gridTiles = 0;
  private gridChunks: ChunkLookup | null = null;
  private readonly entries = new Map<number, Entry>();
  private readonly tile: TerrainTile = { top: 0, cls: OCCLUDER_CLASS.terrain, ground: 0 };
  private scratch = new Float32Array(64 * RUN_FLOATS);

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
    let n = 0;
    for (let cy = ty0 >> CHUNK_SHIFT; cy <= ty1 >> CHUNK_SHIFT; cy++) {
      for (let cx = tx0 >> CHUNK_SHIFT; cx <= tx1 >> CHUNK_SHIFT; cx++) {
        const chunk = chunks.get(layer, cx, cy);
        if (chunk === undefined) continue;
        const e = this.entry(grid, chunks, signatures, layer, cx, cy, chunk);
        const runs = e.runs;
        for (let i = 0; i < e.count; i++) {
          const o = i * RUN_FLOATS;
          const cls = runs[o + 5] as OccluderClass;
          out.rect(runs[o] ?? 0, runs[o + 1] ?? 0, runs[o + 2] ?? 0, runs[o + 3] ?? 0, runs[o + 4] ?? 0, cls, true, runs[o + 6] ?? 0);
        }
        n += e.count;
      }
    }
    return n;
  }

  private entry(grid: CollisionGrid, chunks: ChunkLookup, signatures: ChunkSignatures, layer: Layer, cx: number, cy: number, chunk: ChunkData): Entry {
    const key = ((layer + 8) * 65536 + (cy & 0xffff)) * 65536 + (cx & 0xffff);
    const north = chunks.get(layer, cx, cy - 1);
    const sig = signatures.of(chunk);
    const northSig = north === undefined ? 0 : signatures.of(north);
    let e = this.entries.get(key);
    if (e !== undefined && e.chunk === chunk && e.north === north && e.sig === sig && e.northSig === northSig && e.complete) return e;
    if (e === undefined) {
      e = { chunk, north, sig, northSig, runs: new Float32Array(0), count: 0, complete: false };
      this.entries.set(key, e);
    }
    e.chunk = chunk;
    e.north = north;
    e.sig = sig;
    e.northSig = northSig;
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
    const o = count * RUN_FLOATS;
    this.scratch[o] = x0;
    this.scratch[o + 1] = y0;
    this.scratch[o + 2] = x1;
    this.scratch[o + 3] = y1;
    this.scratch[o + 4] = top;
    this.scratch[o + 5] = cls;
    this.scratch[o + 6] = ground;
    return count + 1;
  }
}
