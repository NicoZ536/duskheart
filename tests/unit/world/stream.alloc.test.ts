/**
 * §30 "Keine Allokationen in Hot-Loops" for the streaming frame path: while the camera and the
 * player stay in their chunks and no worker result arrives, `ChunkManager.update`,
 * `JobQueue.frame` and `ActiveZone.update` allocate nothing (sampling heap profiler of
 * `node:inspector`, as the render frame-path bench does).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { ActiveZone } from '../../../src/world/stream/activeZone';
import { CatchUpRegistry } from '../../../src/world/stream/catchUp';
import { fixtureManager, settle } from './streamFixture';

/** Mean bytes between two heap samples (small: almost every allocation is seen). */
const SAMPLING_INTERVAL = 16;
/** Frames sampled: one-off allocations of the engine (tier-up) stay far below 1 B per frame. */
const FRAMES = 40_000;
/** A single allocation per frame (≥ 16 B) would exceed this by far. */
const MAX_BYTES_PER_FRAME = 1;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

describe('streaming frame path', () => {
  it('allocates nothing while nothing moves and nothing arrives', async () => {
    const { manager } = fixtureManager();
    settle(manager, 0, 10, 10);
    let tick = 0;
    const zone = new ActiveZone({ chunks: manager, catchUp: new CatchUpRegistry().seal([]), tick: () => tick });
    zone.update(0, 10, 10);
    const frame = (): void => {
      tick++;
      manager.update(0, 10, 10);
      zone.update(0, 10, 10);
    };
    for (let i = 0; i < FRAMES / 4; i++) frame(); // warm-up: optimized code

    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    for (let i = 0; i < FRAMES; i++) frame();
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    // Everything below the loop body counts (V8 inlines the update methods into it).
    const alloc = pathAllocation(profile, (f) => f.functionName === 'frame' && /stream\.alloc\.test/.test(f.url));
    expect(alloc.inPath / FRAMES, `allocations below the frame loop: ${JSON.stringify(alloc.top)}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
