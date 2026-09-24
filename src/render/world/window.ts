/**
 * Tile window around one chunk for the terrain mesh (M2-28): the chunk's fields plus a margin read
 * from its eight neighbours, so autotiling (3×3 neighbourhood), cliffs (a wall looks up to four
 * levels north) and water depth (three tiles to the shore) are seamless across chunk borders.
 *
 * A neighbour that is not resident yet is replaced by the chunk's own border (clamped), and the
 * window records which neighbours it saw: the mesh is rebuilt once they arrive.
 */
import type { ChunkData } from '../../world/model/chunk';
import type { Layer } from '../../world/model/coords';
import { CHUNK_TILES } from '../tilemap/chunk';

/** Window margins around the chunk [tiles]. */
export const WINDOW_MARGIN = {
  west: 3,
  east: 3,
  /** Cliff walls look up to four rows north, the tile above a wall one more, plus a spare row. */
  north: 6,
  south: 3,
} as const;
export const WINDOW_W = CHUNK_TILES + WINDOW_MARGIN.west + WINDOW_MARGIN.east;
export const WINDOW_H = CHUNK_TILES + WINDOW_MARGIN.north + WINDOW_MARGIN.south;
/** Neighbour slots: (dy + 1) × 3 + (dx + 1). */
export const NEIGHBOUR_SLOTS = 9;
export const CENTRE_SLOT = 4;

/** Where the window gets chunks from (the chunk manager, or a test fixture). */
export interface ChunkLookup {
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined;
}

export class ChunkWindow {
  readonly ground = new Uint8Array(WINDOW_W * WINDOW_H);
  readonly height = new Uint8Array(WINDOW_W * WINDOW_H);
  readonly water = new Uint8Array(WINDOW_W * WINDOW_H);
  readonly solid = new Uint8Array(WINDOW_W * WINDOW_H);
  readonly flags = new Uint8Array(WINDOW_W * WINDOW_H);
  readonly biome = new Uint8Array(WINDOW_W * WINDOW_H);
  /** The 3×3 chunks the window was filled from (`null` = not resident, border clamped). */
  readonly neighbours: (ChunkData | null)[] = new Array<ChunkData | null>(NEIGHBOUR_SLOTS).fill(null);

  /** Window index of chunk-local tile (x, y); x ∈ [−west, 32 + east), y ∈ [−north, 32 + south). */
  static index(x: number, y: number): number {
    return (y + WINDOW_MARGIN.north) * WINDOW_W + (x + WINDOW_MARGIN.west);
  }

  /** Window index of (x, y) clamped into the window. */
  static clamped(x: number, y: number): number {
    const cx = Math.min(Math.max(x, -WINDOW_MARGIN.west), CHUNK_TILES + WINDOW_MARGIN.east - 1);
    const cy = Math.min(Math.max(y, -WINDOW_MARGIN.north), CHUNK_TILES + WINDOW_MARGIN.south - 1);
    return ChunkWindow.index(cx, cy);
  }

  /** Fills the window around `centre` from `lookup`. */
  fill(centre: ChunkData, lookup: ChunkLookup): void {
    const { layer, cx, cy } = centre;
    for (let s = 0; s < NEIGHBOUR_SLOTS; s++) {
      const dx = (s % 3) - 1;
      const dy = Math.floor(s / 3) - 1;
      this.neighbours[s] = s === CENTRE_SLOT ? centre : (lookup.get(layer, cx + dx, cy + dy) ?? null);
    }
    for (let y = -WINDOW_MARGIN.north; y < CHUNK_TILES + WINDOW_MARGIN.south; y++) {
      const oy = y < 0 ? -1 : y >= CHUNK_TILES ? 1 : 0;
      for (let x = -WINDOW_MARGIN.west; x < CHUNK_TILES + WINDOW_MARGIN.east; x++) {
        const ox = x < 0 ? -1 : x >= CHUNK_TILES ? 1 : 0;
        let src = this.neighbours[(oy + 1) * 3 + (ox + 1)] ?? null;
        let lx = x - ox * CHUNK_TILES;
        let ly = y - oy * CHUNK_TILES;
        if (src === null) {
          src = centre;
          lx = Math.min(Math.max(x, 0), CHUNK_TILES - 1);
          ly = Math.min(Math.max(y, 0), CHUNK_TILES - 1);
        }
        const i = ly * CHUNK_TILES + lx;
        const w = ChunkWindow.index(x, y);
        this.ground[w] = src.ground[i] as number;
        this.height[w] = src.height[i] as number;
        this.water[w] = src.water[i] as number;
        this.solid[w] = src.solid[i] as number;
        this.flags[w] = src.flags[i] as number;
        this.biome[w] = src.biome[i] as number;
      }
    }
  }
}
