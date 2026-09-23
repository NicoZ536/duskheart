/**
 * Static ground mesh of one chunk (docs/RENDER.md §3 `tilemap/chunkMesh.ts`, MASTERPROMPT §6.1
 * pass 1): one 8-byte instance per non-empty tile, drawn as instanced 16×16 quads by `tilemap.vert`.
 * Built on the CPU only when the chunk changed; the result stays on the GPU as a static buffer.
 *
 * | Byte | Attribute (location) | Type | Content |
 * |---|---|---|---|
 * | 0 | aTile (1) | u8×4 → uvec4 | tile x, tile y in the chunk, palette row, flags (bit 0 mirror) |
 * | 4 | aRect (2) | u16×2 → uvec2 | atlas x, y of the 16×16 frame |
 */
import { CHUNK_TILES, TILE_NONE, TILES_PER_CHUNK, type GroundChunk } from './chunk';
import type { TileSet, TileVariant } from './tileSet';

export const TILE_INSTANCE_STRIDE = 8;
/** Byte offsets of the instance attributes. */
export const TILE_OFFSET = { tile: 0, rect: 4 } as const;
/** Attribute locations (`layout(location = …)` in tilemap.vert). */
export const TILE_LOCATION = { corner: 0, tile: 1, rect: 2 } as const;
/** Instance flags (aTile.w). */
export const TILE_FLAG_MIRROR = 1;

const FLAGS_BYTE = 3;
const ROW_BYTE = 2;

/** A built chunk mesh: `count` instances in `data` (exactly `count · TILE_INSTANCE_STRIDE` bytes). */
export interface ChunkMeshData {
  readonly count: number;
  readonly data: Uint8Array;
}

/** Builds the instance records of every non-empty tile of `chunk` (row-major order); unknown tile ids throw. */
export function buildChunkMesh(chunk: GroundChunk, tiles: TileSet): ChunkMeshData {
  let count = 0;
  for (let i = 0; i < TILES_PER_CHUNK; i++) if (chunk.groundAt(i) !== TILE_NONE) count++;
  const data = new Uint8Array(count * TILE_INSTANCE_STRIDE);
  const u16 = new Uint16Array(data.buffer);
  const variant: TileVariant = { x: 0, y: 0, mirror: false };
  const wx0 = chunk.cx * CHUNK_TILES;
  const wy0 = chunk.cy * CHUNK_TILES;
  let n = 0;
  for (let ty = 0; ty < CHUNK_TILES; ty++) {
    for (let tx = 0; tx < CHUNK_TILES; tx++) {
      const i = ty * CHUNK_TILES + tx;
      if (!tiles.resolve(chunk.groundAt(i), wx0 + tx, wy0 + ty, variant)) continue;
      const o = n * TILE_INSTANCE_STRIDE;
      data[o + TILE_OFFSET.tile] = tx;
      data[o + TILE_OFFSET.tile + 1] = ty;
      data[o + TILE_OFFSET.tile + ROW_BYTE] = chunk.paletteRowAt(i);
      data[o + TILE_OFFSET.tile + FLAGS_BYTE] = variant.mirror ? TILE_FLAG_MIRROR : 0;
      const w = (o + TILE_OFFSET.rect) / Uint16Array.BYTES_PER_ELEMENT;
      u16[w] = variant.x;
      u16[w + 1] = variant.y;
      n++;
    }
  }
  return { count: n, data };
}
