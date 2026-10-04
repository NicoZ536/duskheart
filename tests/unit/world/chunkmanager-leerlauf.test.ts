/**
 * M6-05g `ChunkManager.update` liest die Zeit der Job-Warteschlange nur, wenn sie gearbeitet hat (§30 „Keine Allokationen
 * in Hot-Loops“): `s.jobMs = jobs.frame().elapsedMs` las je Bild ein Zahlenfeld, das unoptimierter Code (der Bildpfad wird
 * selten optimiert) als Heap-Zahl liest. Jetzt ist `jobMs` in einem Bild, in dem die Warteschlange nichts ausgeliefert und
 * nichts gestartet hat, 0, ohne das Feld zu lesen (die Warteschlange liest dann auch keine Uhr, `workerBridge.idle.test.ts`).
 *
 * Geprüft wird:
 * - ruhende Kamera, nichts lädt: `jobMs` 0, `elapsedMs` ungelesen; beim Laden die Zeit der Warteschlange (die Jobs rücken
 *   eine Uhr vor), innerhalb des Budgets plus eines Jobs;
 * - mit Worker meldet auch ein Bild, das nur Jobs startet (noch kein Ergebnis) oder nur Ergebnisse ausliefert (nichts mehr
 *   zu starten), seine Zeit; eines, das auf die Ergebnisse wartet, 0;
 * - ruhende Bilder mit einer Uhr aus Gleitkommazahlen legen nichts an (< 1 B je Bild, Stichproben-Heap-Profil).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { JobQueue, createInProcessChannel, createRpcClient, createRpcServer, inThreadExecutor, workerExecutor, type JobFrameStats } from '../../../src/engine/workerBridge';
import { ChunkManager } from '../../../src/world/stream/chunkManager';
import { createChunkWorkerHandlers, type ChunkGenerateFn, type ChunkWorkerApi } from '../../../src/world/stream/worker';
import { FIXTURE_WORLD, fixtureGenerate, fixtureManager, settle, type FixturePlan } from './streamFixture';

/** Mittlerer Abstand zweier Heap-Stichproben [B]. */
const SAMPLING_INTERVAL = 16;
/** Grenze [B je Bild]. */
const MAX_BYTES_PER_FRAME = 1;
/** Ruhende Bilder je Messung. */
const FRAMES = 2000;
/** Budget der Warteschlange und Kosten eines Chunks [ms]. */
const BUDGET_MS = 8;
const COST_MS = 3;

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => inspector.disconnect());

