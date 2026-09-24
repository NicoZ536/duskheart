/**
 * The generated world behind the world debug scenes (M2-28): world generation in the world worker
 * (`src/world/gen/world.worker.ts`, docs/WORLD.md §2 "im Worker") and chunk streaming around the
 * camera through the `ChunkManager` (M2-22) – the same worker serves the chunk loads afterwards.
 * Without a worker (Node tests, browsers without module workers) generation and loads run in this
 * thread with the very same code. A worker that fails before the world is there (script or load
 * error, a browser without module workers) is dropped and the world is generated in this thread
 * instead; only if that fails too the host reports the error (`onError`, state `fehler`).
 *
 * The render scenes only read the world: they ask the manager for resident chunks and move the
 * streaming focus with their camera. One host serves every world scene of a page (same seed and
 * size), so switching between them does not generate the world again.
 *
 * The game page runs a second host for the session's world (`adopt`): it hands the generated world
 * to the simulation and streams the simulation's own chunk store, so the game view shows exactly the
 * chunks the simulation reads and changes (docs/ARCHITEKTUR.md "Welt in der Simulation"); the same
 * worker serves generation and chunk loads (`createJobQueue`).
 *
 * A worker that fails *after* the world is there (M3-41: a crash, an error event, or it simply stops
 * answering) does not leave the view dark: the chunk jobs go through a `WorkerFailover`, which – on the
 * first failed call, or when a call has no answer after `WORKER_REPLY_TIMEOUT_MS` – drops the worker
 * (one warning), gives the same world to in-thread handlers and runs every open and later job there,
 * within the frame budget of `update`. The chunk store never sees a failure; the host stays `bereit`.
 */
import type { WorldSizePreset } from '../../content/balance';
import { connectWorker, inThreadExecutor, JobQueue, RpcTransfer, type JobExecutor, type JobRpcClient, type RpcClient, type RpcResult, type WorkerConnection, type WorkerLike } from '../../engine/workerBridge';
import { generateChunk } from '../../world/gen/chunk';
import { createWorldWorkerHandlers, requestWorld, type WorldWorkerApi, type WorldWorkerEvents } from '../../world/gen/worker';
import type { GeneratedWorld, WorldGenProgress } from '../../world/gen/world';
import type { ChunkData } from '../../world/model/chunk';
import type { Layer } from '../../world/model/coords';
import { chunkInWorld, worldDimensions } from '../../world/model/worldSize';
import { ChunkManager } from '../../world/stream/chunkManager';
import { STREAM_DEFAULTS } from '../../world/stream/config';

/** World of the debug scenes: fixed seed (screenshots are deterministic), small world (fast to generate). */
export const WORLD_SCENE_SEED = 20260924;
export const WORLD_SCENE_PRESET: WorldSizePreset = 'small';

export type WorldHostState = 'leer' | 'erzeugt' | 'bereit' | 'fehler';

/**
 * Chunks around the camera the host indexes each frame [chunks from the camera chunk]: the load
 * square of the streaming (radius 4 on the surface) plus one ring. Lookups inside it read a grid
 * (no packed-id key per call); farther ones ask the chunk manager.
 */
export const LOOKUP_RADIUS = 5;
const LOOKUP_SIDE = 2 * LOOKUP_RADIUS + 1;

