/**
 * Der Pfad-Worker in einem echten Thread (Node `worker_threads`, wie der Browser `path.worker.ts` startet: dieselbe
 * `servePathWorker`-Bedienung an einem `MessagePort`) – M6-Review perf:path-worker-message-alloc:
 * - die Ergebnisse kommen vom Worker und gleichen denen des Simulationsthreads Anfrage für Anfrage;
 * - der Hauptthread legt dafür keinen neuen Pufferspeicher je Anfrage an (die Nachrichten des Dienstes gehen mit ihren
 *   Puffern hin und kommen mit der Antwort zurück; vorher kopierte jede Anfrage ihren Schnappschuss in neue Arrays);
 * - der Pool des Dienstes bleibt bei den Aufträgen, die zugleich warten oder unterwegs sind.
 */
import { MessageChannel, Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { Rng } from '../../../src/engine/rng';
import { JobQueue, createRpcClient, workerExecutor, type RpcClient, type RpcPort } from '../../../src/engine/workerBridge';
import { BLOCK_ALL, CollisionGrid } from '../../../src/world/collision/tiles';
import { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { PathService } from '../../../src/world/path/service';
import type { PathRequest, PathTicket } from '../../../src/world/path/types';
import type { PathWorkerApi } from '../../../src/world/path/worker';

const IDS = contentWorldIdTables();
const GRAS = IDS.terrain.runtimeId('gras');
const BIRKE = IDS.objects.runtimeId('baum_birke');
/** The world: 5 × 5 chunks of meadow with a birch every 17 tiles; paths stay in the middle 3 × 3. */
const CHUNKS = 5;
/** Requests per tick (the bench's 200 per second, rounded up) and ticks. */
const PER_TICK = 4;
const TICKS = 180;
/** Most new buffer bytes per request without a copied snapshot (`sim:pfad-200 · Worker-Weg: Pufferspeicher je Anfrage`). */
const BUDGET_BYTES = 64;
/** Starting a worker thread with the TypeScript loader takes a while on a loaded machine. */
const THREAD_TIMEOUT_MS = 60_000;
/** One frame at 60 Hz [ms]. */
const FRAME_MS = 1000 / 60;
/** Polls for the thread's first answer: every 10 ms, at most 30 s. */
const READY_WAIT_MS = 10;
const READY_TURNS = 3000;

let worker: Worker;
let channel: MessageChannel;
let client: RpcClient<PathWorkerApi>;

beforeAll(() => {
  channel = new MessageChannel();
  // The worker serves `findPath` on the port it gets, through tsx's loader (as the browser loads it through Vite).
  const entry = new URL('../../../src/world/path/worker.ts', import.meta.url).href;
  const bootstrap = `Promise.all([import('tsx/esm/api'), import('node:worker_threads')]).then(([tsx, wt]) => tsx.tsImport(${JSON.stringify(entry)}, ${JSON.stringify(entry)}).then((m) => m.servePathWorker(wt.workerData.port)))`;
  worker = new Worker(bootstrap, { eval: true, workerData: { port: channel.port2 }, transferList: [channel.port2] });
  client = createRpcClient<PathWorkerApi>(channel.port1 as unknown as RpcPort);
});

afterAll(async () => {
  client.dispose();
  channel.port1.close();
  await worker.terminate();
});

function grid(tickOf: () => number): { grid: CollisionGrid; walkable: Int32Array } {
  const chunks = new Map<number, ChunkData>();
  for (let cy = 0; cy < CHUNKS; cy++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      const c = new ChunkData(0, cx, cy);
      c.ground.fill(GRAS);
      for (let i = 0; i < c.object.length; i += 17) c.object[i] = BIRKE;
      chunks.set(packChunkId(0, cx, cy), c);
    }
  }
  const g = new CollisionGrid({ chunks: { get: (layer: Layer, cx: number, cy: number) => chunks.get(packChunkId(layer, cx, cy)) }, worldTiles: CHUNKS * CHUNK_SIZE, memo: true, epoch: tickOf });
  const out: number[] = [];
  for (let y = CHUNK_SIZE; y < 4 * CHUNK_SIZE; y++) for (let x = CHUNK_SIZE; x < 4 * CHUNK_SIZE; x++) if ((g.tileInfo(0, x, y) & BLOCK_ALL) === 0) out.push(x, y);
  return { grid: g, walkable: Int32Array.from(out) };
}

/** A frame's worth of time for the worker (16 ms at 60 Hz): until its jobs came back, at most that long. */
async function frameTime(jobs: JobQueue<PathWorkerApi>): Promise<void> {
  const end = performance.now() + FRAME_MS;
  do await new Promise((resolve) => setTimeout(resolve, 1));
  while (jobs.inFlight > 0 && performance.now() < end);
}

interface Run {
  readonly results: string[];
  readonly service: PathService;
  /**
   * New buffer bytes per request in the main thread's ticks and frames: the median over the ticks of the warm second half
   * of each tick's change of `arrayBuffers`, per request. Buffers go to the worker and come back moved, so a tick may send
   * (less) and a later one receive (more) – which tick depends on the machine's load; the median of all ticks, both signs,
   * stays at the steady state. A copied snapshot per request (≈ 32 KB each) would lift every tick.
   */
  readonly buffersPerRequest: number;
}

/** The same request sequence through a service; with `jobs`, every tick ends with a frame and a turn of the event loop. */
async function run(jobs: JobQueue<PathWorkerApi> | null): Promise<Run> {
  let tick = 0;
  const { grid: g, walkable } = grid(() => tick);
  const service = new PathService({ grid: g, jobs });
  const rng = new Rng(5);
  const spots = walkable.length >> 1;
  const pending: PathTicket[] = [];
  const results: string[] = [];
  const deltas: number[] = [];
  for (; tick < TICKS; tick++) {
    const before = process.memoryUsage().arrayBuffers;
    service.update(tick);
    for (let i = 0; i < pending.length; ) {
      const t = pending[i] as PathTicket;
      const id = t.id;
      const r = service.poll(t, tick);
      if (r === null) {
        i++;
        continue;
      }
      results.push(`${id} ${r.status} ${r.steps} ${r.expanded} ${Array.from(r.tiles.subarray(0, r.steps * 2)).join(',')}`);
      pending.splice(i, 1);
    }
    for (let n = 0; n < PER_TICK; n++) {
      const a = rng.int(0, spots);
      const b = rng.int(0, spots);
      const req: PathRequest = { owner: 1 + n, layer: 0, fromTx: walkable[2 * a] as number, fromTy: walkable[2 * a + 1] as number, toTx: walkable[2 * b] as number, toTy: walkable[2 * b + 1] as number, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 2048 };
      pending.push(service.request(req, tick));
    }
    if (jobs !== null) service.frame();
    const after = process.memoryUsage().arrayBuffers;
    // The second half, pools warm.
    if (tick >= TICKS / 2) deltas.push(after - before);
    if (jobs !== null) await frameTime(jobs);
  }
  deltas.sort((x, y) => x - y);
  const median = deltas.length === 0 ? 0 : (deltas[deltas.length >> 1] as number);
  return { results, service, buffersPerRequest: Math.max(0, median) / PER_TICK };
}

/** Waits until the thread has loaded its code and answered a first request (its start is not part of the run). */
async function workerReady(jobs: JobQueue<PathWorkerApi>): Promise<void> {
  const { grid: g, walkable } = grid(() => 0);
  const service = new PathService({ grid: g, jobs });
  const req: PathRequest = { owner: 1, layer: 0, fromTx: walkable[0] as number, fromTy: walkable[1] as number, toTx: walkable[2] as number, toTy: walkable[3] as number, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: 64 };
  service.request(req, 0);
  for (let turn = 0; service.stats.byWorker === 0; turn++) {
    if (turn > READY_TURNS) throw new Error('the path worker thread did not answer');
    service.frame();
    await new Promise((resolve) => setTimeout(resolve, READY_WAIT_MS));
  }
}

describe('Pfad-Worker in einem echten Thread', () => {
  it(
    'die Antworten kommen aus dem Worker-Thread, gleich denen des Simulationsthreads – ohne neuen Pufferspeicher je Anfrage im Hauptthread',
    async () => {
      const jobs = new JobQueue(workerExecutor(client), { frameBudgetMs: BALANCE.ai.path.jobFrameBudgetMs, now: () => performance.now(), maxInFlight: BALANCE.ai.path.maxJobsInFlight });
      await workerReady(jobs);
      const threaded = await run(jobs);
      const local = await run(null);
      expect(threaded.results.length).toBeGreaterThan(TICKS * PER_TICK * 0.9);
      expect(threaded.results).toEqual(local.results);
      // Most answers came from the worker thread before their ready tick (a slow turn may leave one to the simulation).
      expect(threaded.service.stats.byWorker).toBeGreaterThan(threaded.results.length * 0.5);
      // A request holds its message until the answer or its ready tick (then the simulation computes it): the pool stays at
      // the requests of the latency's ticks, however many requests the run makes.
      expect(threaded.service.stats.jobMessages).toBeLessThanOrEqual(PER_TICK * (BALANCE.ai.pathLatencyTicks + 2) + BALANCE.ai.path.maxJobsInFlight);
      expect(threaded.buffersPerRequest).toBeLessThan(BUDGET_BYTES);
      await jobs.drain(100);
    },
    THREAD_TIMEOUT_MS,
  );
});
