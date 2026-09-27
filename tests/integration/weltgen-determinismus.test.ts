/**
 * M2-14 acceptance: determinism hash and the validation sweep – the slow part. It ran in the unit suite
 * until M4-37 and moved here unchanged (ADR-0036: `npm run check` keeps its budget, `npm run verify`
 * runs it); progress, duration and the world worker stay in `tests/unit/world/
 * weltgen-determinismus.test.ts`. The M2-GATE sweep over 20 seeds × 3 sizes, main thread against the
 * worker thread, is `welt-determinismus.test.ts`.
 * - Same seed ⇒ identical world hash and identical hash of all chunk data (every surface chunk of a
 *   Klein world, generated in two different orders from two separately generated worlds; samples of
 *   every underground layer).
 * - 20 seeds ⇒ every validation green (report without problems).
 */
import { describe, expect, it } from 'vitest';
import { chunkHash } from '../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../src/world/model/coords';
import { generateChunk } from '../../src/world/gen/chunk';
import { generateUndergroundChunk } from '../../src/world/gen/underground/index';
import { generateWorld, surfaceChunksHash, worldHash } from '../../src/world/gen/world';

/** Seeds of the validation sweep (Klein). */
const SEEDS = Array.from({ length: 20 }, (_, i) => 31 + i * 104_729);
/** Every how many chunks the structured clone of a world is compared chunk by chunk. */
const CLONE_SAMPLE_STEP = 17;

describe('Determinismus', () => {
  it('gleicher Seed ⇒ identischer Welt-Hash (alle Größen), anderer Seed ⇒ anderer', () => {
    for (const preset of ['small', 'medium', 'large'] as const) {
      const a = generateWorld(4711, preset);
      const b = generateWorld(4711, preset);
      expect(worldHash(a)).toBe(worldHash(b));
      expect(worldHash(generateWorld(4712, preset))).not.toBe(worldHash(a));
    }
  }, 30_000);

  it('gleicher Seed ⇒ identischer Hash aller Oberflächen-Chunks, unabhängig von der Reihenfolge', () => {
    const a = generateWorld(99, 'small');
    const b = generateWorld(99, 'small');
    const chunks = a.plan.grid.tiles / CHUNK_SIZE;
    const reversed = Array.from({ length: chunks * chunks }, (_, i) => chunks * chunks - 1 - i);
    const ha = surfaceChunksHash(a);
    expect(surfaceChunksHash(b, reversed)).toBe(ha);
    // A structured clone (what the worker hands over) builds its own caches and still agrees
    // (every 17th chunk: spread over rows and columns).
    const clone = structuredClone(a);
    for (let id = 0; id < chunks * chunks; id += CLONE_SAMPLE_STEP) {
      const cx = id % chunks;
      const cy = Math.floor(id / chunks);
      expect(chunkHash(generateChunk(clone, 0, cx, cy))).toBe(chunkHash(generateChunk(a, 0, cx, cy)));
    }
  }, 60_000);

  it('Untergrund-Chunks: gleicher Seed ⇒ identische Chunks, delegiert an den Höhlengenerator', () => {
    const a = generateWorld(99, 'small');
    const b = generateWorld(99, 'small');
    const chunks = a.plan.grid.tiles / CHUNK_SIZE;
    for (const layer of [-1, -2, -3] as const) {
      for (let k = 0; k < 12; k++) {
        const cx = (k * 7 + 3) % chunks;
        const cy = (k * 11 + 5) % chunks;
        const h = chunkHash(generateChunk(a, layer, cx, cy));
        expect(chunkHash(generateChunk(b, layer, cx, cy))).toBe(h);
        expect(chunkHash(generateUndergroundChunk(a.underground, layer, cx, cy))).toBe(h);
      }
    }
  }, 30_000);
});

describe('20 Seeds ⇒ alle Validierungen grün', () => {
  it.each(SEEDS)('Seed %i (Klein)', (seed) => {
    const w = generateWorld(seed, 'small');
    expect(w.report.problems).toEqual([]);
    expect(w.report.reachability.unreachableAfter).toBe(0);
    expect(w.report.roads.connected).toBe(true);
  });
});