export interface WorldHostOptions {
  readonly seed: number;
  readonly preset: WorldSizePreset;
  /** Spawns the world worker (browser); absent = everything runs in this thread. */
  readonly spawnWorker?: () => WorkerLike;
  /** Clock of the job queue's frame budget [ms]. */
  readonly now: () => number;
  /**
   * Takes the generated world and returns the chunk store to stream (the game page: the world goes to
   * the simulation, the host streams `sim.world.chunks`). Absent: the host builds its own store.
   */
  readonly adopt?: (world: GeneratedWorld) => ChunkManager<GeneratedWorld>;
  /** Told about every generation step before it starts (loading line of the title). */
  readonly onProgress?: (progress: WorldGenProgress) => void;
  /** Called once the world is generated and its chunk store is ready (`state === 'bereit'`). */
  readonly onReady?: (world: GeneratedWorld) => void;
  /** Called once if the world cannot be generated (worker and in-thread fallback failed), with the reason. */
  readonly onError?: (message: string) => void;
  /** Watchdog of the worker's chunk jobs [ms] (default `WORKER_REPLY_TIMEOUT_MS`). */
  readonly workerReplyTimeoutMs?: number;
  /** Timers of the watchdog (default: the browser's). */
  readonly timers?: FailoverTimers;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Longest a chunk job may wait for the world worker's answer before the worker counts as gone [ms]. A
 * chunk takes 1–3 ms in the worker; the margin covers a machine busy with other work (SwiftShader, a
 * large save loading) – a worker that died silently is noticed within this time.
 */
export const WORKER_REPLY_TIMEOUT_MS = 5000;

/** Timer functions of the failover watchdog (browser: `setTimeout`/`clearTimeout`; tests: a manual clock). */
export interface FailoverTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const BROWSER_TIMERS: FailoverTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A chunk job waiting for the in-thread handlers. */
interface BacklogJob {
  readonly method: keyof WorldWorkerApi & string;
  readonly args: readonly unknown[];
  readonly resolve: (value: never) => void;
  readonly reject: (err: unknown) => void;
}

/**
 * The world worker's chunk jobs with a way out (M3-41, see module comment): calls go to the worker until it
 * fails – a rejected call, or no answer after `timeoutMs` –, then to in-thread handlers holding the same
 * world. Jobs that were in the worker when it failed run again in this thread (chunk loads are pure: the
 * same request gives the same chunk). The in-thread jobs wait in a backlog that `pump` works off once per
 * frame within a time budget, like the in-thread executor of the job queue.
 */
export class WorkerFailover implements JobRpcClient<WorldWorkerApi> {
  private handlers: WorldWorkerApi | null = null;
  private readonly backlog: BacklogJob[] = [];
  private reasonValue: string | null = null;

  constructor(
    private readonly worker: Pick<RpcClient<WorldWorkerApi>, 'callTransfer'>,
    private readonly world: GeneratedWorld,
    private readonly options: {
      readonly timeoutMs: number;
      readonly timers: FailoverTimers;
      /** Told once when the worker is given up (with the reason). */
      readonly onFailover: (reason: string) => void;
    },
  ) {}

  /** Why the worker was given up, or null while it serves. */
  get reason(): string | null {
    return this.reasonValue;
  }

  /** Jobs waiting for the in-thread handlers. */
  get waiting(): number {
    return this.backlog.length;
  }

  /** Bound (the job queue calls it detached from the client, like the RPC client's own method). */
  readonly callTransfer = <K extends keyof WorldWorkerApi & string>(method: K, transfer: Transferable[], ...args: Parameters<WorldWorkerApi[K]>): Promise<RpcResult<ReturnType<WorldWorkerApi[K]>>> => {
    if (this.handlers !== null) return this.inThread(method, args);
    return new Promise((resolve, reject) => {
      const { timers, timeoutMs } = this.options;
      let settled = false;
      const timer = timers.set(() => {
        if (!settled) this.failOver(new Error(`keine Antwort nach ${timeoutMs} ms`));
      }, timeoutMs);
      this.worker.callTransfer(method, transfer, ...args).then(
        (result) => {
          settled = true;
          timers.clear(timer);
          resolve(result);
        },
        (err: unknown) => {
          settled = true;
          timers.clear(timer);
          this.failOver(err);
          this.inThread(method, args).then(resolve, reject);
        },
      );
    });
  };

  /** Gives the worker up (once): the same world goes to in-thread handlers. */
  failOver(err: unknown): void {
    if (this.handlers !== null) return;
    const handlers = createWorldWorkerHandlers(() => undefined);
    handlers.init(this.world);
    this.handlers = handlers;
    this.reasonValue = messageOf(err);
    this.options.onFailover(this.reasonValue);
  }

  /**
   * Runs waiting in-thread jobs until `budgetMs` of `now` is used (at least one per call, so the backlog
   * always shrinks). Returns how many ran.
   */
  pump(budgetMs: number, now: () => number): number {
    const handlers = this.handlers;
    if (handlers === null) return 0;
    const start = now();
    let ran = 0;
    while (this.backlog.length > 0 && (ran === 0 || now() - start < budgetMs)) {
      const job = this.backlog.shift() as BacklogJob;
      ran++;
      try {
        const fn = handlers[job.method] as (...a: readonly unknown[]) => unknown;
        // Message-port semantics like the job queue's in-thread executor: arguments and results are copies.
        const result = fn.apply(handlers, structuredClone(job.args) as unknown[]);
        job.resolve((result instanceof RpcTransfer ? structuredClone(result.value, { transfer: result.transfer }) : structuredClone(result)) as never);
      } catch (err) {
        job.reject(err);
      }
    }
    return ran;
  }

