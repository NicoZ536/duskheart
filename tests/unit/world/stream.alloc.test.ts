/**
 * §30 "Keine Allokationen in Hot-Loops" for the streaming frame path: while the camera and the
 * player stay in their chunks and no worker result arrives, `ChunkManager.update`,
 * `JobQueue.frame` and `ActiveZone.update` allocate nothing (sampling heap profiler of
 * `node:inspector`, as the render frame-path bench does).
 *
 * A per-frame allocation shows in every measured window. One-off allocations of the engine (optimized code being
 * installed after tier-up) show in at most one: under load the background compiler finishes later, and a gate run
 * saw the code of the inlined `ActiveZone.update` land inside the window (328 KB once, 8 B per frame on average). So
 * the path is measured again after a pause for the compiler while a window exceeds the budget – up to
 * `MAX_WINDOWS` windows (a later gate run saw one-off code of two different functions in two consecutive windows,
 * 5.1 and 3.0 B per frame); every window is reported and the best one must hold. An allocation in every frame
 * (≥ 16 B per frame) or a deopt loop shows in every window and fails all of them.
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
/** Pause for the background compiler before another window [ms]. */
const COMPILER_PAUSE_MS = 200;
/** Measured windows at most (one-off engine allocations land in some, a per-frame allocation in all). */
const MAX_WINDOWS = 4;

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

    const measure = async (): Promise<{ perFrame: number; top: unknown }> => {
      await session.post('HeapProfiler.collectGarbage');
      await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      for (let i = 0; i < FRAMES; i++) frame();
      const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
      // Everything below the loop body counts (V8 inlines the update methods into it).
      const alloc = pathAllocation(profile, (f) => f.functionName === 'frame' && /stream\.alloc\.test/.test(f.url));
      return { perFrame: alloc.inPath / FRAMES, top: alloc.top };
    };
    const windows = [await measure()];
    while ((windows[windows.length - 1] as { perFrame: number }).perFrame >= MAX_BYTES_PER_FRAME && windows.length < MAX_WINDOWS) {
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      windows.push(await measure());
    }
    const best = Math.min(...windows.map((w) => w.perFrame));
    const report = windows.map((w, i) => `window ${i + 1}: ${w.perFrame.toFixed(3)} B/frame ${JSON.stringify(w.top)}`).join('; ');
    expect(best, `allocations below the frame loop – ${report}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
