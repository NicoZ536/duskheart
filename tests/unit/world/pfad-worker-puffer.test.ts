/**
 * Der Worker-Weg des Pfaddienstes ohne Kopie und ohne Objekt je Anfrage (M6-Review perf:path-worker-message-alloc, §30
 * „Keine Allokationen in Hot-Loops (Pools, Typed Arrays)“): Jeder Schnappschuss wird in die Puffer einer Nachricht aus dem
 * Pool des Dienstes kopiert; sie gehen zum Worker und kommen mit seiner Antwort zurück (`PathJobBuffers`), auch die Antwort
 * eines Auftrags, den der Dienst unterwegs aufgab (`onDropped`). Argumente, Optionen und Rückrufe des Auftrags legt der
 * Dienst einmal je Nachricht an.
 * - Mit der Job-Queue des Workers (Ausführer im selben Thread, das Protokoll des Workers: strukturierte Klone, Puffer
 *   verschoben) entsteht im eingeschwungenen Zustand kein neuer Pufferspeicher je Anfrage – vorher ein kopierter
 *   Schnappschuss, Kilobytes –, und der Pool bleibt bei den gleichzeitig wartenden Aufträgen.
 * - Mit einer Warteschlange, die Nachrichten ohne Klon weiterreicht, misst der Heap, was der Dienst selbst je Anfrage auf
 *   dem Worker-Weg anlegt: nichts (vorher Kopf-Array, drei Teilkopien, Transferliste, Argumentliste, Optionen und zwei
 *   Closures, ≈ 1,8 KB).
 * - Aufgegebene Aufträge (abgebrochen, vom Simulationsthread gerechnet) geben ihre Puffer zurück.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { Rng } from '../../../src/engine/rng';
import { JobQueue, createInProcessChannel, createRpcClient, workerExecutor, type JobHandle, type JobState } from '../../../src/engine/workerBridge';
import { BLOCK_ALL, CollisionGrid } from '../../../src/world/collision/tiles';
import { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { PathJobRunner, type PathJob } from '../../../src/world/path/find';
import { PathService } from '../../../src/world/path/service';
import type { PathRequest, PathTicket } from '../../../src/world/path/types';
import { createPathJobs, servePathWorker, type PathJobs, type PathWorkerApi } from '../../../src/world/path/worker';

const IDS = contentWorldIdTables();
const GRAS = IDS.terrain.runtimeId('gras');
const BIRKE = IDS.objects.runtimeId('baum_birke');
/** The world: 5 × 5 chunks of meadow with a birch every 17 tiles; paths stay in the middle 3 × 3. */
const CHUNKS = 5;
/** Requests per tick (as many as one tick admits) and ticks of each phase. */
const PER_TICK = BALANCE.ai.path.requestsPerTick;
const WARM_TICKS = 240;
const MEASURED_TICKS = 240;
/** Most new buffer bytes per request without a copied snapshot (`sim:pfad-200 · Worker-Weg: Pufferspeicher je Anfrage`). */
const BUDGET_BYTES = 64;
/**
 * Most extra heap per request of the worker route over the in-thread one [B]: below a few objects per request, far below
 * the old message (≈ 1 800 B); the per-tick readings of this small bed scatter by some 40 B per request.
 */
const EXTRA_BUDGET_BYTES = 128;
/** Measured passes per route. */
const PASSES = 5;
/** Thousands of requests per test: more than the default 5 s on a loaded machine. */
const TIMEOUT_MS = 60_000;

interface Bed {
  readonly grid: CollisionGrid;
  /** Walkable tiles of the middle chunks (x, y pairs). */
  readonly walkable: Int32Array;
  tick: number;
}

function bed(): Bed {
  const chunks = new Map<number, ChunkData>();
  for (let cy = 0; cy < CHUNKS; cy++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      const c = new ChunkData(0, cx, cy);
      c.ground.fill(GRAS);
      for (let i = 0; i < c.object.length; i += 17) c.object[i] = BIRKE;
      chunks.set(packChunkId(0, cx, cy), c);
    }
  }
  const b = { tick: 0 } as Bed & { grid: CollisionGrid; walkable: Int32Array };
  const grid = new CollisionGrid({ chunks: { get: (layer: Layer, cx: number, cy: number) => chunks.get(packChunkId(layer, cx, cy)) }, worldTiles: CHUNKS * CHUNK_SIZE, memo: true, epoch: () => b.tick });
  const out: number[] = [];
  for (let y = CHUNK_SIZE; y < 4 * CHUNK_SIZE; y++) for (let x = CHUNK_SIZE; x < 4 * CHUNK_SIZE; x++) if ((grid.tileInfo(0, x, y) & BLOCK_ALL) === 0) out.push(x, y);
  return Object.assign(b, { grid, walkable: Int32Array.from(out) });
}

/**
 * Runs `ticks` ticks of `PER_TICK` requests between random walkable tiles (drawn before, so the loop allocates nothing of
 * its own), polling every pending ticket and driving `frame` after each tick. `measure` reads its numbers around each tick.
 */
