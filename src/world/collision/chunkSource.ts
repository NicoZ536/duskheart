/**
 * Read access to loaded chunks for the systems that query tiles (collision, temperature field).
 * `ChunkManager.get` (src/world/stream/chunkManager.ts) satisfies it; tests pass a plain map.
 */
import type { ChunkData } from '../model/chunk';
import type { Layer } from '../model/coords';

/** Loaded chunks by address. */
export interface ChunkSource {
  /** The loaded chunk at (layer, cx, cy), or `undefined` if it is not resident. */
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined;
}
