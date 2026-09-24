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
 */
import type { WorldSizePreset } from '../../content/balance';
import { connectWorker, inThreadExecutor, JobQueue, workerExecutor, type JobExecutor, type WorkerConnection, type WorkerLike } from '../../engine/workerBridge';
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
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class WorldHost {
  private stateValue: WorldHostState = 'leer';
  private worldValue: GeneratedWorld | null = null;
  private managerValue: ChunkManager<GeneratedWorld> | null = null;
  private connection: WorkerConnection<WorldWorkerApi, WorldWorkerEvents> | null = null;
  private errorValue: string | null = null;
  private generationMs = 0;
  private executor: JobExecutor<WorldWorkerApi> | null = null;
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
    requestWorld(connection.client, seed, preset, this.options.onProgress).then(
      (world) => {
        // Disposed meanwhile: the world is no longer wanted.
        if (this.connection !== connection) return;
        try {
          done(world, workerExecutor(connection.client));
        } catch (err) {
          fail(err);
        }
      },
      (err: unknown) => {
        if (this.connection !== connection) return;
        // The worker failed before the world was there: drop it, the same code runs in this thread.
        connection.terminate();
        this.connection = null;
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