function drive(service: PathService, b: Bed, ticks: number, seed: number, frame: () => void, measure?: (phase: 'before' | 'after', requests: number) => void): number {
  const rng = new Rng(seed);
  const spots = b.walkable.length >> 1;
  const from = new Int32Array(ticks * PER_TICK);
  const to = new Int32Array(ticks * PER_TICK);
  for (let i = 0; i < from.length; i++) {
    from[i] = rng.int(0, spots);
    to[i] = rng.int(0, spots);
  }
  const req: { -readonly [K in keyof PathRequest]: PathRequest[K] } = { owner: 1, layer: 0, fromTx: 0, fromTy: 0, toTx: 0, toTy: 0, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 1024 };
  const pending: PathTicket[] = new Array<PathTicket>(PER_TICK * (BALANCE.ai.pathLatencyTicks + 4));
  let pendingCount = 0;
  let delivered = 0;
  for (let k = 0; k < ticks; k++, b.tick++) {
    measure?.('before', 0);
    service.update(b.tick);
    for (let i = 0; i < pendingCount; ) {
      if (service.poll(pending[i] as PathTicket, b.tick) === null) {
        i++;
        continue;
      }
      delivered++;
      pending[i] = pending[--pendingCount] as PathTicket;
    }
    for (let n = 0; n < PER_TICK; n++) {
      const i = k * PER_TICK + n;
      req.fromTx = b.walkable[2 * (from[i] as number)] as number;
      req.fromTy = b.walkable[2 * (from[i] as number) + 1] as number;
      req.toTx = b.walkable[2 * (to[i] as number)] as number;
      req.toTy = b.walkable[2 * (to[i] as number) + 1] as number;
      req.owner = 1 + n;
      pending[pendingCount++] = service.request(req, b.tick);
    }
    frame();
    measure?.('after', PER_TICK);
  }
  return delivered;
}

/** Sums a reading's growth over the ticks it did not shrink in (a collection in between hides what was made). */
class Growth {
  bytes = 0;
  requests = 0;
  private before = 0;

  constructor(private readonly read: () => number) {}

  readonly measure = (phase: 'before' | 'after', requests: number): void => {
    if (phase === 'before') {
      this.before = this.read();
      return;
    }
    const after = this.read();
    if (after < this.before) return;
    this.bytes += after - this.before;
    this.requests += requests;
  };

  get perRequest(): number {
    return this.bytes / Math.max(1, this.requests);
  }
}

/** One handle of the pass-through queue (reused: the queue allocates nothing per job). */
class PassHandle implements JobHandle {
  id = 0;
  state: JobState = 'done';
  priority = 0;
  job: PathJob | null = null;
  onDone: ((answer: PathJob) => void) | null = null;
}

/**
 * A job queue that hands the message to the worker's runner as it is – no structured clone, nothing of its own per job –
 * so the heap shows what the path service allocates on the worker route. Answers come in the next `frame()`.
 */
class PassThroughJobs {
  readonly runner = new PathJobRunner();
  private readonly handles: PassHandle[] = [];
  private used = 0;

  submit(_method: 'findPath', args: [job: PathJob], options: { onDone: (answer: PathJob) => void }): JobHandle {
    let h = this.handles[this.used];
    if (h === undefined) {
      h = new PassHandle();
      this.handles.push(h);
    }
    this.used++;
    h.state = 'queued';
    h.job = args[0];
    h.onDone = options.onDone;
    return h;
  }

  cancel(handle: JobHandle): boolean {
    const h = handle as PassHandle;
    if (h.state !== 'queued') return false;
    h.state = 'cancelled';
    return true;
  }

  frame(): void {
    for (let i = 0; i < this.used; i++) {
      const h = this.handles[i] as PassHandle;
      if (h.state !== 'queued') continue;
      h.state = 'done';
      (h.onDone as (answer: PathJob) => void)(this.runner.answer(h.job as PathJob));
    }
    this.used = 0;
  }
}

