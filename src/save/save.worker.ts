/**
 * Browser entry of the save worker (MASTERPROMPT §3.1 "Worker: … Speicher-Kompression"; docs/SPIEL.md §25; M7-57): the save
 * writer (src/save/writer.ts) on the worker's global scope – snapshot hash, per-slot chunk bookkeeping, packing and gzipping
 * the chunk diffs and the IndexedDB transaction, all off the main thread. A connection to the save database is opened per
 * save and closed after it.
 *
 * Main thread: `new Worker(new URL('./save.worker.ts', import.meta.url), { type: 'module' })`, then
 * `connectWorker<SaveWorkerApi>(worker)` (src/save/saveService.ts).
 */
import { createRpcServer, type RpcPort } from '../engine/workerBridge';
import { openSaveDb } from './db';
import { createSaveWorkerHandlers, openPerUse, type SaveWorkerApi } from './writer';

const scope = globalThis as unknown as RpcPort & { readonly indexedDB: IDBFactory };
createRpcServer<SaveWorkerApi>(
  createSaveWorkerHandlers(openPerUse(() => openSaveDb(scope.indexedDB))),
  scope,
);
