/**
 * M2-02 acceptance (E2E): while a long job runs in the worker, the main thread is never blocked
 * for more than 16 ms; the job queue keeps every frame within its budget, in the worker and in the
 * in-thread fallback; worker and in-thread results are identical. A control run of the same work
 * on the main thread shows that the probe does detect blocking.
 */
import { expect, test } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import type * as BridgeModule from '../../src/engine/workerBridge';
import type * as ChunkModule from '../../src/world/model/chunk';
import type { ChunkWorkerApi } from '../../src/world/stream/worker';
import type * as FixtureModule from '../unit/world/streamFixture';
import { collectErrors, fixtureWorkerSource, startWorkerDevServer } from './worker-devserver';

let server: ViteDevServer;
let pageUrl: string;

test.beforeAll(async () => {
  ({ server, pageUrl } = await startWorkerDevServer());
});

test.afterAll(async () => {
  await server.close();
});

/** Longest main-thread stall the acceptance allows [ms]. */
const MAX_BLOCK_MS = 16;

test('a running worker job does not block the main thread for more than 16 ms', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(pageUrl);
  const r = await page.evaluate(async (source) => {
    type Bridge = typeof BridgeModule;
    type Fixture = typeof FixtureModule;
    type ChunkModel = typeof ChunkModule;
    interface Api extends ChunkWorkerApi<{ seed: number }> {
      sweep(seed: number, count: number): string[];
    }
    const origin = location.origin;
    const bridge = (await import(`${origin}/src/engine/workerBridge.ts`)) as Bridge;
    const fixture = (await import(`${origin}/tests/unit/world/streamFixture.ts`)) as Fixture;
    const model = (await import(`${origin}/src/world/model/chunk.ts`)) as ChunkModel;

    /** Pings itself through a MessageChannel and records the longest gap between two pings. */
    function probe(): { stop(): Promise<{ maxGapMs: number; pings: number; longTasks: number }> } {
      const channel = new MessageChannel();
      let last = performance.now();
      let maxGapMs = 0;
      let pings = 0;
      let running = true;
      channel.port1.onmessage = () => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        pings++;
        if (running) channel.port2.postMessage(0);
      };
      channel.port2.postMessage(0);
      let longTasks = 0;
      const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask' });
      return {
        async stop() {
          running = false;
          await new Promise((resolve) => setTimeout(resolve, 20));
          observer.disconnect();
          channel.port1.close();
          return { maxGapMs, pings, longTasks };
        },
      };
    }
    const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' });
    const conn = bridge.connectWorker<Api>(worker);
    await conn.client.call('init', { seed: 5 });
    await conn.client.call('sweep', 5, 16); // warm-up: modules compiled, JIT settled

    // 1. One long job in the worker.
    const SWEEP = 600;
    let p = probe();
    let t0 = performance.now();
    const viaWorker = await conn.client.call('sweep', 5, SWEEP);
    const jobMs = performance.now() - t0;
    const duringJob = await p.stop();

    // 2. Control: the same work on the main thread blocks it.
    p = probe();
    await new Promise((resolve) => setTimeout(resolve, 10));
    t0 = performance.now();
    const local: string[] = [];
    for (let i = 0; i < SWEEP; i++) local.push(model.chunkHash(fixture.fixtureGenerate({ seed: 5 }, 0, i % 32, Math.floor(i / 32) % 32)));
    const controlMs = performance.now() - t0;
    const control = await p.stop();

    // 3. Job queue with a frame budget: 200 chunk loads, worker executor vs in-thread fallback.
    async function stream(kind: 'worker' | 'inThread'): Promise<{ hashes: string[]; maxFrameMs: number; frames: number; maxGapMs: number; longTasks: number }> {
      const executor = kind === 'worker' ? bridge.workerExecutor(conn.client) : bridge.inThreadExecutor(fixture.fixtureHandlers());
      const queue = new bridge.JobQueue(executor, { frameBudgetMs: 2, now: () => performance.now(), maxInFlight: 4 });
      const hashes = new Array<string>(200);
      queue.submit('init', [{ seed: 5 }], { priority: -1, onDone: () => undefined });
      for (let i = 0; i < 200; i++) {
        queue.submit('load', [{ layer: 0, cx: i % 20, cy: Math.floor(i / 20), diff: null }], { priority: i, onDone: (l) => (hashes[i] = l.hash) });
      }
      const probeRun = probe();
      let maxFrameMs = 0;
      let frames = 0;
      while (!queue.idle) {
        await nextFrame();
        const start = performance.now();
        queue.frame();
        maxFrameMs = Math.max(maxFrameMs, performance.now() - start);
        frames++;
      }
      const gaps = await probeRun.stop();
      return { hashes, maxFrameMs, frames, maxGapMs: gaps.maxGapMs, longTasks: gaps.longTasks };
    }
    const queued = await stream('worker');
    // Warm-up of the in-thread path (the worker path was warmed up above).
    const warm = new bridge.JobQueue(bridge.inThreadExecutor(fixture.fixtureHandlers()), { frameBudgetMs: 1000, now: () => performance.now() });
    warm.submit('init', [{ seed: 5 }], { onDone: () => undefined });
    for (let i = 0; i < 16; i++) warm.submit('load', [{ layer: 0, cx: 31 - i, cy: 31, diff: null }], { onDone: () => undefined });
    warm.frame();
    const fallback = await stream('inThread');
    conn.terminate();
    return {
      jobMs,
      duringJob,
      controlMs,
      control,
      sameSweep: JSON.stringify(viaWorker) === JSON.stringify(local),
      queued: { ...queued, hashes: queued.hashes.length },
      fallback: { ...fallback, hashes: fallback.hashes.length },
      sameStream: JSON.stringify(queued.hashes) === JSON.stringify(fallback.hashes) && queued.hashes.every((h) => typeof h === 'string'),
    };
  }, fixtureWorkerSource(new URL(pageUrl).origin));

  console.info('worker-bridge E2E', JSON.stringify(r));
  // The worker job is long enough to matter …
  expect(r.jobMs).toBeGreaterThan(5 * MAX_BLOCK_MS);
  // … and the main thread kept running meanwhile.
  expect(r.duringJob.pings).toBeGreaterThan(100);
  expect(r.duringJob.maxGapMs).toBeLessThan(MAX_BLOCK_MS);
  expect(r.duringJob.longTasks).toBe(0);
  // The probe sees blocking when the same work runs on the main thread.
  expect(r.control.maxGapMs).toBeGreaterThan(MAX_BLOCK_MS);
  expect(r.control.maxGapMs).toBeGreaterThan(r.controlMs * 0.9);
  expect(r.sameSweep).toBe(true);
  // Budgeted job queue: every frame short, in the worker and in the in-thread fallback.
  for (const run of [r.queued, r.fallback]) {
    expect(run.hashes).toBe(200);
    expect(run.maxFrameMs).toBeLessThan(MAX_BLOCK_MS);
    expect(run.maxGapMs).toBeLessThan(MAX_BLOCK_MS);
    expect(run.longTasks).toBe(0);
  }
  expect(r.fallback.frames).toBeGreaterThan(10); // the budget spread the in-thread work over frames
  expect(r.sameStream).toBe(true);
  expect(errors).toEqual([]);
});
