/**
 * Browser entry of the world worker (M2-14): world generation with progress events and the chunk
 * loads of the streaming, served on the worker's global scope (src/world/gen/worker.ts).
 *
 * Main thread: `new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' })`, then
 * `connectWorker<WorldWorkerApi, WorldWorkerEvents>(worker)` and `requestWorld(client, seed, size, onProgress)`.
 */
import type { RpcPort } from '../../engine/workerBridge';
import { serveWorldWorker } from './worker';

serveWorldWorker(globalThis as unknown as RpcPort);
