/**
 * The path worker (M6-16, §19.4 "Pfadfindung im Worker"; docs/SPIEL.md §12): serves `findPath` on snapshots over the
 * worker bridge (src/engine/workerBridge.ts). The browser runs it in `path.worker.ts`; Node tests and browsers without
 * module workers run the same handlers in this thread (`createPathJobs` without `spawn`). A job message moves to the worker
 * and back with the answer in its own arrays (transferables both ways; the path service reuses them, `PathJobBuffers`).
 */
import { BALANCE } from '../../content/balance';
import { JobQueue, createJobExecutor, createRpcServer, rpcTransfer, type RpcPort, type RpcServer, type RpcTransfer, type WorkerLike } from '../../engine/workerBridge';
import { PathJobRunner, type PathJob } from './find';

/** RPC API of the path worker: the answer is the job message itself, its arrays moved back. */
export interface PathWorkerApi {
  findPath(job: PathJob): RpcTransfer<PathJob>;
}

/** The job queue the path service sends its snapshots through. */
export type PathJobs = JobQueue<PathWorkerApi>;

/** Handlers of the path worker (one portal cache per handler set). */
export function createPathWorkerHandlers(): PathWorkerApi {
  const runner = new PathJobRunner();
  return {
    findPath(job) {
      const { result, transfer } = runner.run(job);
      return rpcTransfer(result, transfer);
    },
  };
}

/** Serves the path worker API on `port` (the worker's global scope in `path.worker.ts`). */
export function servePathWorker(port: RpcPort): RpcServer {
  return createRpcServer<PathWorkerApi>(createPathWorkerHandlers(), port);
}

/** Options of `createPathJobs`. */
export interface PathJobsOptions {
  /** Spawns the worker (browser: `new Worker(new URL('./path.worker.ts', import.meta.url), { type: 'module' })`); absent in Node. */
  readonly spawn?: () => WorkerLike;
  /** Clock of the frame budget [ms] (browser: `performance.now`). */
  readonly now: () => number;
  /** Told why the worker could not start before falling back to this thread. */
  readonly onFallback?: (error: unknown) => void;
}

/** A path job queue and how to release it. */
export interface PathJobsHandle {
  readonly jobs: PathJobs;
  readonly mode: 'worker' | 'inThread';
  dispose(): void;
}

/**
 * The job queue of the path service: in the worker when one can be spawned, else in this thread. Drive it once per
 * rendered frame with `PathService.frame()`.
 */
export function createPathJobs(options: PathJobsOptions): PathJobsHandle {
  const handle = createJobExecutor<PathWorkerApi>({
    ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
    handlers: createPathWorkerHandlers,
    ...(options.onFallback === undefined ? {} : { onFallback: options.onFallback }),
  });
  const jobs = new JobQueue(handle.executor, { frameBudgetMs: BALANCE.ai.path.jobFrameBudgetMs, now: options.now, maxInFlight: BALANCE.ai.path.maxJobsInFlight });
  return {
    jobs,
    mode: handle.mode,
    dispose() {
      jobs.dispose();
      handle.dispose();
    },
  };
}
