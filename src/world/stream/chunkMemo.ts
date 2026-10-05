/**
 * Generated chunks kept per world (docs/ARCHITEKTUR.md "Simulation", "Weltgenerierung"; M6-93).
 *
 * A chunk generator is a pure function of the world and the chunk address (`ChunkGenerateFn`, docs/WORLD.md §2), and
 * `loadChunk` – the only consumer of a generator in the chunk store and the chunk worker – copies what the generator
 * returns and never writes to it ("the generator keeps whatever it returned"). So the chunks a generator produced for
 * one world object can be handed out again instead of being generated anew: two simulations of the same world (a save
 * loaded into the running world, a snapshot restored, two runs compared, the next test on the same seed) find the
 * chunks of the first one. `memoizeChunkGenerator` wraps a generator with that memory:
 * - keyed by the world object (a `WeakMap`: the chunks go when the world goes) and the packed chunk address;
 * - at most `capacity` chunks per world, the least recently used one leaves first (one chunk ≈ 8 KiB of tile data plus
 *   its object states, docs/ARCHITEKTUR.md "Speicherbedarf je Chunk");
 * - the chunks it hands out are the generator's own objects, shared by every caller: only `loadChunk` (which copies)
 *   may receive them, never code that writes to a chunk.
 * It changes no state: what it returns is what the generator returned for the same world and address, and the
 * generator is pure. It is not used where generating is the subject (the generator's own tests and its determinism
 * checks call `generateChunk` directly).
 */
import type { ChunkData } from '../model/chunk';
import { packChunkId } from '../model/coords';
import type { ChunkGenerateFn } from './worker';

/** `generate` with a memory of the last `capacity` chunks it generated per world object (see module comment). */
export function memoizeChunkGenerator<Plan extends object>(generate: ChunkGenerateFn<Plan>, capacity: number): ChunkGenerateFn<Plan> {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError(`memoizeChunkGenerator: capacity must be an integer ≥ 1, got ${String(capacity)}`);
  /** Chunks per world, least recently used first (a `Map` iterates in insertion order). */
  const byWorld = new WeakMap<Plan, Map<number, ChunkData>>();
  return (plan: Plan, layer, cx, cy) => {
    let chunks = byWorld.get(plan);
    if (chunks === undefined) {
      chunks = new Map();
      byWorld.set(plan, chunks);
    }
    const id = packChunkId(layer, cx, cy);
    const known = chunks.get(id);
    if (known !== undefined) {
      chunks.delete(id);
      chunks.set(id, known);
      return known;
    }
    const chunk = generate(plan, layer, cx, cy);
    chunks.set(id, chunk);
    if (chunks.size > capacity) {
      for (const oldest of chunks.keys()) {
        chunks.delete(oldest);
        break;
      }
    }
    return chunk;
  };
}
