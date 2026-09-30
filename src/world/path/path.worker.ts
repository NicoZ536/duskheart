/**
 * Browser entry of the path worker (M6-16): serves `findPath` on the worker's global scope (src/world/path/worker.ts).
 *
 * Main thread: `createPathJobs({ spawn: () => new Worker(new URL('./world/path/path.worker.ts', import.meta.url),
 * { type: 'module' }), now: () => performance.now() })`, handed to the `PathService`.
 */
import type { RpcPort } from '../../engine/workerBridge';
import { servePathWorker } from './worker';

servePathWorker(globalThis as unknown as RpcPort);
