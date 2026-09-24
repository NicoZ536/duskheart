/**
 * Node worker thread entry of `workerBridge.thread.test.ts`: serves the chunk worker API of the
 * fixture world, plus a CPU-heavy sweep with typed progress events, on the `MessagePort` handed
 * over in `workerData` (Node's `MessagePort` is an `EventTarget` like the browser's).
 */
import { threadId, workerData } from 'node:worker_threads';
import { createRpcServer, type RpcPort } from '../../../src/engine/workerBridge';
import { chunkHash } from '../../../src/world/model/chunk';
import { createChunkWorkerHandlers, type ChunkLoadRequest, type ChunkWorkerApi } from '../../../src/world/stream/worker';
import { fixtureGenerate, type FixturePlan } from '../world/streamFixture';

/** Events of the fixture thread. */
export interface FixtureThreadEvents {
  progress: { done: number; total: number };
}

/** API of the fixture thread: the chunk worker API plus test helpers. */
export interface FixtureThreadApi extends ChunkWorkerApi<FixturePlan> {
  /** Generates `count` chunks in a row and returns their hashes (a long job). */
  sweep(seed: number, count: number): string[];
  /** Thread id of the worker (proves the job ran off the main thread). */
  threadId(): number;
}

const port = (workerData as { port: RpcPort }).port;
const chunks = createChunkWorkerHandlers(fixtureGenerate);
const server = createRpcServer<FixtureThreadApi, FixtureThreadEvents>(
  {
    init: (plan: FixturePlan) => chunks.init(plan),
    load: (request: ChunkLoadRequest) => chunks.load(request),
    sweep(seed: number, count: number): string[] {
      const hashes: string[] = [];
      for (let i = 0; i < count; i++) {
        hashes.push(chunkHash(fixtureGenerate({ seed }, 0, i % 32, Math.floor(i / 32))));
        server.emit('progress', { done: i + 1, total: count });
      }
      return hashes;
    },
    threadId: () => threadId,
  },
  port,
);
