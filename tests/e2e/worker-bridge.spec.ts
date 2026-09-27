/**
 * M2-02 acceptance (E2E): while a long job runs in the worker, the main thread is never blocked
 * for more than 16 ms; the job queue keeps every frame within its budget, in the worker and in the
 * in-thread fallback; worker and in-thread results are identical. A control run of the same work
 * on the main thread shows that the measurement does detect blocking.
 *
 * Blocking is the page's own work: the thread time of the tasks of its main thread in the browser's trace, per
 * window of the run (`console.timeStamp` marks). Wall-time gaps of a probe also count the time the thread waits for
 * a core beside SwiftShader (ADR-0037; M4-Gate: a gate run failed on a 32-ms probe gap while the queue's frame work
 * was 0.3 ms) – the probe (a chain of zero-delay timers; a MessageChannel ping loop posted a task per turn, tens of
 * thousands per window, whose garbage caused the very stalls it measured) and the frame work's wall time are reported.
 */
import { expect, test } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import type * as BridgeModule from '../../src/engine/workerBridge';
import type * as ChunkModule from '../../src/world/model/chunk';
import type { ChunkWorkerApi } from '../../src/world/stream/worker';
import type * as FixtureModule from '../unit/world/streamFixture';
import { mainThreadTasks, threadMs, timeStampAt, type TraceEvent } from './trace';
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
/** Most time between two probe pings on average for the probe to count as running [ms] (timers clamp to ≈ 4 ms). */
const PROBE_CADENCE_MS = 8;
/** The measured windows of the run. */
const WINDOWS = ['job', 'control', 'queued', 'fallback'] as const;

test('a running worker job does not block the main thread for more than 16 ms', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await page.goto(pageUrl);
  // The browser's own trace of the run: every task of the page's main thread, the windows marked by the page.
  await browser.startTracing(page, { categories: ['toplevel', 'devtools.timeline'] });
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

    /**
     * Marks the window `name` in the trace and pings itself through a chain of zero-delay timers, recording the
     * longest gap between two pings (reported; the trace judges).
     */
    function probe(name: string): { stop(): Promise<{ maxGapMs: number; pings: number; longTasks: number }> } {
      console.timeStamp(`dh-${name}-start`);
      let last = performance.now();
      let maxGapMs = 0;
      let pings = 0;
      let running = true;
      const ping = (): void => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        pings++;
        if (running) setTimeout(ping, 0);
      };
      setTimeout(ping, 0);
      let longTasks = 0;
      const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask' });
      return {
        async stop() {
          running = false;
          console.timeStamp(`dh-${name}-end`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          observer.disconnect();
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
    let p = probe('job');
    let t0 = performance.now();
    const viaWorker = await conn.client.call('sweep', 5, SWEEP);
    const jobMs = performance.now() - t0;
    const duringJob = await p.stop();

    // 2. Control: the same work on the main thread blocks it.
    p = probe('control');
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
      const probeRun = probe(kind === 'worker' ? 'queued' : 'fallback');
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

  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
  const tasks = mainThreadTasks(trace.traceEvents);
  // Longest thread time of a main-thread task in each window [ms].
  const blocked: Partial<Record<(typeof WINDOWS)[number], number>> = {};
  for (const w of WINDOWS) {
    const from = timeStampAt(trace.traceEvents, `dh-${w}-start`);
    const to = timeStampAt(trace.traceEvents, `dh-${w}-end`);
    expect(from, w).not.toBeNull();
    expect(to, w).not.toBeNull();
    // Tasks that begin inside the window (the task that marks its start ran the set-up before it, e.g. the warm-up).
    blocked[w] = Math.round(Math.max(0, ...tasks.filter((t) => t.ts >= (from ?? 0) && t.ts < (to ?? 0)).map(threadMs)) * 100) / 100;
  }
  // Wall times are reported: the probe's gaps and the queue's frame work.
  console.info('worker-bridge E2E', JSON.stringify({ ...r, blocked }));
  // The worker job is long enough to matter …
  expect(r.jobMs).toBeGreaterThan(5 * MAX_BLOCK_MS);
  // … and the main thread kept running meanwhile: the probe fired all through the job, no task of the page held it.
  expect(r.duringJob.pings).toBeGreaterThan(r.jobMs / PROBE_CADENCE_MS);
  expect(blocked.job).toBeLessThan(MAX_BLOCK_MS);
  expect(r.duringJob.longTasks).toBe(0);
  // The measurement sees blocking when the same work runs on the main thread (trace and probe).
  expect(blocked.control).toBeGreaterThan(MAX_BLOCK_MS);
  expect(blocked.control).toBeGreaterThan(r.controlMs * 0.9);
  expect(r.control.maxGapMs).toBeGreaterThan(r.controlMs * 0.9);
  expect(r.sameSweep).toBe(true);
  // Budgeted job queue: every frame short, in the worker and in the in-thread fallback.
  for (const [w, run] of [['queued', r.queued], ['fallback', r.fallback]] as const) {
    expect(run.hashes).toBe(200);
    expect(blocked[w], w).toBeLessThan(MAX_BLOCK_MS);
    expect(run.longTasks).toBe(0);
  }
  expect(r.fallback.frames).toBeGreaterThan(10); // the budget spread the in-thread work over frames
  expect(r.sameStream).toBe(true);
  expect(errors).toEqual([]);
});
