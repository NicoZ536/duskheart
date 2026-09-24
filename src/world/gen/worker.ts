/**
 * World generation in a worker (M2-14, MASTERPROMPT §3.1 "Worker: Weltgenerierung", §30 "neue Welt
 * Mittel spielbar ≤ 8 s", docs/WORLD.md §2 "im Worker").
 *
 * One worker serves the whole world: `generate(seed, size)` builds the world (`generateWorld`),
 * emits a `progress` event before every step and keeps the world for the chunk loads that follow;
 * `load(request)` is the chunk API of the streaming (src/world/stream/worker.ts: generate → baseline →
 * diff → hash, transferable buffers); `init(world)` hands the worker a world built elsewhere (e.g. a
 * loaded save regenerated on the main thread).
 *
 * `createWorldWorkerHandlers(emit)` are the handlers of the worker entry (`world.worker.ts`) and of
 * the in-thread fallback (Node tests, browsers without module workers) – both run the same code, so
 * the results are identical. `requestWorld(client, seed, size, onProgress)` is the main-thread side:
 * it subscribes to the progress events for the duration of the call.
 */
import type { WorldSizePreset } from '../../content/balance';
import { createRpcServer, type RpcClient, type RpcPort, type RpcServer } from '../../engine/workerBridge';
import { createChunkWorkerHandlers, type ChunkLoadRequest, type ChunkWorkerApi, type LoadedChunk } from '../stream/worker';
import type { RpcTransfer } from '../../engine/workerBridge';
import { generateChunk } from './chunk';
import { generateWorld, type GeneratedWorld, type WorldGenProgress } from './world';

/** Events of the world worker. */
export interface WorldWorkerEvents {
  /** A generation step starts. */
  progress: WorldGenProgress;
}

/** RPC API of the world worker: world generation plus the chunk API of the streaming. */
export interface WorldWorkerApi extends ChunkWorkerApi<GeneratedWorld> {
  /** Generates the world of (seed, size), keeps it for `load` and returns it (structured clone). */
  generate(seed: number, preset: WorldSizePreset): GeneratedWorld;
}

/** Handlers of the world worker; `emit` receives the progress events. */
export function createWorldWorkerHandlers(emit: (progress: WorldGenProgress) => void): WorldWorkerApi {
  const chunks = createChunkWorkerHandlers(generateChunk);
  return {
    generate(seed: number, preset: WorldSizePreset): GeneratedWorld {
      const world = generateWorld(seed, preset, emit);
      chunks.init(world);
      return world;
    },
    init(world: GeneratedWorld): boolean {
      return chunks.init(world);
    },
    load(request: ChunkLoadRequest): RpcTransfer<LoadedChunk> {
      return chunks.load(request);
    },
  };
}

/** Serves the world worker API on `port` (the worker's global scope, or a `MessagePort`). */
export function serveWorldWorker(port: RpcPort): RpcServer<WorldWorkerEvents> {
  const emitter: { emit: (p: WorldGenProgress) => void } = { emit: () => undefined };
  const server = createRpcServer<WorldWorkerApi, WorldWorkerEvents>(
    createWorldWorkerHandlers((p) => emitter.emit(p)),
    port,
  );
  emitter.emit = (p) => server.emit('progress', p);
  return server;
}

/**
 * Asks the world worker behind `client` for a world and forwards its progress events to
 * `onProgress` while the call runs.
 */
export async function requestWorld(client: RpcClient<WorldWorkerApi, WorldWorkerEvents>, seed: number, preset: WorldSizePreset, onProgress?: (p: WorldGenProgress) => void): Promise<GeneratedWorld> {
  const off = onProgress === undefined ? (): void => undefined : client.on('progress', onProgress);
  try {
    return await client.call('generate', seed, preset);
  } finally {
    off();
  }
}