describe('ChunkManager.update liest die Zeit der Warteschlange nur nach Arbeit (M6-05g)', () => {
  it('ruhend jobMs 0 ohne elapsedMs zu lesen, beim Laden die Zeit der Warteschlange', () => {
    const clock = { ms: 0 };
    const generate: ChunkGenerateFn<FixturePlan> = (plan, layer, cx, cy) => {
      clock.ms += COST_MS;
      return fixtureGenerate(plan, layer, cx, cy);
    };
    const jobs = new JobQueue(inThreadExecutor(createChunkWorkerHandlers(generate)), { frameBudgetMs: BUDGET_MS, now: () => clock.ms });
    // The queue's stats behind a view that counts the reads of `elapsedMs`.
    let last: JobFrameStats | null = null;
    let reads = 0;
    const frame = jobs.frame.bind(jobs);
    const view = {
      get started() {
        return (last as JobFrameStats).started;
      },
      get delivered() {
        return (last as JobFrameStats).delivered;
      },
      get failed() {
        return (last as JobFrameStats).failed;
      },
      get elapsedMs() {
        reads++;
        return (last as JobFrameStats).elapsedMs;
      },
      get queued() {
        return (last as JobFrameStats).queued;
      },
      get inFlight() {
        return (last as JobFrameStats).inFlight;
      },
      get ready() {
        return (last as JobFrameStats).ready;
      },
    };
    jobs.frame = () => {
      last = frame();
      return view;
    };
    const { manager } = fixtureManager({ jobs });
    let loadingFrames = 0;
    for (let f = 0; f === 0 || manager.loadingCount > 0; f++) {
      const before = reads;
      const s = manager.update(0, 10, 10);
      const worked = (last as JobFrameStats | null)?.started ?? 0;
      if (worked > 0) {
        loadingFrames++;
        expect(reads).toBe(before + 1);
        expect(s.jobMs).toBe((last as JobFrameStats | null)?.elapsedMs);
        expect(s.jobMs).toBeGreaterThanOrEqual(COST_MS);
        expect(s.jobMs).toBeLessThanOrEqual(BUDGET_MS + COST_MS);
      }
    }
    expect(loadingFrames).toBeGreaterThan(1);
    // Still: nothing loads, the queue's time is not read.
    const before = reads;
    for (let i = 0; i < 10; i++) {
      const s = manager.update(0, 10, 10);
      expect(s.jobMs).toBe(0);
      expect(s.loading).toBe(0);
      expect(s.resident).toBeGreaterThan(0);
    }
    expect(reads).toBe(before);
  });

  it('mit Worker: ein Bild, das nur Jobs startet, meldet seine Zeit, eines, das auf Ergebnisse wartet, 0', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    createRpcServer(createChunkWorkerHandlers(fixtureGenerate), serverPort);
    // Every read of the clock moves it on: a frame that reads it twice has a time.
    let t = 0;
    const jobs = new JobQueue(workerExecutor(createRpcClient<ChunkWorkerApi<FixturePlan>>(clientPort)), {
      frameBudgetMs: BUDGET_MS,
      now: () => (t += 0.25),
      maxInFlight: 3,
    });
    const manager = new ChunkManager({ plan: { seed: 7 }, generate: fixtureGenerate, jobs, world: FIXTURE_WORLD });
    const first = manager.update(0, 10, 10);
    expect(first.requested).toBeGreaterThan(3);
    expect(jobs.inFlight).toBe(3);
    expect(first.jobMs).toBeGreaterThan(0);
    // The worker has not answered yet, its slots are taken: nothing to do.
    const clock = t;
    expect(manager.update(0, 10, 10).jobMs).toBe(0);
    expect(t).toBe(clock);
    for (let i = 0; i < 50 && jobs.ready < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jobs.ready).toBe(3);
    const third = manager.update(0, 10, 10);
    expect(third.integrated).toBeGreaterThan(0);
    expect(third.jobMs).toBeGreaterThan(0);
    expect(t).toBeGreaterThan(clock);
    // To the end of the loading: every frame that integrated chunks has a time – the last ones only deliver (nothing
    // left to start).
    let deliverOnly = 0;
    for (let f = 0; f < 400 && manager.loadingCount > 0; f++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const queued = jobs.queued;
      const s = manager.update(0, 10, 10);
      if (s.integrated > 0) expect(s.jobMs).toBeGreaterThan(0);
      if (s.integrated > 0 && queued === 0) deliverOnly++;
    }
    expect(manager.loadingCount).toBe(0);
    expect(deliverOnly).toBeGreaterThan(0);
  });

  it('ruhende Bilder mit einer Uhr aus Gleitkommazahlen legen nichts an (< 1 B je Bild)', async () => {
    let t = 0.375;
    const now = (): number => {
      t += 0.125;
      return t;
    };
    const { manager } = fixtureManager({ clock: { ms: 0, now } as never });
    settle(manager, 0, 10, 10);
    const sink = new Float64Array(1);
    // The loop reads a count (a number field such as `jobMs` would itself read as a heap number here).
    const stillFrames = (n: number): void => {
      for (let i = 0; i < n; i++) sink[0] = manager.update(0, 10, 10).resident;
    };
    stillFrames(50);
    await inspector.post('HeapProfiler.collectGarbage');
    await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    stillFrames(FRAMES);
    const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'stillFrames' && /chunkmanager-leerlauf\.test/.test(f.url));
    expect(alloc.inPath / FRAMES, `Allokation unter ChunkManager.update: ${JSON.stringify(alloc.top)}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