  private inThread<K extends keyof WorldWorkerApi & string>(method: K, args: readonly unknown[]): Promise<RpcResult<ReturnType<WorldWorkerApi[K]>>> {
    return new Promise((resolve, reject) => {
      this.backlog.push({ method, args, resolve: resolve as (value: never) => void, reject });
    });
  }
}

export class WorldHost {
  private stateValue: WorldHostState = 'leer';
  private worldValue: GeneratedWorld | null = null;
  private managerValue: ChunkManager<GeneratedWorld> | null = null;
  private connection: WorkerConnection<WorldWorkerApi, WorldWorkerEvents> | null = null;
  private errorValue: string | null = null;
  private generationMs = 0;
  private executor: JobExecutor<WorldWorkerApi> | null = null;
  /** The raw worker (debug: `terminateWorker`). */
  private rawWorker: WorkerLike | null = null;
  /** Chunk jobs of the worker with the in-thread way out (null: no worker, or before the world). */
  private failover: WorkerFailover | null = null;
  /** Resident chunks of the camera layer around the camera chunk (`LOOKUP_SIDE`², row-major). */
  private readonly grid: (ChunkData | undefined)[] = new Array<ChunkData | undefined>(LOOKUP_SIDE * LOOKUP_SIDE).fill(undefined);
  private gridLayer: Layer = 0;
  private gridX = 0;
  private gridY = 0;
  private readonly index = (chunk: ChunkData): void => {
    if (chunk.layer !== this.gridLayer) return;
    const gx = chunk.cx - this.gridX + LOOKUP_RADIUS;
    const gy = chunk.cy - this.gridY + LOOKUP_RADIUS;
    if (gx >= 0 && gy >= 0 && gx < LOOKUP_SIDE && gy < LOOKUP_SIDE) this.grid[gy * LOOKUP_SIDE + gx] = chunk;
  };

  constructor(private readonly options: WorldHostOptions) {}

  get state(): WorldHostState {
    return this.stateValue;
  }

  get world(): GeneratedWorld | null {
    return this.worldValue;
  }

  get manager(): ChunkManager<GeneratedWorld> | null {
    return this.managerValue;
  }

  get error(): string | null {
    return this.errorValue;
  }

  /** Where generation and chunk loads run. */
  get mode(): 'worker' | 'inThread' {
    return this.connection === null ? 'inThread' : 'worker';
  }

  /** Why the world worker was given up during the session (chunk loads then run in this thread), or null. */
  get workerFailure(): string | null {
    return this.failover?.reason ?? null;
  }

  /**
   * Debug (M3-41, E2E): ends the world worker the way a crashed worker process would – without telling
   * anyone; the failover notices when the next chunk job gets no answer. Returns whether there was one.
   */
  terminateWorker(): boolean {
    const w = this.rawWorker;
    if (w === null || this.connection === null) return false;
    w.terminate();
    return true;
  }

  /** Time the world took to generate [ms] (0 before). */
  get generatedInMs(): number {
    return this.generationMs;
  }

  /** Starts generating the world (once; later calls do nothing). */
  start(): void {
    if (this.stateValue !== 'leer') return;
    this.stateValue = 'erzeugt';
    const { seed, preset, spawnWorker, now } = this.options;
    const t0 = now();
    const done = (world: GeneratedWorld, executor: JobExecutor<WorldWorkerApi>): void => {
      this.generationMs = now() - t0;
      this.worldValue = world;
      this.executor = executor;
      const adopt = this.options.adopt;
      this.managerValue = adopt === undefined ? new ChunkManager({ plan: world, generate: generateChunk, jobs: this.createJobQueue(), world: worldDimensions(preset) }) : adopt(world);
      this.stateValue = 'bereit';
      this.options.onReady?.(world);
    };
    const fail = (err: unknown): void => {
      this.stateValue = 'fehler';
      this.errorValue = messageOf(err);
      console.error(`Welt (Seed ${seed}, ${preset}): ${this.errorValue}`);
      this.options.onError?.(this.errorValue);
    };
    // In-thread: after the current frame, so starting never blocks the caller.
    const inThread = (): void => {
      Promise.resolve()
        .then(() => {
          // Disposed meanwhile: the world is no longer wanted.
          if (this.stateValue !== 'erzeugt') return;
          const handlers = createWorldWorkerHandlers((p) => this.options.onProgress?.(p));
          done(handlers.generate(seed, preset), inThreadExecutor(handlers));
        })
        .catch(fail);
    };
    let worker: WorkerLike | null = null;
    try {
      worker = spawnWorker?.() ?? null;
    } catch (err) {
      console.warn(`Welt-Worker nicht verfügbar, erzeuge im Hauptthread: ${messageOf(err)}`);
    }
    if (worker === null) {
      inThread();
      return;
    }
    const connection = connectWorker<WorldWorkerApi, WorldWorkerEvents>(worker);
    this.connection = connection;
    this.rawWorker = worker;
    requestWorld(connection.client, seed, preset, this.options.onProgress).then(
      (world) => {
        // Disposed meanwhile: the world is no longer wanted.
        if (this.connection !== connection) return;
        try {
          const failover = new WorkerFailover(connection.client, world, {
            timeoutMs: this.options.workerReplyTimeoutMs ?? WORKER_REPLY_TIMEOUT_MS,
            timers: this.options.timers ?? BROWSER_TIMERS,
            onFailover: (reason) => {
              console.warn(`Welt-Worker ausgefallen, Chunks laden ab jetzt im Hauptthread: ${reason}`);
              // Pending calls reject and run again in this thread; the worker is gone for good.
              if (this.connection === connection) {
                this.connection = null;
                this.rawWorker = null;
                connection.terminate();
              }
            },
          });
          this.failover = failover;
          done(world, { kind: 'worker', client: failover });
        } catch (err) {
          fail(err);
        }
      },
      (err: unknown) => {
        if (this.connection !== connection) return;
        // The worker failed before the world was there: drop it, the same code runs in this thread.
        connection.terminate();
        this.connection = null;
        this.rawWorker = null;
        console.warn(`Welt-Worker ausgefallen, erzeuge im Hauptthread: ${messageOf(err)}`);
        inThread();
      },
    );
  }