describe('Pfaddienst auf dem Worker-Weg: Nachrichten aus dem Pool', () => {
  it('mit der Job-Queue des Workers: kein neuer Pufferspeicher je Anfrage, alle Ergebnisse vom Worker, wenige Nachrichten', () => {
    const b = bed();
    const jobs = createPathJobs({ now: () => 0 }).jobs;
    const service = new PathService({ grid: b.grid, jobs });
    const warm = drive(service, b, WARM_TICKS, 1, () => service.frame());
    const buffers = new Growth(() => process.memoryUsage().arrayBuffers);
    const delivered = drive(service, b, MEASURED_TICKS, 2, () => service.frame(), buffers.measure);
    expect(warm + delivered).toBeGreaterThan(0.9 * (WARM_TICKS + MEASURED_TICKS) * PER_TICK);
    // Every result came from the worker before its ready tick (the last ones answered, not yet polled).
    expect(service.stats.inThread).toBe(0);
    expect(service.stats.byWorker).toBeGreaterThanOrEqual(warm + delivered);
    // The pool holds the jobs one tick admits, not one message per request.
    expect(service.stats.jobMessages).toBeLessThanOrEqual(2 * PER_TICK);
    expect(buffers.requests).toBeGreaterThan(MEASURED_TICKS * PER_TICK * 0.5);
    expect(buffers.perRequest).toBeLessThan(BUDGET_BYTES);
  }, TIMEOUT_MS);

  it('was der Dienst selbst je Anfrage auf dem Worker-Weg mehr anlegt als im eigenen Thread: nichts (Warteschlange ohne Klon)', () => {
    /** A route under measurement: a service on its own bed, warmed up with the request sequence. */
    const route = (jobs: PassThroughJobs | null): { service: PathService; bed: Bed; frame: () => void } => {
      const b = bed();
      const service = new PathService({ grid: b.grid, jobs: jobs as unknown as PathJobs | null });
      const frame = (): void => jobs?.frame();
      drive(service, b, WARM_TICKS, 1, frame);
      drive(service, b, WARM_TICKS, 1, frame);
      return { service, bed: b, frame };
    };
    // Per tick: the heap's growth minus that of an empty pair of readings (the readings' own objects).
    let empty = 0;
    const heap = new Growth(() => {
      const a = process.memoryUsage().heapUsed;
      const z = process.memoryUsage().heapUsed;
      empty = z - a;
      return z;
    });
    const measure = (phase: 'before' | 'after', requests: number): void => {
      heap.measure(phase, requests);
      if (phase === 'after') heap.bytes -= Math.max(0, empty);
    };
    /** Heap growth per request [B] of one measured pass of the request sequence on `r`. */
    const pass = (r: ReturnType<typeof route>): number => {
      heap.bytes = 0;
      heap.requests = 0;
      drive(r.service, r.bed, MEASURED_TICKS, 1, r.frame, measure);
      expect(heap.requests).toBeGreaterThan(MEASURED_TICKS * PER_TICK * 0.5);
      return heap.perRequest;
    };
    const inThread = route(null);
    const workerRoute = route(new PassThroughJobs());
    // Alternating passes, the least of each (a pass with a collection or a deoptimisation reads high).
    let leastInThread = Number.POSITIVE_INFINITY;
    let leastWorker = Number.POSITIVE_INFINITY;
    for (let k = 0; k < PASSES; k++) {
      leastInThread = Math.min(leastInThread, pass(inThread));
      leastWorker = Math.min(leastWorker, pass(workerRoute));
    }
    expect(workerRoute.service.stats.byWorker).toBeGreaterThan(0);
    expect(workerRoute.service.stats.inThread).toBe(0);
    expect(workerRoute.service.stats.jobMessages).toBeLessThanOrEqual(2 * PER_TICK);
    // The same requests: the worker route adds no object per request (one – a closure, an options object, an argument list –
    // is ≥ 32 B; the old message with its copies ≈ 1 800 B). The margin covers the readings' noise.
    expect(leastWorker - leastInThread).toBeLessThan(EXTRA_BUDGET_BYTES);
  }, TIMEOUT_MS);

  it('aufgegebene Aufträge geben ihre Nachricht zurück: abgebrochen, ob wartend oder unterwegs, oder im Simulationsthread gerechnet', async () => {
    const b = bed();
    // The worker behind an in-process channel: jobs run asynchronously, as in a worker thread.
    const [a, z] = createInProcessChannel();
    servePathWorker(z);
    const jobs: PathJobs = new JobQueue(workerExecutor(createRpcClient<PathWorkerApi>(a)), { frameBudgetMs: 1000, now: () => 0, maxInFlight: 4 });
    const service = new PathService({ grid: b.grid, jobs });
    const req: PathRequest = { owner: 1, layer: 0, fromTx: 40, fromTy: 40, toTx: 100, toTy: 90, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 2048 };
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };
    // Cancelled while waiting in the queue: the message is free at once.
    const waiting = service.request(req, 0);
    expect(service.stats.jobMessages).toBe(1);
    expect(service.cancel(waiting)).toBe(true);
    const next = service.request(req, 0);
    expect(service.stats.jobMessages).toBe(1);
    // Computed in this thread before the worker had it (no frame in between): its message is free as well.
    expect(service.poll(next, next.readyTick)?.status).toBe('found');
    expect(service.stats.inThread).toBe(1);
    service.request(req, 10);
    expect(service.stats.jobMessages).toBe(1);
    // Cancelled while the worker runs it: the message comes back with the dropped answer.
    const running = service.request({ ...req, owner: 2 }, 11);
    expect(service.stats.jobMessages).toBe(2);
    service.frame();
    expect(jobs.inFlight).toBe(2);
    expect(service.cancel(running)).toBe(true);
    await settle();
    service.frame();
    expect(jobs.idle).toBe(true);
    // Two requests at once take both messages: the answered one and the one back from the cancelled job.
    const again = service.request({ ...req, owner: 3 }, 12);
    const also = service.request({ ...req, owner: 4 }, 12);
    expect(service.stats.jobMessages).toBe(2);
    service.frame();
    await settle();
    service.frame();
    expect(service.poll(again, again.readyTick)?.status).toBe('found');
    expect(service.poll(also, also.readyTick)?.status).toBe('found');
    expect(service.stats.byWorker).toBeGreaterThanOrEqual(3);
  }, TIMEOUT_MS);
});
