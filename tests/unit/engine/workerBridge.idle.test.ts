/**
 * M6-05g Bild der Job-Warteschlange ohne Arbeit liest keine Uhr (§30 „Keine Allokationen in Hot-Loops“): `JobQueue.frame()`
 * las je Bild zweimal die Uhr und rechnete `elapsedMs` aus – im Browser `performance.now()`, eine Gleitkommazahl, die
 * unoptimierter Code (der Bildpfad wird selten optimiert) als Heap-Zahl anlegt, ebenso die Differenz (≈ 42 B je Bild).
 * Jetzt endet ein Bild, das nichts auszuliefern und nichts zu starten hat, ohne Uhr: `elapsedMs` ist dann 0.
 *
 * Geprüft wird mit einer zählenden Uhr:
 * - leer (im Thread und im Worker), nur abgebrochene Jobs, alle Worker-Plätze belegt: keine Uhr, `elapsedMs` 0, die
 *   Zähler stimmen;
 * - mit Arbeit misst das Bild wie bisher (die Dauer der Jobs), danach wieder 0 statt des alten Werts; im Thread startet es
 *   Jobs auch, während asynchrone Handler laufen (die Plätze `maxInFlight` gelten nur für den Worker);
 * - ein Bild mit einem Ergebnis eines abgebrochenen Jobs liest die Uhr (es hat etwas auszuliefern) und liefert nichts;
 * - leere Bilder mit einer Uhr, die Gleitkommazahlen liefert, legen nichts an (< 1 B je Bild, Stichproben-Heap-Profil).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { JobQueue, createInProcessChannel, createRpcClient, createRpcServer, inThreadExecutor, workerExecutor } from '../../../src/engine/workerBridge';

interface Api {
  square(x: number): number;
  later(x: number): Promise<number>;
}

/** Mittlerer Abstand zweier Heap-Stichproben [B]. */
const SAMPLING_INTERVAL = 16;
/** Grenze [B je Bild]. */
const MAX_BYTES_PER_FRAME = 1;
/** Leere Bilder je Messung. */
const FRAMES = 2000;

/** A clock that counts its reads; jobs advance it by `costMs`. */
function countingClock(): { ms: number; reads: number; now: () => number } {
  const c = {
    ms: 0,
    reads: 0,
    now: () => {
      c.reads++;
      return c.ms;
    },
  };
  return c;
}