  /**
   * A chunk job queue on the host's executor (the world worker, or in-thread) with the host's clock
   * as frame budget – for the chunk store of the simulation that adopts the world. Only once the
   * world is generated (the executor serves the chunk loads of that world).
   */
  createJobQueue(): JobQueue<WorldWorkerApi> {
    const executor = this.executor;
    if (executor === null) throw new Error('WorldHost: the world is not generated yet');
    return new JobQueue(executor, { frameBudgetMs: STREAM_DEFAULTS.jobFrameBudgetMs, now: this.options.now, maxInFlight: STREAM_DEFAULTS.maxJobsInFlight });
  }

  /** Once per frame with the camera chunk: streams chunks around it and indexes the resident ones (no-op until the world is ready). */
  update(layer: Layer, cx: number, cy: number): void {
    const m = this.managerValue;
    if (m === null || this.stateValue !== 'bereit') return;
    // After a worker failure the chunk jobs run here, within the streaming's frame budget.
    this.failover?.pump(STREAM_DEFAULTS.jobFrameBudgetMs, this.options.now);
    try {
      m.update(layer, cx, cy);
    } catch (err) {
      this.stateValue = 'fehler';
      this.errorValue = messageOf(err);
      console.error(`Welt (Seed ${this.options.seed}, ${this.options.preset}): ${this.errorValue}`);
      this.options.onError?.(this.errorValue);
    }
    this.grid.fill(undefined);
    this.gridLayer = layer;
    this.gridX = cx;
    this.gridY = cy;
    m.forEachResident(this.index);
  }

  /** Whether chunk (cx, cy) lies inside the world (before the world exists: every chunk). */
  inWorld(cx: number, cy: number): boolean {
    const m = this.managerValue;
    return m === null || chunkInWorld(m.world, cx, cy);
  }

  /** Resident chunk, if loaded (as of the last `update` around the camera, else from the chunk manager). */
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    const gx = cx - this.gridX + LOOKUP_RADIUS;
    const gy = cy - this.gridY + LOOKUP_RADIUS;
    if (layer === this.gridLayer && gx >= 0 && gy >= 0 && gx < LOOKUP_SIDE && gy < LOOKUP_SIDE) return this.grid[gy * LOOKUP_SIDE + gx];
    return this.managerValue?.get(layer, cx, cy);
  }

  dispose(): void {
    this.connection?.terminate();
    this.connection = null;
    this.rawWorker = null;
    this.failover = null;
    this.managerValue = null;
    this.worldValue = null;
    this.executor = null;
    this.grid.fill(undefined);
    this.stateValue = 'leer';
  }
}

let shared: WorldHost | null = null;

/** The debug scenes' world without a worker (tools and tests that render scenes in Node): one per process. */
export function sharedInThreadWorldHost(): WorldHost {
  shared ??= new WorldHost({ seed: WORLD_SCENE_SEED, preset: WORLD_SCENE_PRESET, now: () => performance.now() });
  return shared;
}
