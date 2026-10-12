/**
 * M7-132: `ChunkManager.forEachResident` once per frame (the world host indexes the resident chunks around the camera)
 * without an iterator object per frame – `Map.prototype.forEach` with a held visitor instead of `for … of` over `values()`
 * (0,57 MB per 55 s on the route of fluessiges-laufen). Every resident chunk is visited exactly once, and a call allocates
 * nothing once optimised.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import type { ChunkData } from '../../../src/world/model/chunk';
import { fixtureManager, settle } from './streamFixture';

const SAMPLING_INTERVAL = 16;
const COMPILER_PAUSE_MS = 200;
const MAX_WINDOWS = 4;
/** Visits per window (frames of the game view). */
const CALLS = 3000;
/**
 * The first visits of this module: the interpreter and the baseline tier, where a `for … of` over `values()` holds a Map
 * iterator object per call (≥ 32 B) that the optimising compiler's scalar replacement would hide in the warm windows –
 * in the browser the visit runs in those tiers for its first frames and after every deoptimisation.
 */
const COLD_CALLS = 512;
/**
 * Limit [B per call] of the cold calls: the first calls of a function allocate its feedback vector and its baseline code
 * once (≈ 7 KB over all functions of the visit, whatever the call count); a Map iterator per call is ≥ 32 B, and in the
 * tiers of the cold calls its `next` results come on top – two objects per resident chunk, ≈ 1,4 KB per call measured.
 */
const MAX_COLD_BYTES_PER_CALL = 32;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

describe('ChunkManager.forEachResident ohne Iterator je Frame (M7-132)', () => {
  it('visits every resident chunk once, and a visit allocates nothing', async () => {
    const { manager } = fixtureManager({ budgetMs: 1000 });
    settle(manager, 0, 12, 10);
    const resident = manager.residentCount;
    expect(resident).toBeGreaterThan(20);
    // A held visitor as the world host keeps one (`this.index`): it counts the chunks of the visit.
    let visited = 0;
    const count = (_c: ChunkData): void => {
      visited++;
    };
    // Cold: the first calls of the visit in this module (see `COLD_CALLS`).
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
    function kalt(): void {
      for (let i = 0; i < COLD_CALLS; i++) manager.forEachResident(count);
    }
    kalt();
    const coldProfile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    const cold = pathAllocation(coldProfile, (f) => f.functionName === 'kalt' && /chunkmanager-besuch/.test(f.url));
    expect(visited).toBe(COLD_CALLS * resident);
    expect(cold.inPath / COLD_CALLS, `cold: ${(cold.inPath / COLD_CALLS).toFixed(2)} B/call ${JSON.stringify(cold.top)}`).toBeLessThan(MAX_COLD_BYTES_PER_CALL);
    const seen = new Set<ChunkData>();
    manager.forEachResident((c) => seen.add(c));
    expect(seen.size).toBe(resident);
    function besuche(): void {
      for (let i = 0; i < CALLS; i++) manager.forEachResident(count);
    }
    besuche();
    besuche();
    const windows: Array<{ per: number; top: unknown }> = [];
    do {
      if (windows.length > 0) await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      await session.post('HeapProfiler.collectGarbage');
      await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
      visited = 0;
      besuche();
      const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'besuche' && /chunkmanager-besuch/.test(f.url));
      windows.push({ per: alloc.inPath / CALLS, top: alloc.top });
      expect(visited).toBe(CALLS * resident);
    } while ((windows[windows.length - 1] as { per: number }).per >= 1 && windows.length < MAX_WINDOWS);
    const best = Math.min(...windows.map((w) => w.per));
    // A Map iterator per call is ≥ 32 B; a closure per call ≥ 32 B more.
    expect(best, windows.map((w, i) => `window ${i + 1}: ${w.per.toFixed(2)} B/call ${JSON.stringify(w.top)}`).join('; ')).toBeLessThan(1);
  });
});