function handlers(clock: { ms: number }, costMs: number, calls: number[]): Api {
  return {
    square(x) {
      calls.push(x);
      clock.ms += costMs;
      return x * x;
    },
    async later(x) {
      await Promise.resolve();
      calls.push(-x);
      return x;
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => inspector.disconnect());

describe('JobQueue.frame ohne Arbeit liest keine Uhr (M6-05g)', () => {
  it('im Thread: leer keine Uhr und 0 ms, mit Arbeit die Dauer der Jobs, danach wieder 0', () => {
    const clock = countingClock();
    const calls: number[] = [];
    const q = new JobQueue(inThreadExecutor(handlers(clock, 3, calls)), { frameBudgetMs: 8, now: clock.now });
    for (let i = 0; i < 3; i++) {
      const s = q.frame();
      expect(s).toEqual({ started: 0, delivered: 0, failed: 0, elapsedMs: 0, queued: 0, inFlight: 0, ready: 0 });
    }
    expect(clock.reads).toBe(0);
    const results: number[] = [];
    for (let i = 1; i <= 2; i++) q.submit('square', [i], { onDone: (r) => results.push(r) });
    const s = q.frame();
    expect(clock.reads).toBeGreaterThan(0);
    expect(s).toMatchObject({ started: 2, delivered: 2, elapsedMs: 6, queued: 0, ready: 0 });
    expect(results).toEqual([1, 4]);
    const reads = clock.reads;
    expect(q.frame().elapsedMs).toBe(0);
    expect(clock.reads).toBe(reads);
    // Only cancelled jobs queued: nothing to start, nothing runs.
    const h = q.submit('square', [9], { onDone: (r) => results.push(r) });
    expect(q.cancel(h)).toBe(true);
    expect(q.frame()).toMatchObject({ started: 0, elapsedMs: 0, queued: 0 });
    expect(clock.reads).toBe(reads);
    expect(calls).toEqual([1, 2]);
  });

  it('im Thread startet ein Bild Jobs auch, während asynchrone Handler laufen', async () => {
    const clock = countingClock();
    const calls: number[] = [];
    const q = new JobQueue(inThreadExecutor(handlers(clock, 1, calls)), { frameBudgetMs: 8, now: clock.now, maxInFlight: 1 });
    const results: number[] = [];
    q.submit('later', [7], { onDone: (r) => results.push(r) });
    expect(q.frame()).toMatchObject({ started: 1, inFlight: 1 });
    q.submit('square', [3], { onDone: (r) => results.push(r) });
    expect(q.frame()).toMatchObject({ started: 1, delivered: 1, inFlight: 1 });
    expect(calls).toEqual([3]);
    await flush();
    q.frame();
    expect(results).toEqual([9, 7]);
    expect(q.idle).toBe(true);
  });

  it('im Worker: leer und bei belegten Plätzen keine Uhr; Ergebnisse werden wie bisher ausgeliefert', async () => {
    const clock = countingClock();
    const calls: number[] = [];
    const [clientPort, serverPort] = createInProcessChannel();
    createRpcServer(handlers(clock, 0, calls), serverPort);
    const q = new JobQueue(workerExecutor(createRpcClient<Api>(clientPort)), { frameBudgetMs: 8, now: clock.now, maxInFlight: 2 });
    expect(q.frame()).toMatchObject({ started: 0, elapsedMs: 0, queued: 0, inFlight: 0 });
    expect(clock.reads).toBe(0);
    const results: number[] = [];
    for (let i = 1; i <= 4; i++) q.submit('square', [i], { onDone: (r) => results.push(r) });
    expect(q.frame()).toMatchObject({ started: 2, queued: 2, inFlight: 2 });
    const reads = clock.reads;
    expect(reads).toBeGreaterThan(0);
    // Both slots taken, no result yet: nothing to do.
    clock.ms = 5;
    expect(q.frame()).toEqual({ started: 0, delivered: 0, failed: 0, elapsedMs: 0, queued: 2, inFlight: 2, ready: 0 });
    expect(clock.reads).toBe(reads);
    await flush();
    expect(q.ready).toBe(2);
    expect(q.frame()).toMatchObject({ started: 2, delivered: 2, queued: 0, inFlight: 2 });
    expect(clock.reads).toBeGreaterThan(reads);
    await flush();
    expect(q.frame()).toMatchObject({ delivered: 2, inFlight: 0, ready: 0 });
    expect(results).toEqual([1, 4, 9, 16]);
    const after = clock.reads;
    expect(q.frame()).toMatchObject({ started: 0, delivered: 0, elapsedMs: 0, inFlight: 0 });
    expect(clock.reads).toBe(after);
  });

  it('ein Ergebnis eines abgebrochenen Jobs: das Bild liest die Uhr und liefert nichts aus', async () => {
    const clock = countingClock();
    const [clientPort, serverPort] = createInProcessChannel();
    createRpcServer(handlers(clock, 0, []), serverPort);
    const q = new JobQueue(workerExecutor(createRpcClient<Api>(clientPort)), { frameBudgetMs: 8, now: clock.now, maxInFlight: 1 });
    const results: number[] = [];
    const h = q.submit('square', [3], { onDone: (r) => results.push(r) });
    q.frame();
    await flush();
    expect(q.ready).toBe(1);
    expect(q.cancel(h)).toBe(true);
    const reads = clock.reads;
    expect(q.frame()).toMatchObject({ delivered: 0, ready: 0 });
    expect(clock.reads).toBeGreaterThan(reads);
    expect(results).toEqual([]);
    expect(q.idle).toBe(true);
  });

  it('leere Bilder mit einer Uhr aus Gleitkommazahlen legen nichts an (< 1 B je Bild)', async () => {
    let t = 0.375;
    const q = new JobQueue(inThreadExecutor(handlers({ ms: 0 }, 0, [])), {
      frameBudgetMs: 8,
      now: () => {
        t += 0.125;
        return t;
      },
    });
    const sink = new Float64Array(1);
    const idleFrames = (n: number): void => {
      for (let i = 0; i < n; i++) sink[0] = q.frame().queued;
    };
    idleFrames(50);
    await inspector.post('HeapProfiler.collectGarbage');
    await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    idleFrames(FRAMES);
    const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'idleFrames' && /workerBridge\.idle\.test/.test(f.url));
    expect(alloc.inPath / FRAMES, `Allokation unter JobQueue.frame: ${JSON.stringify(alloc.top)}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
